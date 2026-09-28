import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

const monthLabel = () => new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

test.describe.serial('Payroll', () => {
  test('HR runs payroll for the current month and marks it paid', async ({ page }) => {
    await loginAs(page, 'hr', '/payroll');
    await page.getByTestId('run-payroll').click();
    await page.getByTestId('confirm-run').click();
    // One run per legal entity (BeyondSure-style multi-company payroll).
    await expectToast(page, `Payroll processed for ${monthLabel()} · 2 companies`);
    const rows = page.getByTestId('table-row').filter({ hasText: monthLabel() });
    await expect(rows).toHaveCount(2);
    for (const company of ['Nimbus Technologies', 'Nimbus Digital']) {
      const row = rows.filter({ hasText: company });
      await expect(row).toContainText('Processed');
      await row.getByTestId('mark-paid').click();
      await page.getByRole('dialog', { name: 'Mark payroll as paid?' }).getByRole('button', { name: 'Mark paid' }).click();
      await expectToast(page, 'Payroll marked as paid');
      await expect(row).toContainText('Paid');
    }
  });

  test('HR inspects payslips for a run and revises a salary', async ({ page }) => {
    await loginAs(page, 'hr', '/payroll');
    await page.getByTestId('table-row').filter({ hasText: monthLabel() }).filter({ hasText: 'Nimbus Technologies' }).click();
    const drawer = page.getByRole('dialog', { name: `Payslips · ${monthLabel()} · Nimbus Technologies` });
    await expect(drawer.getByTestId('table-row').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Salary structures' }).click();
    await page.getByLabel('Search table').fill('Ananya');
    await expect(page.getByTestId('table-row')).toHaveCount(1);
    await page.getByTestId('table-row').first().getByRole('button', { name: 'Revise salary' }).click();
    const d = dialog(page, 'Revise salary · Ananya Iyer');
    await d.getByLabel('New annual CTC (₹)').fill('1500000');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Salary revised');
    await expect(page.getByTestId('table-row').first()).toContainText('15,00,000');
  });

  test('employee sees the published payslip with a printable breakdown', async ({ page }) => {
    await loginAs(page, 'employee', '/payslips');
    await expect(page.getByTestId('take-home')).toContainText('₹');
    await page.getByTestId('table-row').filter({ hasText: monthLabel() }).click();
    const slip = page.getByTestId('payslip');
    await expect(slip).toContainText('Ananya Iyer');
    await expect(slip).toContainText('Provident fund');
    await expect(page.getByTestId('net-pay')).toContainText('₹');
    await expect(slip).toContainText('Rupees');
  });

  test('employee submits a tax declaration and HR approves it', async ({ page }) => {
    await loginAs(page, 'employee', '/payslips');
    await page.getByTestId('add-declaration').click();
    const d = dialog(page, 'Investment declaration');
    await d.getByLabel('Section').selectOption('80CCD');
    await d.getByLabel('Amount (₹)').fill('50000');
    await d.getByLabel('Description').fill('NPS Tier 1 contribution');
    await d.getByRole('button', { name: 'Submit' }).click();
    await expectToast(page, 'Declaration submitted');

    await loginAs(page, 'hr', '/payroll');
    await page.getByRole('tab', { name: 'Tax declarations' }).click();
    const row = page.getByTestId('table-row').filter({ hasText: 'NPS Tier 1' });
    await row.getByRole('button', { name: 'Approve' }).click();
    await expectToast(page, 'Declaration approved');
    await expect(row).toContainText('Approved');
  });
});
