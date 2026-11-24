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
  Layers,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CampSwitcher } from '../components/ui/CampSwitcher';
import { CitsBrand } from '../components/ui/CitsBrand';
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
  const displayName = currentInstructor ? t(currentInstructor.fullNameEn,currentInstructor.fullNameAr) : t(auth.currentProfile.fullNameEn,auth.currentProfile.fullNameAr);
  const initials = displayName.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('').toUpperCase() || 'IN';

  return (
    <div className="instructor-shell min-h-screen w-full min-w-0 bg-[var(--bg-canvas)] dark:bg-[var(--bg-canvas)] text-slate-900 dark:text-[#F0F1F2] flex flex-col pb-8">
      {isSandboxMode && (
        <div role="status" aria-live="polite" className="px-4 sm:px-6 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
          <strong>{t('LOCAL SANDBOX PREVIEW', 'معاينة محلية تجريبية')}</strong>
          <span className="ms-2">{t('Not connected to Supabase. Changes are demo-only and are not saved to the remote database.', 'لا يوجد اتصال بـ Supabase. التغييرات تجريبية فقط ولا تُحفظ في قاعدة البيانات البعيدة.')}</span>
        </div>
      )}
      {/* Desktop instructor workspace navigation; mobile keeps the bottom bar. */}
      <aside className="instructor-desktop-nav instructor-curved-sidebar hidden lg:flex fixed z-40 flex-col">
        <div className="instructor-sidebar-brand"><CitsBrand inverse subtitle={t('Instructor Workspace','مساحة عمل المحاضر')}/></div>
        <nav aria-label={t('Instructor navigation','قائمة تنقل المحاضر')} className="instructor-sidebar-menu">
          {INSTRUCTOR_TABS.map(tab=>{
            const Icon=tab.icon;
            const isActive=instructorRoute===tab.id||(tab.id==='schedule'&&instructorRoute==='attendance');
            return <button type="button" key={tab.id} aria-current={isActive?'page':undefined} onClick={()=>setInstructorRoute(tab.id)} className="instructor-sidebar-tab"><Icon className="w-5 h-5 shrink-0" aria-hidden="true"/><span>{t(tab.labelEn,tab.labelAr)}</span></button>;
          })}
        </nav>
        <div className="instructor-sidebar-footer">
          <div className="flex items-center gap-3 min-w-0"><span className="instructor-sidebar-camp-icon"><Layers className="w-4 h-4" aria-hidden="true"/></span><div className="min-w-0"><p className="text-[11px] instructor-sidebar-muted">{t('Current camp','الكامب الحالي')}</p><p className="text-sm font-semibold mt-1 break-words">{activeCamp?t(activeCamp.nameEn,activeCamp.nameAr):'—'}</p></div></div>
        </div>
      </aside>
      <div className="instructor-workspace lg:ms-56 flex flex-col flex-1 min-w-0">
      {/* Workspace header */}
      <header className="instructor-header instructor-topbar sticky z-30">
        <div className="instructor-topbar-context">
          <div className="instructor-camp-bar instructor-topbar-camp">
            <Layers className="w-4 h-4 shrink-0" aria-hidden="true"/>
            <span className="sr-only">{t('My Camp','الكامب الخاص بي')}</span>
            <CampSwitcher />
          </div>
          {activeCamp&&<span className="instructor-topbar-day"><CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true"/><span>{t(`Day ${activeCamp.currentCampDay}/${activeCamp.durationDays}`,`اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays}`)}</span></span>}
        </div>
        <div className="instructor-header-actions instructor-topbar-actions">
          {isSupabaseMode&&<button type="button" disabled={isLoadingData} onClick={()=>refreshOperationalData()} aria-label={t('Refresh data','تحديث البيانات')} title={t('Refresh data','تحديث البيانات')} className="instructor-topbar-control">
            <RefreshCw className={'w-4 h-4 '+(isLoadingData?'animate-spin':'')}/>
          </button>}
          <button type="button" onClick={()=>setShowNotifPanel(prev=>!prev)} aria-label={t('Notifications','الإشعارات')} aria-expanded={showNotifPanel} className="instructor-topbar-control instructor-topbar-notifications">
            <Bell className="w-4 h-4"/>
            {unreadCount>0&&<span className="instructor-topbar-count">{unreadCount>99?'99+':unreadCount}</span>}
          </button>
          <button type="button" onClick={()=>setLang(lang==='en'?'ar':'en')} aria-label={t('Switch Language','تغيير اللغة')} className="instructor-topbar-control instructor-topbar-language">
            <Globe className="w-4 h-4"/><span>{lang==='en'?'AR':'EN'}</span>
          </button>
          <button type="button" onClick={toggleTheme} aria-label={t('Toggle theme','تبديل المظهر')} className="instructor-topbar-control">
            {theme==='dark'?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
          </button>
          <div className="instructor-topbar-account">
            <button type="button" onClick={()=>setInstructorRoute('profile')} aria-label={t('Open my profile','فتح الملف الشخصي')} className="instructor-topbar-profile">
              <span className="instructor-topbar-avatar" aria-hidden="true">{initials}</span>
              <span className="instructor-topbar-name"><strong className="block truncate text-sm">{displayName}</strong><span className="block text-[11px] instructor-topbar-secondary">{t('Instructor','محاضر')}</span></span>
            </button>
            <button type="button" onClick={()=>signOut()} aria-label={t('Logout','تسجيل الخروج')} title={t('Logout','تسجيل الخروج')} className="instructor-topbar-control instructor-topbar-logout"><LogOut className="w-4 h-4"/></button>
          </div>
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
