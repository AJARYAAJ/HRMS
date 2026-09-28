import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog } from './helpers';

test.describe.serial('Administration & insights', () => {
  test('organization setup: add, edit and delete a department', async ({ page }) => {
    await loginAs(page, 'admin', '/organization');
    await page.getByRole('tab', { name: 'Departments' }).click();
    await page.getByTestId('add-departments').click();
    let d = dialog(page, 'Add department');
    await d.getByLabel('Name').fill('Legal');
    await d.getByLabel('Code').fill('LGL');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'department added');
    const row = page.getByTestId('table-row').filter({ hasText: 'Legal' });
    await row.getByRole('button', { name: 'Edit department' }).click();
    d = dialog(page, 'Edit department');
    await d.getByLabel('Description').fill('Contracts and compliance');
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('Contracts and compliance');
    await row.getByRole('button', { name: 'Delete department' }).click();
    await page.getByRole('dialog', { name: 'Delete department?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('admin updates company settings and adds a leave type', async ({ page }) => {
    await loginAs(page, 'admin', '/settings');
    await page.getByLabel('Salary credit day').fill('30');
    await page.getByTestId('save-settings').click();
    await expectToast(page, 'Company settings saved');
    await page.getByRole('tab', { name: 'Leave policy' }).click();
    await page.getByTestId('add-leave/types').click();
    const d = dialog(page, 'Add leave type');
    await d.getByLabel('Name').fill('Paternity Leave');
    await d.getByLabel('Code').fill('PTL');
    await d.getByLabel('Annual quota (days)').fill('10');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'leave type added');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Paternity Leave' })).toBeVisible();
  });

  test('HR offboards an employee and the exit checklist is created', async ({ page }) => {
    await loginAs(page, 'hr', '/employees');
    await page.getByLabel('Search table').fill('Meera');
    await expect(page.getByTestId('table-row')).toHaveCount(1);
    await page.getByTestId('table-row').first().click();
    await page.getByRole('button', { name: 'Offboard' }).click();
    await page.getByRole('dialog', { name: /Offboard/ }).getByRole('button', { name: 'Start offboarding' }).click();
    await expectToast(page, 'Offboarding initiated');
    await nav(page, 'On/Offboarding');
    await page.getByRole('tab', { name: 'Offboarding' }).click();
    await expect(page.getByTestId('checklist').filter({ hasText: 'Meera Kapoor' })).toContainText('Recover laptop');
  });

  test('reports render charts and tables for every tab', async ({ page }) => {
    await loginAs(page, 'hr', '/reports');
    await expect(page.getByText('Headcount trend (12 months)')).toBeVisible();
    await expect(page.locator('.recharts-surface').first()).toBeVisible();
    for (const tab of ['Attendance', 'Leave', 'Payroll', 'Recruitment']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.locator('main').getByText(/./).first()).toBeVisible();
    }
    await expect(page.getByText('Hiring funnel')).toBeVisible();
  });

  test('productivity analytics show scores per employee', async ({ page }) => {
    await loginAs(page, 'manager', '/productivity');
    await expect(page.getByText('Productivity score')).toBeVisible();
    await expect(page.getByTestId('table-row').first()).toContainText('%');
    await page.getByLabel('Date range').selectOption('14');
    await expect(page.getByTestId('table-row').first()).toBeVisible();
  });

  test('audit log records sensitive actions', async ({ page }) => {
    await loginAs(page, 'admin', '/audit-log');
    await page.getByLabel('Entity filter').selectOption('payroll_runs');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Run Payroll' }).first()).toBeVisible();
    await expect(page.getByTestId('table-row').filter({ hasText: 'Pay Payroll' }).first()).toBeVisible();
    await page.getByLabel('Entity filter').selectOption('employees');
    await expect(page.getByTestId('table-row').first()).toContainText('Employees');
  });

  test('dashboard KPIs and widgets load for HR', async ({ page }) => {
    await loginAs(page, 'hr');
    await expect(page.getByText('Active employees')).toBeVisible();
    await expect(page.getByTestId('attendance-chart')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Celebrations' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming holidays' })).toBeVisible();
  });

  test('works on a mobile viewport with the slide-out menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'employee');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Leave', exact: true }).click();
    await expect(page.locator('main h1')).toHaveText('Leave');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});
