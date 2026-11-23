import React, { useEffect, useState } from 'react';
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
  Bell,
  RefreshCw,
  PanelLeft,
  User,
  X,
  Menu,
  Pin,
  PinOff,
  MoreHorizontal,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CampSwitcher } from '../components/ui/CampSwitcher';
import { AdminRouteId } from '../types/database';

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
    isSandboxMode,
    isLoadingData,
    dataError,
    refreshOperationalData,
    notifications,
    markNotificationRead,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    t,
  } = useApp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('operation-lms-admin-sidebar') === 'collapsed'; }
    catch { return false; }
  });
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const sidebarExpanded = !sidebarCollapsed || sidebarHovered;
  useEffect(() => {
    try { window.localStorage.setItem('operation-lms-admin-sidebar', sidebarCollapsed ? 'collapsed' : 'expanded'); }
    catch { /* local storage is unavailable in private browsing contexts */ }
  }, [sidebarCollapsed]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const showSidebarLabels = sidebarExpanded || mobileNavOpen;
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const myNotifications = notifications.filter(
    (n) => n.recipientProfileId === auth.currentProfile.id
  );
  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  const handleNavigate = (routeId: AdminRouteId) => {
    setAdminRoute(routeId);
    setMobileNavOpen(false);
    setMobileMoreOpen(false);
  };

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[var(--bg-canvas)] dark:bg-[var(--bg-canvas)] text-slate-900 dark:text-[#F0F1F2] flex p-0 lg:p-2.5 lg:gap-2.5">
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
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        aria-label={t('Admin modules navigation', 'قائمة وحدات الإدارة')}
        className={`fixed inset-y-0 start-0 z-50 lg:sticky lg:top-2.5 lg:h-[calc(100vh-1.25rem)] lg:z-30 flex flex-col bg-white dark:bg-[#1D2023] border-e lg:border border-slate-200/80 dark:border-[#353A3F] lg:rounded-xl shadow-lg lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 shrink-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:translate-x-0 lg:rtl:translate-x-0'
        } ${sidebarCollapsed ? 'w-60 lg:w-[72px]' : 'w-60'}`}
      >
        <div className={`flex flex-col justify-between h-full min-h-0 rounded-xl bg-white dark:bg-[#1D2023] ${sidebarCollapsed && sidebarHovered ? 'lg:absolute lg:inset-y-0 lg:start-0 lg:w-60 lg:z-50 lg:border lg:border-[#353A3F] lg:shadow-xl' : 'w-full'}`}>
        {/* Top Brand + Nav List */}
        <div className="flex flex-col min-h-0 flex-1">
          <div
            className={`h-14 flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F]/80 shrink-0 ${
              !sidebarExpanded ? 'lg:px-3 lg:justify-center px-4' : 'px-4'
            }`}
          >
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="flex items-center gap-2.5 text-start cursor-pointer min-w-0"
              title="CITS Camp Operations"
            >
              <span className="w-7 h-7 rounded-lg bg-[#355F82] text-white text-xs font-bold flex items-center justify-center shrink-0 tracking-tight">
                CI
              </span>
              {showSidebarLabels && (
                <div className="min-w-0">
                  <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                    CITS Ops
                  </span>
                  <span className="block text-[11px] text-slate-400 dark:text-[#848B91] truncate">
                    {t('Camp Console', 'إدارة المعسكر')}
                  </span>
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed(v => !v)}
              title={sidebarCollapsed ? t('Pin sidebar open','تثبيت القائمة مفتوحة') : t('Collapse sidebar','تصغير القائمة')}
              aria-label={sidebarCollapsed ? t('Pin sidebar open','تثبيت القائمة مفتوحة') : t('Collapse sidebar','تصغير القائمة')}
              className={`hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#25292D] ${showSidebarLabels ? 'lg:inline-flex' : ''}`}
            >
              {sidebarCollapsed ? <Pin className="w-4 h-4"/> : <PinOff className="w-4 h-4"/>}
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
                    !sidebarExpanded ? 'lg:justify-center lg:px-2 px-3 py-2.5' : 'px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-blue-50 dark:bg-[#293747]/60 text-[#355F82] dark:text-[#88A9CC] font-semibold'
                      : 'text-slate-700 dark:text-[#C0C5C9] font-medium hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] shrink-0 ${
                      isActive ? 'text-[#355F82] dark:text-[#88A9CC]' : 'text-slate-500 dark:text-[#A0A5AA]'
                    }`}
                  />
                  {showSidebarLabels && <span className="truncate">{t(item.labelEn, item.labelAr)}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Clean Sidebar Footer: Sign Out only */}
        <div className="p-2.5 border-t border-slate-100 dark:border-[#353A3F]/80">
          <button
            type="button"
            onClick={() => signOut()}
            title={t('Logout', 'تسجيل الخروج')}
            className={`w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap cursor-pointer ${
              !sidebarExpanded ? 'lg:justify-center lg:px-2 px-3 py-2' : 'px-3 py-2'
            }`}
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {showSidebarLabels && <span>{t('Logout', 'تسجيل الخروج')}</span>}
          </button>
        </div>
        </div>
      </aside>

      {/* Main White Workspace Card (Slim Top Bar + Page Body) */}
      <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#1D2023] lg:rounded-xl lg:border border-slate-200/80 dark:border-[#353A3F] lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {isSandboxMode && (
          <div role="status" aria-live="polite" className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
            <strong>{t('LOCAL SANDBOX PREVIEW', 'معاينة محلية تجريبية')}</strong>
            <span className="ms-2">{t('Not connected to Supabase. Changes are demo-only and are not saved to the remote database.', 'لا يوجد اتصال بـ Supabase. التغييرات تجريبية فقط ولا تُحفظ في قاعدة البيانات البعيدة.')}</span>
          </div>
        )}
        {/* Single Slim White Top Bar (Restrained Translucent Glass on Sticky Scroll) */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 app-glass-header flex items-center justify-between gap-3 shrink-0">
          {/* Left Zone: Sidebar Toggle + Concise Camp Context */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('Open navigation menu', 'فتح قائمة التنقل')}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-[#C0C5C9] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={t('Toggle sidebar', 'طي أو توسيع القائمة الجانبية')}
              aria-expanded={!sidebarCollapsed}
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-600 dark:text-[#C0C5C9] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <PanelLeft className="w-[18px] h-[18px]" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-[#25292D] hidden sm:block shrink-0" />

            <div className="flex items-center gap-2 text-xs min-w-0">
              {activeCamp ? (
                <>
                  <span className="font-semibold text-slate-800 dark:text-[#F0F1F2] truncate">
                    {t(activeCamp.nameEn, activeCamp.nameAr)}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 hidden sm:inline">
                    ·
                  </span>
                  <span className="hidden sm:inline font-mono tabular-nums text-slate-500 dark:text-[#A0A5AA] shrink-0">
                    {t(
                      `Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`,
                      `اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`
                    )}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 hidden md:inline">
                    ·
                  </span>
                  <span className="hidden md:inline font-mono tabular-nums text-slate-400 dark:text-[#848B91] shrink-0">
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
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
                <span className="hidden xl:inline">{t('Refresh', 'تحديث')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowNotifPanel((prev) => !prev)}
              aria-label={t('Notifications', 'الإشعارات')}
              aria-expanded={showNotifPanel}
              className="relative px-2 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1 cursor-pointer"
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
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-[#C0C5C9] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'AR' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Switch Light or Dark Theme', 'تبديل المظهر الفاتح أو الداكن')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-[#C0C5C9] cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-[#25292D] hidden sm:block shrink-0" />

            <div className="flex items-center gap-2 ps-1 min-w-0 max-w-[170px]">
              <User className="w-4 h-4 text-slate-500 dark:text-[#A0A5AA] shrink-0" />
              <span className="hidden sm:inline text-xs font-medium text-slate-700 dark:text-[#DEE1E4] truncate">
                {t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr)}
              </span>
            </div>
          </div>

          {/* Restrained Translucent Notifications Popover */}
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

        <div className="flex items-center gap-3 px-4 sm:px-6 py-2.5 bg-slate-50/70 dark:bg-[#25292D]/70 border-b border-slate-200 dark:border-[#353A3F] text-xs">
          <span className="font-semibold shrink-0">{t('Working Camp:', 'الكامب المختار:')}</span>
          <CampSwitcher />
          <span className="hidden md:inline text-slate-500 dark:text-[#A0A5AA]">
            {t('Schedule, attendance and finances follow this Camp.',
               'الجدول والحضور والحسابات تخص الكامب المحدد.')}
          </span>
        </div>

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

        <main className="p-4 sm:p-6 pb-28 sm:pb-28 lg:px-7 lg:py-6 flex-1 min-w-0">{children}</main>
      </div>
      {mobileMoreOpen && (
        <>
          <button type="button" aria-label={t('Close more menu','إغلاق المزيد')} onClick={() => setMobileMoreOpen(false)} className="fixed inset-0 z-40 bg-black/20 lg:hidden" />
          <div className="mobile-more-sheet lg:hidden p-3 space-y-1" role="dialog" aria-label={t('More sections','أقسام أخرى')}>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-semibold">{t('More sections','أقسام أخرى')}</span>
              <button type="button" onClick={() => setMobileMoreOpen(false)} aria-label={t('Close','إغلاق')} className="p-2 rounded-lg"><X className="w-4 h-4"/></button>
            </div>
            {ADMIN_NAV_ITEMS.filter(item => !(['dashboard','schedule','attendance','finance'] as AdminRouteId[]).includes(item.id)).map(item => {
              const Icon = item.icon;
              return <button key={item.id} type="button" onClick={() => handleNavigate(item.id)}
                aria-current={adminRoute===item.id?'page':undefined}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-[#25292D] text-sm text-start">
                <Icon className="w-5 h-5 shrink-0"/>{t(item.labelEn,item.labelAr)}
              </button>;
            })}
          </div>
        </>
      )}
      <nav aria-label={t('Mobile bottom navigation','شريط التنقل السفلي')} className="mobile-glass-nav admin-mobile-only lg:hidden">
        {([
          { id:'dashboard', icon:LayoutDashboard, en:'Home', ar:'الرئيسية' },
          { id:'schedule', icon:CalendarClock, en:'Schedule', ar:'الجدول' },
          { id:'attendance', icon:ClipboardCheck, en:'Attendance', ar:'الحضور' },
          { id:'finance', icon:Wallet, en:'Finance', ar:'المالية' },
        ] as const).map(tab => {
          const Icon = tab.icon;
          return <button key={tab.id} type="button" onClick={() => handleNavigate(tab.id)}
            aria-current={adminRoute===tab.id?'page':undefined}
            className="mobile-glass-item"><Icon className="w-5 h-5"/><span>{t(tab.en,tab.ar)}</span></button>;
        })}
        <button type="button" onClick={() => setMobileMoreOpen(v=>!v)}
          aria-expanded={mobileMoreOpen}
          aria-current={!(['dashboard','schedule','attendance','finance'] as AdminRouteId[]).includes(adminRoute)?'page':undefined}
          className="mobile-glass-item"><MoreHorizontal className="w-5 h-5"/><span>{t('More','المزيد')}</span></button>
      </nav>
    </div>
  );
};
