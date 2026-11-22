import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRosterGridToRows } from './studentRosterFile';

test('Excel roster: recognized English headings and actual row numbers', () => {
  const rows = mapRosterGridToRows([
    { physicalRow: 1, cells: ['Full Name', 'Student Code', 'University'] },
    { physicalRow: 2, cells: ['Test Student One', 'STG-001', 'Test University'] },
    { physicalRow: 5, cells: ['Test Student Two', 'STG-002', 'Another University'] },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rowNumber: 2, studentName: 'Test Student One',
    studentCode: 'STG-001', university: 'Test University',
  });
  assert.equal(rows[1].rowNumber, 5);
});

test('Excel roster: Arabic headings and reordered columns', () => {
  const rows = mapRosterGridToRows([
    { physicalRow: 1, cells: ['كود الطالب', 'الجامعة', 'اسم الطالب'] },
    { physicalRow: 2, cells: ['STG-007', 'جامعة اختبار', 'طالب تجريبي'] },
  ]);
  assert.deepEqual(rows[0], {
    rowNumber: 2, studentName: 'طالب تجريبي',
    studentCode: 'STG-007', university: 'جامعة اختبار',
  });
});

test('Excel roster: refuse incomplete recognized headers', () => {
  assert.throws(() => mapRosterGridToRows([
    { physicalRow: 1, cells: ['Student Code', 'University'] },
    { physicalRow: 2, cells: ['STG-001', 'Test University'] },
  ]), /Full Name and Student Code/);
});

test('Excel roster: reject headings with no students', () => {
  assert.throws(() => mapRosterGridToRows([
    { physicalRow: 1, cells: ['Full Name', 'Student Code', 'University'] },
  ]), /no students/);
});

test('Excel roster: data without headings uses documented column order', () => {
  const rows = mapRosterGridToRows([
    { physicalRow: 1, cells: ['Test Student', 'STG-001', 'Test University'] },
  ]);
  assert.equal(rows[0].studentCode, 'STG-001');
});

test('Excel roster: reject oversized batches', () => {
  const rows = Array.from({ length: 1002 }, (_, i) => ({
    physicalRow: i + 1, cells: [`Test Student ${i}`, `STG-${i}`, 'Test'],
  }));
  assert.throws(() => mapRosterGridToRows(rows), /at most 1000/);
});
