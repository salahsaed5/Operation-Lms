import { supabase } from '../lib/supabase';
import {
  calculateCampDayDate,
  resolveStudentOriginGroupForDay,
} from '../domain/businessRules';
import {
  DEFAULT_PRODUCTION_ORIGINS,
  ProvisionInstructorInput,
  ProvisionInstructorOutcome,
  validateInitialPasswordStrength,
} from '../domain/accountProvisioning';
import {
  AdminAccount,
  AppNotification,
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheet,
  AttendanceSheetStatus,
  AuditLogEntry,
  Camp,
  CampSettings,
  CampStatus,
  CheckinExceptionItem,
  CheckinStatus,
  DailyCheckin,
  DailyChecklistItem,
  DbAttendanceMark,
  DbEntitlementStatus,
  DbIssueSeverity,
  DbIssueStatus,
  DbLectureStatus,
  DbRequestStatus,
  EntitlementStatus,
  Group,
  Instructor,
  InstructorRequestItem,
  IssueSeverity,
  IssueStatus,
  Json,
  Lecture,
  LectureEntitlement,
  LectureStatus,
  OfflineSyncState,
  OperationalIssue,
  PeriodSlot,
  Profile,
  RequestStatus,
  Room,
  Student,
  StudentTransfer,
  SurveyLinkItem,
  UserRole,
  Venue,
} from '../types/database';

export interface SupabaseAuthContext {
  userId: string;
  profile: Profile;
  adminAccount: AdminAccount | null;
  instructor: Instructor | null;
  mfa: {
    aal: 'aal1' | 'aal2' | null;
    verifiedFactorId: string | null;
    needsChallenge: boolean;
    needsEnrollment: boolean;
  };
}

export interface OperationalSnapshot {
  profiles: Profile[];
  adminAccounts: AdminAccount[];
  instructors: Instructor[];
  venues: Venue[];
  rooms: Room[];
  camps: Camp[];
  campInstructorIds: Record<string, string[]>;
  groups: Group[];
  students: Student[];
  studentTransfers: StudentTransfer[];
  lectures: Lecture[];
  checkins: DailyCheckin[];
  checkinExceptions: CheckinExceptionItem[];
  attendanceSheets: AttendanceSheet[];
  entitlements: LectureEntitlement[];
  requests: InstructorRequestItem[];
  notifications: AppNotification[];
  issues: OperationalIssue[];
  checklists: DailyChecklistItem[];
  surveys: SurveyLinkItem[];
  auditLogs: AuditLogEntry[];
}

function getClient() {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }
  return supabase;
}

function normalizeTimeHHMM(val: string | null | undefined): string {
  if (!val) return '09:00';
  return val.slice(0, 5);
}

function mapProfileRow(row: {
  id: string;
  role: string;
  username: string;
  email: string;
  full_name_en: string;
  full_name_ar: string;
  phone: string | null;
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
}): Profile {
  return {
    id: row.id,
    role: row.role === 'admin' ? UserRole.ADMIN : UserRole.INSTRUCTOR,
    username: row.username,
    email: row.email,
    fullNameEn: row.full_name_en,
    fullNameAr: row.full_name_ar,
    phone: row.phone || '',
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function resolveAndSignInWithSupabase(
  identifier: string,
  password: string
): Promise<SupabaseAuthContext> {
  const client = getClient();
  const cleanId = identifier.trim();
  if (!cleanId || !password) {
    throw new Error('Username/email and password are required.');
  }

  // SEC-004: Authenticate via server-side rate-limited, non-enumerable auth-login
  // Edge Function instead of exposing resolve_login_identifier() to anon callers.
  const { data, error } = await client.functions.invoke('auth-login', {
    body: {
      identifier: cleanId,
      password,
    },
  });

  if (error) {
    let parsedErr: { error?: string } | null = null;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        parsedErr = (await ctx.json()) as { error?: string };
      }
    } catch {
      parsedErr = null;
    }

    const status = (error as unknown as { context?: Response }).context?.status;
    if (status === 503) {
      throw new Error(
        parsedErr?.error ||
          'Authentication service is temporarily unavailable. Please try again shortly.'
      );
    }
    if (status === 429) {
      throw new Error(
        parsedErr?.error || 'Too many sign-in attempts. Please wait before trying again.'
      );
    }
    if (status === 401) {
      throw new Error(parsedErr?.error || 'Invalid credentials or account unavailable.');
    }
    throw new Error(parsedErr?.error || error.message || 'Sign-in failed.');
  }

  const payload = data as
    | {
        ok?: boolean;
        error?: string;
        session?: { access_token?: string; refresh_token?: string };
      }
    | null;

  if (
    !payload ||
    !payload.ok ||
    !payload.session?.access_token ||
    !payload.session?.refresh_token
  ) {
    throw new Error(payload?.error || 'Invalid credentials or account unavailable.');
  }

  const { data: sessionData, error: setSessionErr } = await client.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  });

  if (setSessionErr || !sessionData.user) {
    throw new Error(setSessionErr?.message || 'Unable to establish authenticated session.');
  }

  return loadAuthenticatedUserContext(sessionData.user.id);
}

export async function loadAuthenticatedUserContext(
  userId: string
): Promise<SupabaseAuthContext> {
  const client = getClient();

  const { data: profileRow, error: profileErr } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    throw new Error(`Failed to load user profile: ${profileErr.message}`);
  }

  if (!profileRow) {
    await client.auth.signOut();
    throw new Error(
      'Authenticated Auth user has no provisioned CITS profile. Contact an Admin.'
    );
  }

  const profile = mapProfileRow(profileRow);
  if (!profile.isActive) {
    await client.auth.signOut();
    throw new Error('Your CITS account is deactivated. Contact Operations.');
  }

  if (profile.role === UserRole.ADMIN) {
    const { data: adminRow, error: adminErr } = await client
      .from('admin_accounts')
      .select('*')
      .eq('profile_id', userId)
      .maybeSingle();

    if (adminErr || !adminRow) {
      await client.auth.signOut();
      throw new Error(
        'Admin role verification failed: no valid entry in admin_accounts.'
      );
    }

    const [{ data: factorsData }, { data: aalData }] = await Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    const verifiedTotp = (factorsData?.totp || []).find(
      (f) => f.status === 'verified'
    );
    const currentAal =
      aalData?.currentLevel === 'aal2'
        ? 'aal2'
        : aalData?.currentLevel === 'aal1'
        ? 'aal1'
        : null;

    const needsEnrollment = !verifiedTotp;
    const needsChallenge = Boolean(verifiedTotp) && currentAal !== 'aal2';

    return {
      userId,
      profile,
      adminAccount: {
        id: adminRow.id,
        profileId: adminRow.profile_id,
        assignedSlot: adminRow.assigned_slot,
        totpEnrolled: adminRow.totp_enrolled,
        totpVerifiedAt: adminRow.totp_verified_at,
      },
      instructor: null,
      mfa: {
        aal: currentAal,
        verifiedFactorId: verifiedTotp?.id || null,
        needsChallenge,
        needsEnrollment,
      },
    };
  }

  const { data: instRow, error: instErr } = await client
    .from('instructors')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();

  if (instErr || !instRow) {
    await client.auth.signOut();
    throw new Error('Instructor account verification failed: missing instructor record.');
  }

  return {
    userId,
    profile,
    adminAccount: null,
    instructor: {
      id: instRow.id,
      profileId: instRow.profile_id,
      instructorCode: instRow.instructor_code,
      archivedAt: instRow.archived_at,
      fullNameEn: profile.fullNameEn,
      fullNameAr: profile.fullNameAr,
      username: profile.username,
      email: profile.email,
      phone: profile.phone,
      specialization: instRow.specialization,
      defaultLectureRateEgp: instRow.default_lecture_rate_egp,
      bio: instRow.bio || '',
      isActive: profile.isActive,
    },
    mfa: {
      aal: null,
      verifiedFactorId: null,
      needsChallenge: false,
      needsEnrollment: false,
    },
  };
}

export async function enrollAdminTotpFactor(): Promise<{
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}> {
  const client = getClient();
  // Remove any unverified stale TOTP factor first so enrollment is repeatable
  const { data: existing } = await client.auth.mfa.listFactors();
  for (const factor of existing?.all || []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `CITS Admin Authenticator (${new Date().toISOString().slice(0, 10)})`,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to enroll TOTP MFA factor.');
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export async function verifyAdminTotpCode(
  factorId: string,
  code: string
): Promise<void> {
  const client = getClient();
  const cleanCode = code.trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error('Enter a valid 6-digit TOTP authenticator code.');
  }

  const { error: verifyErr } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code: cleanCode,
  });

  if (verifyErr) {
    throw new Error(verifyErr.message || 'Invalid authenticator verification code.');
  }

  const { error: rpcErr } = await client.rpc('record_admin_totp_verified_tx');
  if (rpcErr) {
    throw new Error(`MFA verified but failed recording audit status: ${rpcErr.message}`);
  }
}

export async function completeUserPasswordChange(newPassword: string): Promise<void> {
  const client = getClient();
  const pwCheck = validateInitialPasswordStrength(newPassword);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.error || 'New password does not meet security requirements.');
  }

  const { error: updateErr } = await client.auth.updateUser({
    password: newPassword.trim(),
  });
  if (updateErr) {
    throw new Error(`Password update rejected: ${updateErr.message}`);
  }

  const { error: rpcErr } = await client.rpc('complete_password_change_tx');
  if (rpcErr) {
    throw new Error(`Password updated in Auth, but profile flag failed: ${rpcErr.message}`);
  }
}

export async function signOutSupabase(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Export queries use stable 500-row pages to avoid the Data API default row cap. */
async function fetchAllPages<T>(query:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>):Promise<{data:T[];error:{message:string}|null}> {
  const rows:T[]=[];
  const size=500;
  for(let start=0;;start+=size){
    const {data,error}=await query(start,start+size-1);
    if(error)return {data:[],error};
    const page=data||[];
    rows.push(...page);
    if(page.length<size)return {data:rows,error:null};
  }
}
export async function fetchOperationalSnapshot(
  ctx: SupabaseAuthContext,
  attendanceExportCampId?: string
): Promise<OperationalSnapshot> {
  const client = getClient();
  const isAdmin = ctx.profile.role === UserRole.ADMIN;

  const [
    profilesRes,
    adminRes,
    instructorsRes,
    venuesRes,
    roomsRes,
    campsRes,
    settingsRes,
    campInstructorsRes,
    groupsRes,
    groupInstructorsRes,
    studentsRes,
    transfersRes,
    lecturesRes,
    sessionRunsRes,
    checkinsRes,
    exceptionsRes,
    sheetsRes,
    recordsRes,
    entitlementsRes,
    requestsRes,
    notificationsRes,
    issuesRes,
    checklistsRes,
    surveyLinksRes,
    surveyResultsRes,
    auditLogsRes,
  ] = await Promise.all([
    client.from('profiles').select('*').order('created_at', { ascending: true }),
    isAdmin
      ? client.from('admin_accounts').select('*').order('assigned_slot', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    client.from('instructors').select('*').order('instructor_code', { ascending: true }),
    client.from('venues').select('*').order('created_at', { ascending: true }),
    client.from('rooms').select('*').order('code', { ascending: true }),
    client.from('camps').select('*').order('start_date', { ascending: false }),
    client.from('camp_settings').select('*'),
    client.from('camp_instructors').select('*').eq('is_active', true),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('groups').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('groups').select('*').order('code', { ascending: true }),
    client.from('group_instructors').select('*').order('effective_from_day', { ascending: true }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('students').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('students').select('*').order('student_code', { ascending: true }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('student_transfers').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('student_transfers').select('*').order('created_at', { ascending: false }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('lectures').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('lectures').select('*').order('camp_day', { ascending: true }).order('period_number', { ascending: true }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('lecture_session_runs').select('*').eq('camp_id',attendanceExportCampId).order('lecture_id').order('revision_number').range(start,end)) : fetchAllPages((start,end)=>client.from('lecture_session_runs').select('*').order('lecture_id').order('revision_number').range(start,end)),
    client.from('daily_checkins').select('*').order('camp_day', { ascending: false }),
    client.from('checkin_exceptions').select('*').order('created_at', { ascending: false }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('attendance_sheets').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('attendance_sheets').select('*').order('created_at', { ascending: false }),
    attendanceExportCampId ? fetchAllPages((start,end)=>client.from('attendance_records').select('*').eq('camp_id',attendanceExportCampId).order('id').range(start,end)) : client.from('attendance_records').select('*'),
    client.from('lecture_entitlements').select('*').order('camp_day', { ascending: false }).order('period_number', { ascending: true }),
    client.from('instructor_requests').select('*').order('created_at', { ascending: false }),
    client.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
    client.from('issues').select('*').order('created_at', { ascending: false }),
    isAdmin
      ? client.from('daily_checklists').select('*').order('camp_day', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    client.from('survey_links').select('*').order('created_at', { ascending: false }),
    client.from('survey_results').select('*'),
    isAdmin
      ? client.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const errors = [
    profilesRes.error,
    instructorsRes.error,
    venuesRes.error,
    roomsRes.error,
    campsRes.error,
    settingsRes.error,
    groupsRes.error,
    studentsRes.error,
    transfersRes.error,
    lecturesRes.error,
    sessionRunsRes.error,
    checkinsRes.error,
    sheetsRes.error,
    recordsRes.error,
    entitlementsRes.error,
    requestsRes.error,
    notificationsRes.error,
    issuesRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(`Database query failed: ${errors[0]!.message}`);
  }

  const profiles = (profilesRes.data || []).map(mapProfileRow);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const adminAccounts: AdminAccount[] = (adminRes.data || []).map((a) => ({
    id: a.id,
    profileId: a.profile_id,
    assignedSlot: a.assigned_slot,
    totpEnrolled: a.totp_enrolled,
    totpVerifiedAt: a.totp_verified_at,
  }));

  const instructors: Instructor[] = (instructorsRes.data || []).map((i) => {
    const prof = profileById.get(i.profile_id);
    return {
      id: i.id,
      profileId: i.profile_id,
      instructorCode: i.instructor_code,
      archivedAt: i.archived_at,
      fullNameEn: prof?.fullNameEn || i.instructor_code,
      fullNameAr: prof?.fullNameAr || i.instructor_code,
      username: prof?.username || i.instructor_code,
      email: prof?.email || '',
      phone: prof?.phone || '',
      specialization: i.specialization,
      defaultLectureRateEgp: i.default_lecture_rate_egp,
      bio: i.bio || '',
      isActive: prof?.isActive ?? true,
    };
  });

  const venues: Venue[] = (venuesRes.data || []).map((v) => ({
    id: v.id,
    nameEn: v.name_en,
    nameAr: v.name_ar,
    address: v.address,
    latitude: v.latitude,
    longitude: v.longitude,
    geofenceRadiusMeters: v.geofence_radius_meters,
  }));

  const rooms: Room[] = (roomsRes.data || []).map((r) => ({
    id: r.id,
    venueId: r.venue_id,
    code: r.code,
    name: r.name,
    capacity: r.capacity,
  }));

  const settingsByCampId = new Map<string, CampSettings>();
  for (const s of settingsRes.data || []) {
    const slotsRaw = Array.isArray(s.period_slots) ? (s.period_slots as unknown as PeriodSlot[]) : [];
    settingsByCampId.set(s.camp_id, {
      campId: s.camp_id,
      defaultLectureDurationHours: s.default_lecture_duration_hours,
      maxInstructorGroupsPerDay: s.max_instructor_groups_per_day,
      geofenceRadiusMeters: s.geofence_radius_meters,
      firstLectureLateThresholdMinutes: s.first_lecture_late_threshold_minutes,
      maxSelfieKb: s.max_selfie_kb,
      defaultLectureRateEgp: s.default_lecture_rate_egp,
      periodSlots:
        slotsRaw.length > 0
          ? slotsRaw
          : [
              { period: 1, start: '09:00', end: '12:00' },
              { period: 2, start: '12:00', end: '15:00' },
              { period: 3, start: '15:00', end: '18:00' },
              { period: 4, start: '18:00', end: '21:00' },
            ],
    });
  }

  const camps: Camp[] = (campsRes.data || []).map((c) => ({
    id: c.id,
    code: c.code,
    nameEn: c.name_en,
    nameAr: c.name_ar,
    status: c.status as CampStatus,
    venueId: c.venue_id,
    startDate: c.start_date,
    endDate: c.end_date,
    durationDays: c.duration_days,
    operatingWeekdays: c.operating_weekdays ?? [0,1,2,3,4,5,6],
    currentCampDay: c.current_camp_day,
    settings: settingsByCampId.get(c.id) || {
      campId: c.id,
      defaultLectureDurationHours: 3,
      maxInstructorGroupsPerDay: 4,
      geofenceRadiusMeters: 100,
      firstLectureLateThresholdMinutes: 60,
      maxSelfieKb: 300,
      defaultLectureRateEgp: 700,
      periodSlots: [
        { period: 1, start: '09:00', end: '12:00' },
        { period: 2, start: '12:00', end: '15:00' },
        { period: 3, start: '15:00', end: '18:00' },
        { period: 4, start: '18:00', end: '21:00' },
      ],
    },
  }));

  const campInstructorIds: Record<string, string[]> = {};
  for (const ci of campInstructorsRes.data || []) {
    if (!campInstructorIds[ci.camp_id]) campInstructorIds[ci.camp_id] = [];
    campInstructorIds[ci.camp_id].push(ci.instructor_id);
  }

  const primaryInstByGroup = new Map<string, string>();
  for (const gi of groupInstructorsRes.data || []) {
    if (gi.effective_to_day === null) {
      primaryInstByGroup.set(gi.group_id, gi.instructor_id);
    } else if (!primaryInstByGroup.has(gi.group_id)) {
      primaryInstByGroup.set(gi.group_id, gi.instructor_id);
    }
  }

  const groups: Group[] = (groupsRes.data || []).map((g) => ({
    id: g.id,
    campId: g.camp_id,
    code: g.code,
    nameEn: g.name_en,
    nameAr: g.name_ar,
    track: g.track,
    defaultRoomId: g.default_room_id || '',
    primaryInstructorId: primaryInstByGroup.get(g.id) || '',
    capacity: g.capacity,
  }));

  const students: Student[] = (studentsRes.data || []).map((s) => ({
    id: s.id,
    campId: s.camp_id,
    groupId: s.group_id,
    studentCode: s.student_code,
    fullName: s.full_name,
    university: s.university || '',
    isActive: s.is_active,
    joinedCampDay: s.joined_camp_day ?? 1,
    enrolledAt: s.enrolled_at || s.created_at,
    enrolledByProfileId: s.enrolled_by_profile_id ?? null,
    enrollmentOrigin: s.enrollment_origin || 'admin_import',
    enrollmentReason: s.enrollment_reason ?? null,
  }));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const visitedIdentityById = new Map<string, { studentCode: string; fullName: string; homeGroupCode: string }>();
  // Instructor student SELECT RLS intentionally excludes other home groups.
  // Only resolve identity of students who ALREADY have cross-group attendance
  // in an Instructor-assigned lecture; no unrestricted student access.
  if (!isAdmin && ctx.instructor && (recordsRes.data || []).some(
    rec => rec.is_cross_group && !studentById.has(rec.student_id)
  )) {
    const { data, error } = await client.rpc('my_recorded_visiting_student_identities');
    if (error) {
      // This optional hydration is non-blocking until migration 0015 is applied.
      // It never changes roster authorization or the attendance record itself.
      console.warn('[CITS] Authorized visiting student identity lookup unavailable:', error.message);
    } else {
      for (const record of data || []) {
        visitedIdentityById.set(record.student_id, {
          studentCode: record.student_code,
          fullName: record.full_name,
          homeGroupCode: record.home_group_code,
        });
      }
    }
  }

  const studentTransfers: StudentTransfer[] = (transfersRes.data || []).map((tr) => ({
    id: tr.id,
    campId: tr.camp_id,
    studentId: tr.student_id,
    fromGroupId: tr.from_group_id,
    toGroupId: tr.to_group_id,
    effectiveCampDay: tr.effective_camp_day,
    reason: tr.reason,
    transferredBy: tr.transferred_by,
    createdAt: tr.created_at,
  }));

  const sessionRuns = new Map((sessionRunsRes.data||[]).map(r=>[r.lecture_id+':'+r.revision_number+':'+r.instructor_id,r]));
  const lectures: Lecture[] = (lecturesRes.data || []).map((l) => {
    const run=sessionRuns.get(l.id+':'+l.revision_number+':'+(l.substitute_instructor_id||l.instructor_id));
    return ({ 
    sessionStartedAt: run && run.camp_id===l.camp_id && run.group_id===l.group_id && run.room_id===l.room_id &&
      run.lecture_date===l.lecture_date && run.start_time===l.start_time && run.end_time===l.end_time ? run.started_at : null,
    id: l.id,
    campId: l.camp_id,
    campDay: l.camp_day,
    lectureDate: l.lecture_date,
    periodNumber: l.period_number,
    startTime: normalizeTimeHHMM(l.start_time),
    endTime: normalizeTimeHHMM(l.end_time),
    durationHours: l.duration_hours,
    groupId: l.group_id,
    instructorId: l.instructor_id,
    substituteInstructorId: l.substitute_instructor_id,
    roomId: l.room_id,
    topic: l.topic,
    status: l.status as LectureStatus,
    frozenRateEgp: l.frozen_rate_egp,
    instructorAcknowledgedAt: l.instructor_acknowledged_at,
    revisionNumber: l.revision_number,
  }); });
  const lectureById = new Map(lectures.map((l) => [l.id, l]));

  const checkinExceptions: CheckinExceptionItem[] = (exceptionsRes.data || []).map((ex) => ({
    id: ex.id,
    checkinId: ex.checkin_id,
    campId: ex.camp_id,
    instructorId: ex.instructor_id,
    campDay: ex.camp_day,
    reason: ex.reason,
    status: ex.status as RequestStatus,
    reviewedBy: ex.reviewed_by,
    reviewNote: ex.review_note,
    reviewedAt: ex.reviewed_at,
    createdAt: ex.created_at,
  }));
  const exceptionByCheckinId = new Map<string, CheckinExceptionItem>();
  for (const ex of checkinExceptions) {
    if (ex.checkinId && !exceptionByCheckinId.has(ex.checkinId)) {
      exceptionByCheckinId.set(ex.checkinId, ex);
    }
  }

  const checkins: DailyCheckin[] = (checkinsRes.data || []).map((c) => ({
    id: c.id,
    campId: c.camp_id,
    instructorId: c.instructor_id,
    campDay: c.camp_day,
    checkinDate: c.checkin_date,
    serverTimestamp: c.server_timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    gpsAccuracyMeters: c.gps_accuracy_meters,
    distanceFromVenueMeters: c.distance_from_venue_meters,
    withinGeofence: c.within_geofence,
    selfieStoragePath: c.selfie_storage_path,
    selfieSizeKb: c.selfie_size_kb || 0,
    selfieDeletedAfterArchive: c.selfie_deleted_after_archive,
    arrivedLateFirstLecture: c.arrived_late_first_lecture,
    minutesAfterFirstLecture: c.minutes_after_first_lecture,
    status: c.status as CheckinStatus,
    exceptionReason: exceptionByCheckinId.get(c.id)?.reason,
  }));

  const recordsBySheetId = new Map<string, AttendanceRecordItem[]>();
  for (const r of recordsRes.data || []) {
    const stu = studentById.get(r.student_id);
    const visitingIdentity = r.is_cross_group ? visitedIdentityById.get(r.student_id) : undefined;
    const list = recordsBySheetId.get(r.attendance_sheet_id) || [];
    list.push({
      studentId: r.student_id,
      studentCode: stu?.studentCode || visitingIdentity?.studentCode || r.student_id.slice(0, 8),
      studentName: stu?.fullName || visitingIdentity?.fullName || 'Student',
      originGroupCode: visitingIdentity?.homeGroupCode,
      originGroupId: r.origin_group_id,
      attendedGroupId: r.attended_group_id,
      isCrossGroup: r.is_cross_group,
      mark: r.mark as AttendanceMark,
      note: r.note || undefined,
    });
    recordsBySheetId.set(r.attendance_sheet_id, list);
  }

  const attendanceSheets: AttendanceSheet[] = (sheetsRes.data || []).map((s) => {
    const lec = lectureById.get(s.lecture_id);
    return {
      id: s.id,
      campId: s.camp_id,
      lectureId: s.lecture_id,
      instructorId: s.instructor_id,
      campDay: lec?.campDay || 1,
      periodNumber: lec?.periodNumber || 1,
      status: s.status as AttendanceSheetStatus,
      syncState: s.sync_state as OfflineSyncState,
      idempotencyKey: s.idempotency_key,
      records: recordsBySheetId.get(s.id) || [],
      submittedAt: s.submitted_at,
      syncedAt: s.synced_at,
    };
  });

  const entitlements: LectureEntitlement[] = (entitlementsRes.data || []).map((e) => ({
    id: e.id,
    campId: e.camp_id,
    lectureId: e.lecture_id,
    instructorId: e.instructor_id,
    campDay: e.camp_day,
    periodNumber: e.period_number,
    frozenRateEgp: e.frozen_rate_egp,
    entitlementAmountEgp: e.entitlement_amount_egp,
    status: e.status as EntitlementStatus,
    eligibilityReason: e.eligibility_reason,
    anomalyFlag: e.anomaly_flag || undefined,
    adminOverrideReason: e.admin_override_reason || undefined,
    updatedAt: e.updated_at,
  }));

  const requests: InstructorRequestItem[] = (requestsRes.data || []).map((r) => ({
    id: r.id,
    campId: r.camp_id,
    instructorId: r.instructor_id,
    requestType: r.request_type as InstructorRequestItem['requestType'],
    subject: r.subject,
    details: r.details,
    status: r.status as RequestStatus,
    reviewNote: r.review_note || undefined,
    createdAt: r.created_at,
  }));

  const notifications: AppNotification[] = (notificationsRes.data || []).map((n) => ({
    id: n.id,
    recipientProfileId: n.recipient_profile_id,
    titleEn: n.title_en,
    titleAr: n.title_ar,
    bodyEn: n.body_en,
    bodyAr: n.body_ar,
    isRead: n.is_read,
    createdAt: n.created_at,
  }));

  const issues: OperationalIssue[] = (issuesRes.data || []).map((is) => ({
    id: is.id,
    campId: is.camp_id,
    roomId: is.room_id || '',
    category: is.category,
    title: is.title,
    description: is.description,
    severity: is.severity as IssueSeverity,
    status: is.status as IssueStatus,
    reportedBy: profileById.get(is.reported_by)?.fullNameEn || is.reported_by,
    createdAt: is.created_at,
  }));

  const checklists: DailyChecklistItem[] = (checklistsRes.data || []).map((ch) => ({
    id: ch.id,
    campId: ch.camp_id,
    campDay: ch.camp_day,
    titleEn: ch.task_title_en,
    titleAr: ch.task_title_ar,
    isCompleted: ch.is_completed,
  }));

  const resultsByLink = new Map<string, { count: number; score: number }>();
  for (const sr of surveyResultsRes.data || []) {
    resultsByLink.set(sr.survey_link_id, {
      count: sr.responses_count,
      score: Number(sr.average_score),
    });
  }

  const surveys: SurveyLinkItem[] = (surveyLinksRes.data || []).map((sl) => {
    const res = resultsByLink.get(sl.id);
    return {
      id: sl.id,
      campId: sl.camp_id,
      instructorId: sl.instructor_id,
      title: sl.title,
      url: sl.url,
      responsesCount: res?.count || 0,
      averageScore: res?.score || 0,
    };
  });

  const auditLogs: AuditLogEntry[] = (auditLogsRes.data || []).map((al) => ({
    id: al.id,
    actorProfileId: al.actor_profile_id,
    actorName: al.actor_name,
    actorRole: al.actor_role === 'admin' ? UserRole.ADMIN : UserRole.INSTRUCTOR,
    campId: al.camp_id,
    action: al.action,
    entityType: al.entity_type,
    entityId: al.entity_id,
    previousValue: JSON.stringify(al.previous_value ?? null),
    newValue: JSON.stringify(al.new_value ?? null),
    reason: al.reason || '',
    createdAt: al.created_at,
  }));

  return {
    profiles,
    adminAccounts,
    instructors,
    venues,
    rooms,
    camps,
    campInstructorIds,
    groups,
    students,
    studentTransfers,
    lectures,
    checkins,
    checkinExceptions,
    attendanceSheets,
    entitlements,
    requests,
    notifications,
    issues,
    checklists,
    surveys,
    auditLogs,
  };
}

// =============================================================================
// CLIENT-SIDE SELFIE COMPRESSION (<= 300KB) & PRIVATE STORAGE BUCKET UPLOAD
// =============================================================================

export async function compressSelfieUnderLimit(
  file: File,
  maxKb = 300
): Promise<{ blob: Blob; sizeKb: number; ext: 'webp' | 'jpg'; mimeType: string }> {
  const maxBytes = maxKb * 1024;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const objUrl = URL.createObjectURL(file);
    el.onload = () => {
      URL.revokeObjectURL(objUrl);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Failed to decode selected image file.'));
    };
    el.src = objUrl;
  });

  const maxDim = 960;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas 2D context unavailable for selfie compression.');
  }
  ctx.drawImage(img, 0, 0, width, height);

  const encode = (mime: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));

  for (const mime of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of [0.78, 0.62, 0.45, 0.32]) {
      const blob = await encode(mime, quality);
      if (blob && blob.size <= maxBytes) {
        return {
          blob,
          sizeKb: Math.max(1, Math.ceil(blob.size / 1024)),
          ext: mime === 'image/webp' ? 'webp' : 'jpg',
          mimeType: mime,
        };
      }
    }
  }

  throw new Error(`Unable to compress selfie below ${maxKb} KB. Please choose a smaller photo.`);
}

export async function uploadCheckinSelfie(params: {
  userId: string;
  campId: string;
  campDay: number;
  blob: Blob;
  ext: 'webp' | 'jpg';
  mimeType: string;
}): Promise<string> {
  const client = getClient();
  const path = `${params.userId}/${params.campId}/day-${params.campDay}-${Date.now()}.${params.ext}`;
  const { error } = await client.storage.from('checkin-selfies').upload(path, params.blob, {
    contentType: params.mimeType,
    upsert: false,
  });
  if (error) {
    throw new Error(`Selfie upload failed: ${error.message}`);
  }
  return path;
}

export async function getSignedSelfieUrl(path: string): Promise<string | null> {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage
    .from('checkin-selfies')
    .createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteCheckinSelfiePath(path: string): Promise<void> {
  if (!supabase || !path) return;
  try {
    await supabase.storage.from('checkin-selfies').remove([path]);
  } catch {
    // Best-effort orphan storage cleanup after failed DB RPC
  }
}

// =============================================================================
// REPOSITORY MUTATIONS
// =============================================================================

/**
 * Add an Admin-configured training location for Camps and GPS geofencing.
 * The logged-in caller must satisfy the existing MFA-gated Admin RLS policy.
 * Coordinates are supplied by the operator; never derive placeholder (0,0).
 */
export async function createVenueInDb(input: {
  venueId?: string;
  nameEn: string;
  nameAr: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}): Promise<string> {
  const client = getClient();
  const values = {
    name_en: input.nameEn.trim(),
    name_ar: input.nameAr.trim(),
    address: input.address.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    geofence_radius_meters: input.geofenceRadiusMeters,
  };
  const {data,error}=input.venueId ? await client.from('venues').update(values).eq('id',input.venueId).select('id').single() : await client.from('venues').insert(values).select('id').single();
  if (error || !data) {
    throw new Error(error?.message || 'Unable to create training venue.');
  }
  return data.id;
}

/**
 * Register a physical training room in an existing training Venue.
 * Authenticated Admin MFA/RLS policy on rooms enforces authorization.
 */
export async function createRoomInDb(input: {
  venueId: string;
  code: string;
  name: string;
  capacity: number;
}): Promise<string> {
  const client = getClient();
  const { data, error } = await client.from('rooms').insert({
    venue_id: input.venueId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    capacity: input.capacity,
    is_active: true,
  }).select('id').single();
  if (error || !data) {
    throw new Error(error?.message || 'Unable to create training room.');
  }
  return data.id;
}

export async function createDraftCampInDb(input: {
  code: string;
  nameEn: string;
  nameAr: string;
  venueId: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  operatingWeekdays: number[];
  geofenceRadiusMeters: number;
  defaultRateEgp: number;
  createdBy: string;
}): Promise<string> {
  const client = getClient();
  const { data: campRow, error: campErr } = await client
    .from('camps')
    .insert({
      code: input.code.trim(),
      name_en: input.nameEn.trim(),
      name_ar: input.nameAr.trim(),
      status: 'draft',
      venue_id: input.venueId,
      start_date: input.startDate,
      end_date: input.endDate,
      duration_days: input.durationDays,
      operating_weekdays: input.operatingWeekdays,
      current_camp_day: 1,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  if (campErr || !campRow) {
    throw new Error(campErr?.message || 'Failed to create draft camp.');
  }

  const { error: settingsErr } = await client.from('camp_settings').insert({
    camp_id: campRow.id,
    geofence_radius_meters: input.geofenceRadiusMeters,
    default_lecture_rate_egp: input.defaultRateEgp,
  });

  if (settingsErr) {
    throw new Error(`Camp created, but failed saving settings: ${settingsErr.message}`);
  }

  return campRow.id;
}

export async function updateCampInDb(input: {
  campId: string;
  venueId?: string;
  nameEn: string;
  nameAr: string;
  startDate: string;
  durationDays: number;
  operatingWeekdays: number[];
  currentCampDay: number;
  geofenceRadiusMeters: number;
  defaultRateEgp: number;
  maxInstructorGroupsPerDay: number;
}): Promise<void> {
  const client = getClient();
  const endDate = calculateCampDayDate(input.startDate, input.durationDays, input.operatingWeekdays);

  const { error: campErr } = await client
    .from('camps')
    .update({
      ...(input.venueId ? { venue_id: input.venueId } : {}),
      name_en: input.nameEn.trim(),
      name_ar: input.nameAr.trim(),
      start_date: input.startDate,
      end_date: endDate,
      duration_days: input.durationDays,
      operating_weekdays: input.operatingWeekdays,
      current_camp_day: input.currentCampDay,
    })
    .eq('id', input.campId);

  if (campErr) throw new Error(campErr.message);

  const { error: setErr } = await client
    .from('camp_settings')
    .update({
      geofence_radius_meters: input.geofenceRadiusMeters,
      default_lecture_rate_egp: input.defaultRateEgp,
      max_instructor_groups_per_day: input.maxInstructorGroupsPerDay,
    })
    .eq('camp_id', input.campId);

  if (setErr) throw new Error(setErr.message);
}

export async function activateCampInDb(campId: string): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('camps')
    .update({ status: 'active' })
    .eq('id', campId);
  if (error) throw new Error(error.message);
}

export async function archiveCampInDb(campId: string): Promise<string[]> {
  const client = getClient();
  const { data, error } = await client.rpc('archive_camp_tx', { p_camp_id: campId });
  if (error) throw new Error(error.message);
  const purged = (data as unknown as { purged_paths?: string[] })?.purged_paths || [];
  if (purged.length > 0) {
    const { error: rmErr } = await client.storage.from('checkin-selfies').remove(purged);
    if (rmErr) {
      throw new Error(
        `Camp archived, but deleting selfie files from storage failed: ${rmErr.message}`
      );
    }
  }
  return purged;
}

export async function upsertGroupInDb(input: {
  id?: string;
  campId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  track: string;
  defaultRoomId: string;
  primaryInstructorId: string;
  capacity: number;
  actorProfileId: string;
  effectiveDay?: number;
}): Promise<void> {
  const client = getClient();
  let groupId = input.id;

  if (groupId) {
    const { error } = await client
      .from('groups')
      .update({
        code: input.code.trim(),
        name_en: input.nameEn.trim(),
        name_ar: input.nameAr.trim(),
        track: input.track.trim(),
        default_room_id: input.defaultRoomId || null,
        capacity: input.capacity,
      })
      .eq('id', groupId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await client
      .from('groups')
      .insert({
        camp_id: input.campId,
        code: input.code.trim(),
        name_en: input.nameEn.trim(),
        name_ar: input.nameAr.trim(),
        track: input.track.trim(),
        default_room_id: input.defaultRoomId || null,
        capacity: input.capacity,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message || 'Failed creating group.');
    groupId = data.id;
  }

  if (input.primaryInstructorId) {
    const effectiveDay = Math.max(1, Math.floor(input.effectiveDay ?? 1));
    const { error: ciErr } = await client
      .from('camp_instructors')
      .upsert(
        {
          camp_id: input.campId,
          instructor_id: input.primaryInstructorId,
          is_active: true,
        },
        { onConflict: 'camp_id,instructor_id' }
      );
    if (ciErr) throw new Error(ciErr.message);

    const { data: existingGi, error: giLookupErr } = await client
      .from('group_instructors')
      .select('id, instructor_id')
      .eq('camp_id', input.campId)
      .eq('group_id', groupId)
      .is('effective_to_day', null);
    if (giLookupErr) throw new Error(giLookupErr.message);

    const alreadyAssigned = (existingGi || []).some(
      (row) => row.instructor_id === input.primaryInstructorId
    );

    if (!alreadyAssigned) {
      const supersededIds = (existingGi || []).map((row) => row.id);
      if (supersededIds.length > 0) {
        const { error: closeErr } = await client
          .from('group_instructors')
          .update({ effective_to_day: effectiveDay })
          .in('id', supersededIds);
        if (closeErr) throw new Error(closeErr.message);
      }

      const { error: giErr } = await client.from('group_instructors').insert({
        camp_id: input.campId,
        group_id: groupId,
        instructor_id: input.primaryInstructorId,
        effective_from_day: effectiveDay,
        assigned_by: input.actorProfileId,
      });
      if (giErr) throw new Error(giErr.message);
    }
  }
}

export async function updateInstructorInDb(input: {
  instructorId: string;
  profileId: string;
  instructorCode?: string;
  username?: string;
  fullNameEn?: string;
  fullNameAr?: string;
  phone?: string;
  bio?: string;
  specialization: string;
  defaultLectureRateEgp: number;
  isActive: boolean;
  campId?: string;
  assignedToCamp?: boolean;
}): Promise<void> {
  const client = getClient();
  const instUpdate: {
    specialization: string;
    default_lecture_rate_egp: number;
    instructor_code?: string;
    bio?: string | null;
  } = {
    specialization: input.specialization.trim(),
    default_lecture_rate_egp: Math.max(0, Math.round(input.defaultLectureRateEgp)),
  };
  if (input.instructorCode !== undefined) instUpdate.instructor_code = input.instructorCode;
  if (input.bio !== undefined) {
    const cleanBio = input.bio.trim();
    instUpdate.bio = cleanBio.length > 0 ? cleanBio : null;
  }

  const { error: instErr } = await client
    .from('instructors')
    .update(instUpdate)
    .eq('id', input.instructorId).eq('profile_id',input.profileId).select('id').single();
  if (instErr) throw new Error(instErr.message);

  const profUpdate: {
    is_active: boolean;
    full_name_en?: string;
    full_name_ar?: string;
    username?: string;
    phone?: string | null;
  } = {
    is_active: input.isActive,
  };
  if (input.username !== undefined) profUpdate.username = input.username;
  if (input.fullNameEn !== undefined && input.fullNameEn.trim().length >= 2) {
    profUpdate.full_name_en = input.fullNameEn.trim();
  }
  if (input.fullNameAr !== undefined && input.fullNameAr.trim().length >= 2) {
    profUpdate.full_name_ar = input.fullNameAr.trim();
  }
  if (input.phone !== undefined) {
    const cleanPhone = input.phone.trim();
    profUpdate.phone = cleanPhone.length > 0 ? cleanPhone : null;
  }

  const { error: profErr } = await client
    .from('profiles')
    .update(profUpdate)
    .eq('id', input.profileId).eq('role','instructor').select('id').single();
  if (profErr) throw new Error(profErr.message);

  if (input.campId && typeof input.assignedToCamp === 'boolean') {
    const { error: ciErr } = await client.from('camp_instructors').upsert(
      {
        camp_id: input.campId,
        instructor_id: input.instructorId,
        is_active: input.assignedToCamp,
      },
      { onConflict: 'camp_id,instructor_id' }
    );
    if (ciErr) throw new Error(ciErr.message);
  }
}

function resolveSafeClientRedirectOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      const parsed = new URL(window.location.origin);
      if (
        parsed.protocol === 'https:' ||
        (import.meta.env.DEV &&
          parsed.protocol === 'http:' &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
      ) {
        return parsed.origin;
      }
    } catch {
      // Fallback below
    }
  }
  return DEFAULT_PRODUCTION_ORIGINS[0];
}

export async function provisionInstructorViaEdgeFunction(
  input: ProvisionInstructorInput
): Promise<ProvisionInstructorOutcome> {
  const client = getClient();
  const redirectTo = resolveSafeClientRedirectOrigin();

  const { data, error } = await client.functions.invoke('provision-instructor', {
    body: {
      fullNameEn: input.fullNameEn,
      fullNameAr: input.fullNameAr,
      email: input.email,
      username: input.username,
      instructorCode: input.instructorCode,
      specialization: input.specialization,
      phone: input.phone,
      defaultLectureRateEgp: input.defaultLectureRateEgp,
      bio: input.bio,
      isActive: input.isActive,
      assignToCampId: input.assignToCampId || null,
      deliveryMode: input.deliveryMode,
      temporaryPassword:
        input.deliveryMode === 'temporary_password' && input.temporaryPassword
          ? input.temporaryPassword
          : undefined,
      redirectTo,
    },
  });

  if (error) {
    let parsedErr: { error?: string; fieldErrors?: Record<string, string>; statusCode?: number } | null = null;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        parsedErr = (await ctx.json()) as {
          error?: string;
          fieldErrors?: Record<string, string>;
          statusCode?: number;
        };
      }
    } catch {
      parsedErr = null;
    }

    const status =
      (error as unknown as { context?: Response }).context?.status || 500;
    const normalizedStatus: 400 | 401 | 403 | 409 | 429 | 500 =
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 409 ||
      status === 429
        ? status
        : 500;

    return {
      ok: false,
      statusCode: normalizedStatus,
      error:
        parsedErr?.error ||
        error.message ||
        'Unable to reach the provision-instructor Edge Function.',
      fieldErrors: parsedErr?.fieldErrors as ProvisionInstructorOutcome extends {
        fieldErrors?: infer F;
      }
        ? F
        : undefined,
    };
  }

  if (!data || typeof data !== 'object' || !(data as { ok?: boolean }).ok) {
    const payload = (data || {}) as {
      error?: string;
      fieldErrors?: Record<string, string>;
    };
    return {
      ok: false,
      statusCode: 500,
      error: payload.error || 'Provisioning returned an unexpected response.',
      fieldErrors: payload.fieldErrors,
    };
  }

  return data as ProvisionInstructorOutcome;
}

export async function manageInstructorRemovalInDb(instructorId: string, action: 'archive'|'restore'|'delete'): Promise<void> {
  const {error}=await getClient().rpc('manage_instructor_removal_tx',{p_instructor_id:instructorId,p_action:action});
  if(error)throw new Error(error.message);
}

export async function updateInstructorCredentialInDb(input: {
  instructorId: string; action:'email'|'temporary_credential'; value:string;
}): Promise<void> {
  const {data,error}=await getClient().functions.invoke('manage-instructor-credential',{body:input});
  if(error){
    let message=error.message;
    try { const ctx=(error as unknown as {context?:Response}).context; if(ctx) message=(await ctx.json()).error || message; } catch {}
    throw new Error(message);
  }
  if(!data?.ok)throw new Error(data?.error||'Credential update did not complete.');
}

export async function markProfileMustChangePassword(profileId: string): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', profileId);
  if (error) {
    throw new Error(error.message || 'Unable to enforce mandatory password rotation.');
  }
}

export async function sendInstructorPasswordResetEmail(email: string): Promise<void> {
  const client = getClient();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Instructor email is required to send a password reset link.');
  }
  const redirectTo = resolveSafeClientRedirectOrigin();
  const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
  });
  if (error) {
    throw new Error(error.message || 'Unable to send password recovery email.');
  }
}

export interface VisitingStudentLookupResult {
  studentId: string;
  studentCode: string;
  fullName: string;
  homeGroupId: string;
  homeGroupCode: string;
}

/**
 * Returns only minimal same-Camp visiting roster identity for an Instructor
 * assigned to the selected lecture. Requires migration 0013 on Supabase;
 * never broaden regular students SELECT RLS.
 */
export async function searchVisitingStudentsInDb(input: {
  lectureId: string;
  query: string;
}): Promise<VisitingStudentLookupResult[]> {
  const query = input.query.trim();
  if (query.length < 2 || query.length > 64) return [];
  const client = getClient();
  const { data, error } = await client.rpc('search_visiting_students_for_lecture', {
    p_lecture_id: input.lectureId,
    p_query: query,
  });
  if (error) throw new Error(error.message);
  return (data || []).map((row: {
    student_id: string;
    student_code: string;
    full_name: string;
    home_group_id: string;
    home_group_code: string;
  }) => ({
    studentId: row.student_id,
    studentCode: row.student_code,
    fullName: row.full_name,
    homeGroupId: row.home_group_id,
    homeGroupCode: row.home_group_code,
  }));
}

/** Instructor-only audited creation of a new student for an assigned group.
 *  Group, join day, timestamp and actor are verified/derived by the DB RPC.
 */
export async function instructorEnrollMidcampStudentInDb(input: {
  groupId: string;
  studentCode: string;
  fullName: string;
  university: string;
  reason: string;
}): Promise<string> {
  const client = getClient();
  const { data, error } = await client.rpc('instructor_enroll_midcamp_student_tx', {
    p_group_id: input.groupId,
    p_student_code: input.studentCode.trim(),
    p_full_name: input.fullName.trim(),
    p_university: input.university.trim(),
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) throw new Error('Student enrollment returned no student ID.');
  return data;
}

export async function createStudentInDb(input: {
  campId: string;
  groupId: string;
  studentCode: string;
  fullName: string;
  university: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.from('students').insert({
    camp_id: input.campId,
    group_id: input.groupId,
    student_code: input.studentCode.trim(),
    full_name: input.fullName.trim(),
    university: input.university.trim() || 'Unknown University',
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function batchImportStudentsInDb(input: {
  campId: string;
  groupId: string;
  mode: 'smart_update' | 'strict_insert';
  rows: { studentName: string; studentCode: string; university?: string }[];
}): Promise<{ inserted: number; updated: number }> {
  const client = getClient();
  const { data, error } = await client.rpc('batch_import_students_tx', {
    p_camp_id: input.campId,
    p_group_id: input.groupId,
    p_mode: input.mode,
    p_rows: input.rows as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { inserted: number; updated: number };
}

export async function transferStudentInDb(input: {
  campId: string;
  studentId: string;
  toGroupId: string;
  effectiveCampDay: number;
  reason: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.rpc('transfer_student_tx', {
    p_camp_id: input.campId,
    p_student_id: input.studentId,
    p_to_group_id: input.toGroupId,
    p_effective_camp_day: input.effectiveCampDay,
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function createLectureInDb(input: {
  campId: string;
  campDay: number;
  lectureDate: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  durationHours: number;
  groupId: string;
  instructorId: string;
  roomId: string;
  topic: string;
  frozenRateEgp: number;
}): Promise<void> {
  const client = getClient();
  const { data: lecRow, error: lecErr } = await client
    .from('lectures')
    .insert({
      camp_id: input.campId,
      camp_day: input.campDay,
      lecture_date: input.lectureDate,
      period_number: input.periodNumber,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_hours: input.durationHours,
      group_id: input.groupId,
      instructor_id: input.instructorId,
      room_id: input.roomId,
      topic: input.topic.trim(),
      status: 'scheduled',
      frozen_rate_egp: input.frozenRateEgp,
    })
    .select('id')
    .single();
  if (lecErr || !lecRow) throw new Error(lecErr?.message || 'Failed scheduling lecture.');

  // Provision initial draft sheet so instructor and admin see it ready immediately
  const { error: sheetErr } = await client.from('attendance_sheets').insert({
    camp_id: input.campId,
    lecture_id: lecRow.id,
    instructor_id: input.instructorId,
    status: 'draft',
    sync_state: 'Offline',
    idempotency_key: `idem-${input.campId}-${lecRow.id}`,
  });
  if (sheetErr) throw new Error(sheetErr.message);
}

export async function updateLectureInDb(input: {
  lectureId: string;
  substituteInstructorId?: string | null;
  roomId?: string;
  topic?: string;
  status?: DbLectureStatus;
}): Promise<void> {
  const client = getClient();
  const payload: {
    substitute_instructor_id?: string | null;
    room_id?: string;
    topic?: string;
    status?: DbLectureStatus;
  } = {};
  if ('substituteInstructorId' in input) {
    payload.substitute_instructor_id = input.substituteInstructorId || null;
  }
  if (input.roomId) payload.room_id = input.roomId;
  if (input.topic !== undefined) payload.topic = input.topic.trim();
  if (input.status) payload.status = input.status;

  const { error } = await client
    .from('lectures')
    .update(payload)
    .eq('id', input.lectureId);
  if (error) throw new Error(error.message);
}

export async function runLectureSessionInDb(lectureId:string):Promise<void> {
  const {error}=await getClient().rpc('run_lecture_session_tx',{p_lecture_id:lectureId});
  if(error)throw new Error(error.message);
}

export async function acknowledgeLectureInDb(lectureId: string): Promise<void> {
  const client = getClient();
  const { error } = await client.rpc('acknowledge_lecture_tx', {
    p_lecture_id: lectureId,
  });
  if (error) throw new Error(error.message);
}

export async function submitDailyCheckinInDb(input: {
  campId: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  selfieStoragePath: string;
  selfieSizeKb: number;
  exceptionReason?: string | null;
}): Promise<{
  checkin_id: string;
  camp_day: number;
  distance_from_venue_meters: number;
  within_geofence: boolean;
  arrived_late_first_lecture: boolean;
  minutes_after_first_lecture: number;
  status: CheckinStatus;
}> {
  const client = getClient();
  const { data, error } = await client.rpc('submit_daily_checkin_tx', {
    p_camp_id: input.campId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_gps_accuracy_meters: input.gpsAccuracyMeters,
    p_selfie_storage_path: input.selfieStoragePath,
    p_selfie_size_kb: input.selfieSizeKb,
    p_exception_reason: input.exceptionReason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    checkin_id: string;
    camp_day: number;
    distance_from_venue_meters: number;
    within_geofence: boolean;
    arrived_late_first_lecture: boolean;
    minutes_after_first_lecture: number;
    status: CheckinStatus;
  };
}

export async function reviewCheckinExceptionInDb(input: {
  exceptionId: string;
  decision: 'approved' | 'rejected';
  reviewNote: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.rpc('review_checkin_exception_tx', {
    p_exception_id: input.exceptionId,
    p_decision: input.decision as DbRequestStatus,
    p_review_note: input.reviewNote.trim(),
  });
  if (error) throw new Error(error.message);
}

/** Server-serialized draft CAS: no direct attendance-record upsert on this path. */
export async function saveAttendanceDraftAtomicallyInDb(input: {
  sheetId: string;
  expected: AttendanceRecordItem[];
  desired: AttendanceRecordItem[];
  submit?: boolean;
}): Promise<void> {
  const toPayload = (rows: AttendanceRecordItem[]) =>
    rows.filter(r => r.mark !== 'unmarked').map(r => ({
      studentId: r.studentId,
      mark: r.mark,
      originGroupId: r.originGroupId,
      attendedGroupId: r.attendedGroupId,
      isCrossGroup: r.isCrossGroup,
      note: r.note || '',
    }));
  const { error } = await getClient().rpc('save_attendance_draft_cas_tx', {
    p_sheet_id: input.sheetId,
    p_expected: toPayload(input.expected),
    p_desired: toPayload(input.desired),
    p_submit: input.submit || false,
  });
  if (error) throw new Error(error.message);
}

export async function submitAttendanceSheetInDb(sheetId: string): Promise<void> {
  const client = getClient();
  const { error } = await client.rpc('submit_attendance_sheet_tx', {
    p_sheet_id: sheetId,
  });
  if (error) throw new Error(error.message);
}

export async function adminCorrectAttendanceRecordInDb(input: {
  campId: string;
  sheet: AttendanceSheet;
  lecture: Lecture;
  student: Student;
  transfers?: StudentTransfer[];
  mark: AttendanceMark;
  note?: string;
  adminProfileId: string;
}): Promise<void> {
  const client = getClient();
  const cleanNote = (input.note || '').trim();
  if (!cleanNote) {
    throw new Error('A non-empty audit reason is required to correct student attendance.');
  }

  const { error } = await client.rpc('admin_correct_attendance_tx', {
    p_sheet_id: input.sheet.id,
    p_student_id: input.student.id,
    p_mark: input.mark as DbAttendanceMark,
    p_note: cleanNote,
  });
  if (error) throw new Error(error.message);
}

export async function instructorCorrectSubmittedAttendanceInDb(input: {
  sheetId: string; studentId: string; mark: AttendanceMark; expectedMark: AttendanceMark; note: string;
}): Promise<void> {
  const { error } = await getClient().rpc('instructor_correct_submitted_attendance_tx', {
    p_sheet_id: input.sheetId, p_student_id: input.studentId,
    p_mark: input.mark as DbAttendanceMark, p_expected_mark: input.expectedMark as DbAttendanceMark,
    p_note: input.note.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function overrideEntitlementInDb(input: {
  entitlementId: string;
  decision: 'approved' | 'excluded';
  reason: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.rpc('admin_override_entitlement_tx', {
    p_entitlement_id: input.entitlementId,
    p_decision: input.decision as DbEntitlementStatus,
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function submitInstructorRequestInDb(input: {
  campId: string;
  instructorId: string;
  requestType: InstructorRequestItem['requestType'];
  subject: string;
  details: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.from('instructor_requests').insert({
    camp_id: input.campId,
    instructor_id: input.instructorId,
    request_type: input.requestType,
    subject: input.subject.trim(),
    details: input.details.trim(),
    status: 'pending',
  });
  if (error) throw new Error(error.message);
}

export async function reviewInstructorRequestInDb(input: {
  requestId: string;
  status: RequestStatus.APPROVED | RequestStatus.REJECTED;
  reviewNote: string;
  reviewerProfileId: string;
  recipientProfileId?: string;
  subject: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('instructor_requests')
    .update({
      status: input.status as DbRequestStatus,
      reviewed_by: input.reviewerProfileId,
      review_note: input.reviewNote.trim(),
    })
    .eq('id', input.requestId);
  if (error) throw new Error(error.message);

  if (input.recipientProfileId) {
    const { error: notifErr } = await client.from('notifications').insert({
      recipient_profile_id: input.recipientProfileId,
      title_en: `Request ${input.status === RequestStatus.APPROVED ? 'Approved' : 'Rejected'}`,
      title_ar: input.status === RequestStatus.APPROVED ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب',
      body_en: `${input.subject}: ${input.reviewNote}`,
      body_ar: `${input.subject}: ${input.reviewNote}`,
    });
    if (notifErr) throw new Error(notifErr.message);
  }
}

export async function createIssueInDb(input: {
  campId: string;
  reportedBy: string;
  roomId: string;
  category: string;
  title: string;
  description: string;
  severity: IssueSeverity;
}): Promise<void> {
  const client = getClient();
  const { error } = await client.from('issues').insert({
    camp_id: input.campId,
    reported_by: input.reportedBy,
    room_id: input.roomId || null,
    category: input.category,
    title: input.title.trim(),
    description: input.description.trim(),
    severity: input.severity as DbIssueSeverity,
    status: 'open',
  });
  if (error) throw new Error(error.message);
}

export async function resolveIssueInDb(input: {
  issueId: string;
  resolvedBy: string;
  resolutionNote?: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('issues')
    .update({
      status: 'resolved' as DbIssueStatus,
      resolved_by: input.resolvedBy,
      resolution_note: input.resolutionNote || 'Resolved by Operations',
    })
    .eq('id', input.issueId);
  if (error) throw new Error(error.message);
}

export async function toggleChecklistInDb(input: {
  checklistId: string;
  nextCompleted: boolean;
  completedBy: string;
}): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('daily_checklists')
    .update({
      is_completed: input.nextCompleted,
      completed_by: input.nextCompleted ? input.completedBy : null,
      completed_at: input.nextCompleted ? new Date().toISOString() : null,
    })
    .eq('id', input.checklistId);
  if (error) throw new Error(error.message);
}

export async function markNotificationReadInDb(notificationId: string): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  if (error) throw new Error(error.message);
}

export async function recordBackupExportInDb(input: {
  campId: string | null;
  createdBy: string;
  actorName: string;
  jsonString: string;
}): Promise<string> {
  const client = getClient();
  const bytes = new TextEncoder().encode(input.jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const sizeKb = Math.max(1, Math.ceil(bytes.byteLength / 1024));
  const { data: backupRow, error } = await client
    .from('backup_records')
    .insert({
      camp_id: input.campId,
      created_by: input.createdBy,
      backup_type: 'full_json_export',
      size_kb: sizeKb,
      checksum_sha256: checksum,
      notes: 'Admin JSON operational snapshot export',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const { error: auditErr } = await client.from('audit_logs').insert({
    actor_profile_id: input.createdBy,
    actor_name: input.actorName,
    actor_role: 'admin',
    camp_id: input.campId,
    action: 'BACKUP_JSON_EXPORTED',
    entity_type: 'backup_records',
    entity_id: backupRow?.id || input.campId || 'global',
    previous_value: null,
    new_value: { size_kb: sizeKb, checksum_sha256: checksum },
    reason: 'Admin exported operational JSON backup',
  });
  if (auditErr) throw new Error(auditErr.message);

  return checksum;
}
