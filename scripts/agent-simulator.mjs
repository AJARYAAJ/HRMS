#!/usr/bin/env node
/**
 * Desktop activity agent simulator.
 *
 * Registers agent devices for a few employees (as an admin) and streams realistic heartbeats and
 * screenshots to the agent API, exactly as the real desktop agent would:
 *
 *   GET  /api/agent/config                     Authorization: Device <token>
 *   POST /api/agent/heartbeat  { events: [...] }
 *   POST /api/agent/screenshot (multipart "file", PNG/JPEG/WebP)
 *
 * Usage: npm run agent:simulate -- [--url http://localhost:4000] [--people 5] [--minutes 30] [--live]
 *   --minutes  history to backfill (one event per minute, ending now)
 *   --live     keep sending one heartbeat per person every 60 s until stopped
 */
import zlib from 'node:zlib';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const BASE = (arg('url', process.env.HRMS_URL || 'http://localhost:4000')).replace(/\/$/, '');
const PEOPLE = Number(arg('people', 5));
const MINUTES = Number(arg('minutes', 30));
const LIVE = process.argv.includes('--live');
const EMAIL = process.env.HRMS_ADMIN_EMAIL || 'admin@peoplehub.demo';
const PASSWORD = process.env.HRMS_ADMIN_PASSWORD || 'Password@123';

const WORK = [
  { app: 'Visual Studio Code', title: 'server/src/routes/payroll.js' },
  { app: 'Google Chrome', domain: 'github.com', title: 'Pull request #128' },
  { app: 'Google Chrome', domain: 'jira.atlassian.com', title: 'Sprint board' },
  { app: 'Slack', title: '#engineering' },
  { app: 'Figma', domain: 'figma.com', title: 'Dashboard redesign' },
  { app: 'Microsoft Excel', title: 'Q3 forecast.xlsx' },
  { app: 'Zoom', title: 'Daily stand-up' },
];
const DISTRACT = [
  { app: 'Google Chrome', domain: 'youtube.com', title: 'Music mix' },
  { app: 'Google Chrome', domain: 'instagram.com', title: 'Feed' },
  { app: 'Google Chrome', domain: 'news.ycombinator.com', title: 'Hacker News' },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function event(ts) {
  const r = Math.random();
  if (r < 0.1) return { ts, app: 'Idle', active_seconds: 0, idle_seconds: 60 };
  const w = r < 0.8 ? pick(WORK) : pick(DISTRACT);
  const active = 40 + Math.floor(Math.random() * 21);
  return { ts, ...w, active_seconds: active, idle_seconds: 60 - active };
}

// ---- tiny PNG encoder (no dependencies) so screenshots are real images ----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function screenshotPng(seed) {
  const w = 320; const h = 180;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const hue = (seed * 47) % 255;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const bar = y < 18; const side = x < 60; const line = !bar && !side && y % 14 < 4 && x < 80 + ((y * 7 + seed * 13) % 200);
      const [r, g, b] = bar ? [40, 44, 52] : side ? [30 + hue / 4, 41, 59] : line ? [99, 102, 241] : [248, 250, 252];
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function api(path, { method = 'GET', body, token, device } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (device) headers.Authorization = `Device ${device}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error || ''}`);
  return json;
}

async function main() {
  const { token } = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const employees = (await api('/employees', { token })).filter((e) => e.role !== 'admin').slice(0, PEOPLE);
  console.log(`Simulating ${employees.length} agent(s) against ${BASE}`);
  const agents = [];
  for (const e of employees) {
    const d = await api('/activity/devices', { method: 'POST', token, body: { employee_id: e.id, name: 'Simulated laptop', platform: pick(['Windows', 'macOS', 'Linux']) } });
    const config = await api('/agent/config', { device: d.token });
    agents.push({ name: `${e.first_name} ${e.last_name}`, token: d.token, config, sent: 0 });
  }
  const shot = async (a, i) => {
    if (!a.config.screenshots_enabled) return;
    const fd = new FormData();
    fd.append('file', new Blob([screenshotPng(i)], { type: 'image/png' }), 'screen.png');
    await api('/agent/screenshot', { method: 'POST', device: a.token, body: fd });
  };
  const now = Date.now();
  for (const [i, a] of agents.entries()) {
    const events = Array.from({ length: MINUTES }, (_, m) => event(new Date(now - (MINUTES - m) * 60000).toISOString()));
    const r = await api('/agent/heartbeat', { method: 'POST', device: a.token, body: { events } });
    await shot(a, i);
    a.sent += events.length;
    console.log(`  ${a.name.padEnd(24)} ${String(r.accepted).padStart(4)} events${r.alerts ? ` · ${r.alerts} alert(s)` : ''}${a.config.screenshots_enabled ? ' · 1 screenshot' : ''}`);
  }
  if (!LIVE) { console.log('Done. Open Productivity → Live to see the agents.'); return; }
  console.log('Live mode: one heartbeat per agent every 60 s (Ctrl+C to stop)');
  let tick = 0;
  setInterval(async () => {
    tick++;
    for (const [i, a] of agents.entries()) {
      try {
        await api('/agent/heartbeat', { method: 'POST', device: a.token, body: { events: [event(new Date().toISOString())] } });
        if (tick % Math.max(1, a.config.screenshot_interval_mins) === 0) await shot(a, i + tick);
      } catch (err) { console.error(`  ${a.name}: ${err.message}`); }
    }
    console.log(`  tick ${tick}: ${agents.length} heartbeat(s) sent`);
  }, 60000);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
