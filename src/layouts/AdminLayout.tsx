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
  Layers,
  X,
  Menu,
  Pin,
  PinOff,
  MoreHorizontal,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CampSwitcher } from '../components/ui/CampSwitcher';
import { CitsBrand } from '../components/ui/CitsBrand';
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
  const displayName = t(auth.currentProfile.fullNameEn, auth.currentProfile.fullNameAr);
  const initials = displayName.trim().split(/\s+/).slice(0,2).map(word => Array.from(word)[0]).join('').toUpperCase() || 'AD';

  const handleNavigate = (routeId: AdminRouteId) => {
    setAdminRoute(routeId);
    setMobileNavOpen(false);
    setMobileMoreOpen(false);
  };

  return (
    <div className="admin-shell min-h-screen w-full bg-[var(--bg-canvas)] text-slate-900 dark:text-[#F0F1F2] flex">
      {/* Mobile Sidebar Drawer Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar takes real width on hover so Header and Dashboard never sit underneath it. Mobile stays a drawer. */}
      <aside
        onMouseEnter={() => { if (window.innerWidth >= 1024) setSidebarHovered(true); }}
        onMouseLeave={() => setSidebarHovered(false)}
        aria-label={t('Admin modules navigation', 'قائمة وحدات الإدارة')}
        className={`admin-rail instructor-curved-sidebar fixed inset-y-0 start-0 z-50 lg:sticky lg:top-0 lg:z-30 flex flex-col shrink-0 ${mobileNavOpen?'admin-rail-mobile-open':''} ${sidebarExpanded?'admin-rail-expanded':'admin-rail-collapsed'}`}
      >
        <div className="admin-rail-inner flex flex-col justify-between h-full min-h-0 w-full">
        {/* Top Brand + Nav List */}
        <div className="flex flex-col min-h-0 flex-1">
          <div
            className="admin-rail-brand flex items-center justify-between gap-1 shrink-0"
          >
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="flex items-center gap-2.5 text-start cursor-pointer min-w-0"
              title="CITS LMS" aria-label="CITS LMS"
            >
              <CitsBrand inverse compact={!showSidebarLabels} subtitle={t('Operations Dashboard','لوحة إدارة العمليات')}/>
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed(v => !v)}
              title={sidebarCollapsed ? t('Pin sidebar open','تثبيت القائمة مفتوحة') : t('Collapse sidebar','تصغير القائمة')}
              aria-label={sidebarCollapsed ? t('Pin sidebar open','تثبيت القائمة مفتوحة') : t('Collapse sidebar','تصغير القائمة')}
              className={`admin-rail-tool hidden p-2 rounded-lg ${showSidebarLabels ? 'lg:inline-flex' : ''}`}
            >
              {sidebarCollapsed ? <Pin className="w-4 h-4"/> : <PinOff className="w-4 h-4"/>}
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t('Close navigation menu', 'إغلاق القائمة')}
              className="admin-rail-tool lg:hidden p-1.5 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="admin-rail-menu flex-1 min-h-0 overflow-y-auto">
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
                  className="admin-rail-tab"
                  aria-label={t(item.labelEn,item.labelAr)}
                >
                  <Icon className="w-[19px] h-[19px] shrink-0" aria-hidden="true"/>
                  {showSidebarLabels && <span className="truncate">{t(item.labelEn, item.labelAr)}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Clean Sidebar Footer: Sign Out only */}
        <div className="admin-rail-footer">
          {showSidebarLabels && <div className="admin-rail-camp"><Layers className="w-4 h-4 shrink-0" aria-hidden="true"/><div className="min-w-0"><p className="text-[11px] opacity-75">{t('Current camp','الكامب الحالي')}</p><p className="text-xs font-semibold truncate">{activeCamp?t(activeCamp.nameEn,activeCamp.nameAr):'—'}</p></div></div>}
          <button
            type="button"
            onClick={() => signOut()}
            title={t('Logout', 'تسجيل الخروج')}
            className="admin-rail-tab admin-rail-logout"
            aria-label={t('Logout','تسجيل الخروج')}
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {showSidebarLabels && <span>{t('Logout', 'تسجيل الخروج')}</span>}
          </button>
        </div>
        </div>
      </aside>

      {/* Main White Workspace Card (Slim Top Bar + Page Body) */}
      <div className="admin-workspace flex-1 min-w-0 flex flex-col">
        {isSandboxMode && (
          <div role="status" aria-live="polite" className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
            <strong>{t('LOCAL SANDBOX PREVIEW', 'معاينة محلية تجريبية')}</strong>
            <span className="ms-2">{t('Not connected to Supabase. Changes are demo-only and are not saved to the remote database.', 'لا يوجد اتصال بـ Supabase. التغييرات تجريبية فقط ولا تُحفظ في قاعدة البيانات البعيدة.')}</span>
          </div>
        )}
        {/* Single Slim White Top Bar (Restrained Translucent Glass on Sticky Scroll) */}
        <header className="admin-topbar instructor-topbar sticky z-30">
          <div className="instructor-topbar-context admin-topbar-context">
            <button type="button" onClick={()=>{setMobileMoreOpen(false);setMobileNavOpen(true);}} aria-label={t('Open navigation menu','فتح قائمة التنقل')} className="instructor-topbar-control lg:hidden shrink-0"><Menu className="w-4 h-4"/></button>
            <button type="button" onClick={()=>setSidebarCollapsed(v=>!v)} aria-label={t('Toggle sidebar','طي أو توسيع القائمة الجانبية')} aria-expanded={!sidebarCollapsed} className="instructor-topbar-control hidden lg:inline-flex shrink-0 admin-rail-toggle"><PanelLeft className="w-4 h-4"/></button>
            <div className="instructor-camp-bar instructor-topbar-camp admin-topbar-camp">
              <Layers className="w-4 h-4 shrink-0" aria-hidden="true"/>
              <CampSwitcher/>
            </div>
            {activeCamp&&<span className="instructor-topbar-day"><CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true"/><span>{t(`Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`,`اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`)}</span></span>}
          </div>
          <div className="instructor-topbar-actions admin-topbar-actions">
            {isSupabaseMode&&<button type="button" disabled={isLoadingData} onClick={()=>refreshOperationalData()} aria-label={t('Refresh operational data','تحديث البيانات')} title={t('Refresh operational data','تحديث البيانات')} className="instructor-topbar-control"><RefreshCw className={'w-4 h-4 '+(isLoadingData?'animate-spin':'')}/></button>}
            <button type="button" onClick={()=>setShowNotifPanel(v=>!v)} aria-label={t('Notifications','الإشعارات')} aria-expanded={showNotifPanel} className="instructor-topbar-control instructor-topbar-notifications"><Bell className="w-4 h-4"/>{unreadCount>0&&<span className="instructor-topbar-count">{unreadCount>99?'99+':unreadCount}</span>}</button>
            <button type="button" onClick={()=>setLang(lang==='en'?'ar':'en')} aria-label={t('Switch Language','تغيير اللغة')} className="instructor-topbar-control instructor-topbar-language"><Globe className="w-4 h-4"/><span>{lang==='en'?'AR':'EN'}</span></button>
            <button type="button" onClick={toggleTheme} aria-label={t('Switch Light or Dark Theme','تبديل المظهر الفاتح أو الداكن')} className="instructor-topbar-control">{theme==='dark'?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}</button>
            <div className="instructor-topbar-account">
              <div className="admin-topbar-identity" title={displayName}><span className="instructor-topbar-avatar" aria-hidden="true">{initials}</span><span className="instructor-topbar-name"><strong className="block truncate text-sm">{displayName}</strong><span className="block text-[11px] instructor-topbar-secondary">{t('Administrator','مسؤول')}</span></span></div>
              <button type="button" onClick={()=>signOut()} aria-label={t('Logout','تسجيل الخروج')} className="instructor-topbar-control instructor-topbar-logout"><LogOut className="w-4 h-4"/></button>
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

        <main className="admin-main p-4 sm:p-6 pb-28 sm:pb-28 lg:px-7 lg:py-6 flex-1 min-w-0">{children}</main>
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
        <button type="button" onClick={() => {setMobileNavOpen(false);setMobileMoreOpen(v=>!v);}}
          aria-expanded={mobileMoreOpen}
          aria-current={!(['dashboard','schedule','attendance','finance'] as AdminRouteId[]).includes(adminRoute)?'page':undefined}
          className="mobile-glass-item"><MoreHorizontal className="w-5 h-5"/><span>{t('More','المزيد')}</span></button>
      </nav>
    </div>
  );
};
