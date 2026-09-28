import { expect } from '@playwright/test';

export const USERS = {
  admin: 'admin@peoplehub.demo',
  hr: 'hr@peoplehub.demo',
  manager: 'manager@peoplehub.demo',
  employee: 'employee@peoplehub.demo',
};
export const PASSWORD = 'Password@123';

/** Fast login: authenticate through the API and seed the persisted Redux auth state. */
export async function loginAs(page, role, path = '/') {
  const res = await page.request.post('/api/auth/login', { data: { email: USERS[role], password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const auth = await res.json();
  await page.goto('/login');
  await page.evaluate((a) => localStorage.setItem('auth', JSON.stringify(a)), auth);
  await page.goto(path);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  return auth;
}

export async function apiToken(request, role) {
  const res = await request.post('/api/auth/login', { data: { email: USERS[role], password: PASSWORD } });
  return (await res.json()).token;
}

/** Client-side navigation through the sidebar (no full page load). */
export async function nav(page, label) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label, exact: true }).click();
}

export async function expectToast(page, text) {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

export function dialog(page, name) {
  return page.getByRole('dialog', { name });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Company holidays from the seed data, so generated leave dates are always working days.
const HOLIDAYS = new Set(['2026-01-01', '2026-01-26', '2026-03-04', '2026-04-03', '2026-05-01', '2026-08-15', '2026-08-28',
  '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-09', '2026-11-24', '2026-12-25', '2027-01-01', '2027-01-26']);
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Next working day (not a weekend or company holiday) at least `offset` days ahead, as YYYY-MM-DD. */
export function nextWeekday(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0 || d.getDay() === 6 || HOLIDAYS.has(fmt(d))) d.setDate(d.getDate() + 1);
  return fmt(d);
}

// ---------- mailbox (real SMTP capture started by e2e/support/server.js) ----------
const MAILBOX = 'http://localhost:4401/messages';

export async function clearMailbox(request) {
  await request.delete(MAILBOX);
}

/** Wait until an email matching `predicate` arrives over SMTP, then return it. */
export async function waitForEmail(request, predicate, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const messages = await (await request.get(MAILBOX)).json();
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Expected email did not arrive');
}

export async function mailbox(request) {
  return (await request.get(MAILBOX)).json();
}
