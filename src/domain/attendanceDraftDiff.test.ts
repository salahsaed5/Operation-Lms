import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAttendanceDraftRows, compareAttendanceServerRows, persistedAttendanceRows, unsafeAttendanceDraftConflicts } from './attendanceDraftDiff';
import { AttendanceMark, type AttendanceRecordItem } from '../types/database';

const row = (id: string, mark: AttendanceMark | 'unmarked'): AttendanceRecordItem => ({
  studentId: id, studentCode: id, studentName: id,
  originGroupId: 'G1', attendedGroupId: 'G1', isCrossGroup: false, mark,
});

test('reordering alone is not a conflict', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [row('1', AttendanceMark.PRESENT), row('2', AttendanceMark.LATE)],
    [row('2', AttendanceMark.LATE), row('1', AttendanceMark.PRESENT)]), []);
});

test('different marks flag the student and prevent silent overwrite', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [row('1', AttendanceMark.PRESENT), row('2', AttendanceMark.PRESENT)],
    [row('1', AttendanceMark.PRESENT), row('2', AttendanceMark.LATE)]), ['2']);
});

test('unmarked local draft differs from server absent', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [row('1', 'unmarked')], [row('1', AttendanceMark.ABSENT)]), ['1']);
});

test('missing or added students are conflicts', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [row('1', AttendanceMark.PRESENT)],
    [row('1', AttendanceMark.PRESENT), row('2', AttendanceMark.ABSENT)]), ['2']);
});

test('origin/visited group change is a conflict even if mark same', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [{ ...row('1', AttendanceMark.PRESENT), attendedGroupId: 'G2', isCrossGroup: true }],
    [row('1', AttendanceMark.PRESENT)]), ['1']);
});

test('duplicate student rows cannot pass comparison', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [row('1', AttendanceMark.PRESENT), row('1', AttendanceMark.PRESENT)],
    [row('1', AttendanceMark.PRESENT)]), ['1']);
});

test('note differences are material for audited attendance', () => {
  assert.deepEqual(compareAttendanceDraftRows(
    [{ ...row('1', AttendanceMark.LATE), note: 'Transport delay' }],
    [{ ...row('1', AttendanceMark.LATE), note: 'Medical' }]), ['1']);
});

test('local edits are not mistaken for concurrent changes when known baseline matches server', () => {
  const expected = [row('1', AttendanceMark.ABSENT)];
  const edited = [row('1', AttendanceMark.PRESENT)];
  const server = [row('1', AttendanceMark.ABSENT)];
  assert.deepEqual(compareAttendanceServerRows(expected, server), []);
  assert.deepEqual(compareAttendanceDraftRows(edited, server), ['1']);
});

test('concurrent server changes are rejected relative to baseline', () => {
  const baseline = [row('1', AttendanceMark.PRESENT)];
  const serverChanged = [row('1', AttendanceMark.LATE)];
  assert.deepEqual(compareAttendanceServerRows(baseline, serverChanged), ['1']);
});

test('unmarked roster placeholders never appear in persisted server comparisons', () => {
  const local = [row('1', AttendanceMark.PRESENT), row('2', 'unmarked')];
  const server = [row('1', AttendanceMark.PRESENT)];
  assert.deepEqual(persistedAttendanceRows(local).map(r => r.studentId), ['1']);
  assert.deepEqual(compareAttendanceServerRows(local, server), []);
});

test('legacy offline draft without a baseline must match server to be safe', () => {
  const local = [row('1', AttendanceMark.LATE)];
  const server = [row('1', AttendanceMark.PRESENT)];
  assert.deepEqual(compareAttendanceServerRows(local, server), ['1']);
});

test('offline submit: self-edited mark is allowed when server still equals the original baseline', () => {
  const baseline = [row('s1', AttendanceMark.ABSENT), row('s2', AttendanceMark.LATE)];
  const desired = [row('s1', AttendanceMark.PRESENT), row('s2', AttendanceMark.LATE)];
  assert.deepEqual(unsafeAttendanceDraftConflicts(baseline, desired, baseline), []);
});

test('offline submit: true concurrent server change is blocked even when desired mark differs', () => {
  const baseline = [row('s1', AttendanceMark.ABSENT)];
  const desired = [row('s1', AttendanceMark.PRESENT)];
  const server = [row('s1', AttendanceMark.LATE)];
  assert.deepEqual(unsafeAttendanceDraftConflicts(baseline, desired, server), ['s1']);
});

test('offline submit: desired state already matches server is safely idempotent', () => {
  const baseline = [row('s1', AttendanceMark.ABSENT)];
  const desired = [row('s1', AttendanceMark.PRESENT)];
  assert.deepEqual(unsafeAttendanceDraftConflicts(baseline, desired, desired), []);
});

test('offline submit: old draft with no saved server baseline fails closed', () => {
  const desired = [row('s1', AttendanceMark.PRESENT)];
  const server = [row('s1', AttendanceMark.ABSENT)];
  assert.deepEqual(unsafeAttendanceDraftConflicts(undefined, desired, server), ['s1']);
});

test('offline submit: local unmarked placeholders do not generate fake server drift', () => {
  const baseline = [row('s1', AttendanceMark.PRESENT)];
  const desired = [row('s1', AttendanceMark.PRESENT), row('s2', 'unmarked')];
  assert.deepEqual(unsafeAttendanceDraftConflicts(baseline, desired, baseline), []);
});
