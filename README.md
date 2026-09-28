# PeopleHub HRMS

A full-featured, industry-grade **Human Resource Management System** — a single-page application covering the complete
hire-to-retire lifecycle, inspired by the best of Keka, Zoho People and We360.ai. Built for Indian workplaces
(PF, ESI, professional tax, TDS under the new regime, Indian holiday calendar, INR formatting) and fully role-based.

![Dashboard](docs/screenshots/dashboard.png)

| Dark mode | Mobile |
| --- | --- |
| ![Dark dashboard](docs/screenshots/dashboard-dark.png) | <img src="docs/screenshots/mobile.png" width="260" /> |

## Modules

| Area | Features |
| --- | --- |
| **Dashboard** | Role-aware KPIs, attendance trend, headcount by department, live clock-in widget, leave balances, who's out, celebrations (birthdays & work anniversaries), new joiners, announcements, kudos, upcoming holidays |
| **Core HR** | Employee directory (table & card views, filters, CSV export), rich profiles (job, personal, statutory, bank, attendance, leave, assets, documents), interactive org chart with search/zoom, HR edit/reset password/offboard |
| **Attendance** | Clock in/out with office/remote/field mode, shift-based late marks & half days, monthly calendar, daily log, regularization requests with approval, team presence board |
| **Leave** | Configurable leave types & quotas, live balances (used/pending/available), weekend & holiday-aware day counting, half days, overlap and balance validation, approvals, cancellation with balance restore, team leave calendar, holiday list |
| **Payroll** | Monthly payroll runs using attendance + LOP, salary structures & revisions, statutory deductions (PF with ceiling, ESI, PT, TDS new regime FY 25-26 incl. 87A rebate & cess), lock-on-paid, printable payslips with amount in words, investment/tax declarations with HR verification |
| **Expenses** | Reimbursement claims with receipt uploads (PDF/photo), receipts viewable by the approver from the inbox, manager approval/rejection with comments |
| **Timesheets & projects** | Weekly timesheet grid, billable utilisation, project budgets vs logged hours, approvals |
| **Recruitment (ATS)** | Job openings, drag-and-drop candidate kanban, candidate drawer with resume uploads, interview scheduling with interviewer notification and an email invitation to the candidate, feedback, one-click hire → employee + onboarding checklist |
| **On/offboarding** | Auto-generated checklists (IT, HR, manager, finance), progress tracking, exit workflow that deactivates the account on completion |
| **Performance** | Goals/OKRs with weights & progress, self → manager review workflow with star ratings, review cycle launch |
| **Engage** | Announcements (pinning, company-wide notification), kudos wall with badges, pulse polls |
| **Productivity** | We360-style activity analytics: productive/neutral/unproductive/idle split, productivity score, daily breakdown, top apps & websites |
| **Learning** | Course catalogue, mandatory compliance training, enrolment & progress, completion tracking |
| **Helpdesk** | HR/IT/payroll tickets with priority, assignment, status workflow, resolution notes and file attachments (screenshots, documents) from both sides |
| **Assets** | Hardware inventory, allocation, repair tracking, cost |
| **Documents** | Company policies and personal documents with real file uploads: HR publishes files company-wide or to one employee, employees upload their own KYC documents and certificates, and PDFs and images preview in-app |
| **Approvals inbox** | Unified queue for leave, regularization, expenses, timesheets and tax proofs, with bulk approve |
| **Reports** | Headcount trend, attrition, diversity, attendance, leave utilisation, payroll cost, hiring funnel & sources — every dataset exportable to CSV |
| **Admin** | Departments, designations, locations, shifts, leave policy, holidays, company settings, full audit log |
| **Email** | Transactional email over SMTP: every in-app notification is also emailed (per-user opt-out), plus welcome emails with sign-in details, interview invitations, a forgot-password flow with single-use reset links, and password-change alerts. Emails go through a persistent outbox with background delivery and retries; admins get delivery status, a rendered preview, a test send and an SMTP connection check in Settings → Email |
| **Platform** | Notifications centre, ⌘K command palette (people, pages, quick actions), dark mode, responsive mobile layout, role-based access (Admin, HR, Manager, Employee) enforced in UI and API |

## Architecture

```
client/  React 19 SPA · Redux Toolkit + RTK Query · React Router · Tailwind CSS v4 · Recharts · TanStack Virtual
server/  Node.js + Express 5 · SQLite (built-in node:sqlite, zero native deps) · JWT auth · bcrypt · Multer uploads · Nodemailer SMTP
e2e/     Playwright end-to-end tests (56 tests across all modules and roles, with a real SMTP capture server)
```

**SPA & performance**

- **Pure single-page app**: client-side routing only; navigating between modules never reloads the document (verified by an E2E test).
- **Code splitting**: every page is a lazy chunk, and vendor code is split into long-cacheable `react`, `state`, `charts` and `icons` chunks. Hovering a sidebar item prefetches that page's chunk.
- **Skeleton loaders** for every page, card and table instead of spinners.
- **RTK Query cache**: deduplicated requests, a shared cache across pages, and tag-based invalidation. Writes refresh every dependent module automatically, e.g. approving leave refreshes attendance, balances, approvals and the dashboard.
- **Large datasets**: the `DataTable` is virtualised and renders only visible rows, so 5,000+ records scroll smoothly (covered by an E2E test). It also has debounced search, multi-type sorting and CSV export.

## Getting started

Requires **Node.js 22.9+** (uses the built-in `node:sqlite` and `--env-file-if-exists`).

```bash
npm install
npm run build        # build the SPA
npm start            # API + SPA on http://localhost:4000 (seeds demo data on first run)
```

Development with hot reload (API on :4000, Vite on :5173 with proxy):

```bash
npm run dev
```

Reset demo data at any time: `npm run seed`.

### Demo accounts

All passwords are `Password@123`, and the login screen has one-click buttons for each role.

| Role | Email |
| --- | --- |
| Admin | admin@peoplehub.demo |
| HR | hr@peoplehub.demo |
| Manager | manager@peoplehub.demo |
| Employee | employee@peoplehub.demo |

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `DB_PATH` | `server/data/hrms.db` | SQLite database file |
| `JWT_SECRET` | dev secret | **Set in production** |
| `RESET_DB` | – | `1` reseeds on start |
| `APP_URL` | `http://localhost:$PORT` | Public URL used for links in emails |
| `UPLOAD_DIR` | `server/data/uploads` | Where uploaded files are stored (keep it outside the web root and back it up) |
| `MAX_UPLOAD_MB` | `10` | Maximum upload size |
| `SMTP_HOST` | – | SMTP server. Unset = emails are recorded in the outbox but not sent |
| `SMTP_PORT` | `587` | `465` enables implicit TLS automatically |
| `SMTP_USER` / `SMTP_PASS` | – | SMTP credentials |
| `SMTP_FROM` | company HR address | e.g. `"Acme HR" <hr@acme.com>` |
| `SMTP_SECURE` | auto | Force TLS on/off (`true`/`false`) |

Copy `.env.example` for a starting point. SMTP works with any provider (Gmail/Google Workspace app passwords, Microsoft 365, Amazon SES, SendGrid, Mailgun, Zoho Mail, Postmark and others).

### File uploads & security

- Files are stored under random names outside the public web root and are only served through an authenticated endpoint that re-checks permissions on every download.
- Each record type has its own access rules. Examples: expense receipts are visible to the claimant, their management chain and HR; personal documents only to the owner and HR.
- Uploads are validated three ways: allow-listed extension, declared MIME type, and file signature (magic bytes). Size is limited, rejected uploads are deleted immediately, and deleting a record deletes its files.
- Downloads are sent with `nosniff`, a restrictive CSP and `Content-Disposition`. Only images and PDFs may render inline.

## Testing

```bash
npm run test:api     # backend: payroll/tax maths, leave rules, RBAC, audit, uploads, SMTP delivery (node:test)
npm run test:e2e     # builds the SPA and runs the Playwright suite in Chromium
```

The E2E suite drives the real app in a browser and covers authentication, SPA behaviour, skeletons, RBAC, the command palette, dark mode, clock-in/out, regularization, leave apply/approve/reject/cancel with balance checks, employee CRUD, onboarding, org chart, virtualised 5,000-row tables, payroll run → paid → payslip, salary revision, tax declarations, recruitment pipeline (including drag-and-drop), hiring, goals, reviews, expenses, bulk approvals, timesheets, helpdesk, announcements, kudos, polls, learning, documents, notifications, organization setup, settings, offboarding, reports, productivity, audit log, the mobile layout, file uploads (documents, receipts, ticket attachments, resumes, previews, downloads, type validation) and email (welcome, approval and reset emails delivered to a real SMTP server, the email log and preview, test sends, forgot-password via the emailed link, opting out).

## Screenshots

| | |
| --- | --- |
| ![Login](docs/screenshots/login.png) | ![Recruitment](docs/screenshots/recruitment.png) |
| ![Payroll](docs/screenshots/payroll.png) | ![Productivity](docs/screenshots/productivity.png) |
| ![Org chart](docs/screenshots/org-chart.png) | ![Leave calendar](docs/screenshots/leave.png) |
| ![Documents](docs/screenshots/documents.png) | ![Expense with receipt](docs/screenshots/expense-receipt.png) |
| ![Email settings](docs/screenshots/email-settings.png) | ![Email preview](docs/screenshots/email-preview.png) |
