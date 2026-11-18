import React from 'react';
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
    instructors,
    switchDemoIdentity,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pb-20 md:pb-8">
      {/* Compact Sticky Top Bar (<= 56px on mobile to respect 15% sticky cap) */}
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

        {/* Primary Action: Return / Switch to Admin Console */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => switchDemoIdentity(UserRole.ADMIN)}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>{t('Admin Console', 'لوحة الإدارة')}</span>
          </button>
        </div>
      </header>

      {/* Sub-header Bar for Instructor Account Isolation & RTL/Theme Controls */}
      <div className="max-w-6xl w-full mx-auto px-4 md:px-6 pt-4">
        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {t('Isolated Account:', 'الحساب المعزول:')}
            </span>
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
          </div>

          <div className="flex items-center gap-2">
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
              onClick={signOut}
              aria-label={t('Sign out', 'تسجيل الخروج')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-red-600 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Container (Expands cleanly on desktop, thumb-friendly on mobile) */}
      <main className="max-w-6xl w-full mx-auto px-4 md:px-6 py-5 flex-1">
        {children}
      </main>

      {/* Fixed Bottom Tab Bar for Mobile Thumb-Zone Navigation (44x44px hitboxes) */}
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
