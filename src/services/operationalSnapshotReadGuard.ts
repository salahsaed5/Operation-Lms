/**
 * Ensure every operational snapshot read completed successfully.
 *
 * A failed ancillary Supabase query must not be treated as a legitimate empty
 * dataset. Even if the main dashboard tables load, silently ignoring failures
 * for group assignments, audit logs or surveys can mislead operators.
 */
export type OperationalSnapshotQueryError = { readonly message: string } | null | undefined;

export function assertOperationalSnapshotQueriesSucceeded(
  queries: ReadonlyArray<readonly [table: string, error: OperationalSnapshotQueryError]>
): void {
  for (const [table, error] of queries) {
    if (error) {
      throw new Error(`Database query failed (${table}): ${error.message}`);
    }
  }
}
