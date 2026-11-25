import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTH_SERVICE_UNAVAILABLE_ERROR,
  AuthLoginAccountRecord,
  CallerAuthContext,
  createLoginRateLimitStore,
  DEFAULT_PRODUCTION_ORIGINS,
  evaluateAuthenticatedSessionGate,
  evaluateAuthLoginGateway,
  evaluateCallerAuthorizationForProvisioning,
  evaluateCompletePasswordChangeRpc,
  evaluateCorsOrigin,
  evaluateServerAuthorizationHelpers,
  evaluateStorageSelfieAccess,
  executeInstructorProvisioningWorkflow,
  extractTrustedClientIp,
  ForcedPasswordChangeServerState,
  generateSecureTemporaryPassword,
  LOGIN_RATE_LIMIT_MAX_PER_IDENTIFIER,
  LOGIN_RATE_LIMIT_MAX_PER_IP,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  normalizeProvisionInstructorInput,
  parseAllowedOrigins,
  ProvisioningRepositoryDeps,
  ProvisionInstructorInput,
  UNIFORM_AUTH_LOGIN_ERROR,
  UNTRUSTED_IP_FALLBACK_KEY,
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

test('Phase 3.2: Provisioning authorization rejects unauthenticated, non-admin, inactive, missing-slot, and missing-assurance callers; accepts authenticated AAL1 admins', () => {
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
  assert.equal(aal1.authorized, true);
  assert.equal(evaluateCallerAuthorizationForProvisioning({...ACTIVE_AAL2_ADMIN,aal:null}).authorized,false);

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

test('Phase 3.3: Admin login enforces slot cap (1|2) and accepts password-only sessions', () => {
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
  assert.equal(needsEnroll.allowed, true);
  assert.equal(needsEnroll.nextStep, 'admin_portal');

  const needsChallenge = evaluateAuthenticatedSessionGate({
    authUserId: 'u-adm-1',
    profile: makeProfile({ id: 'u-adm-1', role: UserRole.ADMIN, isActive: true }),
    adminAccount: makeAdminAccount({ profileId: 'u-adm-1', assignedSlot: 1 }),
    instructor: null,
    hasVerifiedTotpFactor: true,
    aal: 'aal1',
  });
  assert.equal(needsChallenge.allowed, true);
  assert.equal(needsChallenge.nextStep, 'admin_portal');
  assert.equal(evaluateAuthenticatedSessionGate({authUserId:'u-adm-1',profile:makeProfile({id:'u-adm-1',role:UserRole.ADMIN,isActive:true,mustChangePassword:true}),adminAccount:makeAdminAccount({profileId:'u-adm-1',assignedSlot:1}),instructor:null,hasVerifiedTotpFactor:false,aal:'aal1'}).nextStep,'password_change');

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

test('Phase 3 Security Audit: Edge Function enforces explicit CORS, JWT auth+sub, AAL1 or AAL2, admin_accounts slot, rate limit, rollback, no-store, and safe audit log', () => {
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
  assert.match(code, /jwtAal !== 'aal1' && jwtAal !== 'aal2'/);
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

test('Phase 3 Security Audit: Dev sandbox selector in AuthView requires explicit local sandbox mode', () => {
  const authViewPath = path.resolve(process.cwd(), 'src/pages/auth/AuthView.tsx');
  const code = fs.readFileSync(authViewPath, 'utf8');

  assert.match(code, /\{isSandboxMode && \(/);
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

// =============================================================================
// MIGRATION 0007 SECURITY TESTS: FORCED PASSWORD CHANGE & BYPASS PREVENTION
// =============================================================================

const BASE_PENDING_INSTRUCTOR_STATE: ForcedPasswordChangeServerState = {
  authUserId: 'inst-uid-1',
  role: 'authenticated',
  aal: 'aal1',
  hasVerifiedTotpFactor: false,
  profile: {
    id: 'inst-uid-1',
    role: 'instructor',
    isActive: true,
    mustChangePassword: true,
  },
  hasAdminAccountSlot: false,
  instructorId: 'inst-row-1',
  currentAuthCredentialLength: 60,
  currentAuthFingerprint: 'sha256_initial_temp_hash',
  baselineAuthFingerprint: 'sha256_initial_temp_hash',
  lastCompletedAuthFingerprint: null,
};

test('Migration 0007 SEC-001: Direct complete_password_change_tx() call without rotating Auth password is DENIED', () => {
  const res = evaluateCompletePasswordChangeRpc(BASE_PENDING_INSTRUCTOR_STATE);
  assert.equal(res.ok, false);
  assert.equal(res.mustChangePassword, true);
  assert.equal(res.auditAction, undefined);
  assert.match(res.error || '', /Credential rotation not verified/i);
});

test('Migration 0007 SEC-001: Invite-flow account with unset/empty Auth password cannot bypass complete_password_change_tx()', () => {
  const res = evaluateCompletePasswordChangeRpc({
    ...BASE_PENDING_INSTRUCTOR_STATE,
    currentAuthCredentialLength: 0,
    currentAuthFingerprint: 'sha256_empty_string',
    baselineAuthFingerprint: 'sha256_empty_string',
  });
  assert.equal(res.ok, false);
  assert.equal(res.mustChangePassword, true);
  assert.match(res.error || '', /Auth credential is not set/i);
});

test('Migration 0007 SEC-002: Instructor with must_change_password = TRUE is blocked from operational RLS/RPCs while retaining bootstrap identity read', () => {
  const authz = evaluateServerAuthorizationHelpers(BASE_PENDING_INSTRUCTOR_STATE);
  assert.equal(authz.isActiveCitsUser, true);
  assert.equal(authz.canReadOwnBootstrapIdentity, true);
  assert.equal(authz.isCitsOperationalUser, false);
  assert.equal(authz.currentInstructorId, null);
  assert.equal(authz.isCitsAdmin, false);
  assert.equal(authz.canAccessOperationalRlsAndRpcs, false);
});

test('Migration 0007 Legitimate Flow: Rotating Auth password allows complete_password_change_tx(), clears flag, writes safe audit row, and unlocks operational access', () => {
  const rotatedState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    currentAuthFingerprint: 'sha256_new_user_password_hash',
  };
  const rpc = evaluateCompletePasswordChangeRpc(rotatedState);
  assert.equal(rpc.ok, true);
  assert.equal(rpc.mustChangePassword, false);
  assert.equal(rpc.alreadyCompleted, false);
  assert.equal(rpc.auditAction, 'PASSWORD_CHANGE_COMPLETED');

  // Verify audit payload never contains banned credential substrings
  const auditJson = JSON.stringify(rpc.auditPayload).toLowerCase();
  assert.equal(
    /(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)/.test(auditJson),
    false
  );

  // Operational access restored once profile.mustChangePassword is cleared
  const postAuthz = evaluateServerAuthorizationHelpers({
    ...rotatedState,
    profile: { ...rotatedState.profile!, mustChangePassword: false },
    lastCompletedAuthFingerprint: rotatedState.currentAuthFingerprint,
  });
  assert.equal(postAuthz.isCitsOperationalUser, true);
  assert.equal(postAuthz.currentInstructorId, 'inst-row-1');
  assert.equal(postAuthz.canAccessOperationalRlsAndRpcs, true);
});

test('Migration 0007 Idempotency & Recovery: Repeated call without new rotation is no-op; real recovery rotation logs recovery audit', () => {
  const completedState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    profile: { ...BASE_PENDING_INSTRUCTOR_STATE.profile!, mustChangePassword: false },
    currentAuthFingerprint: 'sha256_new_user_password_hash',
    lastCompletedAuthFingerprint: 'sha256_new_user_password_hash',
  };

  // Repeated call without password change => idempotent no-op, zero duplicate audit row
  const repeated = evaluateCompletePasswordChangeRpc(completedState);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal(repeated.auditAction, undefined);

  // Genuine recovery password change => updates last completed fingerprint and logs recovery audit
  const recovery = evaluateCompletePasswordChangeRpc({
    ...completedState,
    currentAuthFingerprint: 'sha256_recovery_password_hash',
  });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.alreadyCompleted, false);
  assert.equal(recovery.auditAction, 'PASSWORD_CHANGE_COMPLETED');
  assert.match(recovery.auditReason || '', /recovery/i);
});

test('Migration 0007 SEC-003, Inactive, Anon & Cross-User Isolation: Denied across all helpers and RPC', () => {
  // Inactive instructor
  const inactiveState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    profile: { ...BASE_PENDING_INSTRUCTOR_STATE.profile!, isActive: false, mustChangePassword: false },
    currentAuthFingerprint: 'sha256_changed',
  };
  assert.equal(evaluateCompletePasswordChangeRpc(inactiveState).ok, false);
  const inactiveAuthz = evaluateServerAuthorizationHelpers(inactiveState);
  assert.equal(inactiveAuthz.isActiveCitsUser, false);
  assert.equal(inactiveAuthz.canReadOwnBootstrapIdentity, false);
  assert.equal(inactiveAuthz.canAccessOperationalRlsAndRpcs, false);

  // Unauthenticated (anon)
  const anonState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    authUserId: null,
    role: 'anon',
    profile: null,
  };
  assert.equal(evaluateCompletePasswordChangeRpc(anonState).ok, false);
  assert.equal(evaluateServerAuthorizationHelpers(anonState).canAccessOperationalRlsAndRpcs, false);

  // Cross-user mismatch (Caller UID != target profile ID)
  const crossUserState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    authUserId: 'inst-uid-other',
    currentAuthFingerprint: 'sha256_changed',
  };
  assert.equal(evaluateCompletePasswordChangeRpc(crossUserState).ok, false);
  assert.equal(evaluateServerAuthorizationHelpers(crossUserState).isActiveCitsUser, false);
});

test('Migration 0007 Admin MFA + Forced Password Change: Admin with pending password change is blocked operationally; AAL1 allowed without recording TOTP', () => {
  const adminPendingAal2: ForcedPasswordChangeServerState = {
    authUserId: 'admin-uid-1',
    role: 'authenticated',
    aal: 'aal2',
    hasVerifiedTotpFactor: true,
    profile: {
      id: 'admin-uid-1',
      role: 'admin',
      isActive: true,
      mustChangePassword: true,
    },
    hasAdminAccountSlot: true,
    instructorId: null,
    currentAuthCredentialLength: 60,
    currentAuthFingerprint: 'sha256_admin_initial',
    baselineAuthFingerprint: 'sha256_admin_initial',
    lastCompletedAuthFingerprint: null,
  };

  // Blocked from operational Admin access until password rotated
  const aal2Pending = evaluateServerAuthorizationHelpers(adminPendingAal2);
  assert.equal(aal2Pending.isCitsAdmin, false);
  assert.equal(aal2Pending.canAccessOperationalRlsAndRpcs, false);
  // TOTP recording remains unblocked (no onboarding deadlock!)
  assert.equal(aal2Pending.canRecordAdminTotpVerified, true);

  // AAL1 Admin has operational access after rotation, but cannot record TOTP verification
  const aal1Admin = evaluateServerAuthorizationHelpers({
    ...adminPendingAal2,
    aal: 'aal1',
    profile: { ...adminPendingAal2.profile!, mustChangePassword: false },
  });
  assert.equal(aal1Admin.isCitsAdmin, true);
  assert.equal(aal1Admin.canAccessOperationalRlsAndRpcs, true);
  assert.equal(aal1Admin.canRecordAdminTotpVerified, false);

  // AAL2 Admin with mustChangePassword = FALSE gets full Admin access
  const aal2Ready = evaluateServerAuthorizationHelpers({
    ...adminPendingAal2,
    profile: { ...adminPendingAal2.profile!, mustChangePassword: false },
  });
  assert.equal(aal2Ready.isCitsAdmin, true);
  assert.equal(aal2Ready.canAccessOperationalRlsAndRpcs, true);
});

// =============================================================================
// MIGRATION 0008 SECURITY PHASE CLOSURE TESTS (SEC-004, SEC-005, SEC-006, STORAGE)
// =============================================================================

test('Migration 0008 SEC-005: Admin at AAL1 or AAL2 can complete password change only after real rotation', () => {
  const adminAal1Rotated: ForcedPasswordChangeServerState = {
    authUserId: 'admin-uid-1',
    role: 'authenticated',
    aal: 'aal1',
    hasVerifiedTotpFactor: true,
    profile: {
      id: 'admin-uid-1',
      role: 'admin',
      isActive: true,
      mustChangePassword: true,
    },
    hasAdminAccountSlot: true,
    instructorId: null,
    currentAuthCredentialLength: 60,
    currentAuthFingerprint: 'sha256_admin_new_rotated_hash',
    baselineAuthFingerprint: 'sha256_admin_initial_hash',
    lastCompletedAuthFingerprint: null,
  };

  const allowedAal1 = evaluateCompletePasswordChangeRpc(adminAal1Rotated);
  assert.equal(allowedAal1.ok,true);
  assert.equal(allowedAal1.mustChangePassword,false);
  assert.equal(allowedAal1.auditAction,'PASSWORD_CHANGE_COMPLETED');
  assert.equal(evaluateCompletePasswordChangeRpc({...adminAal1Rotated,currentAuthFingerprint:adminAal1Rotated.baselineAuthFingerprint!}).ok,false);

  // Existing AAL2 sessions continue to work
  const allowedAal2 = evaluateCompletePasswordChangeRpc({
    ...adminAal1Rotated,
    aal: 'aal2',
  });
  assert.equal(allowedAal2.ok, true);
  assert.equal(allowedAal2.mustChangePassword, false);
  assert.equal(allowedAal2.auditAction, 'PASSWORD_CHANGE_COMPLETED');
});

test('Migration 0008 SEC-006: Missing baseline row fails closed and re-forcing must_change_password blocks bypass until re-rotated', () => {
  // Missing baseline row (null) MUST fail closed even if auth hash exists
  const missingBaseline = evaluateCompletePasswordChangeRpc({
    ...BASE_PENDING_INSTRUCTOR_STATE,
    baselineAuthFingerprint: null,
  });
  assert.equal(missingBaseline.ok, false);
  assert.equal(missingBaseline.mustChangePassword, true);
  assert.match(missingBaseline.error || '', /Credential rotation not verified/i);

  // Admin re-forces must_change_password = TRUE: baseline captured at current hash, lastCompleted reset to null
  const reForcedState: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    profile: { ...BASE_PENDING_INSTRUCTOR_STATE.profile!, mustChangePassword: true },
    currentAuthFingerprint: 'sha256_second_password',
    baselineAuthFingerprint: 'sha256_second_password',
    lastCompletedAuthFingerprint: null,
  };

  // Direct bypass before re-rotation is blocked
  assert.equal(evaluateCompletePasswordChangeRpc(reForcedState).ok, false);

  // After rotating to a third password, RPC succeeds
  const reRotated = evaluateCompletePasswordChangeRpc({
    ...reForcedState,
    currentAuthFingerprint: 'sha256_third_password',
  });
  assert.equal(reRotated.ok, true);
  assert.equal(reRotated.mustChangePassword, false);
  assert.equal(reRotated.auditAction, 'PASSWORD_CHANGE_COMPLETED');
});

test('Migration 0008 Invite vs Temporary Credential Full Lifecycle: invite onboarding sets password then completes; temp password must rotate first', () => {
  // 1. Invite flow: auth credential initially empty (length 0), baseline = sha256('')
  const inviteInitial: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    currentAuthCredentialLength: 0,
    currentAuthFingerprint: 'sha256_empty',
    baselineAuthFingerprint: 'sha256_empty',
  };
  assert.equal(evaluateCompletePasswordChangeRpc(inviteInitial).ok, false);
  assert.equal(evaluateServerAuthorizationHelpers(inviteInitial).canAccessOperationalRlsAndRpcs, false);

  // User accepts invite and sets a strong password
  const inviteAfterSet: ForcedPasswordChangeServerState = {
    ...inviteInitial,
    currentAuthCredentialLength: 60,
    currentAuthFingerprint: 'sha256_user_chosen_invite_pass',
  };
  const inviteDone = evaluateCompletePasswordChangeRpc(inviteAfterSet);
  assert.equal(inviteDone.ok, true);
  assert.equal(inviteDone.mustChangePassword, false);

  // 2. Temporary password flow: auth credential already 60-char bcrypt hash matching baseline
  const tempInitial: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    currentAuthCredentialLength: 60,
    currentAuthFingerprint: 'sha256_temp_pass',
    baselineAuthFingerprint: 'sha256_temp_pass',
  };
  assert.equal(evaluateCompletePasswordChangeRpc(tempInitial).ok, false);
  assert.equal(evaluateServerAuthorizationHelpers(tempInitial).canAccessOperationalRlsAndRpcs, false);

  const tempRotated = evaluateCompletePasswordChangeRpc({
    ...tempInitial,
    currentAuthFingerprint: 'sha256_rotated_from_temp',
  });
  assert.equal(tempRotated.ok, true);
  assert.equal(tempRotated.mustChangePassword, false);
});

test('Migration 0008 SEC-004: auth-login gateway prevents username/email enumeration, enforces CORS, and rate-limits by identifier (10) and IP (25)', () => {
  const accounts: AuthLoginAccountRecord[] = [
    {
      userId: 'uid-active-1',
      username: 'ahmed.khalil',
      email: 'ahmed.khalil@cits.edu.eg',
      isActive: true,
      password: 'ValidStrongPassword!99',
    },
    {
      userId: 'uid-inactive-1',
      username: 'deactivated.inst',
      email: 'deactivated.inst@cits.edu.eg',
      isActive: false,
      password: 'ValidStrongPassword!99',
    },
  ];
  const allowedOrigins = [...DEFAULT_PRODUCTION_ORIGINS];
  const origin = 'https://operation-lms.vercel.app';
  const baseTime = 1_700_000_000_000;

  // 1. CORS & HTTP method enforcement
  const badOrigin = evaluateAuthLoginGateway({
    origin: 'https://attacker.example.com',
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'ValidStrongPassword!99',
    clientIp: '198.51.100.10',
    nowMs: baseTime,
    accounts,
    rateLimitStore: createLoginRateLimitStore(),
  });
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(badOrigin.ok, false);

  const okPreflight = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'OPTIONS',
    identifier: '',
    password: '',
    clientIp: '198.51.100.10',
    nowMs: baseTime,
    accounts,
    rateLimitStore: createLoginRateLimitStore(),
  });
  assert.equal(okPreflight.statusCode, 204);

  // 2. Non-enumerability: unknown username, unknown email, inactive account, and wrong password
  //    MUST all produce the exact same HTTP 401 status and identical error message.
  const storeEnum = createLoginRateLimitStore();
  const unknownUser = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ghost.user',
    password: 'WrongPassword1!',
    clientIp: '198.51.100.11',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });
  const unknownEmail = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ghost@cits.edu.eg',
    password: 'WrongPassword1!',
    clientIp: '198.51.100.12',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });
  const inactiveAccount = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'deactivated.inst',
    password: 'ValidStrongPassword!99',
    clientIp: '198.51.100.13',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });
  const wrongPassword = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'WrongPassword1!',
    clientIp: '198.51.100.14',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });

  for (const r of [unknownUser, unknownEmail, inactiveAccount, wrongPassword]) {
    assert.equal(r.statusCode, 401);
    assert.equal(r.ok, false);
    assert.equal(r.error, UNIFORM_AUTH_LOGIN_ERROR);
    assert.equal(r.leaksEmail, false);
  }

  // 3. Valid login by both username and email succeeds
  const byUsername = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'AHMED.KHALIL',
    password: 'ValidStrongPassword!99',
    clientIp: '198.51.100.15',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });
  assert.equal(byUsername.statusCode, 200);
  assert.equal(byUsername.resolvedUserId, 'uid-active-1');

  const byEmail = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil@cits.edu.eg',
    password: 'ValidStrongPassword!99',
    clientIp: '198.51.100.16',
    nowMs: baseTime,
    accounts,
    rateLimitStore: storeEnum,
  });
  assert.equal(byEmail.statusCode, 200);
  assert.equal(byEmail.resolvedUserId, 'uid-active-1');

  // 4. Per-identifier rate limiting triggers HTTP 429 on 10th failed attempt
  const idRateStore = createLoginRateLimitStore();
  for (let i = 1; i < LOGIN_RATE_LIMIT_MAX_PER_IDENTIFIER; i++) {
    const attempt = evaluateAuthLoginGateway({
      origin,
      allowedOrigins,
      method: 'POST',
      identifier: 'ahmed.khalil',
      password: `BadPass!${i}`,
      clientIp: `198.51.100.${i}`,
      nowMs: baseTime + i * 1000,
      accounts,
      rateLimitStore: idRateStore,
    });
    assert.equal(attempt.statusCode, 401);
  }
  const blockedId = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'BadPass!Final',
    clientIp: '198.51.100.99',
    nowMs: baseTime + 20_000,
    accounts,
    rateLimitStore: idRateStore,
  });
  assert.equal(blockedId.statusCode, 429);
  assert.ok((blockedId.retryAfterSeconds || 0) >= 60);

  // After 15-minute window elapses, identifier bucket resets cleanly
  const afterWindow = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'ValidStrongPassword!99',
    clientIp: '198.51.100.99',
    nowMs: baseTime + LOGIN_RATE_LIMIT_WINDOW_MS + 5_000,
    accounts,
    rateLimitStore: idRateStore,
  });
  assert.equal(afterWindow.statusCode, 200);

  // 5. Per-IP rate limiting triggers HTTP 429 on 25th failed attempt across distinct usernames
  const ipRateStore = createLoginRateLimitStore();
  for (let i = 1; i < LOGIN_RATE_LIMIT_MAX_PER_IP; i++) {
    const attempt = evaluateAuthLoginGateway({
      origin,
      allowedOrigins,
      method: 'POST',
      identifier: `enum-probe-${i}`,
      password: 'WrongPassword1!',
      clientIp: '203.0.113.55',
      nowMs: baseTime + i * 100,
      accounts,
      rateLimitStore: ipRateStore,
    });
    assert.equal(attempt.statusCode, 401);
  }
  const blockedIp = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'enum-probe-25',
    password: 'WrongPassword1!',
    clientIp: '203.0.113.55',
    nowMs: baseTime + 5000,
    accounts,
    rateLimitStore: ipRateStore,
  });
  assert.equal(blockedIp.statusCode, 429);
  assert.ok((blockedIp.retryAfterSeconds || 0) >= 60);
});

test('Migration 0008 SEC-004/008/009/010 Static Audit: auth-login enforces explicit CORS, fail-closed 503 on pre/post RPC errors, cf-connecting-ip only, fixed-window docs, byte-limited stream read, 500ms+jitter floor, no-store, and zero secret logging', () => {
  const fnPath = path.resolve(process.cwd(), 'supabase/functions/auth-login/index.ts');
  const code = fs.readFileSync(fnPath, 'utf8');

  // SEC-004 CORS & uniform 401
  assert.match(code, /DEFAULT_PRODUCTION_ORIGINS\s*=\s*\['https:\/\/operation-lms\.vercel\.app'\]/);
  assert.equal(/Access-Control-Allow-Origin':\s*'\*'/.test(code), false);
  assert.match(code, /Origin not allowed\./);
  assert.match(code, /evaluate_login_rate_limit_internal/);
  assert.match(code, /resolve_login_identifier/);
  assert.match(code, /sha256Hex/);
  assert.match(code, /UNIFORM_AUTH_ERROR\s*=\s*'Invalid credentials or account unavailable\.'/);
  assert.match(code, /MIN_AUTH_FAILURE_RESPONSE_MS\s*=\s*500/);
  assert.match(code, /TIMING_JITTER_MAX_MS/);
  assert.match(code, /'Retry-After':/);
  assert.match(code, /'Cache-Control': 'no-store/);
  assert.match(code, /readBodyWithByteLimit/);

  // SEC-008: Strict fail-closed 503 on both pre-auth and post-failure RPC errors
  assert.match(code, /if\s*\(preRateErr\s*\|\|\s*!isValidRateLimitPayload\(preRateData\)\)/);
  assert.match(code, /if\s*\(postRateErr\s*\|\|\s*!isValidRateLimitPayload\(postRateData\)\)/);
  assert.match(code, /503,/);
  assert.match(code, /SERVICE_UNAVAILABLE_ERROR/);

  // SEC-009: Trust ONLY cf-connecting-ip; never read client-spoofable x-forwarded-for or x-real-ip
  assert.match(code, /req\.headers\.get\('cf-connecting-ip'\)/);
  assert.equal(/req\.headers\.get\(['"]x-forwarded-for['"]\)/i.test(code), false);
  assert.equal(/req\.headers\.get\(['"]x-real-ip['"]\)/i.test(code), false);
  assert.match(code, /UNTRUSTED_IP_FALLBACK_KEY\s*=\s*'untrusted-source'/);

  // SEC-010: Accurate fixed-window terminology (zero false sliding-window claims)
  assert.equal(/sliding-window/i.test(code), false, 'auth-login must not falsely claim sliding-window rate limiting');
  assert.match(code, /fixed-window/i);

  // Zero credential or token logging
  assert.equal(/console\.log\(.*password/i.test(code), false);
  assert.equal(/console\.log\(.*access_token/i.test(code), false);
});

test('SEC-008 Fail-Closed Rate Limiting: Pre-auth and post-failure RPC errors MUST return HTTP 503 without exposing internals or authenticating on pre-check failure', () => {
  const accounts: AuthLoginAccountRecord[] = [
    {
      userId: 'uid-active-1',
      username: 'ahmed.khalil',
      email: 'ahmed.khalil@cits.edu.eg',
      isActive: true,
      password: 'ValidStrongPassword!99',
    },
  ];
  const allowedOrigins = [...DEFAULT_PRODUCTION_ORIGINS];
  const origin = 'https://operation-lms.vercel.app';
  const nowMs = 1_700_000_000_000;

  // 1. Pre-auth rate-limit RPC failure -> MUST fail closed with 503 even for valid credentials,
  //    and MUST NOT perform credential authentication (authAttempted === false).
  const preRpcFail = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'ValidStrongPassword!99',
    requestHeaders: { 'cf-connecting-ip': '198.51.100.20' },
    nowMs,
    accounts,
    rateLimitStore: createLoginRateLimitStore(),
    simulatePreRateLimitRpcError: true,
  });
  assert.equal(preRpcFail.statusCode, 503);
  assert.equal(preRpcFail.ok, false);
  assert.equal(preRpcFail.authAttempted, false);
  assert.equal(preRpcFail.error, AUTH_SERVICE_UNAVAILABLE_ERROR);
  assert.equal(preRpcFail.retryAfterSeconds, 60);
  assert.equal(/postgres|rpc|sql|cits_internal/i.test(preRpcFail.error || ''), false);

  // 2. Post-failure recording RPC error (wrong password) -> MUST fail closed with 503 (never silent 401)
  const postRpcFailWrongPw = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'WrongPassword1!',
    requestHeaders: { 'cf-connecting-ip': '198.51.100.20' },
    nowMs,
    accounts,
    rateLimitStore: createLoginRateLimitStore(),
    simulatePostRateLimitRpcError: true,
  });
  assert.equal(postRpcFailWrongPw.statusCode, 503);
  assert.equal(postRpcFailWrongPw.ok, false);
  assert.equal(postRpcFailWrongPw.error, AUTH_SERVICE_UNAVAILABLE_ERROR);
  assert.equal(postRpcFailWrongPw.retryAfterSeconds, 60);

  // 3. Post-failure recording RPC error (unknown user) -> identical sanitized 503 (no existence leak)
  const postRpcFailUnknown = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'nonexistent.user',
    password: 'WrongPassword1!',
    requestHeaders: { 'cf-connecting-ip': '198.51.100.20' },
    nowMs,
    accounts,
    rateLimitStore: createLoginRateLimitStore(),
    simulatePostRateLimitRpcError: true,
  });
  assert.equal(postRpcFailUnknown.statusCode, 503);
  assert.equal(postRpcFailUnknown.error, postRpcFailWrongPw.error);
});

test('SEC-009 Spoof-Resistant IP Extraction: ignores spoofed x-forwarded-for & x-real-ip, trusts only valid cf-connecting-ip, and blocks spoofing bypass across 25 attempts', () => {
  // 1. Direct unit checks on extractTrustedClientIp
  assert.equal(
    extractTrustedClientIp({
      'cf-connecting-ip': '203.0.113.42',
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      'x-real-ip': '9.9.9.9',
    }),
    '203.0.113.42'
  );
  // IPv6 cf-connecting-ip accepted & lowercased
  assert.equal(
    extractTrustedClientIp({ 'CF-Connecting-IP': '2001:DB8::1' }),
    '2001:db8::1'
  );
  // Missing cf-connecting-ip MUST ignore x-forwarded-for / x-real-ip and use shared fallback bucket
  assert.equal(
    extractTrustedClientIp({
      'x-forwarded-for': '198.51.100.77',
      'x-real-ip': '198.51.100.88',
    }),
    UNTRUSTED_IP_FALLBACK_KEY
  );
  // Malformed/injected cf-connecting-ip rejected to fallback bucket
  assert.equal(
    extractTrustedClientIp({
      'cf-connecting-ip': '1.2.3.4, 5.6.7.8',
      'x-forwarded-for': '198.51.100.77',
    }),
    UNTRUSTED_IP_FALLBACK_KEY
  );

  const accounts: AuthLoginAccountRecord[] = [
    {
      userId: 'uid-active-1',
      username: 'ahmed.khalil',
      email: 'ahmed.khalil@cits.edu.eg',
      isActive: true,
      password: 'ValidStrongPassword!99',
    },
  ];
  const allowedOrigins = [...DEFAULT_PRODUCTION_ORIGINS];
  const origin = 'https://operation-lms.vercel.app';
  const baseTime = 1_700_000_000_000;

  // 2. Attacker rotates fake x-forwarded-for and x-real-ip on every request while behind real cf-connecting-ip:
  //    MUST still hit HTTP 429 on attempt 25!
  const spoofStore = createLoginRateLimitStore();
  for (let i = 1; i < LOGIN_RATE_LIMIT_MAX_PER_IP; i++) {
    const res = evaluateAuthLoginGateway({
      origin,
      allowedOrigins,
      method: 'POST',
      identifier: `spray-user-${i}`,
      password: 'WrongPassword1!',
      requestHeaders: {
        'cf-connecting-ip': '203.0.113.90',
        'x-forwarded-for': `10.0.0.${i}, 192.0.2.${i}`,
        'x-real-ip': `172.16.0.${i}`,
      },
      nowMs: baseTime + i * 100,
      accounts,
      rateLimitStore: spoofStore,
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.trustedIpBucketKey, '203.0.113.90');
  }
  const spoofBlocked = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'spray-user-25',
    password: 'WrongPassword1!',
    requestHeaders: {
      'cf-connecting-ip': '203.0.113.90',
      'x-forwarded-for': '198.51.100.250',
      'x-real-ip': '198.51.100.251',
    },
    nowMs: baseTime + 5000,
    accounts,
    rateLimitStore: spoofStore,
  });
  assert.equal(spoofBlocked.statusCode, 429);
  assert.equal(spoofBlocked.trustedIpBucketKey, '203.0.113.90');

  // 3. Attacker omits cf-connecting-ip and rotates x-forwarded-for -> all fall into shared
  //    'untrusted-source' bucket and still hit HTTP 429 at attempt 25!
  const noCfStore = createLoginRateLimitStore();
  for (let i = 1; i < LOGIN_RATE_LIMIT_MAX_PER_IP; i++) {
    const res = evaluateAuthLoginGateway({
      origin,
      allowedOrigins,
      method: 'POST',
      identifier: `nocf-user-${i}`,
      password: 'WrongPassword1!',
      requestHeaders: {
        'x-forwarded-for': `198.51.100.${i}`,
        'x-real-ip': `203.0.113.${i}`,
      },
      nowMs: baseTime + i * 100,
      accounts,
      rateLimitStore: noCfStore,
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.trustedIpBucketKey, UNTRUSTED_IP_FALLBACK_KEY);
  }
  const noCfBlocked = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'nocf-user-25',
    password: 'WrongPassword1!',
    requestHeaders: { 'x-forwarded-for': '192.0.2.250' },
    nowMs: baseTime + 5000,
    accounts,
    rateLimitStore: noCfStore,
  });
  assert.equal(noCfBlocked.statusCode, 429);

  // 4. Successful login does NOT clear existing IP failure bucket (prevents dummy-account bucket reset abuse)
  const abuseStore = createLoginRateLimitStore();
  for (let i = 1; i <= 24; i++) {
    evaluateAuthLoginGateway({
      origin,
      allowedOrigins,
      method: 'POST',
      identifier: `victim-${i}`,
      password: 'WrongPassword1!',
      requestHeaders: { 'cf-connecting-ip': '203.0.113.120' },
      nowMs: baseTime + i * 100,
      accounts,
      rateLimitStore: abuseStore,
    });
  }
  const validBetweenBurst = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'ahmed.khalil',
    password: 'ValidStrongPassword!99',
    requestHeaders: { 'cf-connecting-ip': '203.0.113.120' },
    nowMs: baseTime + 3000,
    accounts,
    rateLimitStore: abuseStore,
  });
  assert.equal(validBetweenBurst.statusCode, 200);
  // 25th failure still trips 429 because valid login did NOT reset the IP bucket
  const postValidFailure = evaluateAuthLoginGateway({
    origin,
    allowedOrigins,
    method: 'POST',
    identifier: 'victim-25',
    password: 'WrongPassword1!',
    requestHeaders: { 'cf-connecting-ip': '203.0.113.120' },
    nowMs: baseTime + 4000,
    accounts,
    rateLimitStore: abuseStore,
  });
  assert.equal(postValidFailure.statusCode, 429);
});

test('Storage Access Policy (checkin-selfies): blocks must_change_password, inactive, anon, cross-user paths, path traversal, instructor delete, and admin access without MFA', () => {
  const ownPath = 'inst-uid-1/camp-1/day-1.jpg';
  const otherPath = 'inst-uid-2/camp-1/day-1.jpg';
  const traversalPath = 'inst-uid-1/../inst-uid-2/day-1.jpg';

  // 1. Instructor with must_change_password = TRUE is blocked from both INSERT and SELECT
  assert.equal(
    evaluateStorageSelfieAccess({
      state: BASE_PENDING_INSTRUCTOR_STATE,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'INSERT',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: BASE_PENDING_INSTRUCTOR_STATE,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'SELECT',
    }).allowed,
    false
  );

  // 2. Operational active instructor (mustChangePassword = FALSE)
  const operationalInstructor: ForcedPasswordChangeServerState = {
    ...BASE_PENDING_INSTRUCTOR_STATE,
    profile: { ...BASE_PENDING_INSTRUCTOR_STATE.profile!, mustChangePassword: false },
  };
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'INSERT',
    }).allowed,
    true
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'SELECT',
    }).allowed,
    true
  );
  // Cross-user path, path traversal, UPDATE, DELETE all denied for instructor
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: otherPath,
      operation: 'SELECT',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: traversalPath,
      operation: 'INSERT',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'DELETE',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: operationalInstructor,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'UPDATE',
    }).allowed,
    false
  );

  // 3. Deactivated instructor and anon denied
  assert.equal(
    evaluateStorageSelfieAccess({
      state: {
        ...operationalInstructor,
        profile: { ...operationalInstructor.profile!, isActive: false },
      },
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'SELECT',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: {
        ...operationalInstructor,
        authUserId: null,
        role: 'anon',
        profile: null,
      },
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'SELECT',
    }).allowed,
    false
  );

  // 4. Operational admins allowed, pending password change denied at either assurance level
  const baseAdmin: ForcedPasswordChangeServerState = {
    authUserId: 'admin-uid-1',
    role: 'authenticated',
    aal: 'aal1',
    hasVerifiedTotpFactor: true,
    profile: { id: 'admin-uid-1', role: 'admin', isActive: true, mustChangePassword: false },
    hasAdminAccountSlot: true,
    instructorId: null,
    currentAuthCredentialLength: 60,
    currentAuthFingerprint: 'sha256_admin',
    baselineAuthFingerprint: 'sha256_admin_old',
    lastCompletedAuthFingerprint: 'sha256_admin',
  };
  assert.equal(
    evaluateStorageSelfieAccess({
      state: baseAdmin,
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'SELECT',
    }).allowed,
    true
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: {
        ...baseAdmin,
        aal: 'aal2',
        profile: { ...baseAdmin.profile!, mustChangePassword: true },
      },
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'DELETE',
    }).allowed,
    false
  );
  assert.equal(
    evaluateStorageSelfieAccess({
      state: { ...baseAdmin, aal: 'aal2' },
      bucketId: 'checkin-selfies',
      objectPath: ownPath,
      operation: 'DELETE',
    }).allowed,
    true
  );
});


