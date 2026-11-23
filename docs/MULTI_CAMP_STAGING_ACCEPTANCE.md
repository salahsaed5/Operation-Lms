# Parallel Active Camps — Staging acceptance (Phase 8)

**Scope:** Multiple 10-day and 15-day Camps operating at the same time.
**Staging project:** `uewhudbufykfkhimvqjj`.
**Production project:** `wdmlxsgbjkboadkeekdq` — untouched; no production migration/promotion is authorized.

## Change set

- `0026` weekday schedule and real teaching-day dates; `0027` correct mid-Camp student join day; `0028` no off-day Instructor check-in.
- `0029` remove global single-active restriction and enforce same-calendar-date, overlapping-time Instructor/room availability across Camps.
- `0030` approved Backup activity reserves that Instructor's actual time even without an independent timetable. Approval of overlapping Backup/Primary or Backup/Backup is refused.
- Role-scoped **Working Camp** selector in Admin and Instructor headers. Switching resets old attendance lecture selection and routes. Instructors cannot choose Camps where they have no assignment, lectures or Backup work.
- Dashboard counts no longer default to all Instructors when an individual Camp has zero assignments. Admin attendance sheets, groups, student import, finance statements and exports follow selected Camp ID.

## Real end-to-end UAT (not yet run)

1. Admin AAL2: create **Camp A** with start date Sat 2026-11-28, weekdays Sat/Mon/Wed and **10 teaching days**. Verify Day 10 = 2026-12-19.
2. Admin AAL2: create **Camp B** with start date Sun 2026-11-29, weekdays Sun/Tue/Thu and **15 teaching days**. Verify Day 15 = 2026-12-31.
3. Activate **both**; verify both show ACTIVE concurrently without affecting each other's `currentCampDay`, settings, room/group rosters or archived history.
4. Switch the Admin Working Camp selector from A to B on Schedule, Attendance, Students and Finance. Confirm no students, check-ins, daily transport or ledger amounts are mixed. Return to A and confirm original data unchanged.
5. Give a single Instructor legitimate assignments in both Camps. Verify their selector offers only these two Camps; switching changes their dates, rosters, check-ins and own-only financial statements without logout. Repeat for a Backup-only Instructor assigned to one Camp.
6. Attempt to open an unrelated Camp through devtools/REST while logged in as Instructor: RLS must deny it. Check archived own Camp statement remains visible but archived mutation is rejected.
7. Test two non-overlapping assignments on different calendar dates: both should be allowed. Try same real date/time in different Camps for Instructor and for room: both should be rejected. Test Primary-vs-Backup and Backup-vs-Backup collision across Camps.
8. On each selected Camp Day, submit verified GPS/selfie only on the actual Cairo teaching date. Off-day submissions should fail, even if the client sends a request. A mid-Camp student added on Day 4 must not count as absent on Days 1–3.
9. Export separate 10-day and 15-day attendance workbooks. Verify exact date headings and no other Camp's students. Check Backup pay, one transport allowance per eligible primary day, posted payments, refunds and final per-Camp balances.
10. Verify archived Camp safety, offline attendance drafts and return-to-Camp synchronization. Capture evidence and obtain Admin acceptance.

## CI and data safety

- `supabase/tests/camp_0029_parallel_active_and_double_booking_regression.sql`: rollback-only parallel activation, independent teaching-day counters and resource conflict test.
- `supabase/tests/camp_0030_parallel_backup_booking_regression.sql`: rollback-only Primary/Backup and Backup/Backup collision regression. Creates only synthetic relational fixtures that are rolled back.
- Staging Database Acceptance includes **17 transactional suites**, plus Web CI, sandbox Chromium and Edge CORS runs.
- Before user acceptance, verify deployed Vercel Preview and stable staging alias **Git commit SHA exactly matches the reviewed branch head**; an older READY build is not sufficient.
- Do not add irreversible Finance QA payments to the shared Staging Camp or change Production.
