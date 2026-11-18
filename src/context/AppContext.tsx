import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  AdminAccount,
  AdminRouteId,
  AttendanceRecordItem,
  AttendanceSheet,
  AttendanceSheetStatus,
  AuditLogEntry,
  Camp,
  CampStatus,
  CheckinStatus,
  DailyCheckin,
  DailyChecklistItem,
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
  createValidatedAuditLogEntry,
  evaluateDailyCheckin,
  evaluateLectureEntitlement,
  finalizeAttendanceSubmission,
  RawStudentImportRow,
  validateCampActivation,
  validateCampNotArchived,
  validateLectureScheduleSlot,
  validateStudentBatchImport,
} from '../domain/businessRules';
import {
  deleteOfflineAttendanceDraft,
  saveOfflineAttendanceDraft,
} from '../services/offlineDraftDB';

export type Language = 'en' | 'ar';
export type ThemeMode = 'dark' | 'light';

interface AuthFlowState {
  isAuthenticated: boolean;
  pendingTotpProfileId: string | null;
  pendingPasswordChangeProfileId: string | null;
  currentProfile: Profile;
  activeInstructorId: string; // For Instructor portal scope
}

interface AppContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  t: (en: string, ar: string) => string;

  // Auth & Navigation
  auth: AuthFlowState;
  loginWithCredentials: (identifier: string, password: string) => { ok: boolean; step?: 'totp' | 'password_change' | 'done'; error?: string };
  verifyAdminTotp: (code: string) => { ok: boolean; error?: string };
  completeFirstLoginPasswordChange: (newPassword: string) => { ok: boolean; error?: string };
  signOut: () => void;
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
  activeCamp: Camp;
  groups: Group[];
  students: Student[];
  lectures: Lecture[];
  checkins: DailyCheckin[];
  attendanceSheets: AttendanceSheet[];
  entitlements: LectureEntitlement[];
  requests: InstructorRequestItem[];
  issues: OperationalIssue[];
  checklists: DailyChecklistItem[];
  surveys: SurveyLinkItem[];
  auditLogs: AuditLogEntry[];

  // Actions
  createDraftCamp: (input: {
    code: string;
    nameEn: string;
    nameAr: string;
    startDate: string;
    durationDays: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
  }) => { ok: boolean; error?: string };
  activateCamp: (campId: string) => { ok: boolean; error?: string };
  archiveCamp: (campId: string) => { ok: boolean; error?: string };

  addScheduleLecture: (input: {
    campDay: number;
    periodNumber: number;
    groupId: string;
    instructorId: string;
    roomId: string;
    topic: string;
  }) => { ok: boolean; errors?: string[] };
  acknowledgeLecture: (lectureId: string) => void;

  submitInstructorCheckin: (input: {
    instructorId: string;
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    selfieSizeKb: number;
    checkinTimeHHMM: string;
    exceptionReason?: string;
  }) => { ok: boolean; message: string; status: CheckinStatus };

  saveAttendanceDraft: (
    lectureId: string,
    records: AttendanceRecordItem[],
    simulateOffline: boolean
  ) => Promise<void>;
  submitAndSyncAttendanceSheet: (lectureId: string) => Promise<{ ok: boolean; error?: string }>;

  reviewLectureEntitlement: (
    entitlementId: string,
    decision: 'approved' | 'excluded',
    reason: string
  ) => { ok: boolean; error?: string };

  reviewInstructorRequest: (
    requestId: string,
    decision: RequestStatus.APPROVED | RequestStatus.REJECTED,
    note: string
  ) => void;

  submitInstructorRequest: (input: {
    requestType: InstructorRequestItem['requestType'];
    subject: string;
    details: string;
  }) => void;

  importStudentsBatch: (
    rows: RawStudentImportRow[],
    groupId: string,
    mode: 'strict_insert' | 'smart_update'
  ) => { ok: boolean; errors: { rowNumber: number; message: string }[]; inserted: number; updated: number };

  toggleChecklistItem: (itemId: string) => void;
  createOperationalIssue: (input: {
    roomId: string;
    category: string;
    title: string;
    description: string;
    severity: IssueSeverity;
  }) => void;
  resolveOperationalIssue: (issueId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>('en');
  const [theme, setTheme] = useState<ThemeMode>('dark');

  const [profiles, setProfiles] = useState<Profile[]>(INITIAL_PROFILES);
  const [adminAccounts] = useState<AdminAccount[]>(INITIAL_ADMIN_ACCOUNTS);
  const [instructors] = useState<Instructor[]>(INITIAL_INSTRUCTORS);
  const [venues] = useState<Venue[]>(INITIAL_VENUES);
  const [rooms] = useState<Room[]>(INITIAL_ROOMS);
  const [camps, setCamps] = useState<Camp[]>(INITIAL_CAMPS);
  const [groups] = useState<Group[]>(INITIAL_GROUPS);
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS);
  const [lectures, setLectures] = useState<Lecture[]>(INITIAL_LECTURES);
  const [checkins, setCheckins] = useState<DailyCheckin[]>(INITIAL_CHECKINS);
  const [attendanceSheets, setAttendanceSheets] = useState<AttendanceSheet[]>(INITIAL_ATTENDANCE_SHEETS);
  const [entitlements, setEntitlements] = useState<LectureEntitlement[]>(INITIAL_ENTITLEMENTS);
  const [requests, setRequests] = useState<InstructorRequestItem[]>(INITIAL_REQUESTS);
  const [issues, setIssues] = useState<OperationalIssue[]>(INITIAL_ISSUES);
  const [checklists, setChecklists] = useState<DailyChecklistItem[]>(INITIAL_CHECKLISTS);
  const [surveys] = useState<SurveyLinkItem[]>(INITIAL_SURVEYS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);

  const [auth, setAuth] = useState<AuthFlowState>({
    isAuthenticated: true,
    pendingTotpProfileId: null,
    pendingPasswordChangeProfileId: null,
    currentProfile: INITIAL_PROFILES[0], // Starts authenticated as Admin 1 for instant operational use
    activeInstructorId: 'inst-1',
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

  const activeCamp = camps.find((c) => c.status === CampStatus.ACTIVE) || camps[0];

  const appendAudit = (
    action: string,
    entityType: string,
    entityId: string,
    previousValue: unknown,
    newValue: unknown,
    reason: string
  ) => {
    const validated = createValidatedAuditLogEntry({
      actorProfileId: auth.currentProfile.id,
      actorName: auth.currentProfile.fullNameEn,
      actorRole: auth.currentProfile.role,
      campId: activeCamp.id,
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

  // Authentication Flow (Username or Email resolution + Admin TOTP MFA + First-Login Password Change)
  const loginWithCredentials = (identifier: string, password: string) => {
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
    });
    return { ok: true, step: 'done' as const };
  };

  const verifyAdminTotp = (code: string) => {
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      return {
        ok: false,
        error: t(
          'Enter a valid 6-digit authenticator code (e.g., 123456).',
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
    appendAudit('ADMIN_LOGIN_MFA', 'admin_accounts', profile.id, null, { mfa: 'verified' }, 'TOTP MFA verified');
    return { ok: true };
  };

  const completeFirstLoginPasswordChange = (newPassword: string) => {
    if (newPassword.trim().length < 8) {
      return {
        ok: false,
        error: t(
          'New password must be at least 8 characters long.',
          'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.'
        ),
      };
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
    appendAudit(
      'FIRST_LOGIN_PASSWORD_UPDATED',
      'profiles',
      targetId,
      { mustChangePassword: true },
      { mustChangePassword: false },
      'Mandatory first-login password change completed'
    );
    return { ok: true };
  };

  const signOut = () => {
    setAuth((prev) => ({
      ...prev,
      isAuthenticated: false,
      pendingTotpProfileId: null,
      pendingPasswordChangeProfileId: null,
    }));
  };

  const switchDemoIdentity = (role: UserRole, instructorId?: string) => {
    if (role === UserRole.ADMIN) {
      const adminProf = profiles.find((p) => p.role === UserRole.ADMIN)!;
      setAuth({
        isAuthenticated: true,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: null,
        currentProfile: adminProf,
        activeInstructorId: auth.activeInstructorId,
      });
    } else {
      const targetInstId = instructorId || auth.activeInstructorId || 'inst-1';
      const inst = instructors.find((i) => i.id === targetInstId) || instructors[0];
      const instProf =
        profiles.find((p) => p.id === inst.profileId) || INITIAL_PROFILES[2];
      setAuth({
        isAuthenticated: true,
        pendingTotpProfileId: null,
        pendingPasswordChangeProfileId: null,
        currentProfile: { ...instProf, mustChangePassword: false },
        activeInstructorId: inst.id,
      });
    }
  };

  const createDraftCamp = (input: {
    code: string;
    nameEn: string;
    nameAr: string;
    startDate: string;
    durationDays: number;
    geofenceRadiusMeters: number;
    defaultRateEgp: number;
  }) => {
    if (!input.code.trim() || !input.nameEn.trim() || !input.startDate) {
      return { ok: false, error: 'Camp code, English name, and start date are required.' };
    }
    const start = new Date(input.startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + Math.max(1, input.durationDays - 1));
    const endDateStr = end.toISOString().split('T')[0];

    const newCamp: Camp = {
      id: `camp-${Date.now()}`,
      code: input.code.trim().toUpperCase(),
      nameEn: input.nameEn.trim(),
      nameAr: input.nameAr.trim() || input.nameEn.trim(),
      status: CampStatus.DRAFT,
      venueId: venues[0].id,
      startDate: input.startDate,
      endDate: endDateStr,
      durationDays: input.durationDays || 10,
      currentCampDay: 1,
      settings: {
        campId: `camp-${Date.now()}`,
        defaultLectureDurationHours: 3,
        maxInstructorGroupsPerDay: 4,
        geofenceRadiusMeters: input.geofenceRadiusMeters || 100,
        firstLectureLateThresholdMinutes: 60,
        maxSelfieKb: 300,
        defaultLectureRateEgp: Math.round(input.defaultRateEgp || 700),
        periodSlots: activeCamp.settings.periodSlots,
      },
    };
    setCamps((prev) => [newCamp, ...prev]);
    appendAudit('CAMP_CREATED_DRAFT', 'camps', newCamp.id, null, { code: newCamp.code, status: 'draft' }, 'Guided camp setup completed');
    return { ok: true };
  };

  const activateCamp = (campId: string) => {
    const check = validateCampActivation(camps, campId);
    if (!check.allowed) {
      return { ok: false, error: check.error };
    }
    setCamps((prev) =>
      prev.map((c) => (c.id === campId ? { ...c, status: CampStatus.ACTIVE } : c))
    );
    appendAudit('CAMP_ACTIVATED', 'camps', campId, { status: 'draft' }, { status: 'active' }, 'Camp activated by Admin');
    return { ok: true };
  };

  const archiveCamp = (campId: string) => {
    setCamps((prev) =>
      prev.map((c) => (c.id === campId ? { ...c, status: CampStatus.ARCHIVED } : c))
    );
    // Rule 9: Delete selfies after archiving while retaining verification metadata
    appendAudit(
      'CAMP_ARCHIVED_AND_SELFIES_PURGED',
      'camps',
      campId,
      { status: 'active' },
      { status: 'archived', selfiesPurged: true },
      'Camp archived to read-only state; active camp selfies deleted per retention policy'
    );
    return { ok: true };
  };

  const addScheduleLecture = (input: {
    campDay: number,
    periodNumber: number,
    groupId: string,
    instructorId: string,
    roomId: string,
    topic: string,
  }) => {
    const archiveCheck = validateCampNotArchived(activeCamp);
    if (!archiveCheck.allowed) {
      return { ok: false, errors: [archiveCheck.error || 'Camp is archived.'] };
    }
    if (!input.topic.trim()) {
      return { ok: false, errors: ['Lecture topic is required.'] };
    }
    const validation = validateLectureScheduleSlot({
      existingLectures: lectures,
      candidate: {
        campId: activeCamp.id,
        campDay: input.campDay,
        periodNumber: input.periodNumber,
        instructorId: input.instructorId,
        groupId: input.groupId,
        roomId: input.roomId,
      },
      maxGroupsPerDay: activeCamp.settings.maxInstructorGroupsPerDay,
    });

    if (!validation.valid) {
      return { ok: false, errors: validation.conflicts };
    }

    const periodObj =
      activeCamp.settings.periodSlots.find((p) => p.period === input.periodNumber) ||
      activeCamp.settings.periodSlots[0];
    const inst = instructors.find((i) => i.id === input.instructorId) || instructors[0];

    const newLecture: Lecture = {
      id: `lec-${Date.now()}`,
      campId: activeCamp.id,
      campDay: input.campDay,
      lectureDate: '2026-11-16',
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
      frozenRateEgp: inst.defaultLectureRateEgp,
      instructorAcknowledgedAt: null,
      revisionNumber: 1,
    };

    setLectures((prev) => [...prev, newLecture]);
    appendAudit(
      'LECTURE_SCHEDULED',
      'lectures',
      newLecture.id,
      null,
      { period: newLecture.periodNumber, group: newLecture.groupId, frozenRateEgp: newLecture.frozenRateEgp },
      'Validated conflict-free lecture slot created'
    );
    return { ok: true };
  };

  const acknowledgeLecture = (lectureId: string) => {
    const now = new Date().toISOString();
    setLectures((prev) =>
      prev.map((l) => (l.id === lectureId ? { ...l, instructorAcknowledgedAt: now } : l))
    );
    appendAudit('SCHEDULE_ACKNOWLEDGED', 'lectures', lectureId, { acknowledged: false }, { acknowledgedAt: now }, 'Instructor acknowledged assigned lecture');
  };

  const submitInstructorCheckin = (input: {
    instructorId: string;
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    selfieSizeKb: number;
    checkinTimeHHMM: string;
    exceptionReason?: string;
  }) => {
    const venue = venues.find((v) => v.id === activeCamp.venueId) || venues[0];
    const instructorLecturesToday = lectures
      .filter((l) => l.campId === activeCamp.id && l.campDay === activeCamp.currentCampDay && l.instructorId === input.instructorId)
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

    const record: DailyCheckin = {
      id: `chk-${Date.now()}`,
      campId: activeCamp.id,
      instructorId: input.instructorId,
      campDay: activeCamp.currentCampDay,
      checkinDate: '2026-11-16',
      serverTimestamp: new Date().toISOString(),
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracyMeters: input.gpsAccuracyMeters,
      distanceFromVenueMeters: evalRes.distanceMeters,
      withinGeofence: evalRes.withinGeofence,
      selfieSizeKb: input.selfieSizeKb,
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

    appendAudit(
      'DAILY_CHECKIN_RECORDED',
      'daily_checkins',
      record.id,
      null,
      { distanceMeters: record.distanceFromVenueMeters, status: record.status, selfieKb: record.selfieSizeKb },
      evalRes.message
    );

    return {
      ok: true,
      message: evalRes.message,
      status: record.status,
    };
  };

  const saveAttendanceDraft = async (
    lectureId: string,
    records: AttendanceRecordItem[],
    simulateOffline: boolean
  ) => {
    const lec = lectures.find((l) => l.id === lectureId);
    if (!lec) return;

    const syncState = simulateOffline ? OfflineSyncState.OFFLINE : OfflineSyncState.OFFLINE;
    const idempotencyKey = `idem-${activeCamp.id}-${lectureId}`;

    await saveOfflineAttendanceDraft({
      lectureId,
      campId: activeCamp.id,
      instructorId: lec.instructorId,
      idempotencyKey,
      syncState,
      records,
      updatedAt: new Date().toISOString(),
    });

    setAttendanceSheets((prev) => {
      const existing = prev.find((s) => s.lectureId === lectureId);
      if (existing) {
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
          instructorId: lec.instructorId,
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
  };

  const submitAndSyncAttendanceSheet = async (lectureId: string) => {
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
        s.status === AttendanceSheetStatus.SUBMITTED
    );

    const alreadyPresentIds = new Set<string>();
    for (const s of otherSheetsSamePeriod) {
      for (const r of s.records) {
        if (r.mark === 'present' || r.mark === 'late') {
          alreadyPresentIds.add(r.studentId);
        }
      }
    }

    const finalized = finalizeAttendanceSubmission({
      records: sheet.records,
      alreadyPresentStudentIdsSamePeriod: alreadyPresentIds,
    });

    if (!finalized.valid) {
      return { ok: false, error: finalized.error };
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

    // Recalculate server-side financial entitlement
    const checkin = checkins.find(
      (c) =>
        c.campId === activeCamp.id &&
        c.instructorId === lec.instructorId &&
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
          instructorId: lec.instructorId,
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

    appendAudit(
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

  const reviewLectureEntitlement = (
    entitlementId: string,
    decision: 'approved' | 'excluded',
    reason: string
  ) => {
    if (!reason.trim()) {
      return {
        ok: false,
        error: 'An audit reason is required before approving or excluding a lecture entitlement.',
      };
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

    appendAudit(
      decision === 'approved' ? 'ENTITLEMENT_APPROVED' : 'ENTITLEMENT_EXCLUDED',
      'lecture_entitlements',
      entitlementId,
      { status: target.status, amountEgp: target.entitlementAmountEgp },
      { status: newStatus, amountEgp: newAmount },
      reason.trim()
    );

    return { ok: true };
  };

  const reviewInstructorRequest = (
    requestId: string,
    decision: RequestStatus.APPROVED | RequestStatus.REJECTED,
    note: string
  ) => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === requestId ? { ...r, status: decision, reviewNote: note.trim() } : r
      )
    );
    appendAudit(
      `REQUEST_${decision.toUpperCase()}`,
      'instructor_requests',
      requestId,
      { status: 'pending' },
      { status: decision },
      note.trim() || 'Reviewed by Admin'
    );
  };

  const submitInstructorRequest = (input: {
    requestType: InstructorRequestItem['requestType'];
    subject: string;
    details: string;
  }) => {
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
    appendAudit('INSTRUCTOR_REQUEST_CREATED', 'instructor_requests', newReq.id, null, { subject: newReq.subject }, 'Submitted from Instructor Portal');
  };

  const importStudentsBatch = (
    rows: RawStudentImportRow[],
    groupId: string,
    mode: 'strict_insert' | 'smart_update'
  ) => {
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
    appendAudit(
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

  const toggleChecklistItem = (itemId: string) => {
    setChecklists((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
      )
    );
  };

  const createOperationalIssue = (input: {
    roomId: string;
    category: string;
    title: string;
    description: string;
    severity: IssueSeverity;
  }) => {
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
    appendAudit('ISSUE_REPORTED', 'issues', newIssue.id, null, { title: newIssue.title, severity: newIssue.severity }, 'Operational issue logged');
  };

  const resolveOperationalIssue = (issueId: string) => {
    setIssues((prev) =>
      prev.map((iss) =>
        iss.id === issueId ? { ...iss, status: IssueStatus.RESOLVED } : iss
      )
    );
    appendAudit('ISSUE_RESOLVED', 'issues', issueId, { status: 'open' }, { status: 'resolved' }, 'Marked resolved in Operations');
  };

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        theme,
        toggleTheme,
        t,
        auth,
        loginWithCredentials,
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
        groups,
        students,
        lectures,
        checkins,
        attendanceSheets,
        entitlements,
        requests,
        issues,
        checklists,
        surveys,
        auditLogs,
        createDraftCamp,
        activateCamp,
        archiveCamp,
        addScheduleLecture,
        acknowledgeLecture,
        submitInstructorCheckin,
        saveAttendanceDraft,
        submitAndSyncAttendanceSheet,
        reviewLectureEntitlement,
        reviewInstructorRequest,
        submitInstructorRequest,
        importStudentsBatch,
        toggleChecklistItem,
        createOperationalIssue,
        resolveOperationalIssue,
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
