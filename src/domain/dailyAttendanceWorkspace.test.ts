import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailyAttendanceProgress} from './dailyAttendanceWorkspace';
import {LectureStatus,AttendanceSheetStatus,AttendanceMark,OfflineSyncState,type Lecture,type AttendanceSheet} from '../types/database';
const lecture=(id:string,overrides:Partial<Lecture>={}):Lecture=>({id,campId:'c',campDay:1,lectureDate:'2026-11-25',periodNumber:1,startTime:'09:00',endTime:'12:00',durationHours:3,groupId:'g',instructorId:'i',substituteInstructorId:null,roomId:'r',topic:'Python',status:LectureStatus.SCHEDULED,frozenRateEgp:300,instructorAcknowledgedAt:null,revisionNumber:1,...overrides});
const sheet=(id:string,mark:'unmarked'|AttendanceMark,status=AttendanceSheetStatus.DRAFT):AttendanceSheet=>({id:'s'+id,campId:'c',lectureId:id,instructorId:'i',campDay:1,periodNumber:1,status,syncState:OfflineSyncState.SYNCED,idempotencyKey:'id-'+id,records:[{studentId:'st',studentCode:'S1',studentName:'Student',originGroupId:'g',attendedGroupId:'g',isCrossGroup:false,mark}],submittedAt:null,syncedAt:null});
test('progress excludes cancellations and future sessions from overdue; unmarked is missing, not absent',()=>{
 const ls=[lecture('final'),lecture('draft'),lecture('unmarked'),lecture('missing'),lecture('future',{startTime:'15:00',endTime:'18:00'}),lecture('cancelled',{status:LectureStatus.CANCELLED})];
 const result=dailyAttendanceProgress(ls,[sheet('final',AttendanceMark.PRESENT,AttendanceSheetStatus.SUBMITTED),sheet('draft',AttendanceMark.LATE),sheet('unmarked','unmarked')],{date:'2026-11-25',seconds:13*3600},true);
 assert.deepEqual({total:result.total,finalized:result.finalized,draft:result.draft,missing:result.missing,upcoming:result.upcoming,percent:result.percent},{total:5,finalized:1,draft:1,missing:2,upcoming:1,percent:20});
 assert.deepEqual([...result.overdueIds],['draft','unmarked','missing']);
 assert.equal(dailyAttendanceProgress(ls,[],{date:'2026-11-26',seconds:13*3600},false).overdueIds.size,0);
});
