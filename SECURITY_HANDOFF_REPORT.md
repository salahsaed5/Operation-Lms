# OPERATION LMS — SECURITY HANDOFF REPORT

---

## 1. EXECUTIVE SUMMARY

- **Audit Target:** Operation LMS (CITS Camp Operations LMS) — Authentication, Forced Initial Password Change (`profiles.must_change_password`), PostgreSQL RPCs, Row Level Security (RLS), and Frontend Auth Lifecycle.
- **Overall Security Posture (Pre-Remediation):** **VULNERABLE (2 Critical, 2 Medium confirmed findings).** The forced password change flow could be bypassed completely via a direct RPC call to `complete_password_change_tx()` without changing the user's password in Supabase Auth, and `profiles.must_change_password = TRUE` was enforced only in client-side React routing with zero server-side RLS or operational RPC enforcement.
- **Overall Security Posture (Post-Remediation — Local Code & Migration 0007):** **SIGNIFICANTLY HARDENED (STAGING READY).** A new forward-only migration (`0007_enforce_forced_password_change_security.sql`) closes both Critical bypass vectors (SEC-001, SEC-002) and the Medium deactivated-instructor read leak (SEC-003) at the PostgreSQL layer, backed by an 18-check non-destructive SQL verification suite, defense-in-depth React route guards, and 57/57 passing local unit/security tests.
- **Production Status:** **NOT READY FOR IMMEDIATE PRODUCTION USE** until Migrations `0006` and `0007` are applied and verified against Staging/Production Supabase (`wdmlxsgbjkboadkeekdq`) and the updated `provision-instructor` Edge Function is deployed. No remote database changes or production deployments were performed during this audit.

---

## 2. SCOPE OF AUDIT

### Components Audited
- **Database Schema & Migrations:**
  - `supabase/migrations/0001_cits_initial_schema.sql`
  - `supabase/migrations/0002_phase2_security_rls_and_validation.sql`
  - `supabase/migrations/0003_fix_archived_camp_child_trigger.sql`
  - `supabase/migrations/0004_phase2_comprehensive_security_hardening.sql`
  - `supabase/migrations/0005_phase2_finalization_hardening.sql`
  - `supabase/migrations/0006_fix_initial_password_change_audit.sql`
  - All 29 `public` tables, `storage.objects` (`checkin-selfies` bucket), and all `SECURITY DEFINER` / trigger functions.
- **RPC Functions Audited:**
  - `complete_password_change_tx()`
  - `resolve_login_identifier(TEXT)`
  - `record_admin_totp_verified_tx()`
  - `bootstrap_cits_admin_account(...)`
  - `is_active_cits_user()`, `is_cits_admin()`, `current_instructor_id()`
  - Operational RPCs: `submit_daily_checkin_tx`, `submit_attendance_sheet_tx`, `acknowledge_lecture_tx`, `admin_correct_attendance_tx`, `admin_override_entitlement_tx`, `transfer_student_tx`, `batch_import_students_tx`, `review_checkin_exception_tx`, `archive_camp_tx`.
- **Edge Functions & Frontend Auth Lifecycle:**
  - `supabase/functions/provision-instructor/index.ts`
  - `src/services/citsRepository.ts`
  - `src/context/AppContext.tsx`
  - `src/pages/auth/AuthView.tsx`
  - `src/App.tsx`
  - `src/domain/accountProvisioning.ts`
- **Verification & Test Suites Audited:**
  - `supabase/verification/0003_remote_verification_and_rls_test_suite.sql` (including Pre-Flight Guard 1A/1B/1C)
  - `supabase/verification/0005_finalization_behavioral_test_suite.sql`
  - `supabase/verification/0006_verify_initial_password_change_audit.sql`
  - `src/domain/businessRules.test.ts` & `src/domain/accountProvisioning.test.ts`

### Explicitly Out of Scope / Untouched
- Production Supabase (`wdmlxsgbjkboadkeekdq`) was **not** connected to, queried, migrated, or modified.
- Prior migrations `0001`–`0006` were **not** modified.
- No Edge Functions were deployed and no GitHub commits/pushes were executed.

---

## 3. CONFIRMED VULNERABILITIES & SECURITY FINDINGS

### Finding SEC-001 — Direct RPC Bypass of Forced Password Change (`complete_password_change_tx`)
- **Severity:** **CRITICAL**
- **Status:** **FIXED (Local Migration `0007` — Pending Remote Application)**
- **Location:** `supabase/migrations/0004` (lines 1625–1656), `0005` (lines 60–96), `0006` (lines 26–70).
- **Root Cause:** `public.complete_password_change_tx()` checked only `auth.uid()` and `is_active_cits_user()`, then unconditionally set `public.profiles.must_change_password = FALSE` and wrote a `PASSWORD_CHANGE_COMPLETED` audit row without verifying that `auth.users.encrypted_password` had actually changed or was even populated.
- **Exploit Scenario:** Any newly provisioned user with `must_change_password = TRUE` (either via temporary password or email invite) signs in, extracts their valid Supabase JWT from browser storage, and sends `POST /rest/v1/rpc/complete_password_change_tx` directly. The database clears `must_change_password = FALSE` and logs a forged `PASSWORD_CHANGE_COMPLETED` compliance event while the user keeps the temporary/unset password.
- **Evidence:** Directly verified in `supabase/migrations/0006_fix_initial_password_change_audit.sql` lines 36–68 (zero query against `auth.users` or credential state).
- **Remediation Applied:**
  - Created private schema `cits_internal` and table `cits_internal.credential_rotation_baselines` (`REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; RLS enabled with zero client policies).
  - Added `SECURITY DEFINER` trigger `public.capture_credential_rotation_baseline()` on `public.profiles` (`AFTER INSERT OR UPDATE OF must_change_password`) that records a one-way SHA-256 hex fingerprint (`encode(sha256(convert_to(COALESCE(encrypted_password, ''), 'UTF8')), 'hex')`) whenever a profile is created or flagged `must_change_password = TRUE`.
  - Hardened `public.complete_password_change_tx()` to verify `char_length(auth.users.encrypted_password) >= 20` AND require `current_fingerprint <> baseline_auth_fingerprint` before clearing `must_change_password = FALSE`.
  - Made repeated calls when `must_change_password = FALSE` idempotent (`already_completed = TRUE`, zero duplicate audit rows) while still cleanly auditing genuine password recovery rotations.

### Finding SEC-002 — Forced Password Change Enforced Only Client-Side (No Server-Side RLS / RPC Gate)
- **Severity:** **CRITICAL**
- **Status:** **FIXED (Local Migration `0007` — Pending Remote Application)**
- **Location:**
  - `public.current_instructor_id()` (`0002` lines 77–91) — omitted `AND p.must_change_password = FALSE`.
  - `public.is_cits_admin()` (`0004` lines 18–34) — omitted `AND p.must_change_password = FALSE`.
  - Operational RLS policies & triggers on `profiles` (UPDATE), `notifications` (SELECT/UPDATE), `attachments` (SELECT/INSERT), `audit_logs` (INSERT) — relied on `is_active_cits_user()` instead of requiring completed onboarding.
- **Exploit Scenario:** An instructor with `must_change_password = TRUE` ignores the forced password change screen and uses their authenticated Supabase JWT directly against PostgREST (`/rest/v1/students`, `/rest/v1/camps`, `/rest/v1/lectures`, `/rest/v1/rpc/submit_daily_checkin_tx`, `/rest/v1/rpc/submit_attendance_sheet_tx`, `/rest/v1/rpc/acknowledge_lecture_tx`, and `storage.objects`). Because `current_instructor_id()` returned their instructor UUID while `must_change_password = TRUE`, the attacker had full operational read/write access without ever rotating their initial password.
- **Evidence:** Directly verified in `0002` lines 77–91, `0004` lines 18–34, and `0005` lines 103–235, 493–534.
- **Remediation Applied:**
  - Added `public.is_cits_operational_user()` requiring `is_active = TRUE AND must_change_password = FALSE`.
  - Upgraded `public.current_instructor_id()` and `public.is_cits_admin()` to require `AND p.must_change_password = FALSE`, immediately locking down all operational RLS policies across all 29 tables, `storage.objects` (`checkin-selfies`), and all operational RPCs.
  - Preserved minimal bootstrap `SELECT` on own `profiles`, `instructors`, and `admin_accounts` (via `is_active_cits_user()`) and updated `record_admin_totp_verified_tx()` so active AAL2 Admins with a verified `auth.mfa_factors` TOTP factor can complete MFA before password change without deadlock.
  - Tightened `profiles` UPDATE + `enforce_profile_security()`, `notifications` SELECT/UPDATE + `enforce_notification_update_security()`, `attachments` SELECT/INSERT, and `audit_logs` INSERT + `enforce_audit_log_integrity()` to require `is_cits_operational_user()`.
  - Added defense-in-depth client guards in `src/App.tsx` (`AppRouter`) and `src/pages/auth/AuthView.tsx`.

### Finding SEC-003 — Deactivated Instructor Can Still `SELECT` Own `public.instructors` Record
- **Severity:** **MEDIUM**
- **Status:** **FIXED (Local Migration `0007` — Pending Remote Application)**
- **Location:** `supabase/migrations/0002_phase2_security_rls_and_validation.sql` lines 973–974 (`"Instructors read own instructor record only"`).
- **Root Cause:** Policy predicate was `USING (profile_id = auth.uid())` without `AND is_active_cits_user()`, unlike `profiles` and `admin_accounts` which were tightened in Migration `0005`.
- **Exploit Scenario:** A deactivated instructor holding an unrevoked JWT could still query `GET /rest/v1/instructors` and read their own instructor row (`default_lecture_rate_egp`, `instructor_code`, `specialization`, `bio`).
- **Remediation Applied:** Replaced policy in Migration `0007` with `USING (profile_id = auth.uid() AND is_active_cits_user())`.

### Finding SEC-004 — `resolve_login_identifier(TEXT)` Exposes Active Account Email/Username Enumeration to `anon`
- **Severity:** **MEDIUM**
- **Status:** **OPEN / DOCUMENTED ARCHITECTURAL RISK (Intentional UX Dependency — Deferred Hardening)**
- **Location:** `supabase/migrations/0002_phase2_security_rls_and_validation.sql` lines 97–124 (`GRANT EXECUTE ... TO anon, authenticated`).
- **Root Cause:** Unauthenticated callers can invoke `POST /rest/v1/rpc/resolve_login_identifier` with arbitrary usernames/emails and receive the corresponding active user's email address (or `NULL` if invalid/inactive), acting as an account-existence and username-to-email oracle.
- **Why Not Changed in Migration 0007:** `src/services/citsRepository.ts` (`resolveAndSignInWithSupabase`) currently relies on this RPC to support signing in by either username or email before calling `supabase.auth.signInWithPassword({ email, password })`. Revoking `anon` access without replacing the login flow would break username login immediately.
- **Recommended Fix:** Either transition login to email-only (eliminating the RPC for `anon`) OR move username-to-email + password authentication behind a rate-limited server-side Edge Function that returns a single uniform `"Invalid credentials"` error regardless of whether the identifier exists or is inactive.

### Verified Non-Vulnerabilities / Controls Confirmed Effective
- **Direct client `UPDATE public.profiles SET must_change_password = FALSE`:** Already blocked by `enforce_profile_security()` in Migration `0005` (and now additionally blocked by the `is_cits_operational_user()` RLS policy in `0007`).
- **`audit_logs` immutability & secret leakage protection:** Already enforced by `enforce_audit_log_integrity()` (`0005` + `0007`) blocking UPDATE/DELETE, blocking sensitive substrings (`password`, `service_role`, `totp_secret`, etc.), and blocking instructors from forging reserved actions (extended in `0007` to also reserve `INSTRUCTOR_ACCOUNT_PROVISIONED`).
- **Admin MFA (AAL2) enforcement:** Already enforced server-side in `is_cits_admin()` (`auth.jwt() ->> 'aal' = 'aal2'`), `record_admin_totp_verified_tx()` (`auth.mfa_factors` verified TOTP check), and `provision-instructor` Edge Function (`jwtAal !== 'aal2'` + `callerProfile.must_change_password` check).
- **`bootstrap_cits_admin_account()` privilege isolation:** Confirmed revoked from `PUBLIC`, `anon`, and `authenticated` (`0002` lines 1517–1519).
- **Local dev sandbox selector:** Strictly gated behind `import.meta.env.DEV && !isSupabaseMode` in `AuthView.tsx` and `AppContext.tsx` (stripped from production builds).

---

## 4. FORCED PASSWORD CHANGE ARCHITECTURE

### End-to-End Enforced Lifecycle (Post-Migration 0007)
1. **Provisioning (`provision-instructor` Edge Function):**
   - Creates Supabase Auth user (with strong CSPRNG temporary password or invite email) and inserts `public.profiles(..., must_change_password = TRUE, is_active = ...)`.
   - `AFTER INSERT` trigger `trg_capture_credential_rotation_baseline` immediately snapshots `SHA256(COALESCE(auth.users.encrypted_password, ''))` into `cits_internal.credential_rotation_baselines`.
2. **Initial Authentication (`must_change_password = TRUE`):**
   - User authenticates via Supabase Auth and receives a valid JWT.
   - `loadAuthenticatedUserContext()` reads ONLY the user's own `profiles` row + own `instructors`/`admin_accounts` row (permitted by `is_active_cits_user()`).
   - **Server-side lock active:** `is_cits_operational_user()` = `FALSE`, `current_instructor_id()` = `NULL`, `is_cits_admin()` = `FALSE`. Every operational table (`camps`, `groups`, `students`, `lectures`, `attendance_*`, `daily_checkins`, `lecture_entitlements`, `notifications`, `attachments`, `issues`, `instructor_requests`, `audit_logs`, `storage.objects`) and every operational RPC returns 0 rows or raises authorization failure.
   - For Admins (if both MFA and forced password change apply): MFA (TOTP enrollment/challenge + `record_admin_totp_verified_tx()`) runs first without deadlock, then forced password change runs before operational access is granted.
3. **Mandatory Password Rotation:**
   - Client calls `supabase.auth.updateUser({ password: newPassword })`. If this fails, `complete_password_change_tx()` is never invoked and `must_change_password` remains `TRUE`.
   - When `auth.updateUser` succeeds, Supabase Auth (`GoTrue`) writes a new bcrypt hash to `auth.users.encrypted_password`.
   - Client calls `supabase.rpc('complete_password_change_tx')`.
   - Server locks `public.profiles` (`FOR UPDATE`), reads `auth.users.encrypted_password`, verifies `char_length >= 20`, computes its SHA-256 fingerprint, and **requires `current_fingerprint <> baseline_auth_fingerprint`**.
   - Only if verified: sets `must_change_password = FALSE`, updates `last_completed_auth_fingerprint`, and logs a single credential-free `PASSWORD_CHANGE_COMPLETED` audit entry (`initial_credential_rotation_required: true -> false`).
4. **Post-Rotation & Subsequent Calls:**
   - Reloading/re-querying now resolves `is_cits_operational_user() = TRUE` and restores role-scoped RLS & RPC access.
   - Re-invoking `complete_password_change_tx()` without a new password change returns `{ ok: true, already_completed: true }` with zero duplicate audit logs.
   - Subsequent genuine password recovery rotations (`PASSWORD_RECOVERY`) change `encrypted_password` again and are cleanly logged as recovery rotations.

### Architectural Limitation (Disclosed Honestly)
- **Same-Password Reuse Within Supabase `auth.updateUser({ password })`:** Because Supabase Auth (`GoTrue`) generates a new random bcrypt salt on every `updateUser({ password })` call, `auth.users.encrypted_password` changes even if a user submits the exact same plaintext temporary password as their "new" password. PostgreSQL `complete_password_change_tx()` intentionally does **not** receive plaintext passwords (which could leak in query logs).
- **Recommended Architectural Enhancement (If Strict Same-Password Reuse Blocking Is Required):** Implement a server-side `rotate-password` Edge Function that accepts `{ currentPassword, newPassword }`, verifies `currentPassword !== newPassword`, re-authenticates the caller with `currentPassword` via Supabase Auth to prove possession, updates the password via `auth.admin.updateUserById`, and invokes `complete_password_change_tx()` atomically.

---

## 5. DATABASE & MIGRATION CHANGES

- **`REMOTE DATABASE MIGRATIONS APPLIED: NO`**
- **Existing Migrations `0001`–`0006` Modified:** **NO** (100% preserved untouched).
- **New Forward-Only Migration Added:**
  - `supabase/migrations/0007_enforce_forced_password_change_security.sql`
    - Creates private internal schema `cits_internal` and table `cits_internal.credential_rotation_baselines` (zero grants to `PUBLIC`/`anon`/`authenticated`; RLS enabled with zero client policies; keeps `public` at the exact 29 tables expected by `0003` verification suite).
    - Backfills existing `public.profiles` rows non-destructively (`ON CONFLICT DO NOTHING`).
    - Adds `public.capture_credential_rotation_baseline()` (`SECURITY DEFINER`, `SET search_path = public, pg_temp`) + trigger `trg_capture_credential_rotation_baseline` on `public.profiles`.
    - Adds `public.is_cits_operational_user()` (`SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`).
    - Updates `public.current_instructor_id()` and `public.is_cits_admin()` to enforce `p.must_change_password = FALSE`.
    - Updates `public.record_admin_totp_verified_tx()` to verify active Admin + `admin_accounts` slot + `aal2` + verified `auth.mfa_factors` directly (preventing onboarding deadlock).
    - Hardens `public.complete_password_change_tx()` to verify Auth credential presence and fingerprint rotation against `cits_internal.credential_rotation_baselines`, with idempotent repeat handling and recovery logging.
    - Tightens RLS policies & triggers on `instructors` (SEC-003), `profiles` (UPDATE + `enforce_profile_security`), `notifications` (SELECT/UPDATE + `enforce_notification_update_security`), `attachments` (SELECT/INSERT), and `audit_logs` (INSERT + `enforce_audit_log_integrity`).
- **Verification Suites Updated / Created:**
  - `supabase/verification/0003_remote_verification_and_rls_test_suite.sql`: registered `capture_credential_rotation_baseline`, `is_cits_operational_user`, and `pg_catalog` built-ins (`encode`, `sha256`, `convert_to`) in Pre-Flight Guard 1A/1B/1C allowlists so `0003` continues to pass cleanly after `0007`.
  - `supabase/verification/0007_verify_forced_password_change_security.sql`: new 18-check non-destructive (`BEGIN; ... ROLLBACK;`) behavioral & metadata verification suite for Staging/Production SQL Editor execution. Note: after applying `0007`, run `0007_verify_forced_password_change_security.sql` (which supersedes `0006_verify_initial_password_change_audit.sql`, because `0006`'s verification script intentionally called `complete_password_change_tx()` without rotating `auth.users.encrypted_password` — a bypass now blocked by `0007`).

---

## 6. APPLICATION / CODE CHANGES

- **`src/App.tsx`:** Hardened `AppRouter` gate to check `!auth.currentProfile.isActive || auth.currentProfile.mustChangePassword` directly in addition to `auth.pendingTotpProfileId || auth.pendingPasswordChangeProfileId`, preventing Admin or Instructor layouts from ever rendering while mandatory rotation is pending or account is inactive.
- **`src/pages/auth/AuthView.tsx`:** Unified Step 1 / Step 3 screen gating via `isPasswordChangeRequired` derived from both `auth.pendingPasswordChangeProfileId` and `auth.currentProfile.isActive && auth.currentProfile.mustChangePassword`, keeping `AuthView` strictly synchronized with `AppRouter`.
- **`src/domain/accountProvisioning.ts`:** Added pure deterministic security evaluators (`evaluateCompletePasswordChangeRpc`, `evaluateServerAuthorizationHelpers`) mirroring Migration `0007`'s server-side verification, idempotency, recovery, inactive-user, cross-user, and Admin-MFA rules.
- **`src/domain/businessRules.test.ts`:** Extended Test 23 (PL/pgSQL Guard 1C lexical & call-graph scanner) to cover migrations `0001..0007`, and added Test 27 verifying Migration `0007`, the 18-check `0007` verification script, and frontend defense-in-depth guards.
- **`src/domain/accountProvisioning.test.ts`:** Added 7 dedicated Migration `0007` security test cases covering direct RPC bypass, invite unset-password bypass, operational RLS/RPC blocking while `must_change_password = TRUE`, legitimate rotation + post-rotation restoration, idempotency + recovery logging, inactive/anon/cross-user isolation, and Admin MFA + onboarding interaction.

---

## 7. SECURITY & FUNCTIONAL TESTS

### Executed Local Checks (All Passed After Final Edits)
| Check | Command / Tool | Result | Notes |
|---|---|---|---|
| Domain & Security Unit Tests | `npx --yes tsx --test src/domain/businessRules.test.ts src/domain/accountProvisioning.test.ts` | **PASS (57/57, 0 failed)** | Includes Guard 1C lexical/call-graph scanner across `0001..0007`, Migration `0007` static security checks, and 7 forced-password-change behavioral security tests. |
| TypeScript Type Check / Lint | `lint_applet` (`tsc --noEmit`) | **PASS (0 errors)** | Executed after final code edits. |
| Production Frontend Build | `compile_applet` (`npm run build`) | **PASS** | Clean Vite production bundle with zero warnings/errors. |
| Hardcoded Secret Scan | `grep -rnE ... src/ supabase/` | **PASS (Clean)** | Zero hardcoded JWTs, `sbp_` tokens, or `SUPABASE_SERVICE_ROLE_KEY` assignments; matches only intentional security regexes/guard checks. |

### Not Executed (Requires Authorized Live Staging / Production Database)
- Live PostgreSQL execution of `supabase/verification/0007_verify_forced_password_change_security.sql` (18 checks), `0003_remote_verification_and_rls_test_suite.sql`, and `0005_finalization_behavioral_test_suite.sql`.
- Live end-to-end browser + PostgREST/Supabase Auth testing of forced password change, direct RPC bypass rejection, Admin MFA, and Edge Function provisioning against Staging.

---

## 8. GIT & REPOSITORY STATE

- **Remote Repository Observed:** `https://github.com/salahsaed5/Operation-Lms.git` (`refs/heads/main` HEAD observed at `fb18c9840fccc9de9555c3012139925d0fa2f020` via `git ls-remote`).
- **Local Git Metadata:** The sandbox workspace (`/app/applet`) does **not** contain a `.git` directory; therefore no local git commit or `git push` was created or executed.
- **Files Created in Local Workspace:**
  - `supabase/migrations/0007_enforce_forced_password_change_security.sql`
  - `supabase/verification/0007_verify_forced_password_change_security.sql`
  - `SECURITY_HANDOFF_REPORT.md`
- **Files Modified in Local Workspace:**
  - `supabase/verification/0003_remote_verification_and_rls_test_suite.sql`
  - `src/App.tsx`
  - `src/pages/auth/AuthView.tsx`
  - `src/domain/accountProvisioning.ts`
  - `src/domain/businessRules.test.ts`
  - `src/domain/accountProvisioning.test.ts`
- **Prior Unpushed Local Phase 3 Remediation Files Still Present:** `supabase/migrations/0006_fix_initial_password_change_audit.sql`, `supabase/verification/0006_verify_initial_password_change_audit.sql`, and hardened `supabase/functions/provision-instructor/index.ts`.

---

## 9. REMAINING RISKS & KNOWN LIMITATIONS

1. **Migrations `0006` and `0007` Not Yet Applied Remotely:** Production Supabase (`wdmlxsgbjkboadkeekdq`) remains vulnerable to SEC-001, SEC-002, SEC-003, and the `0005` audit-trigger password-change conflict until `0006` and `0007` are applied remotely.
2. **Same-Password Reuse Limitation (Supabase GoTrue Re-Salting):** As documented in Section 4, verifying `auth.users.encrypted_password` fingerprint change proves `supabase.auth.updateUser({ password })` ran server-side, but cannot distinguish whether the user re-submitted their original temporary password plaintext. Closing same-password reuse requires a dedicated server-side password-rotation Edge Function.
3. **`resolve_login_identifier(TEXT)` Enumeration Risk (SEC-004):** Unauthenticated callers can still enumerate active account usernames/emails via `POST /rest/v1/rpc/resolve_login_identifier`. Recommend replacing with email-only login or a rate-limited server-side login Edge Function.
4. **Edge Function Deployment & Secret Configuration:** `supabase/functions/provision-instructor/index.ts` must be deployed with `ALLOWED_ORIGINS=https://operation-lms.vercel.app` (and staging origin if applicable) and verified live.
5. **Existing Users Provisioned Before `0007`:** Migration `0007` automatically backfills `cits_internal.credential_rotation_baselines` for all existing `public.profiles` rows upon execution, so any existing pending user with `must_change_password = TRUE` is protected immediately upon migration deployment.

---

## 10. DEPLOYMENT & OPERATIONAL CHECKLIST (FOR HUMAN / NEXT AGENT)

1. **Commit & Push Workspace Changes to GitHub:**
   - Sync the modified/added files into a clean Git branch (or `main` via PR), ensure GitHub Actions CI passes (`bun install --frozen-lockfile`, `bun run lint`, domain/security tests, `bun run build`).
2. **Apply Migrations to STAGING Supabase First (Strict Order):**
   - Apply `supabase/migrations/0006_fix_initial_password_change_audit.sql` (if not already applied).
   - Apply `supabase/migrations/0007_enforce_forced_password_change_security.sql`.
3. **Run Non-Destructive SQL Verification Suites on STAGING:**
   - Run `supabase/verification/0007_verify_forced_password_change_security.sql` → confirm all applicable checks return `PASS` (checks 17–18 may show `BLOCKED` only if both admin slots 1 & 2 are already occupied).
   - Run `supabase/verification/0003_remote_verification_and_rls_test_suite.sql` → confirm Guard 1A/1B/1C and all RLS/business checks pass.
   - Run `supabase/verification/0005_finalization_behavioral_test_suite.sql` → confirm zero regressions.
4. **Deploy `provision-instructor` Edge Function to STAGING / PRODUCTION:**
   - Configure `ALLOWED_ORIGINS` secret (e.g., `https://operation-lms.vercel.app`).
   - Deploy ONLY `provision-instructor` after verifying the linked Supabase project ID.
5. **Live End-to-End Security Smoke Test on STAGING:**
   - Provision a test instructor (`temporary_password` mode).
   - Sign in as the test instructor; before changing password, attempt direct `POST /rest/v1/rpc/complete_password_change_tx` and `GET /rest/v1/students` with the JWT → confirm RPC returns `CITS Security Violation` and `students` returns `[]`.
   - Complete password change through UI → confirm `must_change_password = FALSE`, 1 clean `PASSWORD_CHANGE_COMPLETED` audit row, and operational access restored.
   - Re-call `complete_password_change_tx()` → confirm `{ already_completed: true }` and zero duplicate audit logs.
6. **Repeat Steps 2–5 on PRODUCTION Supabase (`wdmlxsgbjkboadkeekdq`)** only after Staging passes 100%, then verify Vercel deployment at `https://operation-lms.vercel.app`.

---

## 11. VERIFICATION COMMANDS & SQL CHECKS

### Local Repository Verification
```bash
# 1. Domain & Security Unit Test Suite (57 tests including Guard 1C across 0001..0007)
npx --yes tsx --test src/domain/businessRules.test.ts src/domain/accountProvisioning.test.ts

# 2. TypeScript Type Check
bun run lint

# 3. Production Build
bun run build
```

### Read-Only Remote Post-Migration Sanity SQL (Staging / Production SQL Editor)
```sql
-- Confirm cits_internal isolation (must return false, false)
SELECT
  has_schema_privilege('authenticated', 'cits_internal', 'USAGE') AS auth_schema_priv,
  has_schema_privilege('anon', 'cits_internal', 'USAGE') AS anon_schema_priv;

-- Confirm Migration 0007 functions exist with pinned search_path and safe EXECUTE grants
SELECT
  p.proname,
  p.prosecdef,
  p.proconfig,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_cits_operational_user',
    'current_instructor_id',
    'is_cits_admin',
    'complete_password_change_tx',
    'record_admin_totp_verified_tx',
    'capture_credential_rotation_baseline'
  )
ORDER BY p.proname;

-- Confirm every public.profiles row has a baseline entry
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count,
  (SELECT COUNT(*) FROM cits_internal.credential_rotation_baselines) AS baselines_count;
```

---

## 12. PRODUCTION READINESS DECISION

- **Code & Migration Readiness:** **STAGING READY**
- **Live Production Status:** **NOT READY** (Blocked solely on remote execution of Migrations `0006` + `0007`, remote SQL verification via `0007_verify_forced_password_change_security.sql` & `0003`, Edge Function deployment, and Staging E2E sign-off).
- **Rationale:** All Critical (SEC-001, SEC-002) and target Medium (SEC-003) findings are remediated cleanly in local forward-only migration `0007` and frontend defense-in-depth guards with 57/57 passing local tests, clean TypeScript lint, and clean Vite production build. Because remote production changes were strictly prohibited during this audit, production remains unprotected until the checklist in Section 10 is completed.

---

## 13. NEXT RECOMMENDED ACTIONS

1. **Immediate (Blocking Production):** Commit and push workspace changes, apply Migrations `0006` and `0007` to Staging, run `0007_verify_forced_password_change_security.sql` + `0003` + `0005`, then promote to Production (`wdmlxsgbjkboadkeekdq`).
2. **Immediate (Blocking Provisioning):** Deploy the hardened `supabase/functions/provision-instructor/index.ts` Edge Function with explicit `ALLOWED_ORIGINS` secret.
3. **Near-Term Security Hardening (SEC-004):** Eliminate anonymous username/email enumeration in `resolve_login_identifier(TEXT)` by either switching login to email-only or proxying username login through a rate-limited Edge Function with uniform error responses.
4. **Optional Compliance Enhancement:** If organizational policy requires blocking reuse of the exact temporary password plaintext during first login, introduce a server-side `rotate-password` Edge Function that validates `currentPassword !== newPassword` via re-authentication before calling `auth.admin.updateUserById` and `complete_password_change_tx()`.
