import test from 'node:test';
import assert from 'node:assert/strict';
import { studentsForSelectedLecture } from './instructorLectureRoster';
import type { Student, StudentTransfer } from '../types/database';

const student = (id: string, groupId: string, overrides: Partial<Student> = {}): Student => ({
  id, campId: 'camp', groupId, studentCode: id, fullName: id,
  university: 'University', isActive: true, joinedCampDay: 1, ...overrides,
});

const students: Student[] = [
  student('A1', 'GRP-01'),
  student('A2', 'GRP-01'),
  student('B1', 'GRP-02'),
  student('B2', 'GRP-02'),
];

test('P2 lecture assigned GRP-02 never shows P1 GRP-01 home roster', () => {
  const groupOne = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 1, groupId: 'GRP-01' },
    students, transfers: [],
  });
  const groupTwo = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 1, groupId: 'GRP-02' },
    students, transfers: [],
  });
  assert.deepEqual(groupOne.map(s => s.studentCode), ['A1', 'A2']);
  assert.deepEqual(groupTwo.map(s => s.studentCode), ['B1', 'B2']);
});

test('selected lecture roster cannot include students from another camp or deactivated records', () => {
  const result = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 1, groupId: 'GRP-02' },
    students: [
      ...students,
      student('OTHER', 'GRP-02', {campId: 'unrelated-camp'}),
      student('INACTIVE', 'GRP-02', {isActive: false}),
    ],
    transfers: [],
  });
  assert.deepEqual(result.map(s => s.id), ['B1', 'B2']);
});

test('late Day-4 joiner only enters the selected group roster on Day 4 onward', () => {
  const roster = [...students, student('JOIN4', 'GRP-02', { joinedCampDay: 4 })];
  const dayOne = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 1, groupId: 'GRP-02' },
    students: roster, transfers: [],
  });
  const dayFour = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 4, groupId: 'GRP-02' },
    students: roster, transfers: [],
  });
  assert.deepEqual(dayOne.map(s => s.id), ['B1', 'B2']);
  assert.deepEqual(dayFour.map(s => s.id), ['B1', 'B2', 'JOIN4']);
});

test('transfer changes the proper lecture roster on the effective camp day only', () => {
  const transfer: StudentTransfer = {
    id: 'trans-1', campId: 'camp', studentId: 'B1',
    fromGroupId: 'GRP-02', toGroupId: 'GRP-01',
    effectiveCampDay: 3, reason: 'reassigned', transferredBy: null,
    createdAt: '2026-11-22T12:00:00Z',
  };
  const before = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 2, groupId: 'GRP-02' },
    students, transfers: [transfer],
  });
  const after = studentsForSelectedLecture({
    lecture: { campId: 'camp', campDay: 3, groupId: 'GRP-01' },
    students, transfers: [transfer],
  });
  assert.deepEqual(before.map(s => s.id), ['B1', 'B2']);
  assert.deepEqual(after.map(s => s.id), ['A1', 'A2', 'B1']);
});
