import { Hono } from 'hono';
import type { Context } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  approveBooking,
  cancelBooking,
  cancelBookingByToken,
  createBookingService,
  createBookingSlot,
  generateCalendarSlots,
  getBookingByToken,
  getBookingServices,
  getBookings,
  getBookingServiceById,
  getBookingServiceBySlug,
  getBookingSlotById,
  getBookingSlots,
  getPublicBookingSlots,
  rejectBooking,
  submitBooking,
  updateBookingCalendarEvent,
  updateBookingService,
} from '@line-crm/db';
import type { Booking, BookingService, BookingSlot } from '@line-crm/db';
import type { Env } from '../index.js';
import { GoogleCalendarClient, getGoogleCalendarAccessToken } from '../services/google-calendar.js';
import { escapeHtml, serializeJsonForInlineScript } from '../utils/html.js';

export const booking = new Hono<Env>();

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function workerBase(c: { env: Env['Bindings']; req: { url: string } }): string {
  return (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
}

function getLiffId(liffUrl?: string): string {
  return liffUrl?.match(/liff\.line\.me\/([^/?#]+)/)?.[1] ?? '';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function serializeService(row: BookingService) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    slug: row.slug,
    description: row.description,
    approvalRequired: Boolean(row.approval_required),
    cancellationDeadlineHours: row.cancellation_deadline_hours,
    changeDeadlineHours: row.change_deadline_hours,
    remindHours: safeJson<number[]>(row.remind_hours, [24]),
    formFields: safeJson(row.form_fields, []),
    messageOnBooked: row.message_on_booked,
    messageOnConfirmed: row.message_on_confirmed,
    messageOnCancelled: row.message_on_cancelled,
    messageReminder: row.message_reminder,
    googleCalendarId: row.google_calendar_id,
    enableGoogleMeet: Boolean(row.enable_google_meet),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSlot(row: BookingSlot) {
  return {
    id: row.id,
    serviceId: row.service_id,
    staffId: row.staff_id,
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    isCancelled: Boolean(row.is_cancelled),
    createdAt: row.created_at,
  };
}

function serializeBooking(row: Booking & { service_name?: string; slot_starts_at?: string }) {
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.service_name ?? null,
    slotId: row.slot_id,
    slotStartsAt: row.slot_starts_at ?? null,
    lineUserId: row.line_user_id,
    status: row.status,
    approvalStatus: row.approval_status,
    customerInfo: safeJson<Record<string, unknown>>(row.customer_info, {}),
    note: row.note,
    adminNote: row.admin_note,
    managementToken: row.management_token,
    googleMeetUrl: row.google_meet_url,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bookingMessage(service: BookingService, booking: Booking, slot: BookingSlot, kind: 'booked' | 'confirmed' | 'cancelled', baseUrl: string): string {
  const info = safeJson<Record<string, unknown>>(booking.customer_info, {});
  const name = String(info.name || 'お客さま');
  const template =
    kind === 'booked'
      ? service.message_on_booked
      : kind === 'confirmed'
        ? service.message_on_confirmed
        : service.message_on_cancelled;
  let message = (template || '')
    .replaceAll('\\n', '\n')
    .replaceAll('{name}', name)
    .replaceAll('{datetime}', formatDateTime(slot.starts_at))
    .replaceAll('{line_user_id}', booking.line_user_id);
  if (!message) message = kind === 'confirmed' ? 'ご予約が確定しました。' : kind === 'cancelled' ? 'ご予約をキャンセルしました。' : 'ご予約を受け付けました。';
  if (kind !== 'cancelled' && booking.management_token) {
    message += `\n\n予約の確認・キャンセル:\n${baseUrl}/book/manage/${booking.management_token}`;
  }
  if (booking.google_meet_url) {
    message += `\n\nオンライン参加URL:\n${booking.google_meet_url}`;
  }
  return message;
}

function calendarIdForService(c: Context<Env>, service: BookingService): string | null {
  return service.google_calendar_id || c.env.GOOGLE_CALENDAR_ID || null;
}

function bookingDescription(booking: Booking, slot: BookingSlot): string {
  const info = safeJson<Record<string, unknown>>(booking.customer_info, {});
  const lines = [
    `LINEユーザーID: ${booking.line_user_id}`,
    `予約ID: ${booking.id}`,
    `日時: ${formatDateTime(slot.starts_at)}`,
    '',
    '入力内容:',
    ...Object.entries(info).map(([key, value]) => `${key}: ${String(value ?? '')}`),
  ];
  if (booking.note) lines.push('', `補足メモ: ${booking.note}`);
  return lines.join('\n');
}

async function syncBookingToGoogleCalendar(
  c: Context<Env>,
  booking: Booking,
  service: BookingService,
  slot: BookingSlot,
): Promise<Booking> {
  const calendarId = calendarIdForService(c, service);
  if (!calendarId || !c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) return booking;
  if (booking.google_calendar_event_id) return booking;

  const accessToken = await getGoogleCalendarAccessToken({
    clientEmail: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  });
  const client = new GoogleCalendarClient({ calendarId, accessToken });
  const info = safeJson<Record<string, unknown>>(booking.customer_info, {});
  const name = String(info.name || '予約者');
  const created = await client.createEvent({
    summary: `${service.name} - ${name}`,
    description: bookingDescription(booking, slot),
    start: slot.starts_at,
    end: slot.ends_at,
    createMeet: Boolean(service.enable_google_meet),
  });
  return (await updateBookingCalendarEvent(c.env.DB, booking.id, {
    googleCalendarEventId: created.eventId,
    googleMeetUrl: created.meetUrl,
  })) ?? booking;
}

async function deleteBookingFromGoogleCalendar(c: Context<Env>, booking: Booking, service: BookingService): Promise<Booking> {
  const calendarId = calendarIdForService(c, service);
  if (!calendarId || !booking.google_calendar_event_id) return booking;
  if (!c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) return booking;

  const accessToken = await getGoogleCalendarAccessToken({
    clientEmail: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  });
  const client = new GoogleCalendarClient({ calendarId, accessToken });
  await client.deleteEvent(booking.google_calendar_event_id);
  return (await updateBookingCalendarEvent(c.env.DB, booking.id, {
    googleCalendarEventId: null,
    googleMeetUrl: null,
  })) ?? booking;
}

async function tryDeleteBookingFromGoogleCalendar(c: Context<Env>, booking: Booking): Promise<Booking> {
  const service = await getBookingServiceById(c.env.DB, booking.service_id);
  if (!service) return booking;
  try {
    return await deleteBookingFromGoogleCalendar(c, booking, service);
  } catch (err) {
    console.error('Google Calendar delete failed:', err);
    return booking;
  }
}

async function pushLine(c: Context<Env>, to: string, text: string): Promise<void> {
  if (!to || !c.env.LINE_CHANNEL_ACCESS_TOKEN) return;
  const client = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  await client.pushMessage(to, [{ type: 'text', text }]);
}

booking.get('/api/booking/services', async (c) => {
  const services = await getBookingServices(c.env.DB);
  return c.json({ success: true, data: services.map(serializeService) });
});

booking.post('/api/booking/services', async (c) => {
  try {
    const body = await c.req.json();
    const service = await createBookingService(c.env.DB, body);
    return c.json({ success: true, data: serializeService(service) }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '作成に失敗しました' }, 400);
  }
});

booking.put('/api/booking/services/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const service = await updateBookingService(c.env.DB, id, body);
    if (!service) return c.json({ success: false, error: '予約サービスが見つかりません' }, 404);
    return c.json({ success: true, data: serializeService(service) });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '更新に失敗しました' }, 400);
  }
});

booking.get('/api/booking/slots', async (c) => {
  const serviceId = c.req.query('serviceId') || undefined;
  const slots = await getBookingSlots(c.env.DB, serviceId);
  return c.json({ success: true, data: slots.map(serializeSlot) });
});

booking.post('/api/booking/slots', async (c) => {
  try {
    const body = await c.req.json();
    const slot = await createBookingSlot(c.env.DB, body);
    return c.json({ success: true, data: serializeSlot(slot) }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '予約枠の作成に失敗しました' }, 400);
  }
});

booking.post('/api/booking/slots/generate', async (c) => {
  try {
    const body = await c.req.json();
    const slots = await generateCalendarSlots(c.env.DB, body);
    return c.json({ success: true, data: slots.map(serializeSlot) }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '予約枠の生成に失敗しました' }, 400);
  }
});

booking.get('/api/booking/bookings', async (c) => {
  const serviceId = c.req.query('serviceId') || undefined;
  const rows = await getBookings(c.env.DB, serviceId);
  return c.json({ success: true, data: rows.map(serializeBooking) });
});

booking.post('/api/booking/submit', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.lineUserId) return c.json({ success: false, error: 'LINEユーザーIDが必要です' }, 400);
    let { booking: row, service, slot, approvalRequired } = await submitBooking(c.env.DB, body);
    if (!approvalRequired) {
      try {
        row = await syncBookingToGoogleCalendar(c, row, service, slot);
      } catch (err) {
        console.error('Google Calendar sync failed:', err);
      }
    }
    const message = bookingMessage(service, row, slot, approvalRequired ? 'booked' : 'confirmed', workerBase(c));
    await pushLine(c, row.line_user_id, message);
    return c.json({
      success: true,
      data: {
        bookingId: row.id,
        approvalRequired,
        message: approvalRequired ? '予約を受け付けました。承認後に確定します。' : '予約が確定しました。',
      },
    });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '予約に失敗しました' }, 400);
  }
});

booking.post('/api/booking/bookings/:id/approve', async (c) => {
  const id = c.req.param('id');
  let row = await approveBooking(c.env.DB, id);
  if (!row) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  const service = await getBookingServiceById(c.env.DB, row.service_id);
  const slot = row.slot_id ? await getBookingSlotById(c.env.DB, row.slot_id) : null;
  if (service && slot) {
    try {
      row = await syncBookingToGoogleCalendar(c, row, service, slot);
    } catch (err) {
      console.error('Google Calendar sync failed:', err);
    }
    await pushLine(c, row.line_user_id, bookingMessage(service, row, slot, 'confirmed', workerBase(c)));
  }
  return c.json({ success: true, data: serializeBooking(row) });
});

booking.post('/api/booking/bookings/:id/reject', async (c) => {
  const id = c.req.param('id');
  const row = await rejectBooking(c.env.DB, id);
  if (!row) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  return c.json({ success: true, data: serializeBooking(row) });
});

booking.post('/api/booking/bookings/:id/cancel', async (c) => {
  const id = c.req.param('id');
  let row = await cancelBooking(c.env.DB, id);
  if (!row) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  row = await tryDeleteBookingFromGoogleCalendar(c, row);
  return c.json({ success: true, data: serializeBooking(row) });
});

booking.post('/api/booking/cancel/:token', async (c) => {
  try {
    let row = await cancelBookingByToken(c.env.DB, c.req.param('token'));
    row = await tryDeleteBookingFromGoogleCalendar(c, row);
    return c.json({ success: true, data: serializeBooking(row) });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'キャンセルに失敗しました' }, 400);
  }
});

booking.get('/book/:slug', async (c) => {
  const slug = c.req.param('slug');
  const service = await getBookingServiceBySlug(c.env.DB, slug);
  if (!service) return c.html('<h1>予約ページが見つかりません</h1>', 404);
  const slots = await getPublicBookingSlots(c.env.DB, service.id);
  const fields = safeJson<Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }>>(service.form_fields, []);
  const apiUrl = `${workerBase(c)}/api/booking/submit`;
  const liffId = getLiffId(c.env.LIFF_URL);
  const slotData = slots.map((slot) => ({
    id: slot.id,
    date: slot.starts_at.slice(0, 10),
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
    timeLabel: `${new Date(slot.starts_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })} - ${new Date(slot.ends_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}`,
    remaining: slot.capacity - slot.booked_count,
  }));

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(service.name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Helvetica Neue',Arial,sans-serif}.wrap{max-width:760px;margin:0 auto;padding:28px 18px 48px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px;box-shadow:0 1px 2px rgba(0,0,0,.04)}h1{font-size:24px;margin:0 0 8px}.desc{color:#6b7280;font-size:14px;line-height:1.7;margin:0 0 20px}.section-title{font-size:14px;font-weight:800;color:#374151;margin:0 0 10px}.calendar{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}.cal-head{display:flex;align-items:center;justify-content:space-between;background:#f9fafb;padding:12px}.cal-head button{width:40px;height:40px;margin:0;padding:0;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#111827;font-size:18px}.month{font-weight:800;font-size:16px}.week,.days{display:grid;grid-template-columns:repeat(7,1fr)}.week div{padding:10px 0;text-align:center;font-size:12px;font-weight:800;color:#6b7280;border-top:1px solid #eef2f7}.day{min-height:68px;margin:0;border:0;border-top:1px solid #eef2f7;border-right:1px solid #eef2f7;border-radius:0;background:#fff;color:#111827;padding:8px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}.day:nth-child(7n){border-right:0}.day.empty{background:#fafafa;cursor:default}.day.disabled{color:#cbd5e1;background:#fafafa;cursor:not-allowed}.day.available{background:#f0fdf4;color:#064e3b}.day.selected{outline:2px solid #06C755;outline-offset:-2px}.day-num{font-weight:800;font-size:16px}.badge{font-size:11px;font-weight:800;color:#047857}.selected-slot{margin:12px 0 0;padding:12px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;color:#047857;font-size:14px;font-weight:800;display:none}.grid{display:grid;gap:12px;margin-top:18px}label{font-size:13px;font-weight:700;color:#374151}input,select,textarea{width:100%;margin-top:6px;border:1px solid #d1d5db;border-radius:10px;padding:12px;font-size:16px;background:#fff}button.primary{width:100%;margin-top:18px;border:0;border-radius:10px;background:#06C755;color:#fff;font-weight:800;font-size:16px;padding:14px 18px;cursor:pointer}.msg{margin-top:14px;padding:12px;border-radius:10px;font-size:14px;display:none}.ok{display:block;background:#ecfdf5;color:#047857}.ng{display:block;background:#fef2f2;color:#b91c1c}.modal{position:fixed;inset:0;background:rgba(15,23,42,.46);display:none;align-items:flex-end;justify-content:center;padding:16px;z-index:20}.modal.open{display:flex}.modal-card{width:100%;max-width:520px;background:#fff;border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.22)}.modal-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.modal-title{font-size:17px;font-weight:900}.close{width:36px;height:36px;margin:0;border:0;border-radius:999px;background:#f3f4f6;color:#374151;font-size:22px;line-height:1}.time-list{display:grid;gap:10px;max-height:46vh;overflow:auto}.time-btn{margin:0;width:100%;border:1px solid #d1d5db;border-radius:12px;background:#fff;color:#111827;padding:14px;text-align:left;font-weight:800}.time-btn span{display:block;margin-top:3px;color:#6b7280;font-size:12px;font-weight:600}.time-btn:hover{border-color:#06C755;background:#f0fdf4}@media(max-width:520px){.panel{padding:18px}.wrap{padding:18px 12px 32px}.day{min-height:58px}.day-num{font-size:14px}.badge{font-size:10px}}
</style>
</head>
<body>
<main class="wrap">
<section class="panel">
<h1>${escapeHtml(service.name)}</h1>
<p class="desc">${escapeHtml(service.description || '予約したい日時を選んで、必要事項を入力してください。')}</p>
<form id="booking-form">
<input type="hidden" name="serviceId" value="${escapeHtml(service.id)}">
<input type="hidden" name="slotId" required>
<p class="section-title">予約日時を選択</p>
${slots.length ? '<div class="calendar"><div class="cal-head"><button type="button" id="prev-month" aria-label="前の月">‹</button><div id="month-label" class="month"></div><button type="button" id="next-month" aria-label="次の月">›</button></div><div class="week"><div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div></div><div id="calendar-days" class="days"></div></div><div id="selected-slot" class="selected-slot"></div>' : '<p class="desc">現在、予約できる枠がありません。</p>'}
<div class="grid">
<label>LINEユーザーID<input name="lineUserId" required placeholder="LINE内で開くと自動入力されます"></label>
${fields.map((field) => {
  const required = field.required ? 'required' : '';
  if (field.type === 'select') {
    const options = (field.options ?? []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
    return `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}<select name="${escapeHtml(field.key)}" ${required}><option value="">選択してください</option>${options}</select></label>`;
  }
  return `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}<input name="${escapeHtml(field.key)}" type="${field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}" ${required}></label>`;
}).join('')}
<label>補足メモ<textarea name="note" rows="4" placeholder="相談内容や希望があれば入力してください"></textarea></label>
</div>
<button class="primary" type="submit">予約する</button>
<div id="message" class="msg"></div>
</form>
</section>
</main>
<div id="slot-modal" class="modal" aria-hidden="true">
  <div class="modal-card">
    <div class="modal-top">
      <div id="modal-title" class="modal-title">時間を選択</div>
      <button type="button" id="modal-close" class="close" aria-label="閉じる">×</button>
    </div>
    <div id="time-list" class="time-list"></div>
  </div>
</div>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const form=document.getElementById('booking-form');const msg=document.getElementById('message');
const slots=${serializeJsonForInlineScript(slotData)};
const bookingApiUrl=${serializeJsonForInlineScript(apiUrl)};
const configuredLiffId=${serializeJsonForInlineScript(liffId)};
const customerFieldKeys=${serializeJsonForInlineScript(fields.map((field) => field.key))};
const slotInput=form.querySelector('input[name="slotId"]');
const selectedSlot=document.getElementById('selected-slot');
const calendarDays=document.getElementById('calendar-days');
const monthLabel=document.getElementById('month-label');
const modal=document.getElementById('slot-modal');
const modalTitle=document.getElementById('modal-title');
const timeList=document.getElementById('time-list');
const closeBtn=document.getElementById('modal-close');
let currentMonth=slots[0]?new Date(slots[0].date+'T00:00:00+09:00'):new Date();
let selectedDate='';
function dateKey(date){const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return y+'-'+m+'-'+d;}
function dateLabel(key){const d=new Date(key+'T00:00:00+09:00');return d.toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});}
function groupedSlots(){return slots.reduce((acc,slot)=>{(acc[slot.date]||(acc[slot.date]=[])).push(slot);return acc;},{});}
function renderCalendar(){if(!calendarDays)return;const grouped=groupedSlots();const y=currentMonth.getFullYear();const m=currentMonth.getMonth();monthLabel.textContent=currentMonth.toLocaleDateString('ja-JP',{year:'numeric',month:'long'});calendarDays.innerHTML='';const first=new Date(y,m,1);const last=new Date(y,m+1,0);for(let i=0;i<first.getDay();i++){const empty=document.createElement('button');empty.type='button';empty.className='day empty';empty.disabled=true;calendarDays.appendChild(empty);}for(let day=1;day<=last.getDate();day++){const d=new Date(y,m,day);const key=dateKey(d);const count=(grouped[key]||[]).length;const btn=document.createElement('button');btn.type='button';btn.className='day '+(count?'available':'disabled')+(selectedDate===key?' selected':'');btn.disabled=!count;btn.innerHTML='<span class="day-num">'+day+'</span>'+(count?'<span class="badge">'+count+'枠</span>':'');btn.addEventListener('click',()=>openSlots(key));calendarDays.appendChild(btn);}}
function openSlots(key){const daySlots=slots.filter(slot=>slot.date===key);if(!daySlots.length)return;selectedDate=key;renderCalendar();modalTitle.textContent=dateLabel(key)+' の時間枠';timeList.innerHTML='';daySlots.forEach(slot=>{const btn=document.createElement('button');btn.type='button';btn.className='time-btn';btn.innerHTML=slot.timeLabel+'<span>残り '+slot.remaining+' 枠</span>';btn.addEventListener('click',()=>{slotInput.value=slot.id;selectedSlot.style.display='block';selectedSlot.textContent=dateLabel(key)+' '+slot.timeLabel+' を選択中';closeModal();});timeList.appendChild(btn);});modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
document.getElementById('prev-month')?.addEventListener('click',()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();});
document.getElementById('next-month')?.addEventListener('click',()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();});
closeBtn?.addEventListener('click',closeModal);
modal?.addEventListener('click',(e)=>{if(e.target===modal)closeModal();});
renderCalendar();
const lineInput=form.querySelector('input[name="lineUserId"]');
async function hydrateLineUserId(){
 const params=new URLSearchParams(location.search);
 const fromUrl=params.get('lineUserId')||params.get('uid')||params.get('line_user_id');
 const fromStore=localStorage.getItem('line_user_id')||'';
 if(fromUrl||fromStore){lineInput.value=fromUrl||fromStore;lineInput.closest('label').style.display='none';return;}
 const liffId=params.get('liffId')||configuredLiffId;
 if(liffId&&window.liff){try{await liff.init({liffId});if(liff.isLoggedIn()){const p=await liff.getProfile();if(p.userId){lineInput.value=p.userId;localStorage.setItem('line_user_id',p.userId);lineInput.closest('label').style.display='none';}}}catch(_){}}
}
hydrateLineUserId();
form.addEventListener('submit',async(e)=>{e.preventDefault();msg.className='msg';if(!slotInput.value){msg.className='msg ng';msg.textContent='予約したい日付と時間を選択してください。';msg.style.display='block';return;}msg.textContent='送信中です...';msg.style.display='block';const fd=new FormData(form);const customerInfo={};customerFieldKeys.forEach(k=>customerInfo[k]=fd.get(k)||'');const payload={serviceId:fd.get('serviceId'),slotId:fd.get('slotId'),lineUserId:fd.get('lineUserId'),customerInfo,note:fd.get('note')||''};try{const res=await fetch(bookingApiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(!data.success)throw new Error(data.error||'予約に失敗しました');msg.className='msg ok';msg.textContent=data.data?.message||'予約を受け付けました。';form.reset();slotInput.value='';if(selectedSlot){selectedSlot.style.display='none';selectedSlot.textContent='';}}catch(err){msg.className='msg ng';msg.textContent=err.message||'予約に失敗しました';}});
</script>
</body>
</html>`);
});

booking.get('/book/manage/:token', async (c) => {
  const token = c.req.param('token');
  const row = await getBookingByToken(c.env.DB, token);
  if (!row) return c.html('<h1>予約が見つかりません</h1>', 404);
  const apiUrl = `${workerBase(c)}/api/booking/cancel/${token}`;
  return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>予約確認</title><style>body{margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Helvetica Neue',Arial,sans-serif;color:#111827}.wrap{max-width:620px;margin:0 auto;padding:28px 18px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px}button{width:100%;margin-top:18px;border:0;border-radius:10px;background:#ef4444;color:#fff;font-weight:800;font-size:16px;padding:14px}.muted{color:#6b7280}.msg{margin-top:14px}</style></head><body><main class="wrap"><section class="panel"><h1>予約確認</h1><p class="muted">状態: ${escapeHtml(row.status)}</p><p>予約ID: ${escapeHtml(row.id)}</p>${row.status !== 'cancelled' ? '<button id="cancel">予約をキャンセルする</button>' : ''}<p id="msg" class="msg"></p></section></main><script>const cancelApiUrl=${serializeJsonForInlineScript(apiUrl)};const btn=document.getElementById('cancel');if(btn){btn.addEventListener('click',async()=>{if(!confirm('予約をキャンセルしますか？'))return;const res=await fetch(cancelApiUrl,{method:'POST'});const data=await res.json();document.getElementById('msg').textContent=data.success?'キャンセルしました':(data.error||'キャンセルに失敗しました');});}</script></body></html>`);
});
