# CITS Camp Operations — Setup, Database & Security Architecture (Phase 1 + Phase 2 Finalization)

## 1. Target Supabase Project

- **Project Name**: `cits-camp-operations`
- **Project Reference**: `wdmlxsgbjkboadkeekdq`
- **Project URL**: `https://wdmlxsgbjkboadkeekdq.supabase.co`

---

## 2. Non-Destructive Migration Audit & Ordering

All migrations have been audited to guarantee **zero destructive table operations** (`0` `DROP TABLE`, `0` `TRUNCATE`, `0` `DELETE FROM`):

1. `supabase/migrations/0001_cits_initial_schema.sql` — Creates the 10 PostgreSQL enums, **29 normalized tables**, core unique constraints, and base triggers.
2. `supabase/migrations/0002_phase2_security_rls_and_validation.sql` — Wrapped in `BEGIN; ... COMMIT;`. Adds `camp_id` to `audit_logs`, `sync_state` (`offline_sync_state`) to `attendance_sheets`, `idx_unique_student_daily_present`, 10 free-tier composite indexes, hardened `SECURITY DEFINER` functions (`SET search_path = public, pg_temp`), concurrency advisory locks (`pg_advisory_xact_lock`), archived camp read-only triggers, schedule conflict & daily group limit triggers, transactional RPCs (`submit_attendance_sheet_tx`, `admin_override_entitlement_tx`), complete **29-table RLS policies**, private `checkin-selfies` Storage bucket (`300 KB` limit, `image/jpeg` & `image/webp`), and `bootstrap_cits_admin_account()`.
3. `supabase/migrations/0003_fix_archived_camp_child_trigger.sql` — Fixes archived-camp child trigger handling. *(Already applied on remote; never edit applied migrations.)*
4. `supabase/migrations/0004_phase2_comprehensive_security_hardening.sql` — Wrapped in `BEGIN; ... COMMIT;`. Upgrades `is_cits_admin()` to enforce `aal2` MFA assurance at DB/RLS level (while permitting own-row `admin_accounts` lookup at `aal1` pre-challenge), adds `is_lecture_active_instructor()` for substitute-instructor attendance workflows, adds `haversine_distance_meters` & `resolve_student_group_for_day`, instructor lecture update restrictions (`enforce_lecture_update_security`), attendance sheet/record server-field immutability & historical transfer resolution (`enforce_attendance_sheet_security`, upgraded `submit_attendance_sheet_tx`), anti-spoofing check-in & exception triggers, notification & audit log guards, archived read-only triggers across 13 child tables, DB selfie purge on archive (`archive_camp_tx`), and transactional RPCs. *(Already applied on remote; never edit applied migrations.)*
5. `supabase/migrations/0005_phase2_finalization_hardening.sql` — Wrapped in `BEGIN; ... COMMIT;`. Adds `0001`–`0004` baseline preflight assertions; creates `is_active_cits_user()` and tightens RLS + `complete_password_change_tx` + `enforce_profile_security` + `enforce_notification_update_security` + `enforce_audit_log_integrity` so deactivated accounts are blocked everywhere; tightens `issues` and `attachments` camp-scoped RLS and `storage.objects` (`checkin-selfies`) 2-folder UUID anti-traversal scoping; prevents `smart_update` batch import from silently overwriting `group_id` across groups (preserving `student_transfers` history); automatically clears `instructor_acknowledged_at` when schedule-affecting lecture fields change; blocks attendance submission on cancelled lectures & syncs `instructor_id` on substitute entitlement upsert; introduces `admin_correct_attendance_tx(uuid, uuid, attendance_mark, text)` for AAL2 post-submission/locked attendance corrections; enforces finite WGS84 latitude `[-90,90]`, longitude `[-180,180]`, and GPS accuracy `[0,500]` on check-ins; enforces single pending exception (`idx_unique_pending_checkin_exception`); and adds `enforce_instructor_request_security`, `enforce_issue_security`, and `trg_readonly_archived_attachments`.

### Verification Suites (`BEGIN; ... ROLLBACK;`)

1. `supabase/verification/0005_security_inventory_and_preflight.sql` — Read-only PostgreSQL catalog audit (29 tables, `pg_proc` search paths & grants, triggers, RLS policies, active camp/admin slot check).
2. `supabase/verification/0003_remote_verification_and_rls_test_suite.sql` — Guard 1C PL/pgSQL lexical scanner + allowlist call-graph audit + 10-step functional/RLS verification (updated to include `0005` functions without altering any assertions).
3. `supabase/verification/0004_phase2_hardening_verification.sql` — Negative & positive verification tests `H1`–`H8` for migration `0004`.
4. `supabase/verification/0005_finalization_behavioral_test_suite.sql` — 30-case `BEGIN; ... ROLLBACK;` suite covering inactive user lockouts, AAL1/AAL2 MFA gates, 3+ chained & same-day historical transfers, `smart_update` group-lock, cancelled lecture blocking, schedule acknowledgment reset, `NaN`/`Infinity`/out-of-bounds/`>500m` GPS rejections, selfie traversal rejection, duplicate pending exception block, `cits.trusted_rpc` spoofing guard, substitute entitlement assignment, and `admin_correct_attendance_tx` on `submitted` and `locked` sheets.

---

## 3. Staging Deployment & Verification Runbook

Never apply unverified migrations directly to production. Execute in staging first via Supabase SQL Editor or GitHub Actions workflow `.github/workflows/supabase-staging-verify.yml`:

1. **Read-Only Preflight Inventory**:
   Run `supabase/verification/0005_security_inventory_and_preflight.sql` on staging and inspect active camp count, `admin_accounts` count (`<= 2`), and pre-existing objects.
2. **Apply Migration 0005**:
   Copy `supabase/migrations/0005_phase2_finalization_hardening.sql` into SQL Editor (or run `psql -v ON_ERROR_STOP=1 -f supabase/migrations/0005_phase2_finalization_hardening.sql`).
3. **Run All Verification Suites (Transactional `ROLLBACK`)**:
   - `supabase/verification/0003_remote_verification_and_rls_test_suite.sql` → Confirm `[PASS 1/10]` through `[PASS 10a/10]` and zero `FAIL` / `UNPROVEN`.
   - `supabase/verification/0004_phase2_hardening_verification.sql` → Confirm `H1`–`H8` return `PASS`.
   - `supabase/verification/0005_finalization_behavioral_test_suite.sql` → Confirm checks `1`–`30` return `PASS` (or explicitly documented `BLOCKED` if running against an environment with 2 production `admin_accounts` or a live active camp).

---

## 4. Test Account Matrix, 2-Admin Cap & MFA / TOTP Recovery

| Role | Max Capacity | Creation Path | First Login Requirement | RLS / Auth Gate |
|---|---|---|---|---|
| **Admin** | Hard-capped at **2** (`admin_accounts` + `profiles.role = 'admin'`) | Supabase Auth user + `bootstrap_cits_admin_account(uuid, username, name_en, name_ar, slot::smallint)` | TOTP MFA enrollment + AAL2 challenge (`record_admin_totp_verified_tx`) | `is_cits_admin()` requires `is_active = TRUE` AND `auth.jwt() ->> 'aal' = 'aal2'` |
| **Instructor** | Unlimited | Pre-provisioned Auth user + `profiles` + `instructors` | Mandatory password rotation (`complete_password_change_tx`) | Scoped via `current_instructor_id()`, `is_instructor_assigned_to_camp()`, and `is_lecture_active_instructor()` |

### Admin Slot Bootstrap Example

```sql
SELECT public.bootstrap_cits_admin_account(
  '<PASTE_AUTH_USER_UUID_HERE>'::uuid,
  'tarek.mansour'::text,
  'Eng. Tarek Mansour'::text,
  'م. طارق منصور'::text,
  1::smallint
);
```

### MFA / TOTP Recovery & Locked Admin Procedure

1. If an Admin loses their authenticator device, **do not bypass `is_cits_admin()`**.
2. A Supabase project owner (or the surviving Slot 1/2 Admin via Supabase Auth Dashboard) navigates to **Authentication → Users → Target Admin User → MFA Factors**, revokes the lost `totp` factor, and sets `admin_accounts.totp_enrolled = FALSE, totp_verified_at = NULL`.
3. On next login, the Admin completes fresh TOTP enrollment (`enrollAdminTotp` + `verifyAdminTotpChallenge`), raising the JWT to `aal2` and calling `record_admin_totp_verified_tx()` to re-record enrollment safely.
4. To replace one of the two Admin slots permanently, remove the outgoing `admin_accounts` row (keeping historical `audit_logs` intact) and deactivate `profiles.is_active = FALSE` before bootstrapping the replacement slot.

---

## 5. Private Storage Bucket (`checkin-selfies`) & Security Limitations

- **Bucket**: `checkin-selfies` (`public = FALSE`, `300 KB` limit, MIME `['image/jpeg', 'image/webp']`).
- **Storage RLS (`storage.objects`)**:
  - Admins (`is_cits_admin()`): Full access for review and post-archive purge (`archive_camp_tx`).
  - Instructors (`current_instructor_id() IS NOT NULL`): Restricted to `<auth.uid()>/<camp_uuid>/<file.(webp|jpg|jpeg)>`, blocking `..`, `//`, spaces, and path traversal.

### Honest Security & Threat Model Limitations (Defense-in-Depth Notes)

- **Client-Supplied GPS Coordinates**: Browser `navigator.geolocation` coordinates originate on the instructor's device; a rooted device or mock-GPS extension can spoof `latitude`/`longitude`. PostgreSQL enforces finite WGS84 bounds (`[-90, 90]`, `[-180, 180]`), `0..500m` accuracy, server `NOW()` timestamps, server Haversine calculation, selfie JPEG/WebP capture stored privately in `checkin-selfies`, and manual Admin exception audit review to deter and detect spoofing.
- **Offline Draft Storage**: Unsynced instructor attendance drafts queued locally (`OfflineSyncState.QUEUED` / `FAILED`) reside in browser storage until connectivity resumes. All final submissions run through `submit_attendance_sheet_tx` under server-authoritative triggers, `is_lecture_active_instructor()`, duplicate attendance indexes (`idx_unique_student_daily_present`), and immutable post-submission locking.

---

## 6. Non-Destructive Rollback Plan (Migration 0005)

If migration `0005` causes an unexpected issue in staging, revert without dropping tables or losing rows:

1. Drop triggers & new functions added in `0005`:
   ```sql
   DROP TRIGGER IF EXISTS trg_readonly_archived_attachments ON attachments;
   DROP TRIGGER IF EXISTS trg_enforce_issue_security ON issues;
   DROP TRIGGER IF EXISTS trg_enforce_instructor_request_security ON instructor_requests;
   DROP INDEX IF EXISTS idx_unique_pending_checkin_exception;
   DROP FUNCTION IF EXISTS admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT);
   DROP FUNCTION IF EXISTS enforce_issue_security();
   DROP FUNCTION IF EXISTS enforce_instructor_request_security();
   DROP FUNCTION IF EXISTS is_active_cits_user();
   ```
2. Re-apply `0004` policy/function definitions if restoring `0004` behavior on shared functions (`complete_password_change_tx`, `enforce_profile_security`, `submit_attendance_sheet_tx`, `submit_daily_checkin_tx`, `batch_import_students_tx`, `validate_lecture_schedule_rules`, `enforce_audit_log_integrity`).

---

## 7. Environment Variable Rules & Connection Modes

```env
VITE_SUPABASE_URL="https://wdmlxsgbjkboadkeekdq.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-public-anon-or-sb_publishable-key>"
```

- `validateSupabaseEnvConfig` strictly rejects `sb_secret_` keys or JWTs containing `service_role`.
- Without `VITE_SUPABASE_ANON_KEY`, the UI runs in **Local Operational Sandbox Mode** for offline layout, business-rule, and QA inspection.

---

## 8. Production Migration Procedure (Manual Approval Required)

1. Never execute staging verification scripts or unapproved migrations against production (`wdmlxsgbjkboadkeekdq`). `.github/workflows/supabase-staging-verify.yml` explicitly aborts if `SUPABASE_STAGING_DB_URL` references `wdmlxsgbjkboadkeekdq`.
2. **Preconditions before Production Apply**:
   - `CITS Web CI` (`bun install --frozen-lockfile`, `bun run lint`, `bun test src/domain/businessRules.test.ts`, `bun run build`) is green on `main`.
   - `Supabase Staging Security & Verification` succeeded cleanly against staging with `0` `FAIL` rows across `0003`, `0004`, and `0005`.
   - Fresh pre-migration database backup / Point-in-Time Recovery (PITR) checkpoint confirmed in Supabase Dashboard.
   - Explicit release owner / Admin approval recorded.
3. Run `supabase/verification/0005_security_inventory_and_preflight.sql`, apply `supabase/migrations/0005_phase2_finalization_hardening.sql`, and verify with read-only inventory & transactional `ROLLBACK` suites during the maintenance window.

---

## 9. Phase 2 Verification Status Ledger

| Scope | Verification Method | Status | Notes |
|---|---|---|---|
| TypeScript & Vite Production Build | `bun install --frozen-lockfile && bun run lint && bun run build` | Executed & CI green (`d0e4858`) | Re-verified locally on closure branch |
| Domain, RLS Model, & Guard 1C Lexical Tests | `bun test src/domain/businessRules.test.ts` | Executed & CI green | Covers all 38+ SQL trigger/helper bodies across `0001`–`0005` |
| UI Accessibility, Desktop/Mobile Layouts & Console | Headless Chromium (`playwright-cli`) at `1440x900` & `390x844` | Executed locally (Sandbox Mode) | Admin Portal, Architecture Drawer, Attendance Correction, Instructor Check-in |
| Remote Supabase Staging Execution (`0005` + `0003`/`0004`/`0005`) | `.github/workflows/supabase-staging-verify.yml` / Staging SQL Editor | **BLOCKED (Staging DB credentials absent in sandbox)** | Requires `SUPABASE_STAGING_DB_URL` secret or manual staging SQL Editor execution |

---

## 10. Phase 3 — Secure Account Provisioning & Authentication Integration

### 10.1 Schema & Migration Statement

Phase 3 requires **zero new database migrations** and **zero modifications to existing migrations (`0001`–`0005`)**. All required tables, columns, triggers, and RPCs already exist in the audited schema:

- `profiles` (`id = auth.users.id`, `role`, `username`, `email`, `full_name_en`, `full_name_ar`, `phone`, `must_change_password`, `is_active`)
- `admin_accounts` (`profile_id`, `assigned_slot IN (1, 2)`, `totp_enrolled`, `totp_verified_at`, hard-capped at 2 admins via `enforce_max_two_admins()`)
- `instructors` (`profile_id`, `instructor_code`, `specialization`, `default_lecture_rate_egp`, `bio`)
- `camp_instructors` (`camp_id`, `instructor_id`)
- `bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT)` (revoked from `PUBLIC`, `anon`, and `authenticated`; executable only by privileged SQL/service role)
- `resolve_login_identifier(TEXT)` (returns email only when `profiles.is_active = TRUE`)
- `complete_password_change_tx()` & `record_admin_totp_verified_tx()`
- `is_cits_admin()` (enforces `profiles.is_active = TRUE` AND `auth.jwt() ->> 'aal' = 'aal2'`)

---

### 10.2 Phase 3.1 — Secure Admin Account Bootstrap Procedure (Max 2 Slots)

Admin accounts are **never** self-registered and cannot be created from the browser frontend.

1. In **Supabase Dashboard → Authentication → Users**, click **Add user → Create new user**:
   - Enter the Admin's official email and a strong initial password (confirm email).
   - Copy the generated **User UID** (`auth.users.id`).
2. Open **Supabase Dashboard → SQL Editor** (runs with privileged `postgres` / service role) and execute:
   ```sql
   SELECT public.bootstrap_cits_admin_account(
     '<AUTH_USER_UUID>'::uuid,
     'tarek.mansour',
     'Eng. Tarek Mansour',
     'م. طارق منصور',
     1::smallint -- Slot 1 or Slot 2 only; 3rd admin is rejected by DB trigger
   );
   ```
3. Verify the link:
   ```sql
   SELECT p.id, p.username, p.email, p.role, p.is_active, a.assigned_slot, a.totp_enrolled
   FROM public.profiles p
   JOIN public.admin_accounts a ON a.profile_id = p.id
   ORDER BY a.assigned_slot;
   ```
4. On first login at the CITS Portal, the Admin signs in with their email or username, completes mandatory **TOTP Authenticator App Enrollment** (QR code + 6-digit code), upgrades their session to **AAL2**, and unlocks the Admin Dashboard.

---

### 10.3 Phase 3.2 — Deploying the `provision-instructor` Edge Function

Instructor provisioning runs exclusively inside the server-side Supabase Edge Function `supabase/functions/provision-instructor/index.ts`. The browser never holds `SUPABASE_SERVICE_ROLE_KEY`.

#### Required Secrets (Server-Side Only — Never in Frontend `.env`)

| Variable | Location | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend `.env` / Hosting (Vercel) | Public project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` / Hosting (Vercel) | Public anon / publishable key (RLS enforced) |
| `SUPABASE_URL` | Supabase Edge Function Secret (auto-injected) | Project URL inside Deno runtime |
| `SUPABASE_ANON_KEY` | Supabase Edge Function Secret (auto-injected) | Used to verify caller JWT via `auth.getUser(token)` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function Secret (auto-injected) | Used strictly server-side for `auth.admin.inviteUserByEmail` / `auth.admin.createUser` and atomic rollback |
| `ALLOWED_ORIGINS` *(optional)* | Supabase Edge Function Secret | Comma-separated origin allowlist (e.g. `https://your-domain.vercel.app`) |

#### Deploy Command (Supabase CLI)

```bash
supabase login
supabase link --project-ref wdmlxsgbjkboadkeekdq
supabase functions deploy provision-instructor --no-verify-jwt=false
```

*(Note: The function itself also explicitly validates `Authorization: Bearer <jwt>` via `userClient.auth.getUser(token)`, verifies `aal === 'aal2'`, verifies `profiles.role = 'admin' AND is_active = true`, and confirms the caller holds `admin_accounts.assigned_slot IN (1, 2)`.)*

#### Compensating Rollback Guarantee

If any step fails after `auth.users` creation (profile insert, instructor insert, or camp assignment), the Edge Function executes compensating deletes in reverse order (`camp_instructors` → `instructors` → `profiles` → `auth.admin.deleteUser(createdAuthUserId)`) so partial or orphan accounts are never left behind.

---

### 10.4 Instructor Onboarding Workflows

Admins manage instructors from **Admin Dashboard → Instructors → Provision Instructor**:

1. **Invite Email Flow (`invite_email` — Recommended)**:
   - Edge Function calls `auth.admin.inviteUserByEmail(email)` and inserts `profiles` (`role = 'instructor'`, `must_change_password = true`) + `instructors` + optional `camp_instructors`.
   - Instructor receives the Supabase invite email, sets their password, and signs in.
2. **One-Time Temporary Password Flow (`temporary_password`)**:
   - Edge Function generates a cryptographically strong 16-character password (or validates an admin-supplied strong password), calls `auth.admin.createUser({ email, password, email_confirm: true })`, and sets `profiles.must_change_password = true`.
   - The temporary password is returned **once** with `Cache-Control: no-store`, displayed in a dismissible Admin handoff banner, and **never** logged or stored in plaintext.
   - On first login, the instructor is locked to the **Mandatory First-Login Password Change** gate (`complete_password_change_tx()`) and cannot access the Instructor Dashboard until they rotate their password.

---

### 10.5 Account Lifecycle, Deactivation & Troubleshooting

- **Deactivation (`profiles.is_active = FALSE`)**: Use **Deactivate** in Admin → Instructors (never delete instructor accounts). Deactivated users are immediately blocked by `resolve_login_identifier()`, `is_active_cits_user()`, RLS policies, and `loadAuthenticatedUserContext()`, while historical lectures, attendance sheets, and financial payouts remain preserved.
- **Password Reset / Recovery**: Use **Reset** on any instructor row to dispatch a Supabase recovery email (`auth.resetPasswordForEmail`).
- **Local Development Sandbox Selector**: Strictly restricted to `import.meta.env.DEV && !isSupabaseMode`. In production builds (`vite build`) or whenever `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are configured, the sandbox selector is completely omitted.
- **Common Troubleshooting**:
  - `403 Administrator MFA (AAL2) verification is required`: Admin session is at `aal1`; sign out and complete TOTP verification.
  - `409 An account with this email/username/code already exists`: Duplicate identity prevented before Auth creation; verify existing accounts (including disabled ones).
  - `Auth user exists without matching profile`: Verify `profiles.id === auth.users.id` in SQL Editor; never create instructors directly in Supabase Auth Dashboard without linked `profiles` and `instructors` rows.

