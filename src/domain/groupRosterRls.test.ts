import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Static regression guard only. Authenticated Staging cross-group E2E is required.
const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/0009_instructor_group_roster_isolation.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('P0: student SELECT policy cannot fall back to camp-wide access', () => {
  const policy = migration.split('CREATE POLICY "Instructors read permitted student rosters"')[1];
  assert.ok(policy, 'Expected instructor students SELECT policy');
  const definition = policy.split('COMMIT;')[0];
  assert.match(definition, /is_instructor_assigned_to_group\(group_id\)/);
  assert.doesNotMatch(definition, /is_instructor_assigned_to_camp\(camp_id\)/);
});

test('P0: group access expires after reassignment and recognizes only current-day teaching', () => {
  assert.match(migration, /effective_from_day <= c\.current_camp_day/);
  assert.match(migration, /c\.current_camp_day < gi\.effective_to_day/);
  assert.match(migration, /l\.camp_day = c\.current_camp_day/);
  assert.match(migration, /COALESCE\(l\.substitute_instructor_id, l\.instructor_id\)/);
  assert.match(migration, /l\.status <> 'cancelled'/);
});

test('P0: group authorization helper is restricted to authenticated users', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_instructor_assigned_to_group\(UUID\) FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_instructor_assigned_to_group\(UUID\) FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_instructor_assigned_to_group\(UUID\) TO authenticated/);
});
