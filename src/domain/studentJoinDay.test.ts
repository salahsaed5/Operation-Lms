import test from 'node:test';
import assert from 'node:assert/strict';
import { studentEligibleForCampDay } from './studentJoinDay';

test('initial roster can attend from day 1', () => {
  assert.equal(studentEligibleForCampDay({ joinedCampDay: 1 }, 1), true);
});

test('legacy initial student without explicit join day defaults to 1', () => {
  assert.equal(studentEligibleForCampDay({}, 1), true);
});

test('student joining on day 4 has no day 1-3 attendance eligibility', () => {
  for (const day of [1, 2, 3]) {
    assert.equal(studentEligibleForCampDay({ joinedCampDay: 4 }, day), false);
  }
});

test('student joining on day 4 appears from day 4 onwards', () => {
  for (const day of [4, 5, 10]) {
    assert.equal(studentEligibleForCampDay({ joinedCampDay: 4 }, day), true);
  }
});

test('invalid camp day or invalid joined day never qualifies', () => {
  assert.equal(studentEligibleForCampDay({ joinedCampDay: 4 }, 0), false);
  assert.equal(studentEligibleForCampDay({ joinedCampDay: 4 }, NaN), false);
  assert.equal(studentEligibleForCampDay({ joinedCampDay: -1 }, 4), false);
});
