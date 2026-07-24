"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setToken } from "./api";

export type AdminUser = {
  id: string;
  username: string;
  role: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
};

type AuthState = {
  user: AdminUser | null;
  permissions: string[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (p: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: { user: AdminUser; permissions: string[] } }>("/auth/me");
      setUser(res.data.user);
      setPermissions(res.data.permissions || []);
    } catch {
      setUser(null);
      setPermissions([]);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    if (!token) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{
      data: { token: string; user: AdminUser; permissions: string[] };
    }>("/auth/login", { username, password });
    setToken(res.data.token);
    setUser(res.data.user);
    setPermissions(res.data.permissions || []);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  const value = useMemo(
    () => ({
      user,
      permissions,
      loading,
      login,
      logout,
      refresh,
      hasPermission: (p: string) => permissions.includes(p),
    }),
    [user, permissions, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
