import { AdminAccount, CampStatus, Instructor, Profile, UserRole } from '../types/database';

export type CredentialDeliveryMode = 'invite_email' | 'temporary_password';

export interface ProvisionInstructorInput {
  fullNameEn: string;
  fullNameAr?: string;
  email: string;
  username: string;
  instructorCode: string;
  specialization: string;
  phone?: string;
  defaultLectureRateEgp: number;
  bio?: string;
  isActive: boolean;
  assignToCampId?: string | null;
  deliveryMode: CredentialDeliveryMode;
  temporaryPassword?: string;
}

export interface NormalizedProvisionInstructorInput {
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  username: string;
  instructorCode: string;
  specialization: string;
  phone: string | null;
  defaultLectureRateEgp: number;
  bio: string | null;
  isActive: boolean;
  assignToCampId: string | null;
  deliveryMode: CredentialDeliveryMode;
  temporaryPassword: string | null;
}

export interface ProvisionInstructorValidationResult {
  valid: boolean;
  normalized: NormalizedProvisionInstructorInput;
  fieldErrors: Partial<Record<keyof ProvisionInstructorInput, string>>;
  errors: string[];
}

export interface ProvisionInstructorSuccess {
  ok: true;
  profileId: string;
  instructorId: string;
  instructorCode: string;
  username: string;
  email: string;
  fullNameEn: string;
  fullNameAr: string;
  specialization: string;
  defaultLectureRateEgp: number;
  phone: string | null;
  bio: string | null;
  isActive: boolean;
  mustChangePassword: true;
  assignedCampId: string | null;
  deliveryMode: CredentialDeliveryMode;
  auditRecorded?: boolean;
  /**
   * Returned ONCE in memory when deliveryMode === 'temporary_password'.
   * Never persisted in PostgreSQL, never logged, and cleared on UI dismiss.
   */
  initialTemporaryPassword?: string;
}

export interface ProvisionInstructorFailure {
  ok: false;
  statusCode: 400 | 401 | 403 | 409 | 429 | 500;
  error: string;
  fieldErrors?: Partial<Record<keyof ProvisionInstructorInput, string>>;
  rolledBack?: boolean;
}

export type ProvisionInstructorOutcome =
  | ProvisionInstructorSuccess
  | ProvisionInstructorFailure;

export interface CallerAuthContext {
  userId: string | null;
  aal: 'aal1' | 'aal2' | null;
  profile: Pick<Profile, 'id' | 'role' | 'isActive' | 'fullNameEn'> | null;
  adminAccount: Pick<AdminAccount, 'id' | 'profileId' | 'assignedSlot'> | null;
}

const EMAIL_REGEX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const INSTRUCTOR_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const PHONE_REGEX = /^[+0-9()\-\s]{6,32}$/;

export function normalizeProvisionInstructorInput(
  raw: ProvisionInstructorInput
): NormalizedProvisionInstructorInput {
  const fullNameEn = (raw.fullNameEn || '').trim();
  const fullNameAr = (raw.fullNameAr || '').trim() || fullNameEn;
  const email = (raw.email || '').trim().toLowerCase();
  const username = (raw.username || '').trim().toLowerCase();
  const instructorCode = (raw.instructorCode || '').trim().toUpperCase();
  const specialization = (raw.specialization || '').trim();
  const phoneClean = (raw.phone || '').trim();
  const bioClean = (raw.bio || '').trim();
  const rateNum = Number(raw.defaultLectureRateEgp);
  const assignToCampId =
    raw.assignToCampId && raw.assignToCampId.trim().length > 0
      ? raw.assignToCampId.trim()
      : null;
  const deliveryMode: CredentialDeliveryMode =
    raw.deliveryMode === 'invite_email' ? 'invite_email' : 'temporary_password';
  const tempPassClean =
    deliveryMode === 'temporary_password' && raw.temporaryPassword
      ? raw.temporaryPassword.trim()
      : null;

  return {
    fullNameEn,
    fullNameAr,
    email,
    username,
    instructorCode,
    specialization,
    phone: phoneClean.length > 0 ? phoneClean : null,
    defaultLectureRateEgp: Number.isFinite(rateNum) ? Math.round(rateNum) : -1,
    bio: bioClean.length > 0 ? bioClean : null,
    isActive: Boolean(raw.isActive),
    assignToCampId,
    deliveryMode,
    temporaryPassword: tempPassClean,
  };
}

export function validateInitialPasswordStrength(password: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (trimmed.length > 128) {
    return { valid: false, error: 'Password must not exceed 128 characters.' };
  }
  if (!/[A-Z]/.test(trimmed) || !/[a-z]/.test(trimmed) || !/\d/.test(trimmed)) {
    return {
      valid: false,
      error: 'Password must include uppercase, lowercase, and at least one number.',
    };
  }
  return { valid: true };
}

/**
 * Generates a unique, cryptographically strong temporary password per instructor.
 * Uses Web Crypto API (available in browsers, Node 20+, Bun, and Deno Edge Runtime).
 */
export function generateSecureTemporaryPassword(length = 16): string {
  const safeLength = Math.max(12, Math.min(32, Math.floor(length)));
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = upper + lower + digits + symbols;

  const randomIndex = (max: number): number => {
    const arr = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / max) * max;
    let val = 0;
    do {
      crypto.getRandomValues(arr);
      val = arr[0];
    } while (val >= limit);
    return val % max;
  };

  const chars: string[] = [
    upper[randomIndex(upper.length)],
    lower[randomIndex(lower.length)],
    digits[randomIndex(digits.length)],
    symbols[randomIndex(symbols.length)],
  ];

  while (chars.length < safeLength) {
    chars.push(all[randomIndex(all.length)]);
  }

  // Fisher-Yates shuffle with CSPRNG
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

export function validateProvisionInstructorInput(
  raw: ProvisionInstructorInput,
  existing?: {
    emails?: string[];
    usernames?: string[];
    instructorCodes?: string[];
  }
): ProvisionInstructorValidationResult {
  const normalized = normalizeProvisionInstructorInput(raw);
  const fieldErrors: Partial<Record<keyof ProvisionInstructorInput, string>> = {};
  const errors: string[] = [];

  const addErr = (field: keyof ProvisionInstructorInput, msg: string) => {
    if (!fieldErrors[field]) fieldErrors[field] = msg;
    errors.push(msg);
  };

  if (normalized.fullNameEn.length < 2 || normalized.fullNameEn.length > 120) {
    addErr('fullNameEn', 'Full name (English) must be between 2 and 120 characters.');
  }

  if (normalized.fullNameAr.length < 2 || normalized.fullNameAr.length > 120) {
    addErr('fullNameAr', 'Full name (Arabic) must be between 2 and 120 characters.');
  }

  if (!normalized.email || normalized.email.length > 120 || !EMAIL_REGEX.test(normalized.email)) {
    addErr('email', 'Enter a valid email address.');
  }

  if (!USERNAME_REGEX.test(normalized.username)) {
    addErr(
      'username',
      'Username must be 3–64 lowercase characters (letters, numbers, ".", "_", or "-").'
    );
  }

  if (!INSTRUCTOR_CODE_REGEX.test(normalized.instructorCode)) {
    addErr(
      'instructorCode',
      'Instructor code must be 2–32 characters (uppercase letters, numbers, "-" or "_").'
    );
  }

  if (normalized.specialization.length < 2 || normalized.specialization.length > 160) {
    addErr('specialization', 'Specialization must be between 2 and 160 characters.');
  }

  if (normalized.phone && !PHONE_REGEX.test(normalized.phone)) {
    addErr('phone', 'Phone number contains invalid characters or invalid length.');
  }

  if (
    !Number.isFinite(normalized.defaultLectureRateEgp) ||
    normalized.defaultLectureRateEgp < 0 ||
    normalized.defaultLectureRateEgp > 100000
  ) {
    addErr('defaultLectureRateEgp', 'Default lecture rate must be between 0 and 100,000 EGP.');
  }

  if (normalized.bio && normalized.bio.length > 1000) {
    addErr('bio', 'Bio must not exceed 1,000 characters.');
  }

  if (normalized.deliveryMode === 'temporary_password' && normalized.temporaryPassword) {
    const pwCheck = validateInitialPasswordStrength(normalized.temporaryPassword);
    if (!pwCheck.valid && pwCheck.error) {
      addErr('temporaryPassword', pwCheck.error);
    }
  }

  if (existing) {
    const emailSet = new Set((existing.emails || []).map((e) => e.trim().toLowerCase()));
    const usernameSet = new Set((existing.usernames || []).map((u) => u.trim().toLowerCase()));
    const codeSet = new Set((existing.instructorCodes || []).map((c) => c.trim().toUpperCase()));

    if (normalized.email && emailSet.has(normalized.email)) {
      addErr('email', `Email "${normalized.email}" is already registered.`);
    }
    if (normalized.username && usernameSet.has(normalized.username)) {
      addErr('username', `Username "${normalized.username}" is already taken.`);
    }
    if (normalized.instructorCode && codeSet.has(normalized.instructorCode)) {
      addErr('instructorCode', `Instructor code "${normalized.instructorCode}" already exists.`);
    }
  }

  return {
    valid: errors.length === 0,
    normalized,
    fieldErrors,
    errors,
  };
}

export function evaluateCallerAuthorizationForProvisioning(caller: CallerAuthContext): {
  authorized: boolean;
  statusCode?: 401 | 403;
  error?: string;
} {
  if (!caller.userId) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Authentication required to provision instructor accounts.',
    };
  }

  if (!caller.profile || !caller.profile.isActive) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Caller account is missing or deactivated.',
    };
  }

  if (caller.profile.role !== UserRole.ADMIN) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Only authorized CITS Administrators can provision instructors.',
    };
  }

  if (
    !caller.adminAccount ||
    caller.adminAccount.profileId !== caller.profile.id ||
    (caller.adminAccount.assignedSlot !== 1 && caller.adminAccount.assignedSlot !== 2)
  ) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Caller lacks a verified admin_accounts slot assignment.',
    };
  }

  if (caller.aal !== 'aal2') {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Admin MFA (AAL2) verification is required before provisioning accounts.',
    };
  }

  return { authorized: true };
}

export interface ProvisioningRepositoryDeps {
  findDuplicateEmail: (email: string) => Promise<boolean>;
  findDuplicateUsername: (username: string) => Promise<boolean>;
  findDuplicateInstructorCode: (code: string) => Promise<boolean>;
  findCampStatus?: (campId: string) => Promise<CampStatus | null>;
  createAuthUser: (params: {
    email: string;
    deliveryMode: CredentialDeliveryMode;
    password?: string;
    username: string;
  }) => Promise<{ userId: string }>;
  deleteAuthUser: (userId: string) => Promise<void>;
  insertProfile: (row: {
    id: string;
    role: 'instructor';
    username: string;
    email: string;
    full_name_en: string;
    full_name_ar: string;
    phone: string | null;
    must_change_password: true;
    is_active: boolean;
  }) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  insertInstructor: (row: {
    profile_id: string;
    instructor_code: string;
    specialization: string;
    default_lecture_rate_egp: number;
    bio: string | null;
  }) => Promise<{ id: string }>;
  deleteInstructor: (instructorId: string) => Promise<void>;
  assignInstructorToCamp?: (campId: string, instructorId: string) => Promise<void>;
  removeInstructorFromCamp?: (campId: string, instructorId: string) => Promise<void>;
  appendAuditLog: (entry: {
    actor_profile_id: string;
    actor_name: string;
    actor_role: 'admin';
    camp_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    previous_value: null;
    new_value: Record<string, unknown>;
    reason: string;
  }) => Promise<void>;
}

/**
 * End-to-end server-side provisioning orchestrator with compensating rollback.
 * Guarantees no orphaned Auth user or partial profile/instructor rows remain on error.
 */
export async function executeInstructorProvisioningWorkflow(
  deps: ProvisioningRepositoryDeps,
  caller: CallerAuthContext,
  rawInput: ProvisionInstructorInput
): Promise<ProvisionInstructorOutcome> {
  const authCheck = evaluateCallerAuthorizationForProvisioning(caller);
  if (!authCheck.authorized) {
    return {
      ok: false,
      statusCode: authCheck.statusCode || 403,
      error: authCheck.error || 'Unauthorized.',
    };
  }

  const validation = validateProvisionInstructorInput(rawInput);
  if (!validation.valid) {
    return {
      ok: false,
      statusCode: 400,
      error: validation.errors[0] || 'Invalid instructor provisioning payload.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const input = validation.normalized;

  const [emailExists, usernameExists, codeExists] = await Promise.all([
    deps.findDuplicateEmail(input.email),
    deps.findDuplicateUsername(input.username),
    deps.findDuplicateInstructorCode(input.instructorCode),
  ]);

  if (emailExists) {
    return {
      ok: false,
      statusCode: 409,
      error: `Email "${input.email}" is already registered.`,
      fieldErrors: { email: `Email "${input.email}" is already registered.` },
    };
  }
  if (usernameExists) {
    return {
      ok: false,
      statusCode: 409,
      error: `Username "${input.username}" is already taken.`,
      fieldErrors: { username: `Username "${input.username}" is already taken.` },
    };
  }
  if (codeExists) {
    return {
      ok: false,
      statusCode: 409,
      error: `Instructor code "${input.instructorCode}" already exists.`,
      fieldErrors: {
        instructorCode: `Instructor code "${input.instructorCode}" already exists.`,
      },
    };
  }

  if (input.assignToCampId && deps.findCampStatus) {
    const campStatus = await deps.findCampStatus(input.assignToCampId);
    if (!campStatus) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Selected camp does not exist.',
        fieldErrors: { assignToCampId: 'Selected camp does not exist.' },
      };
    }
    if (campStatus === CampStatus.ARCHIVED) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Cannot assign a newly provisioned instructor to an archived read-only camp.',
        fieldErrors: { assignToCampId: 'Archived camps are strictly read-only.' },
      };
    }
  }

  const initialPassword =
    input.deliveryMode === 'temporary_password'
      ? input.temporaryPassword || generateSecureTemporaryPassword(16)
      : undefined;

  let createdAuthUserId: string | null = null;
  let profileCreated = false;
  let createdInstructorId: string | null = null;
  let campAssigned = false;

  const rollback = async (): Promise<boolean> => {
    let ok = true;
    if (campAssigned && input.assignToCampId && createdInstructorId && deps.removeInstructorFromCamp) {
      try {
        await deps.removeInstructorFromCamp(input.assignToCampId, createdInstructorId);
      } catch {
        ok = false;
      }
    }
    if (createdInstructorId) {
      try {
        await deps.deleteInstructor(createdInstructorId);
      } catch {
        ok = false;
      }
    }
    if (profileCreated && createdAuthUserId) {
      try {
        await deps.deleteProfile(createdAuthUserId);
      } catch {
        ok = false;
      }
    }
    if (createdAuthUserId) {
      try {
        await deps.deleteAuthUser(createdAuthUserId);
      } catch {
        ok = false;
      }
    }
    return ok;
  };

  try {
    const authRes = await deps.createAuthUser({
      email: input.email,
      deliveryMode: input.deliveryMode,
      password: initialPassword,
      username: input.username,
    });
    createdAuthUserId = authRes.userId;

    await deps.insertProfile({
      id: createdAuthUserId,
      role: 'instructor',
      username: input.username,
      email: input.email,
      full_name_en: input.fullNameEn,
      full_name_ar: input.fullNameAr,
      phone: input.phone,
      must_change_password: true,
      is_active: input.isActive,
    });
    profileCreated = true;

    const instRes = await deps.insertInstructor({
      profile_id: createdAuthUserId,
      instructor_code: input.instructorCode,
      specialization: input.specialization,
      default_lecture_rate_egp: input.defaultLectureRateEgp,
      bio: input.bio,
    });
    createdInstructorId = instRes.id;

    if (input.assignToCampId && deps.assignInstructorToCamp) {
      await deps.assignInstructorToCamp(input.assignToCampId, createdInstructorId);
      campAssigned = true;
    }

    // Best-effort safe audit log: never include credential words or secrets
    let auditRecorded = false;
    try {
      await deps.appendAuditLog({
        actor_profile_id: caller.profile!.id,
        actor_name: caller.profile!.fullNameEn,
        actor_role: 'admin',
        camp_id: input.assignToCampId,
        action: 'INSTRUCTOR_ACCOUNT_PROVISIONED',
        entity_type: 'instructors',
        entity_id: createdInstructorId,
        previous_value: null,
        new_value: {
          profile_id: createdAuthUserId,
          instructor_code: input.instructorCode,
          username: input.username,
          email: input.email,
          default_lecture_rate_egp: input.defaultLectureRateEgp,
          is_active: input.isActive,
          onboarding_mode:
            input.deliveryMode === 'invite_email' ? 'invite_email' : 'one_time_temp_credential',
          onboarding_rotation_required: true,
          assigned_camp_id: input.assignToCampId,
        },
        reason: 'Admin provisioned instructor account via server-side Edge Function',
      });
      auditRecorded = true;
    } catch {
      // Do not rollback a valid account solely because secondary audit log write failed
      auditRecorded = false;
    }

    return {
      ok: true,
      profileId: createdAuthUserId,
      instructorId: createdInstructorId,
      instructorCode: input.instructorCode,
      username: input.username,
      email: input.email,
      fullNameEn: input.fullNameEn,
      fullNameAr: input.fullNameAr,
      specialization: input.specialization,
      defaultLectureRateEgp: input.defaultLectureRateEgp,
      phone: input.phone,
      bio: input.bio,
      isActive: input.isActive,
      mustChangePassword: true,
      assignedCampId: input.assignToCampId,
      deliveryMode: input.deliveryMode,
      auditRecorded,
      ...(input.deliveryMode === 'temporary_password' && initialPassword
        ? { initialTemporaryPassword: initialPassword }
        : {}),
    };
  } catch (err) {
    const rolledBack = createdAuthUserId ? await rollback() : true;
    const rawMsg = err instanceof Error ? err.message : 'Instructor provisioning failed.';
    const isConflict =
      /already registered|already exists|duplicate key|23505/i.test(rawMsg);
    return {
      ok: false,
      statusCode: isConflict ? 409 : 500,
      error: isConflict
        ? 'An account with this email, username, or instructor code already exists.'
        : 'Unable to complete instructor provisioning. Any partial records were rolled back.',
      rolledBack,
    };
  }
}

/**
 * Pure authentication gate evaluator mirroring citsRepository.loadAuthenticatedUserContext
 * and AppRouter route guards so auth lifecycle scenarios are deterministically unit-testable.
 */
export interface AuthSessionDecision {
  allowed: boolean;
  nextStep: 'admin_portal' | 'instructor_portal' | 'totp_enroll' | 'totp_challenge' | 'password_change' | 'sign_out_denied';
  error?: string;
}

export function evaluateAuthenticatedSessionGate(params: {
  authUserId: string | null;
  profile: Profile | null;
  adminAccount: AdminAccount | null;
  instructor: Instructor | null;
  hasVerifiedTotpFactor: boolean;
  aal: 'aal1' | 'aal2' | null;
  recoveryFlow?: boolean;
}): AuthSessionDecision {
  if (!params.authUserId) {
    return { allowed: false, nextStep: 'sign_out_denied', error: 'No authenticated session.' };
  }

  if (!params.profile) {
    return {
      allowed: false,
      nextStep: 'sign_out_denied',
      error: 'Authenticated Auth user has no provisioned CITS profile. Contact an Admin.',
    };
  }

  if (params.profile.id !== params.authUserId) {
    return {
      allowed: false,
      nextStep: 'sign_out_denied',
      error: 'Profile UUID mismatch with Auth session.',
    };
  }

  if (!params.profile.isActive) {
    return {
      allowed: false,
      nextStep: 'sign_out_denied',
      error: 'Your CITS account is deactivated. Contact Operations.',
    };
  }

  if (params.profile.role === UserRole.ADMIN) {
    if (
      !params.adminAccount ||
      params.adminAccount.profileId !== params.profile.id ||
      (params.adminAccount.assignedSlot !== 1 && params.adminAccount.assignedSlot !== 2)
    ) {
      return {
        allowed: false,
        nextStep: 'sign_out_denied',
        error: 'Admin role verification failed: no valid entry in admin_accounts.',
      };
    }

    if (!params.hasVerifiedTotpFactor) {
      return { allowed: false, nextStep: 'totp_enroll' };
    }
    if (params.aal !== 'aal2') {
      return { allowed: false, nextStep: 'totp_challenge' };
    }
    if (params.profile.mustChangePassword || params.recoveryFlow) {
      return { allowed: false, nextStep: 'password_change' };
    }
    return { allowed: true, nextStep: 'admin_portal' };
  }

  if (params.profile.role === UserRole.INSTRUCTOR) {
    if (!params.instructor || params.instructor.profileId !== params.profile.id) {
      return {
        allowed: false,
        nextStep: 'sign_out_denied',
        error: 'Instructor account verification failed: missing instructor record.',
      };
    }
    if (params.profile.mustChangePassword || params.recoveryFlow) {
      return { allowed: false, nextStep: 'password_change' };
    }
    return { allowed: true, nextStep: 'instructor_portal' };
  }

  return {
    allowed: false,
    nextStep: 'sign_out_denied',
    error: 'Invalid account role.',
  };
}

// =============================================================================
// EXPLICIT CORS ALLOWLIST & SAFE REDIRECT VALIDATION (Mirrors Edge Function)
// =============================================================================

export const DEFAULT_PRODUCTION_ORIGINS = ['https://operation-lms.vercel.app'] as const;

export function parseAllowedOrigins(rawEnv?: string | null): string[] {
  const raw = (rawEnv || '').trim();
  if (!raw) {
    return [...DEFAULT_PRODUCTION_ORIGINS];
  }

  const parsed: string[] = [];
  for (const part of raw.split(',')) {
    const candidate = part.trim().replace(/\/+$/, '');
    if (!candidate || candidate === '*') continue;
    try {
      const url = new URL(candidate);
      const isHttps = url.protocol === 'https:';
      const isExplicitLocalDev =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (isHttps || isExplicitLocalDev) {
        if (!parsed.includes(url.origin)) {
          parsed.push(url.origin);
        }
      }
    } catch {
      // Skip malformed entries
    }
  }

  return parsed.length > 0 ? parsed : [...DEFAULT_PRODUCTION_ORIGINS];
}

export function evaluateCorsOrigin(
  originHeader: string | null | undefined,
  allowedOrigins: string[],
  method: string
): {
  allowed: boolean;
  statusCode: 200 | 204 | 403;
  allowOriginHeader: string | null;
} {
  const normalized = originHeader ? originHeader.trim().replace(/\/+$/, '') : null;

  if (method.toUpperCase() === 'OPTIONS') {
    if (!normalized || !allowedOrigins.includes(normalized)) {
      return { allowed: false, statusCode: 403, allowOriginHeader: null };
    }
    return { allowed: true, statusCode: 204, allowOriginHeader: normalized };
  }

  if (!normalized) {
    // Server-to-server call without Origin header: allowed, never emits wildcard ACAO
    return { allowed: true, statusCode: 200, allowOriginHeader: null };
  }

  if (!allowedOrigins.includes(normalized)) {
    return { allowed: false, statusCode: 403, allowOriginHeader: null };
  }

  return { allowed: true, statusCode: 200, allowOriginHeader: normalized };
}

export function validateSafeRedirectUrl(
  redirectTo: string | null | undefined,
  allowedOrigins: string[]
): { valid: boolean; sanitizedOrigin?: string; error?: string } {
  const trimmed = (redirectTo || '').trim();
  if (!trimmed) {
    return { valid: true, sanitizedOrigin: allowedOrigins[0] || DEFAULT_PRODUCTION_ORIGINS[0] };
  }

  try {
    const parsed = new URL(trimmed);
    const isHttpOrHttps = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    if (!isHttpOrHttps || !allowedOrigins.includes(parsed.origin)) {
      return {
        valid: false,
        error: 'Redirect URL must belong to an authorized application origin.',
      };
    }
    return { valid: true, sanitizedOrigin: parsed.origin };
  } catch {
    return {
      valid: false,
      error: 'Redirect URL is malformed.',
    };
  }
}

// =============================================================================
// SERVER-SIDE FORCED PASSWORD CHANGE & OPERATIONAL ACCESS MODEL (Migration 0007)
// =============================================================================

export interface ForcedPasswordChangeServerState {
  authUserId: string | null;
  role: 'anon' | 'authenticated';
  aal: 'aal1' | 'aal2' | null;
  hasVerifiedTotpFactor: boolean;
  profile: {
    id: string;
    role: 'admin' | 'instructor';
    isActive: boolean;
    mustChangePassword: boolean;
  } | null;
  hasAdminAccountSlot: boolean;
  instructorId: string | null;
  /** Current auth.users.encrypted_password length/fingerprint (never raw password) */
  currentAuthCredentialLength: number;
  currentAuthFingerprint: string;
  baselineAuthFingerprint: string | null;
  lastCompletedAuthFingerprint: string | null;
}

export interface CompletePasswordChangeRpcResult {
  ok: boolean;
  mustChangePassword: boolean;
  alreadyCompleted?: boolean;
  auditAction?: 'PASSWORD_CHANGE_COMPLETED';
  auditReason?: string;
  auditPayload?: {
    previousValue: { initial_credential_rotation_required: boolean };
    newValue: { initial_credential_rotation_required: boolean };
  };
  error?: string;
}

/**
 * Mirrors Migration 0007 server-side complete_password_change_tx() verification.
 * Rejects direct RPC bypasses when auth.users.encrypted_password has not rotated.
 */
export function evaluateCompletePasswordChangeRpc(
  state: ForcedPasswordChangeServerState
): CompletePasswordChangeRpcResult {
  if (state.role !== 'authenticated' || !state.authUserId || !state.profile) {
    return {
      ok: false,
      mustChangePassword: state.profile?.mustChangePassword ?? true,
      error: 'CITS Authorization Denied: Active authenticated account required.',
    };
  }

  if (state.profile.id !== state.authUserId || !state.profile.isActive) {
    return {
      ok: false,
      mustChangePassword: state.profile.mustChangePassword,
      error: 'CITS Authorization Denied: Active authenticated account required.',
    };
  }

  // SEC-005 (Migration 0008): Admins must complete TOTP MFA (AAL2) before clearing must_change_password
  if (state.profile.role === 'admin' && state.aal !== 'aal2') {
    return {
      ok: false,
      mustChangePassword: state.profile.mustChangePassword,
      error:
        'CITS Security Violation: Admin MFA (AAL2) verification is required before completing credential rotation.',
    };
  }

  if (state.currentAuthCredentialLength < 20) {
    return {
      ok: false,
      mustChangePassword: state.profile.mustChangePassword,
      error:
        'CITS Security Violation: Auth credential is not set. Update your password in Auth before completing onboarding.',
    };
  }

  if (state.profile.mustChangePassword) {
    if (
      !state.baselineAuthFingerprint ||
      state.currentAuthFingerprint === state.baselineAuthFingerprint
    ) {
      return {
        ok: false,
        mustChangePassword: true,
        error:
          'CITS Security Violation: Credential rotation not verified in Auth. Update your password before completing mandatory onboarding.',
      };
    }

    return {
      ok: true,
      mustChangePassword: false,
      alreadyCompleted: false,
      auditAction: 'PASSWORD_CHANGE_COMPLETED',
      auditReason: 'User completed mandatory initial credential rotation verified against Auth state',
      auditPayload: {
        previousValue: { initial_credential_rotation_required: true },
        newValue: { initial_credential_rotation_required: false },
      },
    };
  }

  // must_change_password is already FALSE: check if a real recovery rotation occurred
  if (state.lastCompletedAuthFingerprint !== state.currentAuthFingerprint) {
    return {
      ok: true,
      mustChangePassword: false,
      alreadyCompleted: false,
      auditAction: 'PASSWORD_CHANGE_COMPLETED',
      auditReason: 'User completed account credential recovery rotation verified against Auth state',
      auditPayload: {
        previousValue: { initial_credential_rotation_required: false },
        newValue: { initial_credential_rotation_required: false },
      },
    };
  }

  return {
    ok: true,
    mustChangePassword: false,
    alreadyCompleted: true,
  };
}

/**
 * Mirrors Migration 0007 + 0008 server-side RLS / RPC authorization helpers:
 * - is_active_cits_user(): onboarding bootstrap identity only
 * - is_cits_operational_user(): active AND must_change_password = FALSE
 * - current_instructor_id(): active instructor AND must_change_password = FALSE
 * - is_cits_admin(): active admin + slot + AAL2 AND must_change_password = FALSE
 * - record_admin_totp_verified_tx(): active admin + slot + AAL2 + verified TOTP (no onboarding deadlock)
 */
export function evaluateServerAuthorizationHelpers(state: ForcedPasswordChangeServerState): {
  isActiveCitsUser: boolean;
  isCitsOperationalUser: boolean;
  currentInstructorId: string | null;
  isCitsAdmin: boolean;
  canReadOwnBootstrapIdentity: boolean;
  canAccessOperationalRlsAndRpcs: boolean;
  canRecordAdminTotpVerified: boolean;
} {
  const validSession =
    state.role === 'authenticated' &&
    Boolean(state.authUserId) &&
    Boolean(state.profile) &&
    state.profile!.id === state.authUserId;

  const isActiveCitsUser = validSession && Boolean(state.profile?.isActive);
  const isCitsOperationalUser = isActiveCitsUser && !state.profile!.mustChangePassword;

  const currentInstructorId =
    isCitsOperationalUser && state.profile!.role === 'instructor' && state.instructorId
      ? state.instructorId
      : null;

  const isCitsAdmin =
    isCitsOperationalUser &&
    state.profile!.role === 'admin' &&
    state.hasAdminAccountSlot &&
    state.aal === 'aal2';

  const canRecordAdminTotpVerified =
    isActiveCitsUser &&
    state.profile!.role === 'admin' &&
    state.hasAdminAccountSlot &&
    state.aal === 'aal2' &&
    state.hasVerifiedTotpFactor;

  return {
    isActiveCitsUser,
    isCitsOperationalUser,
    currentInstructorId,
    isCitsAdmin,
    canReadOwnBootstrapIdentity: isActiveCitsUser,
    canAccessOperationalRlsAndRpcs: Boolean(currentInstructorId || isCitsAdmin),
    canRecordAdminTotpVerified,
  };
}

// =============================================================================
// SEC-004 NON-ENUMERABLE AUTH-LOGIN GATEWAY & RATE-LIMIT MODEL (Migration 0008)
// =============================================================================

export const UNIFORM_AUTH_LOGIN_ERROR = 'Invalid credentials or account unavailable.';
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_PER_IDENTIFIER = 10;
export const LOGIN_RATE_LIMIT_MAX_PER_IP = 25;

export interface LoginRateLimitBucket {
  windowStartedAtMs: number;
  attemptCount: number;
}

export interface LoginRateLimitStore {
  byIdentifier: Map<string, LoginRateLimitBucket>;
  byIp: Map<string, LoginRateLimitBucket>;
}

export function createLoginRateLimitStore(): LoginRateLimitStore {
  return {
    byIdentifier: new Map(),
    byIp: new Map(),
  };
}

export function evaluateLoginRateLimitState(
  store: LoginRateLimitStore,
  params: {
    ipKey: string;
    identifierKey: string;
    nowMs: number;
    increment: boolean;
  }
): {
  allowed: boolean;
  retryAfterSeconds: number;
  ipAttempts: number;
  identifierAttempts: number;
} {
  const readBucket = (map: Map<string, LoginRateLimitBucket>, key: string) => {
    const existing = map.get(key);
    if (!existing || params.nowMs - existing.windowStartedAtMs >= LOGIN_RATE_LIMIT_WINDOW_MS) {
      return { windowStartedAtMs: params.nowMs, attemptCount: 0 };
    }
    return existing;
  };

  let ipBucket = readBucket(store.byIp, params.ipKey);
  let idBucket = readBucket(store.byIdentifier, params.identifierKey);

  if (params.increment) {
    ipBucket = {
      windowStartedAtMs: ipBucket.attemptCount === 0 ? params.nowMs : ipBucket.windowStartedAtMs,
      attemptCount: ipBucket.attemptCount + 1,
    };
    idBucket = {
      windowStartedAtMs: idBucket.attemptCount === 0 ? params.nowMs : idBucket.windowStartedAtMs,
      attemptCount: idBucket.attemptCount + 1,
    };
    store.byIp.set(params.ipKey, ipBucket);
    store.byIdentifier.set(params.identifierKey, idBucket);
  }

  const ipBlocked = ipBucket.attemptCount >= LOGIN_RATE_LIMIT_MAX_PER_IP;
  const idBlocked = idBucket.attemptCount >= LOGIN_RATE_LIMIT_MAX_PER_IDENTIFIER;

  if (ipBlocked || idBlocked) {
    const ipRem = ipBlocked
      ? Math.max(
          1,
          Math.ceil(
            (ipBucket.windowStartedAtMs + LOGIN_RATE_LIMIT_WINDOW_MS - params.nowMs) / 1000
          )
        )
      : 0;
    const idRem = idBlocked
      ? Math.max(
          1,
          Math.ceil(
            (idBucket.windowStartedAtMs + LOGIN_RATE_LIMIT_WINDOW_MS - params.nowMs) / 1000
          )
        )
      : 0;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(60, ipRem, idRem),
      ipAttempts: ipBucket.attemptCount,
      identifierAttempts: idBucket.attemptCount,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    ipAttempts: ipBucket.attemptCount,
    identifierAttempts: idBucket.attemptCount,
  };
}

export interface AuthLoginAccountRecord {
  userId: string;
  username: string;
  email: string;
  isActive: boolean;
  password: string;
}

export function evaluateAuthLoginGateway(params: {
  origin: string | null;
  allowedOrigins: string[];
  method: string;
  identifier: string;
  password: string;
  clientIp: string;
  nowMs: number;
  accounts: AuthLoginAccountRecord[];
  rateLimitStore: LoginRateLimitStore;
}): {
  statusCode: 200 | 204 | 400 | 401 | 403 | 405 | 429;
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
  resolvedUserId?: string;
  leaksEmail?: boolean;
} {
  const cors = evaluateCorsOrigin(params.origin, params.allowedOrigins, params.method);
  if (!cors.allowed) {
    return { statusCode: 403, ok: false, error: 'Origin not allowed.' };
  }
  if (params.method.toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, ok: true };
  }
  if (params.method.toUpperCase() !== 'POST') {
    return { statusCode: 405, ok: false, error: 'Method not allowed.' };
  }

  const cleanId = params.identifier.trim().toLowerCase();
  if (!cleanId || cleanId.length > 120 || !params.password || params.password.length > 256) {
    return { statusCode: 400, ok: false, error: 'Username/email and password are required.' };
  }

  const preCheck = evaluateLoginRateLimitState(params.rateLimitStore, {
    ipKey: params.clientIp,
    identifierKey: cleanId,
    nowMs: params.nowMs,
    increment: false,
  });
  if (!preCheck.allowed) {
    return {
      statusCode: 429,
      ok: false,
      error: 'Too many sign-in attempts. Please wait before trying again.',
      retryAfterSeconds: preCheck.retryAfterSeconds,
    };
  }

  const matched = params.accounts.find(
    (a) =>
      a.isActive &&
      (a.username.toLowerCase() === cleanId || a.email.toLowerCase() === cleanId)
  );

  if (!matched || matched.password !== params.password) {
    const postCheck = evaluateLoginRateLimitState(params.rateLimitStore, {
      ipKey: params.clientIp,
      identifierKey: cleanId,
      nowMs: params.nowMs,
      increment: true,
    });
    if (!postCheck.allowed) {
      return {
        statusCode: 429,
        ok: false,
        error: 'Too many sign-in attempts. Please wait before trying again.',
        retryAfterSeconds: postCheck.retryAfterSeconds,
      };
    }
    return {
      statusCode: 401,
      ok: false,
      error: UNIFORM_AUTH_LOGIN_ERROR,
      leaksEmail: false,
    };
  }

  return {
    statusCode: 200,
    ok: true,
    resolvedUserId: matched.userId,
    leaksEmail: false,
  };
}

// =============================================================================
// STORAGE ACCESS POLICY MODEL (storage.objects checkin-selfies — 0002/0005/0007)
// =============================================================================

export function evaluateStorageSelfieAccess(params: {
  state: ForcedPasswordChangeServerState;
  bucketId: string;
  objectPath: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}): { allowed: boolean; reason: string } {
  if (params.bucketId !== 'checkin-selfies') {
    return { allowed: false, reason: 'Unauthorized storage bucket.' };
  }

  const authz = evaluateServerAuthorizationHelpers(params.state);

  // Operational AAL2 Admins have full access to checkin-selfies
  if (authz.isCitsAdmin) {
    return { allowed: true, reason: 'Operational AAL2 Admin access permitted.' };
  }

  // Operational Instructors may only INSERT/SELECT under their own auth.uid() prefix
  if (!authz.currentInstructorId || !params.state.authUserId) {
    return {
      allowed: false,
      reason:
        'Denied: Caller must be an operational active user with completed credential rotation (or AAL2 Admin).',
    };
  }

  if (params.operation === 'UPDATE' || params.operation === 'DELETE') {
    return {
      allowed: false,
      reason: 'Denied: Instructors cannot update or delete check-in selfies.',
    };
  }

  const firstSegment = params.objectPath.split('/')[0] || '';
  if (
    firstSegment !== params.state.authUserId ||
    params.objectPath.includes('..') ||
    /[^0-9a-zA-Z/_.-]/.test(params.objectPath)
  ) {
    return {
      allowed: false,
      reason: 'Denied: Instructors may only access valid selfie paths within their own UID folder.',
    };
  }

  return { allowed: true, reason: 'Operational Instructor own-folder access permitted.' };
}


