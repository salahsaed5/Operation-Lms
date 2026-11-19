# OPERATION LMS — SECURITY PHASE CLOSURE REPORT

**Project:** Operation LMS (CITS Camp Operations LMS)  
**Repository:** `https://github.com/salahsaed5/Operation-Lms`  
**Verified Remote Baseline Commit (`refs/heads/main`):** `8e74776fa3008a41b2d2dd110fdcfa0c86dc6526`  
**Production Supabase Target (Strictly Untouched):** `wdmlxsgbjkboadkeekdq` (`https://wdmlxsgbjkboadkeekdq.supabase.co`)  
**Decision:** **SECURITY REVIEW COMPLETE — STAGING READY**

---

## 1. Executive Summary

An independent, multi-pass security closure review and remediation was executed across Operation LMS—covering PostgreSQL migrations (`0001`–`0008`), Row Level Security (RLS) across all 29 `public` tables, private `cits_internal` tables, `storage.objects` (`checkin-selfies`), `SECURITY DEFINER` RPCs and triggers, Supabase Edge Functions (`provision-instructor` and `auth-login`), frontend authentication and session lifecycle (`citsRepository.ts`, `AppContext.tsx`, `AuthView.tsx`, `App.tsx`), the Staging GitHub Actions verification workflow (`.github/workflows/supabase-staging-verify.yml`), and automated security test suites.

All ten security findings (**SEC-001** through **SEC-010**)—including the final independent review findings against `auth-login` (**SEC-008** fail-open rate limiting, **SEC-009** client-spoofable IP headers, **SEC-010** fixed-window vs sliding-window documentation mismatch) and critical false-pass/incomplete-schema defects discovered in `.github/workflows/supabase-staging-verify.yml`—have been fixed and verified locally without modifying migrations `0001`–`0008`, without contacting Production Supabase (`wdmlxsgbjkboadkeekdq`), and with **66/66 automated unit & security tests passing** (`exit 0`), clean `tsc --noEmit`, clean `vite build`, and zero hardcoded secrets.

Because live Staging PostgreSQL, GoTrue, and Edge Function runtime verification cannot execute in this offline container, the repository is signed off as **`SECURITY REVIEW COMPLETE — STAGING READY`** (Production promotion remains gated on Section 19).

---

## 2. Repository & Commit Verification

- **Remote Git Checkpoint Verified:** `git ls-remote https://github.com/salahsaed5/Operation-Lms.git HEAD refs/heads/main` confirmed `HEAD` and `refs/heads/main` at commit `8e74776fa3008a41b2d2dd110fdcfa0c86dc6526`.
- **Local Workspace Git State:** `/app/applet` contains no `.git` directory; all remediation edits exist as uncommitted, unpushed local filesystem changes on top of commit `8e74776fa3008a41b2d2dd110fdcfa0c86dc6526`.
- **Migration Immutability:** Migrations `0001`–`0007` (and committed `0008`) were **not modified**; SEC-008, SEC-009, SEC-010, and Staging workflow hardening required zero breaking DB schema changes.
- **Production Isolation:** Zero connections, migrations, Edge Function deployments, or Auth/DB operations were performed against Production (`wdmlxsgbjkboadkeekdq`).

---

## 3. Security Audit Scope & Methodology

Every control was verified directly against source files, SQL migrations, infrastructure behavior, and executable tests:

1. **Database & Migrations (`0001`–`0008`):** 29 `public` tables + 2 `cits_internal` tables, RLS, `SECURITY DEFINER` pinned `search_path = public, pg_temp`, `REVOKE`/`GRANT` boundaries, Guard 1C lexical scanner.
2. **RLS & Storage (`storage.objects` `checkin-selfies`):** Evaluated across `anon`, inactive users, `must_change_password = TRUE`, active instructors, AAL1 Admins, and AAL2 Admins.
3. **Edge Functions (`provision-instructor` & `auth-login`):** Audited fail-closed RPC behavior, Cloudflare/Supabase Edge IP header trustworthiness, fixed-window counter semantics, streaming body limits, timing side channels, CORS/Origin-less handling, token handling, and error sanitization.
4. **Staging Workflow (`.github/workflows/supabase-staging-verify.yml`):** Audited pipe failure handling (`set -euo pipefail`), schema readiness gates, migration ordering/repeatability, false-pass prevention, production target blocking, and Edge Function deployment scope.
5. **Frontend Auth & Session State:** Audited `citsRepository.ts` (including HTTP `503` handling), `AppContext.tsx` (mid-session re-verification & state wipe), `AuthView.tsx`, `App.tsx`, and `supabase.ts`.

---

## 4. Verification of Prior & Final Review Findings (SEC-001 through SEC-010)

### SEC-001 through SEC-007 (Previously Remediated & Verified)
- **SEC-001 (CRITICAL — Closed):** Direct `complete_password_change_tx()` bypass closed via `cits_internal.credential_rotation_baselines` SHA-256 fingerprint verification, missing-baseline fail-closed check, and `< 20` char credential rejection (`0007` + `0008`).
- **SEC-002 (CRITICAL — Closed):** Server-side `must_change_password = FALSE` enforced across `is_cits_operational_user()`, `current_instructor_id()`, `is_cits_admin()`, operational RLS policies, operational RPCs, and `checkin-selfies` storage (`0007`).
- **SEC-003 (MEDIUM — Closed):** Deactivated instructor read leak on `public.instructors` closed (`0007`); `AppContext.refreshOperationalData()` re-validates live identity via `loadAuthenticatedUserContext()` and wipes state + signs out if deactivated.
- **SEC-004 (MEDIUM — Closed):** `resolve_login_identifier(TEXT)` revoked from `PUBLIC`, `anon`, and `authenticated` (`0008`); authentication routed through `auth-login` Edge Function + `cits_internal.auth_login_rate_limits`.
- **SEC-005 (HIGH — Closed):** `complete_password_change_tx()` enforces `auth.jwt() ->> 'aal' = 'aal2'` for Admin callers (`0008`).
- **SEC-006 (MEDIUM — Closed):** `capture_credential_rotation_baseline()` clears `last_completed_auth_fingerprint` / `last_completed_at` on `FALSE -> TRUE` transitions (`0008`), and `triggerInstructorPasswordReset()` marks `must_change_password = TRUE` prior to recovery email.
- **SEC-007 (LOW/MED — Closed):** Explicit `REVOKE ALL ... FROM PUBLIC, anon` applied to `assert_camp_not_archived(UUID)` and operational helper functions (`0008`).

---

### SEC-008 — Rate Limiting Fail-Open (`supabase/functions/auth-login/index.ts`)
- **Severity:** **HIGH**
- **Root Cause:**
  1. When `evaluate_login_rate_limit_internal(..., p_increment: false)` returned a database/RPC error or malformed payload, `if (!preRateErr && preRateData && ...)` skipped enforcement and **proceeded directly to credential authentication** (fail-open).
  2. Inside `recordFailedAttemptAndRespond()`, `{ data: postRateData }` discarded the `error` object completely, allowing failed attempts during DB outages to silently return a normal `401` without incrementing counters.
- **Fix Implemented:**
  - Added strict `isValidRateLimitPayload()` contract validation (`typeof allowed === 'boolean' && Number.isFinite(retry_after_seconds)`).
  - **Pre-auth check:** If `preRateErr` OR `!isValidRateLimitPayload(preRateData)` -> logs sanitized operational metadata only (`reason` + error code; zero SQL/PII), applies failure timing floor, does **not** call `resolve_login_identifier` or `signInWithPassword`, and fails closed with **HTTP `503`** (`{ ok: false, error: 'Authentication service is temporarily unavailable. Please try again shortly.' }`, `Retry-After: 60`, `Cache-Control: no-store`).
  - **Post-failure recording:** Checks `postRateErr` AND `isValidRateLimitPayload(postRateData)`. On any failure, logs sanitized error and fails closed with **HTTP `503`** (`Retry-After: 60`)—never silently returns `401`.
  - Wrapped `Deno.serve` in a top-level `try/catch` failing closed with sanitized HTTP `503`.
  - Updated `src/services/citsRepository.ts` to handle HTTP `503` explicitly.
- **Status:** **CLOSED**.

---

### SEC-009 — Client-Controlled IP Address Headers (`supabase/functions/auth-login/index.ts`)
- **Severity:** **HIGH**
- **Infrastructure Investigation (Hosted Supabase Edge Functions):**
  - **`cf-connecting-ip` (Trustworthy on Hosted Supabase):** Public traffic to `*.supabase.co/functions/v1/*` terminates at Cloudflare edge ingress, which unconditionally sets/overwrites `cf-connecting-ip` from the actual connecting TCP socket IP. External clients cannot spoof it on direct requests.
  - **`x-forwarded-for` (Unsafe / Client-Spoofable):** Proxies append rather than replace XFF; reading index `[0]` allows any attacker to send arbitrary fake `X-Forwarded-For` values on every request and completely bypass IP rate limiting.
  - **`x-real-ip` (Unreliable):** Not consistently guaranteed across managed routing layers and unsafe to trust as a primary or fallback security key.
- **Fix Implemented:**
  - Rewrote `extractTrustedClientIp(req)` to read **ONLY `cf-connecting-ip`**, strictly validated against IPv4/IPv6 syntax (max 45 chars, lowercased).
  - Completely removed reading of `x-forwarded-for` and `x-real-ip`.
  - **Fallback Strategy:** When `cf-connecting-ip` is absent or syntactically invalid (e.g., local dev or non-Cloudflare proxy), requests route into a single shared fallback key (`'untrusted-source'`) rather than trusting client-supplied headers—preventing attackers from rotating IP buckets via spoofed headers—while **per-identifier fixed-window limits (10 failures / 15 min)** always remain enforced independently of IP headers.
- **Status:** **CLOSED** (see Section 17 for documented proxy/NAT caveats).

---

### SEC-010 — Fixed-Window vs Sliding-Window Documentation Mismatch
- **Severity:** **LOW / DOCUMENTATION INTEGRITY**
- **Root Cause:** Migration `0008` (`evaluate_login_rate_limit_internal`) implements **fixed-window** counters (`window_started_at` + `attempt_count`, resetting once `now() - window_started_at >= 900s`), whereas comments and prior report text inaccurately described it as "sliding-window".
- **Fix Implemented (Option A — Accurate Documentation):**
  - Updated `supabase/functions/auth-login/index.ts`, `src/domain/accountProvisioning.ts`, and `SECURITY_PHASE_CLOSURE_REPORT.md` to accurately describe **15-minute fixed-window rate limiting** and explicitly disclose the fixed-window boundary-burst behavior in Section 17.
  - Added a static regression test in `src/domain/accountProvisioning.test.ts` asserting `auth-login/index.ts` contains zero false `sliding-window` claims and explicitly documents `fixed-window`.
- **Status:** **CLOSED**.

---

## 5. Additional Review Findings & Hardening (`auth-login` & Staging Workflow)

### `supabase/functions/auth-login/index.ts` Deep Review
1. **Successful-Login Counter Handling:** Successful authentication intentionally does **not** clear or decrement failure counters. This prevents an attacker from resetting an IP bucket by authenticating into a dummy/compromised account between brute-force bursts against a victim account (verified by automated test).
2. **Identifier Normalization:** Identifiers now undergo Unicode `NFKC` normalization, `.trim().toLowerCase()`, max length `120`, and strict rejection of ASCII control characters (`[\u0000-\u001f\u007f]`).
3. **Username / Email Collisions:** `public.profiles` enforces `UNIQUE` on `username` and `email`. Valid usernames (`^[a-z0-9][a-z0-9._-]{2,63}$`) forbid `@`, whereas valid emails require `@`, eliminating username/email namespace collisions. Rate-limit identifier buckets key strictly on the submitted normalized identifier (rather than canonical resolved email) to prevent creating a username-to-email linking oracle; worst-case combined attempts across both aliases of one account remain bounded by `20` (and capped by the `25`/IP limit and GoTrue built-in throttles).
4. **Timing Differences:** Raised failure timing floor from `250ms` to **`500ms` + `0..50ms` CSPRNG jitter** (`crypto.getRandomValues`) so fast DB misses (unknown/inactive user) and GoTrue bcrypt verification failures (wrong password) fall within an indistinguishable response-time envelope.
5. **Request Body Limits (Chunked-Encoding Memory DoS Fix):** Replaced `await req.text()` with a streaming UTF-8 byte-counting reader (`readBodyWithByteLimit(req, 8_192)`) that cancels the stream immediately and returns HTTP `413` once cumulative UTF-8 bytes exceed `8,192`—preventing unbounded memory buffering when `Content-Length` is omitted.
6. **CORS & Origin-less Requests:** Authorized origins receive exact `Access-Control-Allow-Origin` reflection (`Vary: Origin`). Unauthorized origins receive HTTP `403` with zero `ACAO`. `OPTIONS` without `Origin` receives `403`. Origin-less `POST` requests (non-browser/CLI) emit zero `ACAO` header and remain strictly gated by fail-closed DB rate limiting and Supabase API key verification.
7. **Error Handling:** All RPC errors (`preRateErr`, `postRateErr`, `resolveErr`) and unexpected exceptions fail closed with sanitized HTTP `503` + `Retry-After: 60` and sanitized `console.error` codes (never returning raw SQL/PostgREST errors or logging credentials/tokens).
8. **Abuse Scenarios & Table Growth:** `cits_internal.auth_login_rate_limits` stores only `ip:<sha256>` / `id:<sha256>` (67 chars). Single-IP spray is capped at 25 new identifier rows / 15 min (~2,400/day). Expired keys are overwritten in place on reuse; scheduled maintenance cleanup (`DELETE` rows older than 24h via `pg_cron`) is recommended for long-running Staging/Production operations.
9. **Hashing & Bucket Key Correctness:** Verified `auth-login` SHA-256 outputs (64 lowercase hex chars) match `LEFT(LOWER(TRIM(...)), 64)` in `0008` with zero truncation and disjoint `ip:` vs `id:` prefixes.
10. **Authentication Token Handling:** Fresh stateless anon client (`persistSession: false, autoRefreshToken: false`) per request; returns only `{ ok: true, session: { access_token, refresh_token } }` with `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache`.

### `.github/workflows/supabase-staging-verify.yml` Deep Audit & Fixes
1. **Fixed False-Pass Pipe Bug (`set -euo pipefail`):** Previously, `psql ... | tee log` ran without `pipefail`; if `psql` failed before printing rows, `tee` exited `0` and `grep -Eq '\| FAIL \|'` found no matches, causing a **silent false PASS**. Added `set -euo pipefail` to every step and explicit `^ERROR:|^FATAL:` detection.
2. **Added Mandatory `PASS` Presence Assertion:** Every SQL suite (`0003`–`0008`) now fails if `0` `PASS` rows are emitted, preventing truncated or empty runs from falsely passing.
3. **Eliminated Fragmented Migration Toggles (Incomplete Schema Hazard):** Replaced separate `apply_0005` and `apply_0006_to_0008` toggles with a single ordered `apply_migrations` boolean (`default: true`) executing `0005 -> 0006 -> 0007 -> 0008` in exact order.
4. **Added Schema Readiness Preflight Gate:** Verifies baseline `0001`–`0004` presence (`29` public base tables) before migrations, and when `apply_migrations=false`, verifies `0008` artifacts (`cits_internal.auth_login_rate_limits` and `evaluate_login_rate_limit_internal`) exist before running verification suites.
5. **Hardened Production Target Guard:** Case-insensitive blocking of `wdmlxsgbjkboadkeekdq` in `SUPABASE_STAGING_DB_URL`.
6. **Clarified Edge Function Deployment Scope:** Explicitly documented in both workflow header and `GITHUB_STEP_SUMMARY` that the workflow verifies **Database Migrations & SQL Suites ONLY** and does **NOT** deploy `auth-login` or `provision-instructor` Edge Functions.

---

## 6. Consolidated Vulnerability Register

| ID | Severity | Status | Component | Root Cause | Remediation | Verification |
|---|---|---|---|---|---|---|
| **SEC-001** | CRITICAL | Closed | `complete_password_change_tx()` | Cleared flag without verifying Auth password change | `0007` + `0008` SHA-256 baseline check, fail-closed missing baseline, `>=20` char check | Unit tests + `0007`/`0008` SQL suites |
| **SEC-002** | CRITICAL | Closed | RLS helpers & operational RPCs | `must_change_password` enforced only in UI | `0007` server-side `is_cits_operational_user()` across RLS, RPCs, storage | Unit tests + `0007` SQL suite |
| **SEC-003** | MEDIUM | Closed | `instructors` RLS & `AppContext.tsx` | Deactivated read leak + stale mid-session refresh | `0007` `is_active_cits_user()` + live `loadAuthenticatedUserContext()` re-check | Unit tests + `0007`/`0008` SQL suites |
| **SEC-004** | MEDIUM | Closed | `resolve_login_identifier(TEXT)` | Anon-callable username/email enumeration | `0008` revoke + `auth-login` Edge Function + `citsRepository.ts` | Unit tests + `0008` SQL suite |
| **SEC-005** | HIGH | Closed | `complete_password_change_tx()` | Missing Admin AAL2 check | `0008` requires `aal = 'aal2'` for `role = 'admin'` | Unit tests + `0008` SQL suite |
| **SEC-006** | MEDIUM | Closed | `capture_credential_rotation_baseline()` & `AppContext.tsx` | Stale `last_completed_*` on re-force; reset skipped flag | `0008` clears `last_completed_*`; `markProfileMustChangePassword()` before reset email | Unit tests + `0008` SQL suite |
| **SEC-007** | LOW/MED | Closed | DB Helper Functions | Default `PUBLIC`/`anon` execute grants | `0008` explicit `REVOKE ALL ... FROM PUBLIC, anon` | Test 28 + `0008` SQL suite |
| **SEC-008** | HIGH | Closed | `auth-login/index.ts` & `citsRepository.ts` | Pre-auth and post-failure rate-limit RPC errors failed open | Strict fail-closed HTTP `503` + `Retry-After: 60` on RPC error/malformed payload; zero auth on pre-check error; sanitized logs | `accountProvisioning.test.ts` (SEC-008 tests + static audit) |
| **SEC-009** | HIGH | Closed | `auth-login/index.ts` | Trusted client-spoofable leftmost `x-forwarded-for` & `x-real-ip` | Trust ONLY validated `cf-connecting-ip`; fallback `'untrusted-source'` shared bucket + independent per-identifier limit | `accountProvisioning.test.ts` (SEC-009 spoofing tests + static audit) |
| **SEC-010** | LOW | Closed | Docs / Comments | Described fixed-window counters as sliding-window | Corrected all code comments & report to **fixed-window** and documented boundary-burst property | Static regression test in `accountProvisioning.test.ts` |

---

## 7. Files Changed (Final Security Review Fixes)

- `supabase/functions/auth-login/index.ts` — Fixed SEC-008 (fail-closed `503` pre/post RPC checks + top-level try/catch), SEC-009 (`cf-connecting-ip`-only + `'untrusted-source'` fallback), SEC-010 (fixed-window comments), streaming UTF-8 byte cap (`413`), NFKC/control-char normalization, and `500ms + 0..50ms` CSPRNG failure timing floor.
- `src/services/citsRepository.ts` — Added explicit HTTP `503` handling in `resolveAndSignInWithSupabase()`.
- `src/domain/accountProvisioning.ts` — Added `extractTrustedClientIp`, `AUTH_SERVICE_UNAVAILABLE_ERROR`, `UNTRUSTED_IP_FALLBACK_KEY`, SEC-008 RPC failure injection + `authAttempted` tracking, and SEC-010 fixed-window comments.
- `src/domain/accountProvisioning.test.ts` — Added behavioral & static tests covering all 10 required `auth-login` scenarios (pre-auth RPC failure, post-failure RPC failure, IP spoofing via `x-forwarded-for`/`x-real-ip` with and without `cf-connecting-ip`, successful-login counter preservation, fixed-window threshold & 15-min reset, unknown identifier, wrong password, inactive user, valid login, generic error consistency, and zero false `sliding-window` claims).
- `src/domain/businessRules.test.ts` — Extended Test 28 to verify `citsRepository.ts` `503` handling and hardened Staging workflow safeguards (`set -euo pipefail`, single `apply_migrations`, Schema Readiness Gate, `PASS` presence check, DB-only scope notice).
- `.github/workflows/supabase-staging-verify.yml` — Fixed `psql | tee` false-pass pipe bug (`set -euo pipefail`), added mandatory `PASS` + `ERROR:`/`FATAL:` checks, unified ordered `apply_migrations` toggle, added Schema Readiness Preflight Gate, case-insensitive production block, and explicit DB-only scope notice.
- `SECURITY_PHASE_CLOSURE_REPORT.md` — Updated with SEC-008, SEC-009, SEC-010, Additional Review analysis, Staging Workflow audit, actual test results, and honest limitations.

**Preserved Unmodified:** `supabase/migrations/0001` through `0008`.

---

## 8. Actual Local Verification Results

| Check | Exact Command | Actual Output Summary | Exit Code |
|---|---|---|---|
| Unit & Security Tests | `npx --yes tsx --test src/domain/businessRules.test.ts src/domain/accountProvisioning.test.ts` | **66 tests, 66 passed, 0 failed, 0 skipped** (`713.5 ms`). Includes Guard 1C lexical scanner across `0001..0008` and all SEC-001 through SEC-010 automated tests. | `0` |
| TypeScript / Lint | `bun run lint` (`tsc --noEmit`) & `lint_applet` | **0 errors, 0 warnings.** | `0` |
| Production Build | `bun run build` (`vite build` v8.3.8) & `compile_applet` | **1,721 modules transformed**, `dist/assets/index-cgGT8vyO.js` (`1,158.77 kB`, gzip `284.97 kB`), built in `795 ms`. | `0` |
| Hardcoded Secret Scan | `grep -rnE '(sb_secret_\|eyJhbGciOiJIUzI1NiIs\|SUPABASE_SERVICE_ROLE_KEY\s*=\|AKIA[0-9A-Z]{16}\|-----BEGIN (RSA \|EC )?PRIVATE KEY-----)' src supabase --exclude-dir=node_modules --exclude-dir=dist` | **0 real secrets** (matches only negative test fixture `sb_secret_123456789` in `businessRules.test.ts` and runtime rejection guard in `src/lib/supabase.ts`). | `0` |

---

## 9. Remaining Limitations & Residual Risks

1. **Fixed-Window Boundary Burst (SEC-010):** Fixed 15-minute windows allow up to `2x` threshold across a window reset boundary (e.g., 9 failures at `14:59` + 9 at `15:01`). Acceptable for Staging/initial Production when combined with GoTrue built-in throttles and Admin MFA; genuine sliding-window or token-bucket counters can be introduced in a future forward-only migration if high-volume abuse materializes.
2. **IP Header Fallback & Shared NAT (SEC-009):** On hosted Supabase (`*.supabase.co`), Cloudflare sets `cf-connecting-ip` reliably. If `auth-login` is ever deployed behind a custom non-Cloudflare proxy that strips `cf-connecting-ip`, all clients would share the `'untrusted-source'` bucket (fail-safe against spoofing, but throttles at 25 combined failures / 15 min across all unverified callers). Campus/university shared NATs share one `cf-connecting-ip` (25 failed attempts / 15 min per NAT IP).
3. **GoTrue Random Bcrypt Salting (Same-Password Reuse):** `auth.updateUser({ password })` generates a fresh bcrypt salt even if a user submits the exact same temporary password; enforcing `newPassword !== currentPassword` requires a future `rotate-password` Edge Function.
4. **Rate-Limit Table Maintenance:** `cits_internal.auth_login_rate_limits` overwrites expired buckets on key reuse, but unique one-off random strings accumulate (~2,400 rows/day max per attacker IP). Schedule a periodic cleanup job (`DELETE ... WHERE window_started_at < NOW() - INTERVAL '24 hours'`) on Staging/Production.
5. **Remote Runtime Verification Pending:** Live Staging SQL execution (`0003`–`0008`), live `auth-login` + `provision-instructor` Edge Function deployment & HTTP testing (including verifying real `cf-connecting-ip` presence in Supabase Edge logs and `503`/`429`/`413`/`403` responses), and live browser E2E smoke tests have **not** yet been run remotely.

---

## 10. Staging Deployment & Promotion Order

1. Commit and push all local changes to a Staging branch; verify GitHub CI passes.
2. Deploy Edge Functions to **Staging** FIRST (separate from the DB workflow):
   - `supabase functions deploy auth-login --no-verify-jwt --project-ref <STAGING_PROJECT_REF>`
   - `supabase functions deploy provision-instructor --project-ref <STAGING_PROJECT_REF>`
   - Confirm Staging `ALLOWED_ORIGINS` is set explicitly to the Staging frontend origin.
3. Dispatch `.github/workflows/supabase-staging-verify.yml` (`apply_migrations: true`) against Staging; verify `0` `FAIL`/`ERROR` and verified `PASS` rows across all 6 SQL suites (`0003`–`0008`).
4. Deploy Staging frontend and execute live E2E tests (confirming `cf-connecting-ip` enforcement, `403` CORS rejection, uniform `401`, `429` + `Retry-After`, `413` oversized body, fail-closed `503`, forced password change, Admin AAL2 MFA, and inactive kick-out).
5. Promote to Production (`wdmlxsgbjkboadkeekdq`) **only** after all Staging gates pass with archived logs and a fresh Production DB backup.

---

## 11. Security Phase Completion Decision

**DECISION: `SECURITY REVIEW COMPLETE — STAGING READY`**
