# Session lifecycle — implementation and acceptance
- Home: actual Cairo date, assigned sessions in selected camp. Sessions: assigned, running, finished, counted, remaining; status/search filters and review details.
- Start: server clock, assigned effective instructor, active camp, draft sheet, window [start −15 minutes, scheduled end). Repeated Run is idempotent. No offline Run; offline attendance after Run still uses existing CAS/sync.
- Finish: existing audited transactional submission only after valid current revision Run; no GPS requirement; admin emergency submission without Run is pending review, not automatic entitlement. Existing eligible/approved/excluded and previously submitted history is not recalculated. Backup/transport/payment calculations unchanged.
- Instructor financial values removed from screens; existing API finance/RLS access not changed by UI work.
- Production not modified. Review migration, run SQL acceptance (early/at boundary, late, wrong instructor, duplicate, changed revision, no Run submit, old history, valid Run + attendance, finance/transport), and authenticated E2E before promoting.
- Existing sandbox attendance routes retain local editing for regression/demo compatibility; server rules are authoritative for real deployments.
