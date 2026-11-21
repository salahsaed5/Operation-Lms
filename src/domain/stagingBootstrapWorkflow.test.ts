import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(
  path.resolve(process.cwd(), '.github/workflows/supabase-staging-bootstrap.yml'),
  'utf8'
);

test('Staging bootstrap is manual and inventory-only by default', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.match(workflow, /default: inventory/);
  assert.match(workflow, /if: \$\{\{ inputs\.operation == 'bootstrap' \}\}/);
});

test('Bootstrap refuses writes without exact Staging approval on main', () => {
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /BOOTSTRAP-STAGING-uewhudbufykfkhimvqjj/);
  assert.match(workflow, /wdmlxsgbjkboadkeekdq/);
  assert.match(workflow, /username == f"postgres\.\{staging\}"/);
  assert.match(workflow, /hostname == f"db\.\{staging\}\.supabase\.co"/);
  assert.match(workflow, /params\) - allowed_params/);
});

test('All eight baseline scripts are ordered and only applied to empty public schema', () => {
  assert.match(workflow, /if \[ "\$ACTUAL_TABLE_COUNT" != "0" \]/);
  const filenames = [...workflow.matchAll(/supabase\/migrations\/(000[1-8]_\w+\.sql)/g)].map(x => x[1]);
  assert.equal(filenames.length, 8);
  assert.deepEqual(filenames.map(n => n.slice(0,4)), ['0001','0002','0003','0004','0005','0006','0007','0008']);
  assert.match(workflow, /-v ON_ERROR_STOP=1 -f "\$migration"/);
});

test('Read-only inventory and post-bootstrap audit do not read user records', () => {
  assert.match(workflow, /default_transaction_read_only=on/);
  assert.match(workflow, /schemaname = 'public'/);
  assert.match(workflow, /schemaname='public' AND NOT rowsecurity/);
  assert.match(workflow, /security_0008/);
});
