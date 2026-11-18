import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarClock,
  MapPinCheck,
  ClipboardCheck,
  UserCircle,
  Globe,
  Sun,
  Moon,
  LogOut,
  Bell,
  RefreshCw,
  User,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { InstructorRouteId } from '../types/database';

const INSTRUCTOR_TABS: {
  id: InstructorRouteId;
  labelEn: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', labelEn: 'Dashboard', labelAr: 'الرئيسية', icon: LayoutDashboard },
  { id: 'schedule', labelEn: 'Schedule', labelAr: 'الجدول', icon: CalendarClock },
  { id: 'checkin', labelEn: 'Check-in', labelAr: 'الوصول', icon: MapPinCheck },
  { id: 'attendance', labelEn: 'Attendance', labelAr: 'الحضور', icon: ClipboardCheck },
  { id: 'profile', labelEn: 'Profile', labelAr: 'حسابي', icon: UserCircle },
];

export const InstructorLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    instructorRoute,
    setInstructorRoute,
    activeCamp,
    auth,
    isSupabaseMode,
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
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myNotifications = notifications.filter(
    (n) => n.recipientProfileId === auth.currentProfile.id
  );
  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f4f6f9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pb-20 md:pb-8">
      {/* Slim Sticky White Top Header */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 relative">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setInstructorRoute('dashboard')}
            className="flex items-center gap-2.5 text-start cursor-pointer min-w-0"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 tracking-tight">
              CI
            </span>
            <div className="min-w-0">
              <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {t('CITS Instructor', 'بوابة المحاضر')}
              </span>
              {activeCamp && (
                <span className="hidden sm:block text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
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

        {/* Desktop Primary Tabs */}
        <nav
          aria-label={t('Instructor navigation', 'قائمة تنقل المحاضر')}
          className="hidden md:flex items-center gap-1"
        >
          {INSTRUCTOR_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = instructorRoute === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInstructorRoute(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-lg text-[13px] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{t(tab.labelEn, tab.labelAr)}</span>
              </button>
            );
          })}
        </nav>

        {/* Quiet Utility Controls + Instructor Account */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isSupabaseMode && (
            <button
              type="button"
              disabled={isLoadingData}
              onClick={() => refreshOperationalData()}
              aria-label={t('Refresh data', 'تحديث البيانات')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
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
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            {unreadCount > 0 && (
              <span className="font-mono tabular-nums text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            aria-label={t('Switch Language', 'تغيير اللغة')}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === 'en' ? 'AR' : 'EN'}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t('Toggle theme', 'تبديل المظهر')}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block shrink-0" />

          <div className="hidden sm:flex items-center gap-1.5 ps-0.5 max-w-[160px]">
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
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
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/30 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Notifications Popover */}
        {showNotifPanel && (
          <div className="absolute end-4 sm:end-6 top-full mt-2 w-80 max-w-[90vw] z-40 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-lg p-4 space-y-3">
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
                        className="text-blue-600 dark:text-blue-400 font-semibold shrink-0 cursor-pointer"
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
      <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 flex-1 min-w-0">
        {children}
      </main>

      {/* Fixed Light Mobile Bottom Tab Bar */}
      <nav
        aria-label={t('Mobile bottom navigation', 'التنقل السفلي للمحاضر')}
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 grid grid-cols-5 items-center px-1"
      >
        {INSTRUCTOR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = instructorRoute === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInstructorRoute(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg transition-colors cursor-pointer ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[10px] tracking-tight mt-0.5 whitespace-nowrap">
                {t(tab.labelEn, tab.labelAr)}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
