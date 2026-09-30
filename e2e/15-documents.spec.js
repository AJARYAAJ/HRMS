import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

test.describe.serial('Documents: folders, audience, checklist, bulk letters and e-sign', () => {
  test('employees see policies in folders and only those meant for them', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    await expect(page.getByTestId('folder').filter({ hasText: 'HR policies' })).toContainText('Employee Handbook');
    await expect(page.getByText('Sales Incentive Plan FY27')).toHaveCount(0);
    await loginAs(page, 'hr', '/documents');
    await expect(page.getByTestId('document-card').filter({ hasText: 'Sales Incentive Plan FY27' })).toContainText('Department only');
  });

  test('employee uploads a missing checklist document and HR verifies it', async ({ page }) => {
    await loginAs(page, 'employee', '/documents?tab=checklist');
    const aadhaar = page.getByTestId('checklist-item').filter({ hasText: 'Aadhaar card' });
    await expect(aadhaar).toContainText('Missing');
    await expect(page.getByTestId('checklist-item').filter({ hasText: 'Passport' })).toContainText('Expires soon');
    await aadhaar.getByRole('button', { name: 'Upload' }).click();
    await page.getByTestId('checklist-drop-input').setInputFiles({ name: 'aadhaar.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByTestId('checklist-submit').click();
    await expectToast(page, 'HR will verify it');
    await expect(aadhaar).toContainText('Awaiting verification');

    await loginAs(page, 'hr', '/documents?tab=compliance');
    const item = page.getByTestId('verify-item').filter({ hasText: 'Aadhaar card · Ananya Iyer' });
    await item.getByTestId('verify-document').click();
    await expectToast(page, 'Aadhaar card verified');
    await expect(item).toHaveCount(0);
  });

  test('HR issues letters in bulk and the employee signs electronically', async ({ page }) => {
    await loginAs(page, 'hr', '/documents?tab=requests');
    await page.getByTestId('bulk-letters').click();
    const d = dialog(page, 'Generate letters in bulk');
    await d.getByLabel(/^Template/).selectOption({ label: 'Confirmation Letter' });
    const who = d.getByLabel('Or one employee');
    await who.selectOption({ label: await who.locator('option', { hasText: 'Ananya Iyer' }).first().innerText() });
    await d.getByLabel('Employees must sign electronically').check();
    await d.getByLabel('Email each letter as a PDF').uncheck();
    await d.getByRole('button', { name: 'Generate' }).click();
    await expectToast(page, '1 letter(s) generated');

    await loginAs(page, 'employee', '/documents');
    const card = page.getByTestId('document-card').filter({ hasText: 'Confirmation Letter' }).first();
    await expect(card).toContainText('Signature needed');
    await card.getByTestId('sign-document').click();
    await page.getByLabel('Signature').fill('Ananya Iyer');
    await page.getByTestId('confirm-sign').click();
    await expectToast(page, 'Signed');
    await expect(card).toContainText('Signed');
  });

  test('a new policy version asks everyone to acknowledge again', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    const handbook = page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' });
    if (await handbook.getByTestId('acknowledge-btn').count()) {
      await handbook.getByTestId('acknowledge-btn').click();
      await expectToast(page, 'Acknowledged');
    }
    await expect(handbook.getByTestId('ack-required')).toHaveCount(0);

    await loginAs(page, 'hr', '/documents');
    const hrCard = page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' });
    await hrCard.getByTestId('new-version').click();
    await page.getByTestId('version-drop-input').setInputFiles({ name: 'handbook-v2.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByLabel('Ask everyone to acknowledge again').check();
    await page.getByTestId('upload-version').click();
    await expectToast(page, 'New version uploaded');
    await expect(hrCard).toContainText('v2');

    await loginAs(page, 'employee', '/documents');
    await expect(page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' }).getByTestId('ack-required')).toBeVisible();
    await page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' }).getByRole('button', { name: 'Versions of Employee Handbook' }).click();
    await expect(page.getByTestId('versions')).toContainText('handbook-v2.pdf');
  });
});
