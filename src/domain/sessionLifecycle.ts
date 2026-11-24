import type {Lecture,AttendanceSheet,LectureEntitlement} from '../types/database';
export type SessionState='upcoming'|'ready'|'running'|'finished'|'missed';
export function cairoClock(now:Date){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);const get=(k:string)=>parts.find(p=>p.type===k)?.value||'';return {date:get('year')+'-'+get('month')+'-'+get('day'),seconds:Number(get('hour'))*3600+Number(get('minute'))*60+Number(get('second'))};}
const seconds=(time:string)=>{const [h,m,s=0]=time.split(':').map(Number);return h*3600+m*60+s;};
export function sessionState(l:Lecture,sheet:AttendanceSheet|undefined,clock:ReturnType<typeof cairoClock>,active:boolean):SessionState {
 if(sheet&&['submitted','locked'].includes(sheet.status)&&sheet.syncState==='Synced')return 'finished';
 if(l.status==='cancelled'||!active)return 'upcoming';
 if(l.sessionStartedAt)return 'running';
 if(l.lectureDate<clock.date||(l.lectureDate===clock.date&&clock.seconds>=seconds(l.endTime)))return 'missed';
 if(l.lectureDate===clock.date&&clock.seconds>=seconds(l.startTime)-900)return 'ready';
 // Cross-midnight opening: 00:00–00:14 sessions may start the prior date.
 const next=new Date(clock.date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 if(l.lectureDate===next.toISOString().slice(0,10)&&clock.seconds>=86400+seconds(l.startTime)-900)return 'ready';
 return 'upcoming';
}
export function sessionCounts(lectures:Lecture[],sheets:AttendanceSheet[],ents:LectureEntitlement[],instructorId:string){
 const ids=new Set(lectures.filter(l=>l.status!=='cancelled'&&(l.substituteInstructorId||l.instructorId)===instructorId).map(l=>l.id));
 const finished=new Set(sheets.filter(s=>ids.has(s.lectureId)&&s.instructorId===instructorId&&['submitted','locked'].includes(s.status)&&s.syncState==='Synced').map(s=>s.lectureId));
 const counted=new Set(ents.filter(e=>ids.has(e.lectureId)&&e.instructorId===instructorId&&['eligible','approved'].includes(e.status)).map(e=>e.lectureId));
 return {assigned:ids.size,finished:finished.size,counted:counted.size,remaining:ids.size-counted.size};
}
export function sessionLabel(s:SessionState){return ({upcoming:{en:'Upcoming',ar:'قادمة'},ready:{en:'Ready to run',ar:'جاهزة للتشغيل'},running:{en:'Running',ar:'جارية'},finished:{en:'Finished',ar:'منتهية'},missed:{en:'Missed start',ar:'لم تبدأ'}})[s];}
