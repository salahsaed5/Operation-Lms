import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixedTimetableRows} from './fixedTimetable';
import {LectureStatus,type Group,type Lecture} from '../types/database';

const g: Group={id:'g',campId:'c',code:'G1',nameEn:'Python G1',nameAr:'G1',track:'Python',primaryInstructorId:'i',defaultRoomId:'r',fixedPeriodNumber:2,capacity:20};
const l=(id:string,day:number,overrides:Partial<Lecture>={}):Lecture=>({id,campId:'c',campDay:day,lectureDate:'2026-12-01',periodNumber:2,startTime:'09:00',endTime:'11:00',durationHours:2,groupId:'g',instructorId:'i',substituteInstructorId:null,roomId:'r',topic:'Python',status:LectureStatus.SCHEDULED,frozenRateEgp:300,instructorAcknowledgedAt:null,revisionNumber:1,...overrides});

test('fixed assignment remains visible with zero daily sessions',()=>{
 const rows=fixedTimetableRows([g],[],[1,2]);
 assert.equal(rows.length,1);assert.equal(rows[0].periodNumber,2);assert.equal(rows[0].scheduledDays,0);assert.equal(rows[0].fixed,true);
});
test('daily sessions are deduplicated and exceptions do not change fixed assignment',()=>{
 const rows=fixedTimetableRows([g],[l('1',1),l('2',2,{substituteInstructorId:'sub'}),l('3',3,{roomId:'other'}),l('4',4,{status:LectureStatus.CANCELLED}),l('5',1),l('6',5,{campId:'other'})],[1,2]);
 assert.equal(rows.length,1);assert.equal(rows[0].instructorId,'i');assert.equal(rows[0].roomId,'r');assert.equal(rows[0].scheduledDays,2);
});
test('legacy patterns remain visible but explicitly unconfirmed',()=>{
 const rows=fixedTimetableRows([{...g,fixedPeriodNumber:null}],[l('1',1),l('2',2),l('3',3,{periodNumber:1})],[1,2]);
 assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.fixed));assert.deepEqual(rows.map(r=>r.scheduledDays),[1,2]);
});
