import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
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
  const [showPassword, setShowPassword] = useState(false);

  const [totpCode, setTotpCode] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!identifier.trim() || !password.trim()) {
      setErrorMsg(
        t(
          'Please enter both your username or email and password.',
          'يرجى إدخال اسم المستخدم أو البريد الإلكتروني وكلمة المرور.'
        )
      );
      return;
    }
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
    const cleaned = totpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      setErrorMsg(
        t(
          'Please enter a valid 6-digit verification code.',
          'يرجى إدخال رمز تحقق مكون من 6 أرقام.'
        )
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await verifyAdminTotp(cleaned);
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
    if (newPassword.trim().length < 8) {
      setErrorMsg(
        t(
          'New password must be at least 8 characters long.',
          'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.'
        )
      );
      return;
    }
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

  const displayError = errorMsg || dataError;

  return (
    <div className="min-h-screen w-full bg-[#f4f6f9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 grid grid-cols-1 lg:grid-cols-12">
      {/* Left Brand Architectural Panel (Clean Minimalist Technical Grid matching reference) */}
      <aside className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative overflow-hidden bg-[#f8fafc] dark:bg-slate-900/60 border-e border-slate-200/80 dark:border-slate-800 flex-col justify-between p-12">
        {/* Restrained Technical Line Pattern */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 w-full h-full text-slate-200/80 dark:text-slate-800/70 pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="cits-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="0.75" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cits-grid)" />
        </svg>

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white text-sm font-bold flex items-center justify-center tracking-tight">
            CI
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
              CITS Camp Operations
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Training Operations & Attendance Platform', 'منصة إدارة المعسكرات والحضور التدريبي')}
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-lg space-y-6 my-auto">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
            {t(
              'Structured daily camp coordination, verified attendance, and schedule clarity.',
              'إدارة متكاملة لعمليات المعسكرات التدريبية والجدول والحضور اليومي.'
            )}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {t(
              'Role-isolated portals for camp administrators and instructors—covering daily check-ins, roster tracking, conflict-checked scheduling, and transparent lecture entitlements.',
              'بوابات تشغيل مستقلة للمسؤولين والمحاضرين لمتابعة تسجيل الوصول، كشوف الحضور، الجداول الدراسية، ومستحقات المحاضرات.'
            )}
          </p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/85 dark:bg-slate-900/80 backdrop-blur-xs">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                {t('Admin Console', 'لوحة الإدارة')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t(
                  'Schedules, attendance audits, camp lifecycle, and entitlement reviews.',
                  'إدارة الجداول، مراجعة الكشوف، المعسكرات، واعتماد المستحقات.'
                )}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/85 dark:bg-slate-900/80 backdrop-blur-xs">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                {t('Instructor Workspace', 'بوابة المحاضر')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t(
                  'Assigned schedule, venue check-in verification, and attendance rosters.',
                  'الجدول المخصص، توثيق الوصول اليومي، وكشوف حضور الطلاب.'
                )}
              </p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-slate-400 dark:text-slate-500">
          {t(
            'Authorized personnel access only. Account provisioning is managed by your camp administrator.',
            'الدخول مصرح به للمستخدمين المعتمدين فقط عبر إدارة المعسكر.'
          )}
        </p>
      </aside>

      {/* Right Clean White Sign-In Surface */}
      <div className="lg:col-span-6 xl:col-span-5 bg-white dark:bg-slate-950 flex flex-col justify-between p-6 sm:p-10">
        {/* Unobtrusive Top Utility Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
              CI
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              CITS Operations
            </span>
          </div>
          <div className="hidden lg:block" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              aria-label={t('Switch Language', 'تغيير اللغة')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'العربية' : 'English'}</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Switch Light or Dark Theme', 'تبديل المظهر')}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Centered Form Box */}
        <main className="w-full max-w-sm mx-auto my-8">
          {/* Step 1: Standard Account Sign-In */}
          {!auth.pendingTotpProfileId && !auth.pendingPasswordChangeProfileId && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('Sign in to your account', 'تسجيل الدخول')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {t(
                    'Enter your assigned username or work email to continue.',
                    'أدخل اسم المستخدم أو البريد الإلكتروني المعتمد للمتابعة.'
                  )}
                </p>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Username or Email', 'اسم المستخدم أو البريد الإلكتروني')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="login-identifier"
                    type="text"
                    autoComplete="username"
                    required
                    disabled={isSubmitting}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t('Enter username or email', 'أدخل اسم المستخدم أو البريد')}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Password', 'كلمة المرور')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      disabled={isSubmitting}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('Enter your password', 'أدخل كلمة المرور')}
                      className="w-full ps-3.5 pe-10 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword
                          ? t('Hide password', 'إخفاء كلمة المرور')
                          : t('Show password', 'إظهار كلمة المرور')
                      }
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                  <span>
                    {isSubmitting
                      ? t('Signing in...', 'جاري التحقق...')
                      : t('Sign In', 'تسجيل الدخول')}
                  </span>
                </button>
              </form>

              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t(
                  'Need access or a credential reset? Contact your camp administrator.',
                  'هل تحتاج لتفعيل حسابك أو إعادة تعيين كلمة المرور؟ تواصل مع مسؤول المعسكر.'
                )}
              </p>
            </div>
          )}

          {/* Step 2: Mandatory Admin Two-Factor Verification */}
          {auth.pendingTotpProfileId && (
            <div className="space-y-5">
              <div>
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {auth.mfaNeedsEnrollment
                    ? t('Set Up Two-Factor Authentication', 'تفعيل المصادقة الثنائية')
                    : t('Two-Factor Verification', 'التحقق بخطوتين')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {auth.mfaNeedsEnrollment
                    ? t(
                        'Scan the QR code below with your authenticator app, then enter the 6-digit verification code.',
                        'امسح رمز الاستجابة السريعة في تطبيق المصادقة ثم أدخل الرمز المكون من 6 أرقام.'
                      )
                    : t(
                        'Enter the 6-digit code from your authenticator app to access the Admin console.',
                        'أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة للدخول إلى لوحة الإدارة.'
                      )}
                </p>
              </div>

              {isSupabaseMode && auth.mfaNeedsEnrollment && auth.mfaEnrollment && (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center gap-3">
                  <img
                    src={auth.mfaEnrollment.qrCode}
                    alt={t('Two-factor authentication QR code', 'رمز استجابة سريعة للمصادقة الثنائية')}
                    className="w-40 h-40 rounded-lg bg-white p-2 border border-slate-200"
                  />
                  <div className="text-center space-y-1">
                    <p className="text-[11px] text-slate-500">
                      {t('Manual Setup Key', 'مفتاح الإعداد اليدوي')}
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
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleTotpSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="totp-code-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('6-Digit Authenticator Code', 'رمز التحقق (6 أرقام)')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="totp-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    disabled={isSubmitting}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    className="w-full px-3.5 py-2.5 text-lg font-mono tabular-nums tracking-widest text-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>
                    {isSubmitting
                      ? t('Verifying...', 'جاري التحقق...')
                      : t('Verify & Continue', 'تأكيد والمتابعة')}
                  </span>
                </button>
              </form>

              <div className="flex items-center justify-between text-xs pt-1">
                {isSupabaseMode && auth.mfaNeedsEnrollment ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleRegenerateQr}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t('Regenerate QR Code', 'إعادة إنشاء الرمز')}</span>
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:underline cursor-pointer"
                >
                  {t('Use a different account', 'استخدام حساب آخر')}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Mandatory First-Login Password Change */}
          {auth.pendingPasswordChangeProfileId && (
            <div className="space-y-5">
              <div>
                <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-900 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('Create a New Password', 'تعيين كلمة مرور جديدة')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {t(
                    'Update your temporary initial password before accessing your workspace.',
                    'يرجى استبدال كلمة المرور المؤقتة بكلمة مرور جديدة قبل المتابعة.'
                  )}
                </p>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handlePasswordChangeSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('New Password (min 8 characters)', 'كلمة المرور الجديدة (8 أحرف على الأقل)')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      id="new-password-input"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={isSubmitting}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full ps-3.5 pe-10 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((p) => !p)}
                      aria-label={
                        showNewPassword
                          ? t('Hide new password', 'إخفاء كلمة المرور')
                          : t('Show new password', 'إظهار كلمة المرور')
                      }
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirm-password-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t('Confirm New Password', 'تأكيد كلمة المرور الجديدة')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password-input"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={isSubmitting}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full ps-3.5 pe-10 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((p) => !p)}
                      aria-label={
                        showConfirmPassword
                          ? t('Hide password confirmation', 'إخفاء التأكيد')
                          : t('Show password confirmation', 'إظهار التأكيد')
                      }
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>
                    {isSubmitting
                      ? t('Updating Password...', 'جاري التحديث...')
                      : t('Update Password & Continue', 'حفظ كلمة المرور والمتابعة')}
                  </span>
                </button>
              </form>

              <div className="text-end text-xs">
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:underline cursor-pointer"
                >
                  {t('Cancel & Sign out', 'إلغاء وتسجيل الخروج')}
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Quiet Minimal Footer */}
        <footer className="text-xs text-slate-400 dark:text-slate-500 flex items-center justify-between gap-2">
          <span>CITS Camp Operations</span>
          <span>{t('Enterprise Training Operations', 'نظام إدارة العمليات التدريبية')}</span>
        </footer>
      </div>
    </div>
  );
};
