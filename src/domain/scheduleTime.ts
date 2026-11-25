/** Presentation only: keep stored and compared times in 24-hour format. */
export function formatScheduleTime(value?:string|null):string {
 if(!value)return '';
 const match=/^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
 if(!match)return value;
 const h=Number(match[1]),m=Number(match[2]);
 if(h>23||m>59)return value;
 return (h%12||12)+':'+match[2]+' '+(h<12?'AM':'PM');
}
