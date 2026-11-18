import React from 'react';
import {
  LayoutDashboard,
  Tent,
  Users,
  GraduationCap,
  CalendarClock,
  ClipboardCheck,
  Wallet,
  BarChart3,
  AlertTriangle,
  Settings,
  Globe,
  Sun,
  Moon,
  LogOut,
  Smartphone,
  FileCode2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AdminRouteId, UserRole } from '../types/database';

interface NavItem {
  id: AdminRouteId;
  labelEn: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', labelEn: 'Dashboard', labelAr: 'لوحة المتابعة', icon: LayoutDashboard },
  { id: 'camps', labelEn: 'Camps', labelAr: 'المعسكرات', icon: Tent },
  { id: 'instructors', labelEn: 'Instructors', labelAr: 'المحاضرون', icon: Users },
  { id: 'students', labelEn: 'Students & Groups', labelAr: 'الطلاب والمجموعات', icon: GraduationCap },
  { id: 'schedule', labelEn: 'Schedule', labelAr: 'الجدول اليومي', icon: CalendarClock },
  { id: 'attendance', labelEn: 'Attendance', labelAr: 'كشوف الحضور', icon: ClipboardCheck },
  { id: 'finance', labelEn: 'Finance', labelAr: 'المستحقات المالية', icon: Wallet },
  { id: 'reports', labelEn: 'Reports', labelAr: 'التقارير والتحليلات', icon: BarChart3 },
  { id: 'operations', labelEn: 'Operations', labelAr: 'التشغيل والأعطال', icon: AlertTriangle },
  { id: 'settings', labelEn: 'Settings', labelAr: 'الإعدادات والسجل', icon: Settings },
];

export const AdminLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    adminRoute,
    setAdminRoute,
    activeCamp,
    auth,
    switchDemoIdentity,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    setArchitectureDrawerOpen,
    t,
  } = useApp();

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 liquid-glass-bar bg-white/85 dark:bg-slate-900/85 border-b border-slate-200 dark:border-slate-800/80 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setAdminRoute('dashboard');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          CITS Camp Operations
        </a>

        {/* Zone 2: 4-5 concise single-line text navigation links */}
        <nav
          aria-label={t('Primary quick navigation', 'التنقل السريع')}
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          <button
            type="button"
            onClick={() => setAdminRoute('dashboard')}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminRoute === 'dashboard' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
            }`}
          >
            {t('Overview', 'نظرة عامة')}
          </button>
          <button
            type="button"
            onClick={() => setAdminRoute('schedule')}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminRoute === 'schedule' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
            }`}
          >
            {t('Schedule', 'الجدول')}
          </button>
          <button
            type="button"
            onClick={() => setAdminRoute('attendance')}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminRoute === 'attendance' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
            }`}
          >
            {t('Attendance', 'الحضور')}
          </button>
          <button
            type="button"
            onClick={() => setAdminRoute('finance')}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminRoute === 'finance' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
            }`}
          >
            {t('Finance', 'المستحقات')}
          </button>
          <button
            type="button"
            onClick={() => setAdminRoute('settings')}
            className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminRoute === 'settings' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
            }`}
          >
            {t('Settings', 'الإعدادات')}
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setArchitectureDrawerOpen(true)}
            className="px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>{t('Phase 1 Architecture & SQL', 'مخطط المرحلة الأولى و SQL')}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="flex-1 flex max-w-[1440px] w-full mx-auto min-w-0">
        {/* Floating Glass Sidebar (Desktop/Tablet) */}
        <aside
          aria-label={t('Admin modules navigation', 'قائمة وحدات الإدارة')}
          className="w-64 shrink-0 hidden lg:flex flex-col justify-between p-4 border-e border-slate-200 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/50"
        >
          <div className="space-y-1">
            <div className="px-3 py-2 mb-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('Active Camp', 'المعسكر النشط')} ·{' '}
                <span className="font-mono tabular-nums">
                  {t(`Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`, `اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`)}
                </span>
              </p>
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                {t(activeCamp.nameEn, activeCamp.nameAr)}
              </p>
            </div>

            {ADMIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = adminRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAdminRoute(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t(item.labelEn, item.labelAr)}</span>
                </button>
              );
            })}
          </div>

          {/* Account & Portal Switcher in Sidebar Footer */}
          <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="px-2">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {t('Admin Account (Full Permissions)', 'حساب مسؤول (صلاحيات كاملة)')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => switchDemoIdentity(UserRole.INSTRUCTOR, 'inst-1')}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 hover:bg-slate-200 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-500" />
              <span>{t('Switch to Instructor Portal', 'الانتقال لبوابة المحاضر')}</span>
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'العربية' : 'English'}</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={t('Toggle sidebar theme', 'تبديل المظهر الجانبي')}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label={t('Sign out from sidebar', 'تسجيل الخروج')}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Workspace Sub-Toolbar */}
          <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-white/40 dark:bg-slate-900/30 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                {t(activeCamp.nameEn, activeCamp.nameAr)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums shrink-0">
                {t(`Day ${activeCamp.currentCampDay} of ${activeCamp.durationDays}`, `اليوم ${activeCamp.currentCampDay} من ${activeCamp.durationDays}`)}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="hidden sm:inline shrink-0">{t('Geofence 100m', 'النطاق الجغرافي 100م')}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile/Tablet Module Selector */}
              <select
                aria-label={t('Select Admin Module', 'اختر وحدة الإدارة')}
                value={adminRoute}
                onChange={(e) => setAdminRoute(e.target.value as AdminRouteId)}
                className="lg:hidden px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
              >
                {ADMIN_NAV_ITEMS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.labelEn, item.labelAr)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => switchDemoIdentity(UserRole.INSTRUCTOR, 'inst-1')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                <span>{t('Open Instructor View', 'فتح واجهة المحاضر')}</span>
              </button>

              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {lang === 'en' ? 'العربية (RTL)' : 'English (LTR)'}
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={t('Switch Light or Dark Theme', 'تبديل الوضع الليلي والنهاري')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{theme === 'dark' ? t('Light', 'فاتح') : t('Dark', 'داكن')}</span>
              </button>

              <button
                type="button"
                onClick={signOut}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-red-600 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('Sign Out', 'خروج')}
              </button>
            </div>
          </div>

          <main className="p-4 sm:p-6 flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
};
