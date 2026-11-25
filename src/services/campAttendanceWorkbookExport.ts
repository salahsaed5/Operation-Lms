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
  // Group membership is evaluated at the report cutoff; preserve earlier attendance after transfers.
  const reportStudents = students.filter(st=>st.campId===camp.id&&(!groupId||resolveStudentOriginGroupForDay({student:st,transfers:studentTransfers,campDay:camp.durationDays})===groupId));
  const selectedIds=new Set(reportStudents.map(st=>st.id));
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
  const byLecture=new Map(attendanceSheets.filter(sh=>sh.campId===camp.id).map(sh=>[sh.lectureId,sh]));
  const validLectures=lectures.filter(l=>l.campId===camp.id&&l.campDay>=1&&l.campDay<=dayCount&&l.status!=='cancelled');
  const primaryLectures=validLectures.filter(l=>!groupId||l.groupId===groupId);
  const isFinal=(sh?:AttendanceSheet)=>sh?.status===AttendanceSheetStatus.SUBMITTED||sh?.status===AttendanceSheetStatus.LOCKED;
  // External sessions are included only when selected students have a saved mark;
  // no unrelated student totals leak into a group workbook.
  const relevantLectures=validLectures.filter(l=>!groupId||l.groupId===groupId||byLecture.get(l.id)?.records.some(r=>selectedIds.has(r.studentId)))
    .sort((a,b)=>a.campDay-b.campDay||a.periodNumber-b.periodNumber||a.id.localeCompare(b.id));
  const primaryFinalized=primaryLectures.filter(l=>isFinal(byLecture.get(l.id))).length;
  const primaryPending=primaryLectures.length-primaryFinalized;
  const externalCount=relevantLectures.length-primaryLectures.length;
  const unresolved=grid.rows.some(r=>r.days.includes('Pending'));
  const codeOf = (groupId:string) =>
    groups.find(g => g.id === groupId && g.campId === camp.id)?.code || 'Unknown';
  const generated = new Date().toLocaleString('en-GB',{timeZone:'Africa/Cairo'});
  const selectionLabel = groupId ? (' | Group ' + codeOf(groupId)) : ' | All groups';
  // A draft or active Camp is never represented as a signed final handover.
  const provisional = camp.status !== 'archived' || relevantLectures.some(l=>!isFinal(byLecture.get(l.id))) || unresolved;
  const reportState = provisional ? 'PROVISIONAL — NOT FINAL' : 'FINAL';
  const subtitle = camp.code + selectionLabel + ' | ' + camp.nameEn + ' | ' + camp.startDate +
    ' to ' + camp.endDate + ' | ' + reportState + ' | Cairo generated ' + generated;

  const summaryRows:ExcelCell[][]=[
    headingRow('CITS LMS  |  تقرير الحضور والغياب  |  ' + reportState,8),
    subheadingRow(subtitle,8),
    Array.from({length:8},blank),
    [c('إجمالي الطلاب',3),c(official.enrolled,10),c('الحاضرون',3),c(official.everAttended,5),c('لم يحضروا',3),c(official.neverAttended,7),c('غير محسوم',3),c(official.noFinalizedLectureYet,9)],
    [c('Camp code',4),c(camp.code,4)],
    [c('Camp name',4),c(camp.nameEn,4)],
    [c('Period',4),c(camp.startDate + ' to ' + camp.endDate,4)],
    [c('Students registered',4),c(official.enrolled,10)],
    [c('Students attended at least once (finalized)',4),c(official.everAttended,10)],
    [c('Never attended any finalized eligible lecture',4),c(official.neverAttended,10)],
    [c('Awaiting an eligible finalized lecture',4),c(official.noFinalizedLectureYet,10)],
    [c(groupId?'Finalized lectures in selected group':'Finalized lectures',4),c(primaryFinalized,10)],
    [c('Scheduled but not finalized (selected scope)',4),c(primaryPending,10)],
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
    [c(groupId?'Group roster at report cutoff; previous group / visitor records retained. External sessions: '+externalCount:'Lecture totals cover the full camp.',4)],
  ];
  summaryRows.push(Array.from({length:8},blank),[c('المجموعة',3),c('إجمالي الطلاب',3),c('الحاضرون',3),c('لم يحضروا',3),c('غير محسوم',3)]);
  for(const g of groups.filter(g=>g.campId===camp.id && (!groupId||g.id===groupId))){
    const members=official.students.filter(st=>st.homeGroupId===g.id);
    summaryRows.push([c(g.nameAr||g.nameEn,4),c(members.length,10),c(members.filter(s=>s.category==='attended').length,5),c(members.filter(s=>s.category==='never_attended').length,7),c(members.filter(s=>s.category==='pending').length,9)]);
  }
  const summary:ExcelSheet={
    name:'الملخص',
    rightToLeft:true,
    rows:summaryRows,
    widths:[48,28,22,18,22,18,22,18],
    merges:['A1:H1','A2:H2','A15:H15','A23:H23','A24:H24','A25:H25','A26:H26','A27:H27'],
    freeze:{columns:0,rows:4,topLeft:'A5'},
  };

  const dailyRows:ExcelCell[][]=[
    headingRow('CITS LMS  |  ' + reportState + ' ' + dayCount + '-DAY ATTENDANCE',dailyWidth),
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
    widths:[20,40,23,13,...Array.from({length:dayCount},()=>14),18,15,17,17],
    merges:['A1:'+lastCol+'1','A2:'+lastCol+'2','A3:'+lastCol+'3'],
    freeze:{columns:4,rows:4,topLeft:'E5'},
    autoFilter:'A4:'+lastCol+Math.max(5,lastDataRow),
  };

  // The reference report has a complete roster and separate attended/absent lists.
  // Only submitted/locked lecture rows count. A late mark counts as attended;
  // excused/pending and pre-enrollment lectures must never become false absences.
  type LectureCounts = { attended: number; absent: number; eligible: number };
  const lectureCounts = new Map<string,LectureCounts>();
  const scopeLectureById = new Map(validLectures.map(l=>[l.id,l]));
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

  const rosterSheet = (name:string, category?:'attended'|'never_attended'|'pending'):ExcelSheet => {
    const listed=official.students.filter(st=>category?st.category===category:true);
    const rows:ExcelCell[][]=[
      headingRow('CITS LMS  |  تقرير الحضور والغياب  |  '+reportState,8),
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
      const rowStyle=rows.length%2===0?4:12;
      rows.push([
        c(st.fullName,rowStyle),c(st.studentCode,rowStyle),c(codeOf(st.homeGroupId),rowStyle),
        c(st.joinedCampDay,10),c(counts.eligible,10),c(counts.attended,5),
        c(counts.absent,counts.absent>0?7:10),
        c(status,st.category==='attended'?5:st.category==='never_attended'?7:9),
      ]);
    }
    if(!listed.length)rows.push([c('لا يوجد طلاب في هذه الفئة',4)]);
    return {
      name,rows,rightToLeft:true,widths:[40,22,23,18,23,21,20,25],
      merges:['A1:H1','A2:H2'],freeze:{columns:2,rows:4,topLeft:'C5'},
      autoFilter:'A4:H'+Math.max(5,rows.length),
    };
  };
  const allRoster=rosterSheet('إجمالي الطلاب');
  const attendedRoster=rosterSheet('الطلاب الحاضرون','attended');
  const absentRoster=rosterSheet('الطلاب الغائبون','never_attended');
  const pendingRoster=rosterSheet('حضور غير محسوم','pending');

  const detailRows:ExcelCell[][]=[
    headingRow('CITS LMS  |  ' + reportState + ' LECTURE AUDIT',12),
    subheadingRow(subtitle,12),
    subheadingRow('Only finalized records. Group export counts selected roster only; external sessions indicate visits / prior assignments.',12),
    [
      c('Day',3),c('Date',3),c('Period',3),c('Group',3),c('Topic',3),
      c('Sheet Status',3),c('Present',3),c('Late',3),c('Absent',3),c('Visitors',3),c('Excused',3),c('Scope',3),
    ],
  ];
  for(const l of relevantLectures){
    const sheet=byLecture.get(l.id);
    const finalized=sheet?.status===AttendanceSheetStatus.SUBMITTED ||
      sheet?.status===AttendanceSheetStatus.LOCKED;
    const records=finalized ? (sheet?.records||[]).filter(r=>selectedIds.has(r.studentId)) : [];
    const count=(mark:AttendanceMark)=>records.filter(r=>r.mark===mark).length;
    detailRows.push([
      c(l.campDay,10),c(l.lectureDate,4),c(l.periodNumber,10),
      c(codeOf(l.groupId),4),c(l.topic,4),
      c(finalized?'Finalized':'Pending',finalized?5:9),
      finalized?c(count(AttendanceMark.PRESENT),10):c('—',8),
      finalized?c(count(AttendanceMark.LATE),10):c('—',8),
      finalized?c(count(AttendanceMark.ABSENT),10):c('—',8),
      finalized?c(records.filter(r=>r.isCrossGroup && (r.mark===AttendanceMark.PRESENT || r.mark===AttendanceMark.LATE)).length,10):c('—',8),
      finalized?c(count(AttendanceMark.EXCUSED),10):c('—',8),
      c(groupId&&l.groupId!==groupId?'External / selected students only':'Scheduled group',4),
    ]);
  }
  const detail:ExcelSheet={
    name:'Lecture Details',rows:detailRows,
    widths:[11,17,12,22,30,18,14,14,14,15,14,32],
    merges:['A1:L1','A2:L2','A3:L3'],
    freeze:{columns:0,rows:4,topLeft:'A5'},
    autoFilter:'A4:L'+Math.max(5,detailRows.length),
  };
  return createXlsxWorkbook([summary,allRoster,attendedRoster,absentRoster,daily,detail,pendingRoster]);
}
