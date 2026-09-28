import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog } from './helpers';

test.describe.serial('Self-service & engagement', () => {
  test('expense claim is submitted and rejected by the manager with a reason', async ({ page }) => {
    await loginAs(page, 'employee', '/expenses');
    await page.getByTestId('new-expense').click();
    const d = dialog(page, 'New expense claim');
    await d.getByLabel('Category').selectOption('Travel');
    await d.getByLabel('Amount (₹)').fill('2450');
    await d.getByLabel('Description').fill('Airport cab for customer visit');
    await d.getByRole('button', { name: 'Submit claim' }).click();
    await expectToast(page, 'Expense claim submitted');

    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Expenses/ }).click();
    const item = page.getByTestId('approval-item').filter({ hasText: 'Airport cab' });
    await item.getByTestId('reject-btn').click();
    await page.getByLabel('Reason (shared with employee)').fill('Please attach the receipt');
    await page.getByTestId('confirm-reject').click();
    await expectToast(page, 'Expenses request rejected');

    await loginAs(page, 'employee', '/expenses');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Airport cab' })).toContainText('Rejected');
    // The employee is notified.
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByText('Your expense claim was rejected')).toBeVisible();
  });

  test('bulk approval of pending timesheets', async ({ page }) => {
    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Timesheets/ }).click();
    const items = page.getByTestId('approval-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    await items.nth(0).getByRole('checkbox').check();
    await items.nth(1).getByRole('checkbox').check();
    await page.getByTestId('bulk-approve').click();
    await expect(items).toHaveCount(count - 2);
  });

  test('employee logs timesheet hours', async ({ page }) => {
    await loginAs(page, 'employee', '/timesheets');
    await page.getByTestId('log-time').click();
    const d = dialog(page, 'Log time');
    await d.getByLabel('Project').selectOption({ label: 'Atlas Payments Platform' });
    await d.getByLabel('Hours').fill('6');
    await d.getByLabel('Task description').fill('Built reconciliation API');
    await d.getByRole('button', { name: 'Log time' }).click();
    await expectToast(page, 'Time logged');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Built reconciliation API' })).toBeVisible();
  });

  test('helpdesk ticket raised by employee is resolved by HR', async ({ page }) => {
    await loginAs(page, 'employee', '/helpdesk');
    await page.getByTestId('new-ticket').click();
    const d = dialog(page, 'Raise a ticket');
    await d.getByLabel('Category').selectOption('IT');
    await d.getByLabel('Subject').fill('Need access to staging database');
    await d.getByLabel('Describe the issue').fill('Read-only access for debugging payroll reports.');
    await d.getByRole('button', { name: 'Submit ticket' }).click();
    await expectToast(page, 'Ticket raised');

    await loginAs(page, 'hr', '/helpdesk');
    await page.getByTestId('table-row').filter({ hasText: 'staging database' }).click();
    await page.getByLabel('Resolution note').fill('Access granted via IAM group db-readers.');
    await page.getByRole('button', { name: 'Resolve ticket' }).click();
    await expectToast(page, 'Ticket resolved');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('table-row').filter({ hasText: 'staging database' })).toContainText('Resolved');
  });

  test('announcements, kudos and polls on the engagement hub', async ({ page }) => {
    await loginAs(page, 'hr', '/engage');
    await page.getByTestId('new-announcement').click();
    const d = dialog(page, 'New announcement');
    await d.getByLabel('Title').fill('Townhall on Friday');
    await d.getByLabel('Message').fill('Join us at 4 PM in the cafeteria.');
    await d.getByRole('button', { name: 'Publish' }).click();
    await expectToast(page, 'Announcement published');

    await loginAs(page, 'employee', '/engage');
    await expect(page.getByTestId('announcement').filter({ hasText: 'Townhall on Friday' })).toBeVisible();
    await page.getByRole('tab', { name: 'Kudos wall' }).click();
    await page.getByTestId('give-kudos').click();
    const k = dialog(page, 'Appreciate a colleague 🎉');
    await k.getByLabel('Colleague').selectOption({ label: 'Rohan Mehta · EMP1003' });
    await k.getByLabel('Message').fill('Thanks for unblocking the release!');
    await k.getByRole('button', { name: 'Send kudos' }).click();
    await expectToast(page, 'Kudos sent');
    await expect(page.getByTestId('kudos-card').filter({ hasText: 'unblocking the release' })).toBeVisible();

    await page.getByRole('tab', { name: 'Polls' }).click();
    const poll = page.getByTestId('poll').first();
    await poll.getByRole('button').first().click();
    await expectToast(page, 'Vote recorded');
    await expect(poll).toContainText('%');
  });

  test('learning: enroll, progress and complete a course', async ({ page }) => {
    await loginAs(page, 'employee', '/learning');
    const course = page.getByTestId('course-card').filter({ hasText: 'Effective Communication' });
    await course.getByRole('button', { name: 'Enroll' }).click();
    await expectToast(page, 'Enrolled');
    for (let i = 1; i <= 4; i++) {
      await course.getByRole('button', { name: /learning/ }).click();
      if (i < 4) await expect(course).toContainText(`${i * 25}%`);
    }
    await expect(course.getByText('Completed', { exact: true })).toBeVisible();
  });

  test('documents, assets and notifications are available to employees', async ({ page }) => {
    await loginAs(page, 'employee');
    await nav(page, 'Documents');
    await expect(page.getByText('Leave Policy', { exact: true })).toBeVisible();
    await expect(page.getByText('Offer Letter', { exact: true })).toBeVisible();
    await nav(page, 'Assets');
    await expect(page.getByTestId('table-row').first()).toContainText('AST-');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.getByTestId('notif-count')).toHaveCount(0);
  });
});
