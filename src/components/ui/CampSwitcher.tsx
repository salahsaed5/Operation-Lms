import React from 'react';
import { useApp } from '../../context/AppContext';
import { CampStatus } from '../../types/database';

/** One explicit working-Camp selector shared by Admin and Instructor. A switch
 * resets stale attendance lecture context in AppContext. Instructor choices
 * are restricted to the permitted Camp list and independently enforced by RLS.
 */
export const CampSwitcher: React.FC = () => {
  const { availableCamps, activeCamp, selectCamp, t } = useApp();
  const statusName = (status: CampStatus) => {
    if (status === CampStatus.ACTIVE) return t('Active','نشط');
    if (status === CampStatus.DRAFT) return t('Draft','مسودة');
    return t('Archive','أرشيف');
  };
  return (
    <select
      aria-label={t('Select working Camp', 'اختيار الكامب الذي تعمل عليه')}
      title={t('All pages use the selected Camp only', 'كل صفحات التشغيل تخص الكامب المختار فقط')}
      value={activeCamp?.id || ''}
      onChange={event => selectCamp(event.target.value)}
      disabled={availableCamps.length <= 1}
      className="w-40 sm:w-52 lg:w-64 min-w-0 max-w-full rounded-lg border border-slate-300 dark:border-[#42474D] bg-white dark:bg-[#1D2023] px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-[#F0F1F2] disabled:opacity-70"
    >
      {availableCamps.length === 0 && (
        <option value="">{t('No assigned Camps','لا يوجد كامبات متاحة')}</option>
      )}
      {availableCamps.map(camp => (
        <option key={camp.id} value={camp.id}>
          {camp.code} · {t(camp.nameEn,camp.nameAr)} · {statusName(camp.status)}
        </option>
      ))}
    </select>
  );
};
