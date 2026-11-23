import {
  AdminAccount,
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheet,
  AttendanceSheetStatus,
  AuditLogEntry,
  Camp,
  CampStatus,
  CheckinStatus,
  EntitlementStatus,
  Lecture,
  LectureEntitlement,
  LectureStatus,
  OfflineSyncState,
  Profile,
  Student,
  StudentTransfer,
  UserRole,
} from '../types/database';

/** JS/PostgreSQL weekday convention: Sunday=0, Monday=1, ... Saturday=6.
 * Existing Camps without a selected pattern retain their daily schedule.
 */
export const ALL_CAMP_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function validateCampWeekdays(startDateIso: string, weekdays: readonly number[]): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateIso)) return 'Choose a valid first teaching date.';
  const date = new Date(`${startDateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== startDateIso) {
    return 'Choose a valid first teaching date.';
  }
  if (!weekdays.length || weekdays.length > 7 ||
      new Set(weekdays).size !== weekdays.length ||
      weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    return 'Select one or more different teaching weekdays (Sunday–Saturday).';
  }
  if (!weekdays.includes(date.getUTCDay())) {
    return 'The first teaching date must fall on one of the selected weekdays.';
  }
  return null;
}

/** 1-indexed teaching session date, NOT a calendar-day offset.
 * UTC calendar arithmetic avoids local timezone/DST shifts in Egypt.
 * Legacy daily camps remain identical when weekdays are omitted.
 */
export function calculateCampDayDate(
  startDateIso: string, campDay: number, weekdays: readonly number[] = ALL_CAMP_WEEKDAYS
): string {
  // Preserve legacy day=0 / negative callers as Day 1; persisted Camp/lecture
  // writes still enforce strict 1..duration in AppContext and database triggers.
  if (!Number.isSafeInteger(campDay) || campDay > 365) {
    throw new Error('Invalid camp teaching day.');
  }
  const safeDay = Math.max(1, campDay);
  const error = validateCampWeekdays(startDateIso, weekdays);
  if (error) throw new Error(error);
  const date = new Date(`${startDateIso}T00:00:00Z`);
  const selected = new Set(weekdays);
  let remaining = safeDay - 1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (selected.has(date.getUTCDay())) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve historical student origin group on a given camp_day using student_transfers timeline.
 */
export function resolveStudentOriginGroupForDay(params: {
  student: Pick<Student, 'id' | 'campId' | 'groupId'>;
  transfers: StudentTransfer[];
  campDay: number;
}): string {
  const scoped = params.transfers.filter(
    (t) => t.campId === params.student.campId && t.studentId === params.student.id
  );
  if (scoped.length === 0) {
    return params.student.groupId;
  }

  const onOrBefore = scoped
    .filter((t) => t.effectiveCampDay <= params.campDay)
    .sort((a, b) => {
      if (a.effectiveCampDay !== b.effectiveCampDay) {
        return b.effectiveCampDay - a.effectiveCampDay;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

  if (onOrBefore.length > 0) {
    return onOrBefore[0].toGroupId;
  }

  const strictlyAfter = scoped
    .filter((t) => t.effectiveCampDay > params.campDay)
    .sort((a, b) => {
      if (a.effectiveCampDay !== b.effectiveCampDay) {
        return a.effectiveCampDay - b.effectiveCampDay;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });

  if (strictlyAfter.length > 0) {
    return strictlyAfter[0].fromGroupId;
  }

  return params.student.groupId;
}

/**
 * 1. Enforce Maximum Two Admin Accounts & Concurrent Creation Serialization
 */
export function validateAdminAccountCreation(
  currentAdminCount: number,
  options?: {
    existingSlots?: (1 | 2)[];
    requestedSlot?: 1 | 2;
    targetProfileRole?: UserRole;
  }
): {
  allowed: boolean;
  error?: string;
} {
  if (options?.targetProfileRole && options.targetProfileRole !== UserRole.ADMIN) {
    return {
      allowed: false,
      error: 'Profile linked to admin_accounts must have role = admin.',
    };
  }
  if (currentAdminCount >= 2) {
    return {
      allowed: false,
      error:
        'Maximum of two Admin accounts is already reached. Public or additional Admin creation is prohibited.',
    };
  }
  if (
    options?.existingSlots &&
    options?.requestedSlot &&
    options.existingSlots.includes(options.requestedSlot)
  ) {
    return {
      allowed: false,
      error: `Concurrent Admin slot conflict: Slot ${options.requestedSlot} is already assigned.`,
    };
  }
  return { allowed: true };
}

/**
 * Simulate serialized concurrent Admin creation batch (Advisory Lock + Unique Slot 1|2)
 */
export function processConcurrentAdminCreations(
  initialAdmins: AdminAccount[],
  candidates: { profileId: string; role: UserRole; requestedSlot: 1 | 2 }[]
): {
  finalAdmins: AdminAccount[];
  results: { profileId: string; allowed: boolean; error?: string }[];
} {
  const finalAdmins = [...initialAdmins];
  const results: { profileId: string; allowed: boolean; error?: string }[] = [];

  // Serialized execution under pg_advisory_xact_lock('cits_admin_accounts_creation_lock')
  for (const cand of candidates) {
    const check = validateAdminAccountCreation(finalAdmins.length, {
      existingSlots: finalAdmins.map((a) => a.assignedSlot),
      requestedSlot: cand.requestedSlot,
      targetProfileRole: cand.role,
    });

    if (!check.allowed) {
      results.push({ profileId: cand.profileId, allowed: false, error: check.error });
    } else if (finalAdmins.some((a) => a.profileId === cand.profileId)) {
      results.push({
        profileId: cand.profileId,
        allowed: false,
        error: 'Duplicate profile_id in admin_accounts.',
      });
    } else {
      finalAdmins.push({
        id: `adm-${finalAdmins.length + 1}`,
        profileId: cand.profileId,
        assignedSlot: cand.requestedSlot,
        totpEnrolled: true,
        totpVerifiedAt: new Date().toISOString(),
      });
      results.push({ profileId: cand.profileId, allowed: true });
    }
  }

  return { finalAdmins, results };
}

/**
 * Parallel Active Camps are allowed. Archived Camps cannot be reactivated.
 * Membership, lecture resource conflicts, and per-Camp dates are enforced
 * independently by database RLS and schedule triggers.
 */
export function validateCampActivation(
  camps: Pick<Camp, 'id' | 'nameEn' | 'status'>[],
  targetCampId: string
): { allowed: boolean; error?: string } {
  const target = camps.find(c => c.id === targetCampId);
  if (!target) return {allowed:false,error:'Selected Camp does not exist.'};
  if (target.status === CampStatus.ARCHIVED) {
    return {allowed:false,error:`Camp "${target.nameEn}" is archived and strictly read-only.`};
  }
  return {allowed:true};
}

export function validateCampNotArchived(camp: Pick<Camp, 'id' | 'nameEn' | 'status'>): {
  allowed: boolean;
  error?: string;
} {
  if (camp.status === CampStatus.ARCHIVED) {
    return {
      allowed: false,
      error: `Camp "${camp.nameEn}" is archived and strictly read-only under normal operations.`,
    };
  }
  return { allowed: true };
}

/**
 * 3. Haversine GPS Distance Calculation (Meters) & Geofence Check
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function validateGpsCoordinates(
  latitude: number,
  longitude: number,
  gpsAccuracyMeters: number
): { valid: boolean; error?: string } {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return {
      valid: false,
      error: 'GPS latitude must be a finite number between -90 and 90.',
    };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return {
      valid: false,
      error: 'GPS longitude must be a finite number between -180 and 180.',
    };
  }
  if (
    !Number.isFinite(gpsAccuracyMeters) ||
    gpsAccuracyMeters < 0 ||
    gpsAccuracyMeters > 500
  ) {
    return {
      valid: false,
      error: 'GPS accuracy must be between 0 and 500 meters.',
    };
  }
  return { valid: true };
}

/**
 * 4. Daily Check-in Verification (Geofence + Selfie <= 300KB + 60-Min First Lecture Rule)
 */
export function evaluateDailyCheckin(params: {
  instructorLat: number;
  instructorLng: number;
  venueLat: number;
  venueLng: number;
  geofenceRadiusMeters: number;
  selfieSizeKb: number;
  maxSelfieKb: number;
  checkinTimeHHMM: string;
  firstLectureStartHHMM: string | null;
  lateThresholdMinutes: number;
}): {
  validSelfie: boolean;
  distanceMeters: number;
  withinGeofence: boolean;
  minutesAfterFirstLecture: number;
  arrivedLateFirstLecture: boolean;
  status: CheckinStatus;
  message: string;
} {
  const {
    instructorLat,
    instructorLng,
    venueLat,
    venueLng,
    geofenceRadiusMeters,
    selfieSizeKb,
    maxSelfieKb,
    checkinTimeHHMM,
    firstLectureStartHHMM,
    lateThresholdMinutes,
  } = params;

  const validSelfie = selfieSizeKb > 0 && selfieSizeKb <= maxSelfieKb;
  const distanceMeters = calculateHaversineDistanceMeters(
    instructorLat,
    instructorLng,
    venueLat,
    venueLng
  );
  const withinGeofence = distanceMeters <= geofenceRadiusMeters;

  let minutesAfterFirstLecture = 0;
  let arrivedLateFirstLecture = false;

  if (firstLectureStartHHMM) {
    const [checkH, checkM] = checkinTimeHHMM.split(':').map(Number);
    const [startH, startM] = firstLectureStartHHMM.split(':').map(Number);
    const checkTotal = checkH * 60 + checkM;
    const startTotal = startH * 60 + startM;
    minutesAfterFirstLecture = Math.max(0, checkTotal - startTotal);
    arrivedLateFirstLecture = minutesAfterFirstLecture >= lateThresholdMinutes;
  }

  if (!withinGeofence) {
    return {
      validSelfie,
      distanceMeters,
      withinGeofence: false,
      minutesAfterFirstLecture,
      arrivedLateFirstLecture,
      status: CheckinStatus.OUTSIDE_GEOFENCE,
      message: `Location is ${distanceMeters}m from venue pin (limit ${geofenceRadiusMeters}m). Exception request required.`,
    };
  }

  if (arrivedLateFirstLecture) {
    return {
      validSelfie,
      distanceMeters,
      withinGeofence: true,
      minutesAfterFirstLecture,
      arrivedLateFirstLecture: true,
      status: CheckinStatus.LATE_FIRST_LECTURE,
      message: `Checked in ${minutesAfterFirstLecture} mins after first lecture start (>= ${lateThresholdMinutes}m). First lecture flagged for Admin review.`,
    };
  }

  return {
    validSelfie,
    distanceMeters,
    withinGeofence: true,
    minutesAfterFirstLecture,
    arrivedLateFirstLecture: false,
    status: CheckinStatus.VERIFIED,
    message: `Verified inside venue geofence (${distanceMeters}m from pin).`,
  };
}

function parseTimeMinutes(hhmm?: string): number | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * 5. Schedule Conflict & Max Instructor Groups Per Day Validation
 * Enforces both Period Number and Time-Range Overlap for Instructor, Group, and Room,
 * plus configurable maxGroupsPerDay (default 4).
 */
export function validateLectureScheduleSlot(params: {
  existingLectures: Lecture[];
  candidate: {
    id?: string;
    campId: string;
    campDay: number;
    periodNumber: number;
    startTime?: string;
    endTime?: string;
    instructorId: string;
    substituteInstructorId?: string | null;
    groupId: string;
    roomId: string;
  };
  maxGroupsPerDay: number;
}): { valid: boolean; conflicts: string[] } {
  const { existingLectures, candidate, maxGroupsPerDay } = params;
  const conflicts: string[] = [];

  const candStart = parseTimeMinutes(candidate.startTime);
  const candEnd = parseTimeMinutes(candidate.endTime);
  if (candStart !== null && candEnd !== null && candEnd <= candStart) {
    conflicts.push('Lecture end time must be after start time.');
  }

  const candInstructor = candidate.substituteInstructorId || candidate.instructorId;

  const activeDayLectures = existingLectures.filter(
    (l) =>
      l.campId === candidate.campId &&
      l.campDay === candidate.campDay &&
      l.status !== LectureStatus.CANCELLED &&
      l.id !== candidate.id
  );

  for (const lec of activeDayLectures) {
    const lecStart = parseTimeMinutes(lec.startTime);
    const lecEnd = parseTimeMinutes(lec.endTime);
    const timeOverlaps =
      candStart !== null &&
      candEnd !== null &&
      lecStart !== null &&
      lecEnd !== null &&
      candStart < lecEnd &&
      candEnd > lecStart;

    const isOverlappingSlot = lec.periodNumber === candidate.periodNumber || timeOverlaps;

    if (isOverlappingSlot) {
      const activeInstructor = lec.substituteInstructorId || lec.instructorId;
      if (activeInstructor === candInstructor) {
        conflicts.push(
          `Instructor conflict: already assigned to Group ${lec.groupId} in Period ${lec.periodNumber}.`
        );
      }
      if (lec.groupId === candidate.groupId) {
        conflicts.push(
          `Group conflict: Group ${candidate.groupId} is already scheduled in Room ${lec.roomId} during Period ${lec.periodNumber}.`
        );
      }
      if (lec.roomId === candidate.roomId) {
        conflicts.push(
          `Room conflict: Room ${candidate.roomId} is already occupied by Group ${lec.groupId} during Period ${lec.periodNumber}.`
        );
      }
    }
  }

  const instructorGroupsToday = new Set(
    activeDayLectures
      .filter((l) => (l.substituteInstructorId || l.instructorId) === candInstructor)
      .map((l) => l.groupId)
  );
  instructorGroupsToday.add(candidate.groupId);

  if (instructorGroupsToday.size > maxGroupsPerDay) {
    conflicts.push(
      `Instructor exceeds maximum of ${maxGroupsPerDay} distinct groups per day.`
    );
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
}

/**
 * 6. Attendance Submission & Unmarked -> Absent Conversion + Duplicate Same-Day/Cross-Group Prevention
 */
export function finalizeAttendanceSubmission(params: {
  records: AttendanceRecordItem[];
  alreadyPresentStudentIdsSamePeriod: Set<string>;
  alreadyPresentStudentIdsSameDayOtherGroups?: Map<string, string>; // studentId -> groupId
}): {
  valid: boolean;
  error?: string;
  finalizedRecords: AttendanceRecordItem[];
  presentCount: number;
  absentCount: number;
  crossGroupCount: number;
} {
  const {
    records,
    alreadyPresentStudentIdsSamePeriod,
    alreadyPresentStudentIdsSameDayOtherGroups,
  } = params;

  const seenStudentsInSheet = new Set<string>();

  for (const rec of records) {
    // Enforce one attendance record per student per sheet
    if (seenStudentsInSheet.has(rec.studentId)) {
      return {
        valid: false,
        error: `Duplicate attendance record for student ${rec.studentCode} in the same attendance sheet.`,
        finalizedRecords: records,
        presentCount: 0,
        absentCount: 0,
        crossGroupCount: 0,
      };
    }
    seenStudentsInSheet.add(rec.studentId);

    if (rec.mark === AttendanceMark.PRESENT || rec.mark === AttendanceMark.LATE) {
      if (alreadyPresentStudentIdsSamePeriod.has(rec.studentId)) {
        return {
          valid: false,
          error: `Student ${rec.studentName} (${rec.studentCode}) is already marked present in another group for this period.`,
          finalizedRecords: records,
          presentCount: 0,
          absentCount: 0,
          crossGroupCount: 0,
        };
      }

      const otherGroup = alreadyPresentStudentIdsSameDayOtherGroups?.get(rec.studentId);
      if (otherGroup && otherGroup !== rec.attendedGroupId) {
        return {
          valid: false,
          error: `Same-day cross-group conflict: Student ${rec.studentName} (${rec.studentCode}) already attended group ${otherGroup} today.`,
          finalizedRecords: records,
          presentCount: 0,
          absentCount: 0,
          crossGroupCount: 0,
        };
      }
    }
  }

  // Rule 10: Unmarked students become absent ONLY when the attendance sheet is submitted.
  // Also preserve originGroupId and attendedGroupId accurately.
  const finalizedRecords: AttendanceRecordItem[] = records.map((rec) => ({
    ...rec,
    isCrossGroup: rec.originGroupId !== rec.attendedGroupId,
    mark: rec.mark === 'unmarked' ? AttendanceMark.ABSENT : rec.mark,
  }));

  const presentCount = finalizedRecords.filter(
    (r) => r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE
  ).length;
  const absentCount = finalizedRecords.filter(
    (r) => r.mark === AttendanceMark.ABSENT
  ).length;
  const crossGroupCount = finalizedRecords.filter(
    (r) =>
      r.isCrossGroup &&
      (r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE)
  ).length;

  return {
    valid: true,
    finalizedRecords,
    presentCount,
    absentCount,
    crossGroupCount,
  };
}

/**
 * 7. Server-Side Financial Entitlement Calculation & Uniqueness Enforcement
 */
export function evaluateLectureEntitlement(params: {
  frozenRateEgp: number;
  hasValidCheckin: boolean;
  isFirstLectureOfDay: boolean;
  arrivedLateFirstLecture: boolean;
  sheetStatus: AttendanceSheetStatus;
  syncState: OfflineSyncState;
  adminOverride?: 'approved' | 'excluded';
  adminOverrideReason?: string;
}): {
  valid: boolean;
  error?: string;
  status: EntitlementStatus;
  entitlementAmountEgp: number;
  reason: string;
} {
  const frozenWholeEgp = Math.round(params.frozenRateEgp);

  if (params.adminOverride === 'excluded' || params.adminOverride === 'approved') {
    if (!params.adminOverrideReason || !params.adminOverrideReason.trim()) {
      return {
        valid: false,
        error: 'Admin override (approval or exclusion) requires a non-empty audit reason.',
        status: EntitlementStatus.PENDING_REVIEW,
        entitlementAmountEgp: 0,
        reason: 'Missing required Admin override reason.',
      };
    }

    if (params.adminOverride === 'excluded') {
      return {
        valid: true,
        status: EntitlementStatus.EXCLUDED,
        entitlementAmountEgp: 0,
        reason: `Excluded by Admin: ${params.adminOverrideReason.trim()}`,
      };
    }

    return {
      valid: true,
      status: EntitlementStatus.APPROVED,
      entitlementAmountEgp: frozenWholeEgp,
      reason: `Approved by Admin: ${params.adminOverrideReason.trim()}`,
    };
  }

  // Never show offline or draft attendance as financially eligible
  if (
    params.sheetStatus === AttendanceSheetStatus.DRAFT ||
    params.syncState !== OfflineSyncState.SYNCED
  ) {
    return {
      valid: true,
      status: EntitlementStatus.PENDING_REVIEW,
      entitlementAmountEgp: 0,
      reason: 'Attendance sheet is still a draft or awaiting server synchronization.',
    };
  }

  if (!params.hasValidCheckin) {
    return {
      valid: true,
      status: EntitlementStatus.PENDING_REVIEW,
      entitlementAmountEgp: 0,
      reason: 'Daily GPS/selfie check-in is missing or awaiting exception review.',
    };
  }

  // First lecture 60-minute late arrival rule
  if (params.isFirstLectureOfDay && params.arrivedLateFirstLecture) {
    return {
      valid: true,
      status: EntitlementStatus.PENDING_REVIEW,
      entitlementAmountEgp: 0,
      reason:
        'Daily check-in was >= 60 minutes after first lecture start. Requires Admin review.',
    };
  }

  return {
    valid: true,
    status: EntitlementStatus.ELIGIBLE,
    entitlementAmountEgp: frozenWholeEgp,
    reason: 'Verified daily check-in and synced attendance sheet.',
  };
}

/**
 * Validate Entitlement Uniqueness (One Entitlement per Lecture) & Frozen Rate Immutability
 */
export function validateEntitlementUpsert(params: {
  existingEntitlements: LectureEntitlement[];
  lecture: Pick<Lecture, 'id' | 'campId' | 'frozenRateEgp'>;
  candidate: {
    id?: string;
    lectureId: string;
    frozenRateEgp: number;
    isInsert: boolean;
  };
}): { allowed: boolean; error?: string } {
  const { existingEntitlements, lecture, candidate } = params;

  if (candidate.frozenRateEgp !== lecture.frozenRateEgp) {
    return {
      allowed: false,
      error: `Frozen rate mismatch: Entitlement must preserve the lecture frozen rate (${lecture.frozenRateEgp} EGP).`,
    };
  }

  const duplicate = existingEntitlements.find(
    (e) => e.lectureId === candidate.lectureId && e.id !== candidate.id
  );
  if (duplicate && candidate.isInsert) {
    return {
      allowed: false,
      error: `Duplicate entitlement blocked: Lecture ${candidate.lectureId} already has entitlement ${duplicate.id}.`,
    };
  }

  return { allowed: true };
}

/**
 * 8. All-or-Nothing Student Batch Import & Smart Update Validator
 * Enforces camp-scoped Student Code uniqueness (same code allowed in different camps).
 */
export interface RawStudentImportRow {
  rowNumber: number;
  studentName: string;
  studentCode: string;
  groupCode?: string;
  university?: string;
}

export function validateStudentBatchImport(params: {
  rows: RawStudentImportRow[];
  existingStudents: Student[];
  targetCampId?: string;
  targetGroupId?: string;
  mode: 'strict_insert' | 'smart_update';
}): {
  valid: boolean;
  errors: { rowNumber: number; message: string }[];
  toInsert: RawStudentImportRow[];
  toUpdate: RawStudentImportRow[];
  unchangedCount: number;
} {
  const { rows, existingStudents, targetCampId, targetGroupId, mode } = params;
  const errors: { rowNumber: number; message: string }[] = [];
  const seenCodesInFile = new Map<string, number>();

  // Scope uniqueness strictly to targetCampId when provided
  const scopedExisting = targetCampId
    ? existingStudents.filter((s) => s.campId === targetCampId)
    : existingStudents;

  const existingByCode = new Map(
    scopedExisting.map((s) => [s.studentCode.trim().toUpperCase(), s])
  );

  const toInsert: RawStudentImportRow[] = [];
  const toUpdate: RawStudentImportRow[] = [];

  if (rows.length === 0) {
    errors.push({ rowNumber: 1, message: 'Import file contains no student rows.' });
  }

  for (const row of rows) {
    const cleanName = (row.studentName || '').trim();
    const cleanCode = (row.studentCode || '').trim().toUpperCase();

    if (!cleanName) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Row ${row.rowNumber}: Missing required "Student Name".`,
      });
    }

    if (!cleanCode) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Row ${row.rowNumber}: Missing required "Student Code".`,
      });
      continue;
    }

    if (seenCodesInFile.has(cleanCode)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Row ${row.rowNumber}: Duplicate Student Code "${cleanCode}" (already on row ${seenCodesInFile.get(cleanCode)}).`,
      });
      continue;
    }
    seenCodesInFile.set(cleanCode, row.rowNumber);

    const existing = existingByCode.get(cleanCode);
    if (existing) {
      if (mode === 'smart_update') {
        if (targetGroupId && existing.groupId !== targetGroupId) {
          errors.push({
            rowNumber: row.rowNumber,
            message: `Row ${row.rowNumber}: Student Code "${cleanCode}" is currently assigned to another group. Use Student Transfer to change groups while preserving historical attendance.`,
          });
        } else {
          toUpdate.push({ ...row, studentName: cleanName, studentCode: cleanCode });
        }
      } else {
        errors.push({
          rowNumber: row.rowNumber,
          message: `Row ${row.rowNumber}: Student Code "${cleanCode}" already exists in this camp. Enable Smart Update to update matching records.`,
        });
      }
    } else {
      toInsert.push({ ...row, studentName: cleanName, studentCode: cleanCode });
    }
  }

  // All-or-nothing rule: if any validation error exists, import none
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      toInsert: [],
      toUpdate: [],
      unchangedCount: scopedExisting.length,
    };
  }

  return {
    valid: true,
    errors: [],
    toInsert,
    toUpdate,
    unchangedCount: Math.max(0, scopedExisting.length - toUpdate.length),
  };
}

/**
 * 9. Row Level Security (RLS) Policy Evaluation Engine (Mirrors 0002 Migration Policies)
 * Tests both Allowed and Denied access across Anonymous, Instructor, and Admin actors.
 */
export interface RlsActorContext {
  role: 'anon' | 'admin' | 'instructor';
  profileId?: string;
  instructorId?: string;
  assignedCampIds?: string[];
  assignedGroupIds?: string[];
}

export interface RlsResourceTarget {
  table: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  ownerProfileId?: string;
  ownerInstructorId?: string;
  campId?: string;
  groupId?: string;
  sheetStatus?: AttendanceSheetStatus;
  attemptedRoleChange?: boolean;
  attemptedExceptionSelfApproval?: boolean;
}

export function evaluateRlsPolicy(
  actor: RlsActorContext,
  target: RlsResourceTarget
): { allowed: boolean; reason: string } {
  // 1. Anonymous users are denied access to all operational tables
  if (actor.role === 'anon') {
    return {
      allowed: false,
      reason: 'Anonymous access denied: RLS requires authenticated role on all operational tables.',
    };
  }

  // 2. Audit logs are append-only even for Admins (UPDATE/DELETE blocked by trigger & RLS)
  if (target.table === 'audit_logs' && (target.operation === 'UPDATE' || target.operation === 'DELETE')) {
    return {
      allowed: false,
      reason: 'audit_logs are immutable: UPDATE and DELETE are prohibited for all roles.',
    };
  }

  // 3. Privilege escalation protection: role is immutable after creation
  if (target.table === 'profiles' && target.operation === 'UPDATE' && target.attemptedRoleChange) {
    return {
      allowed: false,
      reason: 'Privilege escalation blocked: user role cannot be modified.',
    };
  }

  // 4. Verified CITS Admins have identical full access to authorized operational tables
  if (actor.role === 'admin') {
    return {
      allowed: true,
      reason: 'Authorized via is_cits_admin() RLS policy.',
    };
  }

  // 5. Instructor Isolation Rules
  const instId = actor.instructorId;
  const profId = actor.profileId;

  switch (target.table) {
    case 'admin_accounts':
    case 'audit_logs':
    case 'backup_records':
    case 'daily_checklists':
      return {
        allowed: false,
        reason: `Instructor access denied to restricted Admin table "${target.table}".`,
      };

    case 'profiles':
      if (target.operation === 'SELECT' || target.operation === 'UPDATE') {
        const own = Boolean(profId && target.ownerProfileId === profId);
        return {
          allowed: own,
          reason: own
            ? 'Instructor accessing own profile.'
            : 'Instructor denied access to another user profile.',
        };
      }
      return { allowed: false, reason: 'Instructors cannot INSERT or DELETE profiles.' };

    case 'instructors':
    case 'instructor_rates':
    case 'instructor_evaluations':
      if (target.operation === 'SELECT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own
            ? `Instructor reading own ${target.table}.`
            : `Instructor denied reading another instructor's ${target.table}.`,
        };
      }
      return {
        allowed: false,
        reason: `Instructors cannot modify ${target.table}.`,
      };

    case 'camps':
    case 'camp_settings':
      if (target.operation === 'SELECT') {
        const assigned = Boolean(
          target.campId && actor.assignedCampIds?.includes(target.campId)
        );
        return {
          allowed: assigned,
          reason: assigned
            ? 'Instructor reading assigned camp.'
            : 'Instructor denied reading unassigned camp.',
        };
      }
      return { allowed: false, reason: 'Instructors cannot create, update, or archive camps.' };

    case 'groups':
    case 'students':
      if (target.operation === 'SELECT') {
        const assigned = Boolean(
          (target.groupId && actor.assignedGroupIds?.includes(target.groupId)) ||
            (target.campId && actor.assignedCampIds?.includes(target.campId))
        );
        return {
          allowed: assigned,
          reason: assigned
            ? `Instructor reading permitted ${target.table}.`
            : `Instructor denied reading unassigned ${target.table}.`,
        };
      }
      return { allowed: false, reason: `Instructors cannot modify ${target.table}.` };

    case 'lectures':
      if (target.operation === 'SELECT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own
            ? 'Instructor reading own assigned lecture.'
            : 'Instructor denied reading another instructor lecture.',
        };
      }
      return {
        allowed: false,
        reason: 'Instructors cannot modify schedules or cancel lectures.',
      };

    case 'daily_checkins':
      if (target.operation === 'SELECT' || target.operation === 'INSERT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own
            ? `Instructor ${target.operation} own daily check-in.`
            : 'Instructor denied accessing another instructor check-in.',
        };
      }
      return {
        allowed: false,
        reason: 'Instructors cannot UPDATE or DELETE recorded daily check-ins.',
      };

    case 'checkin_exceptions':
    case 'instructor_requests':
      if (target.operation === 'SELECT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own ? 'Instructor reading own request.' : 'Denied reading other instructor request.',
        };
      }
      if (target.operation === 'INSERT') {
        if (target.attemptedExceptionSelfApproval) {
          return {
            allowed: false,
            reason: 'Instructors cannot approve their own exceptions or requests.',
          };
        }
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own ? 'Instructor submitting pending request.' : 'Denied impersonating another instructor.',
        };
      }
      return {
        allowed: false,
        reason: 'Instructors cannot approve, update, or delete requests/exceptions.',
      };

    case 'attendance_sheets':
    case 'attendance_records':
      if (target.operation === 'SELECT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own ? 'Instructor reading own attendance.' : 'Denied reading other instructor attendance.',
        };
      }
      if (target.operation === 'INSERT' || target.operation === 'UPDATE') {
        if (
          target.sheetStatus === AttendanceSheetStatus.SUBMITTED ||
          target.sheetStatus === AttendanceSheetStatus.LOCKED
        ) {
          return {
            allowed: false,
            reason: 'Instructors cannot modify submitted or locked attendance sheets.',
          };
        }
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own ? 'Instructor updating own draft attendance sheet.' : 'Denied modifying other instructor attendance.',
        };
      }
      return { allowed: false, reason: 'Instructors cannot DELETE attendance sheets or records.' };

    case 'lecture_entitlements':
      if (target.operation === 'SELECT') {
        const own = Boolean(instId && target.ownerInstructorId === instId);
        return {
          allowed: own,
          reason: own
            ? 'Instructor viewing own lecture entitlement.'
            : 'Instructor denied viewing another instructor entitlement.',
        };
      }
      return {
        allowed: false,
        reason: 'Instructors are strictly prohibited from modifying financial entitlements.',
      };

    default:
      return {
        allowed: false,
        reason: `Default deny for instructor on table ${target.table}.`,
      };
  }
}

/**
 * 10. Audit Log Creation & Secret-Redaction / Immutability Validator
 */
const FORBIDDEN_AUDIT_PATTERNS =
  /(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)/i;

export function createValidatedAuditLogEntry(params: {
  actorProfileId: string;
  actorName: string;
  actorRole: UserRole;
  campId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string;
}): { valid: boolean; error?: string; entry?: AuditLogEntry } {
  const prevStr = JSON.stringify(params.previousValue ?? null);
  const newStr = JSON.stringify(params.newValue ?? null);

  if (FORBIDDEN_AUDIT_PATTERNS.test(prevStr) || FORBIDDEN_AUDIT_PATTERNS.test(newStr)) {
    return {
      valid: false,
      error:
        'Security violation: Passwords, MFA secrets, tokens, and service-role keys must never be written to audit_logs.',
    };
  }

  if (!params.actorProfileId || !params.action || !params.entityType || !params.entityId) {
    return {
      valid: false,
      error: 'Audit log entry requires actorProfileId, action, entityType, and entityId.',
    };
  }

  return {
    valid: true,
    entry: {
      id: `aud-${Date.now()}`,
      actorProfileId: params.actorProfileId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      campId: params.campId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      previousValue: prevStr,
      newValue: newStr,
      reason: params.reason,
      createdAt: new Date().toISOString(),
    },
  };
}
