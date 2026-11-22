import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGpsVerification, requiredGpsAccuracyMeters } from './checkinGpsQuality';

test('100m geofence requires ≤50m accuracy', () => {
  assert.equal(requiredGpsAccuracyMeters(100), 50);
  assert.equal(requiredGpsAccuracyMeters(40), 20);
});
test('no fix cannot be verified', () => {
  assert.equal(classifyGpsVerification(null, 100), 'missing');
});
test('fresh GPS close to center qualifies', () => {
  assert.equal(classifyGpsVerification({ distance: 22, accuracy: 8 }, 100), 'good');
});
test('25km browser/IP GPS is rejected', () => {
  assert.equal(classifyGpsVerification({ distance: 20, accuracy: 25000 }, 100), 'poor');
});
test('small uncertainty that extends across border is not verified', () => {
  assert.equal(classifyGpsVerification({ distance: 95, accuracy: 12 }, 100), 'uncertain');
});
test('outside radius requires review even with accurate coordinates', () => {
  assert.equal(classifyGpsVerification({ distance: 115, accuracy: 4 }, 100), 'outside');
});
test('invalid location values cannot be good', () => {
  assert.equal(classifyGpsVerification({ distance: -2, accuracy: 2 }, 100), 'poor');
  assert.equal(classifyGpsVerification({ distance: 5, accuracy: NaN }, 100), 'poor');
});
