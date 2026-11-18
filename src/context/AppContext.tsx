import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AdminAccount,
  AdminRouteId,
  AppNotification,
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheet,
  AttendanceSheetStatus,
  AuditLogEntry,
  Camp,
  CampStatus,
  CheckinExceptionItem,
  CheckinStatus,
  DailyCheckin,
  DailyChecklistItem,
  DbLectureStatus,
  EntitlementStatus,
  Group,
  Instructor,
  InstructorRequestItem,
  InstructorRouteId,
  IssueSeverity,
  IssueStatus,
  Lecture,
  LectureEntitlement,
  LectureStatus,
  OfflineSyncState,
  OperationalIssue,
  Profile,
  RequestStatus,
  Room,
  Student,
  StudentTransfer,
  SurveyLinkItem,
  UserRole,
  Venue,
} from '../types/database';
import {
  INITIAL_ADMIN_ACCOUNTS,
  INITIAL_ATTENDANCE_SHEETS,
  INITIAL_AUDIT_LOGS,
  INITIAL_CAMPS,
  INITIAL_CHECKINS,
  INITIAL_CHECKLISTS,
  INITIAL_ENTITLEMENTS,
  INITIAL_GROUPS,
  INITIAL_INSTRUCTORS,
  INITIAL_ISSUES,
  INITIAL_LECTURES,
  INITIAL_PROFILES,
  INITIAL_REQUESTS,
  INITIAL_ROOMS,
  INITIAL_STUDENTS,
  INITIAL_SURVEYS,
  INITIAL_VENUES,
} from '../services/seedData';
import {
  calculateCampDayDate,
  createValidatedAuditLogEntry,
  evaluateDailyCheckin,
  evaluateLectureEntitlement,
  finalizeAttendanceSubmission,
  RawStudentImportRow,
  resolveStudentOriginGroupForDay,
  validateCampActivation,
  validateCampNotArchived,
  validateLectureScheduleSlot,
  validateStudentBatchImport,
} from '../domain/businessRules';
import {
  deleteOfflineAttendanceDraft,
  getOfflineAttendanceDraft,
  saveOfflineAttendanceDraft,
} from '../services/offlineDraftDB';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  acknowledgeLectureInDb,
  adminCorrectAttendanceRecordInDb,
  archiveCampInDb,
  activateCampInDb,
  batchImportStudentsInDb,
  completeUserPasswordChange,
  createDraftCampInDb,
  createIssueInDb,
  createLectureInDb,
  createStudentInDb,
  enrollAdminTotpFactor,
  fetchOperationalSnapshot,
  loadAuthenticatedUserContext,
  markNotificationReadInDb,
  overrideEntitlementInDb,
  recordBackupExportInDb,
  resolveAndSignInWithSupabase,
  resolveIssueInDb,
  reviewCheckinExceptionInDb,
  reviewInstructorRequestInDb,
  saveAttendanceRecordsDraftToDb,
  signOutSupabase,
  submitAttendanceSheetInDb,
  submitDailyCheckinInDb,
  submitInstructorRequestInDb,
  SupabaseAuthContext,
  toggleChecklistInDb,
  transferStudentInDb,
  updateCampInDb,
  updateInstructorInDb,
  updateLectureInDb,
  uploadCheckinSelfie,
  upsertGroupInDb,
  verifyAdminTotpCode,
} from '../services/citsRepository';

export type Language = 'en' | 'ar';
export type ThemeMode = 'dark' | 'light';

interface MfaEnrollmentState {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

interface AuthFlowState {
  isAuthenticated: boolean;
  pendingTotpProfileId: string | null;
  pendingPasswordChangeProfileId: string | null;
  currentProfile: Profile;
  activeInstructorId: string;
  mfaFactorId: string | null;
  mfaNeedsEnrollment: boolean;
  mfaEnrollment: MfaEnrollmentState | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

interface AppContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  t: (en: string, ar: string) => string;

  // Connection & Loading Status
  isSupabaseMode: boolean;
  isInitializingSession: boolean;
  isLoadingData: boolean;
  dataError: string | null;
  refreshOperationalData: () => Promise<void>;

  // Auth & Navigation
  auth: AuthFlowState;
  loginWithCredentials: (
    identifier: string,
    password: string
  ) => Promise<{ ok: boolean; step?: 'totp' | 'password_change' | 'done'; error?: string }>;
  setupAdminTotpEnrollment: () => Promise<{ ok: boolean; error?: string }>;
  verifyAdminTotp: (code: string) => Promise<{ ok: boolean; error?: string }>;
  completeFirstLoginPasswordChange: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  switchDemoIdentity: (role: UserRole, instructorId?: string) => void;

  adminRoute: AdminRouteId;
  setAdminRoute: (r: AdminRouteId) => void;
  instructorRoute: InstructorRouteId;
  setInstructorRoute: (r: InstructorRouteId) => void;
  isArchitectureDrawerOpen: boolean;
  setArchitectureDrawerOpen: (open: boolean) => void;

  // Normalized Entities
  profiles: Profile[];
  adminAccounts: AdminAccount[];
  instructors: Instructor[];
  venues: Venue[];
  rooms: Room[];
  camps: Camp[];
  activeCamp: Camp | null;
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

  // Actions (All async-ready for real PostgreSQL/RPC persistence)
  createDraftCamp: (input: {
    code: string;
    nameEn: string;
    nameAr: string;
    venueId?: string;
    startDate: string;
    durationDays: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
  }) => Promise<ActionResult>;
  updateCampAndSettings: (input: {
    campId: string;
    nameEn: string;
    nameAr: string;
    startDate: string;
    durationDays: number;
    currentCampDay: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
    maxInstructorGroupsPerDay: number;
  }) => Promise<ActionResult>;
  activateCamp: (campId: string) => Promise<ActionResult>;
  archiveCamp: (campId: string) => Promise<ActionResult>;

  upsertGroup: (input: {
    id?: string;
    code: string;
    nameEn: string;
    nameAr: string;
    track: string;
    defaultRoomId: string;
    primaryInstructorId: string;
    capacity: number;
  }) => Promise<ActionResult>;

  updateInstructorAccount: (input: {
    instructorId: string;
    profileId: string;
    specialization: string;
    defaultLectureRateEgp: number;
    isActive: boolean;
    assignedToActiveCamp: boolean;
  }) => Promise<ActionResult>;

  createSingleStudent: (input: {
    groupId: string;
    studentCode: string;
    fullName: string;
    university: string;
  }) => Promise<ActionResult>;

  transferStudent: (input: {
    studentId: string;
    toGroupId: string;
    effectiveCampDay: number;
    reason: string;
  }) => Promise<ActionResult>;

  addScheduleLecture: (input: {
    campDay: number;
    periodNumber: number;
    groupId: string;
    instructorId: string;
    roomId: string;
    topic: string;
  }) => Promise<{ ok: boolean; errors?: string[] }>;

  updateScheduleLecture: (input: {
    lectureId: string;
    substituteInstructorId?: string | null;
    roomId?: string;
    topic?: string;
    status?: LectureStatus;
  }) => Promise<ActionResult>;

  acknowledgeLecture: (lectureId: string) => Promise<ActionResult>;

  submitInstructorCheckin: (input: {
    instructorId: string;
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    selfieSizeKb: number;
    selfieBlob?: Blob;
    selfieExt?: 'webp' | 'jpg';
    selfieMimeType?: string;
    checkinTimeHHMM: string;
    exceptionReason?: string;
  }) => Promise<{ ok: boolean; message: string; status: CheckinStatus }>;

  reviewCheckinException: (input: {
    exceptionId: string;
    decision: 'approved' | 'rejected';
    reviewNote: string;
  }) => Promise<ActionResult>;

  saveAttendanceDraft: (
    lectureId: string,
    records: AttendanceRecordItem[],
    simulateOffline: boolean
  ) => Promise<ActionResult>;

  submitAndSyncAttendanceSheet: (lectureId: string) => Promise<ActionResult>;

  adminCorrectAttendanceRecord: (input: {
    sheetId: string;
    lectureId: string;
    studentId: string;
    mark: AttendanceMark;
    note?: string;
  }) => Promise<ActionResult>;

  reviewLectureEntitlement: (
    entitlementId: string,
    decision: 'approved' | 'excluded',
    reason: string
  ) => Promise<ActionResult>;

  reviewInstructorRequest: (
    requestId: string,
    decision: RequestStatus.APPROVED | RequestStatus.REJECTED,
    note: string
  ) => Promise<ActionResult>;

  submitInstructorRequest: (input: {
    requestType: InstructorRequestItem['requestType'];
    subject: string;
    details: string;
  }) => Promise<ActionResult>;

  importStudentsBatch: (
    rows: RawStudentImportRow[],
    groupId: string,
    mode: 'strict_insert' | 'smart_update'
  ) => Promise<{
    ok: boolean;
    errors: { rowNumber: number; message: string }[];
    inserted: number;
    updated: number;
  }>;

  toggleChecklistItem: (itemId: string) => Promise<ActionResult>;
  createOperationalIssue: (input: {
    roomId: string;
    category: string;
    title: string;
    description: string;
    severity: IssueSeverity;
  }) => Promise<ActionResult>;
  resolveOperationalIssue: (issueId: string) => Promise<ActionResult>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  exportBackupSnapshot: () => Promise<{ ok: boolean; filename?: string; checksum?: string; error?: string }>;
}

const GUEST_PLACEHOLDER_PROFILE: Profile = {
  id: 'unauthenticated',
  role: UserRole.INSTRUCTOR,
  username: 'guest',
  email: '',
  fullNameEn: 'Not Signed In',
  fullNameAr: 'غير مسجل',
  phone: '',
  mustChangePassword: false,
  isActive: false,
  createdAt: new Date().toISOString(),
};

const DEFAULT_PERIOD_SLOTS = [
  { period: 1, start: '09:00', end: '12:00' },
  { period: 2, start: '12:00', end: '15:00' },
  { period: 3, start: '15:00', end: '18:00' },
  { period: 4, start: '18:00', end: '21:00' },
];

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isSupabaseMode = isSupabaseConfigured;

  const [lang, setLangState] = useState<Language>('en');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [isInitializingSession, setIsInitializingSession] = useState<boolean>(isSupabaseMode);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [supabaseCtx, setSupabaseCtx] = useState<SupabaseAuthContext | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>(isSupabaseMode ? [] : INITIAL_PROFILES);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(
    isSupabaseMode ? [] : INITIAL_ADMIN_ACCOUNTS
  );
  const [instructors, setInstructors] = useState<Instructor[]>(
    isSupabaseMode ? [] : INITIAL_INSTRUCTORS
  );
  const [venues, setVenues] = useState<Venue[]>(isSupabaseMode ? [] : INITIAL_VENUES);
  const [rooms, setRooms] = useState<Room[]>(isSupabaseMode ? [] : INITIAL_ROOMS);
  const [camps, setCamps] = useState<Camp[]>(isSupabaseMode ? [] : INITIAL_CAMPS);
  const [campInstructorIds, setCampInstructorIds] = useState<Record<string, string[]>>(
    isSupabaseMode
      ? {}
      : { 'camp-2026-spring': INITIAL_INSTRUCTORS.map((i) => i.id) }
  );
  const [groups, setGroups] = useState<Group[]>(isSupabaseMode ? [] : INITIAL_GROUPS);
  const [students, setStudents] = useState<Student[]>(isSupabaseMode ? [] : INITIAL_STUDENTS);
  const [studentTransfers, setStudentTransfers] = useState<StudentTransfer[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>(isSupabaseMode ? [] : INITIAL_LECTURES);
  const [checkins, setCheckins] = useState<DailyCheckin[]>(isSupabaseMode ? [] : INITIAL_CHECKINS);
  const [checkinExceptions, setCheckinExceptions] = useState<CheckinExceptionItem[]>([]);
  const [attendanceSheets, setAttendanceSheets] = useState<AttendanceSheet[]>(
    isSupabaseMode ? [] : INITIAL_ATTENDANCE_SHEETS
  );
  const [entitlements, setEntitlements] = useState<LectureEntitlement[]>(
    isSupabaseMode ? [] : INITIAL_ENTITLEMENTS
  );
  const [requests, setRequests] = useState<InstructorRequestItem[]>(
    isSupabaseMode ? [] : INITIAL_REQUESTS
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [issues, setIssues] = useState<OperationalIssue[]>(
    isSupabaseMode ? [] : INITIAL_ISSUES
  );
  const [checklists, setChecklists] = useState<DailyChecklistItem[]>(
    isSupabaseMode ? [] : INITIAL_CHECKLISTS
  );
  const [surveys, setSurveys] = useState<SurveyLinkItem[]>(
    isSupabaseMode ? [] : INITIAL_SURVEYS
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(
    isSupabaseMode ? [] : INITIAL_AUDIT_LOGS
  );

  const [auth, setAuth] = useState<AuthFlowState>({
    isAuthenticated: !isSupabaseMode,
    pendingTotpProfileId: null,
    pendingPasswordChangeProfileId: null,
    currentProfile: isSupabaseMode ? GUEST_PLACEHOLDER_PROFILE : INITIAL_PROFILES[0],
    activeInstructorId: isSupabaseMode ? '' : 'inst-1',
    mfaFactorId: null,
    mfaNeedsEnrollment: false,
    mfaEnrollment: null,
  });

  const [adminRoute, setAdminRoute] = useState<AdminRouteId>('dashboard');
  const [instructorRoute, setInstructorRoute] = useState<InstructorRouteId>('dashboard');
  const [isArchitectureDrawerOpen, setArchitectureDrawerOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const setLang = (l: Language) => setLangState(l);
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  const activeCamp: Camp | null =
    camps.find((c) => c.status === CampStatus.ACTIVE) || camps[0] || null;

  const hydrateFromSnapshot = useCallback(async (ctx: SupabaseAuthContext) => {
    setIsLoadingData(true);
    setDataError(null);
    try {
      const snap = await fetchOperationalSnapshot(ctx);

      // Merge any unsynced local IndexedDB drafts over draft sheets so offline marks persist cleanly
      const mergedSheets = await Promise.all(
        snap.attendanceSheets.map(async (sheet) => {
          if (sheet.status !== AttendanceSheetStatus.DRAFT) return sheet;
          const localDraft = await getOfflineAttendanceDraft(sheet.lectureId);
          if (localDraft && localDraft.records.length > 0) {
            return {
              ...sheet,
              syncState: localDraft.syncState,
              records: localDraft.records,
            };
          }
          return sheet;
        })
      );

      setProfiles(snap.profiles);
      setAdminAccounts(snap.adminAccounts);
      setInstructors(snap.instructors);
      setVenues(snap.venues);
      setRooms(snap.rooms);
      setCamps(snap.camps);
      setCampInstructorIds(snap.campInstructorIds);
      setGroups(snap.groups);
      setStudents(snap.students);
      setStudentTransfers(snap.studentTransfers);
      setLectures(snap.lectures);
      setCheckins(snap.checkins);
      setCheckinExceptions(snap.checkinExceptions);
      setAttendanceSheets(mergedSheets);
      setEntitlements(snap.entitlements);
      setRequests(snap.requests);
      setNotifications(snap.notifications);
      setIssues(snap.issues);
      setChecklists(snap.checklists);
      setSurveys(snap.surveys);
      setAuditLogs(snap.auditLogs);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed loading operational data.');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const applySupabaseAuthContext = useCallback(
    async (ctx: SupabaseAuthContext) => {
      setSupabaseCtx(ctx);

      if (ctx.profile.role === UserRole.ADMIN) {
        if (ctx.mfa.needsEnrollment || ctx.mfa.needsChallenge) {
          let enrollmentData: MfaEnrollmentState | null = null;
          if (ctx.mfa.needsEnrollment) {
            try {
              enrollmentData = await enrollAdminTotpFactor();
            } catch (err) {
              setDataError(err instanceof Error ? err.message : 'MFA enrollment init failed.');
            }
          }
          setAuth({
            isAuthenticated: false,
            pendingTotpProfileId: ctx.profile.id,
            pendingPasswordChangeProfileId: null,
            currentProfile: ctx.profile,
            activeInstructorId: '',
            mfaFactorId: enrollmentData?.factorId || ctx.mfa.verifiedFactorId,
            mfaNeedsEnrollment: ctx.mfa.needsEnrollment,
            mfaEnrollment: enrollmentData,
          });
          return 'totp' as const;
        }
      }

      if (ctx.profile.mustChangePassword) {
        setAuth({
          isAuthenticated: false,
          pendingTotpProfileId: null,
          pendingPasswordChangeProfileId: ctx.profile.id,
          currentProfile: ctx.profile,
          activeInstructorId: ctx.instructor?.id || '',
          mfaFactorId: ctx.mfa.verifiedFactorId,
          mfaNeedsEnrollment: false,
          mfaEnrollment: null,
        });
        return 'password_change' as const;
      }

      setAuth({
        isAuthenticated: true,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: null,
        currentProfile: ctx.profile,
        activeInstructorId: ctx.instructor?.id || '',
        mfaFactorId: ctx.mfa.verifiedFactorId,
        mfaNeedsEnrollment: false,
        mfaEnrollment: null,
      });

      await hydrateFromSnapshot(ctx);
      return 'done' as const;
    },
    [hydrateFromSnapshot]
  );

  // Restore Supabase session on page mount and listen to auth state changes
  useEffect(() => {
    if (!isSupabaseMode || !supabase) return;
    const client = supabase;
    let mounted = true;

    const initSession = async () => {
      setIsInitializingSession(true);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!mounted) return;
        if (session?.user) {
          const ctx = await loadAuthenticatedUserContext(session.user.id);
          if (mounted) {
            await applySupabaseAuthContext(ctx);
          }
        }
      } catch (err) {
        if (mounted) {
          setDataError(err instanceof Error ? err.message : 'Session restoration failed.');
          setAuth((prev) => ({
            ...prev,
            isAuthenticated: false,
            pendingTotpProfileId: null,
            pendingPasswordChangeProfileId: null,
            currentProfile: GUEST_PLACEHOLDER_PROFILE,
          }));
        }
      } finally {
        if (mounted) setIsInitializingSession(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSupabaseCtx(null);
        setAuth({
          isAuthenticated: false,
          pendingTotpProfileId: null,
          pendingPasswordChangeProfileId: null,
          currentProfile: GUEST_PLACEHOLDER_PROFILE,
          activeInstructorId: '',
          mfaFactorId: null,
          mfaNeedsEnrollment: false,
          mfaEnrollment: null,
        });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isSupabaseMode, applySupabaseAuthContext]);

  const refreshOperationalData = useCallback(async () => {
    if (!isSupabaseMode || !supabaseCtx) return;
    await hydrateFromSnapshot(supabaseCtx);
  }, [isSupabaseMode, supabaseCtx, hydrateFromSnapshot]);

  const appendSandboxAudit = (
    action: string,
    entityType: string,
    entityId: string,
    previousValue: unknown,
    newValue: unknown,
    reason: string,
    campIdOverride?: string | null
  ) => {
    const validated = createValidatedAuditLogEntry({
      actorProfileId: auth.currentProfile.id,
      actorName: auth.currentProfile.fullNameEn,
      actorRole: auth.currentProfile.role,
      campId: campIdOverride !== undefined ? campIdOverride : activeCamp?.id || null,
      action,
      entityType,
      entityId,
      previousValue,
      newValue,
      reason,
    });
    if (validated.valid && validated.entry) {
      setAuditLogs((prev) => [validated.entry!, ...prev]);
    }
  };

  // ===========================================================================
  // AUTHENTICATION FLOW
  // ===========================================================================

  const loginWithCredentials = async (identifier: string, password: string) => {
    if (isSupabaseMode) {
      try {
        setDataError(null);
        const ctx = await resolveAndSignInWithSupabase(identifier, password);
        const step = await applySupabaseAuthContext(ctx);
        return { ok: true, step };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Authentication failed.',
        };
      }
    }

    // Local Sandbox Auth
    const cleanId = identifier.trim().toLowerCase();
    if (!cleanId || !password.trim()) {
      return {
        ok: false,
        error: t(
          'Please enter both your username/email and password.',
          'يرجى إدخال اسم المستخدم أو البريد الإلكتروني وكلمة المرور.'
        ),
      };
    }
    if (password.trim().length < 6) {
      return {
        ok: false,
        error: t(
          'Invalid credentials. Password must be at least 6 characters.',
          'بيانات الدخول غير صحيحة. يجب ألا تقل كلمة المرور عن 6 أحرف.'
        ),
      };
    }

    const matchedProfile = profiles.find(
      (p) =>
        p.isActive &&
        (p.username.toLowerCase() === cleanId || p.email.toLowerCase() === cleanId)
    );

    if (!matchedProfile) {
      return {
        ok: false,
        error: t(
          'No active CITS account matches that username or email.',
          'لا يوجد حساب نشط يطابق اسم المستخدم أو البريد المدخل.'
        ),
      };
    }

    if (matchedProfile.role === UserRole.ADMIN) {
      setAuth((prev) => ({
        ...prev,
        isAuthenticated: false,
        pendingTotpProfileId: matchedProfile.id,
        pendingPasswordChangeProfileId: null,
        currentProfile: matchedProfile,
        mfaFactorId: null,
        mfaNeedsEnrollment: false,
        mfaEnrollment: null,
      }));
      return { ok: true, step: 'totp' as const };
    }

    const inst = instructors.find((i) => i.profileId === matchedProfile.id);

    if (matchedProfile.mustChangePassword) {
      setAuth((prev) => ({
        ...prev,
        isAuthenticated: false,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: matchedProfile.id,
        currentProfile: matchedProfile,
        activeInstructorId: inst ? inst.id : prev.activeInstructorId,
      }));
      return { ok: true, step: 'password_change' as const };
    }

    setAuth({
      isAuthenticated: true,
      pendingTotpProfileId: null,
      pendingPasswordChangeProfileId: null,
      currentProfile: matchedProfile,
      activeInstructorId: inst ? inst.id : 'inst-1',
      mfaFactorId: null,
      mfaNeedsEnrollment: false,
      mfaEnrollment: null,
    });
    return { ok: true, step: 'done' as const };
  };

  const setupAdminTotpEnrollment = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isSupabaseMode) return { ok: true };
    try {
      const enrollData = await enrollAdminTotpFactor();
      setAuth((prev) => ({
        ...prev,
        mfaFactorId: enrollData.factorId,
        mfaNeedsEnrollment: true,
        mfaEnrollment: enrollData,
      }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'MFA enrollment error.' };
    }
  };

  const verifyAdminTotp = async (code: string) => {
    if (isSupabaseMode) {
      const factorId = auth.mfaFactorId || auth.mfaEnrollment?.factorId;
      if (!factorId) {
        return {
          ok: false,
          error: t(
            'No TOTP authenticator factor found. Generate an enrollment QR code first.',
            'لم يتم العثور على عامل مصادقة TOTP. قم بإنشاء رمز التسجيل أولاً.'
          ),
        };
      }
      try {
        await verifyAdminTotpCode(factorId, code);
        if (!supabase) throw new Error('Supabase client missing.');
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Session expired during MFA verification.');
        const ctx = await loadAuthenticatedUserContext(user.id);
        await applySupabaseAuthContext(ctx);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'TOTP verification failed.',
        };
      }
    }

    // Local Sandbox TOTP verification
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      return {
        ok: false,
        error: t(
          'Enter a valid 6-digit authenticator code (e.g., 482910).',
          'أدخل رمز مصادقة ثنائي مكون من 6 أرقام.'
        ),
      };
    }
    const profile =
      profiles.find((p) => p.id === auth.pendingTotpProfileId) || auth.currentProfile;

    if (profile.mustChangePassword) {
      setAuth((prev) => ({
        ...prev,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: profile.id,
      }));
      return { ok: true };
    }

    setAuth((prev) => ({
      ...prev,
      isAuthenticated: true,
      pendingTotpProfileId: null,
      pendingPasswordChangeProfileId: null,
      currentProfile: profile,
    }));
    appendSandboxAudit(
      'ADMIN_LOGIN_MFA',
      'admin_accounts',
      profile.id,
      null,
      { mfa: 'verified' },
      'TOTP MFA verified'
    );
    return { ok: true };
  };

  const completeFirstLoginPasswordChange = async (newPassword: string) => {
    if (newPassword.trim().length < 8) {
      return {
        ok: false,
        error: t(
          'New password must be at least 8 characters long.',
          'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.'
        ),
      };
    }

    if (isSupabaseMode) {
      try {
        await completeUserPasswordChange(newPassword);
        if (!supabase) throw new Error('Supabase client missing.');
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Session missing after password update.');
        const ctx = await loadAuthenticatedUserContext(user.id);
        await applySupabaseAuthContext(ctx);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Password update failed.',
        };
      }
    }

    const targetId = auth.pendingPasswordChangeProfileId || auth.currentProfile.id;
    setProfiles((prev) =>
      prev.map((p) => (p.id === targetId ? { ...p, mustChangePassword: false } : p))
    );
    const updatedProfile = { ...auth.currentProfile, mustChangePassword: false };
    setAuth((prev) => ({
      ...prev,
      isAuthenticated: true,
      pendingPasswordChangeProfileId: null,
      currentProfile: updatedProfile,
    }));
    appendSandboxAudit(
      'FIRST_LOGIN_PASSWORD_UPDATED',
      'profiles',
      targetId,
      { mustChangePassword: true },
      { mustChangePassword: false },
      'Mandatory first-login password change completed'
    );
    return { ok: true };
  };

  const signOut = async () => {
    if (isSupabaseMode) {
      await signOutSupabase();
      setSupabaseCtx(null);
    }
    setAuth((prev) => ({
      ...prev,
      isAuthenticated: false,
      pendingTotpProfileId: null,
      pendingPasswordChangeProfileId: null,
      mfaFactorId: null,
      mfaNeedsEnrollment: false,
      mfaEnrollment: null,
    }));
  };

  const switchDemoIdentity = (role: UserRole, instructorId?: string) => {
    // Strictly disabled in connected Supabase mode (real RBAC + RLS active)
    if (isSupabaseMode) return;

    if (role === UserRole.ADMIN) {
      const adminProf = profiles.find((p) => p.role === UserRole.ADMIN) || INITIAL_PROFILES[0];
      setAuth({
        isAuthenticated: true,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: null,
        currentProfile: adminProf,
        activeInstructorId: auth.activeInstructorId,
        mfaFactorId: null,
        mfaNeedsEnrollment: false,
        mfaEnrollment: null,
      });
    } else {
      const targetInstId = instructorId || auth.activeInstructorId || 'inst-1';
      const inst = instructors.find((i) => i.id === targetInstId) || instructors[0];
      const instProf =
        profiles.find((p) => p.id === inst?.profileId) || INITIAL_PROFILES[2];
      setAuth({
        isAuthenticated: true,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: null,
        currentProfile: { ...instProf, mustChangePassword: false },
        activeInstructorId: inst ? inst.id : 'inst-1',
        mfaFactorId: null,
        mfaNeedsEnrollment: false,
        mfaEnrollment: null,
      });
    }
  };

  // ===========================================================================
  // CAMP & ENTITY MUTATIONS
  // ===========================================================================

  const createDraftCamp = async (input: {
    code: string;
    nameEn: string;
    nameAr: string;
    venueId?: string;
    startDate: string;
    durationDays: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
  }): Promise<ActionResult> => {
    if (!input.code.trim() || !input.nameEn.trim() || !input.startDate) {
      return { ok: false, error: 'Camp code, English name, and start date are required.' };
    }
    const targetVenueId = input.venueId || venues[0]?.id;
    if (!targetVenueId) {
      return { ok: false, error: 'At least one venue is required before creating a camp.' };
    }

    const duration = Math.max(1, input.durationDays || 10);
    const endDateStr = calculateCampDayDate(input.startDate, duration);

    if (isSupabaseMode) {
      try {
        await createDraftCampInDb({
          code: input.code.toUpperCase(),
          nameEn: input.nameEn,
          nameAr: input.nameAr || input.nameEn,
          venueId: targetVenueId,
          startDate: input.startDate,
          endDate: endDateStr,
          durationDays: duration,
          geofenceRadiusMeters: input.geofenceRadiusMeters || 100,
          defaultRateEgp: Math.round(input.defaultRateEgp || 700),
          createdBy: auth.currentProfile.id,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed creating camp.' };
      }
    }

    const id = `camp-${Date.now()}`;
    const newCamp: Camp = {
      id,
      code: input.code.trim().toUpperCase(),
      nameEn: input.nameEn.trim(),
      nameAr: input.nameAr.trim() || input.nameEn.trim(),
      status: CampStatus.DRAFT,
      venueId: targetVenueId,
      startDate: input.startDate,
      endDate: endDateStr,
      durationDays: duration,
      currentCampDay: 1,
      settings: {
        campId: id,
        defaultLectureDurationHours: 3,
        maxInstructorGroupsPerDay: 4,
        geofenceRadiusMeters: input.geofenceRadiusMeters || 100,
        firstLectureLateThresholdMinutes: 60,
        maxSelfieKb: 300,
        defaultLectureRateEgp: Math.round(input.defaultRateEgp || 700),
        periodSlots: activeCamp?.settings.periodSlots || DEFAULT_PERIOD_SLOTS,
      },
    };
    setCamps((prev) => [newCamp, ...prev]);
    appendSandboxAudit(
      'CAMP_CREATED_DRAFT',
      'camps',
      newCamp.id,
      null,
      { code: newCamp.code, status: 'draft' },
      'Guided camp setup completed',
      newCamp.id
    );
    return { ok: true };
  };

  const updateCampAndSettings = async (input: {
    campId: string;
    nameEn: string;
    nameAr: string;
    startDate: string;
    durationDays: number;
    currentCampDay: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
    maxInstructorGroupsPerDay: number;
  }): Promise<ActionResult> => {
    const target = camps.find((c) => c.id === input.campId);
    if (!target) return { ok: false, error: 'Camp not found.' };
    const archiveCheck = validateCampNotArchived(target);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };

    if (isSupabaseMode) {
      try {
        await updateCampInDb(input);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed updating camp.' };
      }
    }

    const endDate = calculateCampDayDate(input.startDate, input.durationDays);
    setCamps((prev) =>
      prev.map((c) =>
        c.id === input.campId
          ? {
              ...c,
              nameEn: input.nameEn.trim(),
              nameAr: input.nameAr.trim() || input.nameEn.trim(),
              startDate: input.startDate,
              endDate,
              durationDays: input.durationDays,
              currentCampDay: input.currentCampDay,
              settings: {
                ...c.settings,
                geofenceRadiusMeters: input.geofenceRadiusMeters,
                defaultLectureRateEgp: input.defaultRateEgp,
                maxInstructorGroupsPerDay: input.maxInstructorGroupsPerDay,
              },
            }
          : c
      )
    );
    appendSandboxAudit(
      'CAMP_SETTINGS_UPDATED',
      'camps',
      input.campId,
      { currentCampDay: target.currentCampDay, geofence: target.settings.geofenceRadiusMeters },
      { currentCampDay: input.currentCampDay, geofence: input.geofenceRadiusMeters },
      'Camp operational settings updated by Admin',
      input.campId
    );
    return { ok: true };
  };

  const activateCamp = async (campId: string): Promise<ActionResult> => {
    const check = validateCampActivation(camps, campId);
    if (!check.allowed) {
      return { ok: false, error: check.error };
    }

    if (isSupabaseMode) {
      try {
        await activateCampInDb(campId);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Activation failed.' };
      }
    }

    setCamps((prev) =>
      prev.map((c) => (c.id === campId ? { ...c, status: CampStatus.ACTIVE } : c))
    );
    appendSandboxAudit(
      'CAMP_ACTIVATED',
      'camps',
      campId,
      { status: 'draft' },
      { status: 'active' },
      'Camp activated by Admin',
      campId
    );
    return { ok: true };
  };

  const archiveCamp = async (campId: string): Promise<ActionResult> => {
    if (isSupabaseMode) {
      try {
        await archiveCampInDb(campId);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        await refreshOperationalData().catch(() => undefined);
        return { ok: false, error: err instanceof Error ? err.message : 'Archive failed.' };
      }
    }

    setCamps((prev) =>
      prev.map((c) => (c.id === campId ? { ...c, status: CampStatus.ARCHIVED } : c))
    );
    setCheckins((prev) =>
      prev.map((c) =>
        c.campId === campId
          ? { ...c, selfieStoragePath: null, selfieDeletedAfterArchive: true }
          : c
      )
    );
    appendSandboxAudit(
      'CAMP_ARCHIVED_AND_SELFIES_PURGED',
      'camps',
      campId,
      { status: 'active' },
      { status: 'archived', selfiesPurged: true },
      'Camp archived to read-only state; active camp selfies deleted per retention policy',
      campId
    );
    return { ok: true };
  };

  const upsertGroup = async (input: {
    id?: string;
    code: string;
    nameEn: string;
    nameAr: string;
    track: string;
    defaultRoomId: string;
    primaryInstructorId: string;
    capacity: number;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };
    if (!input.code.trim() || !input.nameEn.trim()) {
      return { ok: false, error: 'Group code and name are required.' };
    }

    if (isSupabaseMode) {
      try {
        await upsertGroupInDb({
          ...input,
          campId: activeCamp.id,
          actorProfileId: auth.currentProfile.id,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Group save failed.' };
      }
    }

    if (input.id) {
      setGroups((prev) =>
        prev.map((g) => (g.id === input.id ? { ...g, ...input, id: g.id } : g))
      );
      appendSandboxAudit(
        'GROUP_UPDATED',
        'groups',
        input.id,
        null,
        { code: input.code, primaryInstructorId: input.primaryInstructorId },
        'Group configuration updated'
      );
    } else {
      const newGroup: Group = {
        id: `grp-${Date.now()}`,
        campId: activeCamp.id,
        code: input.code.trim().toUpperCase(),
        nameEn: input.nameEn.trim(),
        nameAr: input.nameAr.trim() || input.nameEn.trim(),
        track: input.track.trim() || 'Competitive Programming',
        defaultRoomId: input.defaultRoomId,
        primaryInstructorId: input.primaryInstructorId,
        capacity: Math.max(1, input.capacity || 30),
      };
      setGroups((prev) => [...prev, newGroup]);
      appendSandboxAudit(
        'GROUP_CREATED',
        'groups',
        newGroup.id,
        null,
        { code: newGroup.code, campId: activeCamp.id },
        'Training group created'
      );
    }
    return { ok: true };
  };

  const updateInstructorAccount = async (input: {
    instructorId: string;
    profileId: string;
    specialization: string;
    defaultLectureRateEgp: number;
    isActive: boolean;
    assignedToActiveCamp: boolean;
  }): Promise<ActionResult> => {
    if (isSupabaseMode) {
      try {
        await updateInstructorInDb({
          instructorId: input.instructorId,
          profileId: input.profileId,
          specialization: input.specialization,
          defaultLectureRateEgp: input.defaultLectureRateEgp,
          isActive: input.isActive,
          campId: activeCamp?.id,
          assignedToCamp: input.assignedToActiveCamp,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Instructor update failed.',
        };
      }
    }

    setInstructors((prev) =>
      prev.map((inst) =>
        inst.id === input.instructorId
          ? {
              ...inst,
              specialization: input.specialization.trim(),
              defaultLectureRateEgp: Math.max(0, Math.round(input.defaultLectureRateEgp)),
              isActive: input.isActive,
            }
          : inst
      )
    );
    setProfiles((prev) =>
      prev.map((p) => (p.id === input.profileId ? { ...p, isActive: input.isActive } : p))
    );
    if (activeCamp) {
      setCampInstructorIds((prev) => {
        const list = prev[activeCamp.id] || [];
        const next = input.assignedToActiveCamp
          ? Array.from(new Set([...list, input.instructorId]))
          : list.filter((id) => id !== input.instructorId);
        return { ...prev, [activeCamp.id]: next };
      });
    }
    appendSandboxAudit(
      'INSTRUCTOR_UPDATED',
      'instructors',
      input.instructorId,
      null,
      {
        defaultLectureRateEgp: input.defaultLectureRateEgp,
        isActive: input.isActive,
      },
      'Instructor defaults & active status updated (existing lecture frozen rates preserved)'
    );
    return { ok: true };
  };

  const createSingleStudent = async (input: {
    groupId: string;
    studentCode: string;
    fullName: string;
    university: string;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };

    const res = await importStudentsBatch(
      [
        {
          rowNumber: 1,
          studentCode: input.studentCode,
          studentName: input.fullName,
          university: input.university,
        },
      ],
      input.groupId,
      'strict_insert'
    );
    if (!res.ok) {
      return { ok: false, error: res.errors[0]?.message || 'Unable to add student.' };
    }
    return { ok: true };
  };

  const transferStudent = async (input: {
    studentId: string;
    toGroupId: string;
    effectiveCampDay: number;
    reason: string;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };
    if (!input.reason.trim()) {
      return { ok: false, error: 'A transfer reason is required for audit history.' };
    }

    const stu = students.find((s) => s.id === input.studentId && s.campId === activeCamp.id);
    if (!stu) return { ok: false, error: 'Student not found in active camp.' };
    if (stu.groupId === input.toGroupId) {
      return { ok: false, error: 'Target group is the same as the student’s current group.' };
    }

    if (isSupabaseMode) {
      try {
        await transferStudentInDb({
          campId: activeCamp.id,
          studentId: input.studentId,
          toGroupId: input.toGroupId,
          effectiveCampDay: input.effectiveCampDay,
          reason: input.reason,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Transfer failed.' };
      }
    }

    const transferRecord: StudentTransfer = {
      id: `tr-${Date.now()}`,
      campId: activeCamp.id,
      studentId: stu.id,
      fromGroupId: stu.groupId,
      toGroupId: input.toGroupId,
      effectiveCampDay: input.effectiveCampDay,
      reason: input.reason.trim(),
      transferredBy: auth.currentProfile.id,
      createdAt: new Date().toISOString(),
    };

    setStudentTransfers((prev) => [transferRecord, ...prev]);
    setStudents((prev) =>
      prev.map((s) => (s.id === stu.id ? { ...s, groupId: input.toGroupId } : s))
    );
    appendSandboxAudit(
      'STUDENT_TRANSFERRED',
      'student_transfers',
      transferRecord.id,
      { groupId: stu.groupId },
      { groupId: input.toGroupId, effectiveCampDay: input.effectiveCampDay },
      input.reason.trim()
    );
    return { ok: true };
  };

  const addScheduleLecture = async (input: {
    campDay: number;
    periodNumber: number;
    groupId: string;
    instructorId: string;
    roomId: string;
    topic: string;
  }) => {
    if (!activeCamp) return { ok: false, errors: ['No active camp selected.'] };
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) {
      return { ok: false, errors: [archiveCheck.error || 'Camp is archived.'] };
    }
    if (!input.topic.trim()) {
      return { ok: false, errors: ['Lecture topic is required.'] };
    }

    const periodObj =
      activeCamp.settings.periodSlots.find((p) => p.period === input.periodNumber) ||
      activeCamp.settings.periodSlots[0] ||
      DEFAULT_PERIOD_SLOTS[0];

    const validation = validateLectureScheduleSlot({
      existingLectures: lectures,
      candidate: {
        campId: activeCamp.id,
        campDay: input.campDay,
        periodNumber: input.periodNumber,
        startTime: periodObj.start,
        endTime: periodObj.end,
        instructorId: input.instructorId,
        groupId: input.groupId,
        roomId: input.roomId,
      },
      maxGroupsPerDay: activeCamp.settings.maxInstructorGroupsPerDay,
    });

    if (!validation.valid) {
      return { ok: false, errors: validation.conflicts };
    }

    const inst = instructors.find((i) => i.id === input.instructorId) || instructors[0];
    const lectureDate = calculateCampDayDate(activeCamp.startDate, input.campDay);
    const frozenRate = inst?.defaultLectureRateEgp ?? activeCamp.settings.defaultLectureRateEgp;

    if (isSupabaseMode) {
      try {
        await createLectureInDb({
          campId: activeCamp.id,
          campDay: input.campDay,
          lectureDate,
          periodNumber: input.periodNumber,
          startTime: periodObj.start,
          endTime: periodObj.end,
          durationHours: activeCamp.settings.defaultLectureDurationHours,
          groupId: input.groupId,
          instructorId: input.instructorId,
          roomId: input.roomId,
          topic: input.topic,
          frozenRateEgp: frozenRate,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          errors: [err instanceof Error ? err.message : 'Database rejected lecture creation.'],
        };
      }
    }

    const newLecture: Lecture = {
      id: `lec-${Date.now()}`,
      campId: activeCamp.id,
      campDay: input.campDay,
      lectureDate,
      periodNumber: input.periodNumber,
      startTime: periodObj.start,
      endTime: periodObj.end,
      durationHours: activeCamp.settings.defaultLectureDurationHours,
      groupId: input.groupId,
      instructorId: input.instructorId,
      substituteInstructorId: null,
      roomId: input.roomId,
      topic: input.topic.trim(),
      status: LectureStatus.SCHEDULED,
      frozenRateEgp: frozenRate,
      instructorAcknowledgedAt: null,
      revisionNumber: 1,
    };

    const groupStudents = students.filter(
      (s) => s.campId === activeCamp.id && s.groupId === input.groupId && s.isActive
    );
    const newSheet: AttendanceSheet = {
      id: `sheet-${newLecture.id}`,
      campId: activeCamp.id,
      lectureId: newLecture.id,
      instructorId: input.instructorId,
      campDay: input.campDay,
      periodNumber: input.periodNumber,
      status: AttendanceSheetStatus.DRAFT,
      syncState: OfflineSyncState.OFFLINE,
      idempotencyKey: `idem-${activeCamp.id}-${newLecture.id}`,
      records: groupStudents.map((stu) => ({
        studentId: stu.id,
        studentCode: stu.studentCode,
        studentName: stu.fullName,
        originGroupId: resolveStudentOriginGroupForDay({
          student: stu,
          transfers: studentTransfers,
          campDay: input.campDay,
        }),
        attendedGroupId: input.groupId,
        isCrossGroup: false,
        mark: 'unmarked',
      })),
      submittedAt: null,
      syncedAt: null,
    };

    setLectures((prev) => [...prev, newLecture]);
    setAttendanceSheets((prev) => [...prev, newSheet]);
    appendSandboxAudit(
      'LECTURE_SCHEDULED',
      'lectures',
      newLecture.id,
      null,
      {
        period: newLecture.periodNumber,
        group: newLecture.groupId,
        frozenRateEgp: newLecture.frozenRateEgp,
      },
      'Validated conflict-free lecture slot created'
    );
    return { ok: true };
  };

  const updateScheduleLecture = async (input: {
    lectureId: string;
    substituteInstructorId?: string | null;
    roomId?: string;
    topic?: string;
    status?: LectureStatus;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp.' };
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };

    const target = lectures.find((l) => l.id === input.lectureId);
    if (!target) return { ok: false, error: 'Lecture not found.' };

    const effectiveInst =
      input.substituteInstructorId !== undefined
        ? input.substituteInstructorId || target.instructorId
        : target.substituteInstructorId || target.instructorId;

    const validation = validateLectureScheduleSlot({
      existingLectures: lectures.filter((l) => l.id !== target.id),
      candidate: {
        campId: target.campId,
        campDay: target.campDay,
        periodNumber: target.periodNumber,
        startTime: target.startTime,
        endTime: target.endTime,
        instructorId: effectiveInst,
        groupId: target.groupId,
        roomId: input.roomId || target.roomId,
      },
      maxGroupsPerDay: activeCamp.settings.maxInstructorGroupsPerDay,
    });

    if (!validation.valid) {
      return { ok: false, error: validation.conflicts.join(' ') };
    }

    if (isSupabaseMode) {
      try {
        await updateLectureInDb({
          lectureId: input.lectureId,
          substituteInstructorId: input.substituteInstructorId,
          roomId: input.roomId,
          topic: input.topic,
          status: input.status as DbLectureStatus | undefined,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Lecture update failed.',
        };
      }
    }

    setLectures((prev) =>
      prev.map((l) =>
        l.id === input.lectureId
          ? {
              ...l,
              substituteInstructorId:
                input.substituteInstructorId !== undefined
                  ? input.substituteInstructorId
                  : l.substituteInstructorId,
              roomId: input.roomId || l.roomId,
              topic: input.topic !== undefined ? input.topic.trim() : l.topic,
              status: input.status || l.status,
              revisionNumber: l.revisionNumber + 1,
              instructorAcknowledgedAt: null,
            }
          : l
      )
    );
    appendSandboxAudit(
      'LECTURE_UPDATED',
      'lectures',
      input.lectureId,
      { roomId: target.roomId, substituteInstructorId: target.substituteInstructorId },
      {
        roomId: input.roomId || target.roomId,
        substituteInstructorId: input.substituteInstructorId ?? target.substituteInstructorId,
      },
      'Schedule revision applied by Admin'
    );
    return { ok: true };
  };

  const acknowledgeLecture = async (lectureId: string): Promise<ActionResult> => {
    if (isSupabaseMode) {
      try {
        await acknowledgeLectureInDb(lectureId);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to acknowledge lecture.',
        };
      }
    }

    const now = new Date().toISOString();
    setLectures((prev) =>
      prev.map((l) => (l.id === lectureId ? { ...l, instructorAcknowledgedAt: now } : l))
    );
    appendSandboxAudit(
      'SCHEDULE_ACKNOWLEDGED',
      'lectures',
      lectureId,
      { acknowledged: false },
      { acknowledgedAt: now },
      'Instructor acknowledged assigned lecture'
    );
    return { ok: true };
  };

  const submitInstructorCheckin = async (input: {
    instructorId: string;
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    selfieSizeKb: number;
    selfieBlob?: Blob;
    selfieExt?: 'webp' | 'jpg';
    selfieMimeType?: string;
    checkinTimeHHMM: string;
    exceptionReason?: string;
  }) => {
    if (!activeCamp) {
      return {
        ok: false,
        message: 'No active camp found for check-in.',
        status: CheckinStatus.EXCEPTION_PENDING,
      };
    }

    if (isSupabaseMode) {
      try {
        let storagePath = `${auth.currentProfile.id}/${activeCamp.id}/day-${activeCamp.currentCampDay}-${Date.now()}.webp`;
        if (input.selfieBlob && input.selfieExt && input.selfieMimeType) {
          storagePath = await uploadCheckinSelfie({
            userId: auth.currentProfile.id,
            campId: activeCamp.id,
            campDay: activeCamp.currentCampDay,
            blob: input.selfieBlob,
            ext: input.selfieExt,
            mimeType: input.selfieMimeType,
          });
        } else {
          return {
            ok: false,
            message: t(
              'Please capture or upload a selfie image (compressed <= 300KB) before submitting check-in.',
              'يرجى التقاط أو رفع صورة شخصية مضغوطة (<= 300KB) قبل تسجيل الوصول.'
            ),
            status: CheckinStatus.EXCEPTION_PENDING,
          };
        }

        const res = await submitDailyCheckinInDb({
          campId: activeCamp.id,
          latitude: input.latitude,
          longitude: input.longitude,
          gpsAccuracyMeters: input.gpsAccuracyMeters,
          selfieStoragePath: storagePath,
          selfieSizeKb: input.selfieSizeKb,
          exceptionReason: input.exceptionReason,
        });
        await refreshOperationalData();
        return {
          ok: true,
          message: t(
            `Check-in recorded on server (${res.distance_from_venue_meters}m from venue). Status: ${res.status}.`,
            `تم تسجيل الوصول على الخادم (${res.distance_from_venue_meters} متر من المقر). الحالة: ${res.status}.`
          ),
          status: res.status,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Check-in failed.',
          status: CheckinStatus.EXCEPTION_PENDING,
        };
      }
    }

    const venue = venues.find((v) => v.id === activeCamp.venueId) || venues[0];
    if (!venue) {
      return {
        ok: false,
        message: 'Venue coordinates unavailable.',
        status: CheckinStatus.EXCEPTION_PENDING,
      };
    }

    const instructorLecturesToday = lectures
      .filter(
        (l) =>
          l.campId === activeCamp.id &&
          l.campDay === activeCamp.currentCampDay &&
          (l.instructorId === input.instructorId ||
            l.substituteInstructorId === input.instructorId)
      )
      .sort((a, b) => a.periodNumber - b.periodNumber);

    const firstLectureStart =
      instructorLecturesToday.length > 0 ? instructorLecturesToday[0].startTime : '09:00';

    const evalRes = evaluateDailyCheckin({
      instructorLat: input.latitude,
      instructorLng: input.longitude,
      venueLat: venue.latitude,
      venueLng: venue.longitude,
      geofenceRadiusMeters: activeCamp.settings.geofenceRadiusMeters,
      selfieSizeKb: input.selfieSizeKb,
      maxSelfieKb: activeCamp.settings.maxSelfieKb,
      checkinTimeHHMM: input.checkinTimeHHMM,
      firstLectureStartHHMM: firstLectureStart,
      lateThresholdMinutes: activeCamp.settings.firstLectureLateThresholdMinutes,
    });

    if (!evalRes.validSelfie) {
      return {
        ok: false,
        message: `Selfie exceeds maximum compressed size of ${activeCamp.settings.maxSelfieKb}KB.`,
        status: CheckinStatus.EXCEPTION_PENDING,
      };
    }

    const recordId = `chk-${Date.now()}`;
    const record: DailyCheckin = {
      id: recordId,
      campId: activeCamp.id,
      instructorId: input.instructorId,
      campDay: activeCamp.currentCampDay,
      checkinDate: calculateCampDayDate(activeCamp.startDate, activeCamp.currentCampDay),
      serverTimestamp: new Date().toISOString(),
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracyMeters: input.gpsAccuracyMeters,
      distanceFromVenueMeters: evalRes.distanceMeters,
      withinGeofence: evalRes.withinGeofence,
      selfieStoragePath: `${auth.currentProfile.id}/${activeCamp.id}/day-${activeCamp.currentCampDay}.webp`,
      selfieSizeKb: input.selfieSizeKb,
      selfieDeletedAfterArchive: false,
      arrivedLateFirstLecture: evalRes.arrivedLateFirstLecture,
      minutesAfterFirstLecture: evalRes.minutesAfterFirstLecture,
      status: input.exceptionReason ? CheckinStatus.EXCEPTION_PENDING : evalRes.status,
      exceptionReason: input.exceptionReason,
    };

    setCheckins((prev) => {
      const filtered = prev.filter(
        (c) =>
          !(
            c.campId === activeCamp.id &&
            c.instructorId === input.instructorId &&
            c.campDay === activeCamp.currentCampDay
          )
      );
      return [record, ...filtered];
    });

    if (input.exceptionReason) {
      setCheckinExceptions((prev) => [
        {
          id: `ex-${Date.now()}`,
          checkinId: recordId,
          campId: activeCamp.id,
          instructorId: input.instructorId,
          campDay: activeCamp.currentCampDay,
          reason: input.exceptionReason!,
          status: RequestStatus.PENDING,
          reviewedBy: null,
          reviewNote: null,
          reviewedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    appendSandboxAudit(
      'DAILY_CHECKIN_RECORDED',
      'daily_checkins',
      record.id,
      null,
      {
        distanceMeters: record.distanceFromVenueMeters,
        status: record.status,
        selfieKb: record.selfieSizeKb,
      },
      evalRes.message
    );

    return {
      ok: true,
      message: evalRes.message,
      status: record.status,
    };
  };

  const reviewCheckinException = async (input: {
    exceptionId: string;
    decision: 'approved' | 'rejected';
    reviewNote: string;
  }): Promise<ActionResult> => {
    if (!input.reviewNote.trim()) {
      return { ok: false, error: 'A review note is required for audit compliance.' };
    }
    if (isSupabaseMode) {
      try {
        await reviewCheckinExceptionInDb(input);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Exception review failed.' };
      }
    }

    const target = checkinExceptions.find((e) => e.id === input.exceptionId);
    if (!target) return { ok: false, error: 'Exception record not found.' };

    const nextReqStatus =
      input.decision === 'approved' ? RequestStatus.APPROVED : RequestStatus.REJECTED;
    const nextChkStatus =
      input.decision === 'approved'
        ? CheckinStatus.EXCEPTION_APPROVED
        : CheckinStatus.EXCEPTION_REJECTED;

    setCheckinExceptions((prev) =>
      prev.map((e) =>
        e.id === input.exceptionId
          ? {
              ...e,
              status: nextReqStatus,
              reviewedBy: auth.currentProfile.id,
              reviewNote: input.reviewNote.trim(),
              reviewedAt: new Date().toISOString(),
            }
          : e
      )
    );
    if (target.checkinId) {
      setCheckins((prev) =>
        prev.map((c) => (c.id === target.checkinId ? { ...c, status: nextChkStatus } : c))
      );
    }
    appendSandboxAudit(
      `CHECKIN_EXCEPTION_${input.decision.toUpperCase()}`,
      'checkin_exceptions',
      input.exceptionId,
      { status: target.status },
      { status: nextReqStatus },
      input.reviewNote.trim()
    );
    return { ok: true };
  };

  const saveAttendanceDraft = async (
    lectureId: string,
    records: AttendanceRecordItem[],
    simulateOffline: boolean
  ): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const lec = lectures.find((l) => l.id === lectureId);
    if (!lec) return { ok: false, error: 'Lecture not found.' };

    const existingSheet = attendanceSheets.find((s) => s.lectureId === lectureId);
    if (existingSheet?.status === AttendanceSheetStatus.SUBMITTED || existingSheet?.status === AttendanceSheetStatus.LOCKED) {
      return {
        ok: false,
        error: 'Submitted or locked attendance sheets cannot be modified by instructors.',
      };
    }

    const syncState = OfflineSyncState.OFFLINE;
    const idempotencyKey = existingSheet?.idempotencyKey || `idem-${activeCamp.id}-${lectureId}`;

    await saveOfflineAttendanceDraft({
      lectureId,
      campId: activeCamp.id,
      instructorId: lec.substituteInstructorId || lec.instructorId,
      idempotencyKey,
      syncState,
      records,
      updatedAt: new Date().toISOString(),
    });

    if (isSupabaseMode && !simulateOffline && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        await saveAttendanceRecordsDraftToDb({
          campId: activeCamp.id,
          lecture: lec,
          sheetId: existingSheet?.id,
          records,
          updatedBy: auth.currentProfile.id,
        });
      } catch {
        // Keep local IndexedDB draft cleanly when network/DB save is offline
      }
    }

    setAttendanceSheets((prev) => {
      if (existingSheet) {
        return prev.map((s) =>
          s.lectureId === lectureId
            ? { ...s, status: AttendanceSheetStatus.DRAFT, syncState, records }
            : s
        );
      }
      return [
        ...prev,
        {
          id: `sheet-${lectureId}`,
          campId: activeCamp.id,
          lectureId,
          instructorId: lec.substituteInstructorId || lec.instructorId,
          campDay: lec.campDay,
          periodNumber: lec.periodNumber,
          status: AttendanceSheetStatus.DRAFT,
          syncState,
          idempotencyKey,
          records,
          submittedAt: null,
          syncedAt: null,
        },
      ];
    });
    return { ok: true };
  };

  const submitAndSyncAttendanceSheet = async (lectureId: string): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const sheet = attendanceSheets.find((s) => s.lectureId === lectureId);
    const lec = lectures.find((l) => l.id === lectureId);
    if (!sheet || !lec) {
      return { ok: false, error: 'Attendance sheet not found for this lecture.' };
    }

    const otherSheetsSamePeriod = attendanceSheets.filter(
      (s) =>
        s.campId === activeCamp.id &&
        s.campDay === lec.campDay &&
        s.periodNumber === lec.periodNumber &&
        s.lectureId !== lectureId &&
        (s.status === AttendanceSheetStatus.SUBMITTED || s.status === AttendanceSheetStatus.LOCKED)
    );

    const alreadyPresentSamePeriodIds = new Set<string>();
    for (const s of otherSheetsSamePeriod) {
      for (const r of s.records) {
        if (r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE) {
          alreadyPresentSamePeriodIds.add(r.studentId);
        }
      }
    }

    const otherSheetsSameDay = attendanceSheets.filter(
      (s) =>
        s.campId === activeCamp.id &&
        s.campDay === lec.campDay &&
        s.lectureId !== lectureId &&
        (s.status === AttendanceSheetStatus.SUBMITTED || s.status === AttendanceSheetStatus.LOCKED)
    );
    const alreadyPresentOtherGroupMap = new Map<string, string>();
    for (const s of otherSheetsSameDay) {
      for (const r of s.records) {
        if (r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE) {
          alreadyPresentOtherGroupMap.set(r.studentId, r.attendedGroupId);
        }
      }
    }

    const finalized = finalizeAttendanceSubmission({
      records: sheet.records,
      alreadyPresentStudentIdsSamePeriod: alreadyPresentSamePeriodIds,
      alreadyPresentStudentIdsSameDayOtherGroups: alreadyPresentOtherGroupMap,
    });

    if (!finalized.valid) {
      return { ok: false, error: finalized.error };
    }

    if (isSupabaseMode) {
      try {
        const persistedSheetId = await saveAttendanceRecordsDraftToDb({
          campId: activeCamp.id,
          lecture: lec,
          sheetId: sheet.id.startsWith('sheet-') ? undefined : sheet.id,
          records: finalized.finalizedRecords,
          updatedBy: auth.currentProfile.id,
        });
        await submitAttendanceSheetInDb(persistedSheetId);
        await deleteOfflineAttendanceDraft(lectureId);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Attendance sync failed.',
        };
      }
    }

    const now = new Date().toISOString();
    setAttendanceSheets((prev) =>
      prev.map((s) =>
        s.lectureId === lectureId
          ? {
              ...s,
              status: AttendanceSheetStatus.SUBMITTED,
              syncState: OfflineSyncState.SYNCED,
              records: finalized.finalizedRecords,
              submittedAt: now,
              syncedAt: now,
            }
          : s
      )
    );

    await deleteOfflineAttendanceDraft(lectureId);

    const activeInstId = lec.substituteInstructorId || lec.instructorId;
    const checkin = checkins.find(
      (c) =>
        c.campId === activeCamp.id &&
        c.instructorId === activeInstId &&
        c.campDay === lec.campDay
    );
    const hasValidCheckin = Boolean(
      checkin &&
        (checkin.status === CheckinStatus.VERIFIED ||
          checkin.status === CheckinStatus.LATE_FIRST_LECTURE ||
          checkin.status === CheckinStatus.EXCEPTION_APPROVED)
    );

    const entEval = evaluateLectureEntitlement({
      frozenRateEgp: lec.frozenRateEgp,
      hasValidCheckin,
      isFirstLectureOfDay: lec.periodNumber === 1,
      arrivedLateFirstLecture: Boolean(checkin?.arrivedLateFirstLecture),
      sheetStatus: AttendanceSheetStatus.SUBMITTED,
      syncState: OfflineSyncState.SYNCED,
    });

    setEntitlements((prev) => {
      const existing = prev.find((e) => e.lectureId === lectureId);
      if (existing) {
        return prev.map((e) =>
          e.lectureId === lectureId
            ? {
                ...e,
                status: entEval.status,
                entitlementAmountEgp: entEval.entitlementAmountEgp,
                eligibilityReason: entEval.reason,
                updatedAt: now,
              }
            : e
        );
      }
      return [
        ...prev,
        {
          id: `ent-${Date.now()}`,
          campId: activeCamp.id,
          lectureId,
          instructorId: activeInstId,
          campDay: lec.campDay,
          periodNumber: lec.periodNumber,
          frozenRateEgp: lec.frozenRateEgp,
          entitlementAmountEgp: entEval.entitlementAmountEgp,
          status: entEval.status,
          eligibilityReason: entEval.reason,
          updatedAt: now,
        },
      ];
    });

    appendSandboxAudit(
      'ATTENDANCE_SYNCED_AND_ENTITLEMENT_EVALUATED',
      'attendance_sheets',
      sheet.id,
      { status: 'draft' },
      {
        status: 'submitted',
        presentCount: finalized.presentCount,
        absentCount: finalized.absentCount,
        entitlementStatus: entEval.status,
      },
      'Attendance sheet synchronized and server-side lecture entitlement updated'
    );

    return { ok: true };
  };

  const adminCorrectAttendanceRecord = async (input: {
    sheetId: string;
    lectureId: string;
    studentId: string;
    mark: AttendanceMark;
    note?: string;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    if (auth.currentProfile.role !== UserRole.ADMIN) {
      return { ok: false, error: 'Only Admin can correct submitted attendance marks.' };
    }
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) return { ok: false, error: archiveCheck.error };

    const sheet = attendanceSheets.find((s) => s.id === input.sheetId);
    const lec = lectures.find((l) => l.id === input.lectureId);
    const stu = students.find((s) => s.id === input.studentId);
    if (!sheet || !lec || !stu) {
      return { ok: false, error: 'Sheet, lecture, or student not found.' };
    }

    if (isSupabaseMode) {
      try {
        await adminCorrectAttendanceRecordInDb({
          campId: activeCamp.id,
          sheet,
          lecture: lec,
          student: stu,
          transfers: studentTransfers,
          mark: input.mark,
          note: input.note,
          adminProfileId: auth.currentProfile.id,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Correction failed.' };
      }
    }

    const originGroupId = resolveStudentOriginGroupForDay({
      student: stu,
      transfers: studentTransfers,
      campDay: lec.campDay,
    });

    setAttendanceSheets((prev) =>
      prev.map((s) => {
        if (s.id !== input.sheetId) return s;
        const exists = s.records.some((r) => r.studentId === stu.id);
        const updatedRecords = exists
          ? s.records.map((r) =>
              r.studentId === stu.id
                ? { ...r, mark: input.mark, note: input.note }
                : r
            )
          : [
              ...s.records,
              {
                studentId: stu.id,
                studentCode: stu.studentCode,
                studentName: stu.fullName,
                originGroupId,
                attendedGroupId: lec.groupId,
                isCrossGroup: originGroupId !== lec.groupId,
                mark: input.mark,
                note: input.note,
              },
            ];
        return { ...s, records: updatedRecords };
      })
    );

    appendSandboxAudit(
      'ATTENDANCE_ADMIN_CORRECTED',
      'attendance_records',
      input.sheetId,
      null,
      { studentId: stu.id, mark: input.mark },
      input.note || 'Admin attendance mark correction'
    );
    return { ok: true };
  };

  const reviewLectureEntitlement = async (
    entitlementId: string,
    decision: 'approved' | 'excluded',
    reason: string
  ): Promise<ActionResult> => {
    if (!reason.trim()) {
      return {
        ok: false,
        error: 'An audit reason is required before approving or excluding a lecture entitlement.',
      };
    }

    if (isSupabaseMode) {
      try {
        await overrideEntitlementInDb({ entitlementId, decision, reason });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed updating entitlement.',
        };
      }
    }

    const target = entitlements.find((e) => e.id === entitlementId);
    if (!target) return { ok: false, error: 'Entitlement record not found.' };

    const newStatus =
      decision === 'approved' ? EntitlementStatus.APPROVED : EntitlementStatus.EXCLUDED;
    const newAmount = decision === 'approved' ? target.frozenRateEgp : 0;

    setEntitlements((prev) =>
      prev.map((e) =>
        e.id === entitlementId
          ? {
              ...e,
              status: newStatus,
              entitlementAmountEgp: newAmount,
              adminOverrideReason: reason.trim(),
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    appendSandboxAudit(
      decision === 'approved' ? 'ENTITLEMENT_APPROVED' : 'ENTITLEMENT_EXCLUDED',
      'lecture_entitlements',
      entitlementId,
      { status: target.status, amountEgp: target.entitlementAmountEgp },
      { status: newStatus, amountEgp: newAmount },
      reason.trim()
    );

    return { ok: true };
  };

  const reviewInstructorRequest = async (
    requestId: string,
    decision: RequestStatus.APPROVED | RequestStatus.REJECTED,
    note: string
  ): Promise<ActionResult> => {
    const req = requests.find((r) => r.id === requestId);
    if (!req) return { ok: false, error: 'Request not found.' };

    if (isSupabaseMode) {
      try {
        const inst = instructors.find((i) => i.id === req.instructorId);
        await reviewInstructorRequestInDb({
          requestId,
          status: decision,
          reviewNote: note,
          reviewerProfileId: auth.currentProfile.id,
          recipientProfileId: inst?.profileId,
          subject: req.subject,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Request review failed.',
        };
      }
    }

    setRequests((prev) =>
      prev.map((r) =>
        r.id === requestId ? { ...r, status: decision, reviewNote: note.trim() } : r
      )
    );
    const inst = instructors.find((i) => i.id === req.instructorId);
    if (inst) {
      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          recipientProfileId: inst.profileId,
          titleEn: `Request ${decision === RequestStatus.APPROVED ? 'Approved' : 'Rejected'}`,
          titleAr: decision === RequestStatus.APPROVED ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب',
          bodyEn: `${req.subject}: ${note.trim() || 'Reviewed'}`,
          bodyAr: `${req.subject}: ${note.trim() || 'تمت المراجعة'}`,
          isRead: false,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
    appendSandboxAudit(
      `REQUEST_${decision.toUpperCase()}`,
      'instructor_requests',
      requestId,
      { status: 'pending' },
      { status: decision },
      note.trim() || 'Reviewed by Admin'
    );
    return { ok: true };
  };

  const submitInstructorRequest = async (input: {
    requestType: InstructorRequestItem['requestType'];
    subject: string;
    details: string;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    if (!input.subject.trim() || !input.details.trim()) {
      return { ok: false, error: 'Subject and details are required.' };
    }

    if (isSupabaseMode) {
      try {
        await submitInstructorRequestInDb({
          campId: activeCamp.id,
          instructorId: auth.activeInstructorId,
          requestType: input.requestType,
          subject: input.subject,
          details: input.details,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to submit request.',
        };
      }
    }

    const newReq: InstructorRequestItem = {
      id: `req-${Date.now()}`,
      campId: activeCamp.id,
      instructorId: auth.activeInstructorId,
      requestType: input.requestType,
      subject: input.subject.trim(),
      details: input.details.trim(),
      status: RequestStatus.PENDING,
      createdAt: new Date().toISOString(),
    };
    setRequests((prev) => [newReq, ...prev]);
    appendSandboxAudit(
      'INSTRUCTOR_REQUEST_CREATED',
      'instructor_requests',
      newReq.id,
      null,
      { subject: newReq.subject },
      'Submitted from Instructor Portal'
    );
    return { ok: true };
  };

  const importStudentsBatch = async (
    rows: RawStudentImportRow[],
    groupId: string,
    mode: 'strict_insert' | 'smart_update'
  ) => {
    if (!activeCamp) {
      return {
        ok: false,
        errors: [{ rowNumber: 1, message: 'No active camp selected.' }],
        inserted: 0,
        updated: 0,
      };
    }
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) {
      return {
        ok: false,
        errors: [{ rowNumber: 1, message: archiveCheck.error || 'Camp is archived.' }],
        inserted: 0,
        updated: 0,
      };
    }
    const campStudents = students.filter((s) => s.campId === activeCamp.id);
    const validation = validateStudentBatchImport({
      rows,
      existingStudents: students,
      targetCampId: activeCamp.id,
      mode,
    });

    if (!validation.valid) {
      return {
        ok: false,
        errors: validation.errors,
        inserted: 0,
        updated: 0,
      };
    }

    if (isSupabaseMode) {
      try {
        const res = await batchImportStudentsInDb({
          campId: activeCamp.id,
          groupId,
          mode,
          rows: rows.map((r) => ({
            studentName: r.studentName.trim(),
            studentCode: r.studentCode.trim(),
            university: r.university?.trim() || 'Cairo University',
          })),
        });
        await refreshOperationalData();
        return {
          ok: true,
          errors: [],
          inserted: res.inserted,
          updated: res.updated,
        };
      } catch (err) {
        return {
          ok: false,
          errors: [
            {
              rowNumber: 1,
              message: err instanceof Error ? err.message : 'Batch import failed on server.',
            },
          ],
          inserted: 0,
          updated: 0,
        };
      }
    }

    const updatedMap = new Map(
      validation.toUpdate.map((u) => [u.studentCode.toUpperCase(), u])
    );

    const nextStudents = students.map((s) => {
      if (s.campId !== activeCamp.id) return s;
      const match = updatedMap.get(s.studentCode.toUpperCase());
      if (!match) return s;
      return {
        ...s,
        fullName: match.studentName,
        university: match.university || s.university,
        groupId: groupId || s.groupId,
      };
    });

    const newRecords: Student[] = validation.toInsert.map((ins, idx) => ({
      id: `stu-${Date.now()}-${idx}`,
      campId: activeCamp.id,
      groupId,
      studentCode: ins.studentCode.toUpperCase(),
      fullName: ins.studentName,
      university: ins.university || 'Cairo University',
      isActive: true,
    }));

    setStudents([...nextStudents, ...newRecords]);
    appendSandboxAudit(
      'STUDENT_BATCH_IMPORT',
      'students',
      activeCamp.id,
      { count: campStudents.length },
      { inserted: newRecords.length, updated: validation.toUpdate.length, mode },
      `Validated student batch import (${mode})`
    );

    return {
      ok: true,
      errors: [],
      inserted: newRecords.length,
      updated: validation.toUpdate.length,
    };
  };

  const toggleChecklistItem = async (itemId: string): Promise<ActionResult> => {
    const item = checklists.find((c) => c.id === itemId);
    if (!item) return { ok: false, error: 'Checklist item not found.' };

    if (isSupabaseMode) {
      try {
        await toggleChecklistInDb({
          checklistId: itemId,
          nextCompleted: !item.isCompleted,
          completedBy: auth.currentProfile.id,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed updating checklist.',
        };
      }
    }

    setChecklists((prev) =>
      prev.map((ch) =>
        ch.id === itemId ? { ...ch, isCompleted: !ch.isCompleted } : ch
      )
    );
    return { ok: true };
  };

  const createOperationalIssue = async (input: {
    roomId: string;
    category: string;
    title: string;
    description: string;
    severity: IssueSeverity;
  }): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    if (!input.title.trim()) return { ok: false, error: 'Issue title is required.' };

    if (isSupabaseMode) {
      try {
        await createIssueInDb({
          campId: activeCamp.id,
          reportedBy: auth.currentProfile.id,
          roomId: input.roomId,
          category: input.category,
          title: input.title,
          description: input.description,
          severity: input.severity,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to log issue.',
        };
      }
    }

    const newIssue: OperationalIssue = {
      id: `iss-${Date.now()}`,
      campId: activeCamp.id,
      roomId: input.roomId,
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      severity: input.severity,
      status: IssueStatus.OPEN,
      reportedBy: auth.currentProfile.fullNameEn,
      createdAt: new Date().toISOString(),
    };
    setIssues((prev) => [newIssue, ...prev]);
    appendSandboxAudit(
      'ISSUE_REPORTED',
      'issues',
      newIssue.id,
      null,
      { title: newIssue.title, severity: newIssue.severity },
      'Operational issue logged'
    );
    return { ok: true };
  };

  const resolveOperationalIssue = async (issueId: string): Promise<ActionResult> => {
    if (isSupabaseMode) {
      try {
        await resolveIssueInDb({
          issueId,
          resolvedBy: auth.currentProfile.id,
        });
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to resolve issue.',
        };
      }
    }

    setIssues((prev) =>
      prev.map((iss) =>
        iss.id === issueId ? { ...iss, status: IssueStatus.RESOLVED } : iss
      )
    );
    appendSandboxAudit(
      'ISSUE_RESOLVED',
      'issues',
      issueId,
      { status: 'open' },
      { status: 'resolved' },
      'Marked resolved in Operations'
    );
    return { ok: true };
  };

  const markNotificationRead = async (notificationId: string): Promise<void> => {
    if (isSupabaseMode) {
      try {
        await markNotificationReadInDb(notificationId);
        await refreshOperationalData();
      } catch (err) {
        setDataError(
          err instanceof Error ? err.message : 'Unable to mark notification as read.'
        );
      }
      return;
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
    );
  };

  const exportBackupSnapshot = async () => {
    const filename = `${activeCamp?.code || 'CITS'}_backup_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      mode: isSupabaseMode ? 'supabase' : 'sandbox',
      activeCampId: activeCamp?.id || null,
      camps,
      groups,
      instructors,
      students,
      studentTransfers,
      lectures,
      checkins,
      checkinExceptions,
      attendanceSheets,
      entitlements,
      requests,
      issues,
      checklists,
      surveys,
      auditLogs,
    };
    const jsonString = JSON.stringify(payload, null, 2);

    try {
      let checksum = 'local-json-export';
      if (isSupabaseMode) {
        checksum = await recordBackupExportInDb({
          campId: activeCamp?.id || null,
          createdBy: auth.currentProfile.id,
          actorName: auth.currentProfile.fullNameEn,
          jsonString,
        });
        await refreshOperationalData();
      }

      if (typeof document !== 'undefined') {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      if (!isSupabaseMode) {
        appendSandboxAudit(
          'BACKUP_JSON_EXPORTED',
          'backup_records',
          activeCamp?.id || 'global',
          null,
          { filename },
          'Admin exported operational JSON backup'
        );
      }

      return { ok: true, filename, checksum };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Backup export failed.',
      };
    }
  };

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        theme,
        toggleTheme,
        t,
        isSupabaseMode,
        isInitializingSession,
        isLoadingData,
        dataError,
        refreshOperationalData,
        auth,
        loginWithCredentials,
        setupAdminTotpEnrollment,
        verifyAdminTotp,
        completeFirstLoginPasswordChange,
        signOut,
        switchDemoIdentity,
        adminRoute,
        setAdminRoute,
        instructorRoute,
        setInstructorRoute,
        isArchitectureDrawerOpen,
        setArchitectureDrawerOpen,
        profiles,
        adminAccounts,
        instructors,
        venues,
        rooms,
        camps,
        activeCamp,
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
        createDraftCamp,
        updateCampAndSettings,
        activateCamp,
        archiveCamp,
        upsertGroup,
        updateInstructorAccount,
        createSingleStudent,
        transferStudent,
        addScheduleLecture,
        updateScheduleLecture,
        acknowledgeLecture,
        submitInstructorCheckin,
        reviewCheckinException,
        saveAttendanceDraft,
        submitAndSyncAttendanceSheet,
        adminCorrectAttendanceRecord,
        reviewLectureEntitlement,
        reviewInstructorRequest,
        submitInstructorRequest,
        importStudentsBatch,
        toggleChecklistItem,
        createOperationalIssue,
        resolveOperationalIssue,
        markNotificationRead,
        exportBackupSnapshot,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
