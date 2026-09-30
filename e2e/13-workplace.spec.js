import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe.serial('ID cards and assets', () => {
  test('employee adds a photo to their ID card and the QR link verifies them publicly', async ({ page, context }) => {
    await loginAs(page, 'employee', '/');
    await nav(page, 'ID card');
    await expect(page.getByTestId('id-card').locator('img')).toBeVisible();
    await page.getByTestId('photo-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expectToast(page, 'Photo updated');
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('download-png').click();
    expect((await download).suggestedFilename()).toMatch(/^id-card-EMP\d+\.png$/);

    const url = await page.getByTestId('verify-url').innerText();
    const pub = await context.browser().newPage(); // no session: the verification page is public
    await pub.goto(new URL(url).pathname);
    await expect(pub.getByTestId('verify-result')).toContainText('Verified employee');
    await expect(pub.getByTestId('verify-name')).toHaveText('Ananya Iyer');
    await expect(pub.getByTestId('verify-status')).toHaveText('Current employee');
    await pub.goto('/verify/1-AAAAAAAAAAAAAAAA');
    await expect(pub.getByTestId('verify-result')).toContainText('Not verified');
    await pub.close();
  });

  test('HR batch-prints ID cards for a department', async ({ page }) => {
    await loginAs(page, 'hr', '/id-card?tab=batch');
    await page.getByLabel('Department').selectOption({ label: 'Engineering' });
    await page.getByTestId('load-cards').click();
    await expect(page.getByTestId('batch-cards').locator('img').first()).toBeVisible();
    await expect(page.getByTestId('print-all')).toContainText('Print');
  });

  test('employee acknowledges receipt of their laptop', async ({ page }) => {
    await loginAs(page, 'employee', '/assets');
    const row = page.getByTestId('table-row').filter({ hasText: 'Laptop' }).first();
    await expect(row).toContainText('Pending');
    await row.click();
    await page.getByTestId('acknowledge-asset').click();
    await expectToast(page, 'receipt acknowledged');
    await expect(page.getByTestId('asset-history')).toContainText('Receipt acknowledged');
  });

  test('an asset request goes manager → HR and is fulfilled from inventory', async ({ page }) => {
    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Assets/ }).click();
    await page.getByTestId('approval-item').filter({ hasText: 'Second screen' }).getByTestId('approve-btn').click();
    await expectToast(page, 'approved');

    await loginAs(page, 'hr', '/approvals');
    await page.getByRole('tab', { name: /Assets/ }).click();
    await page.getByTestId('approval-item').filter({ hasText: 'Second screen' }).getByTestId('approve-btn').click();
    await expectToast(page, 'approved');

    await page.goto('/assets');
    await page.getByTestId('add-asset').or(page.getByRole('button', { name: 'Add asset' })).click();
    const d = dialog(page, 'Add asset');
    await d.getByLabel(/^Asset tag/).fill('AST-9001');
    await d.getByLabel(/^Name/).fill('Dell U2723QE');
    await d.getByLabel('Category').selectOption('Monitor');
    await d.getByLabel('Cost (₹)').fill('42000');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Asset added');
    await page.getByPlaceholder('Search…').fill('AST-9001');
    await page.getByTestId('table-row').filter({ hasText: 'AST-9001' }).click();
    await page.getByTestId('assign-asset').click();
    const a = dialog(page, 'Assign AST-9001');
    const who = a.getByRole('combobox', { name: /^Employee/ });
    await who.selectOption({ label: await who.locator('option', { hasText: 'Ananya Iyer' }).first().innerText() });
    await a.getByLabel('Fulfils request').selectOption({ label: 'Ananya Iyer · Monitor' });
    await a.getByRole('button', { name: 'Assign' }).click();
    await expectToast(page, 'Asset assigned');

    await loginAs(page, 'employee', '/assets?tab=requests');
    await expect(page.getByTestId('asset-requests').getByTestId('table-row').filter({ hasText: 'Second screen' })).toContainText('Fulfilled · AST-9001');
  });

  test('HR records a damaged return and the asset goes to repair', async ({ page }) => {
    await loginAs(page, 'hr', '/assets');
    await page.getByPlaceholder('Search…').fill('AST-9001');
    await page.getByTestId('table-row').filter({ hasText: 'AST-9001' }).click();
    await page.getByTestId('return-asset').click();
    const d = dialog(page, /Return AST-9001/);
    await d.getByLabel('Condition on return').selectOption('damaged');
    await d.getByLabel('Note').fill('Dead pixels');
    await d.getByRole('button', { name: 'Record return' }).click();
    await expectToast(page, 'Return recorded');
    await expect(page.getByTestId('asset-drawer')).toContainText('In Repair');
    await expect(page.getByTestId('asset-history')).toContainText('Dead pixels');
  });
});
