import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Layout from './components/Layout';
import { Toaster, EmptyState } from './components/ui';
import { allRoutes, pages } from './routes';
import { ShieldAlert, Compass } from 'lucide-react';

const Login = lazy(() => import('./pages/Login'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Careers = lazy(() => import('./pages/Careers'));
const Verify = lazy(() => import('./pages/Verify'));
const JoinPortal = lazy(() => import('./pages/JoinPortal'));

function RequireAuth({ children }) {
  const token = useSelector((s) => s.auth.token);
  const location = useLocation();
  return token ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

function Guard({ roles, children }) {
  const role = useSelector((s) => s.auth.user?.role);
  if (!roles.includes(role)) {
    return <div className="card"><EmptyState icon={ShieldAlert} title="Access restricted" message="You don't have permission to view this page. Contact your HR administrator if you need access." /></div>;
  }
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={null}><ResetPassword /></Suspense>} />
        <Route path="/careers" element={<Suspense fallback={null}><Careers /></Suspense>} />
        <Route path="/join/:token" element={<Suspense fallback={null}><JoinPortal /></Suspense>} />
        <Route path="/verify/:code" element={<Suspense fallback={null}><Verify /></Suspense>} />
        <Route path="/careers/:jobId" element={<Suspense fallback={null}><Careers /></Suspense>} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          {allRoutes.map((r) => {
            const Page = pages[r.page];
            return <Route key={r.path} path={r.path} element={<Guard roles={r.roles}><Page /></Guard>} />;
          })}
          <Route path="*" element={<div className="card"><EmptyState icon={Compass} title="Page not found" message="The page you are looking for doesn't exist." /></div>} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}

