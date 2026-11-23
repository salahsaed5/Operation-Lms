import type { Lecture, LectureEntitlement, Instructor } from '../types/database';
import { EntitlementStatus, LectureStatus } from '../types/database';

/** Payments, backup engagements, and camp/day rates are intentionally separate
 * from the existing, immutable primary-lecture entitlement snapshots.
 * No student attendance, scheduling or historical instructor rate is mutated.
 */
export interface FinanceRatePolicy {
  id: string;
  campId: string;
  effectiveFromDay: number;
  backupRateEgp: number;
  transportPerDayEgp: number;
  createdAt: string;
}
export type FinanceBackupStatus = 'pending' | 'approved' | 'excluded';
export interface FinanceBackupSession {
  id: string;
  campId: string;
  lectureId: string;
  instructorId: string;
  campDay: number;
  frozenRateEgp: number;
  status: FinanceBackupStatus;
  reason: string;
  reviewedAt?: string | null;
}
export type FinancePaymentMethod = 'cash' | 'bank_transfer' | 'instapay' | 'wallet' | 'other';
export interface FinancePayment {
  id: string;
  campId: string;
  instructorId: string;
  /** Positive is a payment; negative is an audited refund/correction. */
  amountEgp: number;
  method: FinancePaymentMethod;
  reference: string;
  note: string;
  createdAt: string;
}
export interface FinanceSnapshot {
  enabled: boolean;
  policies: FinanceRatePolicy[];
  backups: FinanceBackupSession[];
  payments: FinancePayment[];
}
export const EMPTY_FINANCE_SNAPSHOT: FinanceSnapshot = {
  enabled: false, policies: [], backups: [], payments: [],
};
export interface InstructorFinancialStatement {
  instructorId: string;
  scheduledMain: number;
  confirmedMain: number;
  pendingMain: number;
  excludedMain: number;
  approvedBackup: number;
  pendingBackup: number;
  excludedBackup: number;
  primaryEgp: number;
  backupEgp: number;
  transportDays: number;
  transportEgp: number;
  confirmedTotalEgp: number;
  pendingEstimateEgp: number;
  paidEgp: number;
  balanceEgp: number;
  /** For a historic rate change, each day uses its own effective-date policy. */
  transportationBreakdown: Array<{ day: number; rateEgp: number }>;
}
export const financePolicyForDay = (policies: FinanceRatePolicy[], campId: string, day: number) =>
  policies.filter(p => p.campId === campId && p.effectiveFromDay <= day)
    .sort((a,b) => b.effectiveFromDay - a.effectiveFromDay)[0] || null;

export const isVerifiedPrimaryEntitlement = (e: LectureEntitlement) =>
  e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED;

/** One transport allowance per CAMP DAY with at least one verified primary
 * lecture. Backup-only days do not earn transport; a backup session on a
 * primary day does not create a second transport award.
 *
 * 'Scheduled' and 'Pending' are never treated as confirmed money.
 */
export function calculateInstructorFinancialStatement(input: {
  campId: string;
  instructor: Instructor;
  lectures: Lecture[];
  entitlements: LectureEntitlement[];
  backups: FinanceBackupSession[];
  payments: FinancePayment[];
  policies: FinanceRatePolicy[];
}): InstructorFinancialStatement {
  const { campId, instructor, lectures, entitlements, backups, payments, policies } = input;
  const owns = (id: string, c: string) => id === instructor.id && c === campId;
  const main = entitlements.filter(e => owns(e.instructorId, e.campId));
  const eligibleMain = main.filter(isVerifiedPrimaryEntitlement);
  const backup = backups.filter(e => owns(e.instructorId, e.campId));
  const approvedBackup = backup.filter(e => e.status === 'approved');
  const scheduledMain = lectures.filter(l => l.campId === campId &&
    l.status !== LectureStatus.CANCELLED &&
    (l.substituteInstructorId || l.instructorId) === instructor.id).length;

  // Even if several separate groups meet on a day, transport is once/day.
  const verifiedMainDays = [...new Set(eligibleMain.map(e => e.campDay))]
    .sort((a,b) => a-b);
  const transportationBreakdown = verifiedMainDays.map(day => ({
    day, rateEgp: financePolicyForDay(policies, campId, day)?.transportPerDayEgp || 0,
  }));
  const transportEgp = transportationBreakdown.reduce((sum, row) => sum + row.rateEgp, 0);
  const primaryEgp = eligibleMain.reduce((sum, e) => sum + e.entitlementAmountEgp, 0);
  const backupEgp = approvedBackup.reduce((sum, e) => sum + e.frozenRateEgp, 0);
  const pendingMain = main.filter(e => e.status === EntitlementStatus.PENDING_REVIEW);
  const pendingBackup = backup.filter(e => e.status === 'pending');
  const paidEgp = payments.filter(e => owns(e.instructorId,e.campId))
    .reduce((sum,e) => sum + e.amountEgp, 0);
  const confirmedTotalEgp = primaryEgp + backupEgp + transportEgp;

  return {
    instructorId: instructor.id,
    scheduledMain,
    confirmedMain: eligibleMain.length,
    pendingMain: pendingMain.length,
    excludedMain: main.filter(e=>e.status === EntitlementStatus.EXCLUDED).length,
    approvedBackup: approvedBackup.length,
    pendingBackup: pendingBackup.length,
    excludedBackup: backup.filter(e=>e.status === 'excluded').length,
    primaryEgp, backupEgp,
    transportDays: verifiedMainDays.length,
    transportationBreakdown, transportEgp,
    confirmedTotalEgp,
    pendingEstimateEgp:
      pendingMain.reduce((sum,e)=>sum+e.frozenRateEgp,0) +
      pendingBackup.reduce((sum,e)=>sum+e.frozenRateEgp,0),
    paidEgp,
    balanceEgp: confirmedTotalEgp - paidEgp,
  };
}

/** CSV is a downloadable, read-only end-of-Camp statement; export is scoped
 * to the selected Camp and built from per-instructor actual frozen records. */
export function exportFinanceStatementsCsv(rows: Array<{
  name: string; code: string; statement: InstructorFinancialStatement;
}>): string {
  const head=['Instructor','Code','Scheduled main','Confirmed main','Approved backup',
    'Pending main','Pending backup','Excluded main','Excluded backup',
    'Primary EGP','Backup EGP','Transport days','Transport EGP',
    'Confirmed total EGP','Potential pending EGP','Paid EGP','Balance EGP'];
  const escape = (v:string|number) => {
    const s=String(v);
    // Spreadsheet formula injection is blocked by prefixing untrusted cells.
    const safe = /^[\s]*[=+@\-]/.test(s) ? "'" + s : s;
    return '"' + safe.replace(/"/g,'""') + '"';
  };
  return '\ufeff' + [head,...rows.map(({name,code,statement:s})=>[
    name,code,s.scheduledMain,s.confirmedMain,s.approvedBackup,s.pendingMain,
    s.pendingBackup,s.excludedMain,s.excludedBackup,s.primaryEgp,s.backupEgp,
    s.transportDays,s.transportEgp,s.confirmedTotalEgp,s.pendingEstimateEgp,
    s.paidEgp,s.balanceEgp,
  ])].map(row=>row.map(escape).join(',')).join('\r\n');
}
