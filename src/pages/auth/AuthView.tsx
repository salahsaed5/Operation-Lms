import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Headphones,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CitsBrand } from '../../components/ui/CitsBrand';
import { validateInitialPasswordStrength } from '../../domain/accountProvisioning';
import { UserRole } from '../../types/database';

export const AuthView: React.FC = () => {
  const {
    auth,
    isSupabaseMode,
    isSandboxMode,
    dataError,
    loginWithCredentials,
    setupAdminTotpEnrollment,
    verifyAdminTotp,
    completeFirstLoginPasswordChange,
    signOut,
    profiles,
    instructors,
    switchDemoIdentity,
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
    const strengthCheck = validateInitialPasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      setErrorMsg(
        t(
          strengthCheck.error ||
            'New password must be 8–128 characters and include uppercase, lowercase, and a number.',
          'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم.'
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
  const isPasswordChangeRequired =
    !auth.pendingTotpProfileId &&
    Boolean(
      auth.pendingPasswordChangeProfileId ||
        (auth.currentProfile.isActive && auth.currentProfile.mustChangePassword)
    );

  return (
    <div className="cits-auth-shell">
      <aside className="cits-auth-hero" aria-hidden="true">
        <svg className="cits-auth-curves" viewBox="0 0 780 900" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id="auth-deep" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#092b39"/><stop offset=".58" stopColor="#103c4a"/><stop offset="1" stopColor="#075b69"/></linearGradient>
            <linearGradient id="auth-ribbon" x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#097789"/><stop offset=".48" stopColor="#27bcc9"/><stop offset="1" stopColor="#c6e9e8"/></linearGradient>
          </defs>
          <path d="M0 0H780C650 95 620 212 611 345C597 565 658 754 494 900H0Z" fill="url(#auth-ribbon)" opacity=".9"/>
          <path d="M0 0H744C619 103 589 217 580 349C566 565 627 755 458 900H0Z" fill="#6cc2ce" opacity=".55"/>
          <path d="M0 0H712C590 110 557 224 549 353C536 565 595 755 419 900H0Z" fill="url(#auth-deep)"/>
          <path d="M744 0C619 103 589 217 580 349C566 565 627 755 458 900" stroke="#b8edf1" strokeWidth="1.5" opacity=".65" fill="none"/>
          <path d="M0 810C176 873 345 866 550 733C524 798 482 854 419 900H0Z" fill="#08798a" opacity=".55"/>
        </svg>
        <div className="cits-auth-hero-brand">
          <CitsBrand inverse className="cits-auth-hero-logo"/>
          <p>{t('Learning Management System','نظام إدارة التعلم')}</p>
        </div>
        <img className="cits-auth-hero-art" src="/assets/cits-login-hero-hd.webp" alt="" width={628} height={350} decoding="async"/>
      </aside>
      <div className="cits-auth-form-side">
        {/* Unobtrusive Top Utility Header */}
        <header className="cits-auth-controls">
          <div className="cits-auth-mobile-brand"><CitsBrand className="cits-brand-auth-mobile"/></div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              aria-label={t('Switch Language', 'تغيير اللغة')}
              className="cits-auth-utility"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'AR' : 'EN'}</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Switch Light or Dark Theme', 'تبديل المظهر')}
              className="cits-auth-utility cits-auth-theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Centered Form Box */}
        <main className="cits-auth-card">
          {/* Step 1: Standard Account Sign-In */}
          {!auth.pendingTotpProfileId && !isPasswordChangeRequired && (
            <div className="cits-auth-standard space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('Sign In', 'تسجيل الدخول')}
                </h1>
                <div className="cits-auth-accent" aria-hidden="true"/>
              </div>

              {isSandboxMode && (
                <div role="status" aria-live="polite" className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200">
                  <strong>{t('LOCAL SANDBOX PREVIEW', 'معاينة محلية تجريبية')}</strong>
                  <p className="mt-1">{t('This is demo data only. Supabase is not connected and changes are not saved to the remote database.', 'هذه بيانات تجريبية فقط. لا يوجد اتصال بـ Supabase ولن تُحفظ التغييرات في قاعدة البيانات البعيدة.')}</p>
                </div>
              )}

              {displayError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="cits-auth-login-form" noValidate>
                <div>
                  <label
                    htmlFor="login-identifier"
                    className="sr-only"
                  >
                    {t('Username or Email', 'اسم المستخدم أو البريد الإلكتروني')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <div className="cits-auth-field">
                  <Mail className="cits-auth-field-icon" aria-hidden="true"/>
                  <input
                    id="login-identifier"
                    type="text"
                    autoComplete="username"
                    required
                    disabled={isSubmitting}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t('Username or Email', 'أدخل اسم المستخدم أو البريد')}
                    className="cits-auth-input"
                  />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="sr-only"
                  >
                    {t('Password', 'كلمة المرور')}
                    <span className="text-red-500 ms-0.5" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <div className="cits-auth-field">
                    <Lock className="cits-auth-field-icon" aria-hidden="true"/>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      disabled={isSubmitting}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('Password', 'أدخل كلمة المرور')}
                      className="cits-auth-input cits-auth-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword
                          ? t('Hide password', 'إخفاء كلمة المرور')
                          : t('Show password', 'إظهار كلمة المرور')
                      }
                      className="cits-auth-eye"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="cits-auth-submit"
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

              <p className="cits-auth-support"><Headphones className="w-4 h-4 shrink-0" aria-hidden="true"/><span>{t('Need help? Contact your camp administrator.','تحتاج مساعدة؟ تواصل مع مسؤول المعسكر.')}</span></p>

              {isSandboxMode && (
                <section
                  aria-label={t('Local sandbox account selector', 'اختيار حساب بيئة المعاينة المحلية')}
                  className="pt-5 border-t border-slate-200/80 dark:border-[#353A3F] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-600 dark:text-[#A0A5AA]">
                      {t('Local Sandbox Accounts', 'حسابات المعاينة المحلية')}
                    </p>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-[#848B91]">
                      {t('Dev Preview', 'معاينة')}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {profiles
                      .filter((p) => p.role === UserRole.ADMIN && p.isActive)
                      .map((admin) => (
                        <button
                          key={admin.id}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => switchDemoIdentity(UserRole.ADMIN, undefined, admin.id)}
                          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-slate-50/70 dark:bg-[#1D2023]/60 hover:bg-white dark:hover:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800 text-start transition-colors cursor-pointer"
                        >
                          <span className="block text-[11px] font-medium text-[#355F82] dark:text-[#88A9CC]">
                            {t('Admin', 'مسؤول')}
                          </span>
                          <span className="block text-xs font-semibold text-slate-800 dark:text-[#DEE1E4] truncate">
                            {t(admin.fullNameEn, admin.fullNameAr)}
                          </span>
                        </button>
                      ))}
                    {instructors
                      .filter((i) => i.isActive)
                      .map((inst) => (
                        <button
                          key={inst.id}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() =>
                            switchDemoIdentity(UserRole.INSTRUCTOR, inst.id, inst.profileId)
                          }
                          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#353A3F] bg-slate-50/70 dark:bg-[#1D2023]/60 hover:bg-white dark:hover:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800 text-start transition-colors cursor-pointer"
                        >
                          <span className="block text-[11px] font-medium text-slate-500 dark:text-[#A0A5AA]">
                            {t('Instructor', 'محاضر')}
                          </span>
                          <span className="block text-xs font-semibold text-slate-800 dark:text-[#DEE1E4] truncate">
                            {t(inst.fullNameEn, inst.fullNameAr)}
                          </span>
                        </button>
                      ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Step 2: Mandatory Admin Two-Factor Verification */}
          {auth.pendingTotpProfileId && (
            <div className="space-y-5">
              <div>
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-[#293747]/60 border border-blue-100 dark:border-[#425A70] text-[#355F82] dark:text-[#88A9CC] flex items-center justify-center mb-3">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {auth.mfaNeedsEnrollment
                    ? t('Set Up Two-Factor Authentication', 'تفعيل المصادقة الثنائية')
                    : t('Two-Factor Verification', 'التحقق بخطوتين')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-[#A0A5AA] mt-1">
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
                <div className="p-4 rounded-xl border border-slate-200 dark:border-[#353A3F] bg-slate-50 dark:bg-[#1D2023] flex flex-col items-center gap-3">
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
                    className="block text-xs font-medium text-slate-700 dark:text-[#C0C5C9] mb-1.5"
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
                    className="w-full px-3.5 py-2.5 text-lg font-mono tabular-nums tracking-widest text-center rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-900 dark:text-white focus:outline-none focus:border-[#7196B9] focus:ring-2 focus:ring-[#88A9CC]/20"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#355F82] hover:bg-[#2D516F] disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
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
                    className="text-[#355F82] dark:text-[#88A9CC] hover:underline flex items-center gap-1 cursor-pointer"
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
          {isPasswordChangeRequired && (
            <div className="space-y-5">
              <div>
                <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-900 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('Create a New Password', 'تعيين كلمة مرور جديدة')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-[#A0A5AA] mt-1">
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
                    className="block text-xs font-medium text-slate-700 dark:text-[#C0C5C9] mb-1.5"
                  >
                    {t(
                      'New Password (8+ chars, upper, lower, number)',
                      'كلمة المرور الجديدة (8 أحرف، حرف كبير وصغير ورقم)'
                    )}
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
                      className="w-full ps-3.5 pe-10 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-900 dark:text-white focus:outline-none focus:border-[#7196B9] focus:ring-2 focus:ring-[#88A9CC]/20"
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
                    className="block text-xs font-medium text-slate-700 dark:text-[#C0C5C9] mb-1.5"
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
                      className="w-full ps-3.5 pe-10 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-900 dark:text-white focus:outline-none focus:border-[#7196B9] focus:ring-2 focus:ring-[#88A9CC]/20"
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
                  className="w-full py-2.5 px-4 rounded-lg bg-[#355F82] hover:bg-[#2D516F] disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
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

      </div>
    </div>
  );
};
