import React, { useState } from 'react';
import { X, Database, Shield, FolderTree, FileCode, Server, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getSupabaseStatusSummary } from '../lib/supabase';

export const ArchitecturePlanDrawer: React.FC = () => {
  const { isArchitectureDrawerOpen, setArchitectureDrawerOpen, t } = useApp();
  const [activeTab, setActiveTab] = useState<'plan' | 'schema' | 'env'>('plan');
  const sbStatus = getSupabaseStatusSummary();

  if (!isArchitectureDrawerOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="arch-drawer-title"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 h-full flex flex-col justify-between overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 id="arch-drawer-title" className="text-lg font-bold text-slate-900 dark:text-white">
              {t(
                'Phase 2 Database, RLS & Security Architecture',
                'هندسة قاعدة البيانات وسياسات الأمان — المرحلة الثانية'
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t(
                '29 PostgreSQL entities, 0001–0005 migrations, full RLS policy matrix, and automated domain/lexical checks',
                '29 جدولاً، ملفات الترحيل 0001–0005، مصفوفة صلاحيات RLS، واختبارات الأمان الآلية'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setArchitectureDrawerOpen(false)}
            aria-label={t('Close architecture drawer', 'إغلاق نافذة البنية التقنية')}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Control */}
        <div className="px-6 pt-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-xl w-fit mb-3">
            <button
              type="button"
              onClick={() => setActiveTab('plan')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'plan'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('1. Audit & Security Tests', '1. التدقيق واختبارات الأمان')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('schema')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'schema'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('2. SQL Migrations & RLS', '2. ترحيلات SQL وصلاحيات RLS')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('env')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'env'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('3. Connection & Env Guard', '3. حالة الاتصال ومتغيرات البيئة')}
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-sm">
          {activeTab === 'plan' && (
            <>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white mb-2">
                  <FolderTree className="w-4 h-4 text-blue-500" />
                  <span>{t('Phase 1 + Phase 2 Deliverable Structure', 'هيكل ملفات المرحلتين الأولى والثانية')}</span>
                </div>
                <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto leading-relaxed">
{`├── supabase/
│   ├── migrations/0001..0005                         # 29 tables, RLS, MFA AAL2, RPCs, hardening
│   └── verification/0003..0005_*.sql                 # Ephemeral ROLLBACK behavioral suites + inventory
├── docs/
│   └── SETUP_AND_ARCHITECTURE.md                     # Audit report, staging runbook, rollback SQL
├── src/
│   ├── types/database.ts                             # Database['public'] PG schema + UI domain types
│   ├── domain/
│   │   ├── businessRules.ts                          # Validation, GPS bounds, transfers, RLS simulator
│   │   └── businessRules.test.ts                     # Unit + SQL static/Guard 1C scanner tests
│   └── lib/supabase.ts                               # Env secret guard & connection mode detector`}
                </pre>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" />
                  <span>{t('Verified Security & Integrity Controls (Local TS Suite)', 'ضوابط الأمان والتكامل المفحوصة محلياً')}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                  {[
                    'Max 2 Admin accounts + advisory lock + AAL2 MFA',
                    'Single active camp + archived child table locks',
                    'Historical 3+ & same-day student transfer resolution',
                    'Smart Update cross-group history protection',
                    'Schedule overlap, max groups/day & ack reset',
                    'GPS NaN/Infinity/500m & selfie anti-traversal bounds',
                    'Admin post-submission attendance correction RPC',
                    'Inactive user denial + Guard 1C lexical verification',
                  ].map((item) => (
                    <div
                      key={item}
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'schema' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-500" />
                  <span>0001–0005 Sequential PostgreSQL Migrations (29 Tables)</span>
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">Zero USING(true)</span>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Phase 2 Hardening Across 0002, 0004 &amp; 0005:
                </p>
                <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
                  <li>· <code>is_cits_admin()</code> &amp; <code>is_active_cits_user()</code> enforce AAL2 MFA + active status across all policies &amp; RPCs.</li>
                  <li>· <code>prevent_mutation_on_archived_camp()</code> covers operational tables including <code>attachments</code> while preserving <code>backup_records</code>.</li>
                  <li>· <code>resolve_student_group_for_day()</code> &amp; <code>batch_import_students_tx()</code> preserve full student transfer history.</li>
                  <li>· <code>enforce_daily_checkin_security()</code> validates finite WGS84 bounds, GPS accuracy &lt;= 500m, and anti-traversal selfie paths.</li>
                  <li>· <code>admin_correct_attendance_tx()</code> enables audited Admin fixes on draft, submitted, and locked attendance sheets.</li>
                </ul>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <p className="text-xs font-semibold text-slate-900 dark:text-white mb-1.5">
                  Hardened SECURITY DEFINER RPCs
                </p>
                <pre className="text-xs font-mono text-slate-600 dark:text-slate-300 overflow-x-auto leading-relaxed">
{`public.is_cits_admin()                        -- AAL2 MFA + active admin profile
public.is_active_cits_user()                  -- Active account gate
public.submit_daily_checkin_tx(...)           -- Server Haversine + GPS/selfie checks
public.submit_attendance_sheet_tx(...)        -- Atomic submission + entitlement calc
public.admin_correct_attendance_tx(...)       -- Audited post-submission correction
public.transfer_student_tx(...)               -- Historical day transfer timeline
public.archive_camp_tx(...)                   -- Atomic archive + selfie path purge`}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'env' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                    <Server className="w-4 h-4 text-blue-500" />
                    <span>Runtime Connection Status</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    {sbStatus.configured ? 'Connected Supabase Configured' : 'Local Operational Sandbox Mode'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Active Host: <span className="font-mono font-semibold">{sbStatus.urlHost}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {sbStatus.message}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white mb-2">
                  <FileCode className="w-4 h-4 text-blue-500" />
                  <span>Verification Status Matrix</span>
                </div>
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono">
                  <p>· SQL Migrations (0001–0005):   [Authored &amp; Guard 1C Scanner Validated Locally]</p>
                  <p>· TypeScript DB Schema Types:   [Verified via tsc --noEmit &amp; vite build]</p>
                  <p>· Verification Suites:          [0003, 0004 &amp; 0005 Behavioral SQL Suites Ready]</p>
                  <p>· Remote Supabase Live Execution: [Requires Staging DB / SQL Editor Execution]</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('Phase 2 Architecture & Verification Overview', 'نظرة عامة على معمارية والتحقق من المرحلة الثانية')}
          </span>
          <button
            type="button"
            onClick={() => setArchitectureDrawerOpen(false)}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            {t('Done', 'إغلاق')}
          </button>
        </div>
      </div>
    </div>
  );
};
