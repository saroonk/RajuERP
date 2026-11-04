import type { AuditEntry, BackupRecord, RolePermissions, Settings, User } from '@/types';
import type { AdminService, Services, UserInput } from '../types';
import { ApiError, api, asArray, listAll } from './client';
import { crud } from './masters';

export const admin: AdminService = {
  users: crud<User, UserInput>('admin/users'),
  permissions: () => api.get<RolePermissions>('admin/permissions/'),
  setPermission: (role, module, level) => api.put<RolePermissions>('admin/permissions/', { role, module, level }),
  audit: () => listAll<AuditEntry>('admin/audit/'),
  settings: () => api.get<Settings>('admin/settings/'),
  updateSettings: (input) => api.put<Settings>('admin/settings/', input),
  backups: async () => asArray(await api.get<BackupRecord[]>('admin/backups/')),
  runBackup: () => api.post<BackupRecord>('admin/backups/'),
};

export const auth: Services['auth'] = {
  login: (email, password) => api.post<User>('auth/login/', { email, password }),
  logout: async () => {
    await api.post('auth/logout/');
  },
  getUser: async () => auth.restore(),
  /** The session cookie is the session: ask the server who is signed in (401 just means nobody). */
  restore: async () => {
    try {
      return await api.get<User>('auth/me/');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return undefined;
      throw e;
    }
  },
  /** There are no demo accounts against a real backend. */
  demoUsers: async () => [],
};
