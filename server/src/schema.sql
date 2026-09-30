PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  head_id INTEGER,
  description TEXT
);

CREATE TABLE IF NOT EXISTS designations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  level TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  address TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  grace_minutes INTEGER DEFAULT 15
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'employee',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  date_of_joining TEXT,
  date_of_birth TEXT,
  gender TEXT,
  marital_status TEXT,
  blood_group TEXT,
  employment_type TEXT DEFAULT 'Full-time',
  status TEXT NOT NULL DEFAULT 'active',
  exit_date TEXT,
  address TEXT,
  emergency_contact TEXT,
  pan TEXT,
  uan TEXT,
  bank_name TEXT,
  bank_account TEXT,
  ifsc TEXT,
  annual_ctc REAL DEFAULT 0,
  email_notifications INTEGER NOT NULL DEFAULT 1,
  avatar_color TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  status TEXT NOT NULL DEFAULT 'present',
  work_mode TEXT DEFAULT 'office',
  late INTEGER DEFAULT 0,
  notes TEXT,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS regularizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  annual_quota REAL NOT NULL DEFAULT 0,
  paid INTEGER DEFAULT 1,
  carry_forward INTEGER DEFAULT 0,
  color TEXT DEFAULT '#6366f1'
);

CREATE TABLE IF NOT EXISTS leave_balances (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  allocated REAL NOT NULL DEFAULT 0,
  used REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, leave_type_id, year)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  half_day INTEGER DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT DEFAULT 'Public'
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  company_id INTEGER,
  status TEXT NOT NULL DEFAULT 'processed',
  employees INTEGER DEFAULT 0,
  total_gross REAL DEFAULT 0,
  total_deductions REAL DEFAULT 0,
  total_net REAL DEFAULT 0,
  processed_by INTEGER,
  processed_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  UNIQUE(month, company_id)
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  working_days REAL, paid_days REAL, lop_days REAL,
  basic REAL, hra REAL, special REAL, gross REAL,
  pf REAL, esi REAL, pt REAL, tds REAL, total_deductions REAL, net REAL,
  UNIQUE(run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS tax_declarations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fy TEXT NOT NULL,
  section TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  employment_type TEXT DEFAULT 'Full-time',
  experience TEXT,
  openings INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  description TEXT,
  hiring_manager_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES job_openings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT,
  stage TEXT NOT NULL DEFAULT 'applied',
  rating INTEGER DEFAULT 0,
  experience_years REAL,
  current_company TEXT,
  expected_ctc REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  interviewer_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  round TEXT,
  scheduled_at TEXT NOT NULL,
  mode TEXT DEFAULT 'Video',
  status TEXT DEFAULT 'scheduled',
  rating INTEGER,
  feedback TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'onboarding',
  title TEXT NOT NULL,
  category TEXT,
  due_date TEXT,
  done INTEGER DEFAULT 0,
  assignee_id INTEGER
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'Individual',
  cycle TEXT,
  progress INTEGER DEFAULT 0,
  weight INTEGER DEFAULT 20,
  due_date TEXT,
  status TEXT DEFAULT 'on_track'
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  cycle TEXT NOT NULL,
  self_rating REAL,
  manager_rating REAL,
  self_comments TEXT,
  strengths TEXT,
  improvements TEXT,
  status TEXT DEFAULT 'self_review'
);

CREATE TABLE IF NOT EXISTS kudos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge TEXT,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client TEXT,
  status TEXT DEFAULT 'active',
  start_date TEXT,
  end_date TEXT,
  budget_hours REAL
);

CREATE TABLE IF NOT EXISTS timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  task TEXT,
  billable INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS productivity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  productive_mins INTEGER DEFAULT 0,
  neutral_mins INTEGER DEFAULT 0,
  unproductive_mins INTEGER DEFAULT 0,
  idle_mins INTEGER DEFAULT 0,
  top_apps TEXT,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  serial_no TEXT,
  assigned_to INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'available',
  purchase_date TEXT,
  cost REAL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  assignee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  category TEXT DEFAULT 'General',
  pinned INTEGER DEFAULT 0,
  author_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,
  duration_hours REAL,
  mandatory INTEGER DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'enrolled',
  UNIQUE(course_id, employee_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_votes (
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  option_index INTEGER NOT NULL,
  PRIMARY KEY (survey_id, employee_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  employee_id INTEGER,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  message_id TEXT,
  next_attempt_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- legal entities (multi-company groups) ----------
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  legal_name TEXT,
  pan TEXT, tan TEXT, gstin TEXT,
  pf_code TEXT, esi_code TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- History of every approval decision (supports multi-level manager → HR flows).
CREATE TABLE IF NOT EXISTS approval_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  approver_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- exit management ----------
CREATE TABLE IF NOT EXISTS resignations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  notes TEXT,
  submitted_on TEXT NOT NULL,
  requested_lwd TEXT NOT NULL,
  approved_lwd TEXT,
  notice_days INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exit_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  resignation_id INTEGER REFERENCES resignations(id) ON DELETE CASCADE,
  primary_reason TEXT,
  rating_manager INTEGER, rating_culture INTEGER, rating_growth INTEGER, rating_compensation INTEGER,
  would_recommend INTEGER,
  would_return INTEGER,
  feedback TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(resignation_id)
);

CREATE TABLE IF NOT EXISTS fnf_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  resignation_id INTEGER REFERENCES resignations(id) ON DELETE SET NULL,
  last_working_day TEXT NOT NULL,
  salary_days REAL, salary_amount REAL,
  leave_encash_days REAL, leave_encash_amount REAL,
  gratuity REAL, bonus REAL DEFAULT 0,
  notice_shortfall_days REAL, notice_recovery REAL,
  loan_recovery REAL, other_deductions REAL DEFAULT 0,
  net_payable REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT
);

-- ---------- attendance & leave ----------
CREATE TABLE IF NOT EXISTS attendance_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  end_date TEXT,
  hours REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shift_roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
  week_off INTEGER DEFAULT 0,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS optional_holiday_choices (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  holiday_id INTEGER NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, holiday_id)
);

-- ---------- payroll depth ----------
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'loan',
  amount REAL NOT NULL,
  tenure_months INTEGER NOT NULL,
  emi REAL NOT NULL,
  outstanding REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  disbursed_on TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  payslip_id INTEGER REFERENCES payslips(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- letters, acknowledgements, custom fields, knowledge base ----------
CREATE TABLE IF NOT EXISTS letter_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS letter_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  handled_by INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_acks (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (document_id, employee_id)
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  field_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT,
  section TEXT DEFAULT 'Additional',
  required INTEGER DEFAULT 0,
  employee_editable INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (employee_id, field_id)
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  helpful INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ---------- performance & engagement ----------
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_id INTEGER,
  message TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'manager',
  competency TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  question TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS one_on_ones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  duration_mins INTEGER DEFAULT 30,
  agenda TEXT,
  notes TEXT,
  action_items TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, employee_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- work management ----------
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  due_date TEXT,
  estimate_hours REAL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS travel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  mode TEXT,
  estimated_cost REAL,
  advance_amount REAL DEFAULT 0,
  billable INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- activity monitoring ----------
CREATE TABLE IF NOT EXISTS agent_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One row per heartbeat (typically each minute): what was in focus and how much of it was active.
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_id INTEGER,
  ts TEXT NOT NULL,
  app TEXT,
  domain TEXT,
  title TEXT,
  category TEXT NOT NULL DEFAULT 'neutral',
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  UNIQUE(pattern, department_id)
);

CREATE TABLE IF NOT EXISTS activity_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  message TEXT NOT NULL,
  date TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, type, date)
);

CREATE INDEX IF NOT EXISTS idx_activity_emp_ts ON activity_events(employee_id, ts);
CREATE INDEX IF NOT EXISTS idx_steps_entity ON approval_steps(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_attach_entity ON attachments(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_notif_emp ON notifications(employee_id, read);
CREATE INDEX IF NOT EXISTS idx_prod_emp_date ON productivity(employee_id, date);

-- ---------- plans & policies (Keka-style: every employee is assigned one plan of each type) ----------
CREATE TABLE IF NOT EXISTS leave_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_plan_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES leave_plans(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  annual_quota REAL NOT NULL DEFAULT 0,
  accrual TEXT NOT NULL DEFAULT 'yearly',      -- yearly (upfront, pro-rated for joiners) | monthly | none (e.g. LOP)
  carry_forward_cap REAL DEFAULT 0,
  encashable INTEGER DEFAULT 0,
  allow_half_day INTEGER DEFAULT 1,
  min_notice_days INTEGER DEFAULT 0,
  max_consecutive REAL,
  probation_allowed INTEGER DEFAULT 1,
  sandwich INTEGER DEFAULT 0,                  -- weekends/holidays inside a leave count as leave
  gender TEXT,                                 -- restrict to a gender (e.g. maternity)
  UNIQUE(plan_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS holiday_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  optional_limit INTEGER DEFAULT 2,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_off_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  pattern TEXT NOT NULL DEFAULT '{"0":"all","6":"all"}', -- weekday (0=Sun) -> "all" or weeks of the month, e.g. "2,4"
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  allow_web INTEGER DEFAULT 1,
  allow_remote INTEGER DEFAULT 1,
  allow_field INTEGER DEFAULT 1,
  geofence_mode TEXT,                           -- NULL = organisation setting; off | flag | enforce
  grace_minutes INTEGER,                        -- NULL = the shift's grace
  full_day_hours REAL,                          -- NULL = 75% of the shift
  half_day_hours REAL,                          -- NULL = 40% of the shift
  late_penalty_every INTEGER DEFAULT 0,         -- every N late marks in a month...
  late_penalty_days REAL DEFAULT 0.5,           -- ...deduct this many days
  penalty_leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL, -- from this leave type (NULL = loss of pay)
  max_regularizations INTEGER,                  -- per month (NULL = unlimited)
  overtime_allowed INTEGER DEFAULT 1,
  overtime_min_minutes INTEGER DEFAULT 30,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  late_count INTEGER NOT NULL,
  days REAL NOT NULL,
  leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'applied',       -- applied | waived
  decided_by INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, month)
);

CREATE TABLE IF NOT EXISTS expense_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL REFERENCES expense_policies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'amount',          -- amount | mileage (rate per km) | per_diem (rate per day)
  rate REAL,
  per_claim_limit REAL,
  monthly_limit REAL,
  receipt_above REAL,                           -- a receipt is required when the claim exceeds this (0 = always)
  UNIQUE(policy_id, name)
);


-- ---------- professional services (clients, projects, opportunities, resources, finance) ----------
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  industry TEXT,
  website TEXT,
  email TEXT,
  phone TEXT,
  billing_address TEXT,
  gstin TEXT,
  currency TEXT DEFAULT 'INR',
  payment_terms_days INTEGER DEFAULT 30,
  status TEXT DEFAULT 'active',
  owner_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  designation TEXT,
  is_primary INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role TEXT,
  bill_rate REAL DEFAULT 0,           -- per hour, charged to the client
  cost_rate REAL,                     -- per hour; NULL = derived from salary
  UNIQUE(project_id, employee_id)
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  due_date TEXT,
  amount REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | invoiced
  completed_on TEXT,
  invoice_id INTEGER
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  prospect TEXT,                      -- organisation name when not yet a client
  owner_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'lead', -- lead | qualified | proposal | negotiation | won | lost
  value REAL DEFAULT 0,
  probability INTEGER DEFAULT 10,
  expected_close TEXT,
  source TEXT,
  billing_type TEXT DEFAULT 'time_materials',
  notes TEXT,
  lost_reason TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  closed_on TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resource_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  allocation_pct INTEGER NOT NULL DEFAULT 100,
  billable INTEGER DEFAULT 1,
  role TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sent | partially_paid | paid | void
  currency TEXT DEFAULT 'INR',
  subtotal REAL DEFAULT 0,
  tax_rate REAL DEFAULT 18,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'other',          -- time | milestone | expense | other
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  rate REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  employee_id INTEGER,
  milestone_id INTEGER
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  format TEXT NOT NULL,
  filters TEXT,
  columns TEXT,
  row_count INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- asset lifecycle ----------
CREATE TABLE IF NOT EXISTS asset_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                          -- created | assigned | acknowledged | returned | repair | retired | updated
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  by_id INTEGER,
  condition TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  reason TEXT,
  needed_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | manager_approved | approved | rejected | fulfilled
  approver_id INTEGER,
  comment TEXT,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- pre-boarding and onboarding templates ----------
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'onboarding',       -- onboarding | offboarding
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,  -- used automatically for this department
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_template_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'HR',           -- owner: HR | IT | Manager | Buddy | Employee | Finance | Learning
  offset_days INTEGER NOT NULL DEFAULT 0,        -- relative to the joining (or last) day
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preboarding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  buddy_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  template_id INTEGER REFERENCES onboarding_templates(id) ON DELETE SET NULL,
  date_of_joining TEXT NOT NULL,
  annual_ctc REAL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',        -- invited | in_progress | submitted | converted | cancelled
  details TEXT,                                  -- JSON: personal, address, family, bank, emergency
  offer_accepted_at TEXT,
  offer_signature TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS preboarding_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preboarding_id INTEGER NOT NULL REFERENCES preboarding(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | verified | rejected
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(preboarding_id, doc_type)
);

-- ---------- employee document checklist ----------
CREATE TABLE IF NOT EXISTS document_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'KYC',
  required INTEGER DEFAULT 1,
  has_expiry INTEGER DEFAULT 0,
  description TEXT
);
