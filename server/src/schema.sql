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
  month TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processed',
  employees INTEGER DEFAULT 0,
  total_gross REAL DEFAULT 0,
  total_deductions REAL DEFAULT 0,
  total_net REAL DEFAULT 0,
  processed_by INTEGER,
  processed_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_notif_emp ON notifications(employee_id, read);
CREATE INDEX IF NOT EXISTS idx_prod_emp_date ON productivity(employee_id, date);
