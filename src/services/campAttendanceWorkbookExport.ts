import type {
  Camp, Group, Lecture, Student, StudentTransfer, AttendanceSheet,
} from '../types/database';
import { AttendanceMark, AttendanceSheetStatus } from '../types/database';
import { buildCampToDateReport } from '../domain/campCumulativeAttendance';
import { buildCampAttendanceExcelGrid, type DayAttendanceCode } from '../domain/campAttendanceExcelGrid';
import { createXlsxWorkbook, excelCell as c, excelFormula as f, type ExcelCell, type ExcelSheet } from './tinyXlsxWorkbook';

const statusStyle = (status: DayAttendanceCode): number => {
  switch (status) {
    case 'P': return 5;
    case 'L': return 6;
    case 'A': return 7;
    case 'E': return 8;
    case 'Pending': return 9;
    default: return 8;
  }
};
const blank = ():ExcelCell => ({});
const headingRow = (title:string, width:number):ExcelCell[] => [
  c(title,1),...Array.from({length:width-1},blank),
];
const subheadingRow = (title:string, width:number):ExcelCell[] => [
  c(title,2),...Array.from({length:width-1},blank),
];

export function buildCampAttendanceWorkbook(input: {
  camp: Camp;
  groups: Group[];
  students: Student[];
  studentTransfers: StudentTransfer[];
  lectures: Lecture[];
  attendanceSheets: AttendanceSheet[];
}): Blob {
  const { camp, groups, students, studentTransfers, lectures, attendanceSheets } = input;
  if (camp.durationDays !== 10) {
    throw new Error('The handover workbook currently supports ten-day camps only.');
  }
  const official = buildCampToDateReport({
    campId: camp.id, asOfDay: 10, students, lectures,
    attendanceSheets, studentTransfers,
  });
  const grid = buildCampAttendanceExcelGrid({
    campId: camp.id, durationDays: camp.durationDays,
    students, studentTransfers, lectures, attendanceSheets,
  });
  const codeOf = (groupId:string) =>
    groups.find(g => g.id === groupId && g.campId === camp.id)?.code || 'Unknown';
  const generated = new Date().toLocaleString('en-GB',{timeZone:'Africa/Cairo'});
  // A draft or active Camp is never represented as a signed final handover.
  const provisional = camp.status !== 'archived' || grid.pendingLectures > 0;
  const reportState = provisional ? 'PROVISIONAL — NOT FINAL' : 'FINAL';
  const subtitle = camp.code + ' | ' + camp.nameEn + ' | ' + camp.startDate +
    ' to ' + camp.endDate + ' | ' + reportState + ' | Cairo generated ' + generated;

  const summaryRows:ExcelCell[][]=[
    headingRow('OPERATION LMS  |  ' + reportState + ' CAMP ATTENDANCE REPORT',8),
    subheadingRow(subtitle,8),
    Array.from({length:8},blank),
    [c('CAMP SUMMARY',3),c('Value',3)],
    [c('Camp code',4),c(camp.code,4)],
    [c('Camp name',4),c(camp.nameEn,4)],
    [c('Period',4),c(camp.startDate + ' to ' + camp.endDate,4)],
    [c('Students registered',4),c(official.enrolled,10)],
    [c('Students attended at least once (finalized)',4),c(official.everAttended,10)],
    [c('Never attended any finalized eligible lecture',4),c(official.neverAttended,10)],
    [c('Awaiting an eligible finalized lecture',4),c(official.noFinalizedLectureYet,10)],
    [c('Finalized lectures',4),c(grid.finalizedLectures,10)],
    [c('Scheduled but not finalized',4),c(grid.pendingLectures,10)],
    Array.from({length:8},blank),
    [c('DAILY STATUS LEGEND',3)],
    [c('P',5),c('Present',4)],
    [c('L',6),c('Late (counts as attended)',4)],
    [c('A',7),c('Absent in finalized lecture(s)',4)],
    [c('E',8),c('Excused (not counted absent)',4)],
    [c('Pending',9),c('Unfinalized or missing records: never counted absent',4)],
    [c('—',8),c('Not enrolled yet / no applicable lecture',4)],
    Array.from({length:8},blank),
    [c('IMPORTANT',3)],
    [c('Only finalized server records are official. Offline/Draft data are excluded.',4)],
    [c('Student appears once, even if visiting another group or attending multiple same-day lectures.',4)],
    [c('A student joining on Day 4 has Days 1–3 marked —, NOT absent.',4)],
  ];
  const summary:ExcelSheet={
    name:'Summary',
    rows:summaryRows,
    widths:[53,38,16,16,16,16,16,16],
    merges:['A1:H1','A2:H2','A15:H15','A23:H23','A24:H24','A25:H25','A26:H26'],
    freeze:{columns:0,rows:4,topLeft:'A5'},
  };

  const dailyRows:ExcelCell[][]=[
    headingRow('OPERATION LMS  |  ' + reportState + ' TEN-DAY ATTENDANCE',18),
    subheadingRow(subtitle,18),
    subheadingRow('P = Present | L = Late | A = Absent | E = Excused | Pending = Not Final | — = Not Applicable',18),
    [
      c('Student Code',3),c('Full Name',3),c('Home Group',3),c('Join Day',3),
      ...Array.from({length:10},(_,i)=>c('Day '+(i+1),3)),
      c('Days Attended',3),c('Late Days',3),c('Absent Days',3),c('Attendance %',3),
    ],
  ];
  for (let i=0;i<grid.rows.length;i++) {
    const st=grid.rows[i], rowNo=i+5;
    const rate=st.eligibleFinalDays ? st.presentDays/st.eligibleFinalDays : 0;
    const cells:ExcelCell[]=[
      c(st.studentCode,4),c(st.fullName,4),c(codeOf(st.homeGroupId),4),c(st.joinedCampDay,10),
      ...st.days.map(day => c(day,statusStyle(day))),
      f('COUNTIF(E'+rowNo+':N'+rowNo+',"P")+COUNTIF(E'+rowNo+':N'+rowNo+',"L")',st.presentDays),
      f('COUNTIF(E'+rowNo+':N'+rowNo+',"L")',st.lateDays),
      f('COUNTIF(E'+rowNo+':N'+rowNo+',"A")',st.absentDays),
      st.eligibleFinalDays > 0\n        ? f('IFERROR(O'+rowNo+'/(O'+rowNo+'+Q'+rowNo+'),0)',rate,11)\n        : c('N/A',10),
    ];
    dailyRows.push(cells);
  }
  const lastDataRow=grid.rows.length+4;
  if(grid.rows.length>0){
    const totalRow=lastDataRow+1;
    dailyRows.push([
      c('TOTAL',3),c('',3),c('',3),c('',3),
      ...Array.from({length:10},blank),
      f('SUM(O5:O'+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.presentDays,0)),
      f('SUM(P5:P'+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.lateDays,0)),
      f('SUM(Q5:Q'+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.absentDays,0)),
      c('',4),
    ]);
    void totalRow;
  }
  const daily:ExcelSheet={
    name:'Daily Attendance',
    rows:dailyRows,
    widths:[19,31,17,13,...Array.from({length:10},()=>13),18,15,17,17],
    merges:['A1:R1','A2:R2','A3:R3'],
    freeze:{columns:4,rows:4,topLeft:'E5'},
    autoFilter:'A4:R'+Math.max(5,lastDataRow),
  };

  const sheets = attendanceSheets.filter(sh=>sh.campId===camp.id);
  const byLecture=new Map(sheets.map(sh=>[sh.lectureId,sh]));
  const relevantLectures=lectures.filter(l=>l.campId===camp.id && l.status!=='cancelled')
    .sort((a,b)=>a.campDay-b.campDay || a.periodNumber-b.periodNumber);
  const detailRows:ExcelCell[][]=[
    headingRow('OPERATION LMS  |  ' + reportState + ' LECTURE AUDIT',10),
    subheadingRow(subtitle,10),
    subheadingRow('Only Submitted/Locked attendance is counted in the daily attendance sheet',10),
    [
      c('Day',3),c('Date',3),c('Period',3),c('Group',3),c('Topic',3),
      c('Sheet Status',3),c('Present',3),c('Late',3),c('Absent',3),c('Visitors',3),
    ],
  ];
  for(const l of relevantLectures){
    const sheet=byLecture.get(l.id);
    const finalized=sheet?.status===AttendanceSheetStatus.SUBMITTED ||
      sheet?.status===AttendanceSheetStatus.LOCKED;
    const records=finalized ? sheet?.records||[] : [];
    const count=(mark:AttendanceMark)=>records.filter(r=>r.mark===mark).length;
    detailRows.push([
      c(l.campDay,10),c(l.lectureDate,4),c(l.periodNumber,10),
      c(codeOf(l.groupId),4),c(l.topic,4),
      c(finalized?'Finalized':'Pending',finalized?5:9),
      finalized?c(count(AttendanceMark.PRESENT),10):c('—',8),
      finalized?c(count(AttendanceMark.LATE),10):c('—',8),
      finalized?c(count(AttendanceMark.ABSENT),10):c('—',8),
      finalized?c(records.filter(r=>r.isCrossGroup && (r.mark===AttendanceMark.PRESENT || r.mark===AttendanceMark.LATE)).length,10):c('—',8),
    ]);
  }
  const detail:ExcelSheet={
    name:'Lecture Details',rows:detailRows,
    widths:[11,17,12,17,40,18,14,14,14,15],
    merges:['A1:J1','A2:J2','A3:J3'],
    freeze:{columns:0,rows:4,topLeft:'A5'},
    autoFilter:'A4:J'+Math.max(5,detailRows.length),
  };
  return createXlsxWorkbook([summary,daily,detail]);
}
