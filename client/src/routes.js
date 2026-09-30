import { lazy } from 'react';
import {
  LayoutDashboard, CheckSquare, Clock, CalendarDays, Timer, Wallet, Receipt, LifeBuoy, FileText, GraduationCap, Laptop,
  Users, Network, UserPlus, Target, PartyPopper, Briefcase, Activity, Banknote, BarChart3, Building2, Settings, ShieldCheck, UserCircle,
  LogOut, ListTodo, Plane, Calendar, CalendarRange, Building, FolderKanban, Crosshair, UsersRound, Landmark, PieChart, DownloadCloud,
} from 'lucide-react';

// Every page is its own chunk; `load` is reused for hover-prefetching from the sidebar.
const page = (load) => Object.assign(lazy(load), { load });

export const pages = {
  dashboard: page(() => import('./pages/Dashboard')),
  approvals: page(() => import('./pages/Approvals')),
  attendance: page(() => import('./pages/Attendance')),
  leave: page(() => import('./pages/Leave')),
  timesheets: page(() => import('./pages/Timesheets')),
  payslips: page(() => import('./pages/Payslips')),
  payslip: page(() => import('./pages/PayslipView')),
  expenses: page(() => import('./pages/Expenses')),
  helpdesk: page(() => import('./pages/Helpdesk')),
  documents: page(() => import('./pages/Documents')),
  learning: page(() => import('./pages/Learning')),
  assets: page(() => import('./pages/Assets')),
  employees: page(() => import('./pages/Employees')),
  employee: page(() => import('./pages/EmployeeProfile')),
  orgchart: page(() => import('./pages/OrgChart')),
  onboarding: page(() => import('./pages/Onboarding')),
  performance: page(() => import('./pages/Performance')),
  engage: page(() => import('./pages/Engage')),
  recruitment: page(() => import('./pages/Recruitment')),
  productivity: page(() => import('./pages/Productivity')),
  payroll: page(() => import('./pages/Payroll')),
  reports: page(() => import('./pages/Reports')),
  organization: page(() => import('./pages/Organization')),
  settings: page(() => import('./pages/Settings')),
  audit: page(() => import('./pages/AuditLog')),
  profile: page(() => import('./pages/Profile')),
  exit: page(() => import('./pages/Exit')),
  tasks: page(() => import('./pages/Tasks')),
  travel: page(() => import('./pages/Travel')),
  calendar: page(() => import('./pages/CalendarPage')),
  roster: page(() => import('./pages/Roster')),
  activityDetail: page(() => import('./pages/ActivityDetail')),
  taxStatement: page(() => import('./pages/TaxStatement')),
  clients: page(() => import('./pages/Clients')),
  projects: page(() => import('./pages/Projects')),
  projectDetail: page(() => import('./pages/ProjectDetail')),
  opportunities: page(() => import('./pages/Opportunities')),
  resources: page(() => import('./pages/Resources')),
  finance: page(() => import('./pages/Finance')),
  analytics: page(() => import('./pages/Analytics')),
  exports: page(() => import('./pages/Exports')),
};

const ALL = ['admin', 'hr', 'manager', 'employee'];
const MGR = ['admin', 'hr', 'manager'];
const HR = ['admin', 'hr'];

export const navGroups = [
  { label: 'Overview', items: [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard', roles: ALL },
    { path: '/approvals', label: 'Approvals', icon: CheckSquare, page: 'approvals', roles: MGR, badge: 'approvals' },
    { path: '/calendar', label: 'Calendar', icon: Calendar, page: 'calendar', roles: ALL },
    { path: '/tasks', label: 'Tasks', icon: ListTodo, page: 'tasks', roles: ALL },
  ] },
  { label: 'My Workspace', items: [
    { path: '/attendance', label: 'Attendance', icon: Clock, page: 'attendance', roles: ALL },
    { path: '/leave', label: 'Leave', icon: CalendarDays, page: 'leave', roles: ALL },
    { path: '/timesheets', label: 'Timesheets', icon: Timer, page: 'timesheets', roles: ALL },
    { path: '/payslips', label: 'Payslips & Tax', icon: Wallet, page: 'payslips', roles: ALL },
    { path: '/expenses', label: 'Expenses', icon: Receipt, page: 'expenses', roles: ALL },
    { path: '/travel', label: 'Travel', icon: Plane, page: 'travel', roles: ALL },
    { path: '/helpdesk', label: 'Helpdesk', icon: LifeBuoy, page: 'helpdesk', roles: ALL },
    { path: '/learning', label: 'Learning', icon: GraduationCap, page: 'learning', roles: ALL },
    { path: '/documents', label: 'Documents', icon: FileText, page: 'documents', roles: ALL },
    { path: '/assets', label: 'Assets', icon: Laptop, page: 'assets', roles: ALL },
  ] },
  { label: 'People', items: [
    { path: '/employees', label: 'Employees', icon: Users, page: 'employees', roles: ALL },
    { path: '/org-chart', label: 'Org Chart', icon: Network, page: 'orgchart', roles: ALL },
    { path: '/onboarding', label: 'On/Offboarding', icon: UserPlus, page: 'onboarding', roles: ALL },
    { path: '/exit', label: 'Exit & F&F', icon: LogOut, page: 'exit', roles: ALL },
    { path: '/performance', label: 'Performance', icon: Target, page: 'performance', roles: ALL },
    { path: '/engage', label: 'Engage', icon: PartyPopper, page: 'engage', roles: ALL },
  ] },
  { label: 'Professional services', items: [
    { path: '/projects', label: 'Projects', icon: FolderKanban, page: 'projects', roles: ALL },
    { path: '/clients', label: 'Clients', icon: Building, page: 'clients', roles: MGR },
    { path: '/opportunities', label: 'Opportunities', icon: Crosshair, page: 'opportunities', roles: MGR },
    { path: '/resources', label: 'Resources', icon: UsersRound, page: 'resources', roles: MGR },
    { path: '/finance', label: 'Finance', icon: Landmark, page: 'finance', roles: HR },
  ] },
  { label: 'Talent & Insights', items: [
    { path: '/recruitment', label: 'Recruitment', icon: Briefcase, page: 'recruitment', roles: MGR },
    { path: '/roster', label: 'Shift roster', icon: CalendarRange, page: 'roster', roles: MGR },
    { path: '/productivity', label: 'Productivity', icon: Activity, page: 'productivity', roles: MGR },
    { path: '/analytics', label: 'Analytics', icon: PieChart, page: 'analytics', roles: MGR },
    { path: '/reports', label: 'Reports', icon: BarChart3, page: 'reports', roles: MGR },
  ] },
  { label: 'Administration', items: [
    { path: '/payroll', label: 'Payroll', icon: Banknote, page: 'payroll', roles: HR },
    { path: '/organization', label: 'Organization', icon: Building2, page: 'organization', roles: HR },
    { path: '/settings', label: 'Settings', icon: Settings, page: 'settings', roles: HR },
    { path: '/exports', label: 'Bulk export', icon: DownloadCloud, page: 'exports', roles: HR },
    { path: '/audit-log', label: 'Audit Log', icon: ShieldCheck, page: 'audit', roles: HR },
  ] },
];

// Routes not shown in the sidebar.
export const hiddenRoutes = [
  { path: '/employees/:id', page: 'employee', roles: ALL },
  { path: '/payslips/:id', page: 'payslip', roles: ALL },
  { path: '/profile', page: 'profile', roles: ALL, label: 'My Profile', icon: UserCircle },
  { path: '/productivity/:id', page: 'activityDetail', roles: ALL },
  { path: '/tax-statement', page: 'taxStatement', roles: ALL },
  { path: '/projects/:id', page: 'projectDetail', roles: ALL },
];

export const allRoutes = [...navGroups.flatMap((g) => g.items), ...hiddenRoutes];
