import { test, expect } from '@playwright/test';
import { loginAs, nav, USERS } from './helpers';

test.describe('Authentication & SPA shell', () => {
  test('rejects invalid credentials and signs in through the form', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Work email').fill(USERS.admin);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');

    await page.getByLabel('Password', { exact: true }).fill('Password@123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('greeting')).toContainText('Aarav');
  });

  test('demo quick-login works for every role and sign out clears the session', async ({ page }) => {
    for (const [role, name] of [['hr', 'Priya'], ['manager', 'Rohan'], ['employee', 'Ananya']]) {
      await page.goto('/login');
      await page.getByTestId(`demo-${role}`).click();
      await expect(page.getByTestId('greeting')).toContainText(name);
      await page.getByTestId('user-menu').click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('navigation is a true SPA: no document reloads between modules', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.evaluate(() => { window.__spaMarker = 'still-here'; });
    let documentLoads = 0;
    page.on('request', (r) => { if (r.resourceType() === 'document') documentLoads++; });
    for (const label of ['Employees', 'Attendance', 'Leave', 'Payroll', 'Recruitment', 'Reports', 'Dashboard']) {
      await nav(page, label);
      await expect(page.locator('main h1').first()).toBeVisible();
    }
    expect(await page.evaluate(() => window.__spaMarker)).toBe('still-here');
    expect(documentLoads).toBe(0);
    // Browser history works inside the SPA.
    await page.goBack();
    await expect(page).toHaveURL(/\/reports$/);
  });

  test('shows skeleton placeholders while data loads', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.route('**/api/employees?*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    await page.route('**/api/employees', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    await nav(page, 'Employees');
    await expect(page.getByTestId('skeleton').first()).toBeVisible();
    await expect(page.getByTestId('table-row').first()).toBeVisible({ timeout: 10_000 });
  });

  test('role-based access blocks restricted modules', async ({ page }) => {
    await loginAs(page, 'employee');
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(sidebar.getByRole('link', { name: 'Payroll', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
    await page.goto('/payroll');
    await expect(page.getByText('Access restricted')).toBeVisible();
    const res = await page.request.get('/api/payroll/runs', { headers: { Authorization: `Bearer ${(await page.evaluate(() => JSON.parse(localStorage.auth).token))}` } });
    expect(res.status()).toBe(403);
  });

  test('command palette searches people and navigates', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.keyboard.press('Control+k');
    await page.getByLabel('Command search').fill('Ananya');
    await page.getByTestId('palette-item').filter({ hasText: 'Ananya Iyer' }).click();
    await expect(page.getByTestId('profile-name')).toHaveText('Ananya Iyer');
  });

  test('dark mode toggles and persists across reloads', async ({ page }) => {
    await loginAs(page, 'employee');
    const html = page.locator('html');
    const wasDark = await html.evaluate((el) => el.classList.contains('dark'));
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/);
    await page.reload();
    expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(!wasDark);
    await page.getByTestId('theme-toggle').click();
  });
});
