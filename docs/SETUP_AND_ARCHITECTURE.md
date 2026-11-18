# CITS Camp Operations — Setup, Database & Security Architecture (Phase 1 + Phase 2)

## 1. Target Supabase Project

- **Project Name**: `cits-camp-operations`
- **Project Reference**: `wdmlxsgbjkboadkeekdq`
- **Project URL**: `https://wdmlxsgbjkboadkeekdq.supabase.co`

---

## 2. Non-Destructive Migration Audit & Ordering

Both migrations have been audited to guarantee **zero destructive operations** (`0` `DROP TABLE`, `0` `TRUNCATE`, `0` `DELETE FROM`):

1. `supabase/migrations/0001_cits_initial_schema.sql` — Creates the 10 PostgreSQL enums, **29 normalized tables**, core unique constraints, and base triggers.
2. `supabase/migrations/0002_phase2_security_rls_and_validation.sql` — Wrapped in `BEGIN; ... COMMIT;`. Adds `camp_id` to `audit_logs`, `sync_state` (`offline_sync_state`) to `attendance_sheets`, `idx_unique_student_daily_present`, 10 free-tier composite indexes, hardened `SECURITY DEFINER` functions (`SET search_path = public, pg_temp`), concurrency advisory locks (`pg_advisory_xact_lock`), archived camp read-only triggers, schedule conflict & daily group limit triggers, transactional RPCs (`submit_attendance_sheet_tx`, `admin_override_entitlement_tx`), complete **29-table RLS policies**, the private `checkin-selfies` Storage bucket (`300 KB` limit, `image/jpeg` & `image/webp`), and `bootstrap_cits_admin_account()`.
3. `supabase/verification/0003_remote_verification_and_rls_test_suite.sql` — Wrapped in `BEGIN; ... ROLLBACK;` so it executes all schema, trigger, RPC, Storage, and multi-role RLS tests against PostgreSQL and leaves **zero test rows** behind.

---

## 3. Exact Step-by-Step Instructions for Supabase SQL Editor

1. Open the Supabase Dashboard for **`cits-camp-operations`**:
   `https://supabase.com/dashboard/project/wdmlxsgbjkboadkeekdq/sql/new`
2. **Step 1 — Apply Migration 0001**:
   - Copy the full contents of `supabase/migrations/0001_cits_initial_schema.sql`, paste into a new SQL query tab, and click **Run**.
3. **Step 2 — Apply Migration 0002**:
   - Copy the full contents of `supabase/migrations/0002_phase2_security_rls_and_validation.sql`, paste into a new SQL query tab, and click **Run**.
4. **Step 3 — Run Non-Destructive Verification Suite (0003)**:
   - Copy the full contents of `supabase/verification/0003_remote_verification_and_rls_test_suite.sql`, paste into a new SQL query tab, and click **Run**.
   - Check the **Messages / Notices** panel in the SQL Editor to confirm all `[PASS 1/10]` through `[PASS 10a/10]` and `[RLS PASS]` notices succeed before `ROLLBACK;`.

---

## 4. Safe First Admin Bootstrap Procedure

Because public Admin registration is forbidden and `admin_accounts` is protected by RLS (`is_cits_admin()`), the first Admin account (and optional second Admin account) must be bootstrapped once after the Auth user exists:

1. In the Supabase Dashboard, navigate to **Authentication → Users** (`https://supabase.com/dashboard/project/wdmlxsgbjkboadkeekdq/auth/users`) and click **Add user → Create new user** (e.g., `admin1@cits.org` with a strong password and **Auto Confirm User** enabled).
2. Copy the newly created user's **User UID** (UUID).
3. Open the **SQL Editor** (`postgres` role) and run (note the explicit `1::smallint` cast on the 5th parameter):

```sql
SELECT public.bootstrap_cits_admin_account(
  '<PASTE_AUTH_USER_UUID_HERE>'::uuid,
  'tarek.mansour'::text,         -- Admin username (used for username or email sign-in)
  'Eng. Tarek Mansour'::text,    -- English full name
  'م. طارق منصور'::text,         -- Arabic full name
  1::smallint                    -- Assigned Admin Slot (1::smallint or 2::smallint; max 2 allowed)
);
```

*(Note: To verify function existence in PostgreSQL, always query `pg_proc` or `SELECT to_regprocedure('public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)');` rather than `to_regclass`, which only inspects tables/relations.)*

4. Log in through the CITS web application and complete TOTP MFA enrollment.

---

## 5. Private Storage Bucket Configuration (`checkin-selfies`)

Configured automatically by Section 10 of `0002_phase2_security_rls_and_validation.sql`:

- **Bucket ID**: `checkin-selfies`
- **Public Access**: `FALSE` (strictly private)
- **File Size Limit**: `307200` bytes (`300 KB`)
- **Allowed MIME Types**: `['image/jpeg', 'image/webp']`
- **Storage RLS (`storage.objects`)**:
  - Admins (`public.is_cits_admin()`): Full access (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) for verification and post-archive selfie purge.
  - Instructors (`public.current_instructor_id() IS NOT NULL`): `INSERT` and `SELECT` restricted to their own UID folder prefix `(storage.foldername(name))[1] = auth.uid()::text`.
  - Anonymous (`anon`): Denied.

---

## 6. Environment Variable Rules & Connection Modes

Configure public client variables in `.env` (or AI Studio Secrets):

```env
VITE_SUPABASE_URL="https://wdmlxsgbjkboadkeekdq.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-public-anon-or-sb_publishable-key>"
```

- **Strict Secret Guard (`validateSupabaseEnvConfig`)**:
  - Rejects any key starting with `sb_secret_` or containing a `service_role` JWT payload.
- **Fallback Sandbox Mode**:
  - When `VITE_SUPABASE_ANON_KEY` is not yet provided in `.env`, the app remains operational in **Local Operational Sandbox Mode** and clearly displays that the remote Supabase connection is pending the public anon key.
