import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog, clearMailbox, waitForEmail, mailbox } from './helpers';

// Small but real files: the server checks magic bytes, so these must be genuine formats.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

test.describe.serial('File uploads', () => {
  test('employee uploads a KYC document, previews it and downloads it', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    await page.getByTestId('upload-document').click();
    const d = dialog(page, 'Upload a document');
    await d.getByLabel('Title').fill('Aadhaar card');
    await d.getByTestId('file-drop-input').setInputFiles({ name: 'aadhaar.png', mimeType: 'image/png', buffer: PNG });
    await expect(d.getByTestId('file-drop-selected')).toContainText('aadhaar.png');
    await d.getByRole('button', { name: 'Upload' }).click();
    await expectToast(page, 'Document uploaded');

    const card = page.getByTestId('document-card').filter({ hasText: 'Aadhaar card' });
    await expect(card).toContainText('PNG');
    await card.getByRole('button', { name: 'Preview Aadhaar card' }).click();
    await expect(page.getByTestId('file-preview').locator('img')).toBeVisible();
    await page.keyboard.press('Escape');

    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download Aadhaar card' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('aadhaar.png');
  });

  test('company policy PDFs open in the in-app viewer', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    await page.getByTestId('document-card').filter({ hasText: 'Leave Policy' }).getByRole('button', { name: 'Preview Leave Policy' }).click();
    await expect(page.getByTestId('file-preview').locator('iframe')).toBeVisible();
  });

  test('unsupported file types are rejected before upload', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    await page.getByTestId('upload-document').click();
    const d = dialog(page, 'Upload a document');
    await d.getByTestId('file-drop-input').setInputFiles({ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(d.getByRole('alert')).toContainText('Unsupported file type');
    await expect(d.getByTestId('file-drop-selected')).toHaveCount(0);
  });

  test('expense claim with receipt: the manager views the receipt from approvals', async ({ page }) => {
    await loginAs(page, 'employee', '/expenses');
    await page.getByTestId('new-expense').click();
    const d = dialog(page, 'New expense claim');
    await d.getByLabel('Category').selectOption('Client Entertainment');
    await d.getByLabel('Amount (₹)').fill('3200');
    await d.getByLabel('Description').fill('Dinner with ShopKart team');
    await d.getByTestId('receipt-drop-input').setInputFiles({ name: 'dinner-bill.pdf', mimeType: 'application/pdf', buffer: PDF });
    await d.getByRole('button', { name: 'Submit claim' }).click();
    await expectToast(page, 'Expense claim submitted with receipt');
    const row = page.getByTestId('table-row').filter({ hasText: 'Dinner with ShopKart' });
    await expect(row.getByTestId('receipt-indicator')).toHaveText('1');

    // The employee can add another receipt while the claim is pending.
    await row.click();
    await page.getByTestId('attachment-input').setInputFiles({ name: 'parking.png', mimeType: 'image/png', buffer: PNG });
    await expectToast(page, 'parking.png uploaded');
    await expect(page.getByTestId('attachment')).toHaveCount(2);

    await loginAs(page, 'manager', '/approvals');
    await page.getByRole('tab', { name: /Expenses/ }).click();
    await page.getByTestId('approval-item').filter({ hasText: 'Dinner with ShopKart' }).getByTestId('view-receipt').click();
    const receipts = page.getByRole('dialog', { name: /Receipts/ });
    await expect(receipts.getByTestId('attachment')).toHaveCount(2);
    await receipts.getByRole('button', { name: 'Preview dinner-bill.pdf' }).click();
    await expect(page.getByTestId('file-preview').locator('iframe')).toBeVisible();
  });

  test('helpdesk: a ticket with a screenshot, and HR replies with a file', async ({ page }) => {
    await loginAs(page, 'employee', '/helpdesk');
    await page.getByTestId('new-ticket').click();
    const d = dialog(page, 'Raise a ticket');
    await d.getByLabel('Category').selectOption('IT');
    await d.getByLabel('Subject').fill('Monitor flickering');
    await d.getByLabel('Describe the issue').fill('External monitor flickers every few seconds.');
    await d.getByTestId('ticket-drop-input').setInputFiles({ name: 'flicker.png', mimeType: 'image/png', buffer: PNG });
    await d.getByRole('button', { name: 'Submit ticket' }).click();
    await expectToast(page, 'Ticket raised');

    await loginAs(page, 'hr', '/helpdesk');
    await page.getByTestId('table-row').filter({ hasText: 'Monitor flickering' }).click();
    const drawer = page.getByRole('dialog', { name: /Ticket #/ });
    await expect(drawer.getByTestId('attachment').filter({ hasText: 'flicker.png' })).toBeVisible();
    await drawer.getByTestId('attachment-input').setInputFiles({ name: 'driver-update-steps.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(drawer.getByTestId('attachment')).toHaveCount(2);
  });

  test('recruitment: candidate added with a resume', async ({ page }) => {
    await loginAs(page, 'hr', '/recruitment');
    await page.getByTestId('add-candidate').click();
    const d = dialog(page, 'Add candidate');
    await d.getByLabel('Full name').fill('Resume Tester');
    await d.getByLabel('Job').selectOption({ index: 1 });
    await d.getByLabel('Email').fill('resume.tester@mail.test');
    await d.getByTestId('resume-drop-input').setInputFiles({ name: 'resume-tester.pdf', mimeType: 'application/pdf', buffer: PDF });
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Candidate added with resume');
    await page.getByTestId('candidate-card').filter({ hasText: 'Resume Tester' }).click();
    await expect(page.getByRole('dialog', { name: 'Resume Tester' }).getByTestId('attachment')).toContainText('resume-tester.pdf');
  });
});

test.describe.serial('Email notifications', () => {
  const email = `neha.email.${Date.now()}@peoplehub.demo`;

  test('a new employee receives a welcome email over SMTP', async ({ page, request }) => {
    await clearMailbox(request);
    await loginAs(page, 'hr', '/employees');
    await page.getByTestId('add-employee').click();
    const d = dialog(page, 'Add new employee');
    await d.getByLabel('First name').fill('Neha');
    await d.getByLabel('Last name').fill('Email');
    await d.getByLabel('Work email').fill(email);
    await d.getByRole('button', { name: 'Create employee' }).click();
    await expectToast(page, 'Employee created');
    const mail = await waitForEmail(request, (m) => m.to.includes(email));
    expect(mail.subject).toBe('Welcome to the team, Neha!');
    expect(mail.body).toContain('Welcome@123');
    expect(mail.body).toContain('/login');
  });

  test('leave approval emails the employee and the approval request emails the manager', async ({ page, request }) => {
    await clearMailbox(request);
    const auth = await loginAs(page, 'employee');
    const types = await (await page.request.get('/api/leave/types', { headers: { Authorization: `Bearer ${auth.token}` } })).json();
    const res = await page.request.post('/api/leave/requests', {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { leave_type_id: types.find((t) => t.code === 'SL').id, start_date: '2027-02-10', end_date: '2027-02-10', reason: 'Dentist' },
    });
    expect(res.ok()).toBeTruthy();
    await waitForEmail(request, (m) => m.to.includes('manager@peoplehub.demo') && m.subject.includes('Leave request awaiting approval'));

    await loginAs(page, 'manager', '/approvals');
    await page.getByTestId('approval-item').filter({ hasText: 'Dentist' }).getByTestId('approve-btn').click();
    await expectToast(page, 'Leave request approved');
    const mail = await waitForEmail(request, (m) => m.to.includes('employee@peoplehub.demo') && m.subject === 'Your leave request was approved');
    expect(mail.body).toContain('/leave');
  });

  test('admins see the email log with delivery status and a rendered preview, and can send a test email', async ({ page, request }) => {
    await loginAs(page, 'admin', '/settings');
    await page.getByRole('tab', { name: 'Email' }).click();
    await expect(page.getByTestId('email-status')).toContainText('Delivering via SMTP');
    const log = page.getByTestId('email-log');
    const welcome = log.getByTestId('table-row').filter({ hasText: 'Welcome to the team, Neha!' });
    await expect(welcome).toContainText('Sent');
    await welcome.click();
    const preview = page.getByTestId('email-preview');
    await expect(preview).toContainText(email);
    await expect(preview.frameLocator('iframe').getByText('Your PeopleHub account is ready')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Verify connection' }).click();
    await expect(page.getByTestId('smtp-verify')).toContainText('Connection verified');

    await clearMailbox(request);
    await page.getByLabel('Send a test email').fill('it-ops@peoplehub.demo');
    await page.getByTestId('send-test-email').click();
    await expectToast(page, 'Test email delivered to it-ops@peoplehub.demo');
    const mail = await waitForEmail(request, (m) => m.to.includes('it-ops@peoplehub.demo'));
    expect(mail.subject).toBe('PeopleHub test email');
  });

  test('forgot password: the emailed link resets the password', async ({ page, request }) => {
    await clearMailbox(request);
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    const d = dialog(page, 'Reset your password');
    await d.getByLabel('Work email').fill(email);
    await d.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByTestId('reset-sent')).toContainText('reset link is on its way');

    const mail = await waitForEmail(request, (m) => m.to.includes(email) && m.subject === 'Reset your PeopleHub password');
    const link = mail.body.match(/https?:\/\/[^\s"<>]+\/reset-password\?token=[\w-]+/)[0];
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await page.getByLabel('New password').fill('Fresh@Start2026');
    await page.getByLabel('Confirm password').fill('Fresh@Start2026');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByTestId('reset-done')).toBeVisible();
    await waitForEmail(request, (m) => m.to.includes(email) && m.subject === 'Your PeopleHub password was changed');

    // The link is single-use.
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await page.getByLabel('New password').fill('Another@2026x');
    await page.getByLabel('Confirm password').fill('Another@2026x');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('alert')).toContainText('invalid or has expired');

    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Fresh@Start2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('greeting')).toContainText('Neha');
  });

  test('turning email notifications off stops notification emails', async ({ page, request }) => {
    await loginAs(page, 'employee', '/profile');
    const toggle = page.getByTestId('email-pref');
    await expect(toggle).toBeChecked();
    await toggle.uncheck({ force: true });
    await expectToast(page, 'Email notifications off');

    await clearMailbox(request);
    await loginAs(page, 'manager', '/engage?kudos=1');
    const k = dialog(page, 'Appreciate a colleague 🎉');
    await k.getByLabel('Colleague').selectOption({ label: 'Ananya Iyer · EMP1004' });
    await k.getByLabel('Message').fill('Quiet kudos');
    await k.getByRole('button', { name: 'Send kudos' }).click();
    await expectToast(page, 'Kudos sent');
    await page.waitForTimeout(1500); // longer than the mail worker interval
    expect((await mailbox(request)).filter((m) => m.to.includes('employee@peoplehub.demo'))).toHaveLength(0);

    await loginAs(page, 'employee', '/profile');
    await page.getByTestId('email-pref').check({ force: true });
    await expectToast(page, 'Email notifications on');
  });
});
