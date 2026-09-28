import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog, nextWeekday, today } from './helpers';

test.describe.serial('Attendance & leave workflows', () => {
  test('employee clocks in and out from the dashboard widget', async ({ page }) => {
    await loginAs(page, 'employee');
    const widget = page.getByTestId('clock-widget');
    await expect(widget.getByTestId('clock-in')).toBeVisible();
    await widget.getByRole('button', { name: 'Remote' }).click();
    await widget.getByTestId('clock-in').click();
    await expectToast(page, 'Clocked in successfully');
    await expect(widget.getByTestId('clock-clock-in')).not.toHaveText('--:--');
    await widget.getByTestId('clock-out').click();
    await expectToast(page, 'Clocked out');
    await expect(widget.getByText('Day complete')).toBeVisible();

    await nav(page, 'Attendance');
    await expect(page.getByTestId('attendance-calendar')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Monthly calendar' })).toBeVisible();
  });

  test('employee submits a regularization and the manager approves it', async ({ page }) => {
    await loginAs(page, 'employee', '/attendance');
    await page.getByTestId('regularize-btn').click();
    const d = dialog(page, 'Attendance regularization');
    await d.getByLabel('Reason').selectOption('Client visit');
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, 'Regularization submitted');
    await expect(page.getByText('Client visit').first()).toBeVisible();

    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Attendance/ }).click();
    const item = page.getByTestId('approval-item').filter({ hasText: 'Ananya Iyer' }).filter({ hasText: 'Client visit' });
    await item.getByTestId('approve-btn').click();
    await expectToast(page, 'Attendance request approved');
    await expect(item).toHaveCount(0);
  });

  test('employee applies for leave; balance shows pending; manager approves', async ({ page }) => {
    const start = nextWeekday(40);
    await loginAs(page, 'employee', '/leave');
    const before = Number(await page.getByTestId('balance-CL').innerText());
    await page.getByTestId('apply-leave').click();
    const d = dialog(page, 'Apply for leave');
    await d.getByLabel('Leave type').selectOption({ label: 'Casual Leave' });
    await d.getByLabel('From').fill(start);
    await d.getByLabel('To').fill(start);
    await d.getByLabel('Reason').fill('Attending a friend\'s wedding');
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, 'Leave request submitted');
    await expect(page.getByTestId('balance-CL')).toHaveText(String(before - 1));
    await expect(page.getByTestId('table-row').filter({ hasText: 'friend' })).toContainText('Pending');

    await loginAs(page, 'manager', '/approvals');
    const item = page.getByTestId('approval-item').filter({ hasText: 'friend' });
    await item.getByTestId('approve-btn').click();
    await expectToast(page, 'Leave request approved');

    await loginAs(page, 'employee', '/leave');
    await expect(page.getByTestId('table-row').filter({ hasText: 'friend' })).toContainText('Approved');
    await expect(page.getByTestId('balance-CL')).toHaveText(String(before - 1));
  });

  test('overlapping and over-balance leave requests are rejected with clear errors', async ({ page }) => {
    const start = nextWeekday(40);
    await loginAs(page, 'employee', '/leave');
    await page.getByTestId('apply-leave').click();
    let d = dialog(page, 'Apply for leave');
    await d.getByLabel('Leave type').selectOption({ label: 'Casual Leave' });
    await d.getByLabel('From').fill(start);
    await d.getByLabel('To').fill(start);
    await d.getByLabel('Reason').fill('Duplicate');
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, 'overlapping');
    await d.getByRole('button', { name: 'Cancel' }).click();

    await page.getByTestId('apply-leave').click();
    d = dialog(page, 'Apply for leave');
    await d.getByLabel('Leave type').selectOption({ label: 'Comp Off' });
    await d.getByLabel('From').fill(nextWeekday(60));
    await d.getByLabel('To').fill(nextWeekday(75));
    await d.getByLabel('Reason').fill('Too long');
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, 'Insufficient Comp Off balance');
  });

  test('employee cancels an approved leave and the balance is restored', async ({ page }) => {
    await loginAs(page, 'employee', '/leave');
    const before = Number(await page.getByTestId('balance-CL').innerText());
    await page.getByTestId('table-row').filter({ hasText: 'friend' }).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog', { name: 'Cancel leave request?' }).getByRole('button', { name: 'Cancel leave' }).click();
    await expectToast(page, 'Leave cancelled');
    await expect(page.getByTestId('balance-CL')).toHaveText(String(before + 1));
  });

  test('manager rejects a leave with a reason', async ({ page }) => {
    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Leave/ }).click();
    const item = page.getByTestId('approval-item').first();
    const who = await item.locator('span.font-semibold').first().innerText();
    await item.getByTestId('reject-btn').click();
    await page.getByLabel('Reason (shared with employee)').fill('Release week — please reschedule');
    await page.getByTestId('confirm-reject').click();
    await expectToast(page, 'Leave request rejected');
    expect(who.length).toBeGreaterThan(0);
  });

  test('team attendance view and calendars render for managers', async ({ page }) => {
    await loginAs(page, 'manager', '/attendance?tab=team');
    await expect(page.getByTestId('table-row').first()).toBeVisible();
    await page.getByRole('link', { name: 'Leave', exact: true }).click();
    await page.getByRole('tab', { name: 'Team calendar' }).click();
    await expect(page.getByText("Who's on leave")).toBeVisible();
    await page.getByRole('tab', { name: 'Holidays' }).click();
    await expect(page.getByText('Gandhi Jayanti')).toBeVisible();
    expect(today()).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
