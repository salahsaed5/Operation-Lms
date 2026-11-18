-- =============================================================================
-- CITS Camp Operations Management System
-- Migration: 0001_cits_initial_schema.sql
-- Target: Supabase PostgreSQL 15+ with Row Level Security (RLS)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ENUMS & DOMAIN TYPES
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'instructor');
CREATE TYPE camp_status AS ENUM ('draft', 'active', 'pending_archive', 'archived');
CREATE TYPE lecture_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
CREATE TYPE checkin_status AS ENUM ('verified', 'outside_geofence', 'late_first_lecture', 'exception_pending', 'exception_approved', 'exception_rejected');
CREATE TYPE attendance_sheet_status AS ENUM ('draft', 'submitted', 'locked');
CREATE TYPE attendance_mark AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE entitlement_status AS ENUM ('eligible', 'pending_review', 'approved', 'excluded');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE issue_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE issue_status AS ENUM ('open', 'in_progress', 'resolved');

-- -----------------------------------------------------------------------------
-- 2. CORE IDENTITY & AUTHENTICATION TABLES
-- -----------------------------------------------------------------------------

-- 2.1 profiles (1:1 with auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role user_role NOT NULL,
  username TEXT UNIQUE NOT NULL CHECK (char_length(username) >= 3),
  email TEXT UNIQUE NOT NULL,
  full_name_en TEXT NOT NULL,
  full_name_ar TEXT NOT NULL,
  phone TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 admin_accounts (Strictly capped at 2 identical Admin accounts; no Super Admin)
CREATE TABLE admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
  totp_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_verified_at TIMESTAMPTZ,
  assigned_slot SMALLINT NOT NULL UNIQUE CHECK (assigned_slot IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION enforce_max_two_admins()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM admin_accounts;
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'CITS Policy Violation: Maximum of two Admin accounts allowed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_max_two_admins
BEFORE INSERT ON admin_accounts
FOR EACH ROW EXECUTE FUNCTION enforce_max_two_admins();

-- 2.3 instructors
CREATE TABLE instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
  Instructor_code TEXT UNIQUE NOT NULL,
  specialization TEXT NOT NULL,
  default_lecture_rate_egp INTEGER NOT NULL DEFAULT 600 CHECK (default_lecture_rate_egp >= 0),
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. VENUES, CAMPS & CAMP CONFIGURATION
-- -----------------------------------------------------------------------------

-- 3.1 venues
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  geofence_radius_meters INTEGER NOT NULL DEFAULT 100 CHECK (geofence_radius_meters BETWEEN 25 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2 camps (Enforce maximum ONE active camp via partial unique index)
CREATE TABLE camps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  status camp_status NOT NULL DEFAULT 'draft',
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 10 CHECK (duration_days >= 1 AND duration_days <= 60),
  current_camp_day INTEGER NOT NULL DEFAULT 1 CHECK (current_camp_day >= 1),
  template_source_camp_id UUID REFERENCES camps(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

-- Non-negotiable constraint: Only one active camp at a time
CREATE UNIQUE INDEX idx_single_active_camp ON camps ((status)) WHERE status = 'active';

-- 3.3 camp_settings
CREATE TABLE camp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL UNIQUE REFERENCES camps(id) ON DELETE CASCADE,
  default_lecture_duration_hours INTEGER NOT NULL DEFAULT 3 CHECK (default_lecture_duration_hours BETWEEN 1 AND 6),
  max_instructor_groups_per_day INTEGER NOT NULL DEFAULT 4 CHECK (max_instructor_groups_per_day BETWEEN 1 AND 8),
  geofence_radius_meters INTEGER NOT NULL DEFAULT 100 CHECK (geofence_radius_meters BETWEEN 25 AND 1000),
  first_lecture_late_threshold_minutes INTEGER NOT NULL DEFAULT 60 CHECK (first_lecture_late_threshold_minutes >= 15),
  max_selfie_kb INTEGER NOT NULL DEFAULT 300 CHECK (max_selfie_kb <= 300),
  default_lecture_rate_egp INTEGER NOT NULL DEFAULT 600 CHECK (default_lecture_rate_egp >= 0),
  period_slots JSONB NOT NULL DEFAULT '[
    {"period": 1, "start": "09:00", "end": "12:00"},
    {"period": 2, "start": "12:00", "end": "15:00"},
    {"period": 3, "start": "15:00", "end": "18:00"},
    {"period": 4, "start": "18:00", "end": "21:00"}
  ]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.4 rooms
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (venue_id, code)
);

-- 3.5 camp_instructors
CREATE TABLE camp_instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (camp_id, instructor_id)
);

-- 3.6 instructor_rates (Preserves historical rates per camp & effective date)
CREATE TABLE instructor_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  lecture_rate_egp INTEGER NOT NULL CHECK (lecture_rate_egp >= 0),
  effective_from_day INTEGER NOT NULL DEFAULT 1 CHECK (effective_from_day >= 1),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. GROUPS & STUDENTS (Camp-Specific Records, No Student Accounts)
-- -----------------------------------------------------------------------------

-- 4.1 groups
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  track TEXT NOT NULL,
  default_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (camp_id, code)
);

-- 4.2 group_instructors (Supports historical transfers with effective dates)
CREATE TABLE group_instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  effective_from_day INTEGER NOT NULL DEFAULT 1,
  effective_to_day INTEGER,
  assigned_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4.3 students (Unique Student Code within its camp)
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  student_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  university TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (camp_id, student_code)
);

-- 4.4 student_transfers
CREATE TABLE student_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  from_group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  to_group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  effective_camp_day INTEGER NOT NULL CHECK (effective_camp_day >= 1),
  reason TEXT NOT NULL,
  transferred_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. SCHEDULE & LECTURES (Server-Side Conflict Prevention)
-- -----------------------------------------------------------------------------

-- 5.1 lectures
CREATE TABLE lectures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL CHECK (camp_day >= 1),
  lecture_date DATE NOT NULL,
  period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 8),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_hours INTEGER NOT NULL DEFAULT 3 CHECK (duration_hours > 0),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  substitute_instructor_id UUID REFERENCES instructors(id) ON DELETE RESTRICT,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL,
  status lecture_status NOT NULL DEFAULT 'scheduled',
  frozen_rate_egp INTEGER NOT NULL CHECK (frozen_rate_egp >= 0),
  instructor_acknowledged_at TIMESTAMPTZ,
  revision_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent instructor, group, and room scheduling conflicts on active lectures
CREATE UNIQUE INDEX idx_conflict_instructor_slot
  ON lectures (camp_id, camp_day, period_number, COALESCE(substitute_instructor_id, instructor_id))
  WHERE status != 'cancelled';

CREATE UNIQUE INDEX idx_conflict_group_slot
  ON lectures (camp_id, camp_day, period_number, group_id)
  WHERE status != 'cancelled';

CREATE UNIQUE INDEX idx_conflict_room_slot
  ON lectures (camp_id, camp_day, period_number, room_id)
  WHERE status != 'cancelled';

-- -----------------------------------------------------------------------------
-- 6. DAILY CHECK-IN & GEOFENCE VERIFICATION
-- -----------------------------------------------------------------------------

-- 6.1 daily_checkins (One daily check-in per instructor per camp day)
CREATE TABLE daily_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL CHECK (camp_day >= 1),
  checkin_date DATE NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  gps_accuracy_meters DOUBLE PRECISION NOT NULL CHECK (gps_accuracy_meters >= 0),
  distance_from_venue_meters DOUBLE PRECISION NOT NULL CHECK (distance_from_venue_meters >= 0),
  within_geofence BOOLEAN NOT NULL,
  selfie_storage_path TEXT,
  selfie_size_kb INTEGER CHECK (selfie_size_kb IS NULL OR selfie_size_kb <= 300),
  selfie_deleted_after_archive BOOLEAN NOT NULL DEFAULT FALSE,
  arrived_late_first_lecture BOOLEAN NOT NULL DEFAULT FALSE,
  minutes_after_first_lecture INTEGER NOT NULL DEFAULT 0,
  status checkin_status NOT NULL DEFAULT 'verified',
  UNIQUE (camp_id, instructor_id, camp_day)
);

-- 6.2 checkin_exceptions
CREATE TABLE checkin_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID REFERENCES daily_checkins(id) ON DELETE CASCADE,
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 7. ATTENDANCE SHEETS & RECORDS
-- -----------------------------------------------------------------------------

-- 7.1 attendance_sheets (Strictly one attendance sheet per lecture)
CREATE TABLE attendance_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  lecture_id UUID NOT NULL UNIQUE REFERENCES lectures(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  status attendance_sheet_status NOT NULL DEFAULT 'draft',
  idempotency_key TEXT UNIQUE NOT NULL,
  present_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  cross_group_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7.2 attendance_records (One record per student per sheet + prevent same-day period duplicates)
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  attendance_sheet_id UUID NOT NULL REFERENCES attendance_sheets(id) ON DELETE CASCADE,
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL,
  period_number SMALLINT NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  origin_group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  attended_group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  is_cross_group BOOLEAN NOT NULL DEFAULT FALSE,
  mark attendance_mark NOT NULL DEFAULT 'present',
  note TEXT,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attendance_sheet_id, student_id),
  -- Prevent duplicate same-day student attendance in the same period across groups
  UNIQUE (camp_id, student_id, camp_day, period_number)
);

-- -----------------------------------------------------------------------------
-- 8. FINANCIAL ENTITLEMENTS (Frozen Lecture Rate in EGP, No Payout Tracking)
-- -----------------------------------------------------------------------------

-- 8.1 lecture_entitlements
CREATE TABLE lecture_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  lecture_id UUID NOT NULL UNIQUE REFERENCES lectures(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL,
  period_number SMALLINT NOT NULL,
  frozen_rate_egp INTEGER NOT NULL CHECK (frozen_rate_egp >= 0),
  entitlement_amount_egp INTEGER NOT NULL CHECK (entitlement_amount_egp >= 0),
  status entitlement_status NOT NULL DEFAULT 'pending_review',
  eligibility_reason TEXT NOT NULL,
  anomaly_flag TEXT,
  admin_override_by UUID REFERENCES profiles(id),
  admin_override_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. OPERATIONS, REQUESTS, SURVEYS, AUDIT & BACKUPS
-- -----------------------------------------------------------------------------

-- 9.1 instructor_requests
CREATE TABLE instructor_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  details TEXT NOT NULL,
  status request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.2 notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.3 issues
CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  reported_by UUID NOT NULL REFERENCES profiles(id),
  room_id UUID REFERENCES rooms(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity issue_severity NOT NULL DEFAULT 'medium',
  status issue_status NOT NULL DEFAULT 'open',
  resolved_by UUID REFERENCES profiles(id),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.4 daily_checklists
CREATE TABLE daily_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  camp_day INTEGER NOT NULL,
  task_title_en TEXT NOT NULL,
  task_title_ar TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ
);

-- 9.5 survey_links
CREATE TABLE survey_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.6 survey_results
CREATE TABLE survey_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_link_id UUID NOT NULL REFERENCES survey_links(id) ON DELETE CASCADE,
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL,
  responses_count INTEGER NOT NULL DEFAULT 0,
  average_score NUMERIC(4,2) NOT NULL DEFAULT 0.00,
  summary_note TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.7 instructor_evaluations
CREATE TABLE instructor_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID NOT NULL REFERENCES camps(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  evaluated_by UUID NOT NULL REFERENCES profiles(id),
  punctuality_score SMALLINT NOT NULL CHECK (punctuality_score BETWEEN 1 AND 5),
  delivery_score SMALLINT NOT NULL CHECK (delivery_score BETWEEN 1 AND 5),
  compliance_score SMALLINT NOT NULL CHECK (compliance_score BETWEEN 1 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.8 attachments
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID REFERENCES camps(id) ON DELETE SET NULL,
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_kb INTEGER NOT NULL CHECK (file_size_kb <= 2048),
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.9 audit_logs (Immutable operational and financial audit trail)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9.10 backup_records
CREATE TABLE backup_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id UUID REFERENCES camps(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('full_json_export', 'camp_archive_bundle', 'pre_restore_snapshot')),
  size_kb INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) & SECURE USERNAME RESOLUTION RPC
-- -----------------------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE camps ENABLE ROW LEVEL SECURITY;
ALTER TABLE camp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE camp_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_records ENABLE ROW LEVEL SECURITY;

-- Helper function: Check if current authenticated user is one of the 2 verified Admins
CREATE OR REPLACE FUNCTION is_cits_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN admin_accounts a ON a.profile_id = p.id
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = TRUE
  );
$$;

-- Helper function: Return current instructor.id for authenticated instructor
CREATE OR REPLACE FUNCTION current_instructor_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT i.id FROM instructors i
  WHERE i.profile_id = auth.uid();
$$;

-- Secure RPC: Resolve instructor username to email for sign-in without exposing directory
CREATE OR REPLACE FUNCTION resolve_login_identifier(p_identifier TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email
  FROM profiles
  WHERE (LOWER(username) = LOWER(TRIM(p_identifier)) OR LOWER(email) = LOWER(TRIM(p_identifier)))
    AND is_active = TRUE
  LIMIT 1;
  RETURN v_email;
END;
$$;

-- Admin Full Access + Instructor Isolated Policies
CREATE POLICY "Admins have full access to profiles" ON profiles
  FOR ALL USING (is_cits_admin());

CREATE POLICY "Instructors read own profile only" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Instructors read own instructor record only" ON instructors
  FOR SELECT USING (is_cits_admin() OR profile_id = auth.uid());

CREATE POLICY "Instructors read own lectures only" ON lectures
  FOR SELECT USING (
    is_cits_admin()
    OR instructor_id = current_instructor_id()
    OR substitute_instructor_id = current_instructor_id()
  );

CREATE POLICY "Instructors read/insert own daily checkins" ON daily_checkins
  FOR ALL USING (is_cits_admin() OR instructor_id = current_instructor_id());

CREATE POLICY "Instructors manage own attendance sheets" ON attendance_sheets
  FOR ALL USING (is_cits_admin() OR instructor_id = current_instructor_id());

CREATE POLICY "Instructors view own lecture entitlements" ON lecture_entitlements
  FOR SELECT USING (is_cits_admin() OR instructor_id = current_instructor_id());

CREATE POLICY "Admins only audit logs and backups" ON audit_logs
  FOR ALL USING (is_cits_admin());
