import React, { useState } from 'react';
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
  Bell,
  RefreshCw,
  PanelLeft,
  User,
  X,
  Menu,
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
    isSupabaseMode,
    isLoadingData,
    dataError,
    refreshOperationalData,
    notifications,
    markNotificationRead,
    switchDemoIdentity,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    setArchitectureDrawerOpen,
    t,
  } = useApp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const myNotifications = notifications.filter(
    (n) => n.recipientProfileId === auth.currentProfile.id
  );
  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  const handleNavigate = (routeId: AdminRouteId) => {
    setAdminRoute(routeId);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f4f6f9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex p-0 lg:p-2.5 lg:gap-2.5">
      {/* Mobile Sidebar Drawer Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation — Clean White Floating Card on Desktop, Slide Drawer on Mobile */}
      <aside
        aria-label={t('Admin modules navigation', 'قائمة وحدات الإدارة')}
        className={`fixed inset-y-0 start-0 z-50 lg:sticky lg:top-2.5 lg:h-[calc(100vh-1.25rem)] lg:z-auto flex flex-col justify-between bg-white dark:bg-slate-900 border-e lg:border border-slate-200/80 dark:border-slate-800 lg:rounded-xl shadow-lg lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 shrink-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:translate-x-0 lg:rtl:translate-x-0'
        } ${sidebarCollapsed ? 'lg:w-[72px]' : 'w-60'}`}
      >
        {/* Top Brand + Nav List */}
        <div className="flex flex-col min-h-0 flex-1">
          <div
            className={`h-14 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 shrink-0 ${
              sidebarCollapsed ? 'lg:px-3 lg:justify-center px-4' : 'px-4'
            }`}
          >
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="flex items-center gap-2.5 text-start cursor-pointer min-w-0"
              title="CITS Camp Operations"
            >
              <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 tracking-tight">
                CI
              </span>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                    CITS Ops
                  </span>
                  <span className="block text-[11px] text-slate-400 dark:text-slate-500 truncate">
                    {t('Camp Console', 'إدارة المعسكر')}
                  </span>
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t('Close navigation menu', 'إغلاق القائمة')}
              className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
            {ADMIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = adminRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  title={t(item.labelEn, item.labelAr)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg text-[13px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sidebarCollapsed ? 'lg:justify-center lg:px-2 px-3 py-2.5' : 'px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] shrink-0 ${
                      isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{t(item.labelEn, item.labelAr)}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Clean Sidebar Footer: Role Switch + Sign Out */}
        <div className="p-2.5 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
          {!isSupabaseMode && (
            <button
              type="button"
              onClick={() => switchDemoIdentity(UserRole.INSTRUCTOR, 'inst-1')}
              title={t('Switch to Instructor Portal', 'الانتقال لبوابة المحاضر')}
              className={`w-full flex items-center gap-2.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap cursor-pointer ${
                sidebarCollapsed ? 'lg:justify-center lg:px-2 px-3 py-2' : 'px-3 py-2'
              }`}
            >
              <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate">{t('Instructor Portal', 'بوابة المحاضر')}</span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => signOut()}
            title={t('Logout', 'تسجيل الخروج')}
            className={`w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap cursor-pointer ${
              sidebarCollapsed ? 'lg:justify-center lg:px-2 px-3 py-2' : 'px-3 py-2'
            }`}
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {!sidebarCollapsed && <span>{t('Logout', 'تسجيل الخروج')}</span>}
          </button>
        </div>
      </aside>

      {/* Main White Workspace Card (Slim Top Bar + Page Body) */}
      <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900 lg:rounded-xl lg:border border-slate-200/80 dark:border-slate-800 lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Single Slim White Top Bar (Restrained Translucent Glass on Sticky Scroll) */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 relative">
          {/* Left Zone: Sidebar Toggle + Concise Camp Context */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('Open navigation menu', 'فتح قائمة التنقل')}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={t('Toggle sidebar', 'طي أو توسيع القائمة الجانبية')}
              aria-expanded={!sidebarCollapsed}
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <PanelLeft className="w-[18px] h-[18px]" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block shrink-0" />

            <div className="flex items-center gap-2 text-xs min-w-0">
              {activeCamp ? (
                <>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {t(activeCamp.nameEn, activeCamp.nameAr)}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 hidden sm:inline">
                    ·
                  </span>
                  <span className="hidden sm:inline font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                    {t(
                      `Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`,
                      `اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`
                    )}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 hidden md:inline">
                    ·
                  </span>
                  <span className="hidden md:inline font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                    {t(
                      `${activeCamp.settings.geofenceRadiusMeters}m geofence`,
                      `نطاق ${activeCamp.settings.geofenceRadiusMeters}م`
                    )}
                  </span>
                </>
              ) : (
                <span className="font-medium text-amber-600 dark:text-amber-400 truncate">
                  {t('No Active Camp Configured', 'لا يوجد معسكر نشط')}
                </span>
              )}
            </div>
          </div>

          {/* Right Zone: Quiet Utility Controls + Admin Identity */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isSupabaseMode && (
              <button
                type="button"
                disabled={isLoadingData}
                onClick={() => refreshOperationalData()}
                aria-label={t('Refresh operational data', 'تحديث البيانات')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
                <span className="hidden xl:inline">{t('Refresh', 'تحديث')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setArchitectureDrawerOpen(true)}
              aria-label={t('Architecture and SQL Plan', 'مخطط النظام و SQL')}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">{t('Plan & SQL', 'الخطة و SQL')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowNotifPanel((prev) => !prev)}
              aria-label={t('Notifications', 'الإشعارات')}
              aria-expanded={showNotifPanel}
              className="relative px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
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
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'AR' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Switch Light or Dark Theme', 'تبديل المظهر الفاتح أو الداكن')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block shrink-0" />

            <div className="flex items-center gap-2 ps-1 min-w-0 max-w-[170px]">
              <User className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="hidden sm:inline text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                {t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr)}
              </span>
            </div>
          </div>

          {/* Restrained Translucent Notifications Popover */}
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
                  {t('No notifications recorded.', 'لا توجد إشعارات حالياً.')}
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
          <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
            <span>{dataError}</span>
            <button
              type="button"
              onClick={() => refreshOperationalData()}
              className="px-3 py-1 rounded-md bg-red-600 text-white font-semibold cursor-pointer"
            >
              {t('Retry', 'إعادة المحاولة')}
            </button>
          </div>
        )}

        <main className="p-4 sm:p-6 lg:px-7 lg:py-6 flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
};
