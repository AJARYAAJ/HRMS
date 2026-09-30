import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

test.describe.serial('Salary templates', () => {
  test('HR builds a salary template with a live breakup preview', async ({ page }) => {
    await loginAs(page, 'hr', '/payroll');
    await page.getByRole('tab', { name: 'Salary templates' }).click();
    await expect(page.getByTestId('structure-card').filter({ hasText: 'CTC incl. employer PF & gratuity' })).toBeVisible();
    await page.getByTestId('new-structure').click();
    const ed = page.getByTestId('structure-editor');
    await ed.getByLabel('Template name').fill('Consultants');
    await ed.getByLabel('Value 1').fill('60');
    await page.getByTestId('add-component').click();
    await ed.getByLabel('Component 3', { exact: true }).fill('Internet allowance');
    await ed.getByLabel('Value 3').fill('1000');
    await ed.getByLabel('Provident fund (12%)').uncheck();
    await page.getByLabel('Preview CTC').fill('600000');
    await expect(page.getByTestId('preview-gross')).toHaveText('₹50,000');
    await expect(page.getByTestId('structure-preview')).toContainText('Internet allowance');
    await expect(page.getByTestId('structure-preview')).not.toContainText('Provident fund');
    await page.getByTestId('save-structure').click();
    await expectToast(page, 'Salary template saved');
    await expect(page.getByTestId('structure-card').filter({ hasText: 'Consultants' })).toContainText('4 components');

    await page.getByTestId('assign-structure').click();
    const d = dialog(page, 'Assign Consultants');
    const who = d.getByLabel('Or one employee');
    await who.selectOption({ label: await who.locator('option', { hasText: 'Ananya Iyer' }).first().innerText() });
    await d.getByRole('button', { name: 'Assign' }).click();
    await expectToast(page, 'Salary template assigned');
    await expect(page.getByTestId('structure-card').filter({ hasText: 'Consultants' })).toContainText('1 assigned');
  });

  test('the employee sees their structure component by component', async ({ page }) => {
    await loginAs(page, 'employee', '/payslips');
    await expect(page.getByTestId('my-structure')).toContainText('Consultants');
    await expect(page.getByText('Internet allowance')).toBeVisible();
  });
});
