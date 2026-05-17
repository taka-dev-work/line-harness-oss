import { jstNow, toJstString } from './utils.js';
import { getFriendByLineUserId } from './friends.js';

export type BookingServiceType = 'calendar' | 'event';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type BookingApprovalStatus = 'pending_approval' | 'approved' | 'rejected';

export interface BookingFormField {
  key: string;
  label: string;
  type: 'text' | 'phone' | 'email' | 'select';
  required?: boolean;
  options?: string[];
}

export interface BookingService {
  id: string;
  name: string;
  type: BookingServiceType;
  slug: string;
  description: string | null;
  approval_required: number;
  cancellation_deadline_hours: number;
  change_deadline_hours: number;
  remind_hours: string;
  form_fields: string;
  message_on_booked: string | null;
  message_on_confirmed: string | null;
  message_on_cancelled: string | null;
  message_reminder: string | null;
  google_calendar_id: string | null;
  enable_google_meet: number;
  is_active: number;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingSlot {
  id: string;
  service_id: string;
  staff_id: string | null;
  course_id: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  is_cancelled: number;
  google_event_id: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  service_id: string;
  slot_id: string | null;
  staff_id: string | null;
  course_id: string | null;
  user_id: string | null;
  friend_id: string | null;
  line_user_id: string;
  status: BookingStatus;
  approval_status: BookingApprovalStatus | null;
  customer_info: string;
  note: string;
  admin_note: string | null;
  management_token: string;
  google_calendar_event_id: string | null;
  google_meet_url: string | null;
  cancelled_at: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingReminder {
  id: string;
  booking_id: string;
  remind_at: string;
  status: 'pending' | 'sent' | 'failed';
  sent_at: string | null;
  created_at: string;
}

export interface CreateBookingServiceInput {
  name: string;
  type?: BookingServiceType;
  slug?: string;
  description?: string | null;
  approvalRequired?: boolean;
  cancellationDeadlineHours?: number;
  changeDeadlineHours?: number;
  remindHours?: number[];
  formFields?: BookingFormField[];
  messageOnBooked?: string | null;
  messageOnConfirmed?: string | null;
  messageOnCancelled?: string | null;
  messageReminder?: string | null;
  googleCalendarId?: string | null;
  enableGoogleMeet?: boolean;
}

export interface CreateBookingSlotInput {
  serviceId: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  title?: string | null;
  description?: string | null;
  staffId?: string | null;
  courseId?: string | null;
  imageUrl?: string | null;
}

export interface SubmitBookingInput {
  serviceId: string;
  slotId: string;
  lineUserId: string;
  staffId?: string | null;
  courseId?: string | null;
  customerInfo?: Record<string, unknown>;
  note?: string;
}

const DEFAULT_FORM_FIELDS: BookingFormField[] = [
  { key: 'name', label: 'お名前', type: 'text', required: true },
  { key: 'email', label: 'メールアドレス', type: 'email', required: false },
  { key: 'company', label: '会社名・屋号', type: 'text', required: false },
  { key: 'topic', label: '相談したい内容', type: 'text', required: true },
];

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `booking-${Date.now()}`;
}

export async function getBookingServices(db: D1Database): Promise<BookingService[]> {
  const result = await db
    .prepare('SELECT * FROM booking_services ORDER BY created_at DESC')
    .all<BookingService>();
  return result.results;
}

export async function getBookingServiceById(db: D1Database, id: string): Promise<BookingService | null> {
  return db.prepare('SELECT * FROM booking_services WHERE id = ?').bind(id).first<BookingService>();
}

export async function getBookingServiceBySlug(db: D1Database, slug: string): Promise<BookingService | null> {
  return db
    .prepare('SELECT * FROM booking_services WHERE slug = ? AND is_active = 1')
    .bind(slug)
    .first<BookingService>();
}

export async function createBookingService(
  db: D1Database,
  input: CreateBookingServiceInput,
): Promise<BookingService> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  const formFields = input.formFields ?? DEFAULT_FORM_FIELDS;

  await db
    .prepare(
      `INSERT INTO booking_services (
        id, name, type, slug, description, approval_required,
        cancellation_deadline_hours, change_deadline_hours, remind_hours,
        form_fields, message_on_booked, message_on_confirmed,
        message_on_cancelled, message_reminder, google_calendar_id,
        enable_google_meet, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.type ?? 'calendar',
      slug,
      input.description ?? null,
      input.approvalRequired ? 1 : 0,
      input.cancellationDeadlineHours ?? 0,
      input.changeDeadlineHours ?? 0,
      JSON.stringify(input.remindHours ?? [24]),
      JSON.stringify(formFields),
      input.messageOnBooked ?? 'ご予約を受け付けました。確認後にご案内します。',
      input.messageOnConfirmed ?? 'ご予約が確定しました。',
      input.messageOnCancelled ?? 'ご予約をキャンセルしました。',
      input.messageReminder ?? 'ご予約のリマインドです。{datetime} にお待ちしています。',
      input.googleCalendarId ?? null,
      input.enableGoogleMeet ? 1 : 0,
      now,
      now,
    )
    .run();

  return (await getBookingServiceById(db, id))!;
}

export async function updateBookingService(
  db: D1Database,
  id: string,
  input: Partial<CreateBookingServiceInput> & { isActive?: boolean },
): Promise<BookingService | null> {
  const existing = await getBookingServiceById(db, id);
  if (!existing) return null;

  const now = jstNow();
  await db
    .prepare(
      `UPDATE booking_services SET
        name = ?, type = ?, slug = ?, description = ?, approval_required = ?,
        cancellation_deadline_hours = ?, change_deadline_hours = ?, remind_hours = ?,
        form_fields = ?, message_on_booked = ?, message_on_confirmed = ?,
        message_on_cancelled = ?, message_reminder = ?, google_calendar_id = ?,
        enable_google_meet = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      input.type ?? existing.type,
      input.slug ? slugify(input.slug) : existing.slug,
      input.description !== undefined ? input.description : existing.description,
      input.approvalRequired !== undefined ? (input.approvalRequired ? 1 : 0) : existing.approval_required,
      input.cancellationDeadlineHours ?? existing.cancellation_deadline_hours,
      input.changeDeadlineHours ?? existing.change_deadline_hours,
      input.remindHours ? JSON.stringify(input.remindHours) : existing.remind_hours,
      input.formFields ? JSON.stringify(input.formFields) : existing.form_fields,
      input.messageOnBooked !== undefined ? input.messageOnBooked : existing.message_on_booked,
      input.messageOnConfirmed !== undefined ? input.messageOnConfirmed : existing.message_on_confirmed,
      input.messageOnCancelled !== undefined ? input.messageOnCancelled : existing.message_on_cancelled,
      input.messageReminder !== undefined ? input.messageReminder : existing.message_reminder,
      input.googleCalendarId !== undefined ? input.googleCalendarId : existing.google_calendar_id,
      input.enableGoogleMeet !== undefined ? (input.enableGoogleMeet ? 1 : 0) : existing.enable_google_meet,
      input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();

  return getBookingServiceById(db, id);
}

export async function getBookingSlots(db: D1Database, serviceId?: string): Promise<BookingSlot[]> {
  const query = serviceId
    ? db.prepare('SELECT * FROM booking_slots WHERE service_id = ? ORDER BY starts_at ASC').bind(serviceId)
    : db.prepare('SELECT * FROM booking_slots ORDER BY starts_at ASC');
  const result = await query.all<BookingSlot>();
  return result.results;
}

export async function getPublicBookingSlots(db: D1Database, serviceId: string): Promise<BookingSlot[]> {
  const result = await db
    .prepare(
      `SELECT * FROM booking_slots
       WHERE service_id = ? AND is_cancelled = 0 AND booked_count < capacity AND starts_at > ?
       ORDER BY starts_at ASC`,
    )
    .bind(serviceId, jstNow())
    .all<BookingSlot>();
  return result.results;
}

export async function getBookingSlotById(db: D1Database, id: string): Promise<BookingSlot | null> {
  return db.prepare('SELECT * FROM booking_slots WHERE id = ?').bind(id).first<BookingSlot>();
}

export async function createBookingSlot(db: D1Database, input: CreateBookingSlotInput): Promise<BookingSlot> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO booking_slots (
        id, service_id, staff_id, course_id, title, description, image_url,
        starts_at, ends_at, capacity, booked_count, is_cancelled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    )
    .bind(
      id,
      input.serviceId,
      input.staffId ?? null,
      input.courseId ?? null,
      input.title ?? null,
      input.description ?? null,
      input.imageUrl ?? null,
      input.startsAt,
      input.endsAt,
      input.capacity ?? 1,
      now,
    )
    .run();
  return (await getBookingSlotById(db, id))!;
}

export async function generateCalendarSlots(
  db: D1Database,
  input: {
    serviceId: string;
    dateFrom: string;
    dateTo: string;
    startTime: string;
    endTime: string;
    intervalMinutes: number;
    capacity: number;
    daysOfWeek: number[];
    staffId?: string | null;
    courseId?: string | null;
  },
): Promise<BookingSlot[]> {
  const slots: CreateBookingSlotInput[] = [];
  const from = new Date(`${input.dateFrom}T00:00:00+09:00`);
  const to = new Date(`${input.dateTo}T00:00:00+09:00`);
  const now = new Date();

  for (let d = new Date(from); d.getTime() <= to.getTime(); d.setDate(d.getDate() + 1)) {
    if (!input.daysOfWeek.includes(d.getDay())) continue;
    const datePart = toJstString(d).slice(0, 10);
    let cursor = new Date(`${datePart}T${input.startTime}:00+09:00`);
    const dayEnd = new Date(`${datePart}T${input.endTime}:00+09:00`);
    while (cursor.getTime() + input.intervalMinutes * 60_000 <= dayEnd.getTime()) {
      const end = new Date(cursor.getTime() + input.intervalMinutes * 60_000);
      if (cursor > now) {
        slots.push({
          serviceId: input.serviceId,
          startsAt: toJstString(cursor),
          endsAt: toJstString(end),
          capacity: input.capacity,
          staffId: input.staffId ?? null,
          courseId: input.courseId ?? null,
        });
      }
      cursor = end;
      if (slots.length > 500) throw new Error('生成件数が500件を超えます。期間を短くしてください。');
    }
  }

  const existingSlots = await getBookingSlots(db, input.serviceId);
  const existingKeys = new Set(existingSlots.map((slot) => `${slot.starts_at}__${slot.ends_at}`));
  const created: BookingSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.startsAt}__${slot.endsAt}`;
    if (existingKeys.has(key)) continue;
    created.push(await createBookingSlot(db, slot));
    existingKeys.add(key);
  }
  return created;
}

export async function getBookings(db: D1Database, serviceId?: string): Promise<(Booking & { service_name?: string; slot_starts_at?: string })[]> {
  const sql = `SELECT b.*, s.name AS service_name, sl.starts_at AS slot_starts_at
    FROM bookings b
    LEFT JOIN booking_services s ON s.id = b.service_id
    LEFT JOIN booking_slots sl ON sl.id = b.slot_id
    ${serviceId ? 'WHERE b.service_id = ?' : ''}
    ORDER BY b.created_at DESC`;
  const query = serviceId ? db.prepare(sql).bind(serviceId) : db.prepare(sql);
  const result = await query.all<Booking & { service_name?: string; slot_starts_at?: string }>();
  return result.results;
}

export async function getBookingById(db: D1Database, id: string): Promise<Booking | null> {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<Booking>();
}

export async function getBookingByToken(db: D1Database, token: string): Promise<Booking | null> {
  return db.prepare('SELECT * FROM bookings WHERE management_token = ?').bind(token).first<Booking>();
}

export async function updateBookingCalendarEvent(
  db: D1Database,
  id: string,
  input: { googleCalendarEventId: string | null; googleMeetUrl?: string | null },
): Promise<Booking | null> {
  const now = jstNow();
  await db
    .prepare('UPDATE bookings SET google_calendar_event_id = ?, google_meet_url = ?, updated_at = ? WHERE id = ?')
    .bind(input.googleCalendarEventId, input.googleMeetUrl ?? null, now, id)
    .run();
  return getBookingById(db, id);
}

export async function submitBooking(
  db: D1Database,
  input: SubmitBookingInput,
): Promise<{ booking: Booking; service: BookingService; slot: BookingSlot; approvalRequired: boolean }> {
  const service = await getBookingServiceById(db, input.serviceId);
  if (!service || !service.is_active) throw new Error('予約サービスが見つかりません');

  const slot = await getBookingSlotById(db, input.slotId);
  if (!slot || slot.service_id !== service.id || slot.is_cancelled) throw new Error('この予約枠は利用できません');
  if (slot.booked_count >= slot.capacity) throw new Error('この時間枠は満席です');

  const friend = await getFriendByLineUserId(db, input.lineUserId);
  const now = jstNow();
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const approvalRequired = Boolean(service.approval_required);
  const status: BookingStatus = approvalRequired ? 'pending' : 'confirmed';
  const approvalStatus: BookingApprovalStatus | null = approvalRequired ? 'pending_approval' : 'approved';

  await db.batch([
    db.prepare(
      `INSERT INTO bookings (
        id, service_id, slot_id, staff_id, course_id, user_id, friend_id,
        line_user_id, status, approval_status, customer_info, note, management_token,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      service.id,
      slot.id,
      input.staffId ?? slot.staff_id,
      input.courseId ?? slot.course_id,
      friend?.user_id ?? null,
      friend?.id ?? null,
      input.lineUserId,
      status,
      approvalStatus,
      JSON.stringify(input.customerInfo ?? {}),
      input.note ?? '',
      token,
      now,
      now,
    ),
    db.prepare('UPDATE booking_slots SET booked_count = booked_count + 1 WHERE id = ?').bind(slot.id),
  ]);

  const booking = (await getBookingById(db, id))!;
  if (status === 'confirmed') await scheduleBookingReminders(db, booking.id);
  return { booking, service, slot, approvalRequired };
}

export async function scheduleBookingReminders(db: D1Database, bookingId: string): Promise<void> {
  const booking = await getBookingById(db, bookingId);
  if (!booking || !booking.slot_id || booking.status !== 'confirmed') return;
  const service = await getBookingServiceById(db, booking.service_id);
  const slot = await getBookingSlotById(db, booking.slot_id);
  if (!service || !slot) return;

  let hours: number[] = [24];
  try {
    const parsed = JSON.parse(service.remind_hours || '[24]');
    if (Array.isArray(parsed)) hours = parsed.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    hours = [24];
  }

  const startsAt = new Date(slot.starts_at);
  const now = Date.now();
  for (const hour of hours) {
    const remindAt = new Date(startsAt.getTime() - hour * 3600_000);
    if (remindAt.getTime() <= now) continue;
    await db
      .prepare('INSERT INTO booking_reminders (id, booking_id, remind_at, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), booking.id, toJstString(remindAt), 'pending', jstNow())
      .run();
  }
}

export async function approveBooking(db: D1Database, id: string): Promise<Booking | null> {
  const booking = await getBookingById(db, id);
  if (!booking || booking.status === 'cancelled') return booking;
  const now = jstNow();
  await db
    .prepare('UPDATE bookings SET status = ?, approval_status = ?, updated_at = ? WHERE id = ?')
    .bind('confirmed', 'approved', now, id)
    .run();
  await scheduleBookingReminders(db, id);
  return getBookingById(db, id);
}

export async function rejectBooking(db: D1Database, id: string): Promise<Booking | null> {
  const booking = await getBookingById(db, id);
  if (!booking || booking.status === 'cancelled') return booking;
  const now = jstNow();
  await db.batch([
    db.prepare('UPDATE bookings SET status = ?, approval_status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
      .bind('cancelled', 'rejected', now, now, id),
    booking.slot_id
      ? db.prepare('UPDATE booking_slots SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?').bind(booking.slot_id)
      : db.prepare('SELECT 1'),
  ]);
  return getBookingById(db, id);
}

export async function cancelBooking(db: D1Database, id: string): Promise<Booking | null> {
  const booking = await getBookingById(db, id);
  if (!booking || booking.status === 'cancelled') return booking;
  const now = jstNow();
  await db.batch([
    db.prepare('UPDATE bookings SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
      .bind('cancelled', now, now, id),
    booking.slot_id
      ? db.prepare('UPDATE booking_slots SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?').bind(booking.slot_id)
      : db.prepare('SELECT 1'),
  ]);
  return getBookingById(db, id);
}

export async function cancelBookingByToken(db: D1Database, token: string): Promise<Booking> {
  const booking = await getBookingByToken(db, token);
  if (!booking) throw new Error('予約が見つかりません');
  if (booking.status === 'cancelled') throw new Error('この予約はすでにキャンセル済みです');

  const service = await getBookingServiceById(db, booking.service_id);
  const slot = booking.slot_id ? await getBookingSlotById(db, booking.slot_id) : null;
  const deadlineHours = service?.cancellation_deadline_hours ?? 0;
  if (deadlineHours > 0 && slot) {
    const deadline = new Date(slot.starts_at).getTime() - deadlineHours * 3600_000;
    if (Date.now() > deadline) throw new Error(`キャンセル締め切りを過ぎています（${deadlineHours}時間前まで）`);
  }

  return (await cancelBooking(db, booking.id))!;
}
