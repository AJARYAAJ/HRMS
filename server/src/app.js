import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { authRouter, employeesRouter, loginHandler, forgotPasswordHandler, resetPasswordHandler } from './routes/employees.js';
import { attachmentsRouter } from './routes/attachments.js';
import { emailsRouter } from './routes/emails.js';
import {
  attendanceRouter, leaveRouter, regularizationsRouter, shiftsRouter, holidaysRouter,
} from './routes/attendance.js';
import { payrollRouter, taxRouter, loansRouter } from './routes/payroll.js';
import { exitRouter, resignationsRouter } from './routes/exit.js';
import { workforceRouter, attendanceRequestsRouter } from './routes/workforce.js';
import { peopleRouter } from './routes/people.js';
import { careersRouter, offersRouter } from './routes/careers.js';
import { agentDownloadsRouter } from './routes/agentDownloads.js';
import { clientsRouter, projectsRouter, opportunitiesRouter, resourcesRouter, financeRouter } from './routes/psa.js';
import { exportsRouter } from './routes/exports.js';
import { analyticsRouter } from './routes/analytics.js';
import { policiesRouter } from './routes/policies.js';
import { workRouter, travelRouter } from './routes/work.js';
import { agentRouter, activityRouter } from './routes/activity.js';
import { hrdocsRouter, lettersRouter, letterRequestsRouter, customFieldsRouter, kbRouter } from './routes/hrdocs.js';
import * as m from './routes/modules.js';
import { dashboardRouter, reportsRouter, productivityRouter, searchRouter, approvalsRouter } from './routes/insights.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  // The SPA is served from the same origin, so cross-origin access is only enabled in development or for listed origins.
  if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  else if (process.env.NODE_ENV !== 'production') app.use(cors());
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()' });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.post('/auth/login', loginHandler);
  api.post('/auth/forgot-password', forgotPasswordHandler);
  api.post('/auth/reset-password', resetPasswordHandler);
  api.use('/careers', careersRouter); // public careers site
  api.use('/agent', agentRouter); // desktop activity agent (device-token auth)
  api.use('/agent-downloads', agentDownloadsRouter); // public agent builds and installers
  api.use(authenticate);
  api.use('/auth', authRouter);
  api.use('/employees', employeesRouter);
  api.use('/departments', m.departmentsRouter);
  api.use('/designations', m.designationsRouter);
  api.use('/locations', m.locationsRouter);
  api.use('/shifts', shiftsRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/regularizations', regularizationsRouter);
  api.use('/leave', leaveRouter);
  api.use('/holidays', holidaysRouter);
  api.use('/payroll', payrollRouter);
  api.use('/tax-declarations', taxRouter);
  api.use('/expenses', m.expensesRouter);
  api.use('/jobs', m.jobsRouter);
  api.use('/candidates', m.candidatesRouter);
  api.use('/interviews', m.interviewsRouter);
  api.use('/onboarding', m.onboardingRouter);
  api.use('/goals', m.goalsRouter);
  api.use('/reviews', m.reviewsRouter);
  api.use('/kudos', m.kudosRouter);
  api.use('/projects', projectsRouter);
  api.use('/clients', clientsRouter);
  api.use('/opportunities', opportunitiesRouter);
  api.use('/resources', resourcesRouter);
  api.use('/finance', financeRouter);
  api.use('/exports', exportsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/policies', policiesRouter);
  api.use('/timesheets', m.timesheetsRouter);
  api.use('/assets', m.assetsRouter);
  api.use('/tickets', m.ticketsRouter);
  api.use('/announcements', m.announcementsRouter);
  api.use('/courses', m.coursesRouter);
  api.use('/enrollments', m.enrollmentsRouter);
  api.use('/documents', m.documentsRouter);
  api.use('/surveys', m.surveysRouter);
  api.use('/notifications', m.notificationsRouter);
  api.use('/audit-logs', m.auditRouter);
  api.use('/settings', m.settingsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reports', reportsRouter);
  api.use('/productivity', productivityRouter);
  api.use('/search', searchRouter);
  api.use('/approvals', approvalsRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/companies', m.companiesRouter);
  api.use('/loans', loansRouter);
  api.use('/resignations', resignationsRouter);
  api.use('/exit', exitRouter);
  api.use('/attendance-requests', attendanceRequestsRouter);
  api.use('/workforce', workforceRouter);
  api.use('/letter-templates', lettersRouter);
  api.use('/letter-requests', letterRequestsRouter);
  api.use('/custom-fields', customFieldsRouter);
  api.use('/kb', kbRouter);
  api.use('/hr', hrdocsRouter);
  api.use('/people', peopleRouter);
  api.use('/offers', offersRouter);
  api.use('/work', workRouter);
  api.use('/travel', travelRouter);
  api.use('/activity', activityRouter);
  api.use('/emails', emailsRouter);
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Serve the built SPA when it exists (production / e2e).
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    // Hashed build assets are cached for a year; index.html and the service worker are always revalidated,
    // so a deploy shows up on the next page load.
    app.use(express.static(dist, {
      setHeaders(res, file) {
        res.set('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    app.get(/^(?!\/api).*/, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (String(err.message).includes('constraint') ? 400 : 500);
    if (status === 500) console.error(err);
    const message = String(err.message).includes('UNIQUE constraint') ? 'A record with these details already exists' : err.message;
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : message });
  });
  return app;
}
