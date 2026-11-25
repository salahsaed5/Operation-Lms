import React,{useEffect,useMemo,useState} from 'react';
import {Upload,Download,Check,Copy,ChevronRight,ShieldCheck} from 'lucide-react';
import {useApp} from '../../context/AppContext';
import {CampStatus} from '../../types/database';
import {type CredentialDeliveryMode,validateInitialPasswordStrength} from '../../domain/accountProvisioning';
import {INSTRUCTOR_HEADERS,MAX_INSTRUCTOR_BATCH,parseInstructorRoster,validateInstructorRoster,type InstructorRosterRow} from '../../domain/instructorRoster';
import {createXlsxWorkbook} from '../../services/tinyXlsxWorkbook';
import {BTN_SECONDARY,InlineBanner,INPUT_CLASS,StatusBadge,SURFACE_CARD} from '../ui/UiPrimitives';

type BulkDeliveryMode=CredentialDeliveryMode|'shared_temporary_password';
type Result={rowNumber:number;name:string;username:string;email:string;status:'created'|'failed';message?:string;password?:string};
export const InstructorBulkImport:React.FC<{onClose:()=>void}>=({onClose})=>{
  const {activeCamp,instructors,profiles,provisionInstructor,t}=useApp();
  const [rows,setRows]=useState<InstructorRosterRow[]>([]);
  const [fileName,setFileName]=useState('');
  const [error,setError]=useState('');
  const [reading,setReading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [started,setStarted]=useState(false);
  const [results,setResults]=useState<Result[]>([]);
  const [delivery,setDelivery]=useState<BulkDeliveryMode>('temporary_password');
  const [sharedPassword,setSharedPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const sharedMode=delivery==='shared_temporary_password';
  const strength=validateInitialPasswordStrength(sharedPassword);
  const sharedValid=!sharedMode||(strength.valid&&sharedPassword===confirmPassword&&sharedPassword===sharedPassword.trim());
  const sharedError=sharedPassword!==sharedPassword.trim()?t('Remove leading or trailing spaces.','احذف المسافات من بداية ونهاية كلمة المرور.'):!strength.valid?t('Use 8–128 characters with uppercase, lowercase and a number.','استخدم ٨–١٢٨ حرفاً تشمل حرفاً كبيراً وصغيراً ورقماً.'):sharedPassword!==confirmPassword?t('Passwords must match.','كلمتا المرور غير متطابقتين.'):'';
  const canAssign=!!activeCamp&&activeCamp.status!==CampStatus.ARCHIVED&&activeCamp.status!==CampStatus.PENDING_ARCHIVE;
  const [assign,setAssign]=useState(canAssign);
  const [copied,setCopied]=useState<number|null>(null);
  const [scope,setScope]=useState(activeCamp?.id||'');
  const changedScope=scope!==(activeCamp?.id||'');
  const validation=useMemo(()=>validateInstructorRoster(rows,{emails:profiles.map(p=>p.email),usernames:profiles.map(p=>p.username),instructorCodes:instructors.map(i=>i.instructorCode)}),[rows,profiles,instructors]);
  const valid=validation.filter(r=>!r.errors.length).length;
  const secretCount=results.filter(r=>r.password).length;
  const created=results.filter(r=>r.status==='created').length;
  useEffect(()=>{if(!busy&&!secretCount)return;const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[busy,secretCount]);
  const close=()=>{if(busy||reading)return;if(secretCount&&!window.confirm(t('Clear all temporary passwords and close? They will not be shown again.','مسح كل كلمات المرور المؤقتة وإغلاق الصفحة؟ لن تُعرض مرة أخرى.')))return;setSharedPassword('');setConfirmPassword('');setResults([]);onClose();};
  const download=()=>{const blob=createXlsxWorkbook([{name:'Instructors',rows:[INSTRUCTOR_HEADERS.map(value=>({value}))],widths:[30,30,34,24,24,26,20,25,32],freeze:{rows:1,columns:0,topLeft:'A2'}}]);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='CITS-Instructor-Import-Template.xlsx';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const upload=async(file:File|null)=>{if(!file||busy||started)return;setReading(true);setRows([]);setError('');setFileName(file.name);setScope(activeCamp?.id||'');try{setRows(await parseInstructorRoster(file,activeCamp?.settings.defaultLectureRateEgp??700));}catch(e){setError(e instanceof Error?e.message:'Unable to read file.');}finally{setReading(false);}};
  const run=async()=>{
    if(busy||started||reading||changedScope||!rows.length||valid!==rows.length||!sharedValid)return;
    if(assign&&!canAssign){setError(t('Select an editable camp or turn off assignment.','اختر كامب قابل للتعديل أو ألغِ التعيين.'));return;}
    if(!window.confirm(t(`Create ${rows.length} instructor accounts? This creates real accounts one by one; if a request fails, remaining rows are not processed.`,`إنشاء ${rows.length} حساب محاضر؟ سيتم إنشاء الحسابات بالتتابع وإيقاف الدفعة عند أي فشل.`)))return;
    if(sharedMode&&!window.confirm(t('A shared temporary password increases account takeover risk before first login. Each instructor must change it immediately. Continue?','كلمة المرور المشتركة تزيد خطر الدخول إلى حسابات الآخرين قبل أول تسجيل دخول. يجب على كل محاضر تغييرها فوراً. هل تريد المتابعة؟')))return;
    const temporaryPassword=sharedMode?sharedPassword:undefined;
    setSharedPassword('');setConfirmPassword('');
    setBusy(true);setStarted(true);setResults([]);setError('');
    try{
      // Same authenticated single-account endpoint; no bypass of MFA, rate limits or rollback.
      for(const row of rows){
        const input={...row.input,deliveryMode:sharedMode?'temporary_password' as const:delivery as CredentialDeliveryMode,temporaryPassword,assignToCampId:assign&&canAssign?activeCamp!.id:null};
        try{
          const outcome=await provisionInstructor(input);
          if(!outcome.ok){setResults(prev=>[...prev,{rowNumber:row.rowNumber,name:input.fullNameEn,username:input.username,email:input.email,status:'failed',message:outcome.error||'Provisioning failed.'}]);break;}
          setResults(prev=>[...prev,{rowNumber:row.rowNumber,name:outcome.fullNameEn,username:outcome.username,email:outcome.email,status:'created',password:outcome.initialTemporaryPassword}]);
        }catch(e){setResults(prev=>[...prev,{rowNumber:row.rowNumber,name:input.fullNameEn,username:input.username,email:input.email,status:'failed',message:e instanceof Error?e.message:'Request failed. Check directory before retrying.'}]);break;}
      }
    }finally{setBusy(false);}
  };
  return <section className={SURFACE_CARD+' camp-form p-5 space-y-4 instructor-import'} aria-label={t('Import instructors','استيراد المحاضرين')}>
    <div className="people-list-heading"><div><h2>{t('Import instructors','استيراد المحاضرين')}</h2><p className="people-note">{t('Create up to 20 accounts from one roster.','إنشاء حتى 20 حساباً من كشف واحد.')}</p></div><button type="button" className={BTN_SECONDARY} disabled={busy||reading} onClick={close}>{t('Back to instructors','رجوع للمحاضرين')}</button></div>
    <div className="camp-stepper">{[t('Upload','رفع الملف'),t('Review','المراجعة'),t('Create accounts','إنشاء الحسابات')].map((label,i)=><div key={i} data-current={i===(started?2:rows.length?1:0)} data-complete={i<(started?2:rows.length?1:0)}><span>{i<(started?2:rows.length?1:0)?<Check size={15}/>:i+1}</span><strong>{label}</strong></div>)}</div>
    {error&&<InlineBanner type="error" message={error}/>}
    {!started&&<><div className="student-upload space-y-3"><button type="button" className={BTN_SECONDARY} onClick={download}><Download size={16}/>{t('Download Excel template','تحميل نموذج Excel')}</button><label htmlFor="instructor-roster-file" className="block text-sm font-semibold">{t('Upload Excel or CSV','رفع Excel أو CSV')}</label><input id="instructor-roster-file" type="file" accept=".xlsx,.csv" disabled={reading||busy} className={INPUT_CLASS} onChange={e=>{void upload(e.currentTarget.files?.[0]||null);e.currentTarget.value='';}}/><p className="people-note">{t('Required: English name, email, username, specialization. Leave code blank to generate one; blank rate uses the selected camp default. Keep phone numbers as text. No passwords in the workbook.','المطلوب: الاسم بالإنجليزية والبريد واسم المستخدم والتخصص. الكود الفارغ يُولّد تلقائياً، والفئة الفارغة تأخذ القيمة الافتراضية للكامب. اكتب الهاتف كنص. لا تضع كلمات مرور في الملف.')}</p>{reading&&<p>{t('Reading file…','جاري قراءة الملف…')}</p>}{fileName&&<p className="text-sm break-all">{fileName}</p>}</div>
    {rows.length>0&&<><div className="student-review-summary"><div><small>{t('Total','الإجمالي')}</small><strong>{rows.length}</strong></div><div><small>{t('Ready','جاهز')}</small><strong>{valid}</strong></div><div><small>{t('Invalid rows','صفوف بها أخطاء')}</small><strong>{rows.length-valid}</strong></div></div><div className="student-review-table"><table><thead><tr>{[t('Row','الصف'),t('Name','الاسم'),t('Email / Username','البريد / المستخدم'),t('Code / Rate','الكود / الفئة'),t('Status','الحالة')].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{validation.map(row=><tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.input.fullNameEn}</td><td>{row.input.email}<br/>{row.input.username}</td><td>{row.input.instructorCode}<br/>{row.input.defaultLectureRateEgp} EGP</td><td>{row.errors.length?<span className="student-error">{row.errors.join(' · ')}</span>:<span className="student-valid">{t('Ready','جاهز')}</span>}</td></tr>)}</tbody></table></div>
    <div className="instructor-import-options"><label className="grid gap-2 text-sm"><strong>{t('Login delivery','تسليم بيانات الدخول')}</strong><select className={INPUT_CLASS} value={delivery} onChange={e=>{setDelivery(e.target.value as BulkDeliveryMode);setSharedPassword('');setConfirmPassword('');}}><option value="temporary_password">{t('Generate temporary passwords','توليد كلمات مرور مؤقتة')}</option><option value="shared_temporary_password">{t('Use shared temporary password','استخدام كلمة مرور مؤقتة مشتركة')}</option><option value="invite_email">{t('Send email invites','إرسال دعوات بالبريد')}</option></select></label>{sharedMode&&<div className="grid gap-3"><InlineBanner type="error" message={t('Shared credentials are less secure than unique passwords. Use only for initial access; first-login password change remains mandatory.','كلمة المرور المشتركة أقل أماناً من كلمات المرور المختلفة. استخدمها للدخول الأول فقط؛ تغييرها عند أول دخول إلزامي.')}/><label className="grid gap-1 text-sm"><strong>{t('Shared temporary password','كلمة المرور المؤقتة المشتركة')}</strong><input type="password" autoComplete="new-password" maxLength={128} className={INPUT_CLASS} value={sharedPassword} onChange={e=>setSharedPassword(e.target.value)}/></label><label className="grid gap-1 text-sm"><strong>{t('Confirm shared password','تأكيد كلمة المرور المشتركة')}</strong><input type="password" autoComplete="new-password" maxLength={128} className={INPUT_CLASS} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label>{sharedError&&<p className="student-error text-xs" role="status">{sharedError}</p>}</div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assign&&canAssign} disabled={!canAssign} onChange={e=>setAssign(e.target.checked)}/>{t('Assign to selected camp','تعيين في الكامب المختار')} {canAssign?activeCamp?.code:''}</label></div>
    {changedScope&&<InlineBanner type="error" message={t('Camp changed. Upload the file again before creating accounts.','تغير الكامب. ارفع الملف مرة أخرى قبل الإنشاء.')}/>}
    <p className="people-note">{t('All rows must pass validation. Each account is created separately; the batch stops at the first server error. Server limit: 20 accounts per 10 minutes, including other recent creations.','يجب اجتياز كل الصفوف للتحقق. يُنشأ كل حساب منفرداً وتتوقف الدفعة عند أول خطأ من الخادم. الحد 20 حساباً كل 10 دقائق شاملاً الحسابات المنشأة مؤخراً.')}</p><button type="button" className="camp-primary" disabled={valid!==rows.length||changedScope||busy||reading||!sharedValid} onClick={()=>void run()}><ShieldCheck size={16}/>{t(`Create ${rows.length} accounts`,`إنشاء ${rows.length} حساب`)}</button></>}
    </>}
    {started&&<><div className="student-review-summary"><div><small>{t('Created','تم الإنشاء')}</small><strong>{created}/{rows.length}</strong></div><div><small>{t('Not processed','لم تتم معالجتها')}</small><strong>{rows.length-results.length}</strong></div></div>{busy&&<p role="status">{t('Creating accounts… Keep this page open.','جاري إنشاء الحسابات… أبقِ هذه الصفحة مفتوحة.')}</p>}{!busy&&<InlineBanner type={created===rows.length?'success':'error'} message={created===rows.length?t('All accounts created.','تم إنشاء كل الحسابات.'):t('Batch stopped. Check the directory before uploading only the remaining uncreated accounts.','توقفت الدفعة. راجع قائمة المحاضرين قبل رفع الحسابات المتبقية فقط.')}/>}
    {secretCount>0&&<p className="people-note">{t('Copy each temporary password and share privately. Passwords are shown once, kept only in this page memory, and cleared when closed.','انسخ كلمة المرور لكل محاضر وشاركها بشكل خاص. تظهر مرة واحدة وتُمسح عند إغلاق الصفحة.')}</p>}
    <div className="grid gap-2">{results.map(r=><div key={r.rowNumber} className="instructor-import-result"><div><strong>{r.name}</strong><small>{r.username} · {r.email}</small><small>{t('Row','الصف')} {r.rowNumber}</small>{r.message&&<p className="student-error">{r.message}</p>}</div><StatusBadge tone={r.status==='created'?'success':'danger'}>{r.status==='created'?t('Created','تم الإنشاء'):t('Failed','فشل')}</StatusBadge>{r.password&&<div className="instructor-secret"><code>{r.password}</code><button type="button" className={BTN_SECONDARY} onClick={async()=>{try{await navigator.clipboard.writeText(r.password!);setCopied(r.rowNumber);}catch{setCopied(null);}}}>{copied===r.rowNumber?<Check size={14}/>:<Copy size={14}/>} {t('Copy','نسخ')}</button></div>}</div>)}</div>
    {!busy&&<button type="button" className="camp-primary" onClick={close}>{t('Finish & clear','إنهاء ومسح')}</button>}</>}
  </section>;
};
