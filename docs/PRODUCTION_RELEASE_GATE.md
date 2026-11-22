# Operation LMS — Production Release Gate (RC1)

**State as of 2026-11-22: NO-GO.** This document is a gate, not an authorization to deploy. Protected Staging is the only environment modified by the changes described below.

## What is already verified

| Gate | Evidence | Status |
|---|---|---|
| TypeScript, unit/domain and XLSX ZIP tests | 129 tests passing on commit `1f18d546`; latest CI must also pass | PASS |
| Chromium login, Arabic RTL, responsive UI, sandbox role navigation | 7 local browser smoke tests on previous commit | PASS — LOCAL ONLY |
| Staging Edge CORS against stable alias | Both `auth-login` and `provision-instructor` OPTIONS returned 204 + exact origin; unapproved origin rejected with 403 | PASS |
| Staging CAS draft/Excused and security | Transactional SQL tests run directly via Supabase connection, fixture rollback | PASS — DB ONLY |
| Live RLS separation (not just superuser simulation) | `actual_authenticated_role_roster_rls_acceptance.sql`, `SET LOCAL ROLE authenticated`; Instructor own roster visible and visiting roster hidden, Admin AAL2 allowed | PASS — DB ONLY |
| Provisional Excel validation | Actual `STG-TEST-01` file imported: 3 worksheet tabs, correct 3 students and COUNTIF/IFERROR formulas | PASS — NOT A FINALIZED CAMP |
| Vercel Staging preview | READY deployment with exact commit/alias reassignment | PASS — BUILD ONLY |

## Production metadata inventory — READ ONLY, 2026-11-22

**No Production SQL, migrations, credentials, or deployment changes were performed.**

- Exact Production Supabase project: `wdmlxsgbjkboadkeekdq` (`cits-camp-operations`), status `ACTIVE_HEALTHY`.
- Production and Staging each have **29 public tables with RLS enabled**. In the Supabase metadata comparison only `public.students` has different columns: Production lacks `joined_camp_day`, `enrolled_at`, `enrolled_by_profile_id`, `enrollment_origin`, `enrollment_reason`; Staging has all five via migration 0014.
- **Production's Supabase migration ledger is empty (0 tracked migrations)** despite existing tables. DO NOT run source `0001` bootstrap or all migrations blindly: reconcile the original deployed schema/migration baselines on an isolated copy first.
- **Production Security Advisor WARN:** `anon` may call `public.resolve_login_identifier(text)` as a SECURITY DEFINER function. This is a user-identifier enumeration exposure that migration `0008_security_phase_closure_hardening.sql` already revokes in the source. Require its controlled application and verify `anon` EXECUTE is gone before first user login.
- Additional Advisor notes: eight authenticated SECURITY DEFINER functions and leaked-password protection disabled. Review before GO.
- Staging migration `0022_cas_strict_json_payload_validation.sql` is already applied and its six invalid JSON cases passed, with saved attendance unchanged. Include **0022** in the reviewed Production forward-only plan.

## Blocking acceptance — do NOT merge or deploy Production if any are unchecked

- [ ] **Authenticated Staging Browser:** real Instructor sign-in and Admin sign-in with verified TOTP/AAL2, restricted access, logout/re-login/session refresh; UI is backed by Staging data, never local demo.
- [ ] **Live two-session attendance:** Instructor sessions on two independent devices/browser contexts; edit A online, edit B stale/offline and reconnect, confirm B gets explicit conflict without silently changing A; also confirm legitimate offline edit can Submit & Sync.
- [ ] **Full two-group Camp simulation from browser:** authorized Instructor searches visiting Student across Groups, marks attendance, refreshes and retains correct identity and original Group; duplicate same-period attendance blocked.
- [ ] **Day-4 onboarding from browser:** Instructor adds joiner with reason; audit contains actor/timestamp/join-day; Days 1–3 not counted absent; Admin KPIs correct.
- [ ] **Actual check-in:** browser device camera selfie + GPS, geofence verified/uncertain/outside and Exception flows, Admin review/entitlement reflected after refresh. SQL tests do not validate camera hardware permissions/storage path.
- [ ] **Finance/Admin acceptance:** reports, notification, substitute Instructor, group transfers, archive/read-only, entitlement decisions and audit history with server data.
- [ ] **Finalized ten-day Excel:** download from authorized Admin session after finalized Staging attendance; open in Excel/Google Sheets, verify Arabic, counts, cross-group dedup, new joiners, formulas, statuses and print readiness.
- [ ] **Security review:** per-RPC authorization for 22 authenticated SECURITY DEFINER functions; review remaining Supabase advisor warning (leaked-password protection; enable in Auth settings); test `anon` read and write boundaries. No service-role key in client.
- [ ] **Migration readiness:** inventory Production schema and applied migrations READ ONLY. Backup and test restore on an isolated DB first; apply ordered source migrations on an empty clone or devise idempotent plan for existing schema. Staging was migrated through 0022 with timestamp-generated ledger entries (not sequential filename versions), so do not replay Staging migration history or rerun old bootstrap blindly.
- [ ] **CI evidence:** current Web CI PASS, browser local PASS, Edge CORS PASS; Staging DB acceptance GitHub Action genuinely executes SQL suites (not only a green *skipped* job), or an equivalent documented supervised test pass.
- [ ] **Separate release decision:** authorized owner approves the exact Production project, target commit, migration order, backup/rollback path, maintenance plan and deployment before any Production mutation.

## Relevant artifacts

- Integrated Draft RC against main: https://github.com/salahsaed5/Operation-Lms/pull/33
- Staging (protected): https://operation-lms-staging-salah-2543.vercel.app
- Staging Edge CORS: `.github/workflows/staging-edge-cors-smoke.yml`
- Database acceptance suites: `supabase/tests/*.sql`; `.github/workflows/staging-db-acceptance.yml`
- Chromium local/preview browser smoke: `.github/workflows/browser-smoke.yml`
- Feature-specific Draft PRs are stacked and already present in PR #33; **do not merge them all independently**.

## Safe release sequence

1. Finish all Staging acceptance tasks and record evidence links. A `READY` Vercel deploy is **not** a Production signoff.
2. Review PR #33 against main and address code security findings. Obtain independent code/SQL review. Resolve stacked PR status to avoid accidental double merging.
3. Inventory Production read-only, verify database/Storage/Auth project identity and env isolation. Take recoverable backup, rehearse clone restoration and migration execution; record exact changes and reversal plan.
4. After a distinct owner GO decision, apply forward-only Production migrations in reviewed order, deploy matching Edge Functions, then promote/deploy the exact tested front-end SHA. Never run `db reset` or re-bootstrap an existing Production database.
5. Smoke-test live Admin/Instructor auth, CORS, private RLS, check-in, attendance/finance/read-only views, Excel and data integrity; monitor errors; on breach of agreed rollback thresholds restore/revert through the rehearsed procedure.

## Current blockers requiring authorized operator access

- Vercel Deployment Protection on preview: keep enabled. Browser automation can use a scoped **short-lived** Trusted Sources OIDC token through a secure CI environment, not source code or chat.
- Independent Staging QA Admin/Instructor identities and TOTP: use secure account/secret workflows, **never paste passwords or TOTP seeds into issues, CI logs or this chat**.
- GitHub Staging DB acceptance job currently lacks `secrets.SUPABASE_STAGING_DB_URL` and skips the SQL action; configure only an **exact-Staging** PostgreSQL URL in the protected `staging` environment if continuous SQL verification is required. Do not reuse Production credentials.
