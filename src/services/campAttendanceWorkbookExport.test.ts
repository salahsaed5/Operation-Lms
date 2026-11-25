import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendanceTableWorkbook } from './attendanceTableExport';
import { buildCampAttendanceWorkbook } from './campAttendanceWorkbookExport';
import {
  AttendanceMark, AttendanceSheetStatus, CampStatus,
  type AttendanceSheet, type Camp, type Group, type Lecture, type Student,
} from '../types/database';

function unzipStoredXml(bytes: Uint8Array): Record<string,string> {
  const result:Record<string,string>={};
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=0;
  while(offset+30<=bytes.length && view.getUint32(offset,true)===0x04034b50){
    assert.equal(view.getUint16(offset+8,true),0,'OOXML entry must be stored');
    const length=view.getUint32(offset+18,true);
    const nameLength=view.getUint16(offset+26,true);
    const extraLength=view.getUint16(offset+28,true);
    const nameOffset=offset+30;
    const dataOffset=nameOffset+nameLength+extraLength;
    const name=new TextDecoder().decode(bytes.slice(nameOffset,nameOffset+nameLength));
    result[name]=new TextDecoder().decode(bytes.slice(dataOffset,dataOffset+length));
    offset=dataOffset+length;
  }
  return result;
}

const campId='acceptance-camp';
const camp:Camp={
  id:campId, code:'STG-EXPORT-10', nameEn:'QA Ten-Day Camp', nameAr:'معسكر تجريبي',
  status:CampStatus.DRAFT, venueId:'venue',startDate:'2026-11-26',endDate:'2026-12-05',
  durationDays:10,currentCampDay:1,settings:{} as Camp['settings'],
};
const groups:Group[]=[
  {id:'A',campId,code:'GR-A',nameEn:'A',nameAr:'أ',track:'QA',defaultRoomId:'',primaryInstructorId:'inst',capacity:30},
  {id:'B',campId,code:'GR-B',nameEn:'B',nameAr:'ب',track:'QA',defaultRoomId:'',primaryInstructorId:'inst',capacity:30},
];
const students:Student[]=[
  {id:'early',campId,groupId:'A',studentCode:'QA-001',fullName:'أحمد محمد',university:'',isActive:true,joinedCampDay:1},
  {id:'joiner',campId,groupId:'A',studentCode:'QA-002',fullName:'ندى أحمد',university:'',isActive:true,joinedCampDay:4},
  {id:'visitor',campId,groupId:'B',studentCode:'QA-003',fullName:'منى خالد',university:'',isActive:true,joinedCampDay:1},
];
const lecture=(id:string,day:number):Lecture=>({
  id,campId,groupId:'A',campDay:day,lectureDate:'2026-11-26',
  periodNumber:1,topic:'Acceptance',status:'scheduled',
} as Lecture);
const record=(id:string,mark:AttendanceMark,visitor=false)=>({
  studentId:id,studentCode:students.find(s=>s.id===id)!.studentCode,
  studentName:students.find(s=>s.id===id)!.fullName,
  originGroupId:visitor?'B':'A',attendedGroupId:'A',
  isCrossGroup:visitor,mark,
});
const sheet=(id:string,lecId:string,records:ReturnType<typeof record>[]):AttendanceSheet=>({
  id,campId,lectureId:lecId,status:AttendanceSheetStatus.SUBMITTED,records,
} as AttendanceSheet);

test('full 10-day report exports reference-style OOXML sheets with Arabic, visitor and Day-4 joiner',async()=>{
  const blob=buildCampAttendanceWorkbook({
    camp,groups,students,studentTransfers:[],
    lectures:[lecture('lecture1',1),lecture('lecture4',4)],
    attendanceSheets:[
      sheet('sheet1','lecture1',[record('early',AttendanceMark.PRESENT)]),
      sheet('sheet4','lecture4',[
        record('early',AttendanceMark.ABSENT),
        record('joiner',AttendanceMark.LATE),
        record('visitor',AttendanceMark.PRESENT,true),
      ]),
    ],
  });
  const bytes=new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0],0x50);
  assert.equal(bytes[1],0x4b);
  const entries=unzipStoredXml(bytes);
  assert.ok(entries['[Content_Types].xml']);
  assert.match(entries['xl/workbook.xml'],/الملخص/);
  assert.match(entries['xl/workbook.xml'],/Daily Attendance/);
  assert.match(entries['xl/workbook.xml'],/Lecture Details/);
  assert.match(entries['xl/workbook.xml'],/إجمالي الطلاب/);
  assert.match(entries['xl/workbook.xml'],/الطلاب الحاضرون/);
  assert.match(entries['xl/workbook.xml'],/الطلاب الغائبون/);
  assert.match(entries['xl/worksheets/sheet1.xml'],/PROVISIONAL/);
  const daily=entries['xl/worksheets/sheet5.xml'];
  assert.match(daily,/أحمد محمد/);
  assert.match(daily,/ندى أحمد/);
  assert.match(daily,/منى خالد/);
  assert.match(daily,/QA-001/);
  assert.match(daily,/QA-002/);
  assert.match(daily,/QA-003/);
  assert.match(daily,/<f>COUNTIF/);
  assert.match(daily,/IFERROR/);
  // Exactly ten day columns (E:N) and proper join-day display.
  assert.match(daily,/Day 10/);
  assert.match(daily,/>4<\/v>/);
  const details=entries['xl/worksheets/sheet6.xml'];
  assert.match(details,/Lecture Details|Acceptance|Finalized/);
  assert.match(details,/GR-A/);
});

test('even an archived camp export remains provisional while a lecture is pending',async()=>{
  const pending=buildCampAttendanceWorkbook({
    camp:{...camp,status:CampStatus.ARCHIVED},
    groups,students,studentTransfers:[],lectures:[lecture('lecture1',1)],
    attendanceSheets:[],
  });
  const entries=unzipStoredXml(new Uint8Array(await pending.arrayBuffer()));
  assert.match(entries['xl/worksheets/sheet1.xml'],/PROVISIONAL/);
});

test('30-student 10-day roster exports all rows without fabricating attendance',async()=>{
  const roster:Student[]=Array.from({length:30},(_,index)=>({
    id:'student-'+index,campId,groupId:'A',
    studentCode:'QA-ROSTER-'+String(index+1).padStart(2,'0'),
    fullName:'طالب اختبار '+(index+1),university:'',
    isActive:true,joinedCampDay:index>=27?4:1,
  }));
  const blob=buildCampAttendanceWorkbook({
    camp,groups:[groups[0]],students:roster,studentTransfers:[],
    lectures:[lecture('lecture1',1),lecture('lecture4',4)],
    attendanceSheets:[],
  });
  const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
  const daily=entries['xl/worksheets/sheet5.xml'];
  for(let index=1;index<=30;index++){
    const code='QA-ROSTER-'+String(index).padStart(2,'0');
    assert.ok(daily.includes(code),'Missing exported student: '+code);
  }
  // Four header rows + 30 student rows + one totals row.
  assert.equal((daily.match(/<row r="/g)||[]).length,35);
  assert.match(daily,/>Pending</);
  assert.match(daily,/>N\/A</);
  assert.doesNotMatch(daily,/>A<\/t>/);
  assert.match(entries['xl/worksheets/sheet1.xml'],/PROVISIONAL/);
});

test('15 teaching-day Excel contains Day 15 and correct dynamic formula columns',async()=>{
  const fifteen:Camp={...camp,code:'STG-EXPORT-15',startDate:'2026-11-29',
    endDate:'2026-12-31',operatingWeekdays:[0,2,4],durationDays:15};
  const blob=buildCampAttendanceWorkbook({
    camp:fifteen,groups,students,studentTransfers:[],
    lectures:[lecture('lecture15',15)],
    attendanceSheets:[sheet('sheet15','lecture15',[record('early',AttendanceMark.PRESENT)])],
  });
  const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
  const daily=entries['xl/worksheets/sheet5.xml'];
  const summary=entries['xl/worksheets/sheet1.xml'];
  assert.match(daily,/Day 15/);
  assert.match(daily,/2026-12-31/); // final scheduled Thursday, not Day 15 consecutive
  assert.match(daily,/COUNTIF\(E5:S5/);
  assert.match(daily,/SUM\(T5:T7\)/);
  assert.match(daily,/A4:W/);
  assert.match(summary,/2026-12-31/);
  assert.doesNotMatch(daily,/A4:R/);
});


test('reference roster counts attended lectures and excludes attended students from absent tab', async()=>{
  const blob=buildCampAttendanceWorkbook({
    camp:{...camp,status:CampStatus.ARCHIVED},
    groups,students,studentTransfers:[],
    lectures:[lecture('lec1',1),lecture('lec4',4)],
    attendanceSheets:[
      sheet('final1','lec1',[record('early',AttendanceMark.ABSENT),record('visitor',AttendanceMark.PRESENT,true)]),
      sheet('final4','lec4',[record('early',AttendanceMark.ABSENT),record('joiner',AttendanceMark.LATE)]),
    ],
  });
  const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
  const all=entries['xl/worksheets/sheet2.xml'];
  const attended=entries['xl/worksheets/sheet3.xml'];
  const absent=entries['xl/worksheets/sheet4.xml'];
  assert.match(all,/QA-001/);
  assert.match(all,/QA-002/);
  assert.match(attended,/QA-002/);
  assert.match(attended,/QA-003/);
  assert.doesNotMatch(attended,/QA-001/);
  assert.match(absent,/QA-001/);
  assert.doesNotMatch(absent,/QA-002|QA-003/);
  assert.match(all,/محاضرات الحضور/);
  assert.match(all,/محاضرات الغياب/);
});

test('group-scoped export retains visiting attendance and excludes other roster students',async()=>{
  const blob=buildCampAttendanceWorkbook({
    camp,groups,students,studentTransfers:[],groupId:'B',
    lectures:[lecture('lecture4',4)],
    attendanceSheets:[sheet('sheet4','lecture4',[record('visitor',AttendanceMark.PRESENT,true)])],
  });
  const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
  const all=entries['xl/worksheets/sheet2.xml'];
  assert.match(all,/QA-003/);
  assert.doesNotMatch(all,/QA-001|QA-002/);
  assert.match(entries['xl/worksheets/sheet1.xml'],/Group GR-B/);
  assert.match(entries['xl/worksheets/sheet3.xml'],/QA-003/);
});

test('group workbook excludes unrelated lecture totals but retains selected student visits',async()=>{
 const other={...lecture('unrelated',2),groupId:'A',topic:'UNRELATED_OTHER_GROUP'};
 const own={...lecture('own',1),groupId:'B',topic:'SELECTED_GROUP'};
 const visit={...lecture('visit',4),topic:'VISITED_OTHER_GROUP'};
 const blob=buildCampAttendanceWorkbook({camp,groups,students,studentTransfers:[],groupId:'B',lectures:[other,own,visit],attendanceSheets:[sheet('s-other','unrelated',[record('early',AttendanceMark.PRESENT)]),sheet('s-visit','visit',[record('visitor',AttendanceMark.LATE,true),record('early',AttendanceMark.ABSENT)])]});
 const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
 const details=entries['xl/worksheets/sheet6.xml'],summary=entries['xl/worksheets/sheet1.xml'];
 assert.doesNotMatch(details,/UNRELATED_OTHER_GROUP/);
 assert.match(details,/SELECTED_GROUP/);
 assert.match(details,/VISITED_OTHER_GROUP/);
 assert.match(details,/External \/ selected students only/);
 assert.match(details,/<c r="I6" s="10"><v>0<\/v><\/c>/); // other student's absence not counted
 assert.match(summary,/<c r="B12" s="10"><v>0<\/v><\/c>/);
 assert.match(summary,/<c r="B13" s="10"><v>1<\/v><\/c>/);
 assert.match(entries['xl/workbook.xml'],/حضور غير محسوم/);
});
test('snapshot preserves leading zeros, escapes text, uses status styles and filters',async()=>{
 const blob=buildAttendanceTableWorkbook({title:'QA roster',subtitle:'Group A',rows:[['Student code','Student','Mark','Sheet status'],['000123','طالب اختبار باسم طويل للغاية لضمان ظهور الاسم بالكامل دون قص الاسم أو البيانات','present','Finalized'],['=1+1','<test>','Not recorded','Draft']]});
 const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer())),xml=entries['xl/worksheets/sheet1.xml'];
 assert.match(xml,/CITS LMS/);
 assert.match(xml,/<c r="A5" s="4" t="inlineStr"><is><t xml:space="preserve">000123/);
 assert.match(xml,/<c r="C5" s="5"/);
 assert.match(xml,/<c r="C6" s="9"/);
 assert.match(xml,/&lt;test&gt;/);
 assert.match(xml,/=1\+1/);
 assert.doesNotMatch(xml,/<f>/);
 assert.match(xml,/autoFilter ref="A4:D6"/);
 assert.match(xml,/fitToPage="1"/);
 assert.match(xml,/activePane="bottomLeft"/);
 assert.ok(Number(xml.match(/<row r="5" ht="([^"]+)"/)?.[1])>23);
});
test('production-shaped fixture contains exactly 30 unique students, 3 attended and 27 unresolved',async()=>{
 const roster:Student[]=Array.from({length:30},(_,i)=>({id:'qa'+i,campId,groupId:i<3?'A':'B',studentCode:String(i+1).padStart(5,'0'),fullName:'QA student '+(i+1),university:'',isActive:true,joinedCampDay:1}));
 const marks=roster.slice(0,3).map((st,i)=>({studentId:st.id,studentCode:st.studentCode,studentName:st.fullName,originGroupId:'A',attendedGroupId:'A',isCrossGroup:false,mark:i===2?AttendanceMark.LATE:AttendanceMark.PRESENT}));
 const blob=buildCampAttendanceWorkbook({camp,groups,students:roster,studentTransfers:[],lectures:[...Array.from({length:10},(_,i)=>lecture('a'+i,i+1)),{...lecture('b',1),groupId:'B'}],attendanceSheets:[sheet('final','a0',marks)]});
 const entries=unzipStoredXml(new Uint8Array(await blob.arrayBuffer()));
 const daily=entries['xl/worksheets/sheet5.xml'],attended=entries['xl/worksheets/sheet3.xml'],pending=entries['xl/worksheets/sheet7.xml'],absent=entries['xl/worksheets/sheet4.xml'];
 assert.equal((daily.match(/<row r="/g)||[]).length,35);
 for(const st of roster){assert.equal((daily.match(new RegExp('>'+st.studentCode+'</t>','g'))||[]).length,1);assert.equal(attended.includes('>'+st.studentCode+'</t>'),st.groupId==='A');assert.equal(pending.includes('>'+st.studentCode+'</t>'),st.groupId==='B');assert.ok(!absent.includes('>'+st.studentCode+'</t>'))}
 assert.match(entries['xl/worksheets/sheet1.xml'],/<c r="B4" s="10"><v>30<\/v>/);
 assert.match(entries['xl/worksheets/sheet1.xml'],/<c r="D4" s="5"><v>3<\/v>/);
 assert.match(entries['xl/worksheets/sheet1.xml'],/<c r="H4" s="9"><v>27<\/v>/);
});
