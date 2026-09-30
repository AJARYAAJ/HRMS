import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog, apiToken } from './helpers';

// Keka-style policies: plans are created and edited by HR, assigned to people, and enforced in self-service.
test.describe.serial('Policies & settings', () => {
  test('HR reviews the default leave plan and tightens a rule', async ({ page }) => {
    await loginAs(page, 'hr', '/');
    await nav(page, 'Policies');
    const detail = page.getByTestId('plan-detail');
    await expect(detail).toContainText('Standard leave plan');
    const cl = page.getByTestId('rule-row').filter({ hasText: 'Casual Leave' });
    await expect(cl).toContainText('Yearly (upfront)');
    await cl.getByRole('button', { name: 'Edit Casual Leave' }).click();
    const d = dialog(page, 'Edit Casual Leave');
    await d.getByLabel('Max consecutive days').fill('4');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Rule updated');
    await expect(cl.locator('td').nth(5)).toHaveText('4');
  });

  test('a new plan is copied, assigned to an employee and shown on their leave page', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=leave');
    await page.getByTestId('new-leave').click();
    const d = dialog(page, 'New leave plan');
    await d.getByLabel(/^Name/).fill('Engineering leave plan');
    await d.getByLabel('Start from').selectOption({ label: 'Copy of Standard leave plan' });
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Leave plan created');
    await expect(page.getByTestId('plan-detail')).toContainText('Engineering leave plan');
    await expect(page.getByTestId('rule-row').filter({ hasText: 'Earned Leave' })).toContainText('Yearly (upfront)');

    await page.getByRole('tab', { name: 'Assign to employees' }).click();
    const table = page.getByTestId('assignments-table');
    await table.getByPlaceholder('Search…').fill('Ananya');
    await table.getByRole('checkbox', { name: 'Select Ananya Iyer' }).check();
    await page.getByLabel('Assign', { exact: true }).selectOption({ label: 'Engineering leave plan' });
    await page.getByTestId('assign-policy').click();
    await expectToast(page, 'Updated 1 employee(s)');
    await expect(table.getByTestId('table-row').filter({ hasText: 'Ananya Iyer' })).toContainText('Engineering leave plan');

    await loginAs(page, 'employee', '/leave');
    await expect(page.getByTestId('leave-plan')).toContainText('Engineering leave plan');
  });

  test('weekly-off pattern: alternate Saturdays', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=weekly_off');
    await page.getByTestId('plan-card').filter({ hasText: 'Sunday + 2nd & 4th Saturday' }).click();
    await expect(page.getByTestId('pattern-summary')).toHaveText('Sunday, 2nd & 4th Saturday');
    await page.getByLabel('Saturday rule').selectOption('some');
    await page.getByTestId('weekly-grid').getByRole('button', { name: '1st' }).click();
    await expect(page.getByTestId('pattern-summary')).toHaveText('Sunday, 1st & 2nd & 4th Saturday');
    await page.getByTestId('save-pattern').click();
    await expectToast(page, 'Weekly offs saved');
  });

  test('holiday lists: a state list with its own holidays and offices', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=holiday');
    await page.getByTestId('plan-card').filter({ hasText: 'India – Maharashtra' }).click();
    const detail = page.getByTestId('plan-detail');
    await expect(detail).toContainText('Mumbai Office');
    await expect(page.getByTestId('list-holidays')).toContainText('Gudi Padwa');
    await page.getByTestId('add-list-holiday').click();
    const d = dialog(page, /Add holiday to India – Maharashtra/);
    await d.getByLabel(/^Holiday/).fill('Company foundation day');
    await d.getByLabel(/^Date/).fill(`${new Date().getFullYear()}-12-18`);
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Holiday added');
    await expect(page.getByTestId('list-holidays')).toContainText('Company foundation day');
    // Bengaluru employees don't get Maharashtra holidays.
    await loginAs(page, 'employee', '/leave?tab=holidays');
    await expect(page.getByTestId('holiday-list-name')).toContainText('India – Karnataka');
    await expect(page.getByText('Company foundation day')).toHaveCount(0);
  });

  test('expense policy: mileage claims are priced by distance and limits are shown', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=expense');
    await expect(page.getByTestId('category-row').filter({ hasText: 'Local conveyance' })).toContainText('/ km');

    await loginAs(page, 'employee', '/expenses');
    await page.getByTestId('new-expense').click();
    const d = dialog(page, 'New expense claim');
    await expect(d.getByTestId('expense-policy')).toContainText('Standard expense policy');
    await d.getByLabel('Category').selectOption('Local conveyance');
    await expect(d.getByLabel('Amount (₹)')).toHaveCount(0);
    await d.getByLabel(/^Distance/).fill('18');
    await expect(d.getByText('Claim: ₹216.00')).toBeVisible();
    await d.getByLabel(/^Description/).fill('Client site visit (E2E)');
    await d.getByRole('button', { name: 'Submit claim' }).click();
    await expectToast(page, 'Expense claim submitted');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Client site visit (E2E)' })).toContainText('₹216');

    await page.getByTestId('new-expense').click();
    const d2 = dialog(page, 'New expense claim');
    await d2.getByLabel('Category').selectOption('Client Entertainment');
    await expect(d2.getByText(/up to ₹5,000 a claim · receipt required/)).toBeVisible();
  });

  test('attendance policy: field sales staff cannot clock in from the office', async ({ page, request }) => {
    const token = await apiToken(request, 'hr');
    const rows = await (await request.get('/api/policies/assignments', { headers: { Authorization: `Bearer ${token}` } })).json();
    const sales = rows.find((r) => r.effective.attendance?.name === 'Field sales');
    const emp = await (await request.get(`/api/employees/${sales.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const res = await request.post('/api/auth/login', { data: { email: emp.email, password: 'Password@123' } });
    const auth = await res.json();
    await page.goto('/login');
    await page.evaluate((a) => localStorage.setItem('auth', JSON.stringify(a)), auth);
    await page.goto('/attendance');
    const widget = page.getByTestId('clock-widget');
    await expect(widget.getByRole('button', { name: 'Field' })).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Office' })).toHaveCount(0);

    await loginAs(page, 'hr', '/policies?tab=attendance');
    await page.getByTestId('plan-card').filter({ hasText: 'Field sales' }).click();
    await expect(page.getByTestId('attendance-rules')).toContainText('Remote, Field');
  });

  test('late-mark penalties are calculated for a month and can be waived', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=penalties');
    await page.getByTestId('run-penalties').click();
    await expectToast(page, 'Penalties calculated');
    const rows = page.getByTestId('penalties-table').getByTestId('table-row');
    await expect(rows.first()).toBeVisible();
    const first = rows.first();
    await first.getByTestId('waive').click();
    const d = dialog(page, /Waive penalty/);
    await d.getByLabel(/^Reason/).fill('Metro disruption');
    await d.getByRole('button', { name: 'Waive' }).click();
    await expectToast(page, 'Penalty waived');
    await expect(page.getByTestId('penalties-table')).toContainText('Waived');
  });
});
