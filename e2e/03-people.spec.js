import { test, expect } from '@playwright/test';
import { loginAs, nav, expectToast, dialog } from './helpers';

test.describe.serial('Core HR: employees, org chart, onboarding', () => {
  const email = `meera.kapoor.${Date.now()}@peoplehub.demo`;

  test('HR adds a new employee and lands on their profile', async ({ page }) => {
    await loginAs(page, 'hr', '/employees');
    await page.getByTestId('add-employee').click();
    const d = dialog(page, 'Add new employee');
    await d.getByLabel('First name').fill('Meera');
    await d.getByLabel('Last name').fill('Kapoor');
    await d.getByLabel('Work email').fill(email);
    await d.getByLabel('Department').selectOption({ label: 'Engineering' });
    await d.getByLabel('Designation').selectOption({ label: 'Software Engineer' });
    await d.getByLabel('Reporting manager').selectOption({ label: 'Rohan Mehta · EMP1003' });
    await d.getByLabel('Annual CTC (₹)').fill('1200000');
    await d.getByRole('button', { name: 'Create employee' }).click();
    await expectToast(page, 'Employee created');
    await expect(page.getByTestId('profile-name')).toHaveText('Meera Kapoor');
    await expect(page.getByText('Rohan Mehta').first()).toBeVisible();
  });

  test('directory search, filters, grid view and CSV export work', async ({ page }) => {
    await loginAs(page, 'hr', '/employees');
    await page.getByLabel('Search table').fill('Meera');
    await expect(page.getByTestId('table-row')).toHaveCount(1);
    await page.getByLabel('Search table').fill('');
    await page.getByLabel('Department filter').selectOption({ label: 'Engineering' });
    const rows = page.getByTestId('table-row');
    await expect(rows.first()).toContainText('Engineering');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    expect((await download).suggestedFilename()).toBe('employees.csv');
    await page.getByLabel('Grid view').click();
    await expect(page.getByText('Meera Kapoor')).toBeVisible();
  });

  test('HR edits the employee profile', async ({ page }) => {
    await loginAs(page, 'hr', '/employees');
    await page.getByLabel('Search table').fill('Meera');
    await expect(page.getByTestId('table-row')).toHaveCount(1);
    await page.getByTestId('table-row').first().click();
    await page.getByTestId('edit-employee').click();
    const d = dialog(page, 'Edit Meera Kapoor');
    await d.getByLabel('Phone').fill('+91 9876543210');
    await d.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Employee updated');
    await expect(page.getByText('+91 9876543210')).toBeVisible();
  });

  test('new hire gets an onboarding checklist that can be ticked off', async ({ page }) => {
    await loginAs(page, 'hr', '/onboarding');
    const card = page.getByTestId('checklist').filter({ hasText: 'Meera Kapoor' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('0%');
    await card.getByTestId('checklist-task').first().click();
    await expect(card).not.toContainText('0%');
  });

  test('org chart renders the hierarchy and locates a person', async ({ page }) => {
    await loginAs(page, 'employee');
    await nav(page, 'Org Chart');
    await expect(page.getByTestId('org-node').filter({ hasText: 'Aarav Sharma' })).toBeVisible();
    await page.getByLabel('Find person').fill('Ananya');
    await page.getByRole('button', { name: 'Locate' }).click();
    await expect(page.getByTestId('org-node').filter({ hasText: 'Ananya Iyer' })).toBeVisible();
  });

  test('employee updates own profile and cannot see others\' salary', async ({ page }) => {
    await loginAs(page, 'employee', '/profile');
    await page.getByLabel('Emergency contact').fill('Ravi Iyer · +91 9000000000');
    await page.getByTestId('save-profile').click();
    await expectToast(page, 'Profile updated');
    await page.goto('/employees/3');
    await expect(page.getByTestId('profile-name')).toHaveText('Rohan Mehta');
    await expect(page.getByText('Annual CTC')).toHaveCount(0);
  });

  test('handles large datasets with a virtualised table (5,000 rows)', async ({ page }) => {
    await loginAs(page, 'hr');
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: 100000 + i, emp_code: `BULK${i}`, first_name: `Bulk${i}`, last_name: 'User', email: `bulk${i}@x.test`,
      designation: 'Analyst', department: 'Operations', location: 'Remote', manager_name: 'Rohan Mehta', date_of_joining: '2024-01-01', status: 'active', avatar_color: '#6366f1',
    }));
    await page.route(/\/api\/employees(\?.*)?$/, (route) => route.fulfill({ json: rows }));
    await nav(page, 'Employees');
    await expect(page.getByText('Showing 5,000 of 5,000 records')).toBeVisible();
    const rendered = await page.getByTestId('table-row').count();
    expect(rendered).toBeLessThan(80);
    await page.getByLabel('Search table').fill('Bulk4999');
    await expect(page.getByTestId('table-row')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 5,000 records')).toBeVisible();
  });
});
