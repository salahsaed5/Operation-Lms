import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateInstructorFinancialStatement, exportFinanceStatementsCsv,
  financePolicyForDay, type FinanceRatePolicy, type FinanceBackupSession, type FinancePayment} from './instructorFinance';
import {EntitlementStatus, LectureStatus, type LectureEntitlement, type Instructor, type Lecture} from '../types/database';
const campId='test-camp';
const teacher=(id:string)=>({id,fullNameEn:id,instructorCode:id} as Instructor);
const lect=(id:string,day:number,instructorId:string,period=1)=>({
  id,campId,campDay:day,instructorId,periodNumber:period,
  substituteInstructorId:null,status:LectureStatus.COMPLETED,
} as Lecture);
const primary=(id:string,inst:string,day:number,rate:number,status=EntitlementStatus.ELIGIBLE)=>({
  id,campId,lectureId:id,instructorId:inst,campDay:day,
  frozenRateEgp:rate,entitlementAmountEgp:status===EntitlementStatus.ELIGIBLE?rate:0,
  status,
} as LectureEntitlement);
const backup=(id:string,inst:string,day:number,status:'approved'|'pending'|'excluded'='approved',amount=150)=>({
  id,campId,lectureId:id,instructorId:inst,campDay:day,frozenRateEgp:amount,
  status,reason:'Verified onsite backup',
} as FinanceBackupSession);
const policy=(day:number,backupRate=150,transportRate=100):FinanceRatePolicy=>({
  id:'policy-'+day,campId,effectiveFromDay:day,backupRateEgp:backupRate,
  transportPerDayEgp:transportRate,createdAt:'2026-11-01T10:00:00Z',
});
const payment=(id:string,inst:string,amount:number):FinancePayment=>({
  id,campId,instructorId:inst,amountEgp:amount,method:'cash',
  reference:'',note:'Partial payout confirmed',createdAt:'2026-11-10T10:00:00Z',
});
const calc=(inst:string,params:{
  lectures?:Lecture[];entitlements?:LectureEntitlement[];
  backups?:FinanceBackupSession[];payments?:FinancePayment[];policies?:FinanceRatePolicy[];
})=>calculateInstructorFinancialStatement({
  campId,instructor:teacher(inst),lectures:params.lectures||[],
  entitlements:params.entitlements||[],backups:params.backups||[],
  payments:params.payments||[],policies:params.policies||[policy(1)],
});

test('300 primary + 150 backup + 100 transport (once/day) − 200 payment = 350 balance',()=>{
  const r=calc('inst-A',{
    lectures:[lect('A-main',1,'inst-A')],
    entitlements:[primary('A-main','inst-A',1,300)],
    backups:[backup('other-main','inst-A',1)],
    payments:[payment('p1','inst-A',200)],
  });
  assert.equal(r.scheduledMain,1);
  assert.equal(r.confirmedMain,1);
  assert.equal(r.approvedBackup,1);
  assert.equal(r.primaryEgp,300);
  assert.equal(r.backupEgp,150);
  assert.equal(r.transportEgp,100);
  assert.equal(r.confirmedTotalEgp,550);
  assert.equal(r.paidEgp,200);
  assert.equal(r.balanceEgp,350);
});

test('multiple verified main lectures on the same day earn transport only ONCE',()=>{
  const r=calc('A',{entitlements:[primary('L1','A',2,300),primary('L2','A',2,300)]});
  assert.equal(r.primaryEgp,600);
  assert.equal(r.transportDays,1);
  assert.equal(r.transportEgp,100);
  assert.equal(r.confirmedTotalEgp,700);
});

test('backup-only instructor never earns transport, even if backup approved',()=>{
  const r=calc('backup-only',{backups:[backup('L1','backup-only',1),backup('L2','backup-only',2)]});
  assert.equal(r.confirmedTotalEgp,300);
  assert.equal(r.transportDays,0);
  assert.equal(r.transportEgp,0);
});

test('pending/excluded backup + pending main never increase payable totals',()=>{
  const r=calc('A',{
    entitlements:[primary('L1','A',3,300,EntitlementStatus.PENDING_REVIEW)],
    backups:[backup('L2','A',3,'pending'),backup('L3','A',3,'excluded')],
  });
  assert.equal(r.confirmedTotalEgp,0);
  assert.equal(r.pendingMain,1);
  assert.equal(r.pendingBackup,1);
  assert.equal(r.excludedBackup,1);
  assert.equal(r.pendingEstimateEgp,450);
});

test('rate-policy effective day is immutable history for transport calculation',()=>{
  const policies=[policy(1,150,100),policy(6,250,140)];
  const r=calc('A',{
    entitlements:[primary('L1','A',4,300),primary('L2','A',6,300)],
    policies,
    backups:[backup('B1','A',6,'approved',250)],
  });
  assert.equal(r.transportEgp,240);
  assert.equal(r.backupEgp,250);
  assert.equal(financePolicyForDay(policies,campId,4)?.backupRateEgp,150);
  assert.equal(financePolicyForDay(policies,campId,6)?.backupRateEgp,250);
});

test('other instructors and other camps do not change a lecturer balance',()=>{
  const r=calc('A',{
    entitlements:[primary('L1','A',1,300),primary('L2','B',1,700),
      {...primary('L3','A',2,1000),campId:'another-camp'}],
    backups:[backup('L4','B',1),{...backup('L5','A',1),campId:'another-camp'}],
    payments:[payment('1','B',100),{...payment('2','A',40),campId:'another-camp'}],
  });
  assert.equal(r.confirmedTotalEgp,400);
  assert.equal(r.paidEgp,0);
});

test('refunds are immutable compensating negatives, reducing net paid',()=>{
  const r=calc('A',{entitlements:[primary('L1','A',1,300)],
    payments:[payment('p1','A',250),payment('refund','A',-50)]});
  assert.equal(r.paidEgp,200);
  assert.equal(r.balanceEgp,200);
});

test('CSV prevents spreadsheet injection in instructor names and references',()=>{
  const statement=calc('A',{entitlements:[primary('L1','A',1,300)]});
  const csv=exportFinanceStatementsCsv([{name:'=HYPERLINK("malicious")',code:'+2+3',statement}]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+2+3"));
  assert.ok(csv.includes('400'));
});
