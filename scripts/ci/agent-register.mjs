// CI helper: signs in as the demo admin and registers a device for the demo employee.
// Prints GitHub Actions env lines (AGENT_TOKEN=…, AGENT_DEVICE_ID=…) to stdout.
const BASE = process.env.HRMS_URL || 'http://localhost:4000';
const json = async (res) => { const b = await res.json(); if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(b)}`); return b; };
const { token } = await json(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@peoplehub.demo', password: 'Password@123' }) }));
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const emp = (await json(await fetch(`${BASE}/api/employees`, { headers: auth }))).find((e) => e.email === 'employee@peoplehub.demo');
const dev = await json(await fetch(`${BASE}/api/activity/devices`, { method: 'POST', headers: auth, body: JSON.stringify({ name: `CI ${process.env.RUNNER_OS || 'runner'}`, platform: process.env.RUNNER_OS || 'CI', employee_id: emp.id }) }));
console.error(`::add-mask::${dev.token}`);
console.log(`AGENT_TOKEN=${dev.token}`);
console.log(`AGENT_DEVICE_ID=${dev.id}`);
console.log(`AGENT_EMPLOYEE_ID=${emp.id}`);
