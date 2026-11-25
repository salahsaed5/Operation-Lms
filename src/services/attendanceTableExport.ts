import {createXlsxWorkbook,excelCell as c,type ExcelCell} from './tinyXlsxWorkbook';

const column=(n:number):string=>n<=26?String.fromCharCode(64+n):column(Math.floor((n-1)/26))+column((n-1)%26+1);
const statusStyle=(value:string)=>{switch(value.trim().toLowerCase()){
 case 'present':case 'finalized':case 'حاضر':case 'معتمد':return 5;
 case 'late':case 'متأخر':return 6;
 case 'absent':case 'overdue':case 'غائب':return 7;
 case 'pending':case 'unmarked':case 'not recorded':case 'draft':case 'not finalized':case 'غير معتمد':case 'لم يسجل':return 9;
 case 'excused':case 'cancelled':case 'not applicable':case 'بعذر':return 8;
 default:return 4;
}};
/** Branded snapshot export. Strings (including leading-zero codes) remain strings. */
export function buildAttendanceTableWorkbook(input:{title:string;subtitle:string;rows:(string|number)[][]}):Blob{
 const [headers=[],...records]=input.rows;
 if(!headers.length)throw new Error('Attendance export requires column headers');
 const width=headers.length,last=column(width);
 const heading=(value:string,style:number):ExcelCell[]=>[c(value,style),...Array.from({length:width-1},()=>({}))];
 const rows=[heading('CITS LMS | '+input.title,1),heading(input.subtitle,2),heading('Snapshot of selected filters. Draft or missing marks are not official absences.',2),headers.map(v=>c(v,3)),
 ...records.map((record,i)=>headers.map((h,j)=>{const v=record[j]??'';return c(v,typeof v==='number'?10:/status|^mark$/i.test(String(h))?statusStyle(v):i%2?12:4)}))];
 if(!records.length)rows.push(heading('No matching records',4));
 const widths=headers.map((h,i)=>/student$|^full name$|^instructor$/i.test(String(h))?40:/code/i.test(String(h))?22:/group|course|status/i.test(String(h))?26:Math.min(36,Math.max(14,String(h).length+3,...records.slice(0,100).map(r=>Math.min(32,String(r[i]??'').length+2)))));
 return createXlsxWorkbook([{name:'Attendance',rows,widths,merges:['A1:'+last+'1','A2:'+last+'2','A3:'+last+'3',...(!records.length?['A5:'+last+'5']:[])],freeze:{columns:0,rows:4,topLeft:'A5'},autoFilter:'A4:'+last+Math.max(4,4+records.length),headerRow:4}]);
}
