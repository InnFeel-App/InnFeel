import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, saveToken, clearToken } from "./api";
import { currentLocale } from "./i18n";

export type User = {
  user_id: string;
  email: string;
  name: string;
  avatar_color: string;
  pro: boolean;
  pro_expires_at?: string | null;
  pro_source?: string | null;
  zen?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  friend_count: number;
  streak: number;
  created_at: string;
  email_verified_at?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, opts?: { termsAccepted?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await api<User>("/auth/me");
      setUser(u);
    } catch (e: any) {
      // Only nuke the user state on a *real* auth failure (401/403).
      // For transient network errors (timeout during a heavy upload, brief
      // offline, backend cold-start), KEEP the previous user so the app
      // doesn't briefly redirect to /onboarding (which used to flash after
      // posting a video aura — the upload would compete with /auth/me).
      const status = e?.status ?? e?.response?.status;
      const msg = String(e?.message || "").toLowerCase();
      const isAuthError =
        status === 401 ||
        status === 403 ||
        msg.includes("unauthor") ||
        msg.includes("forbidden");
      if (isAuthError) {
        setUser(null);
      }
      // else: silently keep the previous user — they'll get a fresh refresh
      // on the next mount or successful API call.
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const res = await api<{ user: User; access_token: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await saveToken(res.access_token);
    setUser(res.user);
  };

  const register = async (name: string, email: string, password: string, opts?: { termsAccepted?: boolean }) => {
    const res = await api<{ user: User; access_token: string }>("/auth/register", {
      method: "POST",
      body: { name, email, password, terms_accepted: !!opts?.termsAccepted, lang: currentLocale() },
    });
    await saveToken(res.access_token);
    setUser(res.user);
  };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
