// CI helper: waits until the installed desktop agent has uploaded activity, then prints what arrived.
const BASE = process.env.HRMS_URL || 'http://localhost:4000';
const deviceId = Number(process.env.AGENT_DEVICE_ID);
const employeeId = Number(process.env.AGENT_EMPLOYEE_ID);
const timeoutMs = Number(process.env.AGENT_WAIT_MS || 240000);
const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@peoplehub.demo', password: 'Password@123' }) });
const auth = { Authorization: `Bearer ${(await res.json()).token}` };
const get = async (p) => (await fetch(`${BASE}/api/${p}`, { headers: auth })).json();
const start = Date.now();
let device;
while (Date.now() - start < timeoutMs) {
  device = (await get('activity/devices')).find((d) => d.id === deviceId);
  if (device?.agent_version && device.last_seen_at) break;
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('device:', JSON.stringify(device));
if (!device?.agent_version) {
  console.error(`The agent did not upload anything within ${timeoutMs / 1000}s.`);
  process.exit(1);
}
const detail = await get(`activity/employee/${employeeId}`);
console.log('apps:', JSON.stringify(detail.apps));
console.log('domains:', JSON.stringify(detail.domains));
console.log('first/last activity:', detail.first_activity, detail.last_activity);
console.log('attendance:', JSON.stringify(detail.attendance));
const live = (await get('activity/live')).rows.find((r) => r.id === employeeId);
console.log('live:', JSON.stringify({ status: live.status, current: live.current, active_mins: live.active_mins }));
console.log(`OK: agent ${device.agent_version} on ${device.os} (${device.hostname}) is reporting.`);
