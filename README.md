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
| **Expenses** | Reimbursement claims, manager approval/rejection with comments |
| **Timesheets & projects** | Weekly timesheet grid, billable utilisation, project budgets vs logged hours, approvals |
| **Recruitment (ATS)** | Job openings, drag-and-drop candidate kanban, candidate drawer, interview scheduling with interviewer notification, feedback, one-click hire → employee + onboarding checklist |
| **On/offboarding** | Auto-generated checklists (IT, HR, manager, finance), progress tracking, exit workflow that deactivates the account on completion |
| **Performance** | Goals/OKRs with weights & progress, self → manager review workflow with star ratings, review cycle launch |
| **Engage** | Announcements (pinning, company-wide notification), kudos wall with badges, pulse polls |
| **Productivity** | We360-style activity analytics: productive/neutral/unproductive/idle split, productivity score, daily breakdown, top apps & websites |
| **Learning** | Course catalogue, mandatory compliance training, enrolment & progress, completion tracking |
| **Helpdesk** | HR/IT/payroll tickets with priority, assignment, status workflow and resolution notes |
| **Assets** | Hardware inventory, allocation, repair tracking, cost |
| **Documents** | Company policies and personal documents (offer/appraisal letters) |
| **Approvals inbox** | Unified queue for leave, regularization, expenses, timesheets and tax proofs, with bulk approve |
| **Reports** | Headcount trend, attrition, diversity, attendance, leave utilisation, payroll cost, hiring funnel & sources — every dataset exportable to CSV |
| **Admin** | Departments, designations, locations, shifts, leave policy, holidays, company settings, full audit log |
| **Platform** | Notifications centre, ⌘K command palette (people, pages, quick actions), dark mode, responsive mobile layout, role-based access (Admin, HR, Manager, Employee) enforced in UI and API |

## Architecture

```
client/  React 19 SPA · Redux Toolkit + RTK Query · React Router · Tailwind CSS v4 · Recharts · TanStack Virtual
server/  Node.js + Express 5 · SQLite (built-in node:sqlite, zero native deps) · JWT auth · bcrypt
e2e/     Playwright end-to-end tests (45 tests across all modules and roles)
```

**SPA & performance**

- **Pure single-page app**: client-side routing only; navigating between modules never reloads the document (verified by an E2E test).
- **Code splitting**: every page is a lazy chunk, and vendor code is split into long-cacheable `react`, `state`, `charts` and `icons` chunks. Hovering a sidebar item prefetches that page's chunk.
- **Skeleton loaders** for every page, card and table instead of spinners.
- **RTK Query cache**: deduplicated requests, a shared cache across pages, and tag-based invalidation. Writes refresh every dependent module automatically, e.g. approving leave refreshes attendance, balances, approvals and the dashboard.
- **Large datasets**: the `DataTable` is virtualised and renders only visible rows, so 5,000+ records scroll smoothly (covered by an E2E test). It also has debounced search, multi-type sorting and CSV export.

## Getting started

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`).

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

## Testing

```bash
npm run test:api     # backend: payroll/tax maths, leave rules, RBAC, audit (node:test)
npm run test:e2e     # builds the SPA and runs the Playwright suite in Chromium
```

The E2E suite drives the real app in a browser and covers authentication, SPA behaviour, skeletons, RBAC, the command palette, dark mode, clock-in/out, regularization, leave apply/approve/reject/cancel with balance checks, employee CRUD, onboarding, org chart, virtualised 5,000-row tables, payroll run → paid → payslip, salary revision, tax declarations, recruitment pipeline (including drag-and-drop), hiring, goals, reviews, expenses, bulk approvals, timesheets, helpdesk, announcements, kudos, polls, learning, documents, notifications, organization setup, settings, offboarding, reports, productivity, audit log and the mobile layout.

## Screenshots

| | |
| --- | --- |
| ![Login](docs/screenshots/login.png) | ![Recruitment](docs/screenshots/recruitment.png) |
| ![Payroll](docs/screenshots/payroll.png) | ![Productivity](docs/screenshots/productivity.png) |
| ![Org chart](docs/screenshots/org-chart.png) | ![Leave calendar](docs/screenshots/leave.png) |
