// Starts the app for E2E tests together with a real SMTP server that captures outgoing mail.
// Captured messages are exposed at http://localhost:$MAILBOX_PORT/messages so tests can read them.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';

const SMTP_PORT = Number(process.env.E2E_SMTP_PORT || 2526);
const MAILBOX_PORT = Number(process.env.E2E_MAILBOX_PORT || 4401);
const messages = [];

// Decode quoted-printable bodies so tests can read links and text as written.
const decodeQP = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => { raw += c; });
    stream.on('end', () => {
      const subject = (raw.match(/^Subject: (.*(?:\r?\n[ \t].*)*)/m)?.[1] || '').replace(/\r?\n[ \t]/g, ' ');
      messages.push({ id: messages.length + 1, to: session.envelope.rcptTo.map((r) => r.address), subject, body: decodeQP(raw), at: new Date().toISOString() });
      cb();
    });
  },
});
smtp.listen(SMTP_PORT, '127.0.0.1');

http.createServer((req, res) => {
  if (req.method === 'DELETE') messages.length = 0;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(messages));
}).listen(MAILBOX_PORT);

Object.assign(process.env, {
  SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_FROM: 'PeopleHub HR <hr@peoplehub.demo>',
  MAIL_INTERVAL_MS: '500', APP_URL: `http://localhost:${process.env.PORT}`,
});
// Placeholder agent builds so the download list renders without needing Go (the real builds are covered by
// the Go tests and the agent CI workflow).
if (process.env.AGENT_DIST_DIR) {
  fs.mkdirSync(process.env.AGENT_DIST_DIR, { recursive: true });
  for (const f of ['peoplehub-agent-windows-amd64.exe', 'peoplehub-agent-windows-arm64.exe', 'peoplehub-agent-macos-arm64.zip', 'peoplehub-agent-macos-amd64.zip']) {
    fs.writeFileSync(path.join(process.env.AGENT_DIST_DIR, f), `placeholder ${f}`);
  }
  fs.writeFileSync(path.join(process.env.AGENT_DIST_DIR, 'VERSION'), '1.0.0\n');
}
await import('../../server/src/index.js');
