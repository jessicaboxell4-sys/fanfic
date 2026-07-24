import axios from "axios";
import { humanizeAxiosError } from "./errors";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// 2026-07-10 — Send the current frontend route on every authenticated
// request so the backend presence-touch (auth_dep._touch_last_seen)
// can stamp ``users.last_seen_path`` with a HUMAN-readable location
// like ``/library/all`` instead of the internal API path
// ``/api/library/books``.  Admins see this in the Users & admins card
// next to the online pill.  Falls back gracefully on SSR / non-window
// contexts (never throws).
api.interceptors.request.use((config) => {
  try {
    if (typeof window !== "undefined" && window.location?.pathname) {
      config.headers = config.headers || {};
      config.headers["X-Client-Path"] = window.location.pathname;
    }
  } catch { /* fire-and-forget — presence path is nice-to-have */ }
  return config;
});

// 2026-06-30 — Global 5xx humanizer.  Without this, callers that
// fall through to `e?.response?.data?.detail || "Couldn't X"` end
// up surfacing the bare axios string "Request failed with status
// code 500" — exactly what user "WinterDev" reported as feedback
// "Clarify":
//   "I keep getting error code 500. But I don't know what that
//    is, and I can't see anything that give ideas on how to fix it"
// The interceptor rewrites the `detail` field on the response body
// for 5xx + Cloudflare gateway statuses so every existing toast
// reads as something a non-technical user can act on, without
// touching the 147 individual `.catch()` blocks scattered across
// components.  4xx responses are left untouched — those usually
// carry a meaningful FastAPI `detail` we want callers to see.
//
// 2026-08-24 — Extracted the pure logic to ./errors.js so the Jest
// suite can import it without pulling axios's ESM through Jest's
// transformer.  See errors.test.js for regression coverage.

api.interceptors.response.use(
  (r) => r,
  (err) => Promise.reject(humanizeAxiosError(err)),
);
// Re-export for existing callers that may `import { humanizeAxiosError } from "./api"`.
export { humanizeAxiosError };
