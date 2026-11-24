import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarClock,
  MapPinCheck,
  UserCircle,
  Globe,
  Sun,
  Moon,
  LogOut,
  Bell,
  RefreshCw,
  User,
  GraduationCap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CampSwitcher } from '../components/ui/CampSwitcher';
import { InstructorRouteId } from '../types/database';

const INSTRUCTOR_TABS: {
  id: InstructorRouteId;
  labelEn: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', labelEn: 'Home', labelAr: 'الرئيسية', icon: LayoutDashboard },
  { id: 'schedule', labelEn: 'Sessions', labelAr: 'المحاضرات', icon: CalendarClock },
  { id: 'checkin', labelEn: 'Check-in', labelAr: 'الوصول', icon: MapPinCheck },
  { id: 'profile', labelEn: 'Profile', labelAr: 'حسابي', icon: UserCircle },
];

export const InstructorLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    instructorRoute,
    setInstructorRoute,
    activeCamp,
    auth,
    isSupabaseMode,
    isSandboxMode,
    isLoadingData,
    dataError,
    refreshOperationalData,
    instructors,
    notifications,
    markNotificationRead,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    t,
  } = useApp();

  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || (isSandboxMode ? instructors[0] : undefined);

  const myNotifications = notifications.filter(
    (n) => n.recipientProfileId === auth.currentProfile.id
  );
  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  return (
    <div className="instructor-shell min-h-screen w-full min-w-0 bg-[var(--bg-canvas)] dark:bg-[var(--bg-canvas)] text-slate-900 dark:text-[#F0F1F2] flex flex-col pb-8">
      {isSandboxMode && (
        <div role="status" aria-live="polite" className="px-4 sm:px-6 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
          <strong>{t('LOCAL SANDBOX PREVIEW', 'معاينة محلية تجريبية')}</strong>
          <span className="ms-2">{t('Not connected to Supabase. Changes are demo-only and are not saved to the remote database.', 'لا يوجد اتصال بـ Supabase. التغييرات تجريبية فقط ولا تُحفظ في قاعدة البيانات البعيدة.')}</span>
        </div>
      )}
      {/* Desktop instructor workspace navigation; mobile keeps the bottom bar. */}
      <aside className="instructor-desktop-nav hidden lg:flex fixed inset-y-0 start-0 w-56 z-40 flex-col overflow-hidden bg-gradient-to-b from-[#10263e] via-[#12354e] to-[#07545f] text-white">
        <div className="px-4 lg:px-5 py-6 flex items-center gap-2.5 border-b border-white/10"><GraduationCap className="w-7 h-7 shrink-0 text-white"/><div className="min-w-0"><p className="text-base lg:text-lg tracking-tight font-bold whitespace-nowrap">Operation <span className="text-[#76d8c4]">LMS</span></p><p className="text-[10px] text-blue-100/80 mt-1">{t('Instructor workspace','مساحة عمل المحاضر')}</p></div></div>
        <nav aria-label={t('Instructor navigation','قائمة تنقل المحاضر')} className="flex flex-col gap-2 px-3 py-5">
          {INSTRUCTOR_TABS.map(tab=>{const Icon=tab.icon;const isActive=instructorRoute===tab.id||(tab.id==='schedule'&&instructorRoute==='attendance');return <button type="button" key={tab.id} aria-current={isActive?'page':undefined} onClick={()=>setInstructorRoute(tab.id)} className={'w-full min-h-[48px] rounded-xl px-3 py-3 flex items-center gap-3 text-sm font-semibold text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 '+(isActive?'bg-[#176078] text-white':'text-blue-50 hover:bg-white/10')}><Icon className="w-5 h-5 shrink-0"/><span>{t(tab.labelEn,tab.labelAr)}</span></button>})}
        </nav>
        <div className="mt-auto p-4 lg:p-5 border-t border-white/10 relative"><div aria-hidden="true" className="absolute -bottom-36 -end-28 w-72 h-72 rounded-full border-[32px] border-teal-100/10 pointer-events-none"/><p className="text-xs text-blue-100/80">{t('Current camp','الكامب الحالي')}</p><p className="text-sm font-semibold mt-1 break-words">{activeCamp?t(activeCamp.nameEn,activeCamp.nameAr):'—'}</p></div>
      </aside>
      <div className="instructor-workspace lg:ms-56 flex flex-col flex-1 min-w-0">
      {/* Workspace header */}
      <header className="instructor-header sticky top-0 z-30 min-h-14 app-glass-header px-3 sm:px-6 flex items-center justify-between gap-2 lg:gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setInstructorRoute('dashboard')}
            className="flex items-center gap-2.5 text-start cursor-pointer min-w-0"
          >
            <span className="w-7 h-7 rounded-lg bg-[#355F82] text-white text-xs font-bold flex items-center justify-center shrink-0 tracking-tight">
              CI
            </span>
            <div className="min-w-0">
              <span className="sm:hidden block text-xs font-bold truncate">{t("Instructor","المحاضر")}</span>
              <span className="hidden sm:block text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {t('CITS Instructor', 'بوابة المحاضر')}
              </span>
              {activeCamp && (
                <span className="hidden sm:block text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#A0A5AA] truncate">
                  {activeCamp.code} ·{' '}
                  {t(
                    `Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`,
                    `اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`
                  )}
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Quiet Utility Controls + Instructor Account */}
        <div className="instructor-header-actions flex items-center gap-1 sm:gap-2 shrink-0">
          {isSupabaseMode && (
            <button
              type="button"
              disabled={isLoadingData}
              onClick={() => refreshOperationalData()}
              aria-label={t('Refresh data', 'تحديث البيانات')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span className="hidden lg:inline">{t('Refresh', 'تحديث')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowNotifPanel((prev) => !prev)}
            aria-label={t('Notifications', 'الإشعارات')}
            aria-expanded={showNotifPanel}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-slate-600 dark:text-[#C0C5C9]" />
            {unreadCount > 0 && (
              <span className="font-mono tabular-nums text-[11px] font-semibold text-[#355F82] dark:text-[#88A9CC]">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            aria-label={t('Switch Language', 'تغيير اللغة')}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === 'en' ? 'AR' : 'EN'}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t('Toggle theme', 'تبديل المظهر')}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-[#C0C5C9] cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-[#25292D] hidden xl:block shrink-0" />

          <div className="hidden xl:flex items-center gap-1.5 ps-0.5 max-w-[160px]">
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-medium text-slate-700 dark:text-[#DEE1E4] truncate">
              {currentInstructor
                ? t(currentInstructor.fullNameEn, currentInstructor.fullNameAr)
                : t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => signOut()}
            aria-label={t('Logout', 'تسجيل الخروج')}
            title={t('Logout', 'تسجيل الخروج')}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-red-50 dark:hover:bg-red-950/30 text-slate-600 dark:text-[#C0C5C9] hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Notifications Popover */}
        {showNotifPanel && (
          <div className="absolute end-4 sm:end-6 top-full mt-2 w-80 max-w-[90vw] z-40 rounded-xl border border-slate-200/90 dark:border-[#353A3F] bg-white/95 dark:bg-[#1D2023]/95 backdrop-blur-md shadow-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-white">
              <span>{t('Notifications', 'الإشعارات')}</span>
              <button
                type="button"
                onClick={() => setShowNotifPanel(false)}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                {t('Close', 'إغلاق')}
              </button>
            </div>
            {myNotifications.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                {t('No notifications.', 'لا توجد إشعارات حالياً.')}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
                {myNotifications.map((n) => (
                  <div key={n.id} className="py-2.5 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {t(n.titleEn, n.titleAr)}
                      </p>
                      <p className="text-slate-500 mt-0.5">{t(n.bodyEn, n.bodyAr)}</p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => markNotificationRead(n.id)}
                        className="text-[#355F82] dark:text-[#88A9CC] font-semibold shrink-0 cursor-pointer"
                      >
                        {t('Read', 'قرئت')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="instructor-camp-bar flex items-center gap-2 px-3 sm:px-6 py-2 bg-slate-50/70 dark:bg-[#25292D]/70 border-b border-slate-200 dark:border-[#353A3F] text-xs">
        <span className="font-semibold shrink-0">{t('My Camp:', 'الكامب الخاص بي:')}</span>
        <CampSwitcher />
        <span className="hidden xl:inline text-slate-500 dark:text-[#A0A5AA]">
          {t('Switch to view your sessions and check-ins for each camp.',
             'بدّل الكامب لعرض محاضراتك وتسجيل الوصول لكل كامب.')}
        </span>
      </div>

      {dataError && (
        <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
            <span>{dataError}</span>
            <button
              type="button"
              onClick={() => refreshOperationalData()}
              className="px-3 py-1 rounded-md bg-red-600 text-white font-semibold cursor-pointer"
            >
              {t('Retry', 'إعادة')}
            </button>
          </div>
        </div>
      )}

      {/* Main Centered Workspace Container */}
      <main className="instructor-main max-w-6xl w-full mx-auto px-3 sm:px-6 py-3 sm:py-6 flex-1 min-w-0">
        {children}
      </main>

      </div>
      {/* Fixed Light Mobile Bottom Tab Bar */}
      <nav
        aria-label={t('Mobile bottom navigation', 'التنقل السفلي للمحاضر')}
        className="instructor-bottom-nav lg:hidden"
      >
        {INSTRUCTOR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = instructorRoute === tab.id || (tab.id === 'schedule' && instructorRoute === 'attendance');
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInstructorRoute(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className="instructor-bottom-item cursor-pointer"
            >
              <Icon className="w-5 h-5" />
              <span className="tracking-tight">
                {t(tab.labelEn, tab.labelAr)}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
