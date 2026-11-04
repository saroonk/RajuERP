import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { appRoutes } from './routes';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Confirm';
import { Spinner } from '@/components/ui/States';
import { AppLayout } from '@/layouts/AppLayout';
import { ForbiddenPage, NotFoundPage } from '@/features/auth/NotFoundPage';
import type { ModuleKey } from '@/types';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));

function RequireAuth() {
  const { user, restoring } = useAuth();
  const location = useLocation();
  if (restoring) return <Spinner label="Loading your workspace…" className="min-h-dvh" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppLayout />;
}

function Guard({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(module) ? <>{children}</> : <ForbiddenPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Routes>
              <Route
                path="/login"
                element={
                  <Suspense fallback={<Spinner className="min-h-dvh" />}>
                    <LoginPage />
                  </Suspense>
                }
              />
              <Route element={<RequireAuth />}>
                {appRoutes.map(({ path, module, Page }) => (
                  <Route
                    key={path}
                    path={path}
                    element={
                      <Guard module={module}>
                        <Page />
                      </Guard>
                    }
                  />
                ))}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
