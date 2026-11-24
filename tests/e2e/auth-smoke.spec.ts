import { test, expect } from '@playwright/test';

/** Only send the short-lived Vercel Trusted Sources token to the preview origin.
 * Never attach it to the Supabase API or any unrelated third-party host.
 */
test.beforeEach(async ({ page }) => {
  const base = process.env.BASE_URL;
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (!base || !token) return;
  const origin = new URL(base).origin;
  await page.route(`${origin}/**`, async route => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-trusted-oidc-idp-token': token,
      },
    });
  });
});

test('guest receives the sign-in form instead of any role dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-identifier')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  await expect(page.locator('.cits-loading-screen')).toHaveCount(0);
  await expect(page.locator('form').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('empty credentials are rejected locally without network login', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-identifier')).toBeVisible();
  let authRequests = 0;
  page.on('request', request => {
    if (/auth\/v1\/token|\/functions\/v1\/auth-login/.test(request.url())) authRequests += 1;
  });
  await page.locator('form').first().locator('button[type=submit]').click();
  await expect(page.getByText(/Please enter both your username|يرجى إدخال اسم المستخدم/)).toBeVisible();
  expect(authRequests).toBe(0);
});

test('Arabic RTL navigation and masked password toggle work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login-identifier')).toBeVisible();
  await page.getByRole('button', { name: 'Switch Language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#login-identifier')).toHaveAttribute('placeholder', /أدخل/);
  await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'تغيير اللغة' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('mobile sign-in controls are accessible without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('#login-identifier')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  const clipped = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(clipped).toBe(false);
});
