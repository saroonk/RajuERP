import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onUnauthorized, services } from '@/services';
import { useData } from '@/hooks/useData';
import type { ModuleKey, PermissionLevel, RolePermissions, User } from '@/types';

/**
 * Session state for the SPA (HTTP session cookie, or the demo user in mock mode). Permission checks here only shape the interface (hidden menus, disabled actions);
 * real authentication and authorization must be enforced by the backend.
 */
interface AuthState {
  user: User | null;
  /** True while a remembered session is being restored on first load. */
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** `can('inventory')` = may open the module; `can('inventory', 'edit')` = may change data in it. */
  can: (module: ModuleKey, level?: Exclude<PermissionLevel, 'none'>) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const perms = useData<RolePermissions>(() => services.admin.permissions());

  // The session lives in a server cookie (or, in mock mode, a remembered demo user): ask who is signed in.
  useEffect(() => {
    let cancelled = false;
    services.auth
      .restore()
      .then((u) => !cancelled && setUser(u && u.active ? u : null))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setRestoring(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any API call answered 401 (expired session) returns the app to the sign-in screen.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await services.auth.login(email, password));
  }, []);

  const logout = useCallback(async () => {
    try {
      if (user) await services.auth.logout(user.id);
    } finally {
      setUser(null);
    }
  }, [user]);

  const can = useCallback<AuthState['can']>(
    (module, level = 'view') => {
      if (!user || !perms.data) return false;
      const granted = perms.data[user.role]?.[module] ?? 'none';
      return level === 'view' ? granted !== 'none' : granted === 'edit';
    },
    [user, perms.data],
  );

  const value = useMemo(() => ({ user, restoring: restoring || (!!user && perms.loading), login, logout, can }), [user, restoring, perms.loading, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Renders children only when the signed-in role may edit the module (use around create/edit/delete buttons). */
export function Can({ module, children, level = 'edit' }: { module: ModuleKey; children: ReactNode; level?: 'view' | 'edit' }) {
  const { can } = useAuth();
  return can(module, level) ? <>{children}</> : null;
}
