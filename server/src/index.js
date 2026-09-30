import { migrate, get } from './db.js';
import { remindExpiringDocuments } from './routes/docs.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { startMailer, smtpConfig } from './mailer.js';
import { bootstrapProduction } from './bootstrap.js';

const production = process.env.NODE_ENV === 'production';
migrate();
if (process.env.RESET_DB === '1') {
  console.log('RESET_DB=1: reseeding the database with demo data…');
  seed({ reset: true });
} else if (!get('SELECT id FROM employees LIMIT 1')) {
  if (production && process.env.SEED_DEMO !== '1') {
    try {
      const admin = bootstrapProduction();
      console.log(`First start: created the organisation and administrator ${admin.email}. Sign in and complete Settings.`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else {
    console.log('Seeding database with demo data…');
    seed();
  }
}

startMailer();
console.log(smtpConfig() ? `Email: delivering via SMTP ${smtpConfig().host}:${smtpConfig().port}` : 'Email: SMTP not configured, emails are logged to the outbox (Settings → Email)');

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => console.log(`PeopleHub HRMS API running on http://localhost:${port}`));

// Daily housekeeping: remind employees about documents that expire within 30 days.
const housekeeping = () => { try { remindExpiringDocuments(); } catch (e) { console.error('[jobs] document reminders failed', e); } };
setTimeout(housekeeping, 60_000).unref();
setInterval(housekeeping, 24 * 3600_000).unref();
