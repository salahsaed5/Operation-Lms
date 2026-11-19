import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CallerAuthContext,
  DEFAULT_PRODUCTION_ORIGINS,
  evaluateAuthenticatedSessionGate,
  evaluateCallerAuthorizationForProvisioning,
  evaluateCorsOrigin,
  executeInstructorProvisioningWorkflow,
  generateSecureTemporaryPassword,
  normalizeProvisionInstructorInput,
  parseAllowedOrigins,
  ProvisioningRepositoryDeps,
  ProvisionInstructorInput,
  validateInitialPasswordStrength,
  validateProvisionInstructorInput,
  validateSafeRedirectUrl,
} from './accountProvisioning';
import { AdminAccount, CampStatus, Instructor, Profile, UserRole } from '../types/database';

const BASE_VALID_INPUT: ProvisionInstructorInput = {
  fullNameEn: 'Eng. Youssef Nabil',
  fullNameAr: 'م. يوسف نبيل',
  email: 'Youssef.Nabil@cits.edu.eg',
  username: 'Youssef.Nabil',
  instructorCode: 'inst-05',
  phone: '+20 100 555 1234',
  specialization: 'Algorithms & Dynamic Programming',
  defaultLectureRateEgp: 750,
  bio: 'ICPC regionalist and CITS camp mentor.',
  isActive: true,
  assignToCampId: 'camp-1',
  deliveryMode: 'invite_email',
};

const ACTIVE_AAL2_ADMIN: CallerAuthContext = {
  userId: 'prof-adm-1',
  aal: 'aal2',
  profile: {
    id: 'prof-adm-1',
    role: UserRole.ADMIN,
    isActive: true,
    fullNameEn: 'Eng. Tarek Mansour',
  },
  adminAccount: {
    id: 'adm-1',
    profileId: 'prof-adm-1',
    assignedSlot: 1,
  },
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u-1',
    role: UserRole.INSTRUCTOR,
    username: 'youssef.nabil',
    email: 'youssef.nabil@cits.edu.eg',
    fullNameEn: 'Eng. Youssef Nabil',
    fullNameAr: 'م. يوسف نبيل',
    phone: '+20 100 000 0000',
    mustChangePassword: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeInstructor(overrides: Partial<Instructor> = {}): Instructor {
  return {
    id: 'inst-5',
    profileId: 'u-1',
    instructorCode: 'INST-05',
    username: 'youssef.nabil',
    email: 'youssef.nabil@cits.edu.eg',
    fullNameEn: 'Eng. Youssef Nabil',
    fullNameAr: 'م. يوسف نبيل',
    phone: '+20 100 000 0000',
    specialization: 'Algorithms',
    defaultLectureRateEgp: 750,
    isActive: true,
    ...overrides,
  };
}

function makeAdminAccount(overrides: Partial<AdminAccount> = {}): AdminAccount {
  return {
    id: 'adm-1',
    profileId: 'u-adm-1',
    totpEnrolled: true,
    totpVerifiedAt: '2026-01-01T00:00:00Z',
    assignedSlot: 1,
    ...overrides,
  };
}

function createMockRepo(overrides: Partial<ProvisioningRepositoryDeps> = {}) {
  const calls: string[] = [];
  const state = {
    emails: new Set<string>(['ahmed.khalil@cits.edu.eg']),
    usernames: new Set<string>(['ahmed.khalil']),
    codes: new Set<string>(['INST-01']),
    camps: new Map<string, CampStatus>([
      ['camp-1', CampStatus.ACTIVE],
      ['camp-archived', CampStatus.ARCHIVED],
    ]),
    authUsers: new Map<string, { email: string; deliveryMode: string }>(),
    profiles: new Map<string, Record<string, unknown>>(),
    instructors: new Map<string, Record<string, unknown>>(),
    campAssignments: new Set<string>(),
    auditLogs: [] as Record<string, unknown>[],
  };

  let seq = 1;

  const repo: ProvisioningRepositoryDeps = {
    findDuplicateEmail: async (email) => state.emails.has(email.toLowerCase()),
    findDuplicateUsername: async (username) => state.usernames.has(username.toLowerCase()),
    findDuplicateInstructorCode: async (code) => state.codes.has(code.toUpperCase()),
    findCampStatus: async (campId) => state.camps.get(campId) || null,
    createAuthUser: async ({ email, deliveryMode }) => {
      calls.push(`createAuthUser:${deliveryMode}`);
      const userId = `auth-uuid-${seq++}`;
      state.authUsers.set(userId, { email, deliveryMode });
      return { userId };
    },
    deleteAuthUser: async (userId) => {
      calls.push(`deleteAuthUser:${userId}`);
      state.authUsers.delete(userId);
    },
    insertProfile: async (row) => {
      calls.push(`insertProfile:${row.id}`);
      state.profiles.set(row.id, { ...row });
      state.emails.add(row.email.toLowerCase());
      state.usernames.add(row.username.toLowerCase());
    },
    deleteProfile: async (profileId) => {
      calls.push(`deleteProfile:${profileId}`);
      state.profiles.delete(profileId);
    },
    insertInstructor: async (row) => {
      calls.push(`insertInstructor:${row.profile_id}`);
      const id = `inst-uuid-${seq++}`;
      state.instructors.set(id, { id, ...row });
      state.codes.add(row.instructor_code.toUpperCase());
      return { id };
    },
    deleteInstructor: async (instructorId) => {
      calls.push(`deleteInstructor:${instructorId}`);
      state.instructors.delete(instructorId);
    },
    assignInstructorToCamp: async (campId, instructorId) => {
      calls.push(`assignInstructorToCamp:${campId}:${instructorId}`);
      state.campAssignments.add(`${campId}:${instructorId}`);
    },
    removeInstructorFromCamp: async (campId, instructorId) => {
      calls.push(`removeInstructorFromCamp:${campId}:${instructorId}`);
      state.campAssignments.delete(`${campId}:${instructorId}`);
    },
    appendAuditLog: async (entry) => {
      calls.push(`appendAuditLog:${entry.action}`);
      state.auditLogs.push(entry as unknown as Record<string, unknown>);
    },
    ...overrides,
  };

  return { repo, state, calls };
}

// ============================================================================
// 1. VALIDATION & PASSWORD STRENGTH UNIT TESTS
// ============================================================================

test('Phase 3.1: normalizeProvisionInstructorInput canonicalizes email, username, and instructor code', () => {
  const normalized = normalizeProvisionInstructorInput({
    ...BASE_VALID_INPUT,
    fullNameAr: '',
    email: '  YOUSSEF.NABIL@CITS.EDU.EG ',
    username: '  Youssef.Nabil  ',
    instructorCode: ' inst-05 ',
  });

  assert.equal(normalized.email, 'youssef.nabil@cits.edu.eg');
  assert.equal(normalized.username, 'youssef.nabil');
  assert.equal(normalized.instructorCode, 'INST-05');
  assert.equal(normalized.fullNameAr, 'Eng. Youssef Nabil');
  assert.equal(normalized.defaultLectureRateEgp, 750);
});

test('Phase 3.1: validateProvisionInstructorInput accepts valid input and rejects missing/malformed fields', () => {
  const ok = validateProvisionInstructorInput(BASE_VALID_INPUT);
  assert.equal(ok.valid, true);
  assert.equal(ok.errors.length, 0);

  const bad = validateProvisionInstructorInput({
    fullNameEn: 'A',
    email: 'not-an-email',
    username: 'a',
    instructorCode: '!!',
    specialization: '',
    defaultLectureRateEgp: -50,
    isActive: true,
    deliveryMode: 'temporary_password',
    temporaryPassword: 'weak',
  });

  assert.equal(bad.valid, false);
  assert.ok(bad.fieldErrors.fullNameEn);
  assert.ok(bad.fieldErrors.email);
  assert.ok(bad.fieldErrors.username);
  assert.ok(bad.fieldErrors.instructorCode);
  assert.ok(bad.fieldErrors.specialization);
  assert.ok(bad.fieldErrors.defaultLectureRateEgp);
  assert.ok(bad.fieldErrors.temporaryPassword);
});

test('Phase 3.1: validateProvisionInstructorInput rejects duplicate email, username, and instructorCode case-insensitively', () => {
  const result = validateProvisionInstructorInput(
    {
      ...BASE_VALID_INPUT,
      email: 'AHMED.KHALIL@cits.edu.eg',
      username: 'AHMED.KHALIL',
      instructorCode: 'inst-01',
    },
    {
      emails: ['ahmed.khalil@cits.edu.eg'],
      usernames: ['ahmed.khalil'],
      instructorCodes: ['INST-01'],
    }
  );

  assert.equal(result.valid, false);
  assert.match(result.fieldErrors.email || '', /already registered/i);
  assert.match(result.fieldErrors.username || '', /already taken/i);
  assert.match(result.fieldErrors.instructorCode || '', /already exists/i);
});

test('Phase 3.1: generateSecureTemporaryPassword meets strict strength rules and produces unique CSPRNG values', () => {
  const pw1 = generateSecureTemporaryPassword();
  const pw2 = generateSecureTemporaryPassword();

  assert.notEqual(pw1, pw2);
  assert.ok(pw1.length >= 16);
  assert.equal(validateInitialPasswordStrength(pw1).valid, true);
  assert.equal(validateInitialPasswordStrength('short1A').valid, false);
  assert.equal(validateInitialPasswordStrength('alllowercase123!').valid, false);
  assert.equal(validateInitialPasswordStrength('NoDigitsHere!Abc').valid, false);
});

// ============================================================================
// 2. CALLER AUTHORIZATION TESTS (ADMIN, ACTIVE, SLOT 1|2, AAL2 MFA)
// ============================================================================

test('Phase 3.2: Provisioning authorization rejects unauthenticated, non-admin, inactive, missing-slot, and AAL1 callers', () => {
  assert.equal(
    evaluateCallerAuthorizationForProvisioning({
      userId: null,
      aal: null,
      profile: null,
      adminAccount: null,
    }).statusCode,
    401
  );

  assert.equal(
    evaluateCallerAuthorizationForProvisioning({
      ...ACTIVE_AAL2_ADMIN,
      profile: { id: 'prof-inst-1', role: UserRole.INSTRUCTOR, isActive: true, fullNameEn: 'Inst' },
      adminAccount: null,
    }).statusCode,
    403
  );

  assert.equal(
    evaluateCallerAuthorizationForProvisioning({
      ...ACTIVE_AAL2_ADMIN,
      profile: { ...ACTIVE_AAL2_ADMIN.profile!, isActive: false },
    }).statusCode,
    403
  );

  assert.equal(
    evaluateCallerAuthorizationForProvisioning({
      ...ACTIVE_AAL2_ADMIN,
      adminAccount: null,
    }).statusCode,
    403
  );

  const aal1 = evaluateCallerAuthorizationForProvisioning({
    ...ACTIVE_AAL2_ADMIN,
    aal: 'aal1',
  });
  assert.equal(aal1.authorized, false);
  assert.equal(aal1.statusCode, 403);
  assert.match(aal1.error || '', /AAL2|MFA/i);

  assert.equal(evaluateCallerAuthorizationForProvisioning(ACTIVE_AAL2_ADMIN).authorized, true);
});

// ============================================================================
// 3. SERVER-SIDE PROVISIONING ORCHESTRATOR & ROLLBACK TESTS
// ============================================================================

test('Phase 3.2: Provisioning succeeds in invite_email mode with matching Auth/Profile UUID, must_change_password=true, and safe audit log', async () => {
  const { repo, state } = createMockRepo();
  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.deliveryMode, 'invite_email');
  assert.equal(outcome.initialTemporaryPassword, undefined);
  assert.equal(outcome.mustChangePassword, true);
  assert.equal(outcome.assignedCampId, 'camp-1');

  // Auth UUID === Profile UUID
  assert.ok(state.authUsers.has(outcome.profileId));
  const storedProfile = state.profiles.get(outcome.profileId);
  assert.ok(storedProfile);
  assert.equal(storedProfile.id, outcome.profileId);
  assert.equal(storedProfile.role, 'instructor');
  assert.equal(storedProfile.must_change_password, true);

  // Instructor row linked to profileId
  const storedInstructor = state.instructors.get(outcome.instructorId);
  assert.ok(storedInstructor);
  assert.equal(storedInstructor.profile_id, outcome.profileId);
  assert.equal(state.campAssignments.has(`camp-1:${outcome.instructorId}`), true);

  // Audit log integrity check: must NEVER contain banned credential keywords (migration 0005 regex)
  assert.equal(state.auditLogs.length, 1);
  const serializedAudit = JSON.stringify(state.auditLogs[0]).toLowerCase();
  assert.equal(
    /(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)/.test(
      serializedAudit
    ),
    false,
    'Audit log entry must never include banned credential substrings'
  );
});

test('Phase 3.2: Provisioning succeeds in temporary_password mode returning one-time password without leaking it into persisted rows or audit logs', async () => {
  const { repo, state } = createMockRepo();
  const outcome = await executeInstructorProvisioningWorkflow(repo, ACTIVE_AAL2_ADMIN, {
    ...BASE_VALID_INPUT,
    deliveryMode: 'temporary_password',
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.deliveryMode, 'temporary_password');
  assert.ok(outcome.initialTemporaryPassword && outcome.initialTemporaryPassword.length >= 16);
  assert.equal(validateInitialPasswordStrength(outcome.initialTemporaryPassword).valid, true);

  // Ensure the generated password is never persisted in profiles, instructors, or audit logs
  const persistedDump = JSON.stringify({
    profiles: Array.from(state.profiles.values()),
    instructors: Array.from(state.instructors.values()),
    auditLogs: state.auditLogs,
  });
  assert.equal(persistedDump.includes(outcome.initialTemporaryPassword), false);

  // Audit log integrity check: temporary_password mode must also NEVER trip migration 0005 regex
  assert.equal(state.auditLogs.length, 1);
  const serializedAudit = JSON.stringify(state.auditLogs[0]).toLowerCase();
  assert.equal(
    /(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)/.test(
      serializedAudit
    ),
    false,
    'temporary_password audit log entry must never include banned credential substrings'
  );
});

test('Phase 3.2: Provisioning rejects duplicate email/username/code and archived camp before creating Auth user', async () => {
  const { repo, state } = createMockRepo();

  const dupEmail = await executeInstructorProvisioningWorkflow(repo, ACTIVE_AAL2_ADMIN, {
    ...BASE_VALID_INPUT,
    email: 'ahmed.khalil@cits.edu.eg',
  });
  assert.equal(dupEmail.ok, false);
  if (!dupEmail.ok) assert.equal(dupEmail.statusCode, 409);
  assert.equal(state.authUsers.size, 0);

  const dupUsername = await executeInstructorProvisioningWorkflow(repo, ACTIVE_AAL2_ADMIN, {
    ...BASE_VALID_INPUT,
    username: 'ahmed.khalil',
  });
  assert.equal(dupUsername.ok, false);
  if (!dupUsername.ok) assert.equal(dupUsername.statusCode, 409);
  assert.equal(state.authUsers.size, 0);

  const dupCode = await executeInstructorProvisioningWorkflow(repo, ACTIVE_AAL2_ADMIN, {
    ...BASE_VALID_INPUT,
    instructorCode: 'INST-01',
  });
  assert.equal(dupCode.ok, false);
  if (!dupCode.ok) assert.equal(dupCode.statusCode, 409);
  assert.equal(state.authUsers.size, 0);

  const archivedCamp = await executeInstructorProvisioningWorkflow(repo, ACTIVE_AAL2_ADMIN, {
    ...BASE_VALID_INPUT,
    assignToCampId: 'camp-archived',
  });
  assert.equal(archivedCamp.ok, false);
  if (!archivedCamp.ok) assert.equal(archivedCamp.statusCode, 400);
  assert.equal(state.authUsers.size, 0);
});

test('Phase 3.2: Compensating rollback deletes Auth user if profile creation fails (no orphan Auth account)', async () => {
  const { repo, state, calls } = createMockRepo({
    insertProfile: async () => {
      throw new Error('simulated profile insert failure');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.statusCode, 500);
    assert.equal(outcome.rolledBack, true);
  }
  assert.equal(state.authUsers.size, 0);
  assert.equal(state.profiles.size, 0);
  assert.equal(state.instructors.size, 0);
  assert.ok(calls.some((c) => c.startsWith('deleteAuthUser:')));
});

test('Phase 3.2: Compensating rollback deletes Profile and Auth user if instructor insert fails', async () => {
  const { repo, state, calls } = createMockRepo({
    insertInstructor: async () => {
      throw new Error('simulated instructor constraint failure');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.rolledBack, true);
  }
  assert.equal(state.authUsers.size, 0);
  assert.equal(state.profiles.size, 0);
  assert.equal(state.instructors.size, 0);
  assert.ok(calls.some((c) => c.startsWith('deleteProfile:')));
  assert.ok(calls.some((c) => c.startsWith('deleteAuthUser:')));
});

test('Phase 3.2: Compensating rollback deletes Instructor, Profile, and Auth user if camp assignment fails', async () => {
  const { repo, state, calls } = createMockRepo({
    assignInstructorToCamp: async () => {
      throw new Error('simulated camp_instructors failure');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.rolledBack, true);
  }
  assert.equal(state.authUsers.size, 0);
  assert.equal(state.profiles.size, 0);
  assert.equal(state.instructors.size, 0);
  assert.equal(state.campAssignments.size, 0);
  assert.ok(calls.some((c) => c.startsWith('deleteInstructor:')));
  assert.ok(calls.some((c) => c.startsWith('deleteProfile:')));
  assert.ok(calls.some((c) => c.startsWith('deleteAuthUser:')));
});

test('Phase 3.2: Auth creation failure stops immediately with zero DB writes', async () => {
  const { repo, state } = createMockRepo({
    createAuthUser: async () => {
      throw new Error('SMTP rate limit exceeded');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.statusCode, 500);
  }
  assert.equal(state.profiles.size, 0);
  assert.equal(state.instructors.size, 0);
});

test('Phase 3.2: Audit log write failure does not roll back a validly provisioned account and reports auditRecorded=false', async () => {
  const { repo, state } = createMockRepo({
    appendAuditLog: async () => {
      throw new Error('simulated audit_logs transient error');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.auditRecorded, false);
  assert.equal(state.authUsers.size, 1);
  assert.equal(state.profiles.size, 1);
  assert.equal(state.instructors.size, 1);
});

test('Phase 3.2: Rollback failure reports rolledBack=false accurately when Auth cleanup fails', async () => {
  const { repo } = createMockRepo({
    insertProfile: async () => {
      throw new Error('simulated profile failure');
    },
    deleteAuthUser: async () => {
      throw new Error('simulated auth cleanup failure');
    },
  });

  const outcome = await executeInstructorProvisioningWorkflow(
    repo,
    ACTIVE_AAL2_ADMIN,
    BASE_VALID_INPUT
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.statusCode, 500);
    assert.equal(outcome.rolledBack, false);
  }
});

test('Phase 3.2: Explicit CORS allowlist & redirect validation reject wildcards, arbitrary origins, and open redirects', () => {
  // Default production allowlist contains ONLY https://operation-lms.vercel.app (no wildcard, no localhost)
  const defaultOrigins = parseAllowedOrigins('');
  assert.deepEqual(defaultOrigins, ['https://operation-lms.vercel.app']);
  assert.equal(DEFAULT_PRODUCTION_ORIGINS[0], 'https://operation-lms.vercel.app');

  // Wildcards and malformed entries are stripped; valid explicit origins preserved
  const parsed = parseAllowedOrigins(
    '*, https://operation-lms.vercel.app/, https://staging.operation-lms.vercel.app, not-a-url, http://evil.com'
  );
  assert.deepEqual(parsed, [
    'https://operation-lms.vercel.app',
    'https://staging.operation-lms.vercel.app',
  ]);

  // Explicit localhost dev origin allowed only when explicitly configured
  const withDev = parseAllowedOrigins('https://operation-lms.vercel.app, http://localhost:3000');
  assert.deepEqual(withDev, ['https://operation-lms.vercel.app', 'http://localhost:3000']);

  // Authorized OPTIONS & POST
  const okPreflight = evaluateCorsOrigin('https://operation-lms.vercel.app', defaultOrigins, 'OPTIONS');
  assert.equal(okPreflight.allowed, true);
  assert.equal(okPreflight.statusCode, 204);
  assert.equal(okPreflight.allowOriginHeader, 'https://operation-lms.vercel.app');

  const okPost = evaluateCorsOrigin('https://operation-lms.vercel.app', defaultOrigins, 'POST');
  assert.equal(okPost.allowed, true);
  assert.equal(okPost.allowOriginHeader, 'https://operation-lms.vercel.app');

  // Unauthorized origins explicitly rejected with 403 and ZERO ACAO reflection
  const badPreflight = evaluateCorsOrigin('https://evil.example.com', defaultOrigins, 'OPTIONS');
  assert.equal(badPreflight.allowed, false);
  assert.equal(badPreflight.statusCode, 403);
  assert.equal(badPreflight.allowOriginHeader, null);

  const badPost = evaluateCorsOrigin('https://evil.example.com', defaultOrigins, 'POST');
  assert.equal(badPost.allowed, false);
  assert.equal(badPost.statusCode, 403);
  assert.equal(badPost.allowOriginHeader, null);

  // Missing Origin on OPTIONS rejected; missing Origin on server-side POST emits no wildcard ACAO
  assert.equal(evaluateCorsOrigin(null, defaultOrigins, 'OPTIONS').statusCode, 403);
  const noOriginPost = evaluateCorsOrigin(null, defaultOrigins, 'POST');
  assert.equal(noOriginPost.allowed, true);
  assert.equal(noOriginPost.allowOriginHeader, null);

  // Redirect URL validation blocks open redirects and non-HTTP schemes
  assert.equal(
    validateSafeRedirectUrl('https://operation-lms.vercel.app/login', defaultOrigins).valid,
    true
  );
  assert.equal(
    validateSafeRedirectUrl('https://operation-lms.vercel.app/login', defaultOrigins).sanitizedOrigin,
    'https://operation-lms.vercel.app'
  );
  assert.equal(validateSafeRedirectUrl('https://evil.example.com', defaultOrigins).valid, false);
  assert.equal(validateSafeRedirectUrl('http://operation-lms.vercel.app', defaultOrigins).valid, false);
  assert.equal(validateSafeRedirectUrl('javascript:alert(1)', defaultOrigins).valid, false);
  assert.equal(validateSafeRedirectUrl('http://localhost:3000', defaultOrigins).valid, false);
});

// ============================================================================
// 4. AUTHENTICATION, ACCOUNT STATUS, FIRST-LOGIN ROTATION & ADMIN MFA GATE TESTS
// ============================================================================

test('Phase 3.3: Authenticated session gate enforces missing profile, UUID mismatch, inactive lockout, and linked role records', () => {
  const noProfile = evaluateAuthenticatedSessionGate({
    authUserId: 'u-1',
    profile: null,
    adminAccount: null,
    instructor: null,
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(noProfile.allowed, false);
  assert.equal(noProfile.nextStep, 'sign_out_denied');

  const uuidMismatch = evaluateAuthenticatedSessionGate({
    authUserId: 'u-1',
    profile: makeProfile({ id: 'u-2' }),
    adminAccount: null,
    instructor: makeInstructor({ profileId: 'u-2' }),
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(uuidMismatch.allowed, false);
  assert.equal(uuidMismatch.nextStep, 'sign_out_denied');

  const inactive = evaluateAuthenticatedSessionGate({
    authUserId: 'u-1',
    profile: makeProfile({ id: 'u-1', isActive: false }),
    adminAccount: null,
    instructor: makeInstructor({ profileId: 'u-1', isActive: false }),
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(inactive.allowed, false);
  assert.equal(inactive.nextStep, 'sign_out_denied');
  assert.match(inactive.error || '', /deactivated/i);

  const missingInstructorRow = evaluateAuthenticatedSessionGate({
    authUserId: 'u-1',
    profile: makeProfile({ id: 'u-1', role: UserRole.INSTRUCTOR }),
    adminAccount: null,
    instructor: null,
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(missingInstructorRow.allowed, false);
  assert.equal(missingInstructorRow.nextStep, 'sign_out_denied');
});

test('Phase 3.3: Instructor must complete mandatory password change before dashboard access', () => {
  const firstLogin = evaluateAuthenticatedSessionGate({
    authUserId: 'u-inst-5',
    profile: makeProfile({
      id: 'u-inst-5',
      role: UserRole.INSTRUCTOR,
      isActive: true,
      mustChangePassword: true,
    }),
    adminAccount: null,
    instructor: makeInstructor({ profileId: 'u-inst-5' }),
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(firstLogin.allowed, false);
  assert.equal(firstLogin.nextStep, 'password_change');

  const afterPasswordChange = evaluateAuthenticatedSessionGate({
    authUserId: 'u-inst-5',
    profile: makeProfile({
      id: 'u-inst-5',
      role: UserRole.INSTRUCTOR,
      isActive: true,
      mustChangePassword: false,
    }),
    adminAccount: null,
    instructor: makeInstructor({ profileId: 'u-inst-5' }),
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(afterPasswordChange.allowed, true);
  assert.equal(afterPasswordChange.nextStep, 'instructor_portal');

  // Password recovery link forces password_change even when mustChangePassword was false
  const recoverySession = evaluateAuthenticatedSessionGate({
    authUserId: 'u-inst-5',
    profile: makeProfile({
      id: 'u-inst-5',
      role: UserRole.INSTRUCTOR,
      isActive: true,
      mustChangePassword: false,
    }),
    adminAccount: null,
    instructor: makeInstructor({ profileId: 'u-inst-5' }),
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
    recoveryFlow: true,
  });
  assert.equal(recoverySession.allowed, false);
  assert.equal(recoverySession.nextStep, 'password_change');
});

test('Phase 3.3: Admin login enforces slot cap (1|2), TOTP enrollment, AAL2 challenge, and denies invalid slot', () => {
  const noSlot = evaluateAuthenticatedSessionGate({
    authUserId: 'u-adm-3',
    profile: makeProfile({ id: 'u-adm-3', role: UserRole.ADMIN, isActive: true }),
    adminAccount: null,
    instructor: null,
    hasVerifiedTotpFactor: true,
    aal: 'aal2',
  });
  assert.equal(noSlot.allowed, false);
  assert.equal(noSlot.nextStep, 'sign_out_denied');

  const needsEnroll = evaluateAuthenticatedSessionGate({
    authUserId: 'u-adm-1',
    profile: makeProfile({ id: 'u-adm-1', role: UserRole.ADMIN, isActive: true }),
    adminAccount: makeAdminAccount({ profileId: 'u-adm-1', assignedSlot: 1 }),
    instructor: null,
    hasVerifiedTotpFactor: false,
    aal: 'aal1',
  });
  assert.equal(needsEnroll.allowed, false);
  assert.equal(needsEnroll.nextStep, 'totp_enroll');

  const needsChallenge = evaluateAuthenticatedSessionGate({
    authUserId: 'u-adm-1',
    profile: makeProfile({ id: 'u-adm-1', role: UserRole.ADMIN, isActive: true }),
    adminAccount: makeAdminAccount({ profileId: 'u-adm-1', assignedSlot: 1 }),
    instructor: null,
    hasVerifiedTotpFactor: true,
    aal: 'aal1',
  });
  assert.equal(needsChallenge.allowed, false);
  assert.equal(needsChallenge.nextStep, 'totp_challenge');

  const verifiedAal2 = evaluateAuthenticatedSessionGate({
    authUserId: 'u-adm-1',
    profile: makeProfile({ id: 'u-adm-1', role: UserRole.ADMIN, isActive: true }),
    adminAccount: makeAdminAccount({ profileId: 'u-adm-1', assignedSlot: 2 }),
    instructor: null,
    hasVerifiedTotpFactor: true,
    aal: 'aal2',
  });
  assert.equal(verifiedAal2.allowed, true);
  assert.equal(verifiedAal2.nextStep, 'admin_portal');
});

// ============================================================================
// 5. STATIC SECURITY & PRODUCTION SEPARATION AUDITS
// ============================================================================

test('Phase 3 Security Audit: Frontend src/ never references SUPABASE_SERVICE_ROLE_KEY or sb_secret_ keys', () => {
  const srcRoot = path.resolve(process.cwd(), 'src');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  for (const filePath of walk(srcRoot)) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      content.includes('SUPABASE_SERVICE_ROLE_KEY'),
      false,
      `Frontend file ${filePath} must never reference SUPABASE_SERVICE_ROLE_KEY`
    );
    assert.equal(
      content.includes('VITE_SUPABASE_SERVICE_ROLE'),
      false,
      `Frontend file ${filePath} must never reference VITE_SUPABASE_SERVICE_ROLE`
    );
  }
});

test('Phase 3 Security Audit: Edge Function enforces explicit CORS, JWT auth+sub, AAL2, admin_accounts slot, rate limit, rollback, no-store, and safe audit log', () => {
  const fnPath = path.resolve(process.cwd(), 'supabase/functions/provision-instructor/index.ts');
  const code = fs.readFileSync(fnPath, 'utf8');

  assert.match(code, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(code, /DEFAULT_PRODUCTION_ORIGINS\s*=\s*\['https:\/\/operation-lms\.vercel\.app'\]/);
  assert.equal(/allowOrigin\s*=\s*'\*'/.test(code), false, 'Edge Function must never default to wildcard CORS');
  assert.equal(
    /Access-Control-Allow-Origin':\s*'\*'/.test(code),
    false,
    'Edge Function must never emit wildcard Access-Control-Allow-Origin'
  );
  assert.match(code, /Origin not allowed\./);
  assert.match(code, /userClient\.auth\.getUser\(token\)/);
  assert.match(code, /jwtSub !== callerUser\.id/);
  assert.match(code, /jwtAal !== 'aal2'/);
  assert.match(code, /from\('admin_accounts'\)/);
  assert.match(code, /RATE_LIMIT_MAX_PROVISIONS/);
  assert.match(code, /429/);
  assert.match(code, /must_change_password:\s*true/);
  assert.match(code, /auth\.admin\.deleteUser\(createdAuthUserId\)/);
  assert.match(code, /'Cache-Control': 'no-store/);
  assert.match(code, /onboarding_mode:/);
  assert.equal(
    /delivery_mode:\s*deliveryMode/.test(code),
    false,
    'Edge Function audit_logs payload must not write raw delivery_mode containing "temporary_password"'
  );
  assert.equal(
    /console\.log\(.*temporaryPassword/i.test(code),
    false,
    'Edge Function must never log temporary passwords'
  );
});

test('Phase 3 Security Audit: AppContext handles PASSWORD_RECOVERY, guards USER_UPDATED race, and wipes operational state on sign-out', () => {
  const ctxPath = path.resolve(process.cwd(), 'src/context/AppContext.tsx');
  const code = fs.readFileSync(ctxPath, 'utf8');

  assert.match(code, /event === 'PASSWORD_RECOVERY'/);
  assert.match(code, /passwordUpdateInFlightRef/);
  assert.match(code, /clearSupabaseOperationalState/);
  assert.equal(
    /\{\s*mustChangePassword:\s*true\s*\}/.test(code),
    false,
    'Sandbox audit log must not contain banned "password" key substring'
  );
});

test('Phase 3 Security Audit: Dev sandbox selector in AuthView is strictly gated by import.meta.env.DEV && !isSupabaseMode', () => {
  const authViewPath = path.resolve(process.cwd(), 'src/pages/auth/AuthView.tsx');
  const code = fs.readFileSync(authViewPath, 'utf8');

  assert.match(code, /\{import\.meta\.env\.DEV && !isSupabaseMode && \(/);
});

test('Phase 3 Security Audit: bootstrap_cits_admin_account remains revoked from PUBLIC, anon, and authenticated', () => {
  const mig0002 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/0002_phase2_security_rls_and_validation.sql'),
    'utf8'
  );
  assert.match(
    mig0002,
    /REVOKE ALL ON FUNCTION bootstrap_cits_admin_account\(UUID, TEXT, TEXT, TEXT, SMALLINT\) FROM PUBLIC;/
  );
  assert.match(
    mig0002,
    /REVOKE ALL ON FUNCTION bootstrap_cits_admin_account\(UUID, TEXT, TEXT, TEXT, SMALLINT\) FROM anon;/
  );
  assert.match(
    mig0002,
    /REVOKE ALL ON FUNCTION bootstrap_cits_admin_account\(UUID, TEXT, TEXT, TEXT, SMALLINT\) FROM authenticated;/
  );
});
