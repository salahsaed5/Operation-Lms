import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  validateGpsCoordinates,
  validateLectureScheduleSlot,
  validateStudentBatchImport,
} from '../domain/businessRules';
import {
  generateSecureTemporaryPassword,
  ProvisionInstructorInput,
  ProvisionInstructorOutcome,
  validateInitialPasswordStrength,
  validateProvisionInstructorInput,
} from '../domain/accountProvisioning';
import {
  deleteOfflineAttendanceDraft,
  getOfflineAttendanceDraft,
  saveOfflineAttendanceDraft,
} from '../services/offlineDraftDB';
import { compareAttendanceDraftRows } from '../domain/attendanceDraftDiff';
import { buildCampAttendanceWorkbook } from '../services/campAttendanceWorkbookExport';
import { getSupabaseStatusSummary, isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  acknowledgeLectureInDb,
  adminCorrectAttendanceRecordInDb,
  archiveCampInDb,
  activateCampInDb,
  batchImportStudentsInDb,
  completeUserPasswordChange,
  createDraftCampInDb,
  createVenueInDb,
  createRoomInDb,
  createIssueInDb,
  createLectureInDb,
  createStudentInDb,
  instructorEnrollMidcampStudentInDb,
  deleteCheckinSelfiePath,
  enrollAdminTotpFactor,
  fetchOperationalSnapshot,
  loadAuthenticatedUserContext,
  markNotificationReadInDb,
  markProfileMustChangePassword,
  overrideEntitlementInDb,
  provisionInstructorViaEdgeFunction,
  recordBackupExportInDb,
  resolveAndSignInWithSupabase,
  resolveIssueInDb,
  reviewCheckinExceptionInDb,
  reviewInstructorRequestInDb,
  saveAttendanceRecordsDraftToDb,
  sendInstructorPasswordResetEmail,
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
  isSandboxMode: boolean;
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
  switchDemoIdentity: (role: UserRole, instructorId?: string, profileId?: string) => void;

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
  createRoom: (input: {
    venueId: string;
    code: string;
    name: string;
    capacity: number;
  }) => Promise<ActionResult>;
  createVenue: (input: {
    nameEn: string;
    nameAr: string;
    address: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
  }) => Promise<ActionResult>;
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

  provisionInstructor: (input: ProvisionInstructorInput) => Promise<ProvisionInstructorOutcome>;

  updateInstructorAccount: (input: {
    instructorId: string;
    profileId: string;
    fullNameEn?: string;
    fullNameAr?: string;
    phone?: string;
    bio?: string;
    specialization: string;
    defaultLectureRateEgp: number;
    isActive: boolean;
    assignedToActiveCamp: boolean;
  }) => Promise<ActionResult>;

  triggerInstructorPasswordReset: (instructorId: string) => Promise<ActionResult>;

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

  enrollMidcampStudent: (input: {
    groupId: string;
    studentCode: string;
    fullName: string;
    university: string;
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

  // Read-only side-by-side comparison. Never writes server attendance.
  downloadTenDayAttendanceWorkbook: () => Promise<ActionResult>;

  reviewAttendanceDraft: (lectureId: string) => Promise<{
    ok: boolean;
    error?: string;
    rows?: {
      studentId: string;
      studentCode: string;
      studentName: string;
      localMark: string;
      serverMark: string;
      localNote?: string;
      serverNote?: string;
    }[];
  }>;

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
  const supabaseStatus = getSupabaseStatusSummary();
  const isSandboxMode = import.meta.env.DEV && supabaseStatus.mode === 'local_sandbox_mode';
  const deploymentConfigError = !isSupabaseMode && !isSandboxMode
    ? supabaseStatus.setupError || 'Supabase configuration is required outside development builds.'
    : null;

  const [lang, setLangState] = useState<Language>('en');
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [isInitializingSession, setIsInitializingSession] = useState<boolean>(isSupabaseMode);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(deploymentConfigError);

  const [supabaseCtx, setSupabaseCtx] = useState<SupabaseAuthContext | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>(isSandboxMode ? INITIAL_PROFILES : []);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(
    isSandboxMode ? INITIAL_ADMIN_ACCOUNTS : []
  );
  const [instructors, setInstructors] = useState<Instructor[]>(
    isSandboxMode ? INITIAL_INSTRUCTORS : []
  );
  const [venues, setVenues] = useState<Venue[]>(isSandboxMode ? INITIAL_VENUES : []);
  const [rooms, setRooms] = useState<Room[]>(isSandboxMode ? INITIAL_ROOMS : []);
  const [camps, setCamps] = useState<Camp[]>(isSandboxMode ? INITIAL_CAMPS : []);
  const [campInstructorIds, setCampInstructorIds] = useState<Record<string, string[]>>(
    isSandboxMode
      ? { 'camp-2026-spring': INITIAL_INSTRUCTORS.map((i) => i.id) }
      : {}
  );
  const [groups, setGroups] = useState<Group[]>(isSandboxMode ? INITIAL_GROUPS : []);
  const [students, setStudents] = useState<Student[]>(isSandboxMode ? INITIAL_STUDENTS : []);
  const [studentTransfers, setStudentTransfers] = useState<StudentTransfer[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>(isSandboxMode ? INITIAL_LECTURES : []);
  const [checkins, setCheckins] = useState<DailyCheckin[]>(isSandboxMode ? INITIAL_CHECKINS : []);
  const [checkinExceptions, setCheckinExceptions] = useState<CheckinExceptionItem[]>([]);
  const [attendanceSheets, setAttendanceSheets] = useState<AttendanceSheet[]>(
    isSandboxMode ? INITIAL_ATTENDANCE_SHEETS : []
  );
  const [entitlements, setEntitlements] = useState<LectureEntitlement[]>(
    isSandboxMode ? INITIAL_ENTITLEMENTS : []
  );
  const [requests, setRequests] = useState<InstructorRequestItem[]>(
    isSandboxMode ? INITIAL_REQUESTS : []
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [issues, setIssues] = useState<OperationalIssue[]>(
    isSandboxMode ? INITIAL_ISSUES : []
  );
  const [checklists, setChecklists] = useState<DailyChecklistItem[]>(
    isSandboxMode ? INITIAL_CHECKLISTS : []
  );
  const [surveys, setSurveys] = useState<SurveyLinkItem[]>(
    isSandboxMode ? INITIAL_SURVEYS : []
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(
    isSandboxMode ? INITIAL_AUDIT_LOGS : []
  );

  const [auth, setAuth] = useState<AuthFlowState>({
    isAuthenticated: isSandboxMode,
    pendingTotpProfileId: null,
    pendingPasswordChangeProfileId: null,
    currentProfile: isSandboxMode ? INITIAL_PROFILES[0] : GUEST_PLACEHOLDER_PROFILE,
    activeInstructorId: isSandboxMode ? 'inst-1' : '',
    mfaFactorId: null,
    mfaNeedsEnrollment: false,
    mfaEnrollment: null,
  });

  const [adminRoute, setAdminRoute] = useState<AdminRouteId>('dashboard');
  const [instructorRoute, setInstructorRoute] = useState<InstructorRouteId>('dashboard');
  const [isArchitectureDrawerOpen, setArchitectureDrawerOpen] = useState(false);

  const loginInFlightRef = useRef<boolean>(false);
  const passwordUpdateInFlightRef = useRef<boolean>(false);
  const pendingRecoveryFlowRef = useRef<boolean>(false);

  const clearSupabaseOperationalState = useCallback(() => {
    setSupabaseCtx(null);
    setProfiles([]);
    setAdminAccounts([]);
    setInstructors([]);
    setVenues([]);
    setRooms([]);
    setCamps([]);
    setCampInstructorIds({});
    setGroups([]);
    setStudents([]);
    setStudentTransfers([]);
    setLectures([]);
    setCheckins([]);
    setCheckinExceptions([]);
    setAttendanceSheets([]);
    setEntitlements([]);
    setRequests([]);
    setNotifications([]);
    setIssues([]);
    setChecklists([]);
    setSurveys([]);
    setAuditLogs([]);
    setAdminRoute('dashboard');
    setInstructorRoute('dashboard');
  }, []);

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

      // Only the owning Instructor may overlay their own offline draft.
      // Admin must always see authoritative server rows; never let shared
      // browser IndexedDB silently masquerade as server-synchronized data.
      const mergedSheets = await Promise.all(
        snap.attendanceSheets.map(async (sheet) => {
          if (sheet.status !== AttendanceSheetStatus.DRAFT ||
              ctx.profile.role !== UserRole.INSTRUCTOR || !ctx.instructor?.id ||
              sheet.instructorId !== ctx.instructor.id) return sheet;
          const localDraft = await getOfflineAttendanceDraft(sheet.lectureId);
          if (localDraft &&
              localDraft.instructorId === ctx.instructor.id &&
              localDraft.campId === sheet.campId &&
              localDraft.records.length > 0) {
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
    async (ctx: SupabaseAuthContext, options?: { forcePasswordChange?: boolean }) => {
      setSupabaseCtx(ctx);
      const mustRotateCredential =
        ctx.profile.mustChangePassword ||
        Boolean(options?.forcePasswordChange) ||
        pendingRecoveryFlowRef.current;

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

      if (mustRotateCredential) {
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

    const urlSignalsRecovery = (() => {
      if (typeof window === 'undefined') return false;
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      return /(?:^|[#&?])type=recovery(?:&|$)/i.test(hash) || /(?:^|[#&?])type=recovery(?:&|$)/i.test(search);
    })();
    if (urlSignalsRecovery) {
      pendingRecoveryFlowRef.current = true;
    }

    const resetUnauthenticated = () => {
      pendingRecoveryFlowRef.current = false;
      clearSupabaseOperationalState();
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
    };

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
            await applySupabaseAuthContext(ctx, {
              forcePasswordChange: pendingRecoveryFlowRef.current,
            });
          }
        }
      } catch (err) {
        if (mounted) {
          resetUnauthenticated();
          setDataError(err instanceof Error ? err.message : 'Session restoration failed.');
        }
      } finally {
        if (mounted) setIsInitializingSession(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session?.user) {
        resetUnauthenticated();
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        pendingRecoveryFlowRef.current = true;
        loadAuthenticatedUserContext(session.user.id)
          .then((ctx) => {
            if (mounted) return applySupabaseAuthContext(ctx, { forcePasswordChange: true });
          })
          .catch((err) => {
            if (mounted) {
              resetUnauthenticated();
              setDataError(
                err instanceof Error ? err.message : 'Unable to initialize password recovery.'
              );
            }
          });
        return;
      }
      if (event === 'SIGNED_IN') {
        // Ignore when form loginWithCredentials is already driving context resolution
        if (loginInFlightRef.current) return;
        loadAuthenticatedUserContext(session.user.id)
          .then((ctx) => {
            if (mounted) {
              return applySupabaseAuthContext(ctx, {
                forcePasswordChange: pendingRecoveryFlowRef.current,
              });
            }
          })
          .catch((err) => {
            if (mounted) {
              resetUnauthenticated();
              setDataError(err instanceof Error ? err.message : 'Session initialization failed.');
            }
          });
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Avoid racing with completeFirstLoginPasswordChange before complete_password_change_tx commits
        if (event === 'USER_UPDATED' && passwordUpdateInFlightRef.current) return;
        loadAuthenticatedUserContext(session.user.id)
          .then((ctx) => {
            if (mounted) {
              return applySupabaseAuthContext(ctx, {
                forcePasswordChange: pendingRecoveryFlowRef.current,
              });
            }
          })
          .catch((err) => {
            if (mounted) {
              resetUnauthenticated();
              setDataError(
                err instanceof Error ? err.message : 'Session synchronization failed.'
              );
            }
          });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isSupabaseMode, applySupabaseAuthContext, clearSupabaseOperationalState]);

  const refreshOperationalData = useCallback(async () => {
    if (!isSupabaseMode || !supabaseCtx) return;
    try {
      const liveCtx = await loadAuthenticatedUserContext(supabaseCtx.userId);
      const needsReGate =
        liveCtx.profile.mustChangePassword ||
        (liveCtx.profile.role === UserRole.ADMIN &&
          (liveCtx.mfa.needsEnrollment || liveCtx.mfa.needsChallenge));

      if (needsReGate) {
        clearSupabaseOperationalState();
        await applySupabaseAuthContext(liveCtx);
        return;
      }

      setSupabaseCtx(liveCtx);
      await hydrateFromSnapshot(liveCtx);
    } catch (err) {
      pendingRecoveryFlowRef.current = false;
      clearSupabaseOperationalState();
      await signOutSupabase();
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
      setDataError(
        err instanceof Error ? err.message : 'Your session is no longer active.'
      );
    }
  }, [
    isSupabaseMode,
    supabaseCtx,
    hydrateFromSnapshot,
    clearSupabaseOperationalState,
    applySupabaseAuthContext,
  ]);

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
      loginInFlightRef.current = true;
      try {
        setDataError(null);
        pendingRecoveryFlowRef.current = false;
        const ctx = await resolveAndSignInWithSupabase(identifier, password);
        const step = await applySupabaseAuthContext(ctx);
        return { ok: true, step };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Authentication failed.',
        };
      } finally {
        loginInFlightRef.current = false;
      }
    }

    if (!isSandboxMode) {
      return {
        ok: false,
        error: deploymentConfigError || 'Local Sandbox sign-in is disabled outside development builds.',
      };
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
    if (!isSupabaseMode) {
      return isSandboxMode
        ? { ok: true }
        : { ok: false, error: deploymentConfigError || 'Local Sandbox is disabled outside development builds.' };
    }
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

    if (!isSandboxMode) {
      return { ok: false, error: deploymentConfigError || 'Local Sandbox is disabled outside development builds.' };
    }

    // Local Sandbox TOTP verification
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      return {
        ok: false,
        error: t(
          'Enter a valid 6-digit authenticator verification code.',
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
    const strengthCheck = validateInitialPasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return {
        ok: false,
        error: t(
          strengthCheck.error ||
            'New password must be 8–128 characters and include uppercase, lowercase, and a number.',
          'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم.'
        ),
      };
    }

    if (isSupabaseMode) {
      passwordUpdateInFlightRef.current = true;
      try {
        await completeUserPasswordChange(newPassword);
        pendingRecoveryFlowRef.current = false;
        if (typeof window !== 'undefined' && (window.location.hash || window.location.search)) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        if (!supabase) throw new Error('Supabase client missing.');
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Session missing after password update.');
        const ctx = await loadAuthenticatedUserContext(user.id);
        await applySupabaseAuthContext(ctx, { forcePasswordChange: false });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Password update failed.',
        };
      } finally {
        passwordUpdateInFlightRef.current = false;
      }
    }

    if (!isSandboxMode) {
      return { ok: false, error: deploymentConfigError || 'Local Sandbox is disabled outside development builds.' };
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
      { initialCredentialRotationRequired: true },
      { initialCredentialRotationRequired: false },
      'Mandatory first-login credential rotation completed'
    );
    return { ok: true };
  };

  const signOut = async () => {
    pendingRecoveryFlowRef.current = false;
    setDataError(deploymentConfigError);
    if (isSupabaseMode) {
      await signOutSupabase();
      clearSupabaseOperationalState();
    }
    setAuth({
      isAuthenticated: false,
      pendingTotpProfileId: null,
      pendingPasswordChangeProfileId: null,
      currentProfile: isSandboxMode ? auth.currentProfile : GUEST_PLACEHOLDER_PROFILE,
      activeInstructorId: '',
      mfaFactorId: null,
      mfaNeedsEnrollment: false,
      mfaEnrollment: null,
    });
  };

  const switchDemoIdentity = (role: UserRole, instructorId?: string, profileId?: string) => {
    // Demo identity switching is available only in a local development sandbox.
    if (!isSandboxMode) return;

    if (role === UserRole.ADMIN) {
      const adminProf =
        (profileId
          ? profiles.find((p) => p.id === profileId && p.role === UserRole.ADMIN && p.isActive)
          : undefined) ||
        profiles.find((p) => p.role === UserRole.ADMIN && p.isActive) ||
        INITIAL_PROFILES[0];
      setAdminRoute('dashboard');
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
      const inst =
        (instructorId ? instructors.find((i) => i.id === instructorId) : undefined) ||
        (profileId ? instructors.find((i) => i.profileId === profileId) : undefined) ||
        instructors.find((i) => i.id === (auth.activeInstructorId || 'inst-1')) ||
        instructors[0];
      const instProf =
        (profileId
          ? profiles.find((p) => p.id === profileId && p.role === UserRole.INSTRUCTOR)
          : undefined) ||
        profiles.find((p) => p.id === inst?.profileId) ||
        INITIAL_PROFILES[2];
      setInstructorRoute('dashboard');
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

  const createRoom = async (input: {
    venueId: string;
    code: string;
    name: string;
    capacity: number;
  }): Promise<ActionResult> => {
    if (!venues.some(v => v.id === input.venueId)) {
      return { ok: false, error: 'Choose a configured training venue first.' };
    }
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(input.code.trim().toUpperCase())) {
      return { ok: false, error: 'Room code must be 1–32 letters, digits, underscores or hyphens.' };
    }
    if (!input.name.trim() || input.name.trim().length > 150) {
      return { ok: false, error: 'Enter a room name (max 150 characters).' };
    }
    if (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) {
      return { ok: false, error: 'Room capacity must be 1–1000.' };
    }

    if (isSupabaseMode) {
      try {
        await createRoomInDb(input);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed creating room.' };
      }
    }
    if (!import.meta.env.DEV) {
      return { ok: false, error: 'A real Supabase connection is required to add rooms.' };
    }
    setRooms(prev => [...prev, { id: crypto.randomUUID(), venueId: input.venueId,
      code: input.code.trim().toUpperCase(), name: input.name.trim(), capacity: input.capacity }]);
    return { ok: true };
  };

  const createVenue = async (input: {
    nameEn: string;
    nameAr: string;
    address: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
  }): Promise<ActionResult> => {
    if (!input.nameEn.trim() || !input.nameAr.trim() || !input.address.trim()) {
      return { ok: false, error: 'Venue names and physical address are required.' };
    }
    if (!Number.isFinite(input.latitude) || input.latitude < -90 ||
        input.latitude > 90 || !Number.isFinite(input.longitude) ||
        input.longitude < -180 || input.longitude > 180) {
      return { ok: false, error: 'Enter valid GPS coordinates for the real venue.' };
    }
    if (!Number.isInteger(input.geofenceRadiusMeters) ||
        input.geofenceRadiusMeters < 25 || input.geofenceRadiusMeters > 1000) {
      return { ok: false, error: 'Geofence radius must be 25–1000 meters.' };
    }

    if (isSupabaseMode) {
      try {
        await createVenueInDb(input);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed adding venue.' };
      }
    }

    // Non-production local sandbox only: never seed real backend coordinates.
    if (!import.meta.env.DEV) {
      return { ok: false, error: 'A real Supabase connection is required to add venues.' };
    }
    setVenues(prev => [...prev, { id: crypto.randomUUID(), ...input }]);
    return { ok: true };
  };

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
          effectiveDay: activeCamp.currentCampDay,
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

  const provisionInstructor = async (
    input: ProvisionInstructorInput
  ): Promise<ProvisionInstructorOutcome> => {
    if (
      !auth.isAuthenticated ||
      auth.currentProfile.role !== UserRole.ADMIN ||
      !auth.currentProfile.isActive
    ) {
      return {
        ok: false,
        statusCode: 403,
        error: t(
          'Only active, authenticated administrators may provision instructor accounts.',
          'يُسمح فقط للمسؤولين النشطين والمصادق عليهم بإنشاء حسابات المحاضرين.'
        ),
      };
    }

    if (isSupabaseMode) {
      const outcome = await provisionInstructorViaEdgeFunction(input);
      if (outcome.ok) {
        await refreshOperationalData();
      }
      return outcome;
    }

    if (!import.meta.env.DEV) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Supabase configuration is required for instructor provisioning in production.',
      };
    }

    const validation = validateProvisionInstructorInput(input, {
      emails: profiles.map((p) => p.email),
      usernames: profiles.map((p) => p.username),
      instructorCodes: instructors.map((i) => i.instructorCode),
    });

    if (!validation.valid) {
      return {
        ok: false,
        statusCode: 400,
        error: validation.errors[0] || 'Invalid instructor provisioning input.',
        fieldErrors: validation.fieldErrors,
      };
    }

    const normalized = validation.normalized;
    if (normalized.assignToCampId) {
      const targetCamp = camps.find((c) => c.id === normalized.assignToCampId);
      if (!targetCamp) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Selected camp was not found.',
          fieldErrors: { assignToCampId: 'Selected camp was not found.' },
        };
      }
      if (targetCamp.status === CampStatus.ARCHIVED) {
        return {
          ok: false,
          statusCode: 409,
          error: 'Cannot assign an instructor to an archived camp.',
          fieldErrors: { assignToCampId: 'Cannot assign an instructor to an archived camp.' },
        };
      }
    }

    const nowIso = new Date().toISOString();
    const newProfileId = `prof-inst-${Date.now()}`;
    const newInstructorId = `inst-${Date.now()}`;
    const oneTimeTempPassword =
      normalized.deliveryMode === 'temporary_password'
        ? normalized.temporaryPassword || generateSecureTemporaryPassword()
        : undefined;

    const newProfile: Profile = {
      id: newProfileId,
      role: UserRole.INSTRUCTOR,
      username: normalized.username,
      email: normalized.email,
      fullNameEn: normalized.fullNameEn,
      fullNameAr: normalized.fullNameAr,
      phone: normalized.phone || '',
      mustChangePassword: true,
      isActive: normalized.isActive,
      createdAt: nowIso,
    };

    const newInstructor: Instructor = {
      id: newInstructorId,
      profileId: newProfileId,
      instructorCode: normalized.instructorCode,
      username: normalized.username,
      email: normalized.email,
      fullNameEn: normalized.fullNameEn,
      fullNameAr: normalized.fullNameAr,
      phone: normalized.phone || '',
      bio: normalized.bio || undefined,
      specialization: normalized.specialization,
      defaultLectureRateEgp: normalized.defaultLectureRateEgp,
      isActive: normalized.isActive,
    };

    setProfiles((prev) => [...prev, newProfile]);
    setInstructors((prev) => [...prev, newInstructor]);

    if (normalized.assignToCampId) {
      setCampInstructorIds((prev) => {
        const list = prev[normalized.assignToCampId!] || [];
        return {
          ...prev,
          [normalized.assignToCampId!]: Array.from(new Set([...list, newInstructorId])),
        };
      });
    }

    appendSandboxAudit(
      'INSTRUCTOR_ACCOUNT_PROVISIONED',
      'instructors',
      newInstructorId,
      null,
      {
        profile_id: newProfileId,
        instructor_code: normalized.instructorCode,
        username: normalized.username,
        email: normalized.email,
        default_lecture_rate_egp: normalized.defaultLectureRateEgp,
        is_active: normalized.isActive,
        onboarding_mode:
          normalized.deliveryMode === 'invite_email' ? 'invite_email' : 'one_time_temp_credential',
        onboarding_rotation_required: true,
        assigned_camp_id: normalized.assignToCampId,
      },
      'Admin provisioned instructor account in local operational sandbox',
      normalized.assignToCampId
    );

    return {
      ok: true,
      profileId: newProfileId,
      instructorId: newInstructorId,
      instructorCode: normalized.instructorCode,
      username: normalized.username,
      email: normalized.email,
      fullNameEn: normalized.fullNameEn,
      fullNameAr: normalized.fullNameAr,
      specialization: normalized.specialization,
      defaultLectureRateEgp: normalized.defaultLectureRateEgp,
      phone: normalized.phone,
      bio: normalized.bio,
      isActive: normalized.isActive,
      mustChangePassword: true,
      assignedCampId: normalized.assignToCampId,
      deliveryMode: normalized.deliveryMode,
      ...(oneTimeTempPassword ? { initialTemporaryPassword: oneTimeTempPassword } : {}),
    };
  };

  const updateInstructorAccount = async (input: {
    instructorId: string;
    profileId: string;
    fullNameEn?: string;
    fullNameAr?: string;
    phone?: string;
    bio?: string;
    specialization: string;
    defaultLectureRateEgp: number;
    isActive: boolean;
    assignedToActiveCamp: boolean;
  }): Promise<ActionResult> => {
    if (
      !auth.isAuthenticated ||
      auth.currentProfile.role !== UserRole.ADMIN ||
      !auth.currentProfile.isActive
    ) {
      return {
        ok: false,
        error: t(
          'Only active administrators can update instructor accounts.',
          'فقط المسؤولون النشطون يمكنهم تعديل حسابات المحاضرين.'
        ),
      };
    }

    if (isSupabaseMode) {
      try {
        await updateInstructorInDb({
          instructorId: input.instructorId,
          profileId: input.profileId,
          fullNameEn: input.fullNameEn,
          fullNameAr: input.fullNameAr,
          phone: input.phone,
          bio: input.bio,
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
              fullNameEn:
                input.fullNameEn !== undefined && input.fullNameEn.trim()
                  ? input.fullNameEn.trim()
                  : inst.fullNameEn,
              fullNameAr:
                input.fullNameAr !== undefined && input.fullNameAr.trim()
                  ? input.fullNameAr.trim()
                  : inst.fullNameAr,
              phone: input.phone !== undefined ? input.phone.trim() : inst.phone,
              bio: input.bio !== undefined ? input.bio.trim() : inst.bio,
              specialization: input.specialization.trim(),
              defaultLectureRateEgp: Math.max(0, Math.round(input.defaultLectureRateEgp)),
              isActive: input.isActive,
            }
          : inst
      )
    );
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === input.profileId
          ? {
              ...p,
              fullNameEn:
                input.fullNameEn !== undefined && input.fullNameEn.trim()
                  ? input.fullNameEn.trim()
                  : p.fullNameEn,
              fullNameAr:
                input.fullNameAr !== undefined && input.fullNameAr.trim()
                  ? input.fullNameAr.trim()
                  : p.fullNameAr,
              phone: input.phone !== undefined ? input.phone.trim() : p.phone,
              isActive: input.isActive,
            }
          : p
      )
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
      'Instructor profile, defaults & active status updated (existing lecture frozen rates preserved)'
    );
    return { ok: true };
  };

  const triggerInstructorPasswordReset = async (instructorId: string): Promise<ActionResult> => {
    if (
      !auth.isAuthenticated ||
      auth.currentProfile.role !== UserRole.ADMIN ||
      !auth.currentProfile.isActive
    ) {
      return {
        ok: false,
        error: t(
          'Only active administrators can initiate account recovery.',
          'فقط المسؤولون النشطون يمكنهم بدء استعادة الحساب.'
        ),
      };
    }

    const inst = instructors.find((i) => i.id === instructorId);
    if (!inst) {
      return { ok: false, error: t('Instructor not found.', 'تعذر العثور على المحاضر.') };
    }

    if (isSupabaseMode) {
      try {
        await markProfileMustChangePassword(inst.profileId);
        await sendInstructorPasswordResetEmail(inst.email);
        await refreshOperationalData();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to send recovery email.',
        };
      }
    }

    setProfiles((prev) =>
      prev.map((p) => (p.id === inst.profileId ? { ...p, mustChangePassword: true } : p))
    );
    appendSandboxAudit(
      'INSTRUCTOR_RECOVERY_INITIATED',
      'profiles',
      inst.profileId,
      null,
      {
        instructor_id: inst.id,
        email: inst.email,
        onboarding_rotation_required: true,
      },
      'Admin initiated instructor recovery and enforced next-login credential rotation'
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

  const enrollMidcampStudent = async (input: {
    groupId: string;
    studentCode: string;
    fullName: string;
    university: string;
    reason: string;
  }): Promise<ActionResult> => {
    if (!activeCamp || activeCamp.status !== CampStatus.ACTIVE) {
      return { ok: false, error: 'Student enrollment is available only during an ACTIVE camp.' };
    }
    if (!auth.isAuthenticated || auth.currentProfile.role !== UserRole.INSTRUCTOR) {
      return { ok: false, error: 'Only an assigned Instructor can enroll a new student.' };
    }
    if (!isSupabaseMode) {
      return { ok: false, error: 'Secure mid-camp enrollment requires the server.' };
    }
    if (!input.reason.trim() || !input.fullName.trim() || !input.studentCode.trim()) {
      return { ok: false, error: 'Name, unique student code and enrollment reason are required.' };
    }
    const assigned = lectures.some(l =>
      l.campId === activeCamp.id && l.groupId === input.groupId &&
      (l.substituteInstructorId || l.instructorId) === auth.activeInstructorId
    ) || groups.some(g =>
      g.campId === activeCamp.id && g.id === input.groupId &&
      g.primaryInstructorId === auth.activeInstructorId
    );
    if (!assigned) {
      return { ok: false, error: 'You can only enroll students into a group assigned to you.' };
    }
    try {
      // Server RPC enforces current assignment, capacity, uniqueness,
      // server-derived join day/timestamp and audit. No client-supplied day.
      await instructorEnrollMidcampStudentInDb(input);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Student enrollment failed.' };
    }
    await refreshOperationalData();
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
      (s) =>
        s.campId === activeCamp.id &&
        s.isActive &&
        resolveStudentOriginGroupForDay({
          student: s,
          transfers: studentTransfers,
          campDay: input.campDay,
        }) === input.groupId
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

    const gpsCheck = validateGpsCoordinates(
      input.latitude,
      input.longitude,
      input.gpsAccuracyMeters
    );
    if (!gpsCheck.valid) {
      return {
        ok: false,
        message: gpsCheck.error || 'Invalid GPS coordinates.',
        status: CheckinStatus.EXCEPTION_PENDING,
      };
    }

    if (isSupabaseMode) {
      let uploadedPath: string | null = null;
      try {
        if (input.selfieBlob && input.selfieExt && input.selfieMimeType) {
          uploadedPath = await uploadCheckinSelfie({
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
          selfieStoragePath: uploadedPath,
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
        if (uploadedPath) {
          await deleteCheckinSelfiePath(uploadedPath);
        }
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

    let syncState = OfflineSyncState.OFFLINE;
    let dbSyncError: string | null = null;
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
        if (!supabaseCtx) throw new Error('Authenticated connection is unavailable.');
        // Check against fresh authorized server state BEFORE ANY DB upsert.
        // Never overwrite a newer/other-Instructor saved draft silently.
        const latest = await fetchOperationalSnapshot(supabaseCtx);
        const remote = latest.attendanceSheets.find(sheet =>
          sheet.lectureId === lectureId && sheet.campId === activeCamp.id);
        if (!remote || remote.status !== AttendanceSheetStatus.DRAFT) {
          throw new Error('Server draft missing or already finalized. Refresh and review before syncing.');
        }
        const conflicts = compareAttendanceDraftRows(records, remote.records);
        if (conflicts.length) {
          throw new Error(
            `Draft conflict for ${conflicts.length} student(s): no server changes were made. ` +
            'Review local and server marks before syncing.'
          );
        }
        await saveAttendanceRecordsDraftToDb({
          campId: activeCamp.id,
          lecture: lec,
          sheetId: remote.id,
          records,
          updatedBy: auth.currentProfile.id,
        });
      } catch (err) {
        syncState = OfflineSyncState.FAILED;
        dbSyncError =
          err instanceof Error
            ? err.message
            : 'Saved offline locally, but server draft sync failed.';
        await saveOfflineAttendanceDraft({
          lectureId,
          campId: activeCamp.id,
          instructorId: lec.substituteInstructorId || lec.instructorId,
          idempotencyKey,
          syncState,
          records,
          updatedAt: new Date().toISOString(),
        });
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
    if (dbSyncError) {
      return {
        ok: false,
        error: `Draft saved locally (Offline), server sync failed: ${dbSyncError}`,
      };
    }
    return { ok: true };
  };

  const downloadTenDayAttendanceWorkbook = async (): Promise<ActionResult> => {
    if (!activeCamp || !isSupabaseMode || !supabaseCtx) {
      return { ok: false, error: 'Official attendance export requires a connected server Camp.' };
    }
    if (!auth.isAuthenticated || auth.currentProfile.role !== UserRole.ADMIN) {
      return { ok: false, error: 'Only an authenticated Admin can download official attendance reports.' };
    }
    try {
      // Do NOT export cached/offline Instructor draft overlays: fetch a fresh
      // authenticated Admin snapshot and include only server-finalized sheets.
      const latest = await fetchOperationalSnapshot(supabaseCtx);
      const camp = latest.camps.find(c => c.id === activeCamp.id);
      if (!camp) return { ok: false, error: 'Selected Camp was not found on the server.' };
      if (camp.durationDays !== 10) {
        return { ok: false, error: 'The handover workbook currently supports ten-day camps only.' };
      }
      const workbook = buildCampAttendanceWorkbook({
        camp,
        groups: latest.groups.filter(g => g.campId === camp.id),
        students: latest.students.filter(s => s.campId === camp.id),
        lectures: latest.lectures.filter(l => l.campId === camp.id),
        attendanceSheets: latest.attendanceSheets.filter(s => s.campId === camp.id),
        studentTransfers: latest.studentTransfers.filter(tr => tr.campId === camp.id),
      });
      const fileName = 'Operation-LMS-' +
        camp.code.replace(/[^A-Za-z0-9_-]/g,'_') + '-10day-attendance.xlsx';
      const url = URL.createObjectURL(workbook);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Attendance export failed.' };
    }
  };

  const reviewAttendanceDraft = async (lectureId: string): Promise<{
    ok: boolean;
    error?: string;
    rows?: {
      studentId: string;
      studentCode: string;
      studentName: string;
      localMark: string;
      serverMark: string;
      localNote?: string;
      serverNote?: string;
    }[];
  }> => {
    if (!isSupabaseMode || !supabaseCtx || !activeCamp) {
      return { ok: false, error: 'Server draft comparison requires an authenticated Staging connection.' };
    }
    if (auth.currentProfile.role !== UserRole.INSTRUCTOR || !auth.activeInstructorId) {
      return { ok: false, error: 'Only the assigned Instructor can review their draft.' };
    }
    const lecture = lectures.find(l =>
      l.id === lectureId && l.campId === activeCamp.id &&
      (l.substituteInstructorId || l.instructorId) === auth.activeInstructorId
    );
    if (!lecture) return { ok: false, error: 'Lecture is not assigned to your Instructor account.' };

    try {
      // Use only the latest authorized server snapshot; the context sheet
      // can be overlaid by this browser's offline IndexedDB draft.
      const latest = await fetchOperationalSnapshot(supabaseCtx);
      const remote = latest.attendanceSheets.find(sheet =>
        sheet.lectureId === lectureId && sheet.campId === activeCamp.id);
      if (!remote || remote.status !== AttendanceSheetStatus.DRAFT) {
        return { ok: false, error: 'Server draft has already changed or was finalized. No data sent.' };
      }
      const localDraft = await getOfflineAttendanceDraft(lectureId);
      if (!localDraft || localDraft.campId !== activeCamp.id ||
          localDraft.instructorId !== auth.activeInstructorId) {
        return { ok: false, error: 'No local draft exists for this Instructor and lecture.' };
      }
      const localById = new Map(localDraft.records.map(row => [row.studentId, row]));
      const remoteById = new Map(remote.records.map(row => [row.studentId, row]));
      const differentIds = compareAttendanceDraftRows(localDraft.records, remote.records);
      const rows = differentIds.map(id => {
        const local = localById.get(id);
        const server = remoteById.get(id);
        return {
          studentId: id,
          studentCode: local?.studentCode || server?.studentCode || id.slice(0,8),
          studentName: local?.studentName || server?.studentName || 'Student',
          localMark: local?.mark || 'unmarked',
          serverMark: server?.mark || 'unmarked',
          localNote: local?.note,
          serverNote: server?.note,
        };
      });
      return { ok: true, rows };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to review drafts.' };
    }
  };

  const submitAndSyncAttendanceSheet = async (lectureId: string): Promise<ActionResult> => {
    if (!activeCamp) return { ok: false, error: 'No active camp selected.' };
    const sheet = attendanceSheets.find((s) => s.lectureId === lectureId);
    const lec = lectures.find((l) => l.id === lectureId);
    if (!sheet || !lec) {
      return { ok: false, error: 'Attendance sheet not found for this lecture.' };
    }

    // Shared authorization gate: protects BOTH Instructor and Admin UI
    // before any draft records are uploaded or submit RPC is called.
    const cairoParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const dateValue = (part: string) => cairoParts.find(x => x.type === part)?.value || '';
    const cairoToday = `${dateValue('year')}-${dateValue('month')}-${dateValue('day')}`;
    if (activeCamp.status !== CampStatus.ACTIVE || lec.lectureDate > cairoToday) {
      return {
        ok: false,
        error: 'Final attendance submission requires an ACTIVE camp and the scheduled lecture date to have arrived (Africa/Cairo). Draft edits remain available.',
      };
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
        if (!supabaseCtx) throw new Error('Authentication context is unavailable. Sign in and retry.');
        // Fail closed: re-read authoritative server records immediately before
        // writing. A local IndexedDB draft must NEVER silently replace a
        // different server draft (e.g., 002 Present/003 Late locally vs
        // 002 Late/003 Absent saved on the server).
        const latest = await fetchOperationalSnapshot(supabaseCtx);
        const serverSheet = latest.attendanceSheets.find(s =>
          s.lectureId === lectureId && s.campId === activeCamp.id
        );
        if (!serverSheet || serverSheet.status !== AttendanceSheetStatus.DRAFT) {
          throw new Error('Server attendance sheet was changed or is missing. Refresh and review before finalizing.');
        }
        const differences = compareAttendanceDraftRows(sheet.records, serverSheet.records);
        if (differences.length > 0) {
          throw new Error(
            `Local and server attendance drafts differ for ${differences.length} student(s). ` +
            'Final submission is blocked to prevent data loss. Review and reconcile the drafts before submitting.'
          );
        }
        const persistedSheetId = await saveAttendanceRecordsDraftToDb({
          campId: activeCamp.id,
          lecture: lec,
          sheetId: serverSheet.id,
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

    const cleanNote = (input.note || '').trim();
    if (!cleanNote) {
      return {
        ok: false,
        error: 'A non-empty audit reason is required to correct submitted attendance.',
      };
    }

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
      targetGroupId: groupId,
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
        isSandboxMode,
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
        createVenue,
        createRoom,
        createDraftCamp,
        updateCampAndSettings,
        activateCamp,
        archiveCamp,
        upsertGroup,
        provisionInstructor,
        updateInstructorAccount,
        triggerInstructorPasswordReset,
        createSingleStudent,
        enrollMidcampStudent,
        transferStudent,
        addScheduleLecture,
        updateScheduleLecture,
        acknowledgeLecture,
        submitInstructorCheckin,
        reviewCheckinException,
        saveAttendanceDraft,
        submitAndSyncAttendanceSheet,
        reviewAttendanceDraft,
        downloadTenDayAttendanceWorkbook,
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
