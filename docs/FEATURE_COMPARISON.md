# Feature comparison: Keka, Zoho People, We360.ai and BeyondSure

This maps the headline features of the four reference portals to where they live in PeopleHub.

The vendors' own websites could not be reached from the build environment. The lists below come from their public
product pages and feature summaries, so this is an approximation of each product, not an audit of it.

Legend: ✅ implemented · ◑ partly implemented (limits noted) · — not implemented

## Core HR & organisation

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Employee directory, profiles, org chart | Keka, Zoho | ✅ | Employees, Org Chart |
| Multiple legal entities (companies) with their own PAN/TAN/GSTIN | BeyondSure | ✅ | Organization → Companies |
| Custom profile fields (HR-only or employee-editable) | Zoho, Keka | ✅ | Settings → Custom fields; employee profile |
| Bulk employee import from CSV with dry-run validation | Keka, Zoho | ✅ | Employees → Import |
| Probation tracking, confirmation or extension | Keka | ✅ | Exit & F&F → Probation; profile |
| Letter templates and PDF letters (offer, experience, relieving, salary, address, confirmation) | Keka, Zoho | ✅ | Documents → Templates; profile → Generate letter |
| Employee letter requests fulfilled by HR | Keka | ✅ | Documents → Requests |
| Policy acknowledgement with tracking and reminders | Keka, Zoho | ✅ | Documents (acknowledge; HR progress list) |
| Onboarding and offboarding checklists | Keka, Zoho | ✅ | On/Offboarding |

## Attendance, shifts & leave

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Web clock-in/out with work mode | Keka, Zoho | ✅ | Dashboard widget, Attendance |
| Geo-fenced clock-in (off / flag / enforce, radius per location) | Keka, We360 | ✅ | Settings → Policies; Organization → Locations |
| Regularisation requests | Keka, Zoho | ✅ | Attendance |
| WFH, on-duty, comp-off and overtime requests | Keka, Zoho | ✅ | Attendance → Requests |
| Overtime calculated from the shift | Keka | ✅ | Attendance log and summary |
| Weekly shift roster with copy-last-week | Zoho | ✅ | Shift roster |
| Optional (restricted) holidays with a yearly quota | Keka, Zoho | ✅ | Leave → Optional holidays |
| Leave year-end: carry forward with cap, encashable excess | Keka, Zoho | ✅ | Settings → Year end |
| Biometric device integration | Keka, Zoho | — | Clock-ins are web-only (or automatic from the activity agent) |

## Approvals

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Unified approvals inbox with bulk approve | Keka, Zoho | ✅ | Approvals |
| Configurable multi-level flows (manager / manager → HR / HR only) per request type | Keka, Zoho | ✅ | Settings → Workflows |
| Approval history for every decision | Keka, Zoho | ✅ | "History" on any approval and in request drawers |

## Payroll, tax & finance

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Payroll run with LOP, PF, ESI, PT, TDS | Keka, BeyondSure | ✅ | Payroll |
| Per-company payroll runs and payslips | BeyondSure | ✅ | Payroll (one run per legal entity) |
| Old vs new tax regime, with a planner showing the saving | Keka, Zoho | ✅ | Payslips & Tax → Tax planner |
| Investment declarations with HR verification | Keka, Zoho | ✅ | Payslips & Tax; Payroll → Tax declarations |
| Annual tax statement (TDS by month) | Keka | ◑ | Payslips & Tax → Annual tax statement. This is a statement, **not** a certified Form 16 |
| Loans and salary advances with EMI deducted in payroll | Keka | ✅ | Payslips & Tax → Loans; Payroll → Loans |
| Expense reimbursement paid through payroll | Keka, Zoho | ✅ | Approved claims are added to the next payslip |
| Bank transfer file (CSV) | Keka | ✅ | Payroll → Bank file |
| Configurable salary structure (basic %, HRA %) | Keka | ✅ | Payroll → Settings |
| Travel requests with advances | Zoho | ✅ | Travel |
| Statutory filings (PF ECR, ESI challans, TDS returns) | Keka | — | |

## Exit management

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Resignation with notice-period LWD, withdrawal, manager → HR approval | Keka, Zoho | ✅ | Exit & F&F |
| Exit interviews with analytics | Keka, Zoho | ✅ | Exit & F&F → Exit interviews |
| Full & final settlement: unpaid salary, EL encashment, gratuity, notice recovery, loan recovery | Keka | ✅ | Exit & F&F → F&F settlements |

## Talent

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| ATS pipeline, interviews, hire to employee | Keka, Zoho | ✅ | Recruitment |
| Public careers page with online applications (resume upload, spam honeypot, rate limit) | Keka, Zoho | ✅ | `/careers` |
| Offer letter PDF emailed to the candidate | Keka | ✅ | Recruitment → candidate → Send offer letter |
| Goals/OKRs and review cycles | Keka, Zoho | ✅ | Performance |
| Continuous feedback and 360° feedback requests | Keka, Zoho | ✅ | Performance → Feedback |
| One-on-ones with shared agenda, notes and action items | Keka | ✅ | Performance → One-on-ones |
| Learning catalogue and compliance courses | Zoho, Keka | ◑ | Learning (no SCORM content hosting) |

## Engagement & workspace

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Announcements, kudos, polls | Keka, Zoho | ✅ | Engage |
| Social feed with likes, comments and @mentions | Keka, Zoho | ✅ | Engage → Feed |
| Anonymous eNPS survey with score and breakdown | Keka | ✅ | Engage → Polls & eNPS |
| Helpdesk tickets with attachments | Zoho, Keka | ✅ | Helpdesk |
| Knowledge base, with suggestions while you raise a ticket | Zoho | ✅ | Helpdesk → Knowledge base |
| Tasks (kanban) and timesheets on projects | Keka PSA, Zoho | ✅ | Tasks, Timesheets |
| Company calendar (holidays, leave, interviews, 1:1s, birthdays, anniversaries, tasks, travel, probation) | Zoho | ✅ | Calendar |
| Installable web app (PWA) | Keka, Zoho (native apps) | ◑ | Installable PWA with an offline shell; no native iOS/Android apps |

## Workforce analytics (We360.ai)

| Feature | Reference | PeopleHub | Where |
| --- | --- | --- | --- |
| Desktop agent API (device tokens, heartbeats, screenshots) | We360 | ✅ | `/api/agent/*`; Productivity → Devices |
| App and website classification rules, with department overrides and re-apply | We360 | ✅ | Productivity → App rules |
| Live board: active / idle / offline and the current app | We360 | ✅ | Productivity → Live |
| Per-employee timeline: hourly split, apps, sites, 14-day trend | We360 | ✅ | Productivity → click a person |
| Screenshots (opt-in, visible to the employee, manager chain and HR) | We360 | ✅ | Activity timeline |
| Alerts: long idle, unproductive time, overwork/burnout | We360 | ✅ | Productivity → Alerts |
| Auto clock-in from first activity | We360 | ✅ | Productivity → Settings |
| Native desktop agent | We360 | ✅ | `agent/`: Windows and macOS builds with one-line installers, start at login, offline queue, browser domains, screenshots ([agent/README.md](../agent/README.md)). Builds are unsigned: code signing needs your organisation's certificates |

## Not implemented

- Biometric device integration.
- Native mobile apps.
- Statutory e-filing (ECR, challans, TDS returns).
- Direct bank APIs.
- Certified Form 16.
- Code signing of the desktop agent.
- SCORM course hosting.
- AI assistants.

Each would need third-party accounts, certificates or platform-specific builds.
