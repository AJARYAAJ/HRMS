import { test, expect } from '@playwright/test';
import { loginAs, expectToast, dialog } from './helpers';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test.describe.serial('Biometric attendance devices', () => {
  let key;
  test('HR adds a device and gets connection details', async ({ page }) => {
    await loginAs(page, 'hr', '/attendance-devices');
    await expect(page.getByTestId('devices-table')).toContainText('Reception – Bengaluru HQ');
    await page.getByTestId('add-device').click();
    const d = dialog(page, 'Add attendance device');
    await d.getByLabel(/^Name/).fill('Gate 2 – Pune');
    await d.getByLabel(/^Serial number/).fill('PUN-GATE-02');
    await d.getByRole('button', { name: 'Add device' }).click();
    await expectToast(page, 'Device added');
    key = await page.getByTestId('device-key').innerText();
    expect(key).toMatch(/^bio_/);
    await expect(page.getByRole('dialog', { name: 'Connect the device' })).toContainText('PUN-GATE-02');
  });

  test('punches from the device mark attendance; an unknown user ID is mapped to an employee', async ({ page, request }) => {
    const res = await request.post('/api/biometric/punches', {
      headers: { 'X-Device-Key': key },
      data: { punches: [{ user_id: '8123', time: `${today()} 08:58:00` }, { user_id: '8123', time: `${today()} 17:44:00` }] },
    });
    expect((await res.json()).unmatched).toBe(2);
    await loginAs(page, 'hr', '/attendance-devices');
    await page.getByRole('tab', { name: /Unmatched punches/ }).click();
    const row = page.getByTestId('punch-table').getByTestId('table-row').filter({ hasText: '8123' }).first();
    await row.getByTestId('map-punch').click();
    const d = dialog(page, 'Map device user 8123');
    const who = d.getByLabel(/^Employee/);
    await who.selectOption({ label: await who.locator('option', { hasText: 'Rohan Mehta' }).first().innerText() });
    await d.getByRole('button', { name: 'Map and apply punches' }).click();
    await expectToast(page, 'Mapped');
    await page.getByRole('tab', { name: 'Punch log' }).click();
    await expect(page.getByTestId('punch-table').getByTestId('table-row').filter({ hasText: '8123' }).first()).toContainText('Rohan Mehta');
  });

  test('attendance policy shows device, network and auto clock-out rules', async ({ page }) => {
    await loginAs(page, 'hr', '/policies?tab=attendance');
    const rules = page.getByTestId('attendance-rules');
    await expect(rules).toContainText('Biometric devices');
    await expect(rules).toContainText('Office network');
    await expect(rules).toContainText('Automatic clock-out');
  });
});
