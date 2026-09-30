# Keka and We360 parity: plan

This plan follows a Keka demo review. In Keka, **every employee is assigned plans and policies**, and the system
behaves according to them: leave rules, holidays, weekly offs, attendance rules, expense limits and tracking rules.
PeopleHub had most modules, but each used one global rule set. This plan makes each rule set a named, assignable
plan, then fills the other gaps found in the review. It is written from Keka's and We360's documented behaviour;
the demo itself was not reachable from the build environment.

Status: ✅ done · 🚧 in progress · ⏳ planned

## Phase P: Professional services (Keka PSA) ✅

- **Clients:** billing details, GSTIN, payment terms, contacts, receivables.
- **Projects:**
  - linked to a client;
  - billing type: time & materials, fixed price or non-billable;
  - a manager, and team members with bill and cost rates;
  - milestones;
  - budget burn and margin.
- **Opportunities:** a pipeline from lead to won, with weighted value and win rate. A won deal converts into a
  project, and into a client if it was a new prospect.
- **Resources:** a 12-week allocation planner, utilisation, the bench and overallocation.
- **Finance:**
  - invoices from approved billable time (at each member's rate) or completed milestones, plus manual lines;
  - GST, PDF, and emailing the invoice to the client;
  - payments, overdue invoices and receivables ageing;
  - project P&L.

## Phase A: Plans and policies engine (the core of the request) 🚧

Every plan type below:

- has any number of named plans, one marked **default**;
- is assigned per employee, or in bulk by department, location or company;
- appears on the employee's profile ("Assigned plans");
- is actually used by the engine: leave balances, attendance status, payroll working days, expense validation and
  agent settings all read the employee's own plan.

| # | Plan type | What it controls | Used by |
| --- | --- | --- | --- |
| A1 | **Leave plan** | Leave types in the plan, each with: yearly quota; accrual (yearly upfront or monthly, pro-rated from joining); carry-forward cap; encashable; half-day allowed; minimum notice days; maximum consecutive days; allowed during probation; sandwich rule (weekends/holidays inside a leave count); gender restriction | Leave balances, apply-leave validation, year-end |
| A2 | **Holiday list** | Its own holidays (e.g. Pune vs Bengaluru), optional holidays and quota | Leave day counting, attendance, calendar, payroll |
| A3 | **Weekly-off policy** | Which days are off, including patterns such as "2nd and 4th Saturday" or "all Saturdays" | Leave counting (and the sandwich rule), absence marking, payroll working days |
| A4 | **Attendance tracking policy** | Allowed capture methods (web, remote, geo-fence enforced); full-day and half-day minimum hours; grace minutes; **late-arrival penalty** (e.g. every 3 late marks in a month deduct ½ day from a leave type, else LOP); regularisation requests allowed per month; overtime eligibility and minimum overtime | Clock-in rules, daily status, penalties report, regularisation validation |
| A5 | **Expense policy** | Expense categories, each with: per-claim limit; monthly limit; receipt required above an amount; **mileage** (rate per km); per-diem rate; allowed payment modes | Claim validation, reimbursement through payroll, approvals |
| A6 | **Activity tracking policy** (We360) | Tracking on/off; tracking window (working days and hours only); screenshots on/off and interval; screenshot blur; idle threshold; away limit; pausing allowed | Desktop agent settings, resolved per employee |

## Phase B: Onboarding before and after joining ⏳

- **B1 Pre-boarding (before day one).** Once a candidate is hired, they get a secure portal link with no account
  needed, where they:
  - fill personal, family, address, bank and emergency details;
  - upload the required documents from a checklist (photo, PAN, Aadhaar, education, previous employment,
    relieving letter);
  - accept the offer letter electronically.

  HR verifies each document or sends it back with a note. On the joining date the pre-hire becomes an employee, with
  the profile pre-filled and a welcome email.
- **B2 Onboarding (after joining).**
  - Onboarding **templates**: task checklists per department or role, with owners and due offsets
    (day 1, week 1, 30/60/90 days).
  - A **buddy** assignment, an induction schedule and a "My onboarding" page for the new joiner.
  - Progress tracking for HR, with a link to the probation review.

## Phase C: Documents, letters, assets and ID card ⏳

- **C1 Organisation documents:** folders; audience (everyone, department, location, company or chosen people);
  version history; expiry and review dates; acknowledgement (exists).
- **C2 Employee document checklist:** required document types per employee, with verification status and expiry
  reminders (e.g. passport, visa).
- **C3 Letters:** template categories; **bulk generation** for many employees at once; employee **e-sign and
  acceptance** of issued letters; letter history on the profile.
- **C4 Assets:**
  - asset types, warranty and expiry dates;
  - employee **asset requests** with approval;
  - allocation **acknowledgement** by the employee;
  - a **return/handover** flow linked to exit and F&F;
  - full asset history.
- **C5 Digital ID card:** profile photo; a printable ID card (photo, name, designation, employee code, blood group,
  emergency contact, company); a **QR code** that opens a public verification page showing whether the person is a
  current employee; PNG/PDF download; batch printing for HR.

## Phase D: We360 gaps ⏳

- Activity-based timesheets: tracked time per project, application and site, turned into timesheet suggestions.
- A **wellness and burnout** dashboard: overtime trend, late-night and weekend work, breaks.
- Team comparison reports and scheduled exports (productivity, attendance, app usage by team).
- On-demand screenshot request from a manager (live screen streaming needs video infrastructure and is out of
  scope).

## Order of work

A1 → A2/A3 → A4 → A5 → A6 → C5 → B1 → B2 → C1–C4 → D.

Each step ships with seed data, API tests and browser tests, and is pushed when green.
