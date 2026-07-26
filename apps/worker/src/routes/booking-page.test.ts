import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  approveBooking: vi.fn(),
  cancelBooking: vi.fn(),
  cancelBookingByToken: vi.fn(),
  createBookingService: vi.fn(),
  createBookingSlot: vi.fn(),
  generateCalendarSlots: vi.fn(),
  getBookingByToken: vi.fn(),
  getBookingServices: vi.fn(),
  getBookings: vi.fn(),
  getBookingServiceById: vi.fn(),
  getBookingServiceBySlug: vi.fn(),
  getBookingSlotById: vi.fn(),
  getBookingSlots: vi.fn(),
  getPublicBookingSlots: vi.fn(),
  rejectBooking: vi.fn(),
  submitBooking: vi.fn(),
  updateBookingCalendarEvent: vi.fn(),
  updateBookingService: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { booking } from './booking.js';

const attack = `</script><script>alert("xss")</script>&'`;
const service = {
  id: `service-"${attack}`,
  name: `Consulting ${attack}`,
  type: 'calendar',
  slug: 'consulting',
  description: `Description ${attack}`,
  approval_required: 0,
  cancellation_deadline_hours: 24,
  change_deadline_hours: 24,
  remind_hours: '[24]',
  form_fields: JSON.stringify([{
    key: `topic-"${attack}`,
    label: `Topic ${attack}`,
    type: 'select',
    required: true,
    options: [`Option ${attack}`],
  }]),
  message_on_booked: null,
  message_on_confirmed: null,
  message_on_cancelled: null,
  message_reminder: null,
  google_calendar_id: null,
  enable_google_meet: 0,
  is_active: 1,
  created_at: '2026-07-27T00:00:00+09:00',
  updated_at: '2026-07-27T00:00:00+09:00',
};

const env = {
  DB: {},
  WORKER_URL: `https://worker.example/${attack}`,
  LIFF_URL: `https://liff.line.me/${attack}`,
} as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.route('/', booking);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getBookingServiceBySlug.mockResolvedValue(service);
  dbMocks.getPublicBookingSlots.mockResolvedValue([]);
  dbMocks.getBookingByToken.mockResolvedValue({
    id: `booking ${attack}`,
    status: `pending ${attack}`,
  });
});

describe('booking page HTML', () => {
  test('escapes stored service and form values and safely serializes script data', async () => {
    const response = await app().request('/book/consulting', {}, env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(attack);
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('Consulting &lt;/script&gt;&lt;script&gt;');
    expect(html).toContain('Description &lt;/script&gt;&lt;script&gt;');
    expect(html).toContain('Topic &lt;/script&gt;&lt;script&gt;');
    expect(html).toContain('Option &lt;/script&gt;&lt;script&gt;');
  });

  test('escapes booking status and ID in confirmation HTML', async () => {
    const response = await app().request('/book/manage/token', {}, env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(attack);
    expect(html).toContain('pending &lt;/script&gt;&lt;script&gt;');
    expect(html).toContain('booking &lt;/script&gt;&lt;script&gt;');
  });
});
