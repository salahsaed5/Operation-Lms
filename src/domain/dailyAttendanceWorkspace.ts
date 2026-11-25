import {AttendanceMark,AttendanceSheetStatus,LectureStatus,type Lecture,type AttendanceSheet} from '../types/database';
import {timeSeconds} from './fixedAssignmentAvailability';

export const isFinalAttendance=(sheet?:AttendanceSheet)=>!!sheet&&(sheet.status===AttendanceSheetStatus.SUBMITTED||sheet.status===AttendanceSheetStatus.LOCKED);
export function attendanceDeadlinePassed(l:Lecture,clock:{date:string;seconds:number},active:boolean){
 return active&&l.status!==LectureStatus.CANCELLED&&(l.lectureDate<clock.date||(l.lectureDate===clock.date&&clock.seconds>=timeSeconds(l.endTime)));
}
export function dailyAttendanceProgress(lectures:Lecture[],sheets:AttendanceSheet[],clock:{date:string;seconds:number},active:boolean){
 const valid=lectures.filter(l=>l.status!==LectureStatus.CANCELLED);
 const byLecture=new Map(sheets.map(s=>[s.lectureId,s]));
 const finalized=valid.filter(l=>isFinalAttendance(byLecture.get(l.id))).length;
 const hasMarks=(l:Lecture)=>!!byLecture.get(l.id)?.records.some(r=>r.mark!=='unmarked');
 const overdue=valid.filter(l=>attendanceDeadlinePassed(l,clock,active)&&!isFinalAttendance(byLecture.get(l.id)));
 return {total:valid.length,finalized,missing:overdue.filter(l=>!hasMarks(l)).length,draft:overdue.filter(l=>hasMarks(l)).length,upcoming:valid.length-finalized-overdue.length,overdueIds:new Set(overdue.map(l=>l.id)),percent:valid.length?Math.round(finalized/valid.length*100):0};
}
