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
import { payrollRouter, taxRouter } from './routes/payroll.js';
import * as m from './routes/modules.js';
import { dashboardRouter, reportsRouter, productivityRouter, searchRouter, approvalsRouter } from './routes/insights.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.post('/auth/login', loginHandler);
  api.post('/auth/forgot-password', forgotPasswordHandler);
  api.post('/auth/reset-password', resetPasswordHandler);
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
  api.use('/projects', m.projectsRouter);
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
  api.use('/emails', emailsRouter);
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Serve the built SPA when it exists (production / e2e).
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
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
