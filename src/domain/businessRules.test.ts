import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateAdminAccountCreation,
  processConcurrentAdminCreations,
  validateCampActivation,
  validateCampNotArchived,
  calculateHaversineDistanceMeters,
  evaluateDailyCheckin,
  validateLectureScheduleSlot,
  finalizeAttendanceSubmission,
  evaluateLectureEntitlement,
  validateEntitlementUpsert,
  validateStudentBatchImport,
  evaluateRlsPolicy,
  createValidatedAuditLogEntry,
  calculateCampDayDate,
  resolveStudentOriginGroupForDay,
  validateGpsCoordinates,
} from './businessRules';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CampStatus,
  CheckinStatus,
  EntitlementStatus,
  LectureStatus,
  OfflineSyncState,
  UserRole,
} from '../types/database';
import { validateSupabaseEnvConfig } from '../lib/supabase';

// =============================================================================
// 15 AUTOMATED DATABASE INTEGRITY & SECURITY TESTS (Phase 2 Requirement 9)
// =============================================================================

test('1. Admin account limit: enforces maximum of two Admin accounts', () => {
  assert.equal(validateAdminAccountCreation(0).allowed, true);
  assert.equal(validateAdminAccountCreation(1).allowed, true);
  const blocked = validateAdminAccountCreation(2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.error?.includes('Maximum of two Admin accounts'));

  // Reject linking an instructor profile to admin_accounts
  const wrongRole = validateAdminAccountCreation(1, {
    targetProfileRole: UserRole.INSTRUCTOR,
  });
  assert.equal(wrongRole.allowed, false);
});

test('2. Concurrent Admin creation protection: serializes concurrent requests and prevents >2 admins or slot collisions', () => {
  const initialAdmins = [
    {
      id: 'adm-1',
      profileId: 'prof-admin-1',
      assignedSlot: 1 as const,
      totpEnrolled: true,
      totpVerifiedAt: '2026-11-16T08:00:00Z',
    },
  ];

  // Three concurrent requests arrive simultaneously:
  // - Request A tries to claim already-taken Slot 1 -> rejected
  // - Request B claims Slot 2 -> allowed (reaches cap of 2)
  // - Request C tries to create a 3rd admin -> rejected
  const batch = processConcurrentAdminCreations(initialAdmins, [
    { profileId: 'prof-cand-a', role: UserRole.ADMIN, requestedSlot: 1 },
    { profileId: 'prof-cand-b', role: UserRole.ADMIN, requestedSlot: 2 },
    { profileId: 'prof-cand-c', role: UserRole.ADMIN, requestedSlot: 2 },
  ]);

  assert.equal(batch.finalAdmins.length, 2);
  assert.equal(batch.results[0].allowed, false); // Slot 1 collision
  assert.equal(batch.results[1].allowed, true); // Slot 2 succeeded
  assert.equal(batch.results[2].allowed, false); // Max 2 reached
});

test('3. Single active camp & archived camp read-only protection', () => {
  const camps = [
    { id: 'c1', nameEn: 'Cairo Spring Camp', status: CampStatus.ACTIVE },
    { id: 'c2', nameEn: 'Alexandria Summer Camp', status: CampStatus.DRAFT },
    { id: 'c3', nameEn: 'Winter Archive 2025', status: CampStatus.ARCHIVED },
  ];
  // Cannot activate c2 while c1 is active
  const res = validateCampActivation(camps, 'c2');
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes('Cairo Spring Camp'));

  // Archived camp is strictly read-only
  const archiveCheck = validateCampNotArchived(camps[2]);
  assert.equal(archiveCheck.allowed, false);
  assert.ok(archiveCheck.error?.includes('read-only'));
});

test('4. Student Code uniqueness within a camp (same code allowed in different camps)', () => {
  const existingStudents = [
    {
      id: 's1',
      campId: 'camp-A',
      groupId: 'G1',
      studentCode: 'CITS-101',
      fullName: 'Nour El-Din',
      university: 'Cairo University',
      isActive: true,
    },
  ];

  // Duplicate in the SAME camp ('camp-A') under strict_insert -> blocked
  const sameCampDup = validateStudentBatchImport({
    rows: [{ rowNumber: 1, studentName: 'Another Student', studentCode: 'CITS-101' }],
    existingStudents,
    targetCampId: 'camp-A',
    mode: 'strict_insert',
  });
  assert.equal(sameCampDup.valid, false);
  assert.equal(sameCampDup.toInsert.length, 0);

  // Same code ('CITS-101') in a DIFFERENT camp ('camp-B') -> allowed!
  const differentCampAllowed = validateStudentBatchImport({
    rows: [{ rowNumber: 1, studentName: 'Nour El-Din', studentCode: 'CITS-101' }],
    existingStudents,
    targetCampId: 'camp-B',
    mode: 'strict_insert',
  });
  assert.equal(differentCampAllowed.valid, true);
  assert.equal(differentCampAllowed.toInsert.length, 1);
});

test('5. Instructor scheduling conflicts (period collision and overlapping time window)', () => {
  const existing = [
    {
      id: 'l1',
      campId: 'c1',
      campDay: 4,
      lectureDate: '2026-11-16',
      periodNumber: 1,
      startTime: '09:00',
      endTime: '12:00',
      durationHours: 3,
      groupId: 'G1',
      instructorId: 'inst-1',
      substituteInstructorId: null,
      roomId: 'R101',
      topic: 'Algorithms I',
      status: LectureStatus.SCHEDULED,
      frozenRateEgp: 750,
      instructorAcknowledgedAt: null,
      revisionNumber: 1,
    },
  ];

  // Same instructor in overlapping custom time window (11:00–14:00 vs 09:00–12:00) even with different periodNumber
  const overlapConflict = validateLectureScheduleSlot({
    existingLectures: existing,
    candidate: {
      campId: 'c1',
      campDay: 4,
      periodNumber: 2,
      startTime: '11:00',
      endTime: '14:00',
      instructorId: 'inst-1',
      groupId: 'G2',
      roomId: 'R102',
    },
    maxGroupsPerDay: 4,
  });
  assert.equal(overlapConflict.valid, false);
  assert.ok(overlapConflict.conflicts.some((c) => c.includes('Instructor conflict')));
});

test('6. Group scheduling conflicts: blocks assigning the same group to two lectures in the same period', () => {
  const existing = [
    {
      id: 'l1',
      campId: 'c1',
      campDay: 4,
      lectureDate: '2026-11-16',
      periodNumber: 1,
      startTime: '09:00',
      endTime: '12:00',
      durationHours: 3,
      groupId: 'G1',
      instructorId: 'inst-1',
      substituteInstructorId: null,
      roomId: 'R101',
      topic: 'Algorithms I',
      status: LectureStatus.SCHEDULED,
      frozenRateEgp: 750,
      instructorAcknowledgedAt: null,
      revisionNumber: 1,
    },
  ];

  const groupConflict = validateLectureScheduleSlot({
    existingLectures: existing,
    candidate: {
      campId: 'c1',
      campDay: 4,
      periodNumber: 1,
      instructorId: 'inst-2',
      groupId: 'G1', // Same group!
      roomId: 'R102',
    },
    maxGroupsPerDay: 4,
  });
  assert.equal(groupConflict.valid, false);
  assert.ok(groupConflict.conflicts.some((c) => c.includes('Group conflict')));
});

test('7. Room scheduling conflicts: blocks assigning two groups to the same room in the same period', () => {
  const existing = [
    {
      id: 'l1',
      campId: 'c1',
      campDay: 4,
      lectureDate: '2026-11-16',
      periodNumber: 1,
      startTime: '09:00',
      endTime: '12:00',
      durationHours: 3,
      groupId: 'G1',
      instructorId: 'inst-1',
      substituteInstructorId: null,
      roomId: 'R101',
      topic: 'Algorithms I',
      status: LectureStatus.SCHEDULED,
      frozenRateEgp: 750,
      instructorAcknowledgedAt: null,
      revisionNumber: 1,
    },
  ];

  const roomConflict = validateLectureScheduleSlot({
    existingLectures: existing,
    candidate: {
      campId: 'c1',
      campDay: 4,
      periodNumber: 1,
      instructorId: 'inst-2',
      groupId: 'G2',
      roomId: 'R101', // Same room!
    },
    maxGroupsPerDay: 4,
  });
  assert.equal(roomConflict.valid, false);
  assert.ok(roomConflict.conflicts.some((c) => c.includes('Room conflict')));
});

test('8. Maximum daily instructor groups: enforces default 4 groups/day limit and configurable limit', () => {
  const fourLectures = [1, 2, 3, 4].map((p) => ({
    id: `lec-${p}`,
    campId: 'c1',
    campDay: 4,
    lectureDate: '2026-11-16',
    periodNumber: p,
    startTime: `${8 + p * 2}:00`,
    endTime: `${10 + p * 2}:00`,
    durationHours: 2,
    groupId: `G${p}`,
    instructorId: 'inst-1',
    substituteInstructorId: null,
    roomId: `R10${p}`,
    topic: `Topic ${p}`,
    status: LectureStatus.SCHEDULED,
    frozenRateEgp: 750,
    instructorAcknowledgedAt: null,
    revisionNumber: 1,
  }));

  // 5th distinct group on the same day for inst-1 -> blocked by default maxGroupsPerDay = 4
  const fifthGroup = validateLectureScheduleSlot({
    existingLectures: fourLectures,
    candidate: {
      campId: 'c1',
      campDay: 4,
      periodNumber: 5,
      startTime: '18:00',
      endTime: '20:00',
      instructorId: 'inst-1',
      groupId: 'G5',
      roomId: 'R105',
    },
    maxGroupsPerDay: 4,
  });
  assert.equal(fifthGroup.valid, false);
  assert.ok(fifthGroup.conflicts.some((c) => c.includes('maximum of 4 distinct groups')));
});

test('9. Duplicate attendance prevention: rejects duplicate student entries in same sheet or period', () => {
  const duplicateInSameSheet = finalizeAttendanceSubmission({
    records: [
      {
        studentId: 's1',
        studentCode: 'CITS-001',
        studentName: 'Omar Hassan',
        originGroupId: 'G1',
        attendedGroupId: 'G1',
        isCrossGroup: false,
        mark: AttendanceMark.PRESENT,
      },
      {
        studentId: 's1',
        studentCode: 'CITS-001',
        studentName: 'Omar Hassan',
        originGroupId: 'G1',
        attendedGroupId: 'G1',
        isCrossGroup: false,
        mark: AttendanceMark.PRESENT,
      },
    ],
    alreadyPresentStudentIdsSamePeriod: new Set(),
  });
  assert.equal(duplicateInSameSheet.valid, false);
  assert.ok(duplicateInSameSheet.error?.includes('Duplicate attendance record'));
});

test('10. Cross-group same-day attendance: allows valid temporary cross-group attendance and blocks duplicate same-day attendance across groups', () => {
  // Valid temporary cross-group attendance (origin G2 -> attended G1)
  const validCrossGroup = finalizeAttendanceSubmission({
    records: [
      {
        studentId: 's9',
        studentCode: 'CITS-009',
        studentName: 'Ziad Tarek',
        originGroupId: 'G2',
        attendedGroupId: 'G1',
        isCrossGroup: true,
        mark: AttendanceMark.PRESENT,
      },
    ],
    alreadyPresentStudentIdsSamePeriod: new Set(),
    alreadyPresentStudentIdsSameDayOtherGroups: new Map(),
  });
  assert.equal(validCrossGroup.valid, true);
  assert.equal(validCrossGroup.crossGroupCount, 1);
  assert.equal(validCrossGroup.finalizedRecords[0].originGroupId, 'G2');
  assert.equal(validCrossGroup.finalizedRecords[0].attendedGroupId, 'G1');
  assert.equal(validCrossGroup.finalizedRecords[0].isCrossGroup, true);

  // Blocked if s9 already attended G2 today
  const blockedDuplicateDay = finalizeAttendanceSubmission({
    records: [
      {
        studentId: 's9',
        studentCode: 'CITS-009',
        studentName: 'Ziad Tarek',
        originGroupId: 'G2',
        attendedGroupId: 'G1',
        isCrossGroup: true,
        mark: AttendanceMark.PRESENT,
      },
    ],
    alreadyPresentStudentIdsSamePeriod: new Set(),
    alreadyPresentStudentIdsSameDayOtherGroups: new Map([['s9', 'G2']]),
  });
  assert.equal(blockedDuplicateDay.valid, false);
  assert.ok(blockedDuplicateDay.error?.includes('Same-day cross-group conflict'));
});

test('11. Instructor access isolation & Anonymous denial (RLS Allowed vs Denied matrix)', () => {
  const anonActor = { role: 'anon' as const };
  const inst1Actor = {
    role: 'instructor' as const,
    profileId: 'prof-inst-1',
    instructorId: 'inst-1',
    assignedCampIds: ['camp-2026-spring'],
    assignedGroupIds: ['grp-1'],
  };
  const admin1Actor = { role: 'admin' as const, profileId: 'prof-admin-1' };
  const admin2Actor = { role: 'admin' as const, profileId: 'prof-admin-2' };

  // Anonymous denied everywhere
  assert.equal(
    evaluateRlsPolicy(anonActor, { table: 'camps', operation: 'SELECT' }).allowed,
    false
  );
  assert.equal(
    evaluateRlsPolicy(anonActor, { table: 'students', operation: 'SELECT' }).allowed,
    false
  );

  // Instructor ALLOWED scenarios: own profile, assigned camp, assigned group roster, own lecture, own entitlement SELECT
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'profiles',
      operation: 'SELECT',
      ownerProfileId: 'prof-inst-1',
    }).allowed,
    true
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'camps',
      operation: 'SELECT',
      campId: 'camp-2026-spring',
    }).allowed,
    true
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'students',
      operation: 'SELECT',
      groupId: 'grp-1',
    }).allowed,
    true
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'lecture_entitlements',
      operation: 'SELECT',
      ownerInstructorId: 'inst-1',
    }).allowed,
    true
  );

  // Instructor DENIED scenarios:
  // - Other instructor's profile, rate, check-in, or entitlement
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'profiles',
      operation: 'SELECT',
      ownerProfileId: 'prof-inst-2',
    }).allowed,
    false
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'instructor_rates',
      operation: 'SELECT',
      ownerInstructorId: 'inst-2',
    }).allowed,
    false
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'lecture_entitlements',
      operation: 'SELECT',
      ownerInstructorId: 'inst-2',
    }).allowed,
    false
  );
  // - Modifying schedules or cancelling lectures
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'lectures',
      operation: 'UPDATE',
      ownerInstructorId: 'inst-1',
    }).allowed,
    false
  );
  // - Approving own check-in exception
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'checkin_exceptions',
      operation: 'INSERT',
      ownerInstructorId: 'inst-1',
      attemptedExceptionSelfApproval: true,
    }).allowed,
    false
  );
  // - Escalating own role to admin
  assert.equal(
    evaluateRlsPolicy(inst1Actor, {
      table: 'profiles',
      operation: 'UPDATE',
      ownerProfileId: 'prof-inst-1',
      attemptedRoleChange: true,
    }).allowed,
    false
  );
  // - Reading unrestricted Admin tables (admin_accounts, audit_logs, backup_records)
  assert.equal(
    evaluateRlsPolicy(inst1Actor, { table: 'admin_accounts', operation: 'SELECT' }).allowed,
    false
  );
  assert.equal(
    evaluateRlsPolicy(inst1Actor, { table: 'audit_logs', operation: 'SELECT' }).allowed,
    false
  );

  // Both Admin 1 and Admin 2 have identical full operational access
  assert.equal(
    evaluateRlsPolicy(admin1Actor, { table: 'lecture_entitlements', operation: 'UPDATE' })
      .allowed,
    true
  );
  assert.equal(
    evaluateRlsPolicy(admin2Actor, { table: 'lecture_entitlements', operation: 'UPDATE' })
      .allowed,
    true
  );
});

test('12. Unauthorized financial modifications: blocks instructor entitlement edits and blocks admin overrides without reason', () => {
  const instActor = {
    role: 'instructor' as const,
    profileId: 'prof-inst-1',
    instructorId: 'inst-1',
  };

  assert.equal(
    evaluateRlsPolicy(instActor, {
      table: 'lecture_entitlements',
      operation: 'UPDATE',
      ownerInstructorId: 'inst-1',
    }).allowed,
    false
  );

  // Admin override without a reason is rejected
  const missingReason = evaluateLectureEntitlement({
    frozenRateEgp: 750,
    hasValidCheckin: true,
    isFirstLectureOfDay: true,
    arrivedLateFirstLecture: true,
    sheetStatus: AttendanceSheetStatus.SUBMITTED,
    syncState: OfflineSyncState.SYNCED,
    adminOverride: 'approved',
    adminOverrideReason: '   ',
  });
  assert.equal(missingReason.valid, false);
  assert.ok(missingReason.error?.includes('requires a non-empty audit reason'));
});

test('13. Attendance submission validation: unmarked students become absent only on submission; drafts never financially eligible', () => {
  const submission = finalizeAttendanceSubmission({
    records: [
      {
        studentId: 's1',
        studentCode: 'CITS-001',
        studentName: 'Omar Hassan',
        originGroupId: 'G1',
        attendedGroupId: 'G1',
        isCrossGroup: false,
        mark: AttendanceMark.PRESENT,
      },
      {
        studentId: 's2',
        studentCode: 'CITS-002',
        studentName: 'Salma Adel',
        originGroupId: 'G1',
        attendedGroupId: 'G1',
        isCrossGroup: false,
        mark: 'unmarked',
      },
    ],
    alreadyPresentStudentIdsSamePeriod: new Set(),
  });

  assert.equal(submission.valid, true);
  assert.equal(submission.presentCount, 1);
  assert.equal(submission.absentCount, 1);
  assert.equal(submission.finalizedRecords[1].mark, AttendanceMark.ABSENT);

  // Draft attendance is NEVER financially eligible
  const draftEntitlement = evaluateLectureEntitlement({
    frozenRateEgp: 750,
    hasValidCheckin: true,
    isFirstLectureOfDay: true,
    arrivedLateFirstLecture: false,
    sheetStatus: AttendanceSheetStatus.DRAFT,
    syncState: OfflineSyncState.OFFLINE,
  });
  assert.equal(draftEntitlement.entitlementAmountEgp, 0);
  assert.equal(draftEntitlement.status, EntitlementStatus.PENDING_REVIEW);

  // Synced & verified check-in + attendance is eligible
  const checkIn = evaluateDailyCheckin({
    instructorLat: 30.0712,
    instructorLng: 31.0167,
    venueLat: 30.0712,
    venueLng: 31.0167,
    geofenceRadiusMeters: 100,
    selfieSizeKb: 160,
    maxSelfieKb: 300,
    checkinTimeHHMM: '08:45',
    firstLectureStartHHMM: '09:00',
    lateThresholdMinutes: 60,
  });
  assert.equal(checkIn.status, CheckinStatus.VERIFIED);
  assert.equal(calculateHaversineDistanceMeters(30.0712, 31.0167, 30.0712, 31.0167), 0);
});

test('14. Entitlement uniqueness & frozen rate preservation', () => {
  const existingEntitlements = [
    {
      id: 'ent-1',
      campId: 'c1',
      lectureId: 'lec-1',
      instructorId: 'inst-1',
      campDay: 4,
      periodNumber: 1,
      frozenRateEgp: 750,
      entitlementAmountEgp: 750,
      status: EntitlementStatus.ELIGIBLE,
      eligibilityReason: 'Verified',
      updatedAt: '2026-11-16T12:00:00Z',
    },
  ];

  // Reject duplicate entitlement for same lectureId
  const dup = validateEntitlementUpsert({
    existingEntitlements,
    lecture: { id: 'lec-1', campId: 'c1', frozenRateEgp: 750 },
    candidate: { lectureId: 'lec-1', frozenRateEgp: 750, isInsert: true },
  });
  assert.equal(dup.allowed, false);
  assert.ok(dup.error?.includes('Duplicate entitlement blocked'));

  // Reject altering frozenRateEgp
  const alteredRate = validateEntitlementUpsert({
    existingEntitlements,
    lecture: { id: 'lec-2', campId: 'c1', frozenRateEgp: 750 },
    candidate: { lectureId: 'lec-2', frozenRateEgp: 900, isInsert: true },
  });
  assert.equal(alteredRate.allowed, false);
  assert.ok(alteredRate.error?.includes('Frozen rate mismatch'));
});

test('15. Audit log integrity & Supabase secret key leak protection', () => {
  // Valid audit log with campId and actorProfileId
  const validLog = createValidatedAuditLogEntry({
    actorProfileId: 'prof-admin-1',
    actorName: 'Eng. Tarek Mansour',
    actorRole: UserRole.ADMIN,
    campId: 'camp-2026-spring',
    action: 'ENTITLEMENT_APPROVED',
    entityType: 'lecture_entitlements',
    entityId: 'ent-3',
    previousValue: { status: 'pending_review', amount: 0 },
    newValue: { status: 'approved', amount: 700 },
    reason: 'Approved after traffic closure verification',
  });
  assert.equal(validLog.valid, true);
  assert.equal(validLog.entry?.campId, 'camp-2026-spring');

  // Block logging sensitive credentials (passwords, tokens, service_role, MFA secrets)
  const leakedSecretLog = createValidatedAuditLogEntry({
    actorProfileId: 'prof-admin-1',
    actorName: 'Eng. Tarek Mansour',
    actorRole: UserRole.ADMIN,
    campId: 'camp-2026-spring',
    action: 'PROFILE_UPDATE',
    entityType: 'profiles',
    entityId: 'prof-inst-1',
    previousValue: null,
    newValue: { password: 'PlaintextPassword123', totp_secret: 'JBSWY3DPEHPK3PXP' },
    reason: 'Reset',
  });
  assert.equal(leakedSecretLog.valid, false);
  assert.ok(leakedSecretLog.error?.includes('must never be written to audit_logs'));

  // Audit logs cannot be updated or deleted even by Admin
  assert.equal(
    evaluateRlsPolicy(
      { role: 'admin', profileId: 'prof-admin-1' },
      { table: 'audit_logs', operation: 'UPDATE' }
    ).allowed,
    false
  );
  assert.equal(
    evaluateRlsPolicy(
      { role: 'admin', profileId: 'prof-admin-1' },
      { table: 'audit_logs', operation: 'DELETE' }
    ).allowed,
    false
  );

  // Verify VITE_SUPABASE_ANON_KEY rejects service_role or sb_secret_ keys
  const secretKeyLeak = validateSupabaseEnvConfig(
    'https://xyzcompany.supabase.co',
    'sb_secret_123456789'
  );
  assert.equal(secretKeyLeak.isConfigured, false);
  assert.equal(secretKeyLeak.mode, 'security_error');
});

test('16. Migration SQL verification: 0001 and 0002 define all 29 tables, RLS policies, and hardened SECURITY DEFINER functions', () => {
  const mig1Path = path.resolve(process.cwd(), 'supabase/migrations/0001_cits_initial_schema.sql');
  const mig2Path = path.resolve(
    process.cwd(),
    'supabase/migrations/0002_phase2_security_rls_and_validation.sql'
  );
  const mig1 = fs.readFileSync(mig1Path, 'utf8');
  const mig2 = fs.readFileSync(mig2Path, 'utf8');
  const combinedSql = `${mig1}\n${mig2}`;

  const requiredTables = [
    'profiles',
    'admin_accounts',
    'instructors',
    'venues',
    'camps',
    'camp_settings',
    'rooms',
    'camp_instructors',
    'instructor_rates',
    'groups',
    'group_instructors',
    'students',
    'student_transfers',
    'lectures',
    'daily_checkins',
    'checkin_exceptions',
    'attendance_sheets',
    'attendance_records',
    'lecture_entitlements',
    'instructor_requests',
    'notifications',
    'issues',
    'daily_checklists',
    'survey_links',
    'survey_results',
    'instructor_evaluations',
    'attachments',
    'audit_logs',
    'backup_records',
  ];

  for (const tbl of requiredTables) {
    assert.ok(
      combinedSql.includes(`CREATE TABLE ${tbl}`),
      `Missing CREATE TABLE for ${tbl}`
    );
    assert.ok(
      combinedSql.includes(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;`),
      `Missing ENABLE ROW LEVEL SECURITY for ${tbl}`
    );
    assert.ok(
      mig2.includes(`ON ${tbl}`),
      `Missing explicit RLS policy in 0002 migration for ${tbl}`
    );
  }

  // Ensure zero broad USING (true) policies exist
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(combinedSql), false);

  // Ensure zero destructive operations (DROP TABLE, TRUNCATE, DELETE FROM) in migrations 0001 and 0002
  assert.equal(/DROP\s+TABLE/i.test(combinedSql), false);
  assert.equal(/TRUNCATE\s+/i.test(combinedSql), false);
  assert.equal(/DELETE\s+FROM/i.test(combinedSql), false);

  // Ensure hardened search_path on SECURITY DEFINER functions in 0002
  assert.ok(mig2.includes('SET search_path = public, pg_temp'));
  assert.ok(mig2.includes('pg_advisory_xact_lock'));
  assert.ok(mig2.includes('submit_attendance_sheet_tx'));
  assert.ok(mig2.includes('admin_override_entitlement_tx'));

  // Ensure private checkin-selfies Storage bucket (300KB = 307200 bytes, JPEG/WebP) & bootstrap function
  assert.ok(mig2.includes("'checkin-selfies'"));
  assert.ok(mig2.includes('307200'));
  assert.ok(mig2.includes("ARRAY['image/jpeg', 'image/webp']"));
  assert.ok(mig2.includes('bootstrap_cits_admin_account'));
  assert.ok(
    mig2.includes(
      'REVOKE ALL ON FUNCTION bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT) FROM anon;'
    )
  );

  // Verify 0003 remote verification & RLS test suite exists and wraps tests in BEGIN ... ROLLBACK
  const verifySqlPath = path.resolve(
    process.cwd(),
    'supabase/verification/0003_remote_verification_and_rls_test_suite.sql'
  );
  const verifySql = fs.readFileSync(verifySqlPath, 'utf8');
  assert.ok(verifySql.includes('BEGIN;'));
  assert.ok(verifySql.includes('ROLLBACK;'));
  assert.equal(/\bCOMMIT\s*;/i.test(verifySql), false);
  // Ensure functions are verified via to_regprocedure (pg_proc), never to_regclass
  assert.ok(
    verifySql.includes(
      "to_regprocedure('public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)')"
    )
  );
  assert.equal(verifySql.includes('to_regclass'), false);
  // Ensure zero top-level SELECT set_config(...) statements that overwrite SQL Editor Results grid
  assert.equal(/SELECT\s+set_config\s*\(/i.test(verifySql), false);
  // Ensure explicit ::smallint casts on all bootstrap_cits_admin_account calls
  assert.ok(verifySql.includes('1::smallint'));
  assert.ok(verifySql.includes('2::smallint'));
  // Ensure audit_logs UPDATE/DELETE target only WHERE id = v_test_audit_id, never broad entity_type
  assert.ok(verifySql.includes('WHERE id = v_test_audit_id;'));
  assert.equal(verifySql.includes("WHERE entity_type = 'attendance_sheets'"), false);
  // Ensure row_security_active() is asserted for RLS tests and fixture setup is guarded
  assert.ok(verifySql.includes("row_security_active('public.profiles'::regclass)"));
  assert.ok(verifySql.includes('v_fixtures_ready'));
  assert.ok(verifySql.includes('INSERT INTO public.admin_accounts'));
  // Ensure zero silent WHEN OTHERS THEN NULL handlers exist anywhere in 0003
  assert.equal(/WHEN\s+OTHERS\s+THEN\s+NULL/i.test(verifySql), false);
  // Ensure Test 10 explicitly verifies v_ent_a_id IS NOT NULL, exact count = 1, and linkage to v_lec_a_id before RLS
  assert.ok(verifySql.includes('IF v_ent_a_id IS NULL THEN'));
  assert.ok(verifySql.includes('IF v_ent_exact_count != 1 THEN'));
  assert.ok(verifySql.includes('IF v_ent_linked_count != 1 THEN'));
  assert.ok(verifySql.includes('OR v_own_entitlements != 1'));
  // Ensure exact 29 named tables array, column_default/cross-schema sequence audits, multi-table trigger guard, and role restoration exist
  assert.ok(verifySql.includes('v_required_tables CONSTANT TEXT[]'));
  assert.ok(verifySql.includes('v_allowed_cits_trigger_funcs CONSTANT TEXT[]'));
  assert.ok(verifySql.includes('v_expected_trigger_regprocs CONSTANT TEXT[]'));
  assert.ok(verifySql.includes('v_allowed_cits_helper_funcs CONSTANT TEXT[]'));
  assert.ok(verifySql.includes('v_expected_helper_regprocs CONSTANT TEXT[]'));
  for (const tbl of requiredTables) {
    assert.ok(verifySql.includes(`'${tbl}'`), `Missing named table '${tbl}' in 0003 v_required_tables`);
  }
  assert.ok(verifySql.includes('v_non_uuid_pk_tables'));
  assert.ok(verifySql.includes("pk.contype = 'p'"));
  assert.ok(verifySql.includes("fk.contype = 'f'"));
  assert.ok(verifySql.includes('v_profiles_fk_verified'));
  assert.ok(verifySql.includes('v_unsafe_column_defaults'));
  assert.ok(verifySql.includes('v_owned_sequences'));
  assert.ok(verifySql.includes('v_default_ref_sequences'));
  assert.ok(verifySql.includes('v_default_func_deps'));
  assert.ok(verifySql.includes("d.classid = 'pg_attrdef'::regclass"));
  assert.ok(verifySql.includes("ed.deptype = 'e'"));
  assert.ok(verifySql.includes('pg_get_expr(ad.adbin, ad.adrelid)'));
  assert.ok(verifySql.includes('v_attached_sequences'));
  assert.ok(verifySql.includes('v_public_seq_count'));
  assert.ok(verifySql.includes('v_unsafe_triggers'));
  assert.ok(verifySql.includes('v_missing_or_overloaded_sigs'));
  assert.ok(verifySql.includes('v_unsafe_helper_funcs'));
  assert.ok(verifySql.includes('WITH RECURSIVE audited_procs AS'));
  assert.ok(verifySql.includes('v_untracked_or_unsafe_callees'));
  assert.ok(verifySql.includes('v_reached_helper_summary'));
  assert.ok(verifySql.includes('v_review_required_policies'));
  assert.ok(verifySql.includes('REVIEW_REQUIRED'));
  assert.ok(verifySql.includes("COALESCE(p.prosrc, '') ILIKE '%net.%'"));
  assert.ok(verifySql.includes("COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%net.%'"));
  assert.ok(verifySql.includes("EXECUTE format('SET LOCAL ROLE %I', v_initial_role);"));
  assert.ok(verifySql.includes('IF current_user != v_initial_role THEN'));
  assert.ok(
    verifySql.includes(
      'Targeted 6-table behavioral RLS verified on seeded rows (profiles, camps, lectures, instructor_rates, lecture_entitlements, audit_logs — not all 29 tables)'
    )
  );
  // Ensure every INSERT INTO public.<table_name> in 0003 explicitly specifies id as its first column
  const publicInserts = verifySql.match(/INSERT\s+INTO\s+public\.[a-z_]+\s*\(([^)]+)\)/gi) || [];
  assert.ok(publicInserts.length >= 18, `Expected >= 18 INSERT INTO public.* statements, found ${publicInserts.length}`);
  for (const ins of publicInserts) {
    assert.ok(/INSERT\s+INTO\s+public\.[a-z_]+\s*\(\s*id\s*,/i.test(ins), `INSERT statement missing explicit id column: ${ins}`);
  }
  // Ensure all 10 [FAIL X/10 (NOT RUN)], [PASS X/10], and [FAIL X/10] markers and final SELECT exist
  for (let i = 1; i <= 10; i++) {
    assert.ok(verifySql.includes(`[FAIL ${i}/10 (NOT RUN)]`), `Missing pre-seeded [FAIL ${i}/10 (NOT RUN)] in 0003`);
    assert.ok(verifySql.includes(`[PASS ${i}/10]`), `Missing [PASS ${i}/10] in 0003`);
    assert.ok(verifySql.includes(`[FAIL ${i}/10]`), `Missing [FAIL ${i}/10] in 0003`);
  }
  assert.ok(verifySql.includes('FROM _cits_verification_report'));
});

test('17. Camp day date calculation & historical student transfer origin-group resolution', () => {
  // Camp day date mapping
  assert.equal(calculateCampDayDate('2026-11-13', 1), '2026-11-13');
  assert.equal(calculateCampDayDate('2026-11-13', 4), '2026-11-16');
  assert.equal(calculateCampDayDate('2026-11-13', 0), '2026-11-13');
  assert.equal(calculateCampDayDate('2026-11-13', -3), '2026-11-13');

  // Chained historical transfers across camp days:
  // Student is currently in G3 after G1 -> G2 (Day 3) and G2 -> G3 (Day 6)
  const student = { id: 'stu-1', campId: 'camp-1', groupId: 'G3' };
  const transfers = [
    {
      id: 'tr-1',
      campId: 'camp-1',
      studentId: 'stu-1',
      fromGroupId: 'G1',
      toGroupId: 'G2',
      effectiveCampDay: 3,
      reason: 'Skill balance',
      transferredBy: 'adm-1',
      createdAt: '2026-11-15T08:00:00Z',
    },
    {
      id: 'tr-2',
      campId: 'camp-1',
      studentId: 'stu-1',
      fromGroupId: 'G2',
      toGroupId: 'G3',
      effectiveCampDay: 6,
      reason: 'Advanced track',
      transferredBy: 'adm-1',
      createdAt: '2026-11-18T08:00:00Z',
    },
  ];

  // Days 1-2: before first transfer -> G1
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 1 }), 'G1');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 2 }), 'G1');
  // Days 3-5: between transfer 1 and transfer 2 -> G2
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 3 }), 'G2');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 5 }), 'G2');
  // Days 6+: after transfer 2 -> G3
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 6 }), 'G3');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 10 }), 'G3');

  // Student with no transfers defaults to current groupId
  assert.equal(
    resolveStudentOriginGroupForDay({ student, transfers: [], campDay: 2 }),
    'G3'
  );
});

test('18. Hardened RLS policy: submitted and locked attendance sheets/records are immutable to instructors but editable by Admin', () => {
  const instActor = {
    role: 'instructor' as const,
    profileId: 'prof-inst-1',
    instructorId: 'inst-1',
  };
  const adminActor = {
    role: 'admin' as const,
    profileId: 'prof-admin-1',
  };

  // Draft allowed for owning instructor
  assert.equal(
    evaluateRlsPolicy(instActor, {
      table: 'attendance_sheets',
      operation: 'UPDATE',
      ownerInstructorId: 'inst-1',
      sheetStatus: AttendanceSheetStatus.DRAFT,
    }).allowed,
    true
  );
  assert.equal(
    evaluateRlsPolicy(instActor, {
      table: 'attendance_records',
      operation: 'INSERT',
      ownerInstructorId: 'inst-1',
      sheetStatus: AttendanceSheetStatus.DRAFT,
    }).allowed,
    true
  );

  // Submitted and Locked denied for instructor
  for (const status of [AttendanceSheetStatus.SUBMITTED, AttendanceSheetStatus.LOCKED]) {
    assert.equal(
      evaluateRlsPolicy(instActor, {
        table: 'attendance_sheets',
        operation: 'UPDATE',
        ownerInstructorId: 'inst-1',
        sheetStatus: status,
      }).allowed,
      false
    );
    assert.equal(
      evaluateRlsPolicy(instActor, {
        table: 'attendance_records',
        operation: 'INSERT',
        ownerInstructorId: 'inst-1',
        sheetStatus: status,
      }).allowed,
      false
    );
    assert.equal(
      evaluateRlsPolicy(instActor, {
        table: 'attendance_records',
        operation: 'UPDATE',
        ownerInstructorId: 'inst-1',
        sheetStatus: status,
      }).allowed,
      false
    );
  }

  // Admin can modify attendance records/sheets across statuses
  assert.equal(
    evaluateRlsPolicy(adminActor, {
      table: 'attendance_records',
      operation: 'UPDATE',
      sheetStatus: AttendanceSheetStatus.SUBMITTED,
    }).allowed,
    true
  );
});

test('19. Migration 0004 security hardening verification (non-destructive, search_path, triggers, RPCs, grants)', () => {
  const mig4Path = path.resolve(
    process.cwd(),
    'supabase/migrations/0004_phase2_comprehensive_security_hardening.sql'
  );
  const mig4 = fs.readFileSync(mig4Path, 'utf8');

  // Extract executable body before rollback comments
  const executableSql = mig4.split('-- ROLLBACK CONSIDERATIONS')[0];

  assert.ok(executableSql.includes('BEGIN;'));
  assert.ok(executableSql.includes('COMMIT;'));
  assert.equal(/ROLLBACK\s*;/i.test(executableSql), false);

  // Zero destructive table operations or broad USING (true) or silent error swallowing
  assert.equal(/DROP\s+TABLE/i.test(executableSql), false);
  assert.equal(/TRUNCATE\s+/i.test(executableSql), false);
  assert.equal(/DELETE\s+FROM/i.test(executableSql), false);
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(executableSql), false);
  assert.equal(/WHEN\s+OTHERS\s+THEN\s+NULL/i.test(executableSql), false);

  // Required functions & SECURITY DEFINER hardening
  const expectedFunctions = [
    'is_cits_admin',
    'is_lecture_active_instructor',
    'haversine_distance_meters',
    'resolve_student_group_for_day',
    'enforce_lecture_update_security',
    'enforce_attendance_sheet_security',
    'validate_attendance_record_integrity',
    'submit_attendance_sheet_tx',
    'enforce_daily_checkin_security',
    'enforce_checkin_exception_security',
    'submit_daily_checkin_tx',
    'enforce_notification_update_security',
    'enforce_audit_log_integrity',
    'acknowledge_lecture_tx',
    'transfer_student_tx',
    'batch_import_students_tx',
    'review_checkin_exception_tx',
    'archive_camp_tx',
    'complete_password_change_tx',
    'record_admin_totp_verified_tx',
  ];

  for (const fn of expectedFunctions) {
    assert.ok(executableSql.includes(fn), `Missing expected function ${fn} in 0004`);
  }

  // Admin MFA (aal2) enforcement & TOTP factor check
  assert.ok(executableSql.includes("auth.jwt() ->> 'aal'"));
  assert.ok(executableSql.includes('Admins view own admin_account'));
  assert.ok(executableSql.includes('auth.mfa_factors'));
  assert.ok(executableSql.includes('ADMIN_MFA_VERIFIED'));
  assert.ok(executableSql.includes('selfie_deleted_after_archive = TRUE'));

  // Every function header in 0004 must pin search_path = public, pg_temp
  const funcCreateCount = (executableSql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi) || []).length;
  const searchPathCount = (executableSql.match(/SET\s+search_path\s*=\s*public,\s*pg_temp/gi) || []).length;
  assert.equal(
    searchPathCount,
    funcCreateCount,
    `Expected search_path on all ${funcCreateCount} functions in 0004, found ${searchPathCount}`
  );

  // Archived camp read-only triggers attached to all 13 extended child tables
  const extendedChildTables = [
    'camp_settings',
    'camp_instructors',
    'instructor_rates',
    'group_instructors',
    'student_transfers',
    'daily_checkins',
    'checkin_exceptions',
    'instructor_requests',
    'issues',
    'daily_checklists',
    'survey_links',
    'survey_results',
    'instructor_evaluations',
  ];

  for (const tbl of extendedChildTables) {
    assert.ok(
      executableSql.includes(`trg_readonly_archived_${tbl}`),
      `Missing archived camp trigger on child table ${tbl}`
    );
  }
});

test('20. Verification suite 0004 & 0003 allowlist compatibility checks', () => {
  const verify4Path = path.resolve(
    process.cwd(),
    'supabase/verification/0004_phase2_hardening_verification.sql'
  );
  const verify4 = fs.readFileSync(verify4Path, 'utf8');

  assert.ok(verify4.includes('BEGIN;'));
  assert.ok(verify4.includes('ROLLBACK;'));
  assert.equal(/\bCOMMIT\s*;/i.test(verify4), false);
  assert.equal(/WHEN\s+OTHERS\s+THEN\s+NULL/i.test(verify4), false);

  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8']) {
    assert.ok(verify4.includes(h), `Missing ${h} verification test in 0004 suite`);
  }

  // Ensure 0003 remote verification allowlist & Admin JWT simulation match 0004 controls
  const verify3Path = path.resolve(
    process.cwd(),
    'supabase/verification/0003_remote_verification_and_rls_test_suite.sql'
  );
  const verify3 = fs.readFileSync(verify3Path, 'utf8');

  for (const sig of [
    'enforce_lecture_update_security',
    'enforce_attendance_sheet_security',
    'enforce_daily_checkin_security',
    'enforce_checkin_exception_security',
    'enforce_notification_update_security',
    'is_lecture_active_instructor',
    'haversine_distance_meters',
    'resolve_student_group_for_day',
    'submit_daily_checkin_tx',
    'transfer_student_tx',
    'archive_camp_tx',
    "'aal', 'aal2'",
  ]) {
    assert.ok(verify3.includes(sig), `Missing 0004 symbol '${sig}' in 0003 Pre-Flight allowlist or claims`);
  }
});

test('21. Chained & same-day historical transfer resolution and smart_update group-lock preservation', () => {
  const student = { id: 'stu-chain', campId: 'camp-1', groupId: 'G-B' };
  const transfers = [
    {
      id: 't1',
      campId: 'camp-1',
      studentId: 'stu-chain',
      fromGroupId: 'G-A',
      toGroupId: 'G-B',
      effectiveCampDay: 2,
      reason: 'Hop 1',
      transferredBy: 'adm-1',
      createdAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 't2',
      campId: 'camp-1',
      studentId: 'stu-chain',
      fromGroupId: 'G-B',
      toGroupId: 'G-A',
      effectiveCampDay: 4,
      reason: 'Same-day hop 2a',
      transferredBy: 'adm-1',
      createdAt: '2026-11-13T09:00:00Z',
    },
    {
      id: 't3',
      campId: 'camp-1',
      studentId: 'stu-chain',
      fromGroupId: 'G-A',
      toGroupId: 'G-C',
      effectiveCampDay: 4,
      reason: 'Same-day hop 2b',
      transferredBy: 'adm-1',
      createdAt: '2026-11-13T10:30:00Z',
    },
    {
      id: 't4',
      campId: 'camp-1',
      studentId: 'stu-chain',
      fromGroupId: 'G-C',
      toGroupId: 'G-B',
      effectiveCampDay: 6,
      reason: 'Future hop 3',
      transferredBy: 'adm-1',
      createdAt: '2026-11-15T08:00:00Z',
    },
  ];

  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 1 }), 'G-A');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 2 }), 'G-B');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 3 }), 'G-B');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 4 }), 'G-C');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 5 }), 'G-C');
  assert.equal(resolveStudentOriginGroupForDay({ student, transfers, campDay: 6 }), 'G-B');

  // smart_update refuses silent cross-group overwrite when student exists in another group
  const existingStudents = [
    { id: 'stu-1', campId: 'camp-1', groupId: 'G-A', studentCode: 'ST-101', fullName: 'Ali', university: 'CU', isActive: true },
  ];
  const blockedCrossGroup = validateStudentBatchImport({
    rows: [{ rowNumber: 2, studentCode: 'st-101', studentName: 'Ali Updated', university: 'CU' }],
    existingStudents,
    targetCampId: 'camp-1',
    targetGroupId: 'G-B',
    mode: 'smart_update',
  });
  assert.equal(blockedCrossGroup.valid, false);
  assert.ok(blockedCrossGroup.errors.some((e) => e.message.includes('Transfer')));

  // Same target group update is permitted cleanly
  const sameGroupAllowed = validateStudentBatchImport({
    rows: [{ rowNumber: 2, studentCode: 'st-101', studentName: 'Ali Updated', university: 'CU' }],
    existingStudents,
    targetCampId: 'camp-1',
    targetGroupId: 'G-A',
    mode: 'smart_update',
  });
  assert.equal(sameGroupAllowed.valid, true);
  assert.equal(sameGroupAllowed.toUpdate.length, 1);
});

test('22. GPS coordinate & accuracy boundary validation (NaN, Infinity, WGS84 bounds, 500m cap)', () => {
  assert.equal(validateGpsCoordinates(30.0712, 31.0167, 18).valid, true);
  assert.equal(validateGpsCoordinates(-90, -180, 0).valid, true);
  assert.equal(validateGpsCoordinates(90, 180, 500).valid, true);

  assert.equal(validateGpsCoordinates(Number.NaN, 31.0167, 15).valid, false);
  assert.equal(validateGpsCoordinates(30.0712, Number.POSITIVE_INFINITY, 15).valid, false);
  assert.equal(validateGpsCoordinates(90.0001, 31.0167, 15).valid, false);
  assert.equal(validateGpsCoordinates(30.0712, -180.0001, 15).valid, false);
  assert.equal(validateGpsCoordinates(30.0712, 31.0167, -1).valid, false);
  assert.equal(validateGpsCoordinates(30.0712, 31.0167, 500.1).valid, false);
  assert.equal(validateGpsCoordinates(30.0712, 31.0167, Number.NaN).valid, false);
});

function run0003LexicalScanner(src: string): {
  cleanSrc: string;
  lexIssues: string | null;
} {
  let pos = 0;
  const len = src.length;
  let inLineComment = false;
  let blockCommentDepth = 0;
  let inSingleQuote = false;
  let cleanBuf = '';
  let hasDollarToken = false;
  let hasDoubleQuote = false;
  let hasNonStdQuotePrefix = false;
  let hasBackslashInQuote = false;
  let hasStrayBlockClose = false;

  while (pos < len) {
    const ch = src[pos];
    const next = pos + 1 < len ? src[pos + 1] : '';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        cleanBuf += ch;
      }
      pos += 1;
    } else if (blockCommentDepth > 0) {
      if (ch === '/' && next === '*') {
        blockCommentDepth += 1;
        pos += 2;
      } else if (ch === '*' && next === '/') {
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) {
          cleanBuf += ' ';
        }
        pos += 2;
      } else {
        pos += 1;
      }
    } else if (inSingleQuote) {
      if (ch === '\\') {
        hasBackslashInQuote = true;
        pos += 1;
      } else if (ch === "'") {
        if (next === "'") {
          pos += 2;
        } else {
          inSingleQuote = false;
          cleanBuf += "''";
          pos += 1;
        }
      } else {
        pos += 1;
      }
    } else {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        cleanBuf += ' ';
        pos += 2;
      } else if (ch === '/' && next === '*') {
        blockCommentDepth = 1;
        pos += 2;
      } else if (ch === '*' && next === '/') {
        hasStrayBlockClose = true;
        pos += 2;
      } else if (ch === "'") {
        if (pos > 0 && /^[eEbBxXnN&]$/.test(src[pos - 1])) {
          hasNonStdQuotePrefix = true;
        }
        inSingleQuote = true;
        pos += 1;
      } else if (ch === '$') {
        hasDollarToken = true;
        cleanBuf += ch;
        pos += 1;
      } else if (ch === '"') {
        hasDoubleQuote = true;
        cleanBuf += ch;
        pos += 1;
      } else {
        cleanBuf += ch;
        pos += 1;
      }
    }
  }

  const issues: string[] = [];
  if (inSingleQuote) issues.push('UNCLOSED_SINGLE_QUOTE');
  if (blockCommentDepth > 0) issues.push('UNCLOSED_NESTED_BLOCK_COMMENT');
  if (hasStrayBlockClose) issues.push('STRAY_BLOCK_COMMENT_CLOSE');
  if (hasNonStdQuotePrefix) issues.push('NON_STANDARD_STRING_PREFIX');
  if (hasBackslashInQuote) issues.push('BACKSLASH_IN_SINGLE_QUOTE_LITERAL');
  if (hasDollarToken) issues.push('DOLLAR_QUOTE_OR_PARAM_IN_BODY');
  if (hasDoubleQuote) issues.push('DOUBLE_QUOTED_IDENTIFIER_IN_BODY');

  return {
    cleanSrc: cleanBuf,
    lexIssues: issues.length > 0 ? issues.join('+') : null,
  };
}

function extractSqlArrayLiterals(sql: string, varName: string): string[] {
  const re = new RegExp(`${varName}\\s+CONSTANT\\s+TEXT\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`);
  const match = sql.match(re);
  if (!match) return [];
  const items: string[] = [];
  const strRe = /'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(match[1])) !== null) {
    items.push(m[1]);
  }
  return items;
}

test('23. Local PL/pgSQL Guard 1C lexical scanner passes every active function definition across migrations 0001..0005', () => {
  const migFiles = [
    'supabase/migrations/0001_cits_initial_schema.sql',
    'supabase/migrations/0002_phase2_security_rls_and_validation.sql',
    'supabase/migrations/0003_fix_archived_camp_child_trigger.sql',
    'supabase/migrations/0004_phase2_comprehensive_security_hardening.sql',
    'supabase/migrations/0005_phase2_finalization_hardening.sql',
  ];

  // Negative synthetic tests verifying scanner catches banned lexical edge cases
  assert.equal(run0003LexicalScanner("RETURN 'it''s /* safe */ $safe';").lexIssues, null);
  assert.ok(run0003LexicalScanner('SELECT $1;').lexIssues?.includes('DOLLAR_QUOTE_OR_PARAM_IN_BODY'));
  assert.ok(run0003LexicalScanner('SELECT "bad";').lexIssues?.includes('DOUBLE_QUOTED_IDENTIFIER_IN_BODY'));
  assert.ok(run0003LexicalScanner("SELECT 'unclosed;").lexIssues?.includes('UNCLOSED_SINGLE_QUOTE'));
  assert.ok(run0003LexicalScanner('/* outer /* inner */ still open').lexIssues?.includes('UNCLOSED_NESTED_BLOCK_COMMENT'));
  assert.ok(run0003LexicalScanner("SELECT E'esc';").lexIssues?.includes('NON_STANDARD_STRING_PREFIX'));
  assert.ok(run0003LexicalScanner("SELECT 'a\\b';").lexIssues?.includes('BACKSLASH_IN_SINGLE_QUOTE_LITERAL'));

  const latestFunctions = new Map<string, { header: string; body: string; file: string }>();
  const fnRe =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)AS\s+\$\$([\s\S]*?)\$\$;/g;

  for (const rel of migFiles) {
    const raw = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    const execPart = raw.split('-- ROLLBACK CONSIDERATIONS')[0];
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(execPart)) !== null) {
      latestFunctions.set(m[1].toLowerCase(), { header: m[2], body: m[3], file: rel });
    }
  }

  const verify3 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/verification/0003_remote_verification_and_rls_test_suite.sql'),
    'utf8'
  );
  const triggerFuncs = extractSqlArrayLiterals(verify3, 'v_allowed_cits_trigger_funcs');
  const helperFuncs = extractSqlArrayLiterals(verify3, 'v_allowed_cits_helper_funcs');
  const safeTokens = new Set(extractSqlArrayLiterals(verify3, 'v_safe_builtin_call_tokens'));
  const requiredTables = new Set(extractSqlArrayLiterals(verify3, 'v_required_tables'));
  const allApprovedNames = new Set([...triggerFuncs, ...helperFuncs]);

  assert.ok(allApprovedNames.size >= 38, `Expected >= 38 approved functions in 0003, found ${allApprovedNames.size}`);

  for (const fnName of allApprovedNames) {
    const def = latestFunctions.get(fnName);
    assert.ok(def, `Approved function ${fnName} in 0003 not found in migrations 0001..0005`);
    assert.ok(
      /SET\s+search_path\s*=\s*public,\s*pg_temp/i.test(def.header),
      `Function ${fnName} (${def.file}) lacks pinned search_path = public, pg_temp`
    );

    const scan = run0003LexicalScanner(def.body);
    assert.equal(
      scan.lexIssues,
      null,
      `Guard 1C scanner flagged ${fnName} (${def.file}): ${scan.lexIssues}`
    );

    const callRe = /((?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(scan.cleanSrc)) !== null) {
      const qual = (cm[1] ?? '').replace(/\.$/, '').toLowerCase();
      const ident = cm[2].toLowerCase();
      if (qual.includes('"') || ident.includes('"')) {
        assert.fail(`Quoted call token ${qual}.${ident} inside ${fnName} (${def.file})`);
      }
      if (safeTokens.has(ident)) continue;
      if (requiredTables.has(ident)) continue;
      if (qual === 'auth' && ['uid', 'jwt', 'role'].includes(ident)) continue;
      assert.ok(
        (qual === '' || qual === 'public') && allApprovedNames.has(ident),
        `Unapproved/unlisted call token '${qual ? `${qual}.` : ''}${ident}()' inside ${fnName} (${def.file})`
      );
    }
  }
});

test('24. Migration 0005 & verification suites security and non-destructive integrity checks', () => {
  const mig5 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/0005_phase2_finalization_hardening.sql'),
    'utf8'
  );
  const mig5Exec = mig5.split('-- ROLLBACK CONSIDERATIONS')[0];
  assert.ok(mig5Exec.includes('BEGIN;'));
  assert.ok(mig5Exec.includes('COMMIT;'));
  assert.equal(/ROLLBACK\s*;/i.test(mig5Exec), false);
  assert.equal(/DROP\s+TABLE/i.test(mig5Exec), false);
  assert.equal(/TRUNCATE\s+/i.test(mig5Exec), false);
  assert.equal(/DELETE\s+FROM/i.test(mig5Exec), false);
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(mig5Exec), false);
  assert.equal(/WHEN\s+OTHERS\s+THEN\s+NULL/i.test(mig5Exec), false);

  for (const sym of [
    'is_active_cits_user',
    'admin_correct_attendance_tx',
    'enforce_instructor_request_security',
    'enforce_issue_security',
    'idx_unique_pending_checkin_exception',
    'trg_readonly_archived_attachments',
  ]) {
    assert.ok(mig5Exec.includes(sym), `Missing symbol '${sym}' in migration 0005`);
  }

  const inv5 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/verification/0005_security_inventory_and_preflight.sql'),
    'utf8'
  );
  assert.ok(inv5.includes('pg_proc'));
  assert.ok(inv5.includes('pg_policies'));
  assert.equal(/\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i.test(inv5), false);

  const test5 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/verification/0005_finalization_behavioral_test_suite.sql'),
    'utf8'
  );
  const test5NoComments = test5.replace(/--.*$/gm, '');
  assert.ok(test5.includes('BEGIN;'));
  assert.ok(test5.includes('ROLLBACK;'));
  assert.equal(/\bCOMMIT\s*;/i.test(test5NoComments), false);
  assert.equal(/WHEN\s+OTHERS\s+THEN\s+NULL/i.test(test5NoComments), false);
  for (let i = 1; i <= 30; i++) {
    assert.ok(test5.includes(`VALUES (${i},`), `Missing test #${i} in 0005 verification suite`);
  }

  // Confirm 0005 symbols registered cleanly in 0003 allowlist & entrypoint roots
  const verify3 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/verification/0003_remote_verification_and_rls_test_suite.sql'),
    'utf8'
  );
  for (const sym of [
    'public.is_active_cits_user()',
    'public.admin_correct_attendance_tx(uuid,uuid,public.attendance_mark,text)',
    'public.enforce_instructor_request_security()',
    'public.enforce_issue_security()',
  ]) {
    assert.ok(verify3.includes(sym), `Missing 0005 symbol '${sym}' in 0003 verification allowlist`);
  }

  // Confirm 0005 strict selfie path character whitelist & staging workflow safety guards
  assert.ok(mig5Exec.includes("[^0-9a-zA-Z/_.-]"));
  assert.ok(inv5.includes('duplicate_pending_checkin_exceptions_count'));

  const stagingWf = fs.readFileSync(
    path.resolve(process.cwd(), '.github/workflows/supabase-staging-verify.yml'),
    'utf8'
  );
  assert.ok(stagingWf.includes('SUPABASE_STAGING_DB_URL'));
  assert.ok(stagingWf.includes('wdmlxsgbjkboadkeekdq'));
  assert.ok(stagingWf.includes('ON_ERROR_STOP=1'));
  assert.ok(stagingWf.includes('upload-artifact'));
});









