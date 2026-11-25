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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Camp, CampStatus, Instructor } from '../../types/database';
import { ALL_CAMP_WEEKDAYS, calculateCampDayDate, validateCampWeekdays, RawStudentImportRow } from '../../domain/businessRules';
import { generateEntityCode } from '../../domain/generateEntityCode';
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
      <div className="camp-page-heading"><div><p className="camp-eyebrow">{t('OPERATIONS WORKSPACE','مساحة إدارة العمليات')}</p><h1>{t('Instructors','المحاضرون')}</h1><p>{t('Manage your teaching team.','إدارة فريق المحاضرين.')}</p></div>{!showCreateForm&&!editingInst&&!viewingInst&&<button type="button" className="camp-primary" onClick={handleOpenCreateForm} disabled={isBusy}><UserPlus size={17}/>{t('New Instructor','إضافة محاضر')}</button>}{(showCreateForm||editingInst||viewingInst)&&<button type="button" className={BTN_SECONDARY} disabled={isBusy} onClick={()=>{resetCreateForm();setShowCreateForm(false);setEditingInst(null);setEditCredential('');setViewingInst(null);setFeedback(null);}}>{t('Back to instructors','رجوع للمحاضرين')}</button>}</div>
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

      {!showCreateForm&&!editingInst&&!viewingInst&&<>
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
    upsertGroup,
    createSingleStudent,
    transferStudent,
    importStudentsBatch,
    t,
  } = useApp();

  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : [];

  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [importGroupId, setImportGroupId] = useState<string>(campGroups[0]?.id || '');
  const [importMode, setImportMode] = useState<'smart_update' | 'strict_insert'>('smart_update');
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
  const [grpRoomId, setGrpRoomId] = useState(rooms[0]?.id || '');
  const [grpInstId, setGrpInstId] = useState(instructors[0]?.id || '');
  const [grpCap, setGrpCap] = useState(30);

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
    if (!importGroupId && campGroups[0]?.id) setImportGroupId(campGroups[0].id);
    if (!stuGroupId && campGroups[0]?.id) setStuGroupId(campGroups[0].id);
    if (!grpRoomId && rooms[0]?.id) setGrpRoomId(rooms[0].id);
    if (!grpInstId && instructors[0]?.id) setGrpInstId(instructors[0].id);
  }, [campGroups, rooms, instructors, importGroupId, stuGroupId, grpRoomId, grpInstId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroupId, searchQuery]);

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

  const allCampStudents = students.filter((s) => s.campId === activeCamp.id);
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCampStudents.filter((s) => {
      if (selectedGroupId !== 'all' && s.groupId !== selectedGroupId) return false;
      if (!q) return true;
      return (
        s.studentCode.toLowerCase().includes(q) ||
        s.fullName.toLowerCase().includes(q) ||
        s.university.toLowerCase().includes(q)
      );
    });
  }, [allCampStudents, selectedGroupId, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PAGE_SIZE));
  const pagedStudents = filteredStudents.slice(
    (currentPage - 1) * STUDENTS_PAGE_SIZE,
    currentPage * STUDENTS_PAGE_SIZE
  );
  const campTransfers = studentTransfers.filter((tr) => tr.campId === activeCamp.id);

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
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Failed saving group.', 'تعذر حفظ المجموعة.') });
      } else {
        setActionNotice({ ok: true, text: t('Training group created.', 'تم إنشاء المجموعة التدريبية.') });
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
    if (!transferTargetStuId) return;
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
    if (!rosterRows && !rawBatchText.trim()) return;
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
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Students & Groups', 'الطلاب والمجموعات')}
        subtitle={t(
          'Students belong to one camp group without login accounts. Batch import validates every row atomically.',
          'الطلاب مسجلون في معسكر محدد دون حسابات دخول، ويتم التحقق من كل سجل قبل استيراد الدفعة.'
        )}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setShowGroupForm((p) => !p);
                setShowStudentForm(false);
              }}
              className={BTN_SECONDARY}
            >
              <Plus className="w-3.5 h-3.5 text-[#355F82]" />
              <span>{t('New Group', 'مجموعة جديدة')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowStudentForm((p) => !p);
                setShowGroupForm(false);
              }}
              className={BTN_PRIMARY}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('Add Student', 'إضافة طالب')}</span>
            </button>
          </>
        }
      />

      {actionNotice && (
        <InlineBanner
          type={actionNotice.ok ? 'success' : 'error'}
          message={actionNotice.text}
          onDismiss={() => setActionNotice(null)}
        />
      )}

      {showGroupForm && (
        <form onSubmit={handleSaveGroup} className={`${SURFACE_CARD} p-5 space-y-4`}>
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
                value={grpRoomId}
                onChange={(e) => setGrpRoomId(e.target.value)}
                className={SELECT_CLASS}
              >
                {rooms.map((r) => (
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
                value={grpInstId}
                onChange={(e) => setGrpInstId(e.target.value)}
                className={SELECT_CLASS}
              >
                {instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {t(i.fullNameEn, i.fullNameAr)}
                  </option>
                ))}
              </select>
            </div>
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

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#353A3F]">
            <button
              type="button"
              onClick={() => setShowGroupForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Create Group', 'إنشاء المجموعة')}
            </button>
          </div>
        </form>
      )}

      {showStudentForm && (
        <form onSubmit={handleCreateSingleStudent} className={`${SURFACE_CARD} p-5 space-y-4`}>
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

      {transferTargetStuId && (
        <form
          onSubmit={handleSubmitTransfer}
          className={`${SURFACE_CARD} border-blue-200 dark:border-[#425A70]/60 p-5 space-y-4`}
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
                value={transferToGroupId}
                onChange={(e) => setTransferToGroupId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campGroups.map((g) => (
                  <option key={g.id} value={g.id}>
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

      {/* Batch Import Form */}
      <form onSubmit={handleRunImport} className={`${SURFACE_CARD} p-5 space-y-4`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
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

          <div className="flex flex-wrap items-center gap-2">
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

        <div className="space-y-2">
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

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={isBusy || rosterParsing || Boolean(rosterFileError) || campGroups.length === 0 || (!rosterRows && !rawBatchText.trim())}
            className={BTN_PRIMARY}
          >
            {t('Confirm & Import Group Roster', 'تأكيد واستيراد كشف المجموعة')}
          </button>
        </div>

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
      </form>

      {/* Students Filter + Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setSelectedGroupId('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              selectedGroupId === 'all'
                ? 'bg-[#355F82] text-white'
                : 'border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-600 dark:text-[#C0C5C9]'
            }`}
          >
            {t('All Groups', 'كل المجموعات')} ({allCampStudents.length})
          </button>
          {campGroups.map((grp) => (
            <button
              key={grp.id}
              type="button"
              onClick={() => setSelectedGroupId(grp.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                selectedGroupId === grp.id
                  ? 'bg-[#355F82] text-white'
                  : 'border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-600 dark:text-[#C0C5C9]'
              }`}
            >
              {grp.code}
            </button>
          ))}
        </div>

        <div className="relative md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search student code, name, university...', 'ابحث بالكود أو الاسم أو الجامعة...')}
            aria-label={t('Search students', 'بحث الطلاب')}
            className={`${INPUT_CLASS} ps-9`}
          />
        </div>
      </div>

      {/* Students Table + Mobile Cards + Pagination */}
      {pagedStudents.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t('No students found', 'لا يوجد طلاب مطابقون للبحث')}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Student Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {pagedStudents.map((stu) => {
              const grp = groups.find((g) => g.id === stu.groupId);
              return (
                <div key={stu.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-[#355F82] dark:text-[#88A9CC]">
                      {stu.studentCode}
                    </p>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {stu.fullName}
                    </p>
                    <p className="text-slate-500 truncate mt-0.5">
                      {grp ? grp.code : stu.groupId} · {stu.university}
                    </p>
                    {stu.enrollmentOrigin === 'instructor_late_join' && (
                      <p className="text-amber-800 dark:text-amber-300 mt-1">
                        {t('Joined Day', 'انضم يوم')} {stu.joinedCampDay}
                        {' · '}{t('Added by', 'أضافه')} {profiles.find(p => p.id === stu.enrolledByProfileId)?.fullNameEn || t('Instructor', 'محاضر')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={campGroups.length < 2}
                    onClick={() => {
                      const otherGroup = campGroups.find((g) => g.id !== stu.groupId);
                      setTransferTargetStuId(stu.id);
                      setTransferToGroupId(otherGroup?.id || '');
                      setTransferDay(activeCamp.currentCampDay);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] disabled:opacity-40 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3 h-3" />
                    <span>{t('Transfer', 'نقل')}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Desktop Students Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-[#353A3F] text-slate-500 dark:text-[#A0A5AA]">
                  <th className="py-3 px-5 font-semibold text-start">{t('Student Code', 'كود الطالب')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Full Name', 'اسم الطالب')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Assigned Group', 'المجموعة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('University', 'الجامعة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Enrollment', 'تفاصيل التسجيل')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Transfer', 'نقل')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {pagedStudents.map((stu) => {
                  const grp = groups.find((g) => g.id === stu.groupId);
                  return (
                    <tr
                      key={stu.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-5 font-mono tabular-nums font-semibold text-[#355F82] dark:text-[#88A9CC]">
                        {stu.studentCode}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {stu.fullName}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-[#C0C5C9]">
                        {grp ? `${grp.code} · ${t(grp.nameEn, grp.nameAr)}` : stu.groupId}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-[#A0A5AA]">
                        {stu.university}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-[#C0C5C9]">
                        {stu.enrollmentOrigin === 'instructor_late_join' ? (
                          <div className="space-y-1 text-xs">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              {t('Joined Day', 'انضم يوم')} {stu.joinedCampDay}
                            </p>
                            <p>{t('Added by', 'أضافه')} {profiles.find(p => p.id === stu.enrolledByProfileId)?.fullNameEn || t('Instructor', 'محاضر')}</p>
                            {stu.enrolledAt && <p className="text-slate-500">{new Date(stu.enrolledAt).toLocaleString()}</p>}
                            {stu.enrollmentReason && <p className="text-slate-500">{stu.enrollmentReason}</p>}
                          </div>
                        ) : <span className="text-slate-500">{t('Initial roster', 'الكشف الأصلي')} · {t('Day 1', 'اليوم الأول')}</span>}
                      </td>
                      <td className="py-3 px-5 text-end">
                        <button
                          type="button"
                          disabled={campGroups.length < 2}
                          onClick={() => {
                            const otherGroup = campGroups.find((g) => g.id !== stu.groupId);
                            setTransferTargetStuId(stu.id);
                            setTransferToGroupId(otherGroup?.id || '');
                            setTransferDay(activeCamp.currentCampDay);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          <span>{t('Transfer', 'نقل')}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            totalItems={filteredStudents.length}
            pageSize={STUDENTS_PAGE_SIZE}
            onPageChange={setCurrentPage}
            labelShowing={t('Showing', 'عرض')}
          />
        </div>
      )}

      {campTransfers.length > 0 && (
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Recent Group Transfer History', 'سجل نقل الطلاب بين المجموعات')}
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
