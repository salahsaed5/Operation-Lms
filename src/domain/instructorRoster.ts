import { type ProvisionInstructorInput,validateProvisionInstructorInput } from './accountProvisioning';
import { generateEntityCode } from './generateEntityCode';
import { parseRosterGrid } from './studentRosterFile';
export const INSTRUCTOR_HEADERS=['Full Name (English)','Full Name (Arabic)','Email','Username','Instructor Code','Specialization','Phone','Default Lecture Rate (EGP)','Bio'] as const;
export const MAX_INSTRUCTOR_BATCH=20;
export type InstructorRosterRow={rowNumber:number;input:ProvisionInstructorInput};
const cleanHeader=(value:string)=>value.trim().toLowerCase();
export function mapInstructorRosterGrid(grid:{physicalRow:number;cells:string[]}[],defaultRate:number,generateCode=()=>generateEntityCode('INST')):InstructorRosterRow[]{
  const populated=grid.filter(row=>row.cells.some(v=>v?.trim()));
  if(populated.length<2)throw new Error('Use the instructor template and enter at least one instructor.');
  const headers=populated[0].cells.map(cleanHeader);
  if(headers.filter(Boolean).length!==INSTRUCTOR_HEADERS.length||INSTRUCTOR_HEADERS.some(h=>headers.filter(v=>v===cleanHeader(h)).length!==1))throw new Error('The first worksheet must have exactly the nine template headers. Do not add password columns.');
  const data=populated.slice(1);
  if(data.length>MAX_INSTRUCTOR_BATCH)throw new Error('Maximum 20 instructors per batch.');
  return data.map(({physicalRow,cells})=>{
    const get=(h:typeof INSTRUCTOR_HEADERS[number])=>String(cells[headers.indexOf(cleanHeader(h))]||'').trim();
    const rate=get('Default Lecture Rate (EGP)');
    // Preserve zero and reject nonnumeric rates instead of silently replacing them.
    return {rowNumber:physicalRow,input:{fullNameEn:get('Full Name (English)'),fullNameAr:get('Full Name (Arabic)'),email:get('Email'),username:get('Username'),instructorCode:get('Instructor Code')||generateCode(),specialization:get('Specialization'),phone:get('Phone'),defaultLectureRateEgp:rate===''?defaultRate:Number(rate),bio:get('Bio'),isActive:true,deliveryMode:'invite_email'}};
  });
}
export async function parseInstructorRoster(file:File,defaultRate:number){
  return mapInstructorRosterGrid(await parseRosterGrid(file),defaultRate);
}
export function validateInstructorRoster(rows:InstructorRosterRow[],existing:{emails:string[];usernames:string[];instructorCodes:string[]}){
  const keys=(row:InstructorRosterRow)=>[row.input.email.trim().toLowerCase(),row.input.username.trim().toLowerCase(),row.input.instructorCode.trim().toUpperCase()];
  const counts=[new Map<string,number>(),new Map<string,number>(),new Map<string,number>()];
  for(const row of rows)keys(row).forEach((v,i)=>{if(v)counts[i].set(v,(counts[i].get(v)||0)+1);});
  return rows.map(row=>{
    const check=validateProvisionInstructorInput(row.input,existing);
    const errors=[...check.errors];
    keys(row).forEach((v,i)=>{if((counts[i].get(v)||0)>1)errors.push(['Duplicate email in file.','Duplicate username in file.','Duplicate instructor code in file.'][i]);});
    if(!Number.isFinite(row.input.defaultLectureRateEgp)||row.input.defaultLectureRateEgp<0||row.input.defaultLectureRateEgp>100000)errors.push('Invalid lecture rate.');
    return {...row,errors};
  });
}
