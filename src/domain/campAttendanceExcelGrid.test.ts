import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampAttendanceExcelGrid } from './campAttendanceExcelGrid';
import { AttendanceMark, AttendanceSheetStatus, type Student, type Lecture, type AttendanceSheet } from '../types/database';

const campId='qa-camp';
const student=(id: string,group='A',join=1):Student=>({
  id,campId,groupId:group,studentCode:id,fullName:'Student '+id,
  university:'',isActive:true,joinedCampDay:join,
});
const lecture=(id:string,day:number,group='A'):Lecture=>({
  id,campId,groupId:group,campDay:day,status:'scheduled',
} as Lecture);
const sheet=(id:string,lectureId:string,marks:Array<[string,AttendanceMark]>,status=AttendanceSheetStatus.SUBMITTED):AttendanceSheet=>({
  id,campId,lectureId,status,
  records:marks.map(([studentId,mark])=>({
    studentId,studentCode:studentId,studentName:'Student '+studentId,
    originGroupId:'A',attendedGroupId:'A',isCrossGroup:false,mark,
  })),
} as AttendanceSheet);
const grid=(students:Student[],lectures:Lecture[],sheets:AttendanceSheet[])=>
  buildCampAttendanceExcelGrid({campId,durationDays:10,students,studentTransfers:[],lectures,attendanceSheets:sheets});

test('always exactly ten daily columns, even when no finalized attendance',()=>{
  const g=grid([student('s')],[lecture('l',1)],[sheet('x','l',[['s',AttendanceMark.PRESENT]],AttendanceSheetStatus.DRAFT)]);
  assert.equal(g.rows[0].days.length,10);
  assert.equal(g.rows[0].days[0],'Pending');
  assert.equal(g.rows[0].days[1],'—');
  assert.equal(g.rows[0].absentDays,0);
});

test('Day-4 joiner does not receive Day 1,2,3 absence',()=>{
  const g=grid([student('s','A',4)],[
    lecture('l1',1),lecture('l2',2),lecture('l4',4),
  ],[sheet('s1','l1',[['s',AttendanceMark.ABSENT]]),sheet('s4','l4',[['s',AttendanceMark.LATE]])]);
  assert.deepEqual(g.rows[0].days.slice(0,4),['—','—','—','L']);
  assert.equal(g.rows[0].absentDays,0);
  assert.equal(g.rows[0].presentDays,1);
  assert.equal(g.rows[0].lateDays,1);
});

test('cross-group visitor counts in home student row only',()=>{
  const g=grid([student('b','B')],[lecture('a1',1,'A')],[sheet('s','a1',[['b',AttendanceMark.PRESENT]])]);
  assert.equal(g.rows.length,1);
  assert.equal(g.rows[0].days[0],'P');
  assert.equal(g.rows[0].homeGroupId,'B');
});

test('two same-day sessions produce one P rather than double-counting',()=>{
  const g=grid([student('s')],[lecture('l1',1),lecture('l2',1)],[
    sheet('s1','l1',[['s',AttendanceMark.LATE]]),
    sheet('s2','l2',[['s',AttendanceMark.PRESENT]]),
  ]);
  assert.equal(g.rows[0].days[0],'P');
  assert.equal(g.rows[0].presentDays,1);
});

test('pending session prevents premature A until all lectures on day final',()=>{
  const g=grid([student('s')],[lecture('l1',1),lecture('l2',1)],[
    sheet('s1','l1',[['s',AttendanceMark.ABSENT]]),
    sheet('s2','l2',[['s',AttendanceMark.ABSENT]],AttendanceSheetStatus.DRAFT),
  ]);
  assert.equal(g.rows[0].days[0],'Pending');
  assert.equal(g.rows[0].absentDays,0);
});

test('no attendance record on a finalized due lecture remains Pending, not guessed absent',()=>{
  const g=grid([student('s')],[lecture('l',1)],[sheet('s','l',[])]);
  assert.equal(g.rows[0].days[0],'Pending');
});

test('excused absence uses E, not A',()=>{
  const g=grid([student('s')],[lecture('l',1)],[sheet('s','l',[['s',AttendanceMark.EXCUSED]])]);
  assert.equal(g.rows[0].days[0],'E');
  assert.equal(g.rows[0].absentDays,0);
});
