import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

// 2026-08-XX — Desktop-mode-toggle resilience.
//
// User report: on Android Chrome, tapping "Request Desktop Website"
// while signed in on shelfsort.com immediately booted them back to
// the landing page. There's no User-Agent fingerprinting on the
// backend (session cookies are pure token-in-Mongo) and the FE+API
// share an origin, so the cookie itself shouldn't be lost. What
// DOES happen is Chrome does a hard reload with a fresh UA, and on
// that first reload the boot-time GET /auth/me can race the cookie
// context and come back 401. Before, that single 401 nuked
// `setUser(null)` and the app rendered as fully signed-out — which
// looks exactly like being logged out.
//
// Fix: retain the last-known user in sessionStorage (survives reload
// on the same tab, cleared on tab close), hydrate the UI from it
// on mount, and give the boot-time /auth/me a small retry budget
// so a transient 401 during Desktop-mode reload doesn't blank the
// session. If the retries also fail, THEN we accept the user is
// really signed out.
const SESSION_USER_KEY = "shelfsort.auth.last_user";
const ME_MAX_RETRIES = 3;
const ME_RETRY_BACKOFF_MS = [400, 900, 1600];

function readCachedUser() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Cheap sanity — must at least carry a user_id.
    return parsed && parsed.user_id ? parsed : null;
  } catch { return null; }
}

function writeCachedUser(u) {
  try {
    if (u && u.user_id) {
      window.sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(u));
    } else {
      window.sessionStorage.removeItem(SESSION_USER_KEY);
    }
  } catch { /* private mode / storage full — cache is best-effort */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }) {
  // Hydrate from sessionStorage so a Desktop-mode reload doesn't
  // flash a signed-out UI while /auth/me re-establishes.
  const [user, setUserState] = useState(() => readCachedUser());
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((next) => {
    setUserState(next);
    writeCachedUser(next);
  }, []);

  const checkAuth = useCallback(async () => {
    // Retry /auth/me a small number of times on 401 before giving
    // up. Transient 401s show up on Android Chrome's
    // "Request Desktop Website" reload where the first request
    // races the cookie context. Any non-401 error (network, 5xx)
    // also gets one retry — we don't want a single hiccup to log
    // the user out. IMPORTANT: only retry when we have reason to
    // believe the user WAS signed in (sessionStorage cache present);
    // for truly anonymous visitors the retries just delay the
    // Sign-in button appearing on the landing page.
    const hadCachedUser = !!readCachedUser();
    const maxRetries = hadCachedUser ? ME_MAX_RETRIES : 0;
    let lastErrStatus = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
        setLoading(false);
        return;
      } catch (e) {
        lastErrStatus = e?.response?.status || null;
        // 403 (pending/rejected) is authoritative — don't retry.
        if (lastErrStatus === 403) break;
        if (attempt < maxRetries) {
          await wait(ME_RETRY_BACKOFF_MS[attempt] ?? 1600);
          continue;
        }
      }
    }
    // Only clear the cached user when /auth/me consistently says
    // we're signed out. For a 403 we ALSO clear (auth server has
    // an opinion), but for network errors we keep the cached user
    // so offline navigation still shows their name.
    if (lastErrStatus === 401 || lastErrStatus === 403) {
      setUser(null);
    }
    setLoading(false);
  }, [setUser]);

  const loginSuccess = useCallback(async (data) => {
    if (data) setUser(data);
    try {
      const { data: fresh } = await api.get("/auth/me");
      setUser(fresh);
    } catch { /* ignore — initial setUser(data) is good enough */ }
  }, [setUser]);

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
    try { await api.post("/auth/logout"); } catch (e) { void e; }
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
