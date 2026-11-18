import React, { useState } from 'react';
import {
  Lock,
  ShieldCheck,
  KeyRound,
  Globe,
  Moon,
  Sun,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const AuthView: React.FC = () => {
  const {
    auth,
    isSupabaseMode,
    dataError,
    loginWithCredentials,
    setupAdminTotpEnrollment,
    verifyAdminTotp,
    completeFirstLoginPasswordChange,
    signOut,
    lang,
    setLang,
    theme,
    toggleTheme,
    t,
  } = useApp();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState(isSupabaseMode ? '' : '482910');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await loginWithCredentials(identifier, password);
      if (!res.ok && res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await verifyAdminTotp(totpCode);
      if (!res.ok && res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerateQr = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await setupAdminTotpEnrollment();
      if (!res.ok && res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('Passwords do not match.', 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await completeFirstLoginPasswordChange(newPassword);
      if (!res.ok && res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillQuickAccount = (user: string, pass: string) => {
    if (isSupabaseMode) return;
    setIdentifier(user);
    setPassword(pass);
    setErrorMsg(null);
  };

  const displayError = errorMsg || dataError;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-6">
      {/* Top Bar */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between gap-8 py-2">
        <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          CITS Camp Operations
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'العربية (RTL)' : 'English (LTR)'}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t('Toggle color theme', 'تبديل المظهر')}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Centered Auth Card */}
      <main className="max-w-md w-full mx-auto my-8">
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
          {/* Step 1: Standard Login */}
          {!auth.pendingTotpProfileId && !auth.pendingPasswordChangeProfileId && (
            <>
              <div className="mb-6">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                  {isSupabaseMode
                    ? t('Supabase Auth · PostgreSQL RLS Active', 'مصادقة Supabase · حماية RLS مفعلة')
                    : t('Local Operational Sandbox Mode', 'وضع المحاكاة المحلي')}
                </p>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('Sign in to CITS Portal', 'تسجيل الدخول إلى نظام CITS')}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {t(
                    'Enter your assigned username or verified email address. Public registration is disabled.',
                    'أدخل اسم المستخدم أو البريد الإلكتروني المعتمد. التسجيل العام غير متاح.'
                  )}
                </p>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Username or Email', 'اسم المستخدم أو البريد الإلكتروني')}
                  </label>
                  <input
                    id="login-identifier"
                    type="text"
                    required
                    disabled={isSubmitting}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t('e.g. admin.tarek or ahmed.khalil', 'مثال: admin.tarek أو ahmed.khalil')}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Password', 'كلمة المرور')}
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    required
                    disabled={isSubmitting}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? t('Verifying Account...', 'جاري التحقق...')
                      : t('Continue to Portal', 'المتابعة لتسجيل الدخول')}
                  </span>
                </button>
              </form>

              {/* Quick Test Accounts ONLY in Local Sandbox Mode (Never shown when Supabase env is configured) */}
              {!isSupabaseMode && (
                <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">
                    {t('Quick-Fill Provisioned Accounts (Local Sandbox Only)', 'حسابات المحاكاة المحلية (غير متصل بقاعدة بيانات)')}
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => fillQuickAccount('admin.tarek', 'CitsAdmin#2026')}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between text-xs cursor-pointer"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Eng. Tarek Mansour
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> · Admin Slot 1 (TOTP MFA)</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fillQuickAccount('ahmed.khalil', 'Instructor#2026')}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between text-xs cursor-pointer"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Dr. Ahmed Khalil
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> · Instructor (Group Alpha)</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fillQuickAccount('hoda.soliman', 'TempPass#2026')}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between text-xs cursor-pointer"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Dr. Hoda Soliman
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> · First-Login Password Reset</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Step 2: Mandatory Admin TOTP MFA (Real Enrollment QR / Verification in Supabase mode) */}
          {auth.pendingTotpProfileId && (
            <div>
              <div className="mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  {auth.mfaNeedsEnrollment
                    ? t('Enroll Admin TOTP Authenticator', 'تفعيل المصادقة الثنائية للمسؤول (TOTP)')
                    : t('Admin Two-Factor Verification (TOTP)', 'المصادقة الثنائية الإلزامية للمسؤول')}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {auth.mfaNeedsEnrollment
                    ? t(
                        'Scan this QR code in Google Authenticator, 1Password, or Authy, then enter the generated 6-digit code.',
                        'امسح رمز الاستجابة السريعة في تطبيق المصادقة ثم أدخل الرمز المكون من 6 أرقام.'
                      )
                    : t(
                        'Both CITS Admin accounts require a 6-digit TOTP authenticator code before accessing camp operations.',
                        'يتطلب حساب المسؤول إدخال رمز المصادقة الثنائية المكون من 6 أرقام.'
                      )}
                </p>
              </div>

              {isSupabaseMode && auth.mfaNeedsEnrollment && auth.mfaEnrollment && (
                <div className="mb-5 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col items-center gap-3">
                  <img
                    src={auth.mfaEnrollment.qrCode}
                    alt="CITS Admin TOTP QR Code"
                    className="w-40 h-40 rounded-lg bg-white p-2 border border-slate-200"
                  />
                  <div className="text-center space-y-1">
                    <p className="text-[11px] text-slate-500">
                      {t('Manual Setup Key:', 'مفتاح الإعداد اليدوي:')}
                    </p>
                    <p className="text-xs font-mono font-semibold text-slate-900 dark:text-white select-all break-all">
                      {auth.mfaEnrollment.secret}
                    </p>
                  </div>
                </div>
              )}

              {displayError && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="totp-code-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('6-Digit Authenticator Code', 'رمز تطبيق المصادقة (6 أرقام)')}
                  </label>
                  <input
                    id="totp-code-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    disabled={isSubmitting}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    className="w-full px-3.5 py-2.5 text-lg font-mono tabular-nums tracking-widest text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  {isSubmitting
                    ? t('Verifying Code...', 'جاري التأكيد...')
                    : t('Verify & Open Admin Console', 'تأكيد الرمز والدخول للوحة التحكم')}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between text-xs">
                {isSupabaseMode && auth.mfaNeedsEnrollment ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleRegenerateQr}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t('Regenerate QR Code', 'إعادة إنشاء رمز QR')}</span>
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
                >
                  {t('Use another account', 'استخدام حساب آخر')}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Mandatory First-Login Password Change */}
          {auth.pendingPasswordChangeProfileId && (
            <div>
              <div className="mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  {t('Update Temporary Password', 'تغيير كلمة المرور المؤقتة')}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {t(
                    'For security, you must replace your temporary initial password before accessing your account.',
                    'لدواعي الأمان، يرجى تعيين كلمة مرور جديدة بدلاً من كلمة المرور المؤقتة.'
                  )}
                </p>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handlePasswordChangeSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('New Password (min 8 characters)', 'كلمة المرور الجديدة (8 أحرف على الأقل)')}
                  </label>
                  <input
                    id="new-password-input"
                    type="password"
                    required
                    disabled={isSubmitting}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-password-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Confirm New Password', 'تأكيد كلمة المرور الجديدة')}
                  </label>
                  <input
                    id="confirm-password-input"
                    type="password"
                    required
                    disabled={isSubmitting}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  {isSubmitting
                    ? t('Saving Password...', 'جاري الحفظ...')
                    : t('Save Password & Continue', 'حفظ كلمة المرور والمتابعة')}
                </button>
              </form>

              <div className="mt-4 text-right text-xs">
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
                >
                  {t('Cancel & Sign out', 'إلغاء وتسجيل الخروج')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="max-w-6xl w-full mx-auto text-center py-3 text-xs text-slate-500 dark:text-slate-400">
        {t(
          'CITS Camp Operations · Protected by Supabase Row Level Security · Max 2 Admin Accounts Policy',
          'نظام إدارة معسكرات CITS · محمي بسياسات أمن قواعد البيانات RLS'
        )}
      </footer>
    </div>
  );
};
