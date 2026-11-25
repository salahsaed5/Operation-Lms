import {LectureStatus,type Lecture,type PeriodSlot} from '../types/database';

export const timeSeconds=(v:string)=>{const [h,m,s=0]=v.split(':').map(Number);return h*3600+m*60+s;};
export const overlapsSlot=(l:{startTime:string;endTime:string},p:PeriodSlot)=>timeSeconds(l.startTime)<timeSeconds(p.end)&&timeSeconds(l.endTime)>timeSeconds(p.start);

export function eligibleAssignmentDays(input:{draft:boolean;initial:boolean;currentDay:number;durationDays:number;dateFor:(day:number)=>string;clock:{date:string;seconds:number};slot:PeriodSlot;own:Lecture[];hasSavedAttendance:(id:string)=>boolean}):number[]{
 const {draft,initial,currentDay,durationDays,dateFor,clock,slot,own,hasSavedAttendance}=input;
 const days:number[]=[];
 for(let d=draft?1:currentDay+(initial?0:1);d<=durationDays;d++){
  const date=dateFor(d);
  if(!draft&&(date<clock.date||(date===clock.date&&(!initial||timeSeconds(slot.start)<=clock.seconds||own.some(l=>l.campDay===d&&l.status!==LectureStatus.CANCELLED&&(timeSeconds(l.startTime)<=clock.seconds||l.status!==LectureStatus.SCHEDULED||!!l.sessionStartedAt||hasSavedAttendance(l.id)))))))continue;
  days.push(d);
 }
 return days;
}

export function assignmentResourceBusy(input:{kind:'instructor'|'room';id:string;campId:string;groupId:string;days:number[];dateFor:(day:number)=>string;slot:PeriodSlot;lectures:Lecture[];backups:{lectureId:string;instructorId:string;status:string}[]}):boolean{
 const {kind,id,campId,groupId,days,dateFor,slot,lectures,backups}=input;
 const dates=new Set(days.map(dateFor));
 const affected=lectures.filter(l=>l.status!==LectureStatus.CANCELLED&&dates.has(l.lectureDate)&&overlapsSlot(l,slot));
 const other=affected.filter(l=>!(l.campId===campId&&l.groupId===groupId));
 if(kind==='room')return other.some(l=>l.roomId===id);
 return other.some(l=>(l.substituteInstructorId||l.instructorId)===id)||backups.some(b=>b.instructorId===id&&b.status!=='excluded'&&affected.some(l=>l.id===b.lectureId));
}
