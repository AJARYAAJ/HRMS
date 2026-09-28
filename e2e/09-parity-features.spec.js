import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog, nextWeekday, apiToken, clearMailbox, waitForEmail } from './helpers';

/** Employee selects label options as "First Last · EMPxxx"; pick by name. */
async function pickEmployee(select, name) {
  const value = await select.locator('option', { hasText: name }).first().getAttribute('value');
  await select.selectOption(value);
}

// Features added for parity with Keka, Zoho People, We360 and BeyondSure.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

test.describe.serial('Approvals, attendance & leave depth', () => {
  test('two-level approval: salary advance goes manager → HR and is tracked on the employee side', async ({ page }) => {
    await loginAs(page, 'employee', '/payslips?tab=loans');
    await page.getByTestId('request-loan').click();
    const d = dialog(page, 'Request a loan or salary advance');
    await d.getByLabel('Type').selectOption('advance');
    await d.getByLabel('Amount (₹)').fill('20000');
    await d.getByLabel('Repay over (months)').fill('2');
    await d.getByLabel('Reason').fill('E2E laptop repair');
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, 'Request submitted for approval');

    await loginAs(page, 'manager', '/approvals');
    const item = page.getByTestId('approval-item').filter({ hasText: 'E2E laptop repair' });
    await expect(item).toContainText('2-step');
    await item.getByTestId('approve-btn').click();
    await expectToast(page, 'Loans approved — sent to HR for final approval');

    await loginAs(page, 'hr', '/approvals');
    const hrItem = page.getByTestId('approval-item').filter({ hasText: 'E2E laptop repair' });
    await expect(hrItem).toContainText('Manager approved');
    await hrItem.getByTestId('approve-btn').click();
    await expectToast(page, 'Loans request approved');

    await loginAs(page, 'employee', '/payslips?tab=loans');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Salary advance' }).filter({ hasText: '20,000' }).first()).toContainText('Approved');
  });

  test('work-from-home request is approved and the day is marked remote', async ({ page }) => {
    const day = nextWeekday(3);
    await loginAs(page, 'employee', '/attendance?tab=requests');
    await page.getByTestId('new-attendance-request').click();
    const d = dialog(page, 'New attendance request');
    await d.getByLabel('Request type').selectOption('wfh');
    await d.getByLabel(/^Date \*?$/).fill(day);
    await d.getByLabel('Reason').fill('E2E home internet install');
    await d.getByRole('button', { name: 'Submit' }).click();
    await expectToast(page, 'Request sent to your manager');

    await loginAs(page, 'manager', '/approvals');
    const item = page.getByTestId('approval-item').filter({ hasText: 'E2E home internet install' });
    await item.getByTestId('approve-btn').click();
    await expectToast(page, 'WFH / On-duty request approved');
    await loginAs(page, 'employee', '/attendance?tab=requests');
    await expect(page.getByTestId('table-row').filter({ hasText: 'E2E home internet install' })).toContainText('Approved');
  });

  test('optional holiday: employee picks one within the yearly quota', async ({ page }) => {
    await loginAs(page, 'employee', '/leave?tab=optional');
    const quota = page.getByTestId('optional-quota');
    await expect(quota).toContainText('Chosen: 0 of 2');
    const upcoming = page.getByTestId('optional-holiday').filter({ has: page.getByRole('button', { name: 'Take it' }) }).first();
    await upcoming.getByRole('button', { name: 'Take it' }).click();
    await expectToast(page, 'Optional holiday added');
    await expect(quota).toContainText('Chosen: 1 of 2');
  });

  test('manager edits the weekly shift roster', async ({ page }) => {
    await loginAs(page, 'hr', '/roster');
    const row = page.getByTestId('roster-row').first();
    await row.locator('select').nth(1).selectOption({ label: 'Week off' });
    await page.getByTestId('save-roster').click();
    await expectToast(page, 'Roster saved · 1 change(s)');
    await expect(row.locator('select').nth(1)).toHaveValue('off');
  });
});

test.describe.serial('Payroll depth', () => {
  test('tax planner compares regimes and the annual statement opens', async ({ page }) => {
    await loginAs(page, 'employee', '/payslips?tab=tax');
    await expect(page.getByTestId('regime-new')).toContainText('₹');
    await expect(page.getByTestId('regime-old')).toContainText('Taxable income');
    await page.getByTestId('choose-old').click();
    await expectToast(page, 'Switched to the old regime');
    await page.getByTestId('choose-new').click();
    await expectToast(page, 'Switched to the new regime');
    await page.getByTestId('open-tax-statement').click();
    await expect(page.getByTestId('tax-statement')).toBeVisible();
    await expect(page.getByTestId('total-tds')).toContainText('₹');
  });

  test('HR downloads the bank transfer file for a payroll run', async ({ page }) => {
    await loginAs(page, 'hr', '/payroll');
    const download = page.waitForEvent('download');
    await page.getByTestId('bank-file').first().click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
  });
});

test.describe.serial('HR documents', () => {
  test('HR generates an experience letter PDF that is emailed to the employee', async ({ page, request }) => {
    await clearMailbox(request);
    await loginAs(page, 'hr', '/employees');
    await page.getByLabel('Search table').fill('Ananya');
    await page.getByTestId('table-row').first().click();
    await page.getByTestId('generate-letter').click();
    const d = dialog(page, /Generate letter/);
    await d.getByLabel('Template', { exact: true }).selectOption({ label: 'Experience Letter' });
    await expect(d.getByTestId('letter-preview')).toContainText('Ananya Iyer');
    await d.getByTestId('confirm-generate').click();
    await expectToast(page, 'Letter generated and emailed as PDF');
    const mail = await waitForEmail(request, (m) => m.to.includes('employee@peoplehub.demo') && /letter/i.test(m.subject));
    expect(mail.body).toContain('application/pdf');
  });

  test('employee acknowledges a policy and HR sees the progress', async ({ page }) => {
    await loginAs(page, 'employee', '/documents');
    const card = page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' });
    await card.getByTestId('acknowledge-btn').click();
    await expectToast(page, 'Acknowledged: Employee Handbook');
    await expect(card).toContainText('Acknowledged');

    await loginAs(page, 'hr', '/documents');
    await expect(page.getByTestId('document-card').filter({ hasText: 'Employee Handbook' }).getByTestId('ack-progress')).toContainText('23/');
  });

  test('HR bulk-imports employees from CSV with validation first', async ({ page }) => {
    await loginAs(page, 'hr', '/employees');
    await page.getByTestId('import-employees').click();
    const csv = 'first_name,last_name,email,department,designation,date_of_joining,annual_ctc\nImport,Tester,import.tester@peoplehub.demo,Engineering,,2026-10-01,900000\nBad,Row,not-an-email,,,,\n';
    await page.getByTestId('import-drop-input').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByTestId('validate-import').click();
    const result = page.getByTestId('import-result');
    await expect(result).toContainText('1 valid');
    await expect(result).toContainText('1 with errors');
    await page.getByTestId('run-import').click();
    await expect(result).toContainText('1 created');
  });

  test('employee finds an answer in the knowledge base and HR ticket form suggests articles', async ({ page }) => {
    await loginAs(page, 'employee', '/helpdesk?tab=kb');
    await page.getByTestId('kb-search').fill('payslip');
    await page.getByTestId('kb-card').first().click();
    await expect(page.getByTestId('kb-article')).toBeVisible();
    await page.getByTestId('kb-helpful').click();
    await expectToast(page, 'Thanks for the feedback!');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Tickets' }).click();
    await page.getByTestId('new-ticket').click();
    await dialog(page, 'Raise a ticket').getByLabel('Subject').fill('My salary is not credited yet');
    await expect(page.getByTestId('kb-suggestions')).toBeVisible();
  });
});

test.describe.serial('Performance & engagement', () => {
  test('manager gives feedback and schedules a 1:1; employee sees both', async ({ page }) => {
    await loginAs(page, 'manager', '/performance?tab=feedback');
    await page.getByTestId('give-feedback').click();
    const d = dialog(page, 'Give feedback');
    await pickEmployee(d.getByLabel(/^To \*$/), 'Ananya Iyer');
    await d.getByLabel('Competency').selectOption('Ownership');
    await d.getByLabel('Feedback').fill('E2E: great ownership of the payroll migration');
    await d.getByRole('button', { name: 'Send feedback' }).click();
    await expectToast(page, 'Feedback sent');

    await page.getByRole('tab', { name: 'One-on-ones' }).click();
    await page.getByTestId('schedule-1on1').click();
    const m = dialog(page, 'Schedule a one-on-one');
    await pickEmployee(m.getByLabel('With'), 'Ananya Iyer');
    await m.getByLabel('When').fill(`${nextWeekday(2)}T11:00`);
    await m.getByLabel('Agenda').fill('E2E growth plan');
    await m.getByRole('button', { name: 'Schedule' }).click();
    await expectToast(page, 'One-on-one scheduled');

    await loginAs(page, 'employee', '/performance?tab=feedback');
    await expect(page.getByTestId('feedback-item').filter({ hasText: 'E2E: great ownership' })).toBeVisible();
    await page.getByRole('tab', { name: 'One-on-ones' }).click();
    await page.getByTestId('one-on-one').filter({ hasText: 'E2E growth plan' }).click();
    await page.getByLabel('Action items').fill('Draft the Q4 plan');
    await page.getByTestId('complete-1on1').click();
    await expectToast(page, 'Marked complete');
  });

  test('social feed: post, like and comment', async ({ page }) => {
    await loginAs(page, 'employee', '/engage?tab=feed');
    await page.getByTestId('post-body').fill('E2E: shipped the new onboarding flow 🚀');
    await page.getByTestId('publish-post').click();
    await expectToast(page, 'Posted');
    const post = page.getByTestId('post').filter({ hasText: 'E2E: shipped the new onboarding flow' });
    await post.getByTestId('like-post').click();
    await expect(post.getByTestId('like-post')).toHaveAttribute('aria-pressed', 'true');
    await post.getByLabel('Comment', { exact: true }).fill('Nice work!');
    await post.getByTestId('send-comment').click();
    await expect(post.getByTestId('comment').filter({ hasText: 'Nice work!' })).toBeVisible();
  });

  test('eNPS: employee answers anonymously and sees the score', async ({ page }) => {
    await loginAs(page, 'employee', '/engage?tab=polls');
    const survey = page.getByTestId('enps-survey').first();
    await survey.getByTestId('enps-9').click();
    await expectToast(page, 'your response is anonymous');
    await expect(survey.getByTestId('enps-9')).toHaveAttribute('aria-checked', 'true');
    await expect(survey.getByTestId('enps-score')).toBeVisible();
  });
});

test.describe.serial('Hiring', () => {
  test('a candidate applies on the public careers page; HR sends an offer letter', async ({ page, request }) => {
    await clearMailbox(request);
    await page.goto('/careers');
    await page.getByTestId('career-job').first().click();
    const form = page.getByTestId('apply-form');
    await form.getByLabel('Full name').fill('Careers Applicant');
    await form.getByLabel('Email').fill('careers.applicant@example.com');
    await form.getByLabel('Years of experience').fill('4');
    await page.getByTestId('resume-upload-input').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByTestId('submit-application').click();
    await expect(page.getByTestId('application-done')).toContainText('Application received');
    await waitForEmail(request, (m) => m.to.includes('careers.applicant@example.com'));

    await loginAs(page, 'hr', '/recruitment');
    await page.getByTestId('candidate-card').filter({ hasText: 'Careers Applicant' }).click();
    await expect(page.getByTestId('attachment').filter({ hasText: 'resume.pdf' })).toBeVisible();
    await page.getByTestId('send-offer').click();
    const d = dialog(page, /Offer letter/);
    await d.getByLabel('Offered annual CTC (₹)').fill('1800000');
    await d.getByRole('button', { name: 'Generate & email offer' }).click();
    await expectToast(page, 'Offer letter generated and emailed');
    const mail = await waitForEmail(request, (m) => m.to.includes('careers.applicant@example.com') && /Offer letter/.test(m.subject));
    expect(mail.body).toContain('application/pdf');
  });
});

test.describe.serial('Work management', () => {
  test('tasks board: create a task and move it to done', async ({ page }) => {
    await loginAs(page, 'employee', '/tasks');
    await page.getByTestId('new-task').click();
    const d = dialog(page, 'New task');
    await d.getByLabel('Title').fill('E2E write release notes');
    await d.getByLabel('Priority').selectOption('high');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Task created');
    await page.getByTestId('task-card').filter({ hasText: 'E2E write release notes' }).click();
    await page.getByTestId('task-status-done').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-status="done"]').getByTestId('task-card').filter({ hasText: 'E2E write release notes' })).toBeVisible();
  });

  test('travel request and the company calendar', async ({ page }) => {
    await loginAs(page, 'employee', '/travel');
    await page.getByTestId('new-travel').click();
    const d = dialog(page, 'New travel request');
    await d.getByLabel('Purpose').fill('E2E customer visit');
    await d.getByLabel(/^To \*$/).fill('Chennai');
    await d.getByLabel('Departure').fill(nextWeekday(5));
    await d.getByLabel('Estimated cost (₹)').fill('15000');
    await d.getByRole('button', { name: 'Submit for approval' }).click();
    await expectToast(page, 'Travel request submitted');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Chennai' })).toContainText('Pending');

    await page.goto('/calendar');
    await expect(page.getByTestId('company-calendar')).toBeVisible();
    await expect(page.getByTestId('calendar-day')).not.toHaveCount(0);
  });
});

test.describe.serial('Exit management', () => {
  test('HR prepares, approves and pays a full & final settlement', async ({ page }) => {
    await loginAs(page, 'hr', '/exit');
    await page.getByRole('tab', { name: 'F&F settlements' }).click();
    await page.getByTestId('new-fnf').click();
    const d = dialog(page, 'Full & final settlement');
    await d.getByLabel('Employee').selectOption({ index: 1 });
    await expect(d.getByTestId('fnf-net')).toContainText('₹');
    await d.getByTestId('save-fnf').click();
    await expectToast(page, 'Settlement saved as draft');
    await page.getByTestId('table-row').filter({ hasText: 'Draft' }).first().click();
    await page.getByTestId('approve-fnf').click();
    await expectToast(page, 'Settlement approved');
    await page.getByTestId('pay-fnf').click();
    await expectToast(page, 'Marked as paid');
  });

  test('employee resigns; manager and HR approve; employee completes the exit interview', async ({ page }) => {
    await loginAs(page, 'employee', '/exit');
    await page.getByTestId('resign-btn').click();
    const d = dialog(page, 'Submit resignation');
    await d.getByLabel('Primary reason').selectOption({ index: 1 });
    await d.getByRole('button', { name: 'Submit' }).click();
    await expectToast(page, 'Resignation submitted');

    await loginAs(page, 'manager', '/approvals');
    await page.getByTestId('approval-item').filter({ hasText: 'Ananya Iyer' }).filter({ hasText: /resign/i }).getByTestId('approve-btn').click();
    await expectToast(page, 'sent to HR for final approval');
    await loginAs(page, 'hr', '/approvals');
    await page.getByTestId('approval-item').filter({ hasText: 'Ananya Iyer' }).filter({ hasText: /resign/i }).getByTestId('approve-btn').click();
    await expectToast(page, 'Resignations request approved');

    await loginAs(page, 'employee', '/exit');
    await expect(page.getByTestId('confirmed-lwd')).not.toHaveText('—');
    const iv = page.getByTestId('exit-interview');
    await iv.getByLabel('Main reason for leaving').selectOption({ index: 1 });
    await iv.getByRole('button', { name: 'Culture: 4 stars' }).click();
    await page.getByTestId('submit-interview').click();
    await expectToast(page, 'Thank you for your feedback');
  });
});

test.describe.serial('Activity monitoring (We360-style)', () => {
  test('a registered agent reports activity that shows on the live board and timeline', async ({ page, request }) => {
    await loginAs(page, 'admin', '/productivity?tab=devices');
    await page.getByTestId('add-device').click();
    const d = dialog(page, 'Register a device');
    await d.getByLabel('Device name').fill('E2E laptop');
    await d.getByRole('button', { name: 'Create token' }).click();
    const token = (await page.getByTestId('device-token').innerText()).trim();
    expect(token).toMatch(/^phd_/);
    // One-line installers carry this server's address and the new token.
    await expect(page.getByTestId('install-cmd-windows')).toContainText(`$env:PEOPLEHUB_TOKEN='${token}'; irm http://localhost:4400/api/agent-downloads/install.ps1 | iex`);
    await expect(page.getByTestId('install-cmd-macos')).toContainText(`curl -fsSL http://localhost:4400/api/agent-downloads/install.sh | PEOPLEHUB_TOKEN='${token}' sh`);
    const setupFile = page.waitForEvent('download');
    await page.getByTestId('download-setup-file').click();
    const file = await setupFile;
    expect(file.suggestedFilename()).toBe('peoplehub-agent.json');
    const json = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
    expect(json).toMatchObject({ server: 'http://localhost:4400', token, device_name: 'E2E laptop' });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('agent-download')).toHaveCount(4);
    const installer = await request.get('/api/agent-downloads/install.sh');
    expect(await installer.text()).toContain('SERVER="http://localhost:4400"');

    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({ ts: new Date(now - (5 - i) * 60000).toISOString(), app: 'Visual Studio Code', title: 'E2E', active_seconds: 55, idle_seconds: 5 }));
    const res = await request.post('/api/agent/heartbeat', { headers: { Authorization: `Device ${token}` }, data: { events, agent: { version: '1.0.0', os: 'windows/amd64', hostname: 'E2E-PC' } } });
    expect(res.status()).toBe(202);

    await page.reload();
    await expect(page.getByTestId('table-row').filter({ hasText: 'E2E laptop' })).toContainText('v1.0.0');
    await expect(page.getByTestId('table-row').filter({ hasText: 'E2E laptop' })).toContainText('E2E-PC');
    await page.getByRole('tab', { name: 'Live' }).click();
    const row = page.getByTestId('table-row').filter({ hasText: 'Aarav Sharma' });
    await expect(row).toContainText('active');
    await expect(row).toContainText('Visual Studio Code');
    await row.click();
    await expect(page.getByTestId('activity-employee')).toHaveText('Aarav Sharma');
    await expect(page.getByTestId('hourly-chart')).toBeVisible();
    await expect(page.getByText('Visual Studio Code').first()).toBeVisible();

    // Revoked tokens are rejected.
    const admin = await apiToken(request, 'admin');
    const devices = await (await request.get('/api/activity/devices', { headers: { Authorization: `Bearer ${admin}` } })).json();
    const dev = devices.find((x) => x.name === 'E2E laptop');
    await request.delete(`/api/activity/devices/${dev.id}`, { headers: { Authorization: `Bearer ${admin}` } });
    const denied = await request.post('/api/agent/heartbeat', { headers: { Authorization: `Device ${token}` }, data: { events } });
    expect(denied.status()).toBe(401);
  });

  test('HR adds an app classification rule and reapplies it', async ({ page }) => {
    await loginAs(page, 'hr', '/productivity?tab=rules');
    await page.getByTestId('add-rule').click();
    const d = dialog(page, 'Add classification rule');
    await d.getByLabel('App name or website domain').fill('https://www.e2e-docs.example.com/page');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Rule added');
    await expect(page.getByTestId('table-row').filter({ hasText: 'e2e-docs.example.com' })).toBeVisible();
    await page.getByTestId('reapply-rules').click();
    await expectToast(page, 'Reclassified');
  });
});
