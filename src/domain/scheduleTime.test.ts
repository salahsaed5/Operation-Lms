import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatScheduleTime} from './scheduleTime';

test('schedule times use AM and PM, including midnight and noon',()=>{
 assert.equal(formatScheduleTime('00:00'),'12:00 AM');
 assert.equal(formatScheduleTime('09:00:00'),'9:00 AM');
 assert.equal(formatScheduleTime('12:00'),'12:00 PM');
 assert.equal(formatScheduleTime('15:00'),'3:00 PM');
 assert.equal(formatScheduleTime('21:30'),'9:30 PM');
 assert.equal(formatScheduleTime(undefined),'');
});
