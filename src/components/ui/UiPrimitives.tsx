import React, { useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
} from 'lucide-react';

export const SURFACE_CARD =
  'rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)]';

export const SURFACE_SUBTLE =
  'rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60';

export const LABEL_CLASS =
  'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export const INPUT_CLASS =
  'w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60 transition-colors';

export const SELECT_CLASS =
  'w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60 transition-colors';

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed';

export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed';

export const BTN_DANGER_OUTLINE =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900/70 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60 text-red-600 dark:text-red-400 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  warning:
    'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  danger:
    'bg-red-50 text-red-700 border-red-200/80 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900',
  info: 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900',
  neutral:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

export const StatusBadge: React.FC<{
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone, children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
  >
    {children}
  </span>
);

export const PageHeader: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
    {actions && (
      <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
    )}
  </div>
);

export const InlineBanner: React.FC<{
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  onDismiss?: () => void;
}> = ({ type, message, onDismiss }) => {
  const styles =
    type === 'success'
      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
      : type === 'error'
      ? 'border-red-200 dark:border-red-900 bg-red-50/90 dark:bg-red-950/40 text-red-800 dark:text-red-200'
      : type === 'warning'
      ? 'border-amber-200 dark:border-amber-900 bg-amber-50/90 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
      : 'border-blue-200 dark:border-blue-900 bg-blue-50/90 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200';

  const Icon =
    type === 'success'
      ? CheckCircle2
      : type === 'error' || type === 'warning'
      ? AlertCircle
      : Info;

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`px-4 py-3 rounded-lg border text-xs sm:text-sm font-medium flex items-start justify-between gap-3 ${styles}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const EmptyState: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 py-12 px-6 text-center space-y-2.5">
    <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
      <Icon className="w-5 h-5" />
    </div>
    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
    {description && (
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
        {description}
      </p>
    )}
    {action && <div className="pt-1.5">{action}</div>}
  </div>
);

export const PaginationBar: React.FC<{
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
  labelShowing: string;
}> = ({ page, totalPages, totalItems, pageSize, onPageChange, labelShowing }) => {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
      <span className="tabular-nums">
        {labelShowing}: <strong className="text-slate-700 dark:text-slate-200">{start}–{end}</strong> / {totalItems}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
        </button>
        <span className="px-2 font-mono tabular-nums text-slate-700 dark:text-slate-200">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'primary';
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  isBusy = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isBusy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => !isBusy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2
            id="confirm-dialog-title"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className={BTN_SECONDARY}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className={
              tone === 'danger'
                ? 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer'
                : BTN_PRIMARY
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
