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
import { ArchitecturePlanDrawer } from './components/ArchitecturePlanDrawer';
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
  const { auth, adminRoute, instructorRoute } = useApp();

  if (
    !auth.isAuthenticated ||
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
          {instructorRoute === 'attendance' && <InstructorAttendanceView />}
          {instructorRoute === 'profile' && <InstructorProfileAndSectionsView />}
        </InstructorLayout>
      )}
      <ArchitecturePlanDrawer />
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
