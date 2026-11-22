'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { can, type Permission, type Role } from '@railguard/shared';
import { api, refreshSession, setToken } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  divisionId: string | null;
  totpEnabled: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void refreshSession().then((r) => {
      if (!live) return;
      setUser(r?.user ?? null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const r = await api<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password, ...(totpCode ? { totpCode } : {}) },
    });
    setToken(r.accessToken);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ user, loading, login, logout, can: (p) => !!user && can(user.role, p) }),
    [user, loading, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};
