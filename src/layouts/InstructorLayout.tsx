import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarClock,
  MapPinCheck,
  ClipboardCheck,
  UserCircle,
  Monitor,
  Globe,
  Sun,
  Moon,
  LogOut,
  Bell,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { InstructorRouteId, UserRole } from '../types/database';

const INSTRUCTOR_TABS: {
  id: InstructorRouteId;
  labelEn: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', labelEn: 'Dashboard', labelAr: 'الرئيسية', icon: LayoutDashboard },
  { id: 'schedule', labelEn: 'Schedule', labelAr: 'الجدول', icon: CalendarClock },
  { id: 'checkin', labelEn: 'Check-in', labelAr: 'تسجيل الوصول', icon: MapPinCheck },
  { id: 'attendance', labelEn: 'Attendance', labelAr: 'الحضور', icon: ClipboardCheck },
  { id: 'profile', labelEn: 'Profile', labelAr: 'حسابي', icon: UserCircle },
];

export const InstructorLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    instructorRoute,
    setInstructorRoute,
    auth,
    isSupabaseMode,
    isLoadingData,
    dataError,
    refreshOperationalData,
    instructors,
    notifications,
    markNotificationRead,
    switchDemoIdentity,
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
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pb-20 md:pb-8">
      {/* Compact Sticky Top Bar */}
      <header className="sticky top-0 z-30 h-14 liquid-glass-bar bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 px-4 md:px-6 flex items-center justify-between gap-4">
        <a
          href="#instructor-dashboard"
          onClick={(e) => {
            e.preventDefault();
            setInstructorRoute('dashboard');
          }}
          className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          {t('CITS Instructor Portal', 'بوابة محاضري CITS')}
        </a>

        {/* Desktop Navigation Links */}
        <nav
          aria-label={t('Instructor navigation', 'تنقل المحاضر')}
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          {INSTRUCTOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInstructorRoute(tab.id)}
              className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                instructorRoute === tab.id ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
              }`}
            >
              {t(tab.labelEn, tab.labelAr)}
            </button>
          ))}
        </nav>

        {/* Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {!isSupabaseMode ? (
            <button
              type="button"
              onClick={() => switchDemoIdentity(UserRole.ADMIN)}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>{t('Admin Console', 'لوحة الإدارة')}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isLoadingData}
              onClick={() => refreshOperationalData()}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span>{t('Sync Data', 'تحديث')}</span>
            </button>
          )}
        </div>
      </header>

      {/* Sub-header Bar for Instructor Account Isolation, Notifications & Theme Controls */}
      <div className="max-w-6xl w-full mx-auto px-4 md:px-6 pt-4 relative">
        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {t('Isolated Account:', 'الحساب المعزول:')}
            </span>
            {isSupabaseMode || !currentInstructor ? (
              <span className="font-semibold text-slate-900 dark:text-white">
                {t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr)}
                {currentInstructor ? ` (${currentInstructor.instructorCode})` : ''}
              </span>
            ) : (
              <select
                aria-label={t('Select active instructor account', 'اختر حساب المحاضر')}
                value={currentInstructor.id}
                onChange={(e) => switchDemoIdentity(UserRole.INSTRUCTOR, e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold text-slate-900 dark:text-white"
              >
                {instructors.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {t(inst.fullNameEn, inst.fullNameAr)} ({inst.instructorCode})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNotifPanel((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <Bell className="w-3.5 h-3.5 text-blue-500" />
              <span className="font-mono tabular-nums">{unreadCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'العربية' : 'EN'}</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Toggle theme', 'تبديل المظهر')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              aria-label={t('Sign out', 'تسجيل الخروج')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-red-600 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showNotifPanel && (
          <div className="absolute right-4 md:right-6 top-full mt-2 w-80 max-w-[90vw] z-40 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>{t('My Notifications', 'إشعاراتي')}</span>
              <button
                type="button"
                onClick={() => setShowNotifPanel(false)}
                className="text-slate-500 cursor-pointer"
              >
                {t('Close', 'إغلاق')}
              </button>
            </div>
            {myNotifications.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                {t('No notifications.', 'لا توجد إشعارات.')}
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
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

        {dataError && (
          <div className="mt-3 p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{dataError}</span>
            <button
              type="button"
              onClick={() => refreshOperationalData()}
              className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
            >
              {t('Retry', 'إعادة')}
            </button>
          </div>
        )}
      </div>

      {/* Main Content Container */}
      <main className="max-w-6xl w-full mx-auto px-4 md:px-6 py-5 flex-1">
        {children}
      </main>

      {/* Fixed Bottom Tab Bar for Mobile Thumb-Zone Navigation */}
      <nav
        aria-label={t('Mobile bottom navigation', 'التنقل السفلي للمحاضر')}
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 liquid-glass-bar bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center px-1"
      >
        {INSTRUCTOR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = instructorRoute === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInstructorRoute(tab.id)}
              className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
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
