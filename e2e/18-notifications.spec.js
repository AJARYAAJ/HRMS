import { test, expect } from '@playwright/test';
import { loginAs, apiToken } from './helpers';

test.describe('Notifications: bell, live alerts and browser push', () => {
  // Headless Chromium always reports "denied"; behave like a browser that has not been asked yet.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default' }));
  });
  test('a new notification pops up while the user is on the site and counts in the tab title', async ({ page, request }) => {
    const auth = await loginAs(page, 'employee', '/');
    await expect(page).toHaveTitle(/^\(\d+\) /); // unread count in the browser tab
    const before = Number(await page.getByTestId('notif-count').innerText());
    const token = await apiToken(request, 'hr');
    const res = await request.post('/api/people/feedback', { headers: { Authorization: `Bearer ${token}` }, data: { to_id: auth.user.id, message: 'Great job on the release this week!' } });
    expect(res.ok()).toBeTruthy();
    const toast = page.getByRole('status').filter({ hasText: 'shared feedback with you' });
    await expect(toast).toBeVisible({ timeout: 30_000 });
    await expect(toast).toContainText('Great job on the release this week!');
    await expect(page.getByTestId('notif-count')).toHaveText(String(before + 1));
    await toast.getByRole('button', { name: 'View' }).click();
    await expect(page).toHaveURL(/\/performance\?tab=feedback/);
  });

  test('the bell offers notifications outside the site; "Not now" is remembered', async ({ page }) => {
    await loginAs(page, 'manager', '/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    const prompt = page.getByTestId('push-prompt');
    await expect(prompt).toContainText('Get notified outside PeopleHub');
    await expect(prompt.getByTestId('push-enable')).toBeVisible();
    await prompt.getByRole('button', { name: 'Not now' }).click();
    await expect(prompt).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByText('Mark all read')).toBeVisible();
    await expect(page.getByTestId('push-prompt')).toBeHidden();
  });

  test('profile lists browser and phone notification settings', async ({ page }) => {
    await loginAs(page, 'manager', '/profile');
    const card = page.getByTestId('push-settings');
    await expect(card).toContainText('Browser & phone notifications');
    await expect(card.getByTestId('push-enable-profile')).toBeVisible();
  });
});
