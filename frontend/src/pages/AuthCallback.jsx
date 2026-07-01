import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
// This callback processes the `#session_id=` fragment returned by
// auth.emergentagent.com and exchanges it for our server-side
// session_token cookie via POST /api/auth/google.
//
// 2026-06-30 — Deploy-window resilience.  If the backend pod is
// still warming up (cold-start after a deploy is 30-90s), the
// exchange may transiently return 502/503/504.  Silently bouncing
// the user back to /login makes the whole flow feel broken — the
// user rightly says "signing in with Google doesn't work every
// time we deploy".  We now:
//   * Retry the exchange up to 3 times with exponential backoff
//     (600ms → 1200ms → 2400ms) on 5xx / network errors.
//   * Surface a friendly error message + "Try again" button when
//     all retries exhaust or the failure is a 4xx (invalid
//     session_id) instead of silently redirecting.

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 600;

export default function AuthCallback() {
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();
  const hasProcessed = useRef(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = m[1];

    (async () => {
      let lastError = null;
      for (let i = 0; i < MAX_RETRIES; i += 1) {
        setAttempt(i + 1);
        try {
          const { data } = await api.post("/auth/google", { session_id });
          loginSuccess(data);
          window.history.replaceState({}, document.title, "/library");
          navigate("/library", { replace: true, state: { user: data } });
          return;
        } catch (e) {
          lastError = e;
          const status = e?.response?.status;
          // 4xx (invalid/expired session_id, verification failure) is
          // terminal — retrying won't help, so break immediately.
          if (typeof status === "number" && status >= 400 && status < 500) break;
          // 5xx or network error: back off and retry.  Skip the sleep
          // after the last attempt.
          if (i < MAX_RETRIES - 1) {
            await new Promise((res) => setTimeout(res, BASE_BACKOFF_MS * 2 ** i));
          }
        }
      }
      // eslint-disable-next-line no-console
      console.error("AuthCallback: exchange failed after retries", lastError);
      const detail = lastError?.response?.data?.detail || lastError?.message || "Sign-in couldn't complete.";
      setErrorMessage(detail);
    })();
  }, [navigate, loginSuccess]);

  if (errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper p-6" data-testid="auth-callback-error">
        <div className="max-w-md w-full bg-white border border-[#E8D89A] rounded-2xl p-6 shadow-xl">
          <h2 className="font-serif text-xl text-[#2C2C2C] mb-2">Sign-in didn&apos;t complete</h2>
          <p className="text-sm text-[#5B5F4D] mb-4">{errorMessage}</p>
          <p className="text-xs text-[#5B5F4D] mb-4">
            This can happen right after a deploy while the server is still warming
            up. Try again in a moment.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/login", { replace: true })}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-[#6B46C1] hover:bg-[#553397] text-white text-sm font-semibold"
              data-testid="auth-callback-retry"
            >
              Try signing in again
            </button>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-white hover:bg-[#FDFBF7] text-[#2C2C2C] text-sm font-semibold border border-[#E4D9C8]"
              data-testid="auth-callback-home"
            >
              Take me home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper" data-testid="auth-callback-loading">
      <div className="text-center">
        <div className="inline-block h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-[#5B5F4D] font-serif text-xl">Opening your library&hellip;</p>
        {attempt > 1 && (
          <p className="mt-2 text-xs text-[#5B5F4D]" data-testid="auth-callback-attempt">
            Attempt {attempt} of {MAX_RETRIES} &mdash; the server is warming up.
          </p>
        )}
      </div>
    </div>
  );
}
