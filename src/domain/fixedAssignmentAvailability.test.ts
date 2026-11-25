import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eligibleAssignmentDays,assignmentResourceBusy} from './fixedAssignmentAvailability';
import {LectureStatus,type Lecture} from '../types/database';

const slot={period:2,start:'12:00',end:'15:00'};
const dateFor=(d:number)=>'2026-12-0'+d;
const base={draft:false,initial:true,currentDay:1,durationDays:3,dateFor,clock:{date:dateFor(1),seconds:9*3600},slot,own:[] as Lecture[],hasSavedAttendance:()=>false};
const lec=(id:string,overrides:Partial<Lecture>={}):Lecture=>({id,campId:'c',campDay:1,lectureDate:dateFor(1),periodNumber:2,startTime:'12:00',endTime:'15:00',durationHours:3,groupId:'other',instructorId:'i',substituteInstructorId:null,roomId:'r',topic:'Python',status:LectureStatus.SCHEDULED,frozenRateEgp:300,instructorAcknowledgedAt:null,revisionNumber:1,...overrides});
test('initial can start today while revision preserves today',()=>{
 assert.deepEqual(eligibleAssignmentDays(base),[1,2,3]);
 assert.deepEqual(eligibleAssignmentDays({...base,initial:false}),[2,3]);
 assert.deepEqual(eligibleAssignmentDays({...base,clock:{date:dateFor(1),seconds:13*3600}}),[2,3]);
 assert.deepEqual(eligibleAssignmentDays({...base,own:[lec('old',{startTime:'08:00'})]}),[2,3]);
 assert.deepEqual(eligibleAssignmentDays({...base,own:[lec('old')],hasSavedAttendance:()=>true}),[2,3]);
});
test('picker checks future days, real overlapping times, other camps and backup work',()=>{
 const lectures=[lec('one',{campId:'elsewhere',lectureDate:dateFor(2),periodNumber:9,startTime:'13:00',endTime:'16:00'}),lec('own',{groupId:'g',instructorId:'self',roomId:'selfroom'}),lec('cancel',{instructorId:'free',roomId:'freeroom',status:LectureStatus.CANCELLED})];
 const args={campId:'c',groupId:'g',days:[1,2,3],dateFor,slot,lectures,backups:[{lectureId:'one',instructorId:'backup',status:'pending'},{lectureId:'one',instructorId:'excluded',status:'excluded'}]};
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'i'}),true);
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'backup'}),true);
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'excluded'}),false);
 assert.equal(assignmentResourceBusy({...args,kind:'room',id:'r'}),true);
 assert.equal(assignmentResourceBusy({...args,kind:'room',id:'selfroom'}),false);
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'self'}),false);
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'free'}),false);
 assert.equal(assignmentResourceBusy({...args,kind:'room',id:'freeroom'}),false);
 assert.equal(assignmentResourceBusy({...args,kind:'instructor',id:'i',slot:{period:1,start:'09:00',end:'12:00'}}),false);
});
