import { supabase } from '../lib/supabase';
import type { FinanceSnapshot, FinancePaymentMethod } from '../domain/instructorFinance';

function client() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}
const unavailable = (error: {code?: string; message: string} | null) =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' ||
    /could not find the table.*schema cache/i.test(error.message)));
/** This feature requires migration 0023. If it is not yet installed, normal
 * Instructor/Admin pages still load and the finance UI is explicitly disabled.
 */
export async function fetchFinanceSnapshotInDb(): Promise<FinanceSnapshot> {
  const c=client();
  const [a,b,p]=await Promise.all([
    c.from('camp_finance_rate_policies').select('*').order('effective_from_day',{ascending:true}),
    c.from('camp_backup_sessions').select('*').order('created_at',{ascending:false}),
    c.from('camp_finance_payments').select('*').order('created_at',{ascending:false}),
  ]);
  const errors=[a.error,b.error,p.error].filter(Boolean);
  if (errors.length && errors.every(unavailable)) {
    return {enabled:false,policies:[],backups:[],payments:[]};
  }
  if(errors.length) throw new Error('Finance snapshot failed: '+errors[0]!.message);
  return {
    enabled:true,
    policies:(a.data||[]).map(row=>({
      id:row.id,campId:row.camp_id,effectiveFromDay:row.effective_from_day,
      backupRateEgp:row.backup_rate_egp,transportPerDayEgp:row.transport_per_day_egp,
      createdAt:row.created_at,
    })),
    backups:(b.data||[]).map(row=>({
      id:row.id,campId:row.camp_id,lectureId:row.lecture_id,
      instructorId:row.instructor_id,campDay:row.camp_day,
      frozenRateEgp:row.frozen_rate_egp,status:row.status,
      reason:row.reason,reviewedAt:row.reviewed_at,
    })),
    payments:(p.data||[]).map(row=>({
      id:row.id,campId:row.camp_id,instructorId:row.instructor_id,
      amountEgp:row.amount_egp,method:row.method,
      reference:row.reference,note:row.note,createdAt:row.created_at,
    })),
  };
}
async function verifiedRpc(name: string, args: Record<string,unknown>) {
  const {error}=await client().rpc(name,args);
  if (error) throw new Error(error.message);
}
export async function setFinanceRatesInDb(input: {
  campId:string;effectiveDay:number;backupRate:number;transportRate:number;reason:string;
}) {
  await verifiedRpc('finance_set_day_rates',{
    p_camp_id:input.campId,p_effective_from_day:input.effectiveDay,
    p_backup_rate:input.backupRate,p_transport_per_day:input.transportRate,
    p_reason:input.reason,
  });
}
export async function addBackupFinanceSessionInDb(input: {
  lectureId:string;instructorId:string;reason:string;
}) {
  await verifiedRpc('finance_add_backup_session',{
    p_lecture_id:input.lectureId,p_instructor_id:input.instructorId,p_reason:input.reason,
  });
}
export async function reviewBackupFinanceSessionInDb(input: {
  backupId:string;decision:'approved'|'excluded';reason:string;
}) {
  await verifiedRpc('finance_review_backup_session',{
    p_backup_id:input.backupId,p_decision:input.decision,p_reason:input.reason,
  });
}
export async function postFinancePaymentInDb(input: {
  campId:string;instructorId:string;amountEgp:number;method:FinancePaymentMethod;
  reference:string;note:string;
}) {
  await verifiedRpc('finance_record_payment',{
    p_camp_id:input.campId,p_instructor_id:input.instructorId,
    p_amount_egp:input.amountEgp,p_method:input.method,
    p_reference:input.reference,p_note:input.note,
  });
}
