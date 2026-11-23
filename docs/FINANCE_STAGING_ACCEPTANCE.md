# Finance — Staging acceptance and release gates

**Scope:** Operation LMS Finance (Primary / Backup / Transportation / Payments).
**Target:** Supabase Staging `uewhudbufykfkhimvqjj`. Never apply the steps to Production project `wdmlxsgbjkboadkeekdq` without a separate, explicit production release approval.

## Confirmed technical foundation

- Finance migration `0023`: camp/day effective policies, unscheduled Backup sessions, immutable signed payment/refund ledger, Admin AAL2 RPCs, scoped Instructor SELECT.
- Finance migration `0024`: prevent Primary or Backup entitlement reductions if recorded net payments would exceed the remaining confirmed amount.
- Finance migration `0025`: forbid cancellation, camp-day/date/period change, or instructor reassignment of a lecture with approved/eligible Primary or approved Backup work until entitlements are reconciled.
- Staging Database Acceptance workflow contains **13 rollback-only SQL suites**, including isolated synthetic-camp finance regressions.
- Sandbox browser and domain tests are not proof that a protected real Staging login works.
- Vercel stable Staging alias must resolve to **the exact reviewed head SHA**, not an older READY deployment; verify it before manual acceptance.
- Deployment Protection must remain on.

## Manual live browser acceptance (not yet performed)

Prerequisites: approved disposable QA environment or explicit permission for permanent, clearly labeled Staging-only finance test records. Finance payment rows are append-only; do **not** generate irreversible pseudo-payouts in the existing shared Draft camp. Require separate Admin AAL2 and Instructor login sessions.

1. Create/activate a dedicated QA Camp, with a real group/room, two non-overlapping same-day lectures for a Primary instructor. Define a day-1 policy: Backup EGP 150, transportation EGP 100. Freeze both Primary lecture rates at EGP 300.
2. Finalize real attendance for both lectures; verify one Instructor statement with EGP 600 Primary + EGP 100 Transportation = EGP 700, not EGP 800.
3. Add another existing active Camp lecturer as unscheduled Backup on a different real lecture. Do not require a group or timetable for the Backup. Before attendance is finalized, approval must fail; after finalization Admin may approve at frozen EGP 150.
4. Confirm Backup-only work awards **zero** transportation, while a lecturer doing both roles on different periods receives both amounts and at most one Primary transport allowance per day.
5. Confirm Pending/Excluded work does not increase payable balance. Ensure future default Primary rate edits preserve frozen old lecture amounts, and future-dated rate policies preserve history.
6. Post **authorized test-only** partial payment and refund; check the confirmed total, paid and balance both as Admin and Instructor. Verify overpayment is denied, posted payment history cannot be edited/deleted, and an exclusion/cancellation/reassignment of paid work is blocked until financial correction.
7. Open the Instructor account; ensure they see only their own Primary/Backup/transport/ledger information and cannot read other Instructors' statements or execute Admin financial operations.
8. Export CSV and Print/Save PDF: match all rows and totals with the Finance view; check Arabic names, 2-decimal/whole EGP reporting semantics, and a multi-day Camp.
9. Verify archived-Camp payment settlement works without changing historical entitlements or creating new Backup assignments.
10. Record screenshots/evidence and Admin sign-off. If any test reveals a discrepancy, block release.

## Current blockers

- Freshest Finance head not yet published through a READY Vercel Preview / stable protected Staging alias because Vercel reported `402 api-deployments-free-per-day`.
- Authenticated real-browser Admin (TOTP AAL2) and Instructor end-to-end acceptance remains outstanding.
- Do not promote, merge, or migrate Production. Production schema baseline and security review remain distinct release gates.

## Safety invariants

- No artificial test payments inserted into Staging outside a transaction that rolls back, absent explicit acceptance of persistent QA records.
- Do not force-activate `STG-TEST-01` merely to test payouts.
- Never infer a deployment is current from READY alone; verify its Git commit SHA.
- Archive, cancellation, Backup review, refund and entitlement override must leave the ledger internally consistent.
