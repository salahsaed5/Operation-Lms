import type {
  Camp, Group, Lecture, Student, StudentTransfer, AttendanceSheet,
} from '../types/database';
import { AttendanceMark, AttendanceSheetStatus } from '../types/database';
import { buildCampToDateReport } from '../domain/campCumulativeAttendance';
import { calculateCampDayDate, resolveStudentOriginGroupForDay } from '../domain/businessRules';
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
/** 1-indexed Excel column name (works beyond Z). */
const excelColumn = (col: number): string => {
  let n=col, name='';
  while(n>0){n--; name=String.fromCharCode(65+n%26)+name; n=Math.floor(n/26);}
  return name;
};
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
  groupId?: string;
}): Blob {
  const { camp, groups, students, studentTransfers, lectures, attendanceSheets, groupId } = input;
  if (groupId && !groups.some(g => g.id === groupId && g.campId === camp.id)) {
    throw new Error('Requested export group does not belong to the selected Camp.');
  }
  const reportStudents = groupId ? students.filter(st => st.groupId === groupId) : students;
  if (!Number.isInteger(camp.durationDays) || camp.durationDays < 1 || camp.durationDays > 60) {
    throw new Error('Camp report duration must be between 1 and 60 teaching days.');
  }
  const dayCount = camp.durationDays;
  const lastDayCol = excelColumn(4+dayCount);
  const presentCol = excelColumn(5+dayCount);
  const lateCol = excelColumn(6+dayCount);
  const absentCol = excelColumn(7+dayCount);
  const lastCol = excelColumn(8+dayCount);
  const dailyWidth = 8+dayCount;
  const official = buildCampToDateReport({
    campId: camp.id, asOfDay: dayCount, students: reportStudents, lectures,
    attendanceSheets, studentTransfers,
  });
  const grid = buildCampAttendanceExcelGrid({
    campId: camp.id, durationDays: camp.durationDays,
    students: reportStudents, studentTransfers, lectures, attendanceSheets,
  });
  const codeOf = (groupId:string) =>
    groups.find(g => g.id === groupId && g.campId === camp.id)?.code || 'Unknown';
  const generated = new Date().toLocaleString('en-GB',{timeZone:'Africa/Cairo'});
  const selectionLabel = groupId ? (' | Group ' + codeOf(groupId)) : ' | All groups';
  // A draft or active Camp is never represented as a signed final handover.
  const provisional = camp.status !== 'archived' || grid.pendingLectures > 0;
  const reportState = provisional ? 'PROVISIONAL — NOT FINAL' : 'FINAL';
  const subtitle = camp.code + selectionLabel + ' | ' + camp.nameEn + ' | ' + camp.startDate +
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
    headingRow('OPERATION LMS  |  ' + reportState + ' ' + dayCount + '-DAY ATTENDANCE',dailyWidth),
    subheadingRow(subtitle,dailyWidth),
    subheadingRow('P = Present | L = Late | A = Absent | E = Excused | Pending = Not Final | — = Not Applicable',dailyWidth),
    [
      c('Student Code',3),c('Full Name',3),c('Home Group',3),c('Join Day',3),
      ...Array.from({length:dayCount},(_,i)=>c('Day '+(i+1)+' · '+calculateCampDayDate(camp.startDate,i+1,camp.operatingWeekdays),3)),
      c('Days Attended',3),c('Late Days',3),c('Absent Days',3),c('Attendance %',3),
    ],
  ];
  for (let i=0;i<grid.rows.length;i++) {
    const st=grid.rows[i], rowNo=i+5;
    const rate=st.eligibleFinalDays ? st.presentDays/st.eligibleFinalDays : 0;
    const cells:ExcelCell[]=[
      c(st.studentCode,4),c(st.fullName,4),c(codeOf(st.homeGroupId),4),c(st.joinedCampDay,10),
      ...st.days.map(day => c(day,statusStyle(day))),
      f('COUNTIF(E'+rowNo+':'+lastDayCol+rowNo+',"P")+COUNTIF(E'+rowNo+':'+lastDayCol+rowNo+',"L")',st.presentDays),
      f('COUNTIF(E'+rowNo+':'+lastDayCol+rowNo+',"L")',st.lateDays),
      f('COUNTIF(E'+rowNo+':'+lastDayCol+rowNo+',"A")',st.absentDays),
      st.eligibleFinalDays > 0
        ? f('IFERROR('+presentCol+rowNo+'/('+presentCol+rowNo+'+'+absentCol+rowNo+'),0)',rate,11)
        : c('N/A',10),
    ];
    dailyRows.push(cells);
  }
  const lastDataRow=grid.rows.length+4;
  if(grid.rows.length>0){
    const totalRow=lastDataRow+1;
    dailyRows.push([
      c('TOTAL',3),c('',3),c('',3),c('',3),
      ...Array.from({length:dayCount},blank),
      f('SUM('+presentCol+'5:'+presentCol+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.presentDays,0)),
      f('SUM('+lateCol+'5:'+lateCol+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.lateDays,0)),
      f('SUM('+absentCol+'5:'+absentCol+lastDataRow+')',grid.rows.reduce((s,row)=>s+row.absentDays,0)),
      c('',4),
    ]);
    void totalRow;
  }
  const daily:ExcelSheet={
    name:'Daily Attendance',
    rows:dailyRows,
    widths:[19,31,17,13,...Array.from({length:dayCount},()=>13),18,15,17,17],
    merges:['A1:'+lastCol+'1','A2:'+lastCol+'2','A3:'+lastCol+'3'],
    freeze:{columns:4,rows:4,topLeft:'E5'},
    autoFilter:'A4:'+lastCol+Math.max(5,lastDataRow),
  };

  // The reference report has a complete roster and separate attended/absent lists.
  // Only submitted/locked lecture rows count. A late mark counts as attended;
  // excused/pending and pre-enrollment lectures must never become false absences.
  type LectureCounts = { attended: number; absent: number; eligible: number };
  const lectureCounts = new Map<string,LectureCounts>();
  const scopeLectureById = new Map(lectures.filter(l=>l.campId===camp.id && l.status!=='cancelled').map(l=>[l.id,l]));
  for (const student of reportStudents.filter(st=>st.campId===camp.id)) {
    const counts:LectureCounts={attended:0,absent:0,eligible:0};
    for (const sheet of attendanceSheets) {
      if (sheet.campId !== camp.id ||
          (sheet.status!==AttendanceSheetStatus.SUBMITTED && sheet.status!==AttendanceSheetStatus.LOCKED)) continue;
      const lecture=scopeLectureById.get(sheet.lectureId);
      if(!lecture || lecture.campDay < (student.joinedCampDay??1))continue;
      const row=sheet.records.find(rec=>rec.studentId===student.id);
      const homeGroup=resolveStudentOriginGroupForDay({student,transfers:studentTransfers,campDay:lecture.campDay});
      if(lecture.groupId!==homeGroup && !row)continue;
      counts.eligible++;
      if(row?.mark===AttendanceMark.PRESENT||row?.mark===AttendanceMark.LATE)counts.attended++;
      else if(row?.mark===AttendanceMark.ABSENT)counts.absent++;
    }
    lectureCounts.set(student.id,counts);
  }

  const rosterSheet = (name:string, category?:'attended'|'never_attended'):ExcelSheet => {
    const listed=official.students.filter(st=>category?st.category===category:true);
    const rows:ExcelCell[][]=[
      headingRow('OPERATION LMS  |  تقرير الحضور والغياب  |  '+reportState,8),
      subheadingRow(subtitle,8),
      Array.from({length:8},blank),
      [
        c('الطالب / Student',3),c('الكود / Code',3),c('المجموعة / Group',3),
        c('يوم الانضمام',3),c('إجمالي المحاضرات المعتمدة',3),
        c('محاضرات الحضور',3),c('محاضرات الغياب',3),c('الحالة',3),
      ],
    ];
    for(const st of listed){
      const counts=lectureCounts.get(st.studentId)||{attended:0,absent:0,eligible:0};
      const status=st.category==='attended'?'حاضر':
        st.category==='pending'?'لم تُحسم':
        provisional?'لم يحضر حتى الآن':'غائب';
      rows.push([
        c(st.fullName,4),c(st.studentCode,4),c(codeOf(st.homeGroupId),4),
        c(st.joinedCampDay,10),c(counts.eligible,10),c(counts.attended,5),
        c(counts.absent,counts.absent>0?7:10),
        c(status,st.category==='attended'?5:st.category==='never_attended'?7:9),
      ]);
    }
    if(!listed.length)rows.push([c('لا يوجد طلاب في هذه الفئة',4)]);
    return {
      name,rows,widths:[32,20,21,18,23,21,20,25],
      merges:['A1:H1','A2:H2'],freeze:{columns:2,rows:4,topLeft:'C5'},
      autoFilter:'A4:H'+Math.max(5,rows.length),
    };
  };
  const allRoster=rosterSheet('إجمالي الطلاب');
  const attendedRoster=rosterSheet('الطلاب الحاضرون','attended');
  const absentRoster=rosterSheet('الطلاب الغائبون','never_attended');

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
  return createXlsxWorkbook([summary,allRoster,attendedRoster,absentRoster,daily,detail]);
}
