import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const pickOption = async (select, text) => select.selectOption({ label: await select.locator('option', { hasText: text }).first().innerText() });

let portalPath;

test.describe.serial('Pre-boarding and onboarding', () => {
  test('HR invites a new hire and gets their private link', async ({ page }) => {
    await loginAs(page, 'hr', '/onboarding?tab=preboarding');
    await expect(page.getByTestId('preboarding-table')).toContainText('Kabir Malhotra');
    await page.getByTestId('invite-hire').click();
    const d = dialog(page, 'Invite a new hire');
    await d.getByLabel('Full name').fill('Nikita Rao');
    await d.getByLabel('Personal email').fill('nikita.rao@example.com');
    await d.getByLabel(/^Joining date/).fill('2031-01-05');
    await d.getByLabel('Department').selectOption({ label: 'Engineering' });
    await pickOption(d.getByLabel('Onboarding buddy'), 'Ananya Iyer');
    await d.getByRole('button', { name: 'Send invite' }).click();
    await expectToast(page, 'Invite sent');
    const url = await page.getByTestId('portal-url').innerText();
    expect(url).toMatch(/\/join\/[A-Za-z0-9_-]{20,}$/);
    portalPath = new URL(url).pathname;
  });

  test('the new hire completes the portal without an account', async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(portalPath);
    await expect(page.getByTestId('join-welcome')).toContainText('Welcome aboard, Nikita!');
    await page.getByLabel('Date of birth').fill('1997-08-15');
    await page.getByLabel('Gender').selectOption('Female');
    await page.getByLabel('Mobile number').fill('+91 98000 12345');
    await page.getByLabel('Blood group').selectOption('O+');
    await page.getByLabel('Current address').fill('Koramangala, Bengaluru');
    await page.getByLabel('Emergency contact name').fill('Ravi Rao');
    await page.getByLabel('Relationship').fill('Father');
    await page.getByLabel('Emergency contact phone').fill('+91 98000 54321');
    await page.getByLabel('Bank name').fill('Axis Bank');
    await page.getByLabel('Account number').fill('918010012345678');
    await page.getByLabel('IFSC').fill('UTIB0000123');
    await page.getByLabel('PAN').fill('ABCPR1234N');
    await page.getByTestId('save-details').click();
    await expect(page.getByRole('status')).toContainText('Details saved');
    await page.getByTestId('upload-photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('doc-photo')).toContainText('Uploaded');
    for (const t of ['pan', 'aadhaar', 'education', 'bank_proof']) {
      await page.getByTestId(`upload-${t}`).setInputFiles({ name: `${t}.pdf`, mimeType: 'application/pdf', buffer: PDF });
      await expect(page.getByTestId(`doc-${t}`)).toContainText('Uploaded');
    }
    await page.getByLabel('Signature').fill('Nikita Rao');
    await page.getByTestId('sign-offer').click();
    await expect(page.getByTestId('offer-signed')).toBeVisible();
    await page.getByTestId('submit-preboarding').click();
    await expect(page.getByTestId('join-submitted')).toBeVisible();
    await expect(page.getByTestId('join-progress')).toContainText('100%');
    await page.close();
  });

  test('HR verifies the documents and converts the hire into an employee', async ({ page }) => {
    await loginAs(page, 'hr', '/onboarding?tab=preboarding');
    await page.getByTestId('table-row').filter({ hasText: 'Nikita Rao' }).click();
    const drawer = page.getByTestId('preboarding-drawer');
    await expect(drawer).toContainText('Submitted');
    await expect(page.getByTestId('convert-preboarding')).toBeDisabled();
    for (const t of ['photo', 'pan', 'aadhaar', 'education', 'bank_proof']) {
      await drawer.getByTestId(`pdoc-${t}`).getByTestId('verify-doc').click();
      await expect(drawer.getByTestId(`pdoc-${t}`)).toContainText('Verified');
    }
    await page.getByTestId('convert-preboarding').click();
    await expectToast(page, 'Employee created');
    await expect(page.getByTestId('preboarding-table').getByTestId('table-row').filter({ hasText: 'Nikita Rao' })).toContainText('Joined');
  });

  test('the new joiner signs in to “My onboarding” with their buddy and checklist', async ({ page }) => {
    const res = await page.request.post('/api/auth/login', { data: { email: 'nikita.rao@example.com', password: 'Welcome@123' } });
    expect(res.ok()).toBeTruthy();
    await page.goto('/login');
    await page.evaluate((a) => localStorage.setItem('auth', JSON.stringify(a)), await res.json());
    await page.goto('/onboarding');
    await expect(page.getByTestId('my-onboarding')).toContainText('Welcome, Nikita!');
    await expect(page.getByTestId('my-buddy')).toHaveText('Ananya Iyer');
    const task = page.getByTestId('my-task').filter({ hasText: 'Set up development environment' });
    await task.getByRole('button', { name: /Complete/ }).click();
    await expectToast(page, 'task done');
    await expect(page.getByTestId('my-onboarding')).toContainText('1/');
  });

  test('HR builds a checklist template for a department', async ({ page }) => {
    await loginAs(page, 'hr', '/onboarding?tab=templates');
    await expect(page.getByTestId('template-card').filter({ hasText: 'Engineering onboarding' })).toContainText('used for Engineering');
    await page.getByTestId('new-template').click();
    const m = page.getByRole('dialog', { name: 'New checklist template' });
    await m.getByLabel('Name').fill('Design onboarding');
    await m.getByLabel('Use automatically for').selectOption({ label: 'Design' });
    await m.getByLabel('Task 1', { exact: true }).fill('Figma licence and design system tour');
    await m.getByLabel('Owner 1').selectOption('IT');
    await m.getByTestId('add-template-task').click();
    await m.getByLabel('Task 2', { exact: true }).fill('Portfolio walkthrough with the team');
    await m.getByLabel('Owner 2').selectOption('Buddy');
    await m.getByLabel('Day 2').fill('3');
    await m.getByTestId('save-template').click();
    await expectToast(page, 'Template saved');
    await expect(page.getByTestId('template-card').filter({ hasText: 'Design onboarding' })).toContainText('2 tasks');
  });
});
