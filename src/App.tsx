/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { UserRole } from './types/database';
import { AuthView } from './pages/auth/AuthView';
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
      <div className="min-h-screen bg-[#f4f6f9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-sm font-bold tracking-tight">CITS Camp Operations</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('Verifying secure Supabase session & RLS context...', 'جاري التحقق من الجلسة الآمنة وصلاحيات RLS...')}
          </p>
        </div>
      </div>
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
