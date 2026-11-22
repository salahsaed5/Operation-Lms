import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAttendanceDraftRows } from './attendanceDraftDiff';
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
