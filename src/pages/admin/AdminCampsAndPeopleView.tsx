import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Upload,
  ShieldAlert,
  CheckCircle2,
  Archive,
  Pencil,
  ArrowRightLeft,
  UserPlus,
  Search,
  Tent,
  Users,
  GraduationCap,
  Eye,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Power,
  X,
  Mail,
  Lock,
  Building2,
  DoorOpen,
  MapPin,
  CalendarDays,
  Layers,
  ChevronRight,
  Download,
  ClipboardCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { InstructorBulkImport } from '../../components/admin/InstructorBulkImport';
import { Camp, CampStatus, Instructor, LectureStatus, AttendanceMark, AttendanceSheetStatus, OfflineSyncState } from '../../types/database';
import { ALL_CAMP_WEEKDAYS, calculateCampDayDate, validateCampWeekdays, validateStudentBatchImport, RawStudentImportRow } from '../../domain/businessRules';
import { generateEntityCode } from '../../domain/generateEntityCode';
import { createXlsxWorkbook } from '../../services/tinyXlsxWorkbook';
import { parseStudentRosterFile } from '../../domain/studentRosterFile';
import {
  CredentialDeliveryMode,
  validateProvisionInstructorInput,
} from '../../domain/accountProvisioning';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ConfirmDialog,
  EmptyState,
  INPUT_CLASS,
  InlineBanner,
  LABEL_CLASS,
  PageHeader,
  PaginationBar,
  SELECT_CLASS,
  SURFACE_CARD,
  SURFACE_SUBTLE,
  StatusBadge,
} from '../../components/ui/UiPrimitives';

type CampFilter = 'all' | CampStatus;

const CAMP_WEEKDAYS = [
  { id: 0, en: 'Sun', ar: 'الأحد' },
  { id: 1, en: 'Mon', ar: 'الإثنين' },
  { id: 2, en: 'Tue', ar: 'الثلاثاء' },
  { id: 3, en: 'Wed', ar: 'الأربعاء' },
  { id: 4, en: 'Thu', ar: 'الخميس' },
  { id: 5, en: 'Fri', ar: 'الجمعة' },
  { id: 6, en: 'Sat', ar: 'السبت' },
];

function CampWeekdayPicker(props: {
  weekdays: number[];
  onChange: (days: number[]) => void;
  t: (en: string, ar: string) => string;
}) {
  const { weekdays, onChange, t } = props;
  const presets = [
    { en: 'Every day (legacy)', ar: 'كل يوم', days: [...ALL_CAMP_WEEKDAYS] },
    { en: 'Sat / Mon / Wed', ar: 'سبت / اثنين / أربع', days: [1,3,6] },
    { en: 'Sun / Tue / Thu', ar: 'حد / تلات / خميس', days: [0,2,4] },
  ];
  return (
    <div className="space-y-2 sm:col-span-2 lg:col-span-4">
      <p className={LABEL_CLASS}>{t('Teaching weekdays *', 'أيام الدراسة الفعلية *')}</p>
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button key={p.en} type="button" className={BTN_SECONDARY}
            aria-pressed={p.days.length===weekdays.length && p.days.every(d=>weekdays.includes(d))}
            onClick={() => onChange([...p.days])}>
            {t(p.en,p.ar)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {CAMP_WEEKDAYS.map(day => (
          <label key={day.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[#42474D] px-3 py-2 text-xs">
            <input type="checkbox" checked={weekdays.includes(day.id)}
              onChange={e => onChange(
                e.target.checked ? [...weekdays,day.id].sort((a,b)=>a-b) : weekdays.filter(d=>d!==day.id)
              )}/>
            {t(day.en,day.ar)}
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {t('Only selected weekdays count as Camp teaching days. The start date must be selected.',
           'الأيام المختارة فقط بتتحسب أيام دراسة. تاريخ البداية لازم يوافق يوم من الأيام المختارة.')}
      </p>
    </div>
  );
}

function campEndPreview(start: string, duration: number, weekdays: number[]): string | null {
  try { return calculateCampDayDate(start, duration, weekdays); }
  catch { return null; }
}
type InstructorFilter = 'all' | 'active' | 'disabled' | 'archived';

export const AdminCampsView: React.FC = () => {
  const {
    camps,
    activeCamp,
    selectCamp,
    venues,
    rooms,
    students,
    groups,
    instructors,
    campInstructorIds,
    availableCamps,
    setAdminRoute,
    createVenue,
    createRoom,
    createDraftCamp,
    updateCampAndSettings,
    activateCamp,
    archiveCamp,
    t,
  } = useApp();

  const [section,setSection]=useState<'camps'|'venues'|'rooms'>('camps');
  const [step,setStep]=useState(0);
  const [roomFilter,setRoomFilter]=useState('all');
  const [showNewCampForm, setShowNewCampForm] = useState(false);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomVenueId, setRoomVenueId] = useState(venues[0]?.id || '');
  const [roomCode, setRoomCode] = useState(() => generateEntityCode('R'));
  const [roomName, setRoomName] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(30);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);
  const [venueNameEn, setVenueNameEn] = useState('');
  const [venueNameAr, setVenueNameAr] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueLatitude, setVenueLatitude] = useState('');
  const [venueLongitude, setVenueLongitude] = useState('');
  const [venueGeofence, setVenueGeofence] = useState(100);
  const [editingCamp, setEditingCamp] = useState<Camp | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Camp | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampFilter>('all');
  const [isBusy, setIsBusy] = useState(false);

  const [code, setCode] = useState(() => generateEntityCode('CAMP'));
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [venueId, setVenueId] = useState(venues[0]?.id || '');
  const [startDate, setStartDate] = useState('');
  const [durationDays, setDurationDays] = useState(10);
  const [operatingWeekdays, setOperatingWeekdays] = useState<number[]>([...ALL_CAMP_WEEKDAYS]);
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(100);
  const [defaultRateEgp, setDefaultRateEgp] = useState(700);

  // Edit camp fields
  const [editVenueId, setEditVenueId] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editNameAr, setEditNameAr] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDurationDays, setEditDurationDays] = useState(10);
  const [editOperatingWeekdays, setEditOperatingWeekdays] = useState<number[]>([...ALL_CAMP_WEEKDAYS]);
  const [editCurrentDay, setEditCurrentDay] = useState(1);
  const [editGeofence, setEditGeofence] = useState(100);
  const [editRateEgp, setEditRateEgp] = useState(700);
  const [editMaxGroups, setEditMaxGroups] = useState(4);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!venueId && venues[0]?.id) setVenueId(venues[0].id);
  }, [venues, venueId]);

  useEffect(() => {
    if (!roomVenueId && venues[0]?.id) setRoomVenueId(venues[0].id);
  }, [venues, roomVenueId]);

  const filteredCamps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return camps.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.nameAr.toLowerCase().includes(q)
      );
    });
  }, [camps, searchQuery, statusFilter]);

  const startEdit = (camp: Camp) => {
    setEditingCamp(camp);
    setShowNewCampForm(false);
    setEditVenueId(camp.venueId);
    setEditNameEn(camp.nameEn);
    setEditNameAr(camp.nameAr);
    setEditStartDate(camp.startDate);
    setEditDurationDays(camp.durationDays);
    setEditOperatingWeekdays([...(camp.operatingWeekdays ?? ALL_CAMP_WEEKDAYS)]);
    setEditCurrentDay(camp.currentCampDay);
    setEditGeofence(camp.settings.geofenceRadiusMeters);
    setEditRateEgp(camp.settings.defaultLectureRateEgp);
    setEditMaxGroups(camp.settings.maxInstructorGroupsPerDay);
    setFeedback(null);
  };

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueLatitude.trim() || !venueLongitude.trim()) {
      setFeedback({ type: 'err', text: t('Enter actual GPS coordinates for the training venue.', 'ادخل إحداثيات المقر الفعلية.') });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await createVenue({
        venueId: editingVenueId ?? undefined,
        nameEn: venueNameEn.trim(),
        nameAr: venueNameAr.trim(),
        address: venueAddress.trim(),
        latitude: Number(venueLatitude),
        longitude: Number(venueLongitude),
        geofenceRadiusMeters: venueGeofence,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Failed to save training venue.', 'فشل حفظ المقر التدريبي.') });
      } else {
        setFeedback({ type: 'ok', text: editingVenueId ? t('Venue updated.', 'تم تعديل المقر.') : t('Training venue saved. You can now create a Camp.', 'تم حفظ المقر ويمكنك الآن إنشاء معسكر.') });
        setEditingVenueId(null);
        setVenueNameEn('');
        setVenueNameAr('');
        setVenueAddress('');
        setVenueLatitude('');
        setVenueLongitude('');
        setVenueGeofence(100);
        setShowVenueForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await createRoom({
        venueId: roomVenueId || venues[0]?.id || '',
        code: roomCode.trim(),
        name: roomName.trim(),
        capacity: roomCapacity,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Unable to save training room.', 'تعذر حفظ القاعة التدريبية.') });
      } else {
        setFeedback({ type: 'ok', text: t('Room saved. You can now assign it to a group.', 'تم حفظ القاعة ويمكن الآن ربطها بمجموعة.') });
        setRoomCode(generateEntityCode('R'));
        setRoomName('');
        setRoomCapacity(30);
        setShowRoomForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const advanceStep=()=>{
    if(step===0&&(!code.trim()||!nameEn.trim()||!venues.some(v=>v.id===venueId))){setFeedback({type:'err',text:t('Enter a code, English name and training venue.','أدخل الكود والاسم الإنجليزي والمقر التدريبي.')});return;}
    if(step===1&&(!startDate||!Number.isInteger(durationDays)||durationDays<1||durationDays>60||validateCampWeekdays(startDate,operatingWeekdays))){setFeedback({type:'err',text:t('Choose a valid start date, 1–60 teaching days and matching weekdays.','اختر تاريخ بداية صحيحاً ومن ١ إلى ٦٠ يوم دراسة وأياماً متوافقة.')});return;}
    setFeedback(null);setStep(v=>Math.min(2,v+1));
  };
  const handleCreateCamp = async (e: React.FormEvent) => {
    e.preventDefault();
    if(step<2){advanceStep();return;}
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await createDraftCamp({
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        venueId: venueId || venues[0]?.id,
        startDate,
        durationDays,
        operatingWeekdays,
        geofenceRadiusMeters,
        defaultRateEgp,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Unable to create camp.', 'تعذر إنشاء المعسكر.') });
      } else {
        setFeedback({
          type: 'ok',
          text: t(
            'Draft camp created with configured settings and geofence.',
            'تم إنشاء مسودة المعسكر بنجاح بالإعدادات المحددة.'
          ),
        });
        setCode(generateEntityCode('CAMP'));
        setNameEn('');
        setNameAr('');
        setStartDate('');
        setDurationDays(10);
        setOperatingWeekdays([...ALL_CAMP_WEEKDAYS]);
        setGeofenceRadiusMeters(100);
        setDefaultRateEgp(700);
        setShowNewCampForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCamp) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await updateCampAndSettings({
        campId: editingCamp.id,
        venueId: editVenueId,
        nameEn: editNameEn.trim(),
        nameAr: editNameAr.trim(),
        startDate: editStartDate,
        durationDays: editDurationDays,
        operatingWeekdays: editOperatingWeekdays,
        currentCampDay: editCurrentDay,
        geofenceRadiusMeters: editGeofence,
        defaultRateEgp: editRateEgp,
        maxInstructorGroupsPerDay: editMaxGroups,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Failed saving camp settings.', 'فشل حفظ إعدادات المعسكر.') });
      } else {
        setFeedback({
          type: 'ok',
          text: t('Camp settings updated.', 'تم تحديث إعدادات المعسكر.'),
        });
        setEditingCamp(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleActivate = async (campId: string) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await activateCamp(campId);
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Cannot activate camp.', 'تعذر تفعيل المعسكر.') });
      } else {
        setFeedback({ type: 'ok', text: t('Camp activated.', 'تم تفعيل المعسكر.') });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await archiveCamp(archiveTarget.id);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: t(
            'Camp archived as read-only. Active camp selfies were purged while preserving verification metadata.',
            'تمت أرشفة المعسكر للقراءة فقط وحذف الصور الشخصية مع الاحتفاظ ببيانات التحقق.'
          ),
        });
      } else {
        setFeedback({ type: 'err', text: res.error || t('Archive failed.', 'فشلت عملية الأرشفة.') });
      }
      setArchiveTarget(null);
    } finally {
      setIsBusy(false);
    }
  };

  const closeForms=()=>{setShowNewCampForm(false);setShowVenueForm(false);setShowRoomForm(false);setEditingCamp(null);setFeedback(null);};
  const changeSection=(next:typeof section)=>{if(isBusy)return;closeForms();setSection(next);};
  const openNew=()=>{closeForms();if(section==='camps'){setStep(0);setShowNewCampForm(true);}else if(section==='venues'){setEditingVenueId(null);setVenueNameEn('');setVenueNameAr('');setVenueAddress('');setVenueLatitude('');setVenueLongitude('');setVenueGeofence(100);setShowVenueForm(true);}else{setShowRoomForm(true);}};
  const formOpen=showNewCampForm||showVenueForm||showRoomForm||!!editingCamp;
  const statusName=(status:CampStatus)=>status===CampStatus.ACTIVE?t('Active','نشط'):status===CampStatus.DRAFT?t('Draft','مسودة'):status===CampStatus.ARCHIVED?t('Archived','مؤرشف'):t('Pending archive','بانتظار الأرشفة');
  const statusTone=(status:CampStatus)=>status===CampStatus.ACTIVE?'success':status===CampStatus.DRAFT?'info':status===CampStatus.PENDING_ARCHIVE?'warning':'neutral';
  return (
    <div className="camp-workspace">
      <div className="camp-page-heading"><div><p className="camp-eyebrow">{t('OPERATIONS WORKSPACE','مساحة إدارة العمليات')}</p><h1>{t('Camp Management','إدارة المعسكرات')}</h1><p>{t('Manage camps, training venues and rooms.','إدارة المعسكرات والمقرات والقاعات التدريبية.')}</p></div>
        {!formOpen&&<button type="button" className="camp-primary" disabled={isBusy||(section!=='venues'&&venues.length===0)} onClick={openNew}><Plus size={17}/>{section==='camps'?t('New Camp','إنشاء معسكر جديد'):section==='venues'?t('New Venue','إضافة مقر تدريبي'):t('New Room','إضافة قاعة')}</button>}
        {formOpen&&<button type="button" disabled={isBusy} className={BTN_SECONDARY} onClick={closeForms}><X size={16}/>{t('Close form','إغلاق النموذج')}</button>}
      </div>
      <nav className="camp-section-tabs" aria-label={t('Camp management sections','أقسام إدارة المعسكرات')}>
        {([{id:'camps',label:t('Camps','المعسكرات'),icon:Tent,count:camps.length},{id:'venues',label:t('Venues','المقرات'),icon:Building2,count:venues.length},{id:'rooms',label:t('Rooms','القاعات'),icon:DoorOpen,count:rooms.length}] as const).map(tab=><button key={tab.id} type="button" disabled={isBusy} aria-current={section===tab.id?'page':undefined} onClick={()=>changeSection(tab.id)}><tab.icon size={17}/><span>{tab.label}</span><small>{tab.count}</small></button>)}
      </nav>

      {feedback && (
        <InlineBanner
          type={feedback.type === 'ok' ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {venues.length === 0 && section!=='venues' && !formOpen && (
        <InlineBanner type="error" message={t(
          'No training venue configured. Add a venue with its real GPS coordinates before creating a Camp.',
          'لا يوجد مقر تدريبي. أضف المقر وإحداثيات GPS الفعلية قبل إنشاء المعسكر.'
        )} />
      )}

      {showRoomForm && (
        <form onSubmit={handleCreateRoom} className={`${SURFACE_CARD} camp-form p-5 sm:p-6 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('New Training Room', 'إضافة قاعة تدريبية')}
          </h2>
          <p className="text-xs text-slate-500">
            {t('Use a real room name, code and seating capacity at the selected venue.', 'سجّل اسم القاعة الحقيقي وكودها وسعتها في المقر المختار.')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="room-venue" className={LABEL_CLASS}>{t('Training Venue *', 'المقر التدريبي *')}</label>
              <select id="room-venue" className={SELECT_CLASS} required value={roomVenueId || venues[0]?.id || ''} onChange={e => setRoomVenueId(e.target.value)}>
                {venues.map(v => <option key={v.id} value={v.id}>{t(v.nameEn, v.nameAr)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="room-code" className={LABEL_CLASS}>{t('Room code *', 'كود القاعة *')}</label>
              <input id="room-code" className={INPUT_CLASS} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="R-01" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
              <button type="button" className={BTN_SECONDARY + ' mt-1'} onClick={() => setRoomCode(generateEntityCode('R'))}>{t('Generate code', 'توليد كود')}</button>
            </div>
            <div>
              <label htmlFor="room-name" className={LABEL_CLASS}>{t('Room name *', 'اسم القاعة *')}</label>
              <input id="room-name" className={INPUT_CLASS} required maxLength={150} value={roomName} onChange={e => setRoomName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="room-capacity" className={LABEL_CLASS}>{t('Capacity (seats) *', 'السعة (عدد المقاعد) *')}</label>
              <input id="room-capacity" className={INPUT_CLASS} required type="number" step="1" min={1} max={1000} value={roomCapacity} onChange={e => setRoomCapacity(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setShowRoomForm(false)}>{t('Cancel', 'إلغاء')}</button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>{isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Room', 'حفظ القاعة')}</button>
          </div>
        </form>
      )}

      {showVenueForm && (
        <form onSubmit={handleCreateVenue} className={`${SURFACE_CARD} camp-form p-5 sm:p-6 space-y-4`}>
          {editingVenueId && <p className="text-xs text-amber-700">{t('Changes affect every Camp using this venue. GPS history is protected.','التعديل يؤثر على كل الكامبات التي تستخدم هذا المقر. سجل GPS السابق محمي.')}</p>}
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {editingVenueId ? t('Edit shared venue','تعديل بيانات المقر') : t('New Training Venue', 'إضافة مقر تدريبي جديد')}
          </h2>
          <p className="text-xs text-slate-500">
            {t('Use the exact physical location; GPS check-ins use these coordinates. Never use placeholder (0,0).', 'استخدم الموقع الفعلي للمقر لأن الحضور بالـ GPS يعتمد على هذه الإحداثيات.')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="venue-name-en" className={LABEL_CLASS}>{t('Venue name (English) *', 'اسم المقر بالإنجليزية *')}</label>
              <input id="venue-name-en" className={INPUT_CLASS} required maxLength={150} value={venueNameEn} onChange={e=>setVenueNameEn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="venue-name-ar" className={LABEL_CLASS}>{t('Venue name (Arabic) *', 'اسم المقر بالعربية *')}</label>
              <input id="venue-name-ar" className={INPUT_CLASS} required maxLength={150} value={venueNameAr} onChange={e=>setVenueNameAr(e.target.value)} />
            </div>
            <div>
              <label htmlFor="venue-address" className={LABEL_CLASS}>{t('Physical address *', 'العنوان الفعلي *')}</label>
              <input id="venue-address" className={INPUT_CLASS} required maxLength={400} value={venueAddress} onChange={e=>setVenueAddress(e.target.value)} />
            </div>
            <div>
              <label htmlFor="venue-lat" className={LABEL_CLASS}>{t('Latitude (GPS) *', 'خط العرض Latitude *')}</label>
              <input id="venue-lat" className={INPUT_CLASS} type="number" step="any" min={-90} max={90} required placeholder="30.000000" value={venueLatitude} onChange={e=>setVenueLatitude(e.target.value)} />
            </div>
            <div>
              <label htmlFor="venue-long" className={LABEL_CLASS}>{t('Longitude (GPS) *', 'خط الطول Longitude *')}</label>
              <input id="venue-long" className={INPUT_CLASS} type="number" step="any" min={-180} max={180} required placeholder="31.000000" value={venueLongitude} onChange={e=>setVenueLongitude(e.target.value)} />
            </div>
            <div>
              <label htmlFor="venue-radius" className={LABEL_CLASS}>{t('GPS geofence radius (meters)', 'نطاق GPS بالمتر')}</label>
              <input id="venue-radius" className={INPUT_CLASS} type="number" min={25} max={1000} required value={venueGeofence} onChange={e=>setVenueGeofence(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setShowVenueForm(false)}>{t('Cancel','إلغاء')}</button>
            <button type="submit" className={BTN_PRIMARY} disabled={isBusy}>{isBusy ? t('Saving...','جاري الحفظ...') : t('Save Venue','حفظ المقر')}</button>
          </div>
        </form>
      )}

      {showNewCampForm && (
        <form onSubmit={handleCreateCamp} className={`${SURFACE_CARD} camp-form camp-wizard p-5 sm:p-6 space-y-4`}>
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F] pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Create New Draft Camp', 'إعداد معسكر جديد (مسودة)')}
            </h2>
          </div>

          <div className="camp-stepper" aria-label={t('Creation progress','خطوات الإنشاء')}>{[t('Basic Info','البيانات الأساسية'),t('Schedule','الجدول'),t('Settings','الإعدادات')].map((label,i)=><div key={i} data-current={step===i} data-complete={step>i} aria-current={step===i?'step':undefined}><span>{step>i?<Check size={15}/>:i+1}</span><strong>{label}</strong></div>)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {step===0&&<>

            <div>
              <label htmlFor="camp-code" className={LABEL_CLASS}>
                {t('Camp Code *', 'كود المعسكر *')}
              </label>
              <input
                id="camp-code"
                type="text"
                required
                placeholder={t('e.g. CITS-27-Q1', 'مثال: CITS-27-Q1')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
              <button type="button" className={BTN_SECONDARY + ' mt-1'} onClick={() => setCode(generateEntityCode('CAMP'))}>{t('Generate code', 'توليد كود')}</button>
            </div>
            <div>
              <label htmlFor="camp-name-en" className={LABEL_CLASS}>
                {t('Camp Name (English) *', 'اسم المعسكر (إنجليزي) *')}
              </label>
              <input
                id="camp-name-en"
                type="text"
                required
                placeholder={t('e.g. CITS Winter Bootcamp', 'اسم المعسكر بالإنجليزية')}
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="camp-name-ar" className={LABEL_CLASS}>
                {t('Camp Name (Arabic)', 'اسم المعسكر (عربي)')}
              </label>
              <input
                id="camp-name-ar"
                type="text"
                placeholder={t('Optional Arabic title', 'اسم المعسكر بالعربية')}
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="camp-venue" className={LABEL_CLASS}>
                {t('Training Venue', 'المقر التدريبي')}
              </label>
              <select
                id="camp-venue"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className={SELECT_CLASS}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t(v.nameEn, v.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            </>}
            {step===1&&<>
            <div>
              <label htmlFor="camp-start" className={LABEL_CLASS}>
                {t('Start Date *', 'تاريخ البداية *')}
              </label>
              <input
                id="camp-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="camp-duration" className={LABEL_CLASS}>
                {t('Duration (Days)', 'المدة بالأيام')}
              </label>
              <input
                id="camp-duration"
                type="number"
                min={1}
                max={60}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <CampWeekdayPicker weekdays={operatingWeekdays} onChange={setOperatingWeekdays} t={t}/>
            <div className="sm:col-span-2 lg:col-span-4 text-sm">
              {t('Last teaching date:', 'تاريخ آخر يوم دراسة:')}{' '}
              <strong>{campEndPreview(startDate,durationDays,operatingWeekdays) || t('Select a matching start date and weekdays','اختار تاريخ بداية يوافق أيام الدراسة')}</strong>
            </div>
            </>}
            {step===2&&<>
            <div>
              <label htmlFor="camp-geofence" className={LABEL_CLASS}>
                {t('Geofence Radius (m)', 'نطاق الموقع (متر)')}
              </label>
              <input
                id="camp-geofence"
                type="number"
                min={25}
                max={1000}
                value={geofenceRadiusMeters}
                onChange={(e) => setGeofenceRadiusMeters(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="camp-rate" className={LABEL_CLASS}>
                {t('Default Lecture Rate (EGP)', 'فئة المحاضرة الافتراضية (ج.م)')}
              </label>
              <input
                id="camp-rate"
                type="number"
                min={0}
                value={defaultRateEgp}
                onChange={(e) => setDefaultRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div className="camp-review sm:col-span-2"><strong>{nameEn}</strong><span>{code} · {startDate} → {campEndPreview(startDate,durationDays,operatingWeekdays)}</span><span>{t('The camp will be saved as a draft. Activate it when ready.','سيتم حفظ الكامب كمسودة. فعّله عند الجاهزية.')}</span></div>
            </>}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setShowNewCampForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            {step>0&&<button type="button" disabled={isBusy} className={BTN_SECONDARY} onClick={()=>{setFeedback(null);setStep(v=>v-1);}}>{t('Back','السابق')}</button>}
            <button type="submit" disabled={isBusy} className="camp-primary">{step<2?t('Continue','التالي'):isBusy?t('Saving...','جاري الحفظ...'):t('Save Camp Draft','حفظ مسودة المعسكر')}{step<2&&<ChevronRight size={16}/>}</button>
          </div>
        </form>
      )}

      {editingCamp && (
        <form
          onSubmit={handleSaveEdit}
          className={`${SURFACE_CARD} camp-form p-5 sm:p-6 space-y-4`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F] pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Edit Camp Settings:', 'تعديل إعدادات المعسكر:')}{' '}
              <span className="font-mono text-[#355F82] dark:text-[#88A9CC]">{editingCamp.code}</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="edit-camp-en" className={LABEL_CLASS}>
                {t('Name (English) *', 'الاسم (إنجليزي) *')}
              </label>
              <input
                id="edit-camp-en"
                type="text"
                required
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-ar" className={LABEL_CLASS}>
                {t('Name (Arabic)', 'الاسم (عربي)')}
              </label>
              <input
                id="edit-camp-ar"
                type="text"
                value={editNameAr}
                onChange={(e) => setEditNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-venue" className={LABEL_CLASS}>{t('Training Venue', 'المقر التدريبي')}</label>
              <select id="edit-camp-venue" className={SELECT_CLASS} required value={editVenueId} onChange={e => setEditVenueId(e.target.value)}>
                {venues.map(v => <option key={v.id} value={v.id}>{t(v.nameEn,v.nameAr)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="edit-camp-start" className={LABEL_CLASS}>
                {t('Start Date *', 'تاريخ البداية *')}
              </label>
              <input
                id="edit-camp-start"
                type="date"
                required
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-duration" className={LABEL_CLASS}>
                {t('Duration (Days)', 'المدة بالأيام')}
              </label>
              <input
                id="edit-camp-duration"
                type="number"
                min={1}
                max={60}
                value={editDurationDays}
                onChange={(e) => setEditDurationDays(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <CampWeekdayPicker weekdays={editOperatingWeekdays} onChange={setEditOperatingWeekdays} t={t}/>
            <div className="sm:col-span-2 lg:col-span-4 text-sm">
              {t('Last teaching date:', 'تاريخ آخر يوم دراسة:')}{' '}
              <strong>{campEndPreview(editStartDate,editDurationDays,editOperatingWeekdays) || t('Select matching start date/weekdays','اختار تاريخ بداية يوافق أيام الدراسة')}</strong>
            </div>
            <div>
              <label htmlFor="edit-camp-day" className={LABEL_CLASS}>
                {t('Current Operational Day', 'اليوم التشغيلي الحالي')}
              </label>
              <input
                id="edit-camp-day"
                type="number"
                min={1}
                max={editDurationDays}
                value={editCurrentDay}
                onChange={(e) => setEditCurrentDay(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-geo" className={LABEL_CLASS}>
                {t('Geofence Radius (m)', 'النطاق الجغرافي (م)')}
              </label>
              <input
                id="edit-camp-geo"
                type="number"
                min={25}
                max={1000}
                value={editGeofence}
                onChange={(e) => setEditGeofence(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-rate" className={LABEL_CLASS}>
                {t('Default Rate (EGP)', 'الفئة الافتراضية (ج.م)')}
              </label>
              <input
                id="edit-camp-rate"
                type="number"
                min={0}
                value={editRateEgp}
                onChange={(e) => setEditRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-max" className={LABEL_CLASS}>
                {t('Max Instructor Groups/Day', 'أقصى مجموعات باليوم')}
              </label>
              <input
                id="edit-camp-max"
                type="number"
                min={1}
                max={8}
                value={editMaxGroups}
                onChange={(e) => setEditMaxGroups(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setEditingCamp(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Settings', 'حفظ الإعدادات')}
            </button>
          </div>
        </form>
      )}

      {section==='camps'&&!formOpen&&<>
        <div className="camp-summary">{[CampStatus.ACTIVE,CampStatus.DRAFT,CampStatus.ARCHIVED].map(status=><button type="button" key={status} data-status={status} aria-pressed={statusFilter===status} onClick={()=>setStatusFilter(v=>v===status?'all':status)}><span>{statusName(status)} {t('Camps','معسكرات')}</span><strong>{camps.filter(c=>c.status===status).length}</strong></button>)}</div>
        <div className="camp-toolbar"><label className="camp-search"><Search size={17}/><input type="search" aria-label={t('Search camps','بحث المعسكرات')} placeholder={t('Search by name or code...','ابحث بالاسم أو الكود...')} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></label><div className="camp-filters">{(['all',CampStatus.ACTIVE,CampStatus.DRAFT,CampStatus.ARCHIVED,CampStatus.PENDING_ARCHIVE] as CampFilter[]).filter(status=>status!==CampStatus.PENDING_ARCHIVE||camps.some(c=>c.status===status)).map(status=><button type="button" key={status} aria-pressed={statusFilter===status} onClick={()=>setStatusFilter(status)}>{status==='all'?t('All','الكل'):statusName(status)}</button>)}</div></div>
        {filteredCamps.length===0?<EmptyState icon={Tent} title={t('No matching camps found','لا توجد معسكرات مطابقة')} description={t('Change the filter or create a new camp.','غيّر التصفية أو أنشئ معسكراً جديداً.')} action={<button type="button" className={BTN_SECONDARY} onClick={()=>{setSearchQuery('');setStatusFilter('all');}}>{t('Clear filters','إلغاء التصفية')}</button>}/>:<div className="camp-card-grid">{filteredCamps.map(camp=>{
          const venue=venues.find(v=>v.id===camp.venueId);
          const selected=activeCamp?.id===camp.id;
          const canSelect=availableCamps.some(c=>c.id===camp.id);
          const progress=camp.status===CampStatus.DRAFT?0:Math.min(100,Math.max(0,camp.currentCampDay/Math.max(1,camp.durationDays)*100));
          const counts=[{icon:GraduationCap,label:t('Students','الطلاب'),n:students.filter(s=>s.campId===camp.id&&s.isActive).length},{icon:Users,label:t('Instructors','المحاضرون'),n:instructors.filter(i=>(campInstructorIds[camp.id]||[]).includes(i.id)&&i.isActive).length},{icon:Layers,label:t('Groups','المجموعات'),n:groups.filter(g=>g.campId===camp.id).length}];
          return <article className="camp-card" key={camp.id} data-status={camp.status} aria-label={t(camp.nameEn,camp.nameAr)}>
            <div className="camp-card-head"><span className="camp-icon"><Tent size={22}/></span><div><h2>{t(camp.nameEn,camp.nameAr)}</h2><p dir="ltr">{camp.code}</p></div><StatusBadge tone={statusTone(camp.status)}>{statusName(camp.status)}</StatusBadge></div>
            <div className="camp-card-body"><div className="camp-card-detail"><MapPin size={16}/><span>{venue?t(venue.nameEn,venue.nameAr):t('Venue unavailable','المقر غير متاح')}</span></div><div className="camp-card-detail"><CalendarDays size={16}/><span dir="ltr">{camp.startDate} – {camp.endDate}</span></div>
              <div className="camp-card-stats">{counts.map(m=><div key={m.label}><m.icon size={16}/><strong>{m.n}</strong><small>{m.label}</small></div>)}</div>
              <div className="camp-card-progress"><div><span>{t('Teaching day','يوم الدراسة')}</span><strong>{camp.status===CampStatus.DRAFT?'—':camp.currentCampDay}/{camp.durationDays}</strong></div><div className="camp-progress-track"><span style={{width:progress+'%'}}/></div></div>
              <div className="camp-card-actions"><button type="button" className="camp-primary" disabled={isBusy||!canSelect} onClick={()=>{if(selected)setAdminRoute('dashboard');else selectCamp(camp.id);}}>{camp.status===CampStatus.ARCHIVED?t('View archive','عرض الأرشيف'):selected?t('Open Dashboard','فتح لوحة المتابعة'):t('Manage Camp','إدارة الكامب')}<ChevronRight size={15}/></button>
              {camp.status!==CampStatus.ARCHIVED&&camp.status!==CampStatus.PENDING_ARCHIVE&&<button type="button" className="camp-icon-button" disabled={isBusy} onClick={()=>startEdit(camp)} title={t('Edit camp','تعديل الكامب')} aria-label={t('Edit camp','تعديل الكامب')}><Pencil size={16}/></button>}
              {(camp.status===CampStatus.DRAFT||camp.status===CampStatus.ACTIVE)&&<details className="camp-action-menu"><summary aria-label={t('More camp actions','المزيد من إجراءات الكامب')}>···</summary><div>{camp.status===CampStatus.DRAFT?<button type="button" disabled={isBusy} onClick={()=>handleActivate(camp.id)}><Power size={15}/>{t('Activate','تفعيل')}</button>:<button type="button" disabled={isBusy} onClick={()=>setArchiveTarget(camp)}><Archive size={15}/>{t('Archive Camp','أرشفة المعسكر')}</button>}</div></details>}</div>
              {selected&&<p className="camp-selected"><CheckCircle2 size={13}/>{t('Current working camp','الكامب المختار حالياً')}</p>}
            </div></article>;
        })}</div>}
      </>}
      {section==='venues'&&!formOpen&&<div className="camp-card-grid">{venues.length===0?<EmptyState icon={Building2} title={t('No training venues','لا توجد مقرات')} action={<button type="button" className="camp-primary" onClick={openNew}>{t('New Venue','إضافة مقر تدريبي')}</button>}/>:venues.map(v=><article key={v.id} className="camp-card"><div className="camp-card-head"><span className="camp-icon"><Building2 size={22}/></span><div><h2>{t(v.nameEn,v.nameAr)}</h2><p>{v.address}</p></div></div><div className="camp-card-body"><div className="camp-card-stats">{[{label:t('Rooms','القاعات'),n:rooms.filter(r=>r.venueId===v.id).length},{label:t('Camps','المعسكرات'),n:camps.filter(c=>c.venueId===v.id).length},{label:t('GPS radius','نطاق الموقع'),n:v.geofenceRadiusMeters+'m'}].map(m=><div key={m.label}><strong>{m.n}</strong><small>{m.label}</small></div>)}</div><div className="camp-card-actions"><a className="camp-location" target="_blank" rel="noopener noreferrer" href={'https://www.google.com/maps?q='+encodeURIComponent(v.latitude+','+v.longitude)}><MapPin size={16}/>{t('Location','الموقع')}</a><button type="button" className={BTN_SECONDARY} onClick={()=>{setEditingVenueId(v.id);setVenueNameEn(v.nameEn);setVenueNameAr(v.nameAr);setVenueAddress(v.address);setVenueLatitude(String(v.latitude));setVenueLongitude(String(v.longitude));setVenueGeofence(v.geofenceRadiusMeters);setShowVenueForm(true);setFeedback(null);}}><Pencil size={15}/>{t('Edit venue','تعديل المقر')}</button></div></div></article>)}</div>}
      {section==='rooms'&&!formOpen&&<><div className="camp-toolbar"><label className="camp-room-filter"><Building2 size={17}/><select aria-label={t('Filter rooms by venue','تصفية القاعات حسب المقر')} value={roomFilter} onChange={e=>setRoomFilter(e.target.value)}><option value="all">{t('All venues','كل المقرات')}</option>{venues.map(v=><option key={v.id} value={v.id}>{t(v.nameEn,v.nameAr)}</option>)}</select></label></div><div className="camp-card-grid">{rooms.filter(r=>roomFilter==='all'||r.venueId===roomFilter).length===0?<EmptyState icon={DoorOpen} title={t('No rooms found','لا توجد قاعات')} description={t('Choose another venue or add a training room.','اختر مقراً آخر أو أضف قاعة تدريبية.')}/>:rooms.filter(r=>roomFilter==='all'||r.venueId===roomFilter).map(r=>{const v=venues.find(v=>v.id===r.venueId);return <article className="camp-card" key={r.id}><div className="camp-card-head"><span className="camp-icon"><DoorOpen size={22}/></span><div><h2>{r.name}</h2><p>{r.code}</p></div></div><div className="camp-card-body"><div className="camp-card-detail"><Building2 size={16}/>{v?t(v.nameEn,v.nameAr):t('Venue unavailable','المقر غير متاح')}</div><div className="camp-card-detail"><Users size={16}/><strong>{r.capacity}</strong>{t('seats','مقاعد')}</div></div></article>;})}</div></>}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={t('Archive Active Camp?', 'أرشفة المعسكر النشط؟')}
        description={
          archiveTarget
            ? t(
                `Archiving ${archiveTarget.code} marks all camp records permanently read-only and purges check-in selfie photos while retaining verification metadata. Proceed?`,
                `سيتم تحويل المعسكر ${archiveTarget.code} إلى وضع القراءة فقط وحذف صور التحقق مع الاحتفاظ ببيانات المراجعة المالية. هل تريد المتابعة؟`
              )
            : ''
        }
        confirmLabel={t('Archive Camp', 'تأكيد الأرشفة')}
        cancelLabel={t('Cancel', 'إلغاء')}
        tone="danger"
        isBusy={isBusy}
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
};

const INSTRUCTORS_PAGE_SIZE = 10;

interface OneTimeCredentialHandoff {
  fullNameEn: string;
  username: string;
  email: string;
  instructorCode: string;
  temporaryPassword: string;
}

export const AdminInstructorsView: React.FC = () => {
  const {
    activeCamp,
    campInstructorIds,
    instructors,
    groups,
    profiles,
    isSupabaseMode,
    isLoadingData,
    dataError,
    refreshOperationalData,
    provisionInstructor,
    updateInstructorAccount,
    triggerInstructorPasswordReset,
    updateInstructorCredential,
    manageInstructorRemoval,
    t,
  } = useApp();

  // Create / Provision Instructor form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showBulkImport,setShowBulkImport]=useState(false);
  const [createStep,setCreateStep]=useState(0);
  const [profileTab,setProfileTab]=useState<'personal'|'camp'|'account'>('personal');
  const [assignmentFilter,setAssignmentFilter]=useState('all');
  const [newFullNameEn, setNewFullNameEn] = useState('');
  const [newFullNameAr, setNewFullNameAr] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newInstructorCode, setNewInstructorCode] = useState(() => generateEntityCode('INST'));
  const [newPhone, setNewPhone] = useState('');
  const [newSpecialization, setNewSpecialization] = useState('');
  const [newRateEgp, setNewRateEgp] = useState(activeCamp?.settings.defaultLectureRateEgp ?? 700);
  const [newBio, setNewBio] = useState('');
  const [newIsActive, setNewIsActive] = useState(true);
  const [newAssignToActiveCamp, setNewAssignToActiveCamp] = useState(
    Boolean(activeCamp && activeCamp.status !== CampStatus.ARCHIVED)
  );
  const [deliveryMode, setDeliveryMode] = useState<CredentialDeliveryMode>('invite_email');
  const [customTempPassword, setCustomTempPassword] = useState('');
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});
  const [oneTimeHandoff, setOneTimeHandoff] = useState<OneTimeCredentialHandoff | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // View Details modal state
  const [viewingInst, setViewingInst] = useState<Instructor | null>(null);

  // Edit Instructor state
  const [editingInst, setEditingInst] = useState<Instructor | null>(null);
  const [editInstructorCode, setEditInstructorCode] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCredential, setEditCredential] = useState('');
  const [editFullNameEn, setEditFullNameEn] = useState('');
  const [editFullNameAr, setEditFullNameAr] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSpecialization, setEditSpecialization] = useState('');
  const [editBio, setEditBio] = useState('');
  const [rateEgp, setRateEgp] = useState(700);
  const [isActive, setIsActive] = useState(true);
  const [assignedToCamp, setAssignedToCamp] = useState(true);

  // Confirmation dialog targets
  const [removalTarget,setRemovalTarget]=useState<{inst:Instructor;action:'archive'|'restore'|'delete'}|null>(null);
  const [toggleStatusTarget, setToggleStatusTarget] = useState<Instructor | null>(null);
  const [resetTarget, setResetTarget] = useState<Instructor | null>(null);

  // Search, filter, pagination, feedback
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InstructorFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const assignedSet = useMemo(
    () => new Set(activeCamp ? campInstructorIds[activeCamp.id] || [] : []),
    [activeCamp, campInstructorIds]
  );

  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const groupsByInstructor = useMemo(() => {
    const map = new Map<string, typeof groups>();
    for (const grp of groups) {
      if (!activeCamp || grp.campId !== activeCamp.id) continue;
      const list = map.get(grp.primaryInstructorId) || [];
      list.push(grp);
      map.set(grp.primaryInstructorId, list);
    }
    return map;
  }, [groups, activeCamp]);

  const filteredInstructors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return instructors.filter((inst) => {
      if (statusFilter==='archived' ? !inst.archivedAt : Boolean(inst.archivedAt)) return false;
      if (statusFilter === 'active' && !inst.isActive) return false;
      if (statusFilter === 'disabled' && inst.isActive) return false;
      if(assignmentFilter==='assigned'&&!assignedSet.has(inst.id))return false;
      if(assignmentFilter==='unassigned'&&assignedSet.has(inst.id))return false;
      if (!q) return true;
      return (
        inst.fullNameEn.toLowerCase().includes(q) ||
        inst.fullNameAr.toLowerCase().includes(q) ||
        inst.instructorCode.toLowerCase().includes(q) ||
        inst.username.toLowerCase().includes(q) ||
        inst.email.toLowerCase().includes(q) ||
        inst.specialization.toLowerCase().includes(q)
      );
    });
  }, [instructors, searchQuery, statusFilter, assignmentFilter, assignedSet]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, assignmentFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredInstructors.length / INSTRUCTORS_PAGE_SIZE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [filteredInstructors.length, currentPage]);

  const paginatedInstructors = useMemo(() => {
    const start = (currentPage - 1) * INSTRUCTORS_PAGE_SIZE;
    return filteredInstructors.slice(start, start + INSTRUCTORS_PAGE_SIZE);
  }, [filteredInstructors, currentPage]);

  const resetCreateForm = () => {
    setCreateStep(0);
    setNewFullNameEn('');
    setNewFullNameAr('');
    setNewEmail('');
    setNewUsername('');
    setNewInstructorCode(generateEntityCode('INST'));
    setNewPhone('');
    setNewSpecialization('');
    setNewRateEgp(activeCamp?.settings.defaultLectureRateEgp ?? 700);
    setNewBio('');
    setNewIsActive(true);
    setNewAssignToActiveCamp(Boolean(activeCamp && activeCamp.status !== CampStatus.ARCHIVED));
    setDeliveryMode('invite_email');
    setCustomTempPassword('');
    setCreateFieldErrors({});
  };

  const handleOpenCreateForm = () => {
    setEditingInst(null);
    setViewingInst(null);
    setFeedback(null);
    setCreateFieldErrors({});
    if (!showCreateForm) {
      setCreateStep(0);
      setNewRateEgp(activeCamp?.settings.defaultLectureRateEgp ?? 700);
      setNewAssignToActiveCamp(Boolean(activeCamp && activeCamp.status !== CampStatus.ARCHIVED));
    }
    setShowCreateForm((prev) => !prev);
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setFeedback(null);

    const payload = {
      fullNameEn: newFullNameEn,
      fullNameAr: newFullNameAr,
      email: newEmail,
      username: newUsername,
      instructorCode: newInstructorCode,
      phone: newPhone,
      specialization: newSpecialization,
      defaultLectureRateEgp: newRateEgp,
      bio: newBio,
      isActive: newIsActive,
      assignToCampId:
        newAssignToActiveCamp && activeCamp && activeCamp.status !== CampStatus.ARCHIVED
          ? activeCamp.id
          : null,
      deliveryMode,
      temporaryPassword:
        deliveryMode === 'temporary_password' && customTempPassword.trim()
          ? customTempPassword
          : undefined,
    };

    const clientCheck = validateProvisionInstructorInput(payload, {
      emails: profiles.map((p) => p.email),
      usernames: profiles.map((p) => p.username),
      instructorCodes: instructors.map((i) => i.instructorCode),
    });

    const fieldStep=(field:string)=>['fullNameEn','fullNameAr','email','specialization','phone','bio'].includes(field)?0:['defaultLectureRateEgp','instructorCode','assignToCampId'].includes(field)?1:2;
    if(createStep<2){
      const errors=Object.entries(clientCheck.fieldErrors).filter(([field])=>fieldStep(field)===createStep);
      if(errors.length){setCreateFieldErrors(Object.fromEntries(errors) as Record<string,string>);setFeedback({ok:false,text:errors[0][1]||t('Check the highlighted fields.','راجع البيانات المحددة.')});return;}
      setCreateFieldErrors({});setCreateStep(v=>v+1);return;
    }
    if (!clientCheck.valid) {
      setCreateStep(Math.min(...Object.keys(clientCheck.fieldErrors).map(fieldStep),2));
      setCreateFieldErrors(clientCheck.fieldErrors as Record<string, string>);
      setFeedback({
        ok: false,
        text:
          clientCheck.errors[0] ||
          t('Please correct the highlighted fields.', 'يرجى تصحيح الحقول المحددة.'),
      });
      return;
    }

    setCreateFieldErrors({});
    setIsBusy(true);
    try {
      const outcome = await provisionInstructor(payload);
      if (!outcome.ok) {
        if (outcome.fieldErrors) {setCreateFieldErrors(outcome.fieldErrors as Record<string, string>);setCreateStep(Math.min(...Object.keys(outcome.fieldErrors).map(fieldStep),2));}
        setFeedback({
          ok: false,
          text: outcome.error || t('Unable to provision instructor.', 'تعذر إنشاء حساب المحاضر.'),
        });
        return;
      }

      if (outcome.deliveryMode === 'temporary_password' && outcome.initialTemporaryPassword) {
        setOneTimeHandoff({
          fullNameEn: newFullNameEn.trim(),
          username: outcome.username,
          email: outcome.email,
          instructorCode: outcome.instructorCode,
          temporaryPassword: outcome.initialTemporaryPassword,
        });
        setCopiedSecret(false);
      }

      setFeedback({
        ok: true,
        text:
          outcome.deliveryMode === 'invite_email'
            ? t(
                `Instructor ${outcome.instructorCode} provisioned and onboarding invite dispatched to ${outcome.email}.`,
                `تم إنشاء حساب المحاضر ${outcome.instructorCode} وإرسال دعوة التفعيل إلى ${outcome.email}.`
              )
            : t(
                `Instructor ${outcome.instructorCode} provisioned with a one-time temporary password. Copy it below — it will not be shown again.`,
                `تم إنشاء حساب المحاضر ${outcome.instructorCode} بكلمة مرور مؤقتة لمرة واحدة. انسخها أدناه لأنها لن تُعرض مرة أخرى.`
              ),
      });

      resetCreateForm();
      setShowCreateForm(false);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyTempPassword = async () => {
    if (!oneTimeHandoff) return;
    try {
      await navigator.clipboard.writeText(oneTimeHandoff.temporaryPassword);
      setCopiedSecret(true);
    } catch {
      setCopiedSecret(false);
    }
  };

  const openEdit = (inst: Instructor) => {
    setShowCreateForm(false);
    setViewingInst(null);
    setEditingInst(inst);
    setEditInstructorCode(inst.instructorCode);
    setEditUsername(inst.username);
    setEditEmail(inst.email);
    setEditCredential('');
    setEditFullNameEn(inst.fullNameEn);
    setEditFullNameAr(inst.fullNameAr);
    setEditPhone(inst.phone || '');
    setEditSpecialization(inst.specialization);
    setEditBio(inst.bio || '');
    setRateEgp(inst.defaultLectureRateEgp);
    setIsActive(inst.isActive);
    setAssignedToCamp(activeCamp ? assignedSet.has(inst.id) : true);
    setFeedback(null);
  };

  const handleCredentialUpdate = async (action: 'email' | 'temporary_credential') => {
    if (!editingInst || isBusy) return;
    if (action === 'email' && editEmail.trim().toLowerCase() === editingInst.email.toLowerCase()) return;
    if (!window.confirm(t('Confirm account credential change?', 'تأكيد تعديل بيانات تسجيل الدخول؟'))) return;
    setIsBusy(true);
    try {
      const result = await updateInstructorCredential({
        instructorId: editingInst.id, action,
        value: action === 'email' ? editEmail : editCredential,
      });
      setFeedback({ok: result.ok, text: result.ok ? t('Account credentials updated.', 'تم تحديث بيانات تسجيل الدخول.') : (result.error || t('Update failed.', 'تعذر حفظ البيانات.'))});
      if (result.ok && action === 'email') setEditingInst({...editingInst,email:editEmail.trim().toLowerCase()});
    } finally {
      setEditCredential('');
      setIsBusy(false);
    }
  };

  const handleSaveInst = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInst || isBusy) return;
    if (!editFullNameEn.trim() || !editSpecialization.trim() || rateEgp < 0) {
      setFeedback({
        ok: false,
        text: t(
          'English name, specialization, and a non-negative default rate are required.',
          'الاسم بالإنجليزية والتخصص وفئة المحاضرة غير السالبة مطلوبة.'
        ),
      });
      return;
    }

    setIsBusy(true);
    try {
      const res = await updateInstructorAccount({
        instructorId: editingInst.id,
        profileId: editingInst.profileId,
        instructorCode: editInstructorCode,
        username: editUsername,
        fullNameEn: editFullNameEn.trim(),
        fullNameAr: editFullNameAr.trim() || editFullNameEn.trim(),
        phone: editPhone.trim(),
        bio: editBio.trim(),
        specialization: editSpecialization.trim(),
        defaultLectureRateEgp: rateEgp,
        isActive,
        assignedToActiveCamp: assignedToCamp,
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || t('Update failed.', 'تعذر حفظ البيانات.') });
      } else {
        setFeedback({
          ok: true,
          text: t(
            'Instructor settings saved. Already scheduled lectures keep their frozen rate.',
            'تم حفظ بيانات المحاضر. المحاضرات المجدولة مسبقاً تحتفظ بفئتها المثبتة.'
          ),
        });
        setEditingInst(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmRemoval=async()=>{
    if(!removalTarget||isBusy)return;
    setIsBusy(true);
    try{
      const result=await manageInstructorRemoval(removalTarget.inst.id,removalTarget.action);
      setFeedback({ok:result.ok,text:result.ok?t('Account list updated.','تم تحديث قائمة المحاضرين.'):(result.error||t('Removal failed.','تعذر إزالة الحساب.'))});
      setRemovalTarget(null);
      if(result.ok){setEditingInst(null);setViewingInst(null);}
    } finally {setIsBusy(false);}
  };
  const handleConfirmToggleStatus = async () => {
    if (!toggleStatusTarget || isBusy) return;
    const nextActive = !toggleStatusTarget.isActive;
    setIsBusy(true);
    try {
      const res = await updateInstructorAccount({
        instructorId: toggleStatusTarget.id,
        profileId: toggleStatusTarget.profileId,
        specialization: toggleStatusTarget.specialization,
        defaultLectureRateEgp: toggleStatusTarget.defaultLectureRateEgp,
        isActive: nextActive,
        assignedToActiveCamp: activeCamp ? assignedSet.has(toggleStatusTarget.id) : false,
      });
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: res.error || t('Unable to update account status.', 'تعذر تحديث حالة الحساب.'),
        });
      } else {
        setFeedback({
          ok: true,
          text: nextActive
            ? t(
                `Account ${toggleStatusTarget.instructorCode} reactivated.`,
                `تم إعادة تفعيل حساب المحاضر ${toggleStatusTarget.instructorCode}.`
              )
            : t(
                `Account ${toggleStatusTarget.instructorCode} deactivated. Login access is blocked while historical records remain intact.`,
                `تم تعطيل حساب المحاضر ${toggleStatusTarget.instructorCode}. تم حظر تسجيل الدخول مع الحفاظ على السجلات التاريخية.`
              ),
        });
        setToggleStatusTarget(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmPasswordReset = async () => {
    if (!resetTarget || isBusy) return;
    setIsBusy(true);
    try {
      const res = await triggerInstructorPasswordReset(resetTarget.id);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: res.error || t('Password recovery failed.', 'تعذر إرسال رابط استعادة كلمة المرور.'),
        });
      } else {
        setFeedback({
          ok: true,
          text: isSupabaseMode
            ? t(
                `Password recovery email dispatched to ${resetTarget.email}.`,
                `تم إرسال رابط استعادة كلمة المرور إلى ${resetTarget.email}.`
              )
            : t(
                `Next-login password change enforced for ${resetTarget.username} (${resetTarget.email}).`,
                `تم تفعيل التغيير الإلزامي لكلمة المرور عند الدخول التالي للمحاضر ${resetTarget.username}.`
              ),
        });
        setResetTarget(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const normal=instructors.filter(i=>!i.archivedAt);
  const activeCount=normal.filter(i=>i.isActive).length;
  const openProfile=(inst:Instructor)=>{setProfileTab('personal');setViewingInst(inst);setFeedback(null);};
  const accountBadge=(inst:Instructor)=><StatusBadge tone={inst.archivedAt?'neutral':inst.isActive?'success':'danger'}>{inst.archivedAt?t('Archived','مؤرشف'):inst.isActive?t('Active','نشط'):t('Disabled','معطل')}</StatusBadge>;
  const avatar=(inst:Instructor)=>t(inst.fullNameEn,inst.fullNameAr).trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]).join('').toUpperCase()||'IN';

  return (
    <div className="camp-workspace people-workspace">
      <div className="camp-page-heading"><div><p className="camp-eyebrow">{t('OPERATIONS WORKSPACE','مساحة إدارة العمليات')}</p><h1>{t('Instructors','المحاضرون')}</h1><p>{t('Manage your teaching team.','إدارة فريق المحاضرين.')}</p></div>{!showBulkImport&&!showCreateForm&&!editingInst&&!viewingInst&&<div className="flex flex-wrap gap-2"><button type="button" className={BTN_SECONDARY} disabled={isBusy||!!oneTimeHandoff} onClick={()=>{setFeedback(null);setShowBulkImport(true);}}><Upload size={16}/>{t('Import Excel','استيراد Excel')}</button><button type="button" className="camp-primary" onClick={handleOpenCreateForm} disabled={isBusy}><UserPlus size={17}/>{t('New Instructor','إضافة محاضر')}</button></div>}{(showCreateForm||editingInst||viewingInst)&&<button type="button" className={BTN_SECONDARY} disabled={isBusy} onClick={()=>{resetCreateForm();setShowCreateForm(false);setEditingInst(null);setEditCredential('');setViewingInst(null);setFeedback(null);}}>{t('Back to instructors','رجوع للمحاضرين')}</button>}</div>
      {dataError && (
        <InlineBanner
          type="error"
          message={dataError}
        />
      )}

      {feedback && (
        <InlineBanner
          type={feedback.ok ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* One-Time Temporary Password Handoff Banner (cleared immediately on dismiss) */}
      {oneTimeHandoff && (
        <section
          role="region"
          aria-label={t('One-Time Temporary Password', 'كلمة المرور المؤقتة لمرة واحدة')}
          className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-amber-950 dark:text-amber-200">
                  {t(
                    'One-Time Temporary Password — Copy & Share Securely Now',
                    'كلمة مرور مؤقتة لمرة واحدة — انسخها وشاركها بأمان الآن'
                  )}
                </h2>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                  {t(
                    'This temporary password is displayed only once and is never stored in plaintext. The instructor will be forced to set a new password immediately on first sign-in.',
                    'تُعرض كلمة المرور المؤقتة هذه مرة واحدة فقط ولا يتم تخزينها بنص واضح. سيُطلب من المحاضر تعيين كلمة مرور جديدة فور أول تسجيل دخول.'
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOneTimeHandoff(null);
                setCopiedSecret(false);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#1D2023] text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 cursor-pointer shrink-0"
            >
              {t('Dismiss & Clear', 'إغلاق ومسح')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-white dark:bg-[#1D2023] border border-amber-200/80 dark:border-amber-900/60 rounded-lg p-3.5">
            <div>
              <p className="text-slate-500">{t('Instructor', 'المحاضر')}</p>
              <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {oneTimeHandoff.fullNameEn} ({oneTimeHandoff.instructorCode})
              </p>
            </div>
            <div>
              <p className="text-slate-500">{t('Login Identifier', 'معرّف الدخول')}</p>
              <p className="font-mono text-slate-900 dark:text-white mt-0.5">
                {oneTimeHandoff.username} · {oneTimeHandoff.email}
              </p>
            </div>
            <div>
              <p className="text-slate-500">{t('Temporary Password', 'كلمة المرور المؤقتة')}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <code
                  data-testid="one-time-temp-password"
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-[#25292D] font-mono text-slate-900 dark:text-white font-semibold select-all"
                >
                  {oneTimeHandoff.temporaryPassword}
                </code>
                <button
                  type="button"
                  onClick={handleCopyTempPassword}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-[#DEE1E4] cursor-pointer"
                >
                  {copiedSecret ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>{t('Copied', 'تم النسخ')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{t('Copy', 'نسخ')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Create / Provision Instructor Form */}
      {showCreateForm && (
        <form
          onSubmit={handleProvisionSubmit}
          noValidate
          className={`${SURFACE_CARD} camp-form camp-wizard p-5 space-y-4`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {t('Provision New Instructor Account', 'إنشاء حساب محاضر جديد')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#A0A5AA] mt-0.5">
                {t(
                  'Creates the Supabase Auth account, linked profile (must change password on first login), and instructor record atomically.',
                  'ينشئ حساب المصادقة والملف الشخصي المرتبط (مع تغيير إلزامي لكلمة المرور عند أول دخول) وسجل المحاضر بشكل متكامل.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowCreateForm(false);
              }}
              aria-label={t('Close form', 'إغلاق النموذج')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="camp-stepper" aria-label={t('Creation progress','خطوات الإنشاء')}>{[t('Personal Info','البيانات الشخصية'),t('Camp Setup','إعداد الكامب'),t('Account Setup','إعداد الحساب')].map((label,i)=><div key={i} data-current={createStep===i} data-complete={createStep>i} aria-current={createStep===i?'step':undefined}><span>{createStep>i?<Check size={15}/>:i+1}</span><strong>{label}</strong></div>)}</div>
          {createStep===0&&<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="prov-name-en" className={LABEL_CLASS}>
                {t('Full Name (English) *', 'الاسم الكامل (بالإنجليزية) *')}
              </label>
              <input
                id="prov-name-en"
                type="text"
                required
                value={newFullNameEn}
                onChange={(e) => setNewFullNameEn(e.target.value)}
                placeholder="e.g. Eng. Youssef Nabil"
                className={INPUT_CLASS}
              />
              {createFieldErrors.fullNameEn && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.fullNameEn}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="prov-name-ar" className={LABEL_CLASS}>
                {t('Full Name (Arabic)', 'الاسم الكامل (بالعربية)')}
              </label>
              <input
                id="prov-name-ar"
                type="text"
                value={newFullNameAr}
                onChange={(e) => setNewFullNameAr(e.target.value)}
                placeholder="مثال: م. يوسف نبيل"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="prov-email" className={LABEL_CLASS}>
                {t('Email Address *', 'البريد الإلكتروني *')}
              </label>
              <input
                id="prov-email"
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="youssef.nabil@cits.edu.eg"
                className={`${INPUT_CLASS} font-mono`}
              />
              {createFieldErrors.email && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="prov-spec" className={LABEL_CLASS}>
                {t('Specialization *', 'التخصص *')}
              </label>
              <input
                id="prov-spec"
                type="text"
                required
                value={newSpecialization}
                onChange={(e) => setNewSpecialization(e.target.value)}
                placeholder="e.g. Algorithms & Dynamic Programming"
                className={INPUT_CLASS}
              />
              {createFieldErrors.specialization && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.specialization}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="prov-phone" className={LABEL_CLASS}>
                {t('Phone Number', 'رقم الهاتف')}
              </label>
              <input
                id="prov-phone"
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+20 100 000 0000"
                className={`${INPUT_CLASS} font-mono`}
              />
              {createFieldErrors.phone && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.phone}
                </p>
              )}
            </div>

          </div>
          <div>
            <label htmlFor="prov-bio" className={LABEL_CLASS}>
              {t('Bio / Instructor Notes (Optional)', 'نبذة عن المحاضر (اختياري)')}
            </label>
            <textarea
              id="prov-bio"
              rows={2}
              value={newBio}
              onChange={(e) => setNewBio(e.target.value)}
              placeholder={t(
                'Short teaching profile or competition mentoring background...',
                'نبذة مختصرة عن الخبرة التدريبية أو الإشراف على المسابقات...'
              )}
              className={INPUT_CLASS}
            />
            {createFieldErrors.bio && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                {createFieldErrors.bio}
              </p>
            )}
          </div>

          </>}
          {createStep===1&&<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="prov-code" className={LABEL_CLASS}>
                {t('Instructor Code *', 'كود المحاضر *')}
              </label>
              <input
                id="prov-code"
                type="text"
                required
                value={newInstructorCode}
                onChange={(e) => setNewInstructorCode(e.target.value)}
                placeholder="INST-05"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
              <button type="button" className={BTN_SECONDARY + ' mt-1'} onClick={() => setNewInstructorCode(generateEntityCode('INST'))}>{t('Generate code', 'توليد كود')}</button>
              {createFieldErrors.instructorCode && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.instructorCode}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="prov-rate" className={LABEL_CLASS}>
                {t('Default Lecture Rate (EGP) *', 'فئة المحاضرة الافتراضية (ج.م) *')}
              </label>
              <input
                id="prov-rate"
                type="number"
                min={0}
                required
                value={newRateEgp}
                onChange={(e) => setNewRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
              {createFieldErrors.defaultLectureRateEgp && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.defaultLectureRateEgp}
                </p>
              )}
            </div>

            <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end gap-2.5 pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-[#C0C5C9]">
                <input
                  type="checkbox"
                  checked={newIsActive}
                  onChange={(e) => setNewIsActive(e.target.checked)}
                  className="rounded text-[#355F82] focus:ring-blue-500"
                />
                <span>{t('Account Active Immediately', 'تفعيل الحساب فوراً')}</span>
              </label>
              {activeCamp && activeCamp.status !== CampStatus.ARCHIVED && (
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-[#C0C5C9]">
                  <input
                    type="checkbox"
                    checked={newAssignToActiveCamp}
                    onChange={(e) => setNewAssignToActiveCamp(e.target.checked)}
                    className="rounded text-[#355F82] focus:ring-blue-500"
                  />
                  <span>{t(`Assign to ${activeCamp.code}`, `تعيين في معسكر ${activeCamp.code}`)}</span>
                </label>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">{t('Assigning an instructor does not require a primary group.','تعيين المحاضر لا يتطلب مجموعة أساسية.')}</p></>}
          {createStep===2&&<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="prov-username" className={LABEL_CLASS}>
                {t('Username *', 'اسم المستخدم *')}
              </label>
              <input
                id="prov-username"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="youssef.nabil"
                className={`${INPUT_CLASS} font-mono`}
              />
              {createFieldErrors.username && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                  {createFieldErrors.username}
                </p>
              )}
            </div>

          </div>
          {/* Onboarding Delivery Mode */}
          <div className={`${SURFACE_SUBTLE} p-4 space-y-3`}>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">
              {t('Onboarding Credential Flow', 'آلية تسليم بيانات الدخول الأولية')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  deliveryMode === 'invite_email'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-[#293747]/30'
                    : 'border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023]'
                }`}
              >
                <input
                  type="radio"
                  name="deliveryMode"
                  value="invite_email"
                  checked={deliveryMode === 'invite_email'}
                  onChange={() => setDeliveryMode('invite_email')}
                  className="mt-0.5 text-[#355F82] focus:ring-blue-500"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                    <Mail className="w-3.5 h-3.5 text-[#355F82]" />
                    <span>{t('Send Invite Email (Recommended)', 'إرسال دعوة عبر البريد الإلكتروني (موصى به)')}</span>
                  </div>
                  <p className="text-slate-500 dark:text-[#A0A5AA]">
                    {t(
                      'Supabase sends a secure one-time invite link to the instructor’s email to set their own password.',
                      'يرسل النظام رابط دعوة آمن لمرة واحدة إلى بريد المحاضر لتعيين كلمة مروره بنفسه.'
                    )}
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  deliveryMode === 'temporary_password'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-[#293747]/30'
                    : 'border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023]'
                }`}
              >
                <input
                  type="radio"
                  name="deliveryMode"
                  value="temporary_password"
                  checked={deliveryMode === 'temporary_password'}
                  onChange={() => setDeliveryMode('temporary_password')}
                  className="mt-0.5 text-[#355F82] focus:ring-blue-500"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                    <Lock className="w-3.5 h-3.5 text-[#355F82]" />
                    <span>{t('One-Time Temporary Password', 'كلمة مرور مؤقتة لمرة واحدة')}</span>
                  </div>
                  <p className="text-slate-500 dark:text-[#A0A5AA]">
                    {t(
                      'Generates a strong one-time password displayed once to the admin. Mandatory password change enforced on first login.',
                      'تُنشأ كلمة مرور قوية لمرة واحدة تُعرض للمسؤول مرة واحدة فقط مع إلزام المحاضر بتغييرها عند أول دخول.'
                    )}
                  </p>
                </div>
              </label>
            </div>

            {deliveryMode === 'temporary_password' && (
              <div className="pt-1">
                <label htmlFor="prov-temp-password" className={LABEL_CLASS}>
                  {t(
                    'Custom Temporary Password (Optional — leave blank to auto-generate a 16-character strong password)',
                    'كلمة مرور مؤقتة مخصصة (اختياري — اتركه فارغاً لتوليد كلمة مرور قوية تلقائياً)'
                  )}
                </label>
                <input
                  id="prov-temp-password"
                  type="password"
                  autoComplete="new-password"
                  value={customTempPassword}
                  onChange={(e) => setCustomTempPassword(e.target.value)}
                  placeholder={t('Auto-generated if left blank', 'يتم التوليد تلقائياً إذا تُرك فارغاً')}
                  className={`${INPUT_CLASS} font-mono max-w-md`}
                />
                {createFieldErrors.temporaryPassword && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                    {createFieldErrors.temporaryPassword}
                  </p>
                )}
              </div>
            )}
          </div>

          </>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowCreateForm(false);
              }}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            {createStep>0&&<button type="button" disabled={isBusy} className={BTN_SECONDARY} onClick={()=>{setFeedback(null);setCreateStep(v=>v-1);}}>{t('Back','السابق')}</button>}
            <button type="submit" disabled={isBusy} className="camp-primary">
              <UserPlus className="w-4 h-4" />
              <span>
                {createStep<2?t('Continue','التالي'):isBusy
                  ? t('Provisioning...', 'جاري إنشاء الحساب...')
                  : t('Create Instructor Account', 'إنشاء حساب المحاضر')}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Edit Instructor Form */}
      {editingInst && (
        <form
          onSubmit={handleSaveInst}
          className={`${SURFACE_CARD} camp-form p-5 space-y-4`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {t('Edit Instructor:', 'تعديل بيانات المحاضر:')}{' '}
                {t(editingInst.fullNameEn, editingInst.fullNameAr)}
              </h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {editingInst.instructorCode} · {editingInst.username} · {editingInst.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingInst(null)}
              aria-label={t('Close edit form', 'إغلاق نموذج التعديل')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label htmlFor="inst-edit-name-en" className={LABEL_CLASS}>
                {t('Full Name (English) *', 'الاسم الكامل (بالإنجليزية) *')}
              </label>
              <input
                id="inst-edit-name-en"
                type="text"
                required
                value={editFullNameEn}
                onChange={(e) => setEditFullNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="inst-edit-name-ar" className={LABEL_CLASS}>
                {t('Full Name (Arabic)', 'الاسم الكامل (بالعربية)')}
              </label>
              <input
                id="inst-edit-name-ar"
                type="text"
                value={editFullNameAr}
                onChange={(e) => setEditFullNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="inst-edit-code" className={LABEL_CLASS}>{t('Instructor Code', 'كود المحاضر')}</label>
              <input id="inst-edit-code" className={INPUT_CLASS} required value={editInstructorCode} onChange={e=>setEditInstructorCode(e.target.value)} maxLength={32} />
              <button type="button" className={BTN_SECONDARY+' mt-1'} onClick={()=>setEditInstructorCode(generateEntityCode('INST'))}>{t('Generate code','توليد كود')}</button>
            </div>
            <div>
              <label htmlFor="inst-edit-username" className={LABEL_CLASS}>{t('Username','اسم المستخدم')}</label>
              <input id="inst-edit-username" className={INPUT_CLASS} required value={editUsername} onChange={e=>setEditUsername(e.target.value)} maxLength={64} />
            </div>
            <div>
              <label htmlFor="inst-edit-email" className={LABEL_CLASS}>{t('Login email','البريد الإلكتروني للدخول')}</label>
              <input id="inst-edit-email" className={INPUT_CLASS} type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} />
              <button type="button" className={BTN_SECONDARY+' mt-1'} disabled={isBusy || !editEmail.trim()} onClick={()=>handleCredentialUpdate('email')}>{t('Save email separately','حفظ البريد الإلكتروني')}</button>
            </div>
            <div>
              <label htmlFor="inst-edit-password" className={LABEL_CLASS}>{t('New temporary password','كلمة مرور مؤقتة جديدة')}</label>
              <input id="inst-edit-password" className={INPUT_CLASS} type="password" autoComplete="new-password" value={editCredential} onChange={e=>setEditCredential(e.target.value)} />
              <button type="button" className={BTN_SECONDARY+' mt-1'} disabled={isBusy || editCredential.length<8} onClick={()=>handleCredentialUpdate('temporary_credential')}>{t('Set password separately','تعيين كلمة المرور')}</button>
              <p className="text-xs text-slate-500 mt-1">{t('Requires change at next sign-in.','يجب تغييرها عند تسجيل الدخول التالي.')}</p>
            </div>
            <div>
              <label htmlFor="inst-edit-phone" className={LABEL_CLASS}>
                {t('Phone Number', 'رقم الهاتف')}
              </label>
              <input
                id="inst-edit-phone"
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="inst-spec" className={LABEL_CLASS}>
                {t('Specialization *', 'التخصص *')}
              </label>
              <input
                id="inst-spec"
                type="text"
                required
                value={editSpecialization}
                onChange={(e) => setEditSpecialization(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="inst-rate" className={LABEL_CLASS}>
                {t('Default Lecture Rate (EGP)', 'فئة المحاضرة الافتراضية (ج.م)')}
              </label>
              <input
                id="inst-rate"
                type="number"
                min={0}
                value={rateEgp}
                onChange={(e) => setRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-[#C0C5C9]">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded text-[#355F82] focus:ring-blue-500"
                />
                <span>{t('Account Active (Can Sign In)', 'الحساب نشط (يمكنه الدخول)')}</span>
              </label>
              {activeCamp && (
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-[#C0C5C9]">
                  <input
                    type="checkbox"
                    checked={assignedToCamp}
                    onChange={(e) => setAssignedToCamp(e.target.checked)}
                    className="rounded text-[#355F82] focus:ring-blue-500"
                  />
                  <span>{t(`Assigned to ${activeCamp.code}`, `معين في ${activeCamp.code}`)}</span>
                </label>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="inst-edit-bio" className={LABEL_CLASS}>
              {t('Bio / Instructor Notes', 'نبذة عن المحاضر')}
            </label>
            <textarea
              id="inst-edit-bio"
              rows={2}
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setEditingInst(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Changes', 'حفظ التعديلات')}
            </button>
          </div>
        </form>
      )}

      {showBulkImport&&<InstructorBulkImport onClose={()=>setShowBulkImport(false)}/>}
      {!showBulkImport&&!showCreateForm&&!editingInst&&!viewingInst&&<>
        <div className="people-metrics">{[{label:t('Total instructors','إجمالي المحاضرين'),n:normal.length,icon:Users,tone:'blue'},{label:t('Active accounts','الحسابات النشطة'),n:activeCount,icon:CheckCircle2,tone:'green'},{label:t('Assigned to camp','المعينون بالكامب'),n:normal.filter(i=>assignedSet.has(i.id)).length,icon:Tent,tone:'teal'},{label:t('Disabled accounts','الحسابات المعطلة'),n:normal.length-activeCount,icon:Power,tone:'red'}].map(m=><article key={m.label} data-tone={m.tone}><div><p>{m.label}</p><strong>{m.n}</strong></div><span><m.icon size={20}/></span></article>)}</div>
        <div className="camp-toolbar"><label className="camp-search"><Search size={17}/><input type="search" aria-label={t('Search instructors','بحث المحاضرين')} placeholder={t('Search instructors...','ابحث عن محاضر...')} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></label><div className="people-filters"><select aria-label={t('Filter account status','تصفية حالة الحساب')} value={statusFilter} onChange={e=>setStatusFilter(e.target.value as InstructorFilter)}><option value="all">{t('All instructors','كل المحاضرين')}</option><option value="active">{t('Active','نشط')}</option><option value="disabled">{t('Disabled','معطل')}</option><option value="archived">{t('Archived','مؤرشف')}</option></select>{activeCamp&&<select aria-label={t('Filter camp assignment','تصفية التعيين بالكامب')} value={assignmentFilter} onChange={e=>setAssignmentFilter(e.target.value)}><option value="all">{t('All assignments','كل التعيينات')}</option><option value="assigned">{t('Assigned to camp','معين بالكامب')}</option><option value="unassigned">{t('Not assigned','غير معين')}</option></select>}</div></div>
        <section className="people-list" aria-label={t('Instructor directory','دليل المحاضرين')}>
          <div className="people-list-heading"><h2>{t('Instructor directory','دليل المحاضرين')}</h2><span>{filteredInstructors.length} {t('instructors','محاضر')}</span></div>
          {isLoadingData&&instructors.length===0?<p className="p-5 text-sm">{t('Loading instructor directory...','جاري تحميل المحاضرين...')}</p>:!filteredInstructors.length?<EmptyState icon={Users} title={t('No matching instructors','لا يوجد محاضرون مطابقون')} action={<button type="button" className={BTN_SECONDARY} onClick={()=>{setSearchQuery('');setStatusFilter('all');setAssignmentFilter('all');}}>{t('Clear filters','إلغاء التصفية')}</button>}/>:<>
          <div className="people-table-heading"><span>{t('Instructor','المحاضر')}</span><span>{t('Specialization','التخصص')}</span><span>{t('Camp assignment','التعيين بالكامب')}</span><span>{t('Status','الحالة')}</span><span/></div>
          {paginatedInstructors.map(inst=><button key={inst.id} type="button" className="people-row" onClick={()=>openProfile(inst)} aria-label={t('View instructor','عرض المحاضر')+' '+t(inst.fullNameEn,inst.fullNameAr)}><span className="people-identity"><span className="people-avatar">{avatar(inst)}</span><span><strong>{t(inst.fullNameEn,inst.fullNameAr)}</strong><small>{inst.instructorCode}</small></span></span><span className="people-specialization">{inst.specialization}</span><span className="people-assignment" data-assigned={assignedSet.has(inst.id)}>{activeCamp?(assignedSet.has(inst.id)?t('Assigned to camp','معين بالكامب'):t('Not assigned','غير معين')):'—'}</span><span>{accountBadge(inst)}</span><ChevronRight size={17} className="people-chevron"/></button>)}
          <PaginationBar page={currentPage} totalPages={Math.max(1,Math.ceil(filteredInstructors.length/INSTRUCTORS_PAGE_SIZE))} totalItems={filteredInstructors.length} pageSize={INSTRUCTORS_PAGE_SIZE} onPageChange={setCurrentPage} labelShowing={t(`Showing ${paginatedInstructors.length} of ${filteredInstructors.length} instructors`,`عرض ${paginatedInstructors.length} من ${filteredInstructors.length} محاضر`)}/>
          </>}
        </section>
      </>}
      {viewingInst&&(()=>{
        const inst=instructors.find(i=>i.id===viewingInst.id)||viewingInst;
        const linkedProfile=profileById.get(inst.profileId);
        const assignedGroups=groupsByInstructor.get(inst.id)||[];
        const assigned=assignedSet.has(inst.id);
        const fields=(items:{label:string;value:React.ReactNode}[])=><dl className="people-detail-grid">{items.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value||'—'}</dd></div>)}</dl>;
        const action=(Icon:typeof Pencil,label:string,description:string,onClick:()=>void,tone='normal')=><button type="button" className="people-account-action" data-tone={tone} disabled={isBusy} onClick={onClick}><span><Icon size={18}/></span><div><strong>{label}</strong><small>{description}</small></div><ChevronRight size={16}/></button>;
        return <section className="people-profile" aria-label={t('Instructor profile','ملف المحاضر')}>
          <div className="people-profile-banner"><span className="people-avatar">{avatar(inst)}</span><div><h2>{t(inst.fullNameEn,inst.fullNameAr)}</h2><p>{inst.specialization} · {inst.instructorCode}</p></div>{accountBadge(inst)}</div>
          <nav className="camp-section-tabs" aria-label={t('Instructor profile sections','أقسام ملف المحاضر')}>{([{id:'personal',label:t('Personal Info','البيانات الشخصية'),icon:Users},{id:'camp',label:t('Camp & Groups','الكامب والمجموعات'),icon:Tent},{id:'account',label:t('Account','الحساب'),icon:Lock}] as const).map(tab=><button type="button" key={tab.id} aria-current={profileTab===tab.id?'page':undefined} onClick={()=>setProfileTab(tab.id)}><tab.icon size={17}/>{tab.label}</button>)}</nav>
          <div className="people-profile-content">
          {profileTab==='personal'&&<><div className="people-list-heading"><h2>{t('Personal information','البيانات الشخصية')}</h2>{!inst.archivedAt&&<button type="button" className={BTN_SECONDARY} onClick={()=>openEdit(inst)}><Pencil size={15}/>{t('Edit','تعديل')}</button>}</div>{fields([{label:t('English name','الاسم بالإنجليزية'),value:inst.fullNameEn},{label:t('Arabic name','الاسم بالعربية'),value:inst.fullNameAr},{label:t('Email','البريد الإلكتروني'),value:inst.email},{label:t('Phone','الهاتف'),value:inst.phone},{label:t('Specialization','التخصص'),value:inst.specialization},{label:t('Instructor code','كود المحاضر'),value:inst.instructorCode},{label:t('Bio / notes','نبذة / ملاحظات'),value:inst.bio}])}</>}
          {profileTab==='camp'&&<><div className="people-list-heading"><h2>{t('Camp & Groups','الكامب والمجموعات')}</h2>{!inst.archivedAt&&<button type="button" className={BTN_SECONDARY} onClick={()=>openEdit(inst)}><Pencil size={15}/>{t('Edit assignment','تعديل التعيين')}</button>}</div>{fields([{label:t('Working camp','الكامب المختار'),value:activeCamp?t(activeCamp.nameEn,activeCamp.nameAr):'—'},{label:t('Assignment','التعيين'),value:activeCamp?(assigned?t('Assigned','معين'):t('Not assigned','غير معين')):'—'},{label:t('Primary groups','المجموعات الأساسية'),value:assignedGroups.map(g=>g.code).join(', ')||t('No primary groups','لا توجد مجموعات أساسية')},{label:t('Default lecture rate','فئة المحاضرة الافتراضية'),value:inst.defaultLectureRateEgp+' EGP'}])}<p className="people-note">{t('A camp instructor can support sessions without a primary group. Detailed payments remain in Finance.','يمكن للمحاضر دعم المحاضرات بدون مجموعة أساسية. الحسابات التفصيلية في قسم المالية.')}</p></>}
          {profileTab==='account'&&<><div className="people-list-heading"><h2>{t('Account management','إدارة الحساب')}</h2></div>{fields([{label:t('Username','اسم المستخدم'),value:inst.username},{label:t('Login email','بريد الدخول'),value:inst.email},{label:t('Account status','حالة الحساب'),value:accountBadge(inst)},{label:t('Password status','حالة كلمة المرور'),value:linkedProfile?.mustChangePassword?t('Password change pending','بانتظار تغيير كلمة المرور'):linkedProfile?t('No change pending','لا يوجد تغيير معلق'):'—'}])}<div className="people-account-actions">
          {!inst.archivedAt&&action(Pencil,t('Edit account','تعديل الحساب'),t('Update profile and login credentials','تعديل البيانات وبيانات الدخول'),()=>openEdit(inst))}
          {!inst.archivedAt&&action(KeyRound,t('Reset password','استعادة كلمة المرور'),t('Secure password recovery','استعادة آمنة لكلمة المرور'),()=>setResetTarget(inst))}
          {!inst.archivedAt&&action(Power,inst.isActive?t('Disable account','تعطيل الحساب'):t('Activate account','تفعيل الحساب'),t('Manage sign-in access','إدارة صلاحية الدخول'),()=>setToggleStatusTarget(inst),inst.isActive?'warning':'normal')}
          {!inst.isActive&&action(Archive,inst.archivedAt?t('Restore instructor','استعادة المحاضر'):t('Archive instructor','أرشفة المحاضر'),t('Preserve operational history','الاحتفاظ بسجل التشغيل'),()=>setRemovalTarget({inst,action:inst.archivedAt?'restore':'archive'}),'warning')}
          {!inst.isActive&&action(X,t('Delete permanently','حذف نهائي'),t('Only accounts without linked records can be deleted','الحذف للحسابات غير المرتبطة بسجلات فقط'),()=>setRemovalTarget({inst,action:'delete'}),'danger')}
          </div></>}
          </div>
        </section>;
      })()}
      <ConfirmDialog open={Boolean(removalTarget)}
        title={removalTarget?.action==='delete'?t('Permanently delete instructor?','حذف المحاضر نهائيًا؟'):removalTarget?.action==='restore'?t('Restore instructor?','استعادة المحاضر؟'):t('Archive instructor?','أرشفة المحاضر؟')}
        description={removalTarget ? (removalTarget.inst.fullNameEn+' · '+removalTarget.inst.instructorCode+' — '+(removalTarget.action==='delete'?t('This cannot be undone. Accounts linked to any operational records cannot be deleted; archive them instead.','الحذف غير قابل للتراجع. لو مرتبط بسجلات تشغيل، استخدم الأرشفة بدلًا منه.'):removalTarget.action==='restore'?t('Returns to the disabled list.','يرجع لقائمة المعطلين.'):t('Hide from the normal list; keep attendance and finance history.','إخفاء من القائمة مع الاحتفاظ بالحضور والحسابات.'))):''}
        confirmLabel={removalTarget?.action==='delete'?t('Delete permanently','حذف نهائي'):removalTarget?.action==='restore'?t('Restore','استعادة'):t('Archive','أرشفة')}
        cancelLabel={t('Cancel','إلغاء')} tone={removalTarget?.action==='delete'?'danger':'primary'} isBusy={isBusy}
        onConfirm={handleConfirmRemoval} onCancel={()=>setRemovalTarget(null)} />
      {/* Confirm Deactivate / Activate Dialog */}
      <ConfirmDialog
        open={Boolean(toggleStatusTarget)}
        title={
          toggleStatusTarget?.isActive
            ? t('Remove instructor access (retain history)?', 'إزالة حساب المحاضر مع الاحتفاظ بالسجلات؟')
            : t('Reactivate Instructor Account?', 'إعادة تفعيل حساب المحاضر؟')
        }
        description={
          toggleStatusTarget
            ? toggleStatusTarget.isActive
              ? t(
                  `Deactivating ${toggleStatusTarget.fullNameEn} (${toggleStatusTarget.instructorCode}) immediately prevents them from signing in. All historical lectures, attendance sheets, and payout records are preserved.`,
                  `سيؤدي تعطيل حساب ${toggleStatusTarget.fullNameAr} (${toggleStatusTarget.instructorCode}) إلى منعه فوراً من تسجيل الدخول مع الحفاظ الكامل على سجل المحاضرات والحضور والمستحقات.`
                )
              : t(
                  `Reactivating ${toggleStatusTarget.fullNameEn} (${toggleStatusTarget.instructorCode}) restores sign-in access to the Instructor Portal.`,
                  `سيعيد تفعيل حساب ${toggleStatusTarget.fullNameAr} (${toggleStatusTarget.instructorCode}) صلاحية الدخول إلى بوابة المحاضرين.`
                )
            : ''
        }
        confirmLabel={
          toggleStatusTarget?.isActive
            ? t('Deactivate Account', 'تأكيد التعطيل')
            : t('Activate Account', 'تأكيد التفعيل')
        }
        cancelLabel={t('Cancel', 'إلغاء')}
        tone={toggleStatusTarget?.isActive ? 'danger' : 'primary'}
        isBusy={isBusy}
        onConfirm={handleConfirmToggleStatus}
        onCancel={() => setToggleStatusTarget(null)}
      />

      {/* Confirm Password Reset / Recovery Dialog */}
      <ConfirmDialog
        open={Boolean(resetTarget)}
        title={t('Initiate Password Reset?', 'إرسال استعادة كلمة المرور؟')}
        description={
          resetTarget
            ? isSupabaseMode
              ? t(
                  `Send a Supabase password recovery email to ${resetTarget.email} for ${resetTarget.fullNameEn}?`,
                  `هل تريد إرسال رابط استعادة كلمة المرور إلى ${resetTarget.email} للمحاضر ${resetTarget.fullNameAr}؟`
                )
              : t(
                  `Require ${resetTarget.fullNameEn} (${resetTarget.username}) to set a new password on their next login?`,
                  `هل تريد إلزام المحاضر ${resetTarget.fullNameAr} (${resetTarget.username}) بتغيير كلمة المرور عند الدخول التالي؟`
                )
            : ''
        }
        confirmLabel={t('Send Reset', 'تأكيد الاستعادة')}
        cancelLabel={t('Cancel', 'إلغاء')}
        tone="primary"
        isBusy={isBusy}
        onConfirm={handleConfirmPasswordReset}
        onCancel={() => setResetTarget(null)}
      />
    </div>
  );
};

const STUDENTS_PAGE_SIZE = 12;

export const AdminStudentsAndGroupsView: React.FC = () => {
  const {
    activeCamp,
    groups,
    rooms,
    instructors,
    students,
    profiles,
    studentTransfers,
    lectures,
    attendanceSheets,
    campInstructorIds,
    upsertGroup,
    createSingleStudent,
    transferStudent,
    importStudentsBatch,
    t,
  } = useApp();

  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : [];

  const [section,setSection]=useState<'groups'|'students'|'import'|'transfers'>('groups');
  const [detailGroupId,setDetailGroupId]=useState<string|null>(null);
  const [groupTab,setGroupTab]=useState<'students'|'schedule'|'attendance'>('students');
  const [studentId,setStudentId]=useState<string|null>(null);
  const [fullProfile,setFullProfile]=useState(false);
  const [lateOnly,setLateOnly]=useState(false);
  const [attendanceFilter,setAttendanceFilter]=useState('all');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [importStep,setImportStep]=useState(0);
  const [showExport,setShowExport]=useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [importGroupId, setImportGroupId] = useState<string>(campGroups[0]?.id || '');
  const [importMode, setImportMode] = useState<'smart_update' | 'strict_insert'>('strict_insert');
  const [rawBatchText, setRawBatchText] = useState<string>('');
  const [rosterFileName, setRosterFileName] = useState('');
  const [rosterRows, setRosterRows] = useState<RawStudentImportRow[] | null>(null);
  const [rosterFileError, setRosterFileError] = useState('');
  const [rosterParsing, setRosterParsing] = useState(false);
  const [importResult, setImportResult] = useState<{
    ok: boolean;
    errors: { rowNumber: number; message: string }[];
    inserted: number;
    updated: number;
  } | null>(null);

  // Group Form state — clean empty initial fields with placeholders
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [grpCode, setGrpCode] = useState(() => generateEntityCode('GRP'));
  const [grpNameEn, setGrpNameEn] = useState('');
  const [grpNameAr, setGrpNameAr] = useState('');
  const [grpTrack, setGrpTrack] = useState('');
  const campRooms=rooms.filter(r=>r.venueId===activeCamp?.venueId);
  const campInstructors=instructors.filter(i=>i.isActive&&!i.archivedAt&&(activeCamp?campInstructorIds[activeCamp.id]||[]:[]).includes(i.id));
  const [grpRoomId, setGrpRoomId] = useState(campRooms[0]?.id || '');
  const [grpInstId, setGrpInstId] = useState(campInstructors[0]?.id || '');
  const [grpCap, setGrpCap] = useState(30);
  const [grpPeriod,setGrpPeriod]=useState(activeCamp?.settings.periodSlots[0]?.period||1);
  const [existingFixed,setExistingFixed]=useState(false);

  // Single Student Form
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [stuCode, setStuCode] = useState(() => generateEntityCode('STU'));
  const [stuName, setStuName] = useState('');
  const [stuUniv, setStuUniv] = useState('');
  const [stuGroupId, setStuGroupId] = useState(campGroups[0]?.id || '');

  // Transfer Modal / Form
  const [transferTargetStuId, setTransferTargetStuId] = useState<string | null>(null);
  const [transferToGroupId, setTransferToGroupId] = useState('');
  const [transferDay, setTransferDay] = useState(activeCamp?.currentCampDay || 1);
  const [transferReason, setTransferReason] = useState('');

  const [actionNotice, setActionNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if(activeCamp&&!activeCamp.settings.periodSlots.some(p=>p.period===grpPeriod))setGrpPeriod(activeCamp.settings.periodSlots[0]?.period||1);
    if (!campGroups.some(g=>g.id===importGroupId)) setImportGroupId(campGroups[0]?.id||'');
    if (!campGroups.some(g=>g.id===stuGroupId)) setStuGroupId(campGroups[0]?.id||'');
    if (!campRooms.some(r=>r.id===grpRoomId)) setGrpRoomId(campRooms[0]?.id||'');
    if (!campInstructors.some(i=>i.id===grpInstId)) setGrpInstId(campInstructors[0]?.id||'');
  }, [campGroups, campRooms, campInstructors, importGroupId, stuGroupId, grpRoomId, grpInstId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroupId, searchQuery,lateOnly,attendanceFilter]);
  useEffect(()=>{setSection('groups');setDetailGroupId(null);setStudentId(null);setSelectedIds([]);setSelectedGroupId('all');setSearchQuery('');setLateOnly(false);setAttendanceFilter('all');setImportStep(0);setRosterRows(null);setRawBatchText('');setRosterFileName('');setRosterFileError('');setImportResult(null);setShowGroupForm(false);setShowStudentForm(false);setTransferTargetStuId(null);setActionNotice(null);},[activeCamp?.id]);

  const allCampStudents=students.filter(s=>s.campId===activeCamp?.id);
  const campLectures=lectures.filter(l=>l.campId===activeCamp?.id&&l.status!==LectureStatus.CANCELLED);
  const lectureById=new Map(campLectures.map(l=>[l.id,l]));
  const finalized=attendanceSheets.filter(sh=>sh.campId===activeCamp?.id&&lectureById.has(sh.lectureId)&&sh.syncState===OfflineSyncState.SYNCED&&(sh.status===AttendanceSheetStatus.SUBMITTED||sh.status===AttendanceSheetStatus.LOCKED));
  const historyByStudent=new Map<string,{lecture:typeof campLectures[number];record:typeof finalized[number]['records'][number]}[]>();
  const seen=new Set<string>();
  for(const sheet of finalized){
    const lecture=lectureById.get(sheet.lectureId)!;
    for(const record of sheet.records){
      if(record.mark==='unmarked')continue;
      const key=sheet.lectureId+':'+record.studentId;
      if(seen.has(key))continue;seen.add(key);
      const student=allCampStudents.find(s=>s.id===record.studentId);
      if(!student||lecture.campDay<(student.joinedCampDay??1))continue;
      const list=historyByStudent.get(record.studentId)||[];list.push({lecture,record});historyByStudent.set(record.studentId,list);
    }
  }
  const summarize=(history:NonNullable<ReturnType<typeof historyByStudent.get>>)=>{
    const present=history.filter(h=>h.record.mark===AttendanceMark.PRESENT).length;
    const late=history.filter(h=>h.record.mark===AttendanceMark.LATE).length;
    const absent=history.filter(h=>h.record.mark===AttendanceMark.ABSENT).length;
    const excused=history.filter(h=>h.record.mark===AttendanceMark.EXCUSED).length;
    const recorded=present+late+absent+excused;
    return {present,late,absent,excused,recorded,rate:recorded?Math.round((present+late)/recorded*100):null};
  };
  const statsByStudent=new Map(allCampStudents.map(st=>[st.id,summarize(historyByStudent.get(st.id)||[])]));
  const isLate=(st:typeof allCampStudents[number])=>(st.joinedCampDay??1)>1||st.enrollmentOrigin==='instructor_late_join';
  const filteredStudents=allCampStudents.filter(st=>{
    const rate=statsByStudent.get(st.id)?.rate;
    return (selectedGroupId==='all'||st.groupId===selectedGroupId)&&(!lateOnly||isLate(st))&&(attendanceFilter==='all'||(attendanceFilter==='pending'?rate==null:rate!=null&&rate<Number(attendanceFilter)))&&[st.studentCode,st.fullName,st.university].join(' ').toLowerCase().includes(searchQuery.trim().toLowerCase());
  });
  const totalPages=Math.max(1,Math.ceil(filteredStudents.length/STUDENTS_PAGE_SIZE));
  useEffect(()=>{if(currentPage>totalPages)setCurrentPage(totalPages);},[currentPage,totalPages]);
  const pagedStudents=filteredStudents.slice((currentPage-1)*STUDENTS_PAGE_SIZE,currentPage*STUDENTS_PAGE_SIZE);
  const campTransfers=studentTransfers.filter(tr=>tr.campId===activeCamp?.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const parsedRows=rosterRows||rawBatchText.split('\n').map(l=>l.trim()).filter(Boolean).map((line,index)=>{const p=line.split(',').map(v=>v.trim());return {rowNumber:index+1,studentName:p[0]||'',studentCode:p[1]||'',university:p[2]||'Cairo University'};});
  const targetGroup=campGroups.find(g=>g.id===importGroupId);
  const validation=validateStudentBatchImport({rows:parsedRows,existingStudents:allCampStudents,targetCampId:activeCamp?.id,targetGroupId:importGroupId,mode:importMode});
  const previewErrors=[...validation.errors];
  if(!targetGroup)previewErrors.push({rowNumber:0,message:t('Select a target group.','اختر المجموعة المستهدفة.')});
  if(targetGroup&&validation.valid&&allCampStudents.filter(st=>st.groupId===targetGroup.id).length+validation.toInsert.length>targetGroup.capacity)previewErrors.push({rowNumber:0,message:t('Target group capacity would be exceeded.','سيتم تجاوز سعة المجموعة.')});
  const readOnly=!activeCamp||activeCamp.status===CampStatus.ARCHIVED||activeCamp.status===CampStatus.PENDING_ARCHIVE;
  const groupName=(id:string)=>{const g=campGroups.find(g=>g.id===id);return g?t(g.nameEn,g.nameAr):id;};
  const downloadWorkbook=(name:string,rows:(string|number)[][])=>{const blob=createXlsxWorkbook([{name:'Students',rows:rows.map(row=>row.map(value=>({value}))),widths:[24,32,26,26,14,14,14,14,14,18]}]);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name+'.xlsx';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const exportRoster=(mode:'all'|'group'|'selected'|'attendance'|'late')=>{
    const scope=mode==='all'||mode==='attendance'?allCampStudents:mode==='group'?allCampStudents.filter(st=>st.groupId===selectedGroupId):mode==='selected'?allCampStudents.filter(st=>selectedIds.includes(st.id)):allCampStudents.filter(isLate);
    const base=['Full Name','Student Code','University','Group','Joined Day'];
    const extra=mode==='attendance'?['Present','Late','Absent','Excused','Recorded rate (%)']:[];
    downloadWorkbook((activeCamp?.code||'camp')+'-'+mode,[base.concat(extra),...scope.map(st=>{const v=statsByStudent.get(st.id)!;return [st.fullName,st.studentCode,st.university,groupName(st.groupId),st.joinedCampDay??1,...(mode==='attendance'?[v.present,v.late,v.absent,v.excused,v.rate??'']:[])];})]);setShowExport(false);
  };
  if (!activeCamp) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
        description={t(
          'Select or activate a camp first to manage training groups and student rosters.',
          'فعّل معسكراً أولاً لإدارة المجموعات وقوائم الطلاب.'
        )}
      />
    );
  }

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await upsertGroup({
        code: grpCode.trim(),
        nameEn: grpNameEn.trim(),
        nameAr: grpNameAr.trim(),
        track: grpTrack.trim(),
        defaultRoomId: grpRoomId,
        primaryInstructorId: grpInstId,
        capacity: grpCap,
        fixedPeriodNumber:grpPeriod,
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Failed saving group.', 'تعذر حفظ المجموعة.') });
      } else {
        setActionNotice({ ok: true, text: t(`Group created · ${res.created??0} sessions scheduled · ${res.skipped??0} skipped.`,`تم إنشاء المجموعة وجدولة ${res.created??0} محاضرة وتجاوز ${res.skipped??0} يوم.`) });
        setGrpCode(generateEntityCode('GRP'));
        setGrpNameEn('');
        setGrpNameAr('');
        setGrpTrack('');
        setShowGroupForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateSingleStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await createSingleStudent({
        groupId: stuGroupId || campGroups[0]?.id,
        studentCode: stuCode.trim(),
        fullName: stuName.trim(),
        university: stuUniv.trim() || 'Cairo University',
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Failed adding student.', 'تعذر تسجيل الطالب.') });
      } else {
        setActionNotice({ ok: true, text: t('Student enrolled.', 'تم تسجيل الطالب بنجاح.') });
        setStuCode(generateEntityCode('STU'));
        setStuName('');
        setStuUniv('');
        setShowStudentForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetStuId||readOnly) return;
    const moving=allCampStudents.find(st=>st.id===transferTargetStuId);
    const target=campGroups.find(g=>g.id===transferToGroupId);
    if(!moving||!target||moving.groupId===target.id||allCampStudents.filter(st=>st.groupId===target.id).length>=target.capacity){setActionNotice({ok:false,text:t('Select a different group with available capacity.','اختر مجموعة مختلفة بها أماكن متاحة.')});return;}
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await transferStudent({
        studentId: transferTargetStuId,
        toGroupId: transferToGroupId,
        effectiveCampDay: transferDay,
        reason: transferReason.trim(),
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Transfer failed.', 'تعذر نقل الطالب.') });
      } else {
        setActionNotice({
          ok: true,
          text: t(
            'Student transferred cleanly. Historical attendance sheets before effective day retain prior group attribution.',
            'تم نقل الطالب مع الحفاظ على انتماء كشوف الحضور السابقة ليوم التنفيذ.'
          ),
        });
        setTransferTargetStuId(null);
        setTransferReason('');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleRosterFileChange = async (file: File | null) => {
    setRosterRows(null);
    setRosterFileName(file?.name || '');
    setRosterFileError('');
    setImportResult(null);
    if (!file) return;
    setRosterParsing(true);
    try {
      const parsed = await parseStudentRosterFile(file);
      setRosterRows(parsed);
      // Do not overwrite existing records accidentally on the initial upload.
      setImportMode('strict_insert');
      setRawBatchText('');
    } catch (error) {
      setRosterFileError(error instanceof Error ? error.message : 'Unable to read the student spreadsheet.');
    } finally {
      setRosterParsing(false);
    }
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly||importStep!==2||previewErrors.length||rosterParsing||rosterFileError||(!rosterRows && !rawBatchText.trim())) return;
    setImportResult(null);
    setIsBusy(true);
    try {
      const lines = rawBatchText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const pastedRows: RawStudentImportRow[] = lines.map((line, index) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          rowNumber: index + 1,
          studentName: parts[0] || '',
          studentCode: parts[1] || '',
          university: parts[2] || 'Cairo University',
        };
      });

      const parsedRows = rosterRows || pastedRows;
      const groupId = importGroupId || campGroups[0]?.id;
      const target = campGroups.find(g => g.id === groupId);
      if (!target) {
        setImportResult({
          ok: false, errors: [{ rowNumber: 1, message: 'Select a real target group before importing.' }],
          inserted: 0, updated: 0,
        });
        return;
      }
      const knownCodes = new Set(
        allCampStudents.map(student => student.studentCode.trim().toUpperCase())
      );
      const newCodes = new Set(parsedRows
        .map(row => row.studentCode.trim().toUpperCase())
        .filter(code => code && !knownCodes.has(code)));
      const enrolled = allCampStudents.filter(student => student.groupId === target.id).length;
      if (enrolled + newCodes.size > target.capacity) {
        setImportResult({
          ok: false,
          errors: [{ rowNumber: 1, message: `Group ${target.code} capacity ${target.capacity} exceeded: ${enrolled} enrolled + ${newCodes.size} new.` }],
          inserted: 0, updated: 0,
        });
        return;
      }
      const res = await importStudentsBatch(parsedRows, groupId, importMode);
      setImportResult(res);
      if (res.ok) {
        setRawBatchText('');
        setRosterRows(null);
        setRosterFileName('');
        setImportStep(0);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const formOpen=showGroupForm||showStudentForm||Boolean(transferTargetStuId);
  const detailGroup=campGroups.find(g=>g.id===detailGroupId);
  const detailStudent=allCampStudents.find(st=>st.id===studentId);
  const changeSection=(next:typeof section)=>{if(isBusy||rosterParsing)return;setSection(next);setShowGroupForm(false);setShowStudentForm(false);setTransferTargetStuId(null);setDetailGroupId(null);setStudentId(null);setSelectedIds([]);setSelectedGroupId('all');setSearchQuery('');setLateOnly(false);setAttendanceFilter('all');setShowExport(false);setActionNotice(null);};
  const openGroup=(id:string)=>{setDetailGroupId(id);setExistingFixed(false);setSelectedGroupId(id);setGroupTab('students');setSearchQuery('');setLateOnly(false);setAttendanceFilter('all');setSelectedIds([]);};
  const openTransfer=(st:typeof allCampStudents[number])=>{setStudentId(null);setShowStudentForm(false);setShowGroupForm(false);setTransferTargetStuId(st.id);setTransferToGroupId(campGroups.find(g=>g.id!==st.groupId&&allCampStudents.filter(s=>s.groupId===g.id).length<g.capacity)?.id||'');setTransferDay(activeCamp.currentCampDay);setTransferReason('');};
  const openStudent=(id:string)=>{setStudentId(id);setFullProfile(false);};
  const markLabel=(mark:string)=>mark===AttendanceMark.PRESENT?t('Present','حاضر'):mark===AttendanceMark.LATE?t('Late','متأخر'):mark===AttendanceMark.ABSENT?t('Absent','غائب'):t('Excused','بعذر');
  const roster= <section className="people-list" aria-label={t('Student directory','دليل الطلاب')}>
    <div className="people-list-heading"><h2>{t('Student directory','دليل الطلاب')}</h2><span>{filteredStudents.length} {t('students','طالب')}</span></div>
    <div className="camp-toolbar student-toolbar"><label className="camp-search"><Search size={17}/><input type="search" aria-label={t('Search students','بحث الطلاب')} placeholder={t('Search name, code or university...','ابحث بالاسم أو الكود أو الجامعة...')} value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);setSelectedIds([]);}}/></label><div className="people-filters">{!detailGroup&&<select aria-label={t('Filter student group','تصفية المجموعة')} value={selectedGroupId} onChange={e=>{setSelectedGroupId(e.target.value);setSelectedIds([]);}}><option value="all">{t('All groups','كل المجموعات')}</option>{campGroups.map(g=><option key={g.id} value={g.id}>{groupName(g.id)}</option>)}</select>}<select aria-label={t('Filter attendance rate','تصفية نسبة الحضور')} value={attendanceFilter} onChange={e=>{setAttendanceFilter(e.target.value);setSelectedIds([]);}}><option value="all">{t('All attendance','كل الحضور')}</option>{[90,75,60].map(v=><option key={v} value={v}>{t('Below ','أقل من ')}{v}%</option>)}<option value="pending">{t('No finalized marks','لا تسجيل معتمد')}</option></select><label className="student-late-filter"><input type="checkbox" checked={lateOnly} onChange={e=>{setLateOnly(e.target.checked);setSelectedIds([]);}}/>{t('Late enrollment','انضمام متأخر')}</label></div></div>
    <div className="student-selectbar"><label><input type="checkbox" checked={pagedStudents.length>0&&pagedStudents.every(st=>selectedIds.includes(st.id))} onChange={e=>setSelectedIds(ids=>e.target.checked?[...new Set([...ids,...pagedStudents.map(st=>st.id)])]:ids.filter(id=>!pagedStudents.some(st=>st.id===id)))}/>{t('Select page','تحديد الصفحة')}</label><span>{selectedIds.length} {t('selected','محدد')}</span>{selectedIds.length>0&&<button type="button" className="camp-link" onClick={()=>exportRoster('selected')}><Download size={15}/>{t('Export selected','تصدير المحدد')}</button>}<button type="button" className="camp-link" onClick={()=>setShowExport(v=>!v)}><Download size={15}/>{t('Export','تصدير')}</button></div>
    {showExport&&<div className="student-export-options">{([{id:'all',label:t('All camp students','كل طلاب الكامب')},{id:'group',label:t('Selected group','المجموعة المختارة')},{id:'selected',label:t('Selected students','الطلاب المحددون')},{id:'attendance',label:t('Attendance summary','ملخص الحضور')},{id:'late',label:t('Late enrollments','المنضمون متأخراً')}] as const).map(o=><button type="button" key={o.id} disabled={o.id==='group'&&selectedGroupId==='all'||o.id==='selected'&&!selectedIds.length} className={BTN_SECONDARY} onClick={()=>exportRoster(o.id)}><Download size={14}/>{o.label}</button>)}</div>}
    {!pagedStudents.length?<EmptyState icon={GraduationCap} title={t('No students found','لا يوجد طلاب مطابقون للبحث')}/>:<><div className="student-table-heading"><span/><span>{t('Student','الطالب')}</span><span>{t('Group','المجموعة')}</span><span>{t('Attendance','الحضور')}</span><span/></div>{pagedStudents.map(st=>{const rate=statsByStudent.get(st.id)?.rate;return <div className="student-row" key={st.id}><input aria-label={t('Select student','تحديد الطالب')+' '+st.fullName} type="checkbox" checked={selectedIds.includes(st.id)} onChange={e=>setSelectedIds(ids=>e.target.checked?[...ids,st.id]:ids.filter(id=>id!==st.id))}/><button type="button" className="student-row-name" onClick={()=>openStudent(st.id)}><span className="people-avatar"><GraduationCap size={17}/></span><span><strong>{st.fullName}</strong><small>{st.studentCode} · {st.university}</small>{isLate(st)&&<small className="student-late">{t('Joined Day','انضم يوم')} {st.joinedCampDay??1}</small>}</span></button><span className="student-group-name">{groupName(st.groupId)}</span><span className="student-rate" data-low={rate!=null&&rate<75}>{rate==null?'—':rate+'%'}</span><button type="button" className="camp-icon-button" aria-label={t('View student','عرض الطالب')+' '+st.fullName} onClick={()=>openStudent(st.id)}><ChevronRight size={16}/></button></div>;})}<PaginationBar page={currentPage} totalPages={totalPages} totalItems={filteredStudents.length} pageSize={STUDENTS_PAGE_SIZE} onPageChange={setCurrentPage} labelShowing={t('Showing','عرض')}/></>}
  </section>;
  return (
    <div className="camp-workspace student-workspace">
      <div className="camp-page-heading"><div><p className="camp-eyebrow">{t('OPERATIONS WORKSPACE','مساحة إدارة العمليات')}</p><h1>{t('Students & Groups','الطلاب والمجموعات')}</h1><p>{t(activeCamp.nameEn,activeCamp.nameAr)} · {activeCamp.code}</p></div>{!formOpen&&!readOnly&&section==='groups'&&!detailGroup&&<button type="button" className="camp-primary" disabled={!campRooms.length||!campInstructors.length} onClick={()=>setShowGroupForm(true)}><Plus size={17}/>{t('New Group','مجموعة جديدة')}</button>}{!formOpen&&!readOnly&&(section==='students'||detailGroup)&&<button type="button" className="camp-primary" disabled={!campGroups.length} onClick={()=>{if(selectedGroupId!=='all')setStuGroupId(selectedGroupId);setShowStudentForm(true);}}><UserPlus size={17}/>{t('Add Student','إضافة طالب')}</button>}{formOpen&&<button type="button" disabled={isBusy} className={BTN_SECONDARY} onClick={()=>{setShowGroupForm(false);setShowStudentForm(false);setTransferTargetStuId(null);}}>{t('Close form','إغلاق النموذج')}</button>}</div>
      <nav className="camp-section-tabs student-tabs" aria-label={t('Student management sections','أقسام إدارة الطلاب')}>{([{id:'groups',label:t('Groups','المجموعات'),icon:Layers},{id:'students',label:t('Students','الطلاب'),icon:GraduationCap},{id:'import',label:t('Import','استيراد'),icon:Upload},{id:'transfers',label:t('Transfers','النقل'),icon:ArrowRightLeft}] as const).map(tab=><button type="button" key={tab.id} disabled={isBusy||rosterParsing} aria-current={section===tab.id?'page':undefined} onClick={()=>changeSection(tab.id)}><tab.icon size={17}/><span>{tab.label}</span></button>)}</nav>
      {readOnly&&<InlineBanner type="error" message={t('Archived camp: read-only.','الكامب مؤرشف: للقراءة فقط.')}/>}
      {actionNotice && (
        <InlineBanner
          type={actionNotice.ok ? 'success' : 'error'}
          message={actionNotice.text}
          onDismiss={() => setActionNotice(null)}
        />
      )}

      {showGroupForm && !readOnly && (
        <form onSubmit={handleSaveGroup} className={`${SURFACE_CARD} camp-form p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Create Training Group', 'إنشاء مجموعة تدريبية جديدة')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor="grp-code" className={LABEL_CLASS}>
                {t('Group Code *', 'كود المجموعة *')}
              </label>
              <input
                id="grp-code"
                type="text"
                required
                placeholder={t('e.g. GRP-C', 'مثال: GRP-C')}
                value={grpCode}
                onChange={(e) => setGrpCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
              <button type="button" className={BTN_SECONDARY + ' mt-1'} onClick={() => setGrpCode(generateEntityCode('GRP'))}>{t('Generate code', 'توليد كود')}</button>
            </div>
            <div>
              <label htmlFor="grp-name-en" className={LABEL_CLASS}>
                {t('Name (English) *', 'الاسم (إنجليزي) *')}
              </label>
              <input
                id="grp-name-en"
                type="text"
                required
                placeholder={t('e.g. Group Gamma — Graphs', 'اسم المجموعة بالإنجليزية')}
                value={grpNameEn}
                onChange={(e) => setGrpNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-name-ar" className={LABEL_CLASS}>
                {t('Name (Arabic)', 'الاسم (عربي)')}
              </label>
              <input
                id="grp-name-ar"
                type="text"
                placeholder={t('Arabic group title', 'اسم المجموعة بالعربية')}
                value={grpNameAr}
                onChange={(e) => setGrpNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-track" className={LABEL_CLASS}>
                {t('Track *', 'المسار التدريبي *')}
              </label>
              <input
                id="grp-track"
                type="text"
                required
                placeholder={t('e.g. Competitive Programming L2', 'المسار التدريبي')}
                value={grpTrack}
                onChange={(e) => setGrpTrack(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-room" className={LABEL_CLASS}>
                {t('Default Room', 'القاعة الافتراضية')}
              </label>
              <select
                id="grp-room"
                required value={grpRoomId}
                onChange={(e) => setGrpRoomId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} ({r.name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grp-inst" className={LABEL_CLASS}>
                {t('Primary Instructor', 'المحاضر الأساسي')}
              </label>
              <select
                id="grp-inst"
                required value={grpInstId}
                onChange={(e) => setGrpInstId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campInstructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {t(i.fullNameEn, i.fullNameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div><label htmlFor="grp-period" className={LABEL_CLASS}>{t('Fixed period *','الفترة الثابتة *')}</label><select id="grp-period" value={grpPeriod} className={SELECT_CLASS} onChange={e=>setGrpPeriod(Number(e.target.value))}>{activeCamp.settings.periodSlots.map(p=><option key={p.period} value={p.period}>P{p.period} · {p.start}–{p.end}</option>)}</select></div>
            <div>
              <label htmlFor="grp-cap" className={LABEL_CLASS}>
                {t('Capacity', 'السعة الاستيعابية')}
              </label>
              <input
                id="grp-cap"
                type="number"
                min={1}
                max={100}
                value={grpCap}
                onChange={(e) => setGrpCap(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>

          <p className="people-note">{t('The group, primary instructor and room are fixed for the selected period across teaching days. Existing sessions are not changed. Active camps skip elapsed sessions. Saving is atomic.','المجموعة والمحاضر والقاعة ثابتون في الفترة المحددة طوال أيام الدراسة. لا تُعدل المحاضرات الموجودة ويتم تجاوز المواعيد المنقضية للكامب النشط. الحفظ يتم كعملية واحدة.')}</p>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setShowGroupForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Create Group & Schedule', 'إنشاء المجموعة والجدول')}
            </button>
          </div>
        </form>
      )}

      {showStudentForm && !readOnly && (
        <form onSubmit={handleCreateSingleStudent} className={`${SURFACE_CARD} camp-form p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Enroll Individual Student', 'تسجيل طالب جديد')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor="stu-code" className={LABEL_CLASS}>
                {t('Student Code *', 'كود الطالب *')}
              </label>
              <input
                id="stu-code"
                type="text"
                required
                placeholder={t('e.g. CITS-2615', 'مثال: CITS-2615')}
                value={stuCode}
                onChange={(e) => setStuCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
              <button type="button" className={BTN_SECONDARY + ' mt-1'} onClick={() => setStuCode(generateEntityCode('STU'))}>{t('Generate code', 'توليد كود')}</button>
            </div>
            <div>
              <label htmlFor="stu-name" className={LABEL_CLASS}>
                {t('Full Name *', 'الاسم الكامل *')}
              </label>
              <input
                id="stu-name"
                type="text"
                required
                placeholder={t('Student full name', 'اسم الطالب الكامل')}
                value={stuName}
                onChange={(e) => setStuName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="stu-univ" className={LABEL_CLASS}>
                {t('University', 'الجامعة')}
              </label>
              <input
                id="stu-univ"
                type="text"
                placeholder={t('e.g. Cairo University', 'اسم الجامعة')}
                value={stuUniv}
                onChange={(e) => setStuUniv(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="stu-grp" className={LABEL_CLASS}>
                {t('Assigned Group', 'المجموعة')}
              </label>
              <select
                id="stu-grp"
                value={stuGroupId}
                onChange={(e) => setStuGroupId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setShowStudentForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Save Student', 'حفظ الطالب')}
            </button>
          </div>
        </form>
      )}

      {transferTargetStuId && !readOnly && (
        <form
          onSubmit={handleSubmitTransfer}
          className={`${SURFACE_CARD} camp-form p-5 space-y-4`}
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#355F82]" />
            <span>
              {t(
                'Transfer Student Between Groups (Preserves Prior Day History)',
                'نقل طالب لمجموعة أخرى (مع حفظ سجل الأيام السابقة)'
              )}
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="tr-group" className={LABEL_CLASS}>
                {t('Destination Group', 'المجموعة الجديدة')}
              </label>
              <select
                id="tr-group"
                required value={transferToGroupId}
                onChange={(e) => setTransferToGroupId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t('Select destination','اختر المجموعة الجديدة')}</option>
                {campGroups.filter(g=>g.id!==allCampStudents.find(st=>st.id===transferTargetStuId)?.groupId).map((g) => (
                  <option key={g.id} value={g.id} disabled={allCampStudents.filter(st=>st.groupId===g.id).length>=g.capacity}>
                    {g.code} · {t(g.nameEn, g.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tr-day" className={LABEL_CLASS}>
                {t('Effective Camp Day', 'يسري من اليوم')}
              </label>
              <input
                id="tr-day"
                type="number"
                min={1}
                max={activeCamp.durationDays}
                value={transferDay}
                onChange={(e) => setTransferDay(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="tr-reason" className={LABEL_CLASS}>
                {t('Audit Reason *', 'سبب النقل *')}
              </label>
              <input
                id="tr-reason"
                type="text"
                required
                placeholder={t('e.g. Level assessment placement', 'سبب النقل التدريبي')}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setTransferTargetStuId(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Confirm Transfer', 'تأكيد النقل')}
            </button>
          </div>
        </form>
      )}

      {section==='import'&&!formOpen&&<form onSubmit={handleRunImport} className={SURFACE_CARD+' camp-form camp-wizard p-5 space-y-4'}>
        <div className="people-list-heading"><h2>{t('Import Student Roster','استيراد كشف الطلاب')}</h2><button type="button" className={BTN_SECONDARY} onClick={()=>downloadWorkbook('Student-Roster-Template',[['Full Name','Student Code','University']])}><Download size={15}/>{t('Download Excel template','تحميل نموذج Excel')}</button></div>
        <div className="camp-stepper">{[t('Select Group','اختيار المجموعة'),t('Upload File','رفع الملف'),t('Review & Import','مراجعة واستيراد')].map((label,i)=><div key={i} data-current={importStep===i} data-complete={importStep>i} aria-current={importStep===i?'step':undefined}><span>{importStep>i?<Check size={15}/>:i+1}</span><strong>{label}</strong></div>)}</div>
        {importStep===0&&<>        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#355F82]" />
              <span>
                {t('Batch Student Import & Smart Update', 'استيراد دفعات الطلاب والتحديث الذكي')}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#A0A5AA] mt-0.5">
              {t(
                'Upload one Excel (.xlsx) or CSV roster per group: Full Name, Student Code, University. Review before importing. Any invalid student cancels the entire batch.',
                'ارفع ملف Excel أو CSV واحدًا لكل مجموعة، بالأعمدة: الاسم الكامل، كود الطالب، الجامعة. راجع الكشف قبل الاستيراد؛ أي خطأ يوقف الدفعة بالكامل.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              aria-label={t('Target Group for Import', 'المجموعة المستهدفة للاستيراد')}
              value={importGroupId}
              onChange={(e) => setImportGroupId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#121416] text-xs font-medium"
            >
              {campGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>

            <select
              aria-label={t('Import Validation Mode', 'وضع التحقق من الاستيراد')}
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as 'smart_update' | 'strict_insert')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#121416] text-xs font-medium"
            >
              <option value="smart_update">{t('Smart Update Mode', 'وضع التحديث الذكي')}</option>
              <option value="strict_insert">{t('Strict New Only', 'إضافة جديدة فقط')}</option>
            </select>
          </div>
        </div>

<button type="button" className="camp-primary" disabled={!targetGroup||readOnly} onClick={()=>{setImportResult(null);setImportStep(1);}}>{t('Continue','التالي')}<ChevronRight size={15}/></button></>}
        {importStep===1&&<>        <div className="student-upload space-y-2">
          <label htmlFor="roster-excel-upload" className={LABEL_CLASS}>
            {t('Upload Excel / CSV group roster', 'رفع كشف المجموعة Excel أو CSV')}
          </label>
          <input
            id="roster-excel-upload"
            type="file"
            accept=".xlsx,.csv"
            disabled={isBusy || rosterParsing || campGroups.length === 0}
            onChange={e => {
              void handleRosterFileChange(e.currentTarget.files?.[0] || null);
              e.currentTarget.value = '';
            }}
            className={`${INPUT_CLASS} file:me-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:font-semibold file:text-blue-700`}
          />
          <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">
            {t(
              'First worksheet only. Columns: Full Name, Student Code, University. Maximum 1000 rows / 2 MB. File is read locally; no roster is saved until you confirm.',
              'أول ورقة فقط. الأعمدة: Full Name وStudent Code وUniversity. بحد أقصى 1000 طالب و2 ميجابايت. الملف يُقرأ على جهازك ولا تُحفظ بيانات الطلاب إلا بعد التأكيد.'
            )}
          </p>
          {rosterParsing && <p className="text-xs text-[#355F82]">{t('Reading file…', 'جاري قراءة الملف…')}</p>}
          {rosterFileError && <InlineBanner type="error" message={rosterFileError} />}
          {rosterRows && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-[#425A70] dark:bg-[#293747]/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                {t(
                  `Ready to import ${rosterRows.length} students from ${rosterFileName} into ${campGroups.find(g => g.id === (importGroupId || campGroups[0]?.id))?.code || 'selected group'}.`,
                  `جاهز لمراجعة ${rosterRows.length} طالب من ${rosterFileName} إلى المجموعة ${campGroups.find(g => g.id === (importGroupId || campGroups[0]?.id))?.code || ''}.`
                )}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-start">
                  <thead><tr className="text-slate-500 border-b">
                    <th className="py-1 pe-2">{t('Row','الصف')}</th>
                    <th className="py-1 pe-2">{t('Student','الطالب')}</th>
                    <th className="py-1 pe-2">{t('Student Code','كود الطالب')}</th>
                    <th className="py-1 pe-2">{t('University','الجامعة')}</th>
                  </tr></thead>
                  <tbody>
                    {rosterRows.slice(0, 5).map((student, i) => (
                      <tr key={i} className="border-b border-slate-100 dark:border-[#353A3F]">
                        <td className="py-1 pe-2">{student.rowNumber}</td>
                        <td className="py-1 pe-2">{student.studentName}</td>
                        <td className="py-1 pe-2">{student.studentCode}</td>
                        <td className="py-1 pe-2">{student.university || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rosterRows.length > 5 && (
                <p className="text-xs text-slate-500">{t(
                  `Showing first 5 of ${rosterRows.length}; all rows will be validated.`,
                  `معروض أول 5 من ${rosterRows.length}، وسيتم فحص جميع الصفوف.`
                )}</p>
              )}
              <button type="button" className={BTN_SECONDARY} disabled={isBusy}
                onClick={() => { setRosterRows(null); setRosterFileName(''); }}>
                {t('Discard file', 'إلغاء الملف')}
              </button>
            </div>
          )}
        </div>

        <label className={LABEL_CLASS}>{t('Or paste comma-separated rows','أو الصق الصفوف مفصولة بفواصل')}</label>
        <textarea
          rows={3}
          aria-label={t('Student batch rows', 'بيانات دفعة الطلاب')}
          placeholder={t(
            'Example:\nSalma Hassan, CITS-2620, Cairo University\nYoussef Adel, CITS-2621, Ain Shams University',
            'مثال:\nسلمى حسن، CITS-2620، جامعة القاهرة'
          )}
          value={rawBatchText}
          disabled={Boolean(rosterRows) || rosterParsing}
          onChange={(e) => setRawBatchText(e.target.value)}
          className={`${INPUT_CLASS} font-mono`}
        />

<div className="flex justify-end gap-2"><button type="button" className={BTN_SECONDARY} disabled={rosterParsing} onClick={()=>setImportStep(0)}>{t('Back','السابق')}</button><button type="button" className="camp-primary" disabled={rosterParsing||!!rosterFileError||!parsedRows.length} onClick={()=>setImportStep(2)}>{t('Review roster','مراجعة الكشف')}</button></div></>}
        {importStep===2&&<><div className="student-review-summary"><div><small>{t('Total rows','عدد الصفوف')}</small><strong>{parsedRows.length}</strong></div><div><small>{t('Rows without errors','صفوف بلا أخطاء')}</small><strong>{parsedRows.filter(r=>!previewErrors.some(e=>e.rowNumber===r.rowNumber)).length}</strong></div><div><small>{t('Errors','الأخطاء')}</small><strong>{previewErrors.length}</strong></div></div><p className="people-note">{t('Target group','المجموعة المستهدفة')}: {targetGroup?groupName(targetGroup.id):'—'} · {importMode==='strict_insert'?t('New only','إضافة فقط'):t('Smart update','تحديث ذكي')}</p>
          {previewErrors.filter(e=>e.rowNumber===0).map((err,i)=><InlineBanner key={i} type="error" message={err.message}/>)}
          <div className="student-review-table"><table><thead><tr><th>{t('Row','الصف')}</th><th>{t('Student','الطالب')}</th><th>{t('Code','الكود')}</th><th>{t('Status','الحالة')}</th></tr></thead><tbody>{parsedRows.map((row,i)=>{const errors=previewErrors.filter(e=>e.rowNumber===row.rowNumber);return <tr key={i}><td>{row.rowNumber}</td><td>{row.studentName||'—'}</td><td>{row.studentCode||'—'}</td><td>{errors.length?<span className="student-error">{errors.map(e=>e.message).join(' · ')}</span>:<span className="student-valid">{t('Ready','جاهز')}</span>}</td></tr>;})}</tbody></table></div>
          <p className="people-note">{previewErrors.length?t('Resolve errors before importing. No rows have been saved.','صحح الأخطاء قبل الاستيراد. لم يتم حفظ أي صف.'):t('Server revalidates the complete batch on confirmation.','يعيد الخادم التحقق من الدفعة بالكامل عند التأكيد.')}</p><div className="flex justify-end gap-2"><button type="button" className={BTN_SECONDARY} disabled={isBusy} onClick={()=>setImportStep(1)}>{t('Back','السابق')}</button><button type="submit" className="camp-primary" disabled={isBusy||readOnly||previewErrors.length>0||!parsedRows.length}>{t('Confirm & Import Group Roster','تأكيد واستيراد كشف المجموعة')}</button></div></>}
                {importResult && (
          <div
            role="status"
            className={`p-3.5 rounded-lg border text-xs ${
              importResult.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
            }`}
          >
            {importResult.ok ? (
              <p className="font-semibold">
                {t(
                  `Batch validated and applied: ${importResult.inserted} added, ${importResult.updated} updated via Smart Update.`,
                  `تم التحقق وتطبيق الدفعة: تمت إضافة ${importResult.inserted} وتحديث ${importResult.updated}.`
                )}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    {t(
                      'Validation failed — Zero records imported:',
                      'فشل التحقق — لم يتم استيراد أي سجل:'
                    )}
                  </span>
                </p>
                <ul className="list-disc list-inside space-y-0.5 font-mono">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

      </form>}
      {section==='groups'&&!formOpen&&!detailGroup&&<>
        <div className="camp-summary">{[{label:t('Students','الطلاب'),n:allCampStudents.length},{label:t('Groups','المجموعات'),n:campGroups.length},{label:t('Available seats','الأماكن المتاحة'),n:campGroups.reduce((n,g)=>n+Math.max(0,g.capacity-allCampStudents.filter(st=>st.groupId===g.id).length),0)}].map(m=><article className="student-summary-card" key={m.label}><span>{m.label}</span><strong>{m.n}</strong></article>)}</div>
        {!campGroups.length?<EmptyState icon={Layers} title={t('No groups yet','لا توجد مجموعات')}/>:<div className="camp-card-grid">{campGroups.map(g=>{const n=allCampStudents.filter(st=>st.groupId===g.id).length;const inst=instructors.find(i=>i.id===g.primaryInstructorId);const room=rooms.find(r=>r.id===g.defaultRoomId);return <article className="camp-card student-group-card" key={g.id} data-status="active"><div className="camp-card-head"><span className="camp-icon"><Layers size={22}/></span><div><h2>{groupName(g.id)}</h2><p>{g.code} · {g.track}</p></div></div><div className="camp-card-body"><div className="camp-card-detail"><Users size={16}/>{inst?t(inst.fullNameEn,inst.fullNameAr):'—'}</div><div className="camp-card-detail"><DoorOpen size={16}/>{room?.name||'—'}</div><div className="camp-card-detail"><CalendarDays size={16}/>{g.fixedPeriodNumber!=null?'P'+g.fixedPeriodNumber:t('Fixed period not set','الفترة الثابتة غير محددة')}</div><div className="camp-card-progress" data-capacity={n>g.capacity?'over':n===g.capacity?'full':'available'}><div><strong>{n}/{g.capacity}</strong><span>{n>g.capacity?t('Over capacity','تجاوز السعة'):n===g.capacity?t('Full','ممتلئة'):t(`${g.capacity-n} seats left`,`${g.capacity-n} أماكن متاحة`)}</span></div><div className="camp-progress-track"><span style={{width:Math.min(100,n/Math.max(1,g.capacity)*100)+'%'}}/></div></div><button type="button" className="camp-primary" onClick={()=>openGroup(g.id)}>{t('View group','عرض المجموعة')}<ChevronRight size={15}/></button></div></article>;})}</div>}
      </>}
      {section==='groups'&&detailGroup&&!formOpen&&(()=>{const gl=campLectures.filter(l=>l.groupId===detailGroup.id);const finishedIds=new Set(finalized.filter(sh=>gl.some(l=>l.id===sh.lectureId)).map(sh=>sh.lectureId));const gh=[...historyByStudent.values()].flat().filter(h=>h.lecture.groupId===detailGroup.id);const gs=summarize(gh);const gi=instructors.find(i=>i.id===detailGroup.primaryInstructorId);const room=rooms.find(r=>r.id===detailGroup.defaultRoomId);return <><button type="button" className="camp-link" onClick={()=>{setDetailGroupId(null);setSelectedGroupId('all');setSelectedIds([]);}}>{t('Back to groups','رجوع للمجموعات')}</button><div className="student-group-banner"><div><h2>{groupName(detailGroup.id)}</h2><p>{detailGroup.code} · {detailGroup.track}</p><p>{gi?t(gi.fullNameEn,gi.fullNameAr):'—'} · {room?.name||'—'}</p></div><div className="student-group-metrics">{[{l:t('Students','الطلاب'),v:allCampStudents.filter(st=>st.groupId===detailGroup.id).length+'/'+detailGroup.capacity},{l:t('Recorded attendance','الحضور المسجل'),v:gs.rate==null?'—':gs.rate+'%'},{l:t('Finished sessions','المحاضرات المنتهية'),v:finishedIds.size+'/'+gl.length}].map(m=><div key={m.l}><strong>{m.v}</strong><small>{m.l}</small></div>)}</div></div>{!readOnly&&<div className="camp-form p-3 border rounded-xl"><button type="button" className={BTN_SECONDARY} disabled={isBusy} onClick={()=>{setGrpPeriod(detailGroup.fixedPeriodNumber??activeCamp.settings.periodSlots[0]?.period??1);setExistingFixed(v=>!v);}}><CalendarDays size={16}/>{detailGroup.fixedPeriodNumber!=null?t('Fill missing teaching days','استكمال أيام الدراسة'):t('Set fixed schedule','تحديد الجدول الثابت')}</button>{existingFixed&&<div className="mt-3 flex flex-wrap gap-2 items-end"><label className="grid gap-1 text-sm">{t('Fixed period','الفترة الثابتة')}<select className={SELECT_CLASS} value={grpPeriod} disabled={detailGroup.fixedPeriodNumber!=null||isBusy} onChange={e=>setGrpPeriod(Number(e.target.value))}>{activeCamp.settings.periodSlots.map(p=><option key={p.period} value={p.period}>P{p.period} · {p.start}–{p.end}</option>)}</select></label><button type="button" className="camp-primary" disabled={isBusy} onClick={async()=>{setIsBusy(true);try{const res=await upsertGroup({...detailGroup,fixedPeriodNumber:grpPeriod});setActionNotice({ok:res.ok,text:res.ok?t(`Created ${res.created??0} sessions; skipped ${res.skipped??0} existing or elapsed days.`,`تم إنشاء ${res.created??0} محاضرة وتجاوز ${res.skipped??0} يوم موجود أو منقضٍ.`):res.error||'Failed'});if(res.ok)setExistingFixed(false);}finally{setIsBusy(false)}}}>{t('Save fixed schedule','حفظ الجدول الثابت')}</button><p className="people-note w-full">{t('Only missing future days are created. Existing sessions and exceptions remain unchanged.','تُنشأ الأيام المستقبلية الناقصة فقط. تبقى المحاضرات والاستثناءات الموجودة دون تعديل.')}</p></div>}</div>}<nav className="camp-section-tabs" aria-label={t('Group details sections','أقسام تفاصيل المجموعة')}>{(['students','schedule','attendance'] as const).map(tab=><button key={tab} type="button" aria-current={groupTab===tab?'page':undefined} onClick={()=>setGroupTab(tab)}>{tab==='students'?t('Students','الطلاب'):tab==='schedule'?t('Schedule','الجدول'):t('Attendance','الحضور')}</button>)}</nav>{groupTab==='students'&&roster}{groupTab==='schedule'&&<section className="people-list"><h2 className="font-semibold mb-3">{t('Group schedule','جدول المجموعة')}</h2>{!gl.length?<EmptyState icon={CalendarDays} title={t('No sessions scheduled','لا توجد محاضرات')}/>:gl.sort((a,b)=>a.campDay-b.campDay||a.startTime.localeCompare(b.startTime)).map(l=><div className="student-history-row" key={l.id}><div><strong>{l.topic}</strong><small>{t('Day','اليوم')} {l.campDay} · {l.startTime.slice(0,5)}–{l.endTime.slice(0,5)}</small></div><span>{finishedIds.has(l.id)?t('Finished','منتهية'):t('Not finalized','غير معتمدة')}</span></div>)}</section>}{groupTab==='attendance'&&<section className="people-list"><h2 className="font-semibold mb-3">{t('Finalized attendance by session','الحضور المعتمد لكل محاضرة')}</h2><p className="people-note">{t('Only finalized marks for this group, including visiting students.','التسجيلات المعتمدة للمجموعة بما فيها الزوار.')}</p>{gl.filter(l=>finishedIds.has(l.id)).map(l=>{const v=summarize(gh.filter(h=>h.lecture.id===l.id));return <div key={l.id} className="student-history-row"><div><strong>{l.topic}</strong><small>{t('Day','اليوم')} {l.campDay} · {v.recorded} {t('marks','تسجيلات')}</small></div><span>{v.rate==null?'—':v.rate+'%'}</span></div>;})}{!finishedIds.size&&<EmptyState icon={ClipboardCheck} title={t('No finalized attendance yet','لا حضور معتمد حتى الآن')}/>}</section>}</>;})()}
      {section==='students'&&!formOpen&&roster}
      {detailStudent&&!formOpen&&(()=>{const v=statsByStudent.get(detailStudent.id)!;const history=(historyByStudent.get(detailStudent.id)||[]).slice().sort((a,b)=>b.lecture.campDay-a.lecture.campDay||b.lecture.startTime.localeCompare(a.lecture.startTime));const profile=<><div className="people-profile-banner"><span className="people-avatar"><GraduationCap size={26}/></span><div><h2>{detailStudent.fullName}</h2><p>{detailStudent.studentCode} · {groupName(detailStudent.groupId)}</p></div><StatusBadge tone={detailStudent.isActive?'success':'neutral'}>{detailStudent.isActive?t('Active','نشط'):t('Inactive','غير نشط')}</StatusBadge></div><div className="student-profile-content"><div className="student-profile-rate"><small>{t('Recorded attendance rate','نسبة الحضور المعتمد')}</small><strong>{v.rate==null?'—':v.rate+'%'}</strong><div className="camp-progress-track"><span style={{width:(v.rate??0)+'%'}}/></div></div><div className="student-review-summary">{[{l:t('Present','حاضر'),n:v.present},{l:t('Late','متأخر'),n:v.late},{l:t('Absent','غائب'),n:v.absent},{l:t('Excused','بعذر'),n:v.excused}].map(m=><div key={m.l}><small>{m.l}</small><strong>{m.n}</strong></div>)}</div><p className="people-note">{t('Rate includes present and late marks over all finalized marked sessions. Missing and draft marks are excluded.','النسبة تشمل الحاضر والمتأخر من كل التسجيلات المعتمدة. لا تشمل التسجيلات الناقصة أو المسودات.')}</p><dl className="people-detail-grid">{[{l:t('University','الجامعة'),v:detailStudent.university},{l:t('Joined day','يوم الانضمام'),v:detailStudent.joinedCampDay??1},{l:t('Added by','أضافه'),v:profiles.find(p=>p.id===detailStudent.enrolledByProfileId)?.fullNameEn||'—'},{l:t('Enrollment date','تاريخ التسجيل'),v:detailStudent.enrolledAt?new Date(detailStudent.enrolledAt).toLocaleString():'—'},{l:t('Enrollment reason','سبب التسجيل'),v:detailStudent.enrollmentReason||'—'}].map(m=><div key={m.l}><dt>{m.l}</dt><dd>{m.v}</dd></div>)}</dl><h3 className="font-semibold">{t('Attendance history','سجل الحضور')}</h3>{(fullProfile?history:history.slice(0,5)).map(h=><div className="student-history-row" key={h.lecture.id}><div><strong>{t('Day','اليوم')} {h.lecture.campDay} · {h.lecture.topic}</strong><small>{groupName(h.record.attendedGroupId)}{h.record.isCrossGroup?' · '+t('Cross-group visit','حضور بمجموعة أخرى'):''}</small></div><StatusBadge tone={h.record.mark===AttendanceMark.ABSENT?'danger':h.record.mark===AttendanceMark.PRESENT?'success':'warning'}>{markLabel(h.record.mark)}</StatusBadge></div>)}{!history.length&&<p className="people-note">{t('No finalized marks.','لا تسجيلات معتمدة.')}</p>}{!fullProfile&&<button type="button" className={BTN_SECONDARY} onClick={()=>setFullProfile(true)}>{t('Full profile','الملف الكامل')}</button>}{!readOnly&&<button type="button" className="camp-primary" disabled={campGroups.length<2} onClick={()=>openTransfer(detailStudent)}><ArrowRightLeft size={16}/>{t('Transfer student','نقل الطالب')}</button>}{fullProfile&&<><h3 className="font-semibold">{t('Transfer history','سجل النقل')}</h3>{campTransfers.filter(tr=>tr.studentId===detailStudent.id).map(tr=><div className="student-history-row" key={tr.id}><div><strong>{groupName(tr.fromGroupId)} → {groupName(tr.toGroupId)}</strong><small>{tr.reason}</small></div><span>{t('Day','اليوم')} {tr.effectiveCampDay}</span></div>)}</>}</div></>;return <div className="student-drawer-backdrop" onClick={()=>setStudentId(null)}><section role="dialog" aria-modal="true" aria-label={t('Student details','تفاصيل الطالب')} className={'student-drawer'+(fullProfile?' expanded':'')} onClick={e=>e.stopPropagation()}><div className="people-list-heading"><h2>{fullProfile?t('Student profile','ملف الطالب'):t('Student details','تفاصيل الطالب')}</h2><button type="button" aria-label={t('Close details','إغلاق التفاصيل')} className="camp-icon-button" onClick={()=>setStudentId(null)}><X size={19}/></button></div>{profile}</section></div>;})()}
      {section==='transfers'&&!formOpen&&(
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Recent Group Transfer History', 'سجل نقل الطلاب بين المجموعات')}
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {!campTransfers.length&&<EmptyState icon={ArrowRightLeft} title={t('No transfers yet','لا يوجد نقل حتى الآن')}/>}
            {campTransfers.map((tr) => {
              const stu = students.find((s) => s.id === tr.studentId);
              const fromG = groups.find((g) => g.id === tr.fromGroupId);
              const toG = groups.find((g) => g.id === tr.toGroupId);
              return (
                <div key={tr.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {stu?.fullName || tr.studentId}
                    </span>{' '}
                    <span className="font-mono text-slate-500">
                      ({fromG?.code || tr.fromGroupId} → {toG?.code || tr.toGroupId}, Day{' '}
                      {tr.effectiveCampDay})
                    </span>
                    <p className="text-slate-500 mt-0.5">{tr.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
