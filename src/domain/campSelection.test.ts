import test from 'node:test';
import assert from 'node:assert/strict';
import { CampStatus, UserRole, type Camp } from '../types/database';
import { campsAvailableToUser, resolveCampSelection } from './campSelection';

const mkCamp = (id: string, status: CampStatus): Camp =>
  ({id,code:id,nameEn:id,nameAr:id,status}) as Camp;

const a=mkCamp('sat-active',CampStatus.ACTIVE);
const b=mkCamp('sun-active',CampStatus.ACTIVE);
const c=mkCamp('old-archive',CampStatus.ARCHIVED);
const d=mkCamp('new-draft',CampStatus.DRAFT);
const camps=[a,b,c,d];

test('admin sees multiple active, archived and draft Camps independently',()=>{
  const list=campsAvailableToUser({
    camps,role:UserRole.ADMIN,instructorId:'',campInstructorIds:{},lectures:[],backupSessions:[]
  });
  assert.deepEqual(list.map(c=>c.id),['sat-active','sun-active','old-archive','new-draft']);
  assert.equal(resolveCampSelection(list,'sun-active')?.id,'sun-active');
  assert.equal(resolveCampSelection(list,'old-archive')?.id,'old-archive');
});

test('instructor cannot switch into an unrelated active or draft Camp',()=>{
  const list=campsAvailableToUser({
    camps,role:UserRole.INSTRUCTOR,instructorId:'instA',
    campInstructorIds:{'sat-active':['instA'],'sun-active':['instB']},
    lectures:[],backupSessions:[]
  });
  assert.deepEqual(list.map(c=>c.id),['sat-active']);
  assert.equal(resolveCampSelection(list,'sun-active')?.id,'sat-active');
});

test('same instructor can select multiple assigned Camps; independent data remains scoped',()=>{
  const list=campsAvailableToUser({
    camps,role:UserRole.INSTRUCTOR,instructorId:'instA',
    campInstructorIds:{'sat-active':['instA'],'sun-active':['instA']},
    lectures:[],backupSessions:[]
  });
  assert.deepEqual(list.map(c=>c.id),['sat-active','sun-active']);
  assert.equal(resolveCampSelection(list,'sat-active')?.id,'sat-active');
  assert.equal(resolveCampSelection(list,'sun-active')?.id,'sun-active');
});

test('unscheduled backup-only and historical lecture roles give own-Camp access',()=>{
  const list=campsAvailableToUser({
    camps,role:UserRole.INSTRUCTOR,instructorId:'backup',
    campInstructorIds:{},
    lectures:[{campId:'old-archive',instructorId:'backup',substituteInstructorId:null}],
    backupSessions:[{campId:'sun-active',instructorId:'backup'},
                    {campId:'sat-active',instructorId:'someone-else'}]
  });
  assert.deepEqual(list.map(c=>c.id),['sun-active','old-archive']);
  assert.equal(resolveCampSelection(list,'old-archive')?.id,'old-archive');
});

test('revoked/no instructor assignment never falls back to a global active Camp',()=>{
  const list=campsAvailableToUser({
    camps,role:UserRole.INSTRUCTOR,instructorId:'unknown',
    campInstructorIds:{},lectures:[],backupSessions:[]
  });
  assert.deepEqual(list,[]);
  assert.equal(resolveCampSelection(list,'sat-active'),null);
  assert.equal(resolveCampSelection(camps,'no-longer-exists')?.id,'sat-active');
});
