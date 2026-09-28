import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

test.describe.serial('Recruitment & performance', () => {
  const candidate = `Kiran Test ${Date.now() % 10000}`;

  test('HR publishes a job opening', async ({ page }) => {
    await loginAs(page, 'hr', '/recruitment');
    await page.getByRole('tab', { name: 'Job openings' }).click();
    await page.getByTestId('new-job').click();
    const d = dialog(page, 'New job opening');
    await d.getByLabel('Job title').fill('Staff Platform Engineer');
    await d.getByLabel('Department').selectOption({ label: 'Engineering' });
    await d.getByLabel('Location').selectOption({ label: 'Bengaluru HQ' });
    await d.getByLabel('Experience').fill('8+ years');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Job opening published');
    await expect(page.getByTestId('job-card').filter({ hasText: 'Staff Platform Engineer' })).toBeVisible();
  });

  test('candidate moves through the pipeline, gets an interview and is hired', async ({ page }) => {
    await loginAs(page, 'hr', '/recruitment');
    await page.getByTestId('add-candidate').click();
    const d = dialog(page, 'Add candidate');
    await d.getByLabel('Full name').fill(candidate);
    await d.getByLabel('Job').selectOption({ label: 'Staff Platform Engineer' });
    await d.getByLabel('Email').fill(`kiran${Date.now()}@mail.test`);
    await d.getByLabel('Expected CTC (₹)').fill('4500000');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Candidate added');

    const applied = page.locator('[data-stage="applied"]');
    await applied.getByTestId('candidate-card').filter({ hasText: candidate }).click();
    const drawer = page.getByRole('dialog', { name: candidate });
    await drawer.getByRole('button', { name: 'Screening', exact: true }).click();
    await expectToast(page, 'Moved to screening');
    await expect(page.locator('[data-stage="screening"]').getByTestId('candidate-card').filter({ hasText: candidate })).toBeVisible();

    await drawer.getByTestId('schedule-interview').click();
    const s = dialog(page, 'Schedule interview');
    await s.getByLabel('Interviewer').selectOption({ label: 'Rohan Mehta · EMP1003' });
    await s.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Interview scheduled');
    await expect(page.locator('[data-stage="interview"]').getByTestId('candidate-card').filter({ hasText: candidate })).toBeVisible();

    await drawer.getByTestId('hire-candidate').click();
    await dialog(page, `Hire ${candidate}`).getByRole('button', { name: 'Hire' }).click();
    await expectToast(page, 'Hired!');
    await expect(page.getByTestId('profile-name')).toHaveText(candidate);
  });

  test('drag and drop moves a candidate between stages', async ({ page }) => {
    await loginAs(page, 'hr', '/recruitment');
    const card = page.locator('[data-stage="applied"]').getByTestId('candidate-card').first();
    const name = (await card.locator('.font-semibold').first().innerText()).trim();
    // Dispatch real DragEvents with a shared DataTransfer (headless native drag emulation is non-deterministic).
    const target = page.locator('[data-stage="offer"]');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent('dragstart', { dataTransfer: dt });
    await target.dispatchEvent('dragenter', { dataTransfer: dt });
    await target.dispatchEvent('dragover', { dataTransfer: dt });
    await target.dispatchEvent('drop', { dataTransfer: dt });
    await card.dispatchEvent('dragend', { dataTransfer: dt });
    await expect(page.locator('[data-stage="offer"]').getByTestId('candidate-card').filter({ hasText: name })).toBeVisible();
  });

  test('employee creates a goal and updates progress', async ({ page }) => {
    await loginAs(page, 'employee', '/performance');
    await page.getByTestId('add-goal').click();
    const d = dialog(page, 'New goal');
    await d.getByLabel('Goal').fill('Ship the leave analytics dashboard');
    await d.getByLabel('Progress (%)').fill('40');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Goal created');
    const card = page.getByTestId('goal-card').filter({ hasText: 'Ship the leave analytics dashboard' });
    await expect(card).toContainText('40%');
  });

  test('self review → manager review completes the cycle', async ({ page }) => {
    await loginAs(page, 'employee', '/performance');
    await page.getByRole('tab', { name: 'Reviews' }).click();
    await page.getByTestId('table-row').filter({ hasText: 'Self Review' }).first().click();
    await page.getByRole('button', { name: '4 stars' }).first().click();
    await page.getByLabel('Self comments').fill('Delivered payroll automation and mentored two interns.');
    await page.getByTestId('submit-review').click();
    await expectToast(page, 'Review submitted');

    await loginAs(page, 'manager', '/performance');
    await page.getByRole('tab', { name: 'Reviews' }).click();
    await page.getByLabel('Search table').fill('Ananya');
    await expect(page.getByTestId('table-row').first()).toContainText('Ananya');
    await page.getByTestId('table-row').filter({ hasText: 'Manager Review' }).first().click();
    await page.getByRole('button', { name: '5 stars' }).last().click();
    await page.getByLabel('Strengths').fill('Ownership and craftsmanship');
    await page.getByLabel('Improvements').fill('Delegate more');
    await page.getByTestId('submit-review').click();
    await expectToast(page, 'Review submitted');
    await expect(page.getByTestId('table-row').filter({ hasText: 'Ananya' }).first()).toContainText('Completed');
  });
});
