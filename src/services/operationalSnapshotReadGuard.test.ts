import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOperationalSnapshotQueriesSucceeded } from './operationalSnapshotReadGuard';

test('accepts successful and role-skipped operational reads', () => {
  assert.doesNotThrow(() =>
    assertOperationalSnapshotQueriesSucceeded([
      ['profiles', null],
      ['admin_accounts', null],
      ['daily_checklists', undefined],
    ])
  );
});

test('rejects a failed secondary read instead of treating it as empty data', () => {
  assert.throws(
    () =>
      assertOperationalSnapshotQueriesSucceeded([
        ['profiles', null],
        ['camp_instructors', null],
        ['group_instructors', { message: 'permission denied' }],
        ['students', null],
      ]),
    /Database query failed \(group_instructors\): permission denied/
  );
});

test('reports the first failing relation deterministically', () => {
  assert.throws(
    () =>
      assertOperationalSnapshotQueriesSucceeded([
        ['survey_results', { message: 'schema cache unavailable' }],
        ['audit_logs', { message: 'permission denied' }],
      ]),
    /Database query failed \(survey_results\): schema cache unavailable/
  );
});
