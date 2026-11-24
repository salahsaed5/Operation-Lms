/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { UserRole } from './types/database';
import { AuthView } from './pages/auth/AuthView';
import { CitsBrand } from './components/ui/CitsBrand';
import { AdminLayout } from './layouts/AdminLayout';
import { InstructorLayout } from './layouts/InstructorLayout';
import { AdminDashboardView } from './pages/admin/AdminDashboardView';
import {
  AdminCampsView,
  AdminInstructorsView,
  AdminStudentsAndGroupsView,
} from './pages/admin/AdminCampsAndPeopleView';
import {
  AdminScheduleView,
  AdminAttendanceView,
} from './pages/admin/AdminScheduleAndAttendanceView';
import {
  AdminFinanceView,
  AdminReportsView,
  AdminOperationsView,
  AdminSettingsAndAuditView,
} from './pages/admin/AdminFinanceReportsSettingsView';
import {
  InstructorDashboardView,
  InstructorScheduleView,
  InstructorCheckinView,
  InstructorAttendanceView,
  InstructorProfileAndSectionsView,
} from './pages/instructor/InstructorPortalViews';

const AppRouter: React.FC = () => {
  const { auth, isInitializingSession, adminRoute, instructorRoute, instructorAttendanceLectureId, activeCamp, t } = useApp();

  if (isInitializingSession) {
    return (
      <main className="cits-loading-screen" aria-busy="true">
        <div className="cits-loading-content" role="status" aria-live="polite">
          <CitsBrand className="cits-loading-brand"/>
          <h1>{t('Loading your workspace...', 'جاري تحميل مساحة عملك...')}</h1>
          <p className="cits-loading-message">
            <ShieldCheck aria-hidden="true" className="cits-loading-shield"/>
            <span>{t('Establishing a secure session', 'جاري إنشاء جلسة آمنة')}</span>
          </p>
          <div className="cits-loading-track" aria-hidden="true"><span/></div>
        </div>
      </main>
    );
  }

  if (
    !auth.isAuthenticated ||
    !auth.currentProfile.isActive ||
    auth.currentProfile.mustChangePassword ||
    auth.pendingTotpProfileId ||
    auth.pendingPasswordChangeProfileId
  ) {
    return <AuthView />;
  }

  return (
    <>
      {auth.currentProfile.role === UserRole.ADMIN ? (
        <AdminLayout>
          {adminRoute === 'dashboard' && <AdminDashboardView />}
          {adminRoute === 'camps' && <AdminCampsView />}
          {adminRoute === 'instructors' && <AdminInstructorsView />}
          {adminRoute === 'students' && <AdminStudentsAndGroupsView />}
          {adminRoute === 'schedule' && <AdminScheduleView />}
          {adminRoute === 'attendance' && <AdminAttendanceView />}
          {adminRoute === 'finance' && <AdminFinanceView />}
          {adminRoute === 'reports' && <AdminReportsView />}
          {adminRoute === 'operations' && <AdminOperationsView />}
          {adminRoute === 'settings' && <AdminSettingsAndAuditView />}
        </AdminLayout>
      ) : (
        <InstructorLayout>
          {instructorRoute === 'dashboard' && <InstructorDashboardView />}
          {instructorRoute === 'schedule' && <InstructorScheduleView />}
          {instructorRoute === 'checkin' && <InstructorCheckinView />}
          {instructorRoute === 'attendance' && <InstructorAttendanceView key={(activeCamp?.id||'')+':'+instructorAttendanceLectureId} />}
          {instructorRoute === 'profile' && <InstructorProfileAndSectionsView />}
        </InstructorLayout>
      )}
    </>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
