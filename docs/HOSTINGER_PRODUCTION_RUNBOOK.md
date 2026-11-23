# Operation LMS — Hostinger Production Release

This deployment is the **full React/Vite LMS**, not a UI-only build. Supabase Production is
an independent backend from Staging. Do **not** copy test data, staging tokens, or secret keys.

## Hostinger setup

- Repository: `salahsaed5/Operation-Lms`
- Branch: `main` (after release fast-forward/merge)
- Framework: **Vite** (React + Vite; **not Express**, not Create React App)
- Node: `22.x`
- Root: `./`
- Build script: `build` (runs `vite build`)
- Output directory: `dist`
- No persistent Node server / entry file required: Vite builds a static frontend.
- Hosting domain: `https://gleaming-skyblue-heron-54.hostingersite.com`

If Hostinger offers only static hosting for the purchased tier, upload the contents
of the built `dist` folder. The React frontend does not require an Express server.

## Environment variables (Hostinger build)

| Key | Value |
| --- | --- |
| `APP_URL` | `https://gleaming-skyblue-heron-54.hostingersite.com` |
| `VITE_SUPABASE_URL` | `https://wdmlxsgbjkboadkeekdq.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Production **public publishable** (`sb_publishable_`) or legacy anon key from Supabase API Keys |
| `VITE_DEFAULT_CAMP_DAYS` | `10` |
| `VITE_DEFAULT_GEOFENCE_METERS` | `100` |
| `VITE_MAX_SELFIE_KB` | `300` |
| `VITE_CURRENCY` | `EGP` |

Never put a `service_role` key, `sb_secret_` key, temporary password,
Supabase DB password, or token in `VITE_*` or the public repository.
The Supabase Edge Functions manage server-side secrets, not Hostinger.

## Backend readiness and first Admin

- Database schema: 32 public tables and latest camp/finance/attendance guards.
- `auth-login` (JWT verification **off**, protected by CORS + DB rate limiting).
- `provision-instructor` (JWT verification **on**, protected by MFA and admin role).
- Exact Hostinger Origin is allowed only on **Supabase Production**; no wildcard CORS.
- The first Admin Auth user requires a matching `profiles` and `admin_accounts`
  record created by the restricted `public.bootstrap_cits_admin_account` procedure
  via trusted SQL Editor. Verify ownership of the Auth account first. Do not
  create a profile for an unrelated existing user.
- Admin must complete initial password rotation and enroll/verify AAL2 MFA.
- Keep RLS enabled. Verify that students, instructors and financial data are
  isolated by role before inviting actual users.

## Release acceptance

1. GitHub CI: `bun run lint`, `bun test ...`, `bun run build`.
2. Chromium Browser E2E: desktop LTR/RTL, mobile navigation, sidebar pin/hover,
   Admin & Instructor flows in a local non-production sandbox.
3. GitHub Production Edge CORS smoke: OPTIONS 204 for exact Hostinger Origin
   and rejection of an unknown Origin. No credentials used in smoke tests.
4. Hostinger HTTPS deployment: Sign-in (Admin with MFA), create a test camp,
   groups and instructor, schedule and check-in, attendance and Excel export,
   finance payment reconciliation.
5. Verify that no Local Sandbox warning appears in the deployed build.
6. If using a new custom domain later, explicitly add its exact HTTPS Origin to
   the production Edge Function allowlist and redeploy functions.

## Rollback

- Revert the failed frontend commit on `main` and redeploy Hostinger; do not
  force-push a published branch.
- Database migrations are not automatically reversible. Use separate reviewed
  compensating migrations; never drop operational rows or copy Staging records.
