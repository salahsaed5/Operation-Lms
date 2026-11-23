# Camp teaching-calendar acceptance — 10 & 15 sessions

**Target:** Operation LMS Staging (`uewhudbufykfkhimvqjj`), work-in-progress draft PR #33.
**No Production changes are authorized.** Protected Vercel Staging Preview must be checked against this branch's exact head SHA before live sign-off.

## Meaning of a Camp Day

`duration_days` means **number of teaching sessions / operational days**, NOT elapsed calendar days. A `camp_day` always remains 1-based; absent calendar dates are never marked absent and earn no instructor transport just for passing time.

For `start_date = 2026-11-28` (Saturday):
- Sat / Mon / Wed: D1 Nov 28, D2 Nov 30, D3 Dec 2, D4 Dec 5, **D10 Dec 19**.

For `start_date = 2026-11-29` (Sunday):
- Sun / Tue / Thu: D1 Nov 29, D2 Dec 1, D3 Dec 3, **D10 Dec 20**, **D15 Dec 31**.

## Admin setup
1. Create a new Draft Camp. Choose actual **first teaching date**.
2. Enter duration (e.g. **10** or **15**, valid 1–60).
3. Under **Teaching weekdays**, choose a shortcut **Sat/Mon/Wed** or **Sun/Tue/Thu**, or customize weekdays. Existing daily pattern remains available for legacy Camps.
4. Verify last-teaching-date preview. The start date must fall on a chosen weekday.
5. Save Draft. Add groups and lectures by **Day 1…Day N**; the UI shows each mapped calendar date, and the SQL trigger rejects mismatched dates.
6. The current operational day is a teaching session ordinal: do not increment it on off-days. Before on-site check-in, ensure the displayed date matches today in **Africa/Cairo**.
7. On Instructor pages, scheduled lectures and attendance selectors display both the ordinal and actual dates. For a recurring Camp, off-day GPS/selfie check-in is denied in the UI and the database.
8. Instructor late enrolments use the correct teaching-day ordinal (e.g. joining on D4 after a calendar week). No absence is backfilled for D1–D3.
9. Export the Camp workbook. It has **N day columns**, correct header dates and dynamic Excel formulas. Incomplete camps remain PROVISIONAL.

## Backward compatibility and protection
- DB 0026 adds `camps.operating_weekdays` with default **all 7 weekdays**. All previously created Camps keep their historical daily dates.
- Changing start date, duration or weekdays is refused if existing scheduled lectures would be moved. Reconcile existing lecture schedule separately; don't silently shift or delete verified records.
- DB 0027 corrects midcamp enrolment for real teaching-day ordinal and rejects wrong-date enrollments.
- DB 0028 blocks off-day recurring Camp check-in even if a client bypasses UI. Daily/legacy Camps keep previous behavior.
- The finance ledger and transportation are still based on actual `camp_day` rows, not the number of elapsed calendar dates.
- SQL acceptance is rollback-only and existing shared Draft Camp remains unchanged.

## Parallel Active Camp support (Staging migrations 0029–0030)
- Multiple Camps may be **Active concurrently**. The former single-active unique index and trigger restriction were removed on Staging.
- Both Admin and Instructor have a **Working Camp** selector. Instructor choices are restricted to assignments, past lectures and Backup work, with Supabase RLS enforcing access separately. Switching Camp resets stale attendance navigation.
- Each Camp has its own operating-weekday calendar, current operational day, room/group schedule, check-in, attendance, student records, and **Camp-scoped Finance ledger**.
- Real calendar date/time, NOT Camp Day or period number, determines resource collisions between Camps.
- Migrations 0029–0030 block overlapping Primary/Primary, Primary/Backup, and Backup/Backup Instructor work; lecture room conflicts are also prevented across Camps.
- Historical archived work remains readable only to authorized accounts; it cannot be edited.
- This has passed rollback-only synthetic QA on Staging. A real protected browser Admin + Instructor multi-Camp test is still required before production release.

## Release gates
- Staging SQL regression suites, Web unit/typecheck/build, local Chromium CI all green at reviewed head commit.
- Protected latest Vercel Preview READY, SHA matched, stable Staging alias updated (do not reassign stale deploy).
- Live authenticated Admin and Instructor verify Sat/Mon/Wed (10) and Sun/Tue/Thu (15) create/lecture/attendance/check-in/late-enrolment/Excel examples.
- Parallel Active-Camp tests must verify two real user-role sessions, cross-Camp isolation, Backup conflicts and final Finance statements.
- No automatic Production migration, merge, or deployment.
