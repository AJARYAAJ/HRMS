import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Bell, Search, Moon, Sun, Menu, LogOut, UserCircle, ChevronsLeft, ChevronsRight, KeyRound, CheckCheck, Command,
} from 'lucide-react';
import { navGroups, pages } from '../routes';
import { logout } from '../store/authSlice';
import { toggleTheme, setSidebarOpen, toggleCollapsed, setPaletteOpen } from '../store/uiSlice';
import { useAuth, useGet, useAction } from '../lib/hooks';
import { Avatar, PageSkeleton, cx } from './ui';
import { timeAgo, fullName } from '../lib/format';
import CommandPalette from './CommandPalette';

function Brand({ collapsed }) {
  const { data: settings } = useGet('settings');
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
      {!collapsed && (
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold tracking-tight text-slate-900 dark:text-white">PeopleHub</div>
          <div className="truncate text-[11px] font-medium muted">{settings?.company_short || 'HRMS'} workspace</div>
        </div>
      )}
    </Link>
  );
}

function Sidebar() {
  const { role } = useAuth();
  const dispatch = useDispatch();
  const { sidebarOpen, sidebarCollapsed } = useSelector((s) => s.ui);
  const { data: approvals } = useGet(role && role !== 'employee' ? 'approvals' : null);
  const badges = { approvals: approvals?.length || 0 };
  const collapsed = sidebarCollapsed && !sidebarOpen;

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => dispatch(setSidebarOpen(false))} />}
      <aside className={cx(
        'no-print fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-800 dark:bg-slate-900',
        collapsed ? 'w-[76px]' : 'w-64',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        <div className="flex h-16 items-center justify-between px-3">
          <Brand collapsed={collapsed} />
          <button className="hidden btn-ghost btn-sm !px-1.5 lg:inline-flex" onClick={() => dispatch(toggleCollapsed())} aria-label="Collapse sidebar">
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2" aria-label="Main navigation">
          {navGroups.map((g) => {
            const items = g.items.filter((i) => i.roles.includes(role));
            if (!items.length) return null;
            return (
              <div key={g.label}>
                {!collapsed && <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.label}</div>}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      title={item.label}
                      onMouseEnter={() => pages[item.page].load()}
                      onClick={() => dispatch(setSidebarOpen(false))}
                      className={({ isActive }) => cx('nav-link', isActive && 'active', collapsed && 'justify-center !px-0')}
                    >
                      <item.icon size={18} className="shrink-0" />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.badge && badges[item.badge] > 0 && (
                        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid={`badge-${item.badge}`}>{badges[item.badge]}</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onClose]);
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  const { data } = useGet('notifications', null, { poll: 30000 });
  const [act] = useAction();
  const navigate = useNavigate();
  const unread = data?.unread || 0;
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative !px-2.5" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={18} />
        {unread > 0 && <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white" data-testid="notif-count">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl animate-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <span className="font-semibold">Notifications</span>
            <button className="btn-ghost btn-sm" onClick={() => act('notifications/read-all')}><CheckCheck size={14} /> Mark all read</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items?.length && <div className="p-6 text-center text-sm muted">You're all caught up 🎉</div>}
            {data?.items?.map((n) => (
              <button key={n.id} className={cx('flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800', !n.read && 'bg-brand-50/40 dark:bg-brand-500/5')}
                onClick={() => { act(`notifications/${n.id}/read`); setOpen(false); if (n.link) navigate(n.link); }}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-500')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{n.title}</span>
                  {n.body && <span className="block truncate text-xs muted">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  const dispatch = useDispatch();
  const navigate = useNavigate();
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen((o) => !o)} aria-label="User menu" data-testid="user-menu">
        <Avatar name={fullName(user)} color={user?.avatar_color} size="sm" />
        <div className="hidden text-left md:block">
          <div className="text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">{fullName(user)}</div>
          <div className="text-[11px] capitalize muted">{user?.designation || user?.role}</div>
        </div>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold">{user?.email}</div>
            <div className="text-xs capitalize muted">Role: {user?.role}</div>
          </div>
          <button className="nav-link w-full" onClick={() => { setOpen(false); navigate(`/employees/${user.id}`); }}><UserCircle size={16} /> My profile</button>
          <button className="nav-link w-full" onClick={() => { setOpen(false); navigate('/profile'); }}><KeyRound size={16} /> Account & password</button>
          <button className="nav-link w-full text-rose-600 dark:text-rose-400" onClick={() => { dispatch(logout()); navigate('/login'); }}><LogOut size={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);
  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80 sm:px-6">
      <button className="btn-ghost !px-2 lg:hidden" onClick={() => dispatch(setSidebarOpen(true))} aria-label="Open menu"><Menu size={20} /></button>
      <button onClick={() => dispatch(setPaletteOpen(true))} className="flex w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900" data-testid="open-search">
        <Search size={16} />
        <span className="flex-1 text-left">Search people, pages, actions…</span>
        <kbd className="hidden items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 sm:flex"><Command size={10} />K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn-ghost !px-2.5" onClick={() => dispatch(toggleTheme())} aria-label="Toggle theme" data-testid="theme-toggle">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <Notifications />
        <UserMenu />
      </div>
    </header>
  );
}

export default function Layout() {
  const collapsed = useSelector((s) => s.ui.sidebarCollapsed);
  const location = useLocation();
  const mainRef = useRef(null);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);
  return (
    <div className="min-h-full">
      <Sidebar />
      <div className={cx('transition-all duration-300', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <Topbar />
        <main ref={mainRef} className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Suspense fallback={<PageSkeleton />}>
            <div key={location.pathname} className="animate-fade-in">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
