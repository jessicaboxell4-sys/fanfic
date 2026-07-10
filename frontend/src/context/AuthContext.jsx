import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Belt-and-suspenders helper for every auth-success flow (login,
  // register, Google OAuth callback, password reset). Snaps the user
  // object in immediately so the UI doesn't flash a logged-out state,
  // THEN re-fetches /auth/me in the background to backfill anything the
  // login response may have dropped. Before 2026-06-15 the email/password
  // login response forgot to include ``is_admin``, which silently hid
  // the AdminConsole button until the next page refresh — this helper
  // makes any future field drift self-healing.
  const loginSuccess = useCallback(async (data) => {
    if (data) setUser(data);
    // Best-effort: if /auth/me 404s (cookie not yet propagated), the
    // catch in checkAuth will set user=null, but the next page nav will
    // re-try via the AuthProvider mount effect. We don't await to keep
    // the click-to-navigate snappy.
    try {
      const { data: fresh } = await api.get("/auth/me");
      setUser(fresh);
    } catch { /* ignore — initial setUser(data) is good enough */ }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) {}
    setUser(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkAuth, refresh: checkAuth, loginSuccess, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
