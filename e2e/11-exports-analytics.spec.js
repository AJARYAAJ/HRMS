import { test, expect } from '@playwright/test';
import { loginAs, expectToast, nav } from './helpers';

test.describe('Bulk export and analytics', () => {
  test('HR exports filtered employees to Excel and sees it in history', async ({ page }) => {
    await loginAs(page, 'hr', '/');
    await nav(page, 'Bulk export');
    await page.getByTestId('export-employees').click();
    const panel = page.getByTestId('export-panel');
    await panel.getByLabel('Status').selectOption('active');
    await panel.getByTestId('export-columns').getByRole('button', { name: 'PAN', exact: true }).click();
    const download = page.waitForEvent('download');
    await panel.getByTestId('run-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^employees-\d{4}-\d{2}-\d{2}\.xlsx$/);
    await expectToast(page, 'Exported');
    await expect(page.getByTestId('table-row').first()).toContainText('Employees');
  });

  test('HR exports timesheets as CSV', async ({ page }) => {
    await loginAs(page, 'hr', '/exports');
    await page.getByTestId('export-timesheets').click();
    await page.getByRole('radio', { name: 'CSV' }).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('run-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('HR sees people, delivery and money analytics', async ({ page }) => {
    await loginAs(page, 'hr', '/');
    await nav(page, 'Analytics');
    await expect(page.getByTestId('analytics-kpis')).toContainText('Headcount');
    await expect(page.getByTestId('analytics-kpis')).toContainText('Revenue');
    for (const id of ['chart-headcount', 'chart-movement', 'chart-attendance', 'chart-utilisation', 'chart-money', 'chart-departments', 'chart-pipeline']) {
      await expect(page.getByTestId(id).locator('.recharts-surface').first()).toBeVisible();
    }
    await page.getByRole('radio', { name: '12 months' }).click();
    await expect(page.getByRole('radio', { name: '12 months' })).toHaveAttribute('aria-checked', 'true');
  });

  test('managers see analytics without money; employees have neither page', async ({ page }) => {
    await loginAs(page, 'manager', '/analytics');
    await expect(page.getByTestId('analytics-kpis')).toContainText('Headcount');
    await expect(page.getByTestId('analytics-kpis')).not.toContainText('Revenue');
    await expect(page.getByTestId('chart-money')).toHaveCount(0);
    await loginAs(page, 'employee', '/');
    const navEl = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(navEl.getByRole('link', { name: 'Analytics', exact: true })).toHaveCount(0);
    await expect(navEl.getByRole('link', { name: 'Bulk export', exact: true })).toHaveCount(0);
  });
});
