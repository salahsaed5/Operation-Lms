import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, Search, ShieldCheck, Wallet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  calculateInstructorFinancialStatement, exportFinanceStatementsCsv,
  financePolicyForDay, type FinancePaymentMethod,
} from '../../domain/instructorFinance';
import { LectureStatus } from '../../types/database';
import {
  BTN_PRIMARY,BTN_SECONDARY, ConfirmDialog, INPUT_CLASS, LABEL_CLASS,
  InlineBanner, StatusBadge, SURFACE_CARD,
} from '../ui/UiPrimitives';

const fmt=(amount:number)=>amount.toLocaleString('en-EG')+' EGP';

/** Finance operations: no arbitrary "lectures attended" edit, no assumed paid
 * amount, no duplicate daily transport, and no retroactive rate mutations. */
export const CampFinanceManager:React.FC=()=>{
  const {
    activeCamp,financeSnapshot,instructors,campInstructorIds,lectures,entitlements,
    t,setCampFinanceRates,addFinanceBackup,reviewFinanceBackup,
    recordFinancePayment,setAdminRoute,updateInstructorAccount,
  }=useApp();
  const [filter,setFilter]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [showRates,setShowRates]=useState(false);
  const [rateBackup,setRateBackup]=useState('150');
  const [rateTransport,setRateTransport]=useState('100');
  const [rateReason,setRateReason]=useState('');
  const [backupLectureId,setBackupLectureId]=useState('');
  const [backupInstructorId,setBackupInstructorId]=useState('');
  const [backupReason,setBackupReason]=useState('');
  const [decisionReasons,setDecisionReasons]=useState<Record<string,string>>({});
  const [payInstructorId,setPayInstructorId]=useState('');
  const [payAmount,setPayAmount]=useState('');
  const [payMethod,setPayMethod]=useState<FinancePaymentMethod>('cash');
  const [payReference,setPayReference]=useState('');
  const [payReason,setPayReason]=useState('');
  const [paymentKind,setPaymentKind]=useState<'payment'|'refund'>('payment');
  const [paymentConfirm,setPaymentConfirm]=useState(false);
  const [mainEditInstId,setMainEditInstId]=useState<string|null>(null);
  const [mainRate,setMainRate]=useState('');

  const campId=activeCamp?.id||'';
  const campLectures=lectures.filter(l=>l.campId===campId && l.status!==LectureStatus.CANCELLED);
  const campBackups=financeSnapshot.backups.filter(b=>b.campId===campId);
  const campPayments=financeSnapshot.payments.filter(p=>p.campId===campId);
  const includeIds=new Set([
    ...(campInstructorIds[campId]||[]),
    ...campLectures.map(l=>l.substituteInstructorId||l.instructorId),
    ...entitlements.filter(e=>e.campId===campId).map(e=>e.instructorId),
    ...campBackups.map(b=>b.instructorId),
    ...campPayments.map(p=>p.instructorId),
  ]);
  const rows=useMemo(()=>instructors.filter(i=>includeIds.has(i.id)).map(i=>({
    inst:i,
    stat:calculateInstructorFinancialStatement({
      campId,instructor:i,lectures,entitlements,
      backups:financeSnapshot.backups,payments:financeSnapshot.payments,
      policies:financeSnapshot.policies,
    }),
  })).sort((a,b)=>a.inst.fullNameEn.localeCompare(b.inst.fullNameEn)),
  // includeIds derived from all scoped inputs and is stable by the same inputs.
  [campId,instructors,lectures,entitlements,financeSnapshot,campInstructorIds]);
  const visible=rows.filter(({inst})=>{
    const q=filter.trim().toLocaleLowerCase();
    return !q||inst.fullNameEn.toLocaleLowerCase().includes(q)||
      inst.fullNameAr.toLocaleLowerCase().includes(q)||
      inst.instructorCode.toLocaleLowerCase().includes(q);
  });
  const selectedRow=rows.find(r=>r.inst.id===selected);
  const totals=rows.reduce((a,r)=>({
    gross:a.gross+r.stat.confirmedTotalEgp,
    paid:a.paid+r.stat.paidEgp,
    balance:a.balance+r.stat.balanceEgp,
    main:a.main+r.stat.primaryEgp,
    backup:a.backup+r.stat.backupEgp,
    transport:a.transport+r.stat.transportEgp,
    pending:a.pending+r.stat.pendingEstimateEgp,
  }),{gross:0,paid:0,balance:0,main:0,backup:0,transport:0,pending:0});
  const currentPolicy=financePolicyForDay(financeSnapshot.policies,campId,activeCamp?.currentCampDay||1);
  const hasPolicy=financeSnapshot.policies.some(p=>p.campId===campId);
  const effectiveDay=hasPolicy?(activeCamp?.currentCampDay||1)+1:1;
  const showResult=(res:{ok:boolean;error?:string},success:string)=>{
    setFeedback({ok:res.ok,text:res.ok?success:(res.error||'Failed')});
    return res.ok;
  };
  const run=async(fn:()=>Promise<{ok:boolean;error?:string}>,success:string)=>{
    setBusy(true);setFeedback(null);
    try{return showResult(await fn(),success);}
    finally{setBusy(false);}
  };
  const onSetRates=async(e:React.FormEvent)=>{
    e.preventDefault();
    const a=Number(rateBackup),b=Number(rateTransport);
    if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<0){setFeedback({ok:false,text:'Enter valid nonnegative whole EGP rates.'});return;}
    if(await run(()=>setCampFinanceRates({campId,effectiveDay,
      backupRate:a,transportRate:b,reason:rateReason}),
      t('New effective-day policy saved and audited. Historical rates are unchanged.',
        'تم حفظ أسعار اليوم المحدد وتوثيق التعديل. الأسعار القديمة محفوظة.'))){
      setShowRates(false);setRateReason('');
    }
  };
  const onAddBackup=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(await run(()=>addFinanceBackup({lectureId:backupLectureId,
      instructorId:backupInstructorId,reason:backupReason}),
      t('Backup session recorded as Pending Review. Approve after lecture finalization.',
        'اتسجلت محاضرة الباك أب قيد المراجعة. لازم اعتماد حضور المحاضرة أولاً.'))){
      setBackupReason('');setBackupLectureId('');setBackupInstructorId('');
    }
  };
  const onPayment=async()=>{
    setPaymentConfirm(false);
    const raw=Number(payAmount);
    const amount=paymentKind==='refund'?-Math.abs(raw):raw;
    if(!Number.isSafeInteger(amount)||amount===0||payReason.trim().length<3){
      setFeedback({ok:false,text:t('Valid payment and reason required.','مطلوب مبلغ صحيح وسبب التوثيق.')});
      return;
    }
    if(await run(()=>recordFinancePayment({instructorId:payInstructorId,
      amountEgp:amount,method:payMethod,reference:payReference,note:payReason}),
      t('Payment / refund posted to immutable financial history.',
        'اتسجلت الدفعة أو الاسترداد في السجل المالي غير القابل للتعديل.'))){
      setPayAmount('');setPayReason('');setPayReference('');
    }
  };
  const editMain=async(e:React.FormEvent)=>{
    e.preventDefault();
    const inst=instructors.find(i=>i.id===mainEditInstId);const rate=Number(mainRate);
    if(!inst||!mainRate.trim()||!Number.isSafeInteger(rate)||rate<0||rate>1000000){
      setFeedback({ok:false,text:'Enter a valid integer main lecture rate.'});return;
    }
    if(await run(()=>updateInstructorAccount({
      instructorId:inst.id,profileId:inst.profileId,specialization:inst.specialization,
      defaultLectureRateEgp:rate,isActive:inst.isActive,
      // Camp assignment is intentionally omitted. Finance never changes it.
    }),t('Future primary lecture rate saved. Old frozen rates are unchanged.',
      'تم حفظ سعر المحاضرة الأساسية القادمة. الأسعار القديمة ثابتة.'))){
      setMainEditInstId(null);
    }
  };
  const downloadCsv=(only?:string)=>{
    const selectedRows=only?rows.filter(r=>r.inst.id===only):rows;
    const csv=exportFinanceStatementsCsv(selectedRows.map(r=>({
      name:r.inst.fullNameEn,code:r.inst.instructorCode,statement:r.stat,
    })));
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=(activeCamp?.code||'CAMP')+'-instructor-finance'+(only?'-'+only:'')+'.csv';
    document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  };
  const printStatement=(instructorId:string)=>{
    const row=rows.find(r=>r.inst.id===instructorId);
    if(!row)return;
    const popup=window.open('','_blank');
    if(!popup){
      setFeedback({ok:false,text:t('Allow popups to print the statement.','اسمح بفتح نافذة جديدة لطباعة كشف الحساب.')});
      return;
    }
    const e=(v:string|number)=>String(v).replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]||c));
    const st=row.stat;
    const data=[
      ['Confirmed main lectures',st.confirmedMain,fmt(st.primaryEgp)],
      ['Approved backup sessions',st.approvedBackup,fmt(st.backupEgp)],
      ['Primary transport days',st.transportDays,fmt(st.transportEgp)],
      ['Confirmed total','',fmt(st.confirmedTotalEgp)],
      ['Payments / refunds recorded','',fmt(st.paidEgp)],
      ['Remaining unpaid balance','',fmt(st.balanceEgp)],
      ['Pending estimate (NOT payable)','',fmt(st.pendingEstimateEgp)],
    ];
    const records=campPayments.filter(p=>p.instructorId===instructorId)
      .map(p=>'<tr><td>'+e(new Date(p.createdAt).toLocaleDateString())+
        '</td><td>'+e(p.method)+'</td><td>'+e(p.reference)+'</td><td>'+
        e(p.note)+'</td><td>'+e(fmt(p.amountEgp))+'</td></tr>').join('');
    popup.document.open();
    popup.document.write('<!doctype html><html lang="en"><head><meta charset="utf-8">'+
      '<title>Instructor financial statement</title><style>'+
      'body{font:14px Arial,sans-serif;max-width:850px;margin:35px auto;color:#142034}'+
      'h1{font-size:24px}table{width:100%;border-collapse:collapse;margin:18px 0}'+
      'td,th{border:1px solid #d8e0eb;padding:10px;text-align:left}'+
      'th{background:#f4f6f9}.total{font-weight:700}.fine{font-size:11px;color:#66768b}'+
      '@page{size:A4;margin:16mm}@media print{body{margin:0}}'+
      '</style></head><body><h1>Instructor Finance Statement</h1>'+
      '<p><strong>Camp:</strong> '+e(activeCamp?.nameEn||campId)+'</p>'+
      '<p><strong>Instructor:</strong> '+e(row.inst.fullNameEn)+' ('+e(row.inst.instructorCode)+')</p>'+
      '<p><strong>Prepared:</strong> '+e(new Date().toLocaleDateString())+'</p>'+
      '<table><thead><tr><th>Component</th><th>Count</th><th>Amount</th></tr></thead><tbody>'+
      data.map(([name,count,amount])=>'<tr><td>'+e(name)+'</td><td>'+e(count)+'</td><td>'+e(amount)+'</td></tr>').join('')+
      '</tbody></table><h2>Payment History</h2>'+
      '<table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Reason</th><th>Amount</th></tr></thead><tbody>'+
      (records||'<tr><td colspan="5">No payments recorded</td></tr>')+
      '</tbody></table><p class="fine">Main amounts use frozen lecture rates. '+
      'Backup amounts require admin approval. Transportation is once per eligible primary day. '+
      'Pending estimates are not payable. Save as PDF via your browser Print destination.</p>'+
      '</body></html>');
    popup.document.close();popup.focus();popup.print();
  };
  if(!activeCamp)return null;
  const inputLabel='text-xs font-semibold text-slate-600 dark:text-[#C0C5C9]';

  return <section aria-label={t('Complete instructor finance and settlements','الحسابات الكاملة وتسوية المحاضرين')} className="space-y-5">
    <div className={`${SURFACE_CARD} p-4 sm:p-6 space-y-4`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('Final camp instructor accounts','حسابات المحاضرين للمعسكر بالكامل')}</h2>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-[#A0A5AA]">
            {t('Verified primary lectures + approved backup sessions + transport on primary days (once per day) − posted payments. Pending sessions are excluded from payable totals.',
              'المحاضرات الأساسية المؤكدة + باك أب معتمد + انتقالات أيام الأساسي (مرة واحدة يوميًا) − الدفعات. المعلق مش بيتحسب ضمن المستحق المؤكد.')}
          </p>
        </div>
        <button type="button" className={BTN_SECONDARY} onClick={()=>downloadCsv()}>
          <Download className="h-4 w-4 inline me-2"/>{t('Export all CSV','تصدير حسابات الكل')}
        </button>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          {en:'Confirmed camp total',ar:'إجمالي المستحق المؤكد',v:totals.gross},
          {en:'Payments made',ar:'إجمالي المدفوع',v:totals.paid},
          {en:'Still owed',ar:'المتبقي للمحاضرين',v:totals.balance},
          {en:'Pending estimate',ar:'مبالغ معلقة تقديرية',v:totals.pending},
        ].map(x=><div key={x.en} className="rounded-xl border border-slate-100 dark:border-[#353A3F] bg-slate-50 dark:bg-[#121416]/40 p-3.5">
          <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">{t(x.en,x.ar)}</p>
          <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">{fmt(x.v)}</p>
        </div>)}
      </div>
      <p className="text-xs text-slate-500">{t(
        `Breakdown: primary ${fmt(totals.main)} · backup ${fmt(totals.backup)} · transport ${fmt(totals.transport)}`,
        `التفاصيل: أساسي ${fmt(totals.main)} · باك أب ${fmt(totals.backup)} · انتقالات ${fmt(totals.transport)}`
      )}</p>
    </div>

    {!hasPolicy && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      {t('Finance rates have not been configured for this Camp. Define them to activate backup and transportation settlement; do not pay before review.',
        'لسه محددناش أسعار الباك أب والانتقالات للمعسكر ده. لازم تتظبط الأول قبل حساب المستحقات النهائية أو الصرف.')}
    </div>}
    {feedback && <InlineBanner type={feedback.ok?'success':'error'} message={feedback.text} onDismiss={()=>setFeedback(null)} />}

    <section className={`${SURFACE_CARD} p-4 sm:p-5 space-y-3`} aria-label={t('Instructor settlement table','جدول تصفية حسابات المحاضرين')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-base font-bold">{t('Accounts by instructor','كشف حساب كل محاضر')}</h3>
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input type="search" aria-label={t('Search instructor accounts','بحث حسابات المحاضرين')}
            value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder={t('Name or instructor code','اسم أو كود المحاضر')} className={`${INPUT_CLASS} ps-9`}/>
        </div>
      </div>
      <div className="md:hidden space-y-2" aria-label={t('Instructor account cards','كروت حسابات المحاضرين')}>
        {visible.map(({inst,stat})=>(
          <button key={inst.id} type="button"
            onClick={()=>setSelected(selected===inst.id?null:inst.id)}
            aria-expanded={selected===inst.id}
            aria-label={t('Open instructor account','فتح كشف المحاضر')+': '+t(inst.fullNameEn,inst.fullNameAr)}
            className={`w-full text-start p-4 rounded-xl border transition-colors ${selected===inst.id
              ? 'border-[#7196B9] bg-[#EDF4F9] dark:bg-[#293747]'
              : 'border-slate-200 dark:border-[#353A3F] bg-slate-50 dark:bg-[#25292D]/45 hover:border-[#7196B9]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{t(inst.fullNameEn,inst.fullNameAr)}</p>
                <p className="text-xs text-slate-500 dark:text-[#A0A5AA] mt-1">{inst.instructorCode}</p>
              </div>
              <span className="text-xs font-semibold text-[#355F82] dark:text-[#88A9CC] shrink-0">
                {t('View details','التفاصيل')} {selected===inst.id?'−':'+'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-200 dark:border-[#353A3F]">
              <div><p className="text-[11px] text-slate-500 dark:text-[#A0A5AA]">{t('Confirmed total','المستحق المؤكد')}</p>
                <p className="text-sm font-bold tabular-nums mt-1">{fmt(stat.confirmedTotalEgp)}</p></div>
              <div><p className="text-[11px] text-slate-500 dark:text-[#A0A5AA]">{t('Remaining','المتبقي')}</p>
                <p className="text-sm font-bold tabular-nums mt-1">{fmt(stat.balanceEgp)}</p></div>
              <div><p className="text-[11px] text-slate-500 dark:text-[#A0A5AA]">{t('Paid','المدفوع')}</p>
                <p className="text-xs tabular-nums mt-1">{fmt(stat.paidEgp)}</p></div>
              <div><p className="text-[11px] text-slate-500 dark:text-[#A0A5AA]">{t('Main / Backup / Transport','أساسي / باك أب / انتقالات')}</p>
                <p className="text-xs tabular-nums mt-1">{stat.confirmedMain} / {stat.approvedBackup} / {stat.transportDays}</p></div>
            </div>
          </button>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-[980px] w-full text-xs" aria-label={t('Instructor payment statement','كشف المستحقات والمدفوعات')}>
          <thead className="bg-slate-50 dark:bg-[#25292D] text-slate-600 dark:text-[#C0C5C9]">
            <tr>{[t('Instructor','المحاضر'),t('Main verified','أساسي مؤكد'),t('Backup approved','باك أب معتمد'),t('Transport days','أيام انتقالات'),
              t('Main EGP','أجر الأساسي'),t('Backup EGP','أجر الباك أب'),t('Transport EGP','الانتقالات'),
              t('Total EGP','الإجمالي'),t('Paid','المدفوع'),t('Balance','المتبقي'),t('Details','التفاصيل')]
              .map(x=><th scope="col" key={x} className="p-3 text-start font-semibold whitespace-nowrap">{x}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map(({inst,stat:s})=><tr key={inst.id}>
              <td className="p-3 whitespace-nowrap"><strong>{t(inst.fullNameEn,inst.fullNameAr)}</strong><p className="text-slate-400">{inst.instructorCode}</p></td>
              <td className="p-3 tabular-nums">{s.confirmedMain} <span className="text-slate-400">/ {s.scheduledMain}</span></td>
              <td className="p-3 tabular-nums">{s.approvedBackup}</td>
              <td className="p-3 tabular-nums">{s.transportDays}</td>
              <td className="p-3 tabular-nums whitespace-nowrap">{fmt(s.primaryEgp)}</td>
              <td className="p-3 tabular-nums whitespace-nowrap">{fmt(s.backupEgp)}</td>
              <td className="p-3 tabular-nums whitespace-nowrap">{fmt(s.transportEgp)}</td>
              <td className="p-3 font-bold tabular-nums whitespace-nowrap">{fmt(s.confirmedTotalEgp)}</td>
              <td className="p-3 tabular-nums whitespace-nowrap">{fmt(s.paidEgp)}</td>
              <td className={`p-3 font-bold tabular-nums whitespace-nowrap ${s.balanceEgp<0?'text-red-600':'text-emerald-700 dark:text-emerald-300'}`}>{fmt(s.balanceEgp)}</td>
              <td className="p-3">
                <button type="button" onClick={()=>setSelected(selected===inst.id?null:inst.id)}
                  aria-expanded={selected===inst.id} className="text-[#355F82] dark:text-[#88A9CC] font-semibold underline underline-offset-2 whitespace-nowrap">
                  {t('View account','كشف الحساب')}
                </button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {visible.length===0 && <p role="status" className="text-sm text-slate-500 p-3">{t('No matching instructor','لا يوجد محاضر مطابق')}</p>}
    </section>

    {selectedRow && <section className={`${SURFACE_CARD} p-4 sm:p-5 space-y-4`} aria-label={t('Selected instructor financial detail','تفاصيل الحساب المحدد')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-base font-bold">{t(selectedRow.inst.fullNameEn,selectedRow.inst.fullNameAr)}</h3>
          <p className="text-xs text-slate-500">{t('Breakdown of verified work and payments','تفاصيل المحاضرات المؤكدة والمدفوعات')}</p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <button className={BTN_SECONDARY} type="button" onClick={()=>downloadCsv(selectedRow.inst.id)}>
            <Download className="w-4 h-4 inline me-2"/>{t('Export Excel-compatible CSV','تصدير CSV لبرنامج Excel')}
          </button>
          <button className={BTN_SECONDARY} type="button" onClick={()=>printStatement(selectedRow.inst.id)}>
            {t('Print / Save as PDF','طباعة / حفظ PDF')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {[
          {label:t('Main verified','أساسي مؤكد'),value:fmt(selectedRow.stat.primaryEgp)},
          {label:t('Backup approved','باك أب معتمد'),value:fmt(selectedRow.stat.backupEgp)},
          {label:t('Transportation','انتقالات'),value:fmt(selectedRow.stat.transportEgp)},
          {label:t('Unpaid balance','المتبقي'),value:fmt(selectedRow.stat.balanceEgp)},
        ].map(x=><div key={x.label} className="bg-slate-50 dark:bg-[#25292D] rounded-xl p-3">
          <p className="text-slate-500">{x.label}</p><p className="font-bold mt-1">{x.value}</p></div>)}
      </div>
      <p className="text-xs text-slate-500">{t(
        `Pending review: ${selectedRow.stat.pendingMain} main + ${selectedRow.stat.pendingBackup} backup. Estimated ${fmt(selectedRow.stat.pendingEstimateEgp)} is NOT payable yet.`,
        `قيد المراجعة: ${selectedRow.stat.pendingMain} أساسي + ${selectedRow.stat.pendingBackup} باك أب. مبلغ ${fmt(selectedRow.stat.pendingEstimateEgp)} تقديري ومش ضمن المستحق.`
      )}</p>
      <div className="space-y-1 text-xs">
        <h4 className="font-bold">{t('Transportation, once per eligible main day','الانتقالات مرة واحدة في اليوم الأساسي')}</h4>
        <p className="text-slate-600 dark:text-[#A0A5AA]">{selectedRow.stat.transportationBreakdown.map(x=>`Day ${x.day}: ${fmt(x.rateEgp)}`).join(' · ')||t('No verified main days','لا توجد أيام أساسي مؤكدة')}</p>
      </div>
      <div className="space-y-2 text-xs">
        <h4 className="font-bold">{t('Payment history — immutable','سجل الدفعات — غير قابل للتعديل')}</h4>
        {campPayments.filter(p=>p.instructorId===selectedRow.inst.id).map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border border-slate-100 dark:border-[#353A3F] p-3 rounded-lg">
          <div><strong>{fmt(p.amountEgp)}</strong> · {p.method} · {p.reference}<p className="text-slate-500 mt-1">{p.note}</p></div>
          <span className="text-slate-500">{new Date(p.createdAt).toLocaleString()}</span>
        </div>)}
        {!campPayments.some(p=>p.instructorId===selectedRow.inst.id) && <p className="text-slate-500">{t('No payments recorded','لم تُسجل أي دفعات')}</p>}
      </div>
    </section>}

    <section aria-label={t('Finance setup and audit actions','إعدادات وإجراءات الحسابات')} className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className={`${SURFACE_CARD} p-4 sm:p-5 space-y-4`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold">{t('Primary, backup and transport rates','أسعار الأساسي والباك أب والانتقالات')}</h3>
          <button type="button" className={BTN_SECONDARY} onClick={()=>setShowRates(v=>!v)}
            aria-expanded={showRates}>{showRates?t('Close','إغلاق'):t('Set rates','تحديد الأسعار')}</button>
        </div>
        {currentPolicy && <p className="text-sm text-slate-600 dark:text-[#C0C5C9]">
          {t('Backup rate','سعر الباك أب')}: <strong>{fmt(currentPolicy.backupRateEgp)}</strong>
          {' · '}{t('Daily primary transport','انتقال يوم الأساسي')}: <strong>{fmt(currentPolicy.transportPerDayEgp)}</strong>
          {' · '}{t('Since day','من يوم')} {currentPolicy.effectiveFromDay}
        </p>}
        {showRates && <form onSubmit={onSetRates} className="space-y-3 border-t pt-3 border-slate-100 dark:border-[#353A3F]">
          <p className="text-xs text-amber-700 dark:text-amber-300">{t(
            `Rates take effect from Day ${effectiveDay}. Initial rates from Day 1; later changes only future days.`,
            `الأسعار تسري من يوم ${effectiveDay}. أول تسعير من أول يوم، والتعديل بعد كده للأيام الجاية بس.`
          )}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className={inputLabel}>{t('Backup / session EGP','الباك أب / محاضرة بالجنيه')}
              <input type="number" min="0" max="1000000" step="1" required value={rateBackup} onChange={e=>setRateBackup(e.target.value)} className={INPUT_CLASS}/></label>
            <label className={inputLabel}>{t('Primary transportation / day EGP','انتقال الأساسي / يوم بالجنيه')}
              <input type="number" min="0" max="1000000" step="1" required value={rateTransport} onChange={e=>setRateTransport(e.target.value)} className={INPUT_CLASS}/></label>
          </div>
          <label className={inputLabel}>{t('Reason for rate policy','سبب تغيير الأسعار')}
            <input required minLength={3} value={rateReason} onChange={e=>setRateReason(e.target.value)} className={INPUT_CLASS}/></label>
          <button className={BTN_PRIMARY} type="submit" disabled={busy}>{t('Save rates','حفظ الأسعار')}</button>
        </form>}
        <form onSubmit={editMain} className="space-y-2 border-t border-slate-100 dark:border-[#353A3F] pt-3">
          <h4 className="text-sm font-bold">{t('Edit primary default rate (future lectures only)','تعديل سعر الأساسي للمحاضرات الجديدة فقط')}</h4>
          <div className="flex flex-wrap gap-2">
            <select aria-label={t('Select instructor for primary rate edit','اختار محاضر تعديل سعر الأساسي')} value={mainEditInstId||''} onChange={e=>{
              const i=instructors.find(i=>i.id===e.target.value);
              setMainEditInstId(i?.id||null);setMainRate(i?String(i.defaultLectureRateEgp):'');
            }} required className={`${INPUT_CLASS} flex-1 min-w-[180px]`}>
              <option value="">{t('Select instructor','اختار المحاضر')}</option>
              {rows.map(({inst})=><option value={inst.id} key={inst.id}>{inst.fullNameEn} · {fmt(inst.defaultLectureRateEgp)}</option>)}
            </select>
            <input aria-label={t('New primary default rate','سعر الأساسي الجديد')} type="number" min="0" step="1" max="1000000"
              value={mainRate} onChange={e=>setMainRate(e.target.value)} required className={`${INPUT_CLASS} w-32`}/>
            <button className={BTN_SECONDARY} disabled={busy} type="submit">{t('Update','تعديل')}</button>
          </div>
          <p className="text-xs text-slate-500">{t('Old scheduled main lectures keep their frozen rate. No prior amount is rewritten.',
            'سعر المحاضرات اللي اتجدولت قبل التعديل ثابت. الحساب القديم مش بيتغيّر.')}</p>
        </form>
      </div>

      <div className={`${SURFACE_CARD} p-4 sm:p-5 space-y-4`}>
        <h3 className="text-base font-bold">{t('Record a backup instructor session','تسجيل محاضرة باك أب')}</h3>
        <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">
          {t('No scheduled group is needed for the backup. Link the instructor to a real lecture; the session is pending until verified and approved.',
            'الباك أب مش محتاج جدول أو جروب باسمه. اربطه بمحاضرة فعلية، ويتحسب بعد مراجعة الإدارة واعتماد الحضور.')}
        </p>
        <form onSubmit={onAddBackup} className="space-y-3">
          <label className={inputLabel}>{t('Lecture being supported','المحاضرة اللي حضر معاها')}
            <select aria-label={t('Backup lecture','محاضرة الباك أب')} required value={backupLectureId} onChange={e=>setBackupLectureId(e.target.value)} className={INPUT_CLASS}>
              <option value="">{t('Select lecture','اختار المحاضرة')}</option>
              {campLectures.map(l=><option key={l.id} value={l.id}>D{l.campDay} P{l.periodNumber} · {l.topic}</option>)}
            </select></label>
          <label className={inputLabel}>{t('Backup instructor','محاضر الباك أب')}
            <select aria-label={t('Backup instructor','محاضر الباك أب')} required value={backupInstructorId} onChange={e=>setBackupInstructorId(e.target.value)} className={INPUT_CLASS}>
              <option value="">{t('Select backup instructor','اختار محاضر الباك أب')}</option>
              {instructors.filter(i=>i.isActive&&(campInstructorIds[campId]||[]).includes(i.id)).map(i=>
                <option key={i.id} value={i.id}>{t(i.fullNameEn,i.fullNameAr)}</option>)}
            </select></label>
          <label className={inputLabel}>{t('Attendance evidence / reason','سبب وإثبات حضور الباك أب')}
            <textarea rows={2} required minLength={3} value={backupReason} onChange={e=>setBackupReason(e.target.value)} className={INPUT_CLASS}/></label>
          <button type="submit" disabled={busy||!hasPolicy} className={BTN_PRIMARY}>{t('Record backup (pending)','تسجيل باك أب للمراجعة')}</button>
        </form>
        <div className="border-t border-slate-100 dark:border-[#353A3F] pt-3 space-y-3">
          <h4 className="text-xs font-bold">{t('Backup review & approvals','مراجعة واعتماد محاضرات الباك أب')}</h4>
          {campBackups.length===0 && <p className="text-xs text-slate-500">{t('No backup sessions recorded yet','لا يوجد باك أب مسجل لسه')}</p>}
          {campBackups.map(b=>{
            const inst=instructors.find(i=>i.id===b.instructorId);
            const lec=lectures.find(l=>l.id===b.lectureId);
            return <div key={b.id} className="rounded-xl border border-slate-200 dark:border-[#353A3F] p-3 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-bold">{inst?t(inst.fullNameEn,inst.fullNameAr):b.instructorId}</p>
                  <p className="text-slate-500">D{b.campDay} · {lec?.topic||b.lectureId} · {fmt(b.frozenRateEgp)}</p>
                </div>
                <StatusBadge tone={b.status==='approved'?'success':b.status==='excluded'?'danger':'warning'}>
                  {b.status}</StatusBadge>
              </div>
              <p className="text-slate-500">{b.reason}</p>
              <input aria-label={t('Audit reason for backup decision','سبب قرار الباك أب')}
                placeholder={t('Review reason (required)','سبب الاعتماد / الاستبعاد')}
                value={decisionReasons[b.id]||''}
                onChange={e=>setDecisionReasons(old=>({...old,[b.id]:e.target.value}))}
                className={INPUT_CLASS}/>
              <div className="flex flex-wrap gap-2">
                {(['approved','excluded'] as const).map(decision=>
                  <button type="button" disabled={busy} key={decision} className={BTN_SECONDARY}
                    onClick={()=>void run(()=>reviewFinanceBackup({backupId:b.id,decision,reason:decisionReasons[b.id]||''}),
                      t('Backup decision saved and audited','اتسجل قرار الباك أب في المراجعة'))}>
                    {decision==='approved'?t('Approve backup','اعتماد الباك أب'):t('Exclude','استبعاد')}
                  </button>)}
              </div>
            </div>;
          })}
        </div>
      </div>
    </section>

    <section className={`${SURFACE_CARD} p-4 sm:p-5 space-y-4`} aria-label={t('Payment and settlement entry','تسجيل الدفعات وتسوية المحاضرين')}>
      <div>
        <h3 className="text-base font-bold">{t('Record a partial/final payment or a refund','تسجيل دفعة جزئية أو نهائية أو استرداد')}</h3>
        <p className="text-xs text-slate-500 mt-1">{t('Payments are append-only, audited and cannot exceed confirmed unpaid entitlements. Refunds are recorded separately; nothing is deleted.',
          'الدفعات غير قابلة للحذف، ومعاها سبب وتاريخ. الدفع ما يزيدش عن المستحق المؤكد، وتصحيح الدفعة بيكون بسجل استرداد منفصل.')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className={inputLabel}>{t('Instructor','المحاضر')}
          <select aria-label={t('Select payment instructor','اختار المحاضر للدفعة')} value={payInstructorId} onChange={e=>setPayInstructorId(e.target.value)} className={INPUT_CLASS}>
            <option value="">{t('Select','اختار')}</option>
            {rows.map(r=><option key={r.inst.id} value={r.inst.id}>{r.inst.fullNameEn} · {fmt(r.stat.balanceEgp)} {t('balance','متبقي')}</option>)}
          </select></label>
        <label className={inputLabel}>{t('Type','العملية')}
          <select value={paymentKind} onChange={e=>setPaymentKind(e.target.value as 'payment'|'refund')} className={INPUT_CLASS}>
            <option value="payment">{t('Payment','دفعة')}</option>
            <option value="refund">{t('Refund / correction','استرداد / تصحيح')}</option>
          </select></label>
        <label className={inputLabel}>{t('Amount EGP','المبلغ بالجنيه')}
          <input aria-label={t('Payment amount EGP','مبلغ الدفع بالجنيه')} type="number" min="1" step="1" value={payAmount} onChange={e=>setPayAmount(e.target.value)} className={INPUT_CLASS}/></label>
        <label className={inputLabel}>{t('Payment method','طريقة الدفع')}
          <select value={payMethod} onChange={e=>setPayMethod(e.target.value as FinancePaymentMethod)} className={INPUT_CLASS}>
            <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option>
            <option value="instapay">InstaPay</option><option value="wallet">Wallet</option><option value="other">Other</option>
          </select></label>
        <label className={inputLabel}>{t('Reference / transaction ID','رقم التحويل / المرجع')}
          <input value={payReference} onChange={e=>setPayReference(e.target.value)} className={INPUT_CLASS}/></label>
        <label className={inputLabel}>{t('Audit reason / notes','سبب وتفاصيل الدفع')}
          <input aria-label={t('Payment audit note','سبب تسجيل الدفعة')} required minLength={3} value={payReason} onChange={e=>setPayReason(e.target.value)} className={INPUT_CLASS}/></label>
      </div>
      <button type="button" className={BTN_PRIMARY} disabled={busy||!hasPolicy||!payInstructorId||!payAmount||payReason.trim().length<3}
        onClick={()=>setPaymentConfirm(true)}>
        <Wallet className="h-4 w-4 inline me-2"/>{t('Review & post transaction','مراجعة وتسجيل العملية')}
      </button>
      <ConfirmDialog open={paymentConfirm} tone="danger"
        title={t('Confirm irreversible finance transaction','تأكيد تسجيل العملية المالية')}
        description={t(
          `Post ${paymentKind} of ${payAmount||'0'} EGP? This creates an audited immutable record. Verify instructor and amount before confirming.`,
          `تأكيد ${paymentKind==='refund'?'استرداد':'دفعة'} بمبلغ ${payAmount||'0'} جنيه؟ هيتسجل بسجل مالي غير قابل للحذف. راجع المحاضر والمبلغ الأول.`
        )}
        confirmLabel={t('Post transaction','تسجيل العملية')} cancelLabel={t('Cancel','إلغاء')}
        isBusy={busy} onConfirm={()=>void onPayment()} onCancel={()=>setPaymentConfirm(false)}/>
    </section>

    <div className="rounded-xl border border-slate-200 dark:border-[#353A3F] p-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
      <ShieldCheck className="w-5 h-5 text-emerald-600"/>
      <span className="flex-1">{t('Lecture counts are taken from actual Schedule/Entitlement records, not manually editable totals. Historical primary lecture prices stay frozen.',
        'عدد المحاضرات من الجدول والاستحقاق الفعلي، مش رقم قابل للتعديل يدويًا. أسعار الأساسي القديمة بتفضل ثابتة.')}</span>
      <button type="button" className={BTN_SECONDARY} onClick={()=>setAdminRoute('schedule')}>{t('Open Schedule','فتح الجدول')}</button>
    </div>
  </section>;
};
