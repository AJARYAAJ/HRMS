import { migrate, get } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { startMailer, smtpConfig } from './mailer.js';

migrate();
if (process.env.RESET_DB === '1' || !get('SELECT id FROM employees LIMIT 1')) {
  console.log('Seeding database with demo data…');
  seed();
}

startMailer();
console.log(smtpConfig() ? `Email: delivering via SMTP ${smtpConfig().host}:${smtpConfig().port}` : 'Email: SMTP not configured, emails are logged to the outbox (Settings → Email)');

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => console.log(`PeopleHub HRMS API running on http://localhost:${port}`));
