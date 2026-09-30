import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog, clearMailbox, waitForEmail } from './helpers';

// Professional services: clients → opportunities → projects → resources → invoicing and collections.
test.describe.serial('Professional services (PSA)', () => {
  test('manager adds a client with a billing contact', async ({ page }) => {
    await loginAs(page, 'manager', '/clients');
    await page.getByTestId('new-client').click();
    const d = dialog(page, 'New client');
    await d.getByLabel('Client name').fill('Orbit Systems');
    await d.getByLabel('Industry').fill('SaaS');
    await d.getByLabel('Billing email').fill('ap@orbit.example');
    await d.getByLabel('GSTIN').fill('29ABCDE1234F1Z5');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Client added');
    await page.getByTestId('table-row').filter({ hasText: 'Orbit Systems' }).click();
    const drawer = page.getByTestId('client-drawer');
    await drawer.getByTestId('add-contact').click();
    const c = dialog(page, /Add contact/);
    await c.getByLabel(/^Name/).fill('Ira Sen');
    await c.getByLabel('Email').fill('ira@orbit.example');
    await c.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Contact added');
    await expect(drawer.getByTestId('client-contact')).toContainText('Ira Sen');
  });

  test('a won opportunity is converted into a project', async ({ page }) => {
    await loginAs(page, 'manager', '/opportunities');
    await expect(page.getByTestId('pipeline-summary')).toContainText('Open pipeline');
    await page.getByTestId('new-opportunity').click();
    const d = dialog(page, 'New opportunity');
    await d.getByLabel('Opportunity').fill('Orbit analytics rollout');
    await d.getByLabel('Or new prospect organisation').fill('Orbit Systems');
    await d.getByLabel('Deal value (₹)').fill('900000');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Opportunity added');
    await page.getByTestId('opportunity-card').filter({ hasText: 'Orbit analytics rollout' }).click();
    const drawer = page.getByTestId('opportunity-drawer');
    await drawer.getByTestId('stage-proposal').click();
    await expectToast(page, 'Moved to Proposal');
    await drawer.getByTestId('stage-won').click();
    await expectToast(page, 'Moved to Won');
    await drawer.getByTestId('convert-opportunity').click();
    await expectToast(page, 'Project created from the won deal');
    await expect(page.getByTestId('project-title')).toHaveText('Orbit analytics rollout');
  });

  test('project team rates and a resource allocation', async ({ page }) => {
    await loginAs(page, 'manager', '/projects');
    await page.getByTestId('table-row').filter({ hasText: 'Orbit analytics rollout' }).click();
    await page.getByRole('tab', { name: /Team/ }).click();
    await page.getByLabel('Bill rate of Rohan Mehta').fill('3200');
    await page.getByTestId('save-team').click();
    await expectToast(page, 'Team saved');

    await page.goto('/resources');
    await expect(page.getByTestId('resource-planner')).toBeVisible();
    await page.getByRole('tab', { name: 'Allocations' }).click();
    await page.getByTestId('new-allocation').click();
    const d = dialog(page, 'Allocate a person to a project');
    const person = d.getByLabel('Person');
    await person.selectOption(await person.locator('option', { hasText: 'Ananya Iyer' }).first().getAttribute('value'));
    const project = d.getByLabel(/^Project/);
    await project.selectOption({ label: 'Orbit analytics rollout' });
    await d.getByLabel('Allocation (%)').fill('50');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Allocation saved');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Orbit analytics rollout' })).toContainText('50%');
    await page.getByRole('tab', { name: 'Utilisation' }).click();
    await expect(page.getByTestId('table-row').first()).toBeVisible();
  });

  test('HR invoices approved time, sends it with a PDF, and records payment until paid', async ({ page, request }) => {
    await clearMailbox(request);
    await loginAs(page, 'hr', '/finance');
    await expect(page.getByTestId('finance-summary')).toContainText('Receivables');
    await expect(page.getByTestId('revenue-chart')).toBeVisible();
    await page.getByRole('tab', { name: 'Invoices' }).click();
    await page.getByTestId('new-invoice').click();
    const d = dialog(page, 'New invoice');
    await d.getByLabel('Project').selectOption({ label: 'Retail Mobile App' });
    await expect(d.getByTestId('billable-preview')).toContainText('Subtotal');
    await d.getByTestId('create-invoice').click();
    await expectToast(page, 'Draft invoice created');
    const drawer = page.getByTestId('invoice-drawer');
    await expect(drawer.getByTestId('invoice-lines')).toContainText('professional services');
    const pdf = page.waitForEvent('download');
    await drawer.getByTestId('invoice-pdf').click();
    expect((await pdf).suggestedFilename()).toMatch(/^INV-\d{4}-\d{4}\.pdf$/);
    await drawer.getByTestId('send-invoice').click();
    await expectToast(page, 'Invoice sent to the client');
    const mail = await waitForEmail(request, (m) => m.to.includes('accounts@shopkart.example') && /Invoice INV-/.test(m.subject));
    expect(mail.body).toContain('application/pdf');
    await drawer.getByTestId('record-payment').click();
    const p = dialog(page, /Record payment/);
    await p.getByLabel('Reference / UTR').fill('UTR998877');
    await p.getByRole('button', { name: 'Record' }).click();
    await expectToast(page, 'Payment recorded');
    await expect(drawer).toContainText('Paid');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await page.getByRole('tab', { name: 'Project P&L' }).click();
    await expect(page).toHaveURL(/tab=pnl/);
    await expect(page.getByTestId('table-row').filter({ hasText: 'Retail Mobile App' })).toBeVisible();
  });

  test('employees see projects but not clients or finance', async ({ page }) => {
    await loginAs(page, 'employee', '/projects');
    await expect(page.getByTestId('table-row').first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Clients', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Finance', exact: true })).toHaveCount(0);
  });
});
