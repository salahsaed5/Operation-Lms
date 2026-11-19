// =============================================================================
// Supabase Edge Function: provision-instructor
// Phase 3.2 — Secure Server-Side Instructor Account Provisioning
//
// Security Model:
// - Uses SUPABASE_SERVICE_ROLE_KEY strictly server-side from Edge Function secrets.
// - Never trusts client claims: verifies caller JWT via auth.getUser(token),
//   requires verified Admin MFA assurance (JWT aal === 'aal2'), active Admin
//   profile (profiles.role = 'admin' AND is_active = true), and a valid slot
//   assignment in public.admin_accounts (assigned_slot IN (1, 2)).
// - Enforces schema validation, uniqueness checks, mandatory first-login
//   password rotation (must_change_password = true), safe audit logging, and
//   compensating rollback to prevent orphaned Auth users or partial DB rows.
// - Never logs or persists plaintext passwords, JWTs, or service keys.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

type CredentialDeliveryMode = 'invite_email' | 'temporary_password';

interface ProvisionRequestBody {
  fullNameEn?: string;
  fullNameAr?: string;
  email?: string;
  username?: string;
  instructorCode?: string;
  specialization?: string;
  phone?: string;
  defaultLectureRateEgp?: number;
  bio?: string;
  isActive?: boolean;
  assignToCampId?: string | null;
  deliveryMode?: CredentialDeliveryMode;
  temporaryPassword?: string;
  redirectTo?: string;
}

const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const INSTRUCTOR_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const PHONE_REGEX = /^[+0-9()\-\s]{6,32}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedRaw = (Deno.env.get('ALLOWED_ORIGINS') || '').trim();
  const reqOrigin = req.headers.get('Origin') || '';
  let allowOrigin = '*';

  if (allowedRaw) {
    const allowedList = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    allowOrigin = allowedList.includes(reqOrigin) ? reqOrigin : allowedList[0] || '*';
  } else if (reqOrigin) {
    allowOrigin = reqOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(
  req: Request,
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const decoded = atob(base64 + pad);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function generateSecureTemporaryPassword(length = 16): string {
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

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

function validateInitialPasswordStrength(password: string): string | null {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return 'Temporary password must be at least 8 characters long.';
  }
  if (trimmed.length > 128) {
    return 'Temporary password must not exceed 128 characters.';
  }
  if (!/[A-Z]/.test(trimmed) || !/[a-z]/.test(trimmed) || !/\d/.test(trimmed)) {
    return 'Temporary password must include uppercase, lowercase, and at least one number.';
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, 405, { ok: false, error: 'Method not allowed.' });
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const supabaseAnonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  const supabaseServiceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('[provision-instructor] Missing required Supabase server environment variables.');
    return jsonResponse(req, 500, {
      ok: false,
      error: 'Provisioning service is not configured on the server.',
    });
  }

  // 1. Authenticate caller from Bearer JWT
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(req, 401, {
      ok: false,
      error: 'Authentication required to provision instructor accounts.',
    });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return jsonResponse(req, 401, {
      ok: false,
      error: 'Authentication token is missing.',
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user: callerUser },
    error: callerErr,
  } = await userClient.auth.getUser(token);

  if (callerErr || !callerUser) {
    return jsonResponse(req, 401, {
      ok: false,
      error: 'Invalid or expired authentication session.',
    });
  }

  // 2. Verify Admin MFA Assurance Level (AAL2) from verified JWT payload
  const jwtPayload = decodeJwtPayload(token);
  const jwtAal = typeof jwtPayload?.aal === 'string' ? jwtPayload.aal : null;
  if (jwtAal !== 'aal2') {
    return jsonResponse(req, 403, {
      ok: false,
      error: 'Admin MFA (AAL2) verification is required before provisioning accounts.',
    });
  }

  // 3. Server-side privileged client (never exposed to browser)
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 4. Verify caller is an active Admin with a valid admin_accounts slot (1 or 2)
  const [{ data: callerProfile, error: profLookupErr }, { data: callerAdmin, error: adminLookupErr }] =
    await Promise.all([
      adminClient
        .from('profiles')
        .select('id, role, is_active, full_name_en')
        .eq('id', callerUser.id)
        .maybeSingle(),
      adminClient
        .from('admin_accounts')
        .select('id, profile_id, assigned_slot')
        .eq('profile_id', callerUser.id)
        .maybeSingle(),
    ]);

  if (profLookupErr || adminLookupErr) {
    console.error('[provision-instructor] Failed verifying caller admin record.');
    return jsonResponse(req, 500, {
      ok: false,
      error: 'Unable to verify administrator authorization.',
    });
  }

  if (
    !callerProfile ||
    !callerProfile.is_active ||
    callerProfile.role !== 'admin' ||
    !callerAdmin ||
    (callerAdmin.assigned_slot !== 1 && callerAdmin.assigned_slot !== 2)
  ) {
    return jsonResponse(req, 403, {
      ok: false,
      error: 'Forbidden: Only active MFA-verified CITS Administrators can provision instructors.',
    });
  }

  // 5. Parse & strictly validate request payload
  let body: ProvisionRequestBody;
  try {
    body = (await req.json()) as ProvisionRequestBody;
  } catch {
    return jsonResponse(req, 400, { ok: false, error: 'Invalid JSON request body.' });
  }

  const fullNameEn = (body.fullNameEn || '').trim();
  const fullNameAr = (body.fullNameAr || '').trim() || fullNameEn;
  const email = (body.email || '').trim().toLowerCase();
  const username = (body.username || '').trim().toLowerCase();
  const instructorCode = (body.instructorCode || '').trim().toUpperCase();
  const specialization = (body.specialization || '').trim();
  const phoneClean = (body.phone || '').trim();
  const phone = phoneClean.length > 0 ? phoneClean : null;
  const bioClean = (body.bio || '').trim();
  const bio = bioClean.length > 0 ? bioClean : null;
  const rateNum = Number(body.defaultLectureRateEgp);
  const defaultLectureRateEgp = Number.isFinite(rateNum) ? Math.round(rateNum) : -1;
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
  const assignToCampId =
    body.assignToCampId && body.assignToCampId.trim().length > 0
      ? body.assignToCampId.trim()
      : null;
  const deliveryMode: CredentialDeliveryMode =
    body.deliveryMode === 'invite_email' ? 'invite_email' : 'temporary_password';
  const providedTempPassword =
    deliveryMode === 'temporary_password' && body.temporaryPassword
      ? body.temporaryPassword.trim()
      : null;

  const fieldErrors: Record<string, string> = {};
  if (fullNameEn.length < 2 || fullNameEn.length > 120) {
    fieldErrors.fullNameEn = 'Full name (English) must be between 2 and 120 characters.';
  }
  if (fullNameAr.length < 2 || fullNameAr.length > 120) {
    fieldErrors.fullNameAr = 'Full name (Arabic) must be between 2 and 120 characters.';
  }
  if (!email || email.length > 120 || !EMAIL_REGEX.test(email)) {
    fieldErrors.email = 'Enter a valid email address.';
  }
  if (!USERNAME_REGEX.test(username)) {
    fieldErrors.username =
      'Username must be 3–64 lowercase characters (letters, numbers, ".", "_", or "-").';
  }
  if (!INSTRUCTOR_CODE_REGEX.test(instructorCode)) {
    fieldErrors.instructorCode =
      'Instructor code must be 2–32 characters (uppercase letters, numbers, "-" or "_").';
  }
  if (specialization.length < 2 || specialization.length > 160) {
    fieldErrors.specialization = 'Specialization must be between 2 and 160 characters.';
  }
  if (phone && !PHONE_REGEX.test(phone)) {
    fieldErrors.phone = 'Phone number contains invalid characters or invalid length.';
  }
  if (defaultLectureRateEgp < 0 || defaultLectureRateEgp > 100000) {
    fieldErrors.defaultLectureRateEgp =
      'Default lecture rate must be between 0 and 100,000 EGP.';
  }
  if (bio && bio.length > 1000) {
    fieldErrors.bio = 'Bio must not exceed 1,000 characters.';
  }
  if (assignToCampId && !UUID_REGEX.test(assignToCampId)) {
    fieldErrors.assignToCampId = 'Invalid camp identifier.';
  }
  if (providedTempPassword) {
    const pwErr = validateInitialPasswordStrength(providedTempPassword);
    if (pwErr) fieldErrors.temporaryPassword = pwErr;
  }

  const firstFieldErr = Object.values(fieldErrors)[0];
  if (firstFieldErr) {
    return jsonResponse(req, 400, {
      ok: false,
      error: firstFieldErr,
      fieldErrors,
    });
  }

  // 6. Validate uniqueness and optional camp state before creating Auth user
  const [emailLookup, usernameLookup, codeLookup] = await Promise.all([
    adminClient.from('profiles').select('id').ilike('email', email).limit(1),
    adminClient.from('profiles').select('id').ilike('username', username).limit(1),
    adminClient
      .from('instructors')
      .select('id')
      .ilike('instructor_code', instructorCode)
      .limit(1),
  ]);

  if (emailLookup.error || usernameLookup.error || codeLookup.error) {
    console.error('[provision-instructor] Pre-check uniqueness query failed.');
    return jsonResponse(req, 500, {
      ok: false,
      error: 'Unable to validate account uniqueness.',
    });
  }

  if ((emailLookup.data || []).length > 0) {
    return jsonResponse(req, 409, {
      ok: false,
      error: `Email "${email}" is already registered.`,
      fieldErrors: { email: `Email "${email}" is already registered.` },
    });
  }
  if ((usernameLookup.data || []).length > 0) {
    return jsonResponse(req, 409, {
      ok: false,
      error: `Username "${username}" is already taken.`,
      fieldErrors: { username: `Username "${username}" is already taken.` },
    });
  }
  if ((codeLookup.data || []).length > 0) {
    return jsonResponse(req, 409, {
      ok: false,
      error: `Instructor code "${instructorCode}" already exists.`,
      fieldErrors: { instructorCode: `Instructor code "${instructorCode}" already exists.` },
    });
  }

  if (assignToCampId) {
    const { data: campRow, error: campErr } = await adminClient
      .from('camps')
      .select('id, status')
      .eq('id', assignToCampId)
      .maybeSingle();

    if (campErr || !campRow) {
      return jsonResponse(req, 400, {
        ok: false,
        error: 'Selected camp does not exist.',
        fieldErrors: { assignToCampId: 'Selected camp does not exist.' },
      });
    }
    if (campRow.status === 'archived') {
      return jsonResponse(req, 400, {
        ok: false,
        error: 'Cannot assign an instructor to an archived read-only camp.',
        fieldErrors: { assignToCampId: 'Archived camps are strictly read-only.' },
      });
    }
  }

  // 7. Create Supabase Auth user & linked PostgreSQL records with compensating rollback
  const initialPassword =
    deliveryMode === 'temporary_password'
      ? providedTempPassword || generateSecureTemporaryPassword(16)
      : undefined;

  let createdAuthUserId: string | null = null;
  let profileCreated = false;
  let createdInstructorId: string | null = null;
  let campAssigned = false;

  const performCompensatingRollback = async (): Promise<boolean> => {
    let allClean = true;
    if (campAssigned && assignToCampId && createdInstructorId) {
      const { error } = await adminClient
        .from('camp_instructors')
        .delete()
        .eq('camp_id', assignToCampId)
        .eq('instructor_id', createdInstructorId);
      if (error) allClean = false;
    }
    if (createdInstructorId) {
      const { error } = await adminClient
        .from('instructors')
        .delete()
        .eq('id', createdInstructorId);
      if (error) allClean = false;
    }
    if (profileCreated && createdAuthUserId) {
      const { error } = await adminClient
        .from('profiles')
        .delete()
        .eq('id', createdAuthUserId);
      if (error) allClean = false;
    }
    if (createdAuthUserId) {
      const { error } = await adminClient.auth.admin.deleteUser(createdAuthUserId);
      if (error) allClean = false;
    }
    return allClean;
  };

  let currentStep = 'auth_user_creation';
  try {
    if (deliveryMode === 'invite_email') {
      const safeRedirectTo =
        typeof body.redirectTo === 'string' && /^https?:\/\//i.test(body.redirectTo.trim())
          ? body.redirectTo.trim()
          : undefined;
      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: safeRedirectTo,
          data: { role: 'instructor', username },
        }
      );
      if (inviteErr || !invited?.user?.id) {
        throw new Error(inviteErr?.message || 'Failed creating Auth invitation user.');
      }
      createdAuthUserId = invited.user.id;
    } else {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { role: 'instructor', username },
      });
      if (createErr || !created?.user?.id) {
        throw new Error(createErr?.message || 'Failed creating Auth user.');
      }
      createdAuthUserId = created.user.id;
    }

    currentStep = 'profile_insert';
    const { error: profileInsertErr } = await adminClient.from('profiles').insert({
      id: createdAuthUserId,
      role: 'instructor',
      username,
      email,
      full_name_en: fullNameEn,
      full_name_ar: fullNameAr,
      phone,
      must_change_password: true,
      is_active: isActive,
    });
    if (profileInsertErr) {
      throw new Error(
        `Profile insert failed (${profileInsertErr.code || 'db_error'}): ${profileInsertErr.message}`
      );
    }
    profileCreated = true;

    currentStep = 'instructor_insert';
    const { data: instRow, error: instInsertErr } = await adminClient
      .from('instructors')
      .insert({
        profile_id: createdAuthUserId,
        instructor_code: instructorCode,
        specialization,
        default_lecture_rate_egp: defaultLectureRateEgp,
        bio,
      })
      .select('id')
      .single();

    if (instInsertErr || !instRow?.id) {
      throw new Error(
        `Instructor insert failed (${instInsertErr?.code || 'db_error'}): ${instInsertErr?.message || 'missing row'}`
      );
    }
    createdInstructorId = instRow.id;

    if (assignToCampId) {
      currentStep = 'camp_assignment';
      const { error: campAssignErr } = await adminClient.from('camp_instructors').insert({
        camp_id: assignToCampId,
        instructor_id: createdInstructorId,
        is_active: true,
      });
      if (campAssignErr) {
        throw new Error(
          `Camp assignment failed (${campAssignErr.code || 'db_error'}): ${campAssignErr.message}`
        );
      }
      campAssigned = true;
    }

    // 8. Append safe audit log (zero credential terms in JSON payload per enforce_audit_log_integrity)
    currentStep = 'audit_log';
    const { error: auditErr } = await adminClient.from('audit_logs').insert({
      actor_profile_id: callerProfile.id,
      actor_name: callerProfile.full_name_en,
      actor_role: 'admin',
      camp_id: assignToCampId,
      action: 'INSTRUCTOR_ACCOUNT_PROVISIONED',
      entity_type: 'instructors',
      entity_id: createdInstructorId,
      previous_value: null,
      new_value: {
        profile_id: createdAuthUserId,
        instructor_code: instructorCode,
        username,
        email,
        is_active: isActive,
        delivery_mode: deliveryMode,
        onboarding_rotation_required: true,
        assigned_camp_id: assignToCampId,
      },
      reason: 'Admin provisioned instructor account via provision-instructor Edge Function',
    });
    if (auditErr) {
      console.warn('[provision-instructor] Secondary audit log insert warning:', auditErr.code);
    }

    return jsonResponse(req, 201, {
      ok: true,
      profileId: createdAuthUserId,
      instructorId: createdInstructorId,
      instructorCode,
      username,
      email,
      fullNameEn,
      fullNameAr,
      specialization,
      defaultLectureRateEgp,
      phone,
      bio,
      isActive,
      mustChangePassword: true,
      assignedCampId: assignToCampId,
      deliveryMode,
      ...(deliveryMode === 'temporary_password' && initialPassword
        ? { initialTemporaryPassword: initialPassword }
        : {}),
    });
  } catch (err) {
    const rolledBack = createdAuthUserId ? await performCompensatingRollback() : true;
    const rawMsg = err instanceof Error ? err.message : 'Provisioning error';
    const isConflict = /already registered|already exists|duplicate key|23505/i.test(rawMsg);

    // Safe diagnostic log only — never log passwords, tokens, or request headers
    console.error('[provision-instructor] Provisioning failed', {
      step: currentStep,
      isConflict,
      rolledBack,
    });

    return jsonResponse(req, isConflict ? 409 : 500, {
      ok: false,
      error: isConflict
        ? 'An account with this email, username, or instructor code already exists.'
        : 'Unable to complete instructor provisioning. Any partial account records were rolled back.',
      rolledBack,
    });
  }
});
