-- Booking management and AI diagnosis modules for D1.
-- The original Flowin reference uses PostgreSQL types. This migration keeps the
-- same business model while storing IDs/timestamps/JSON in D1-friendly TEXT.

CREATE TABLE IF NOT EXISTS booking_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('calendar', 'event')),
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  approval_required INTEGER NOT NULL DEFAULT 0,
  cancellation_deadline_hours INTEGER NOT NULL DEFAULT 0,
  change_deadline_hours INTEGER NOT NULL DEFAULT 0,
  remind_hours TEXT NOT NULL DEFAULT '[24]',
  form_fields TEXT NOT NULL DEFAULT '[]',
  message_on_booked TEXT,
  message_on_confirmed TEXT,
  message_on_cancelled TEXT,
  message_reminder TEXT,
  google_calendar_id TEXT,
  enable_google_meet INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  org_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_staff (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  google_calendar_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_courses (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES booking_staff(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_slots (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES booking_staff(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES booking_courses(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked_count INTEGER NOT NULL DEFAULT 0,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  google_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_availability (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES booking_staff(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  specific_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES booking_slots(id) ON DELETE SET NULL,
  staff_id TEXT REFERENCES booking_staff(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES booking_courses(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  approval_status TEXT
    CHECK (approval_status IN ('pending_approval', 'approved', 'rejected')),
  customer_info TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  admin_note TEXT,
  management_token TEXT NOT NULL UNIQUE,
  google_calendar_event_id TEXT,
  google_meet_url TEXT,
  cancelled_at TEXT,
  org_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_reminders (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_form_config (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  form_name TEXT NOT NULL DEFAULT '診断',
  form_title TEXT NOT NULL DEFAULT '診断',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_questions (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  question_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  maps_to_type TEXT NOT NULL,
  options TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  type_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  tag_name TEXT NOT NULL,
  line_message TEXT NOT NULL,
  manga_lp_url TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_results (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  line_user_id TEXT,
  org_id TEXT,
  diagnosis_type TEXT NOT NULL,
  result_key TEXT NOT NULL,
  result_label TEXT,
  score TEXT,
  answers TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_services_slug ON booking_services(slug);
CREATE INDEX IF NOT EXISTS idx_booking_slots_service_time ON booking_slots(service_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_service_created ON bookings(service_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_line_user ON bookings(line_user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_management_token ON bookings(management_token);
CREATE INDEX IF NOT EXISTS idx_booking_reminders_due ON booking_reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_diagnosis_questions_order ON diagnosis_questions(sort_order);
CREATE INDEX IF NOT EXISTS idx_diagnosis_results_created ON diagnosis_results(created_at);
