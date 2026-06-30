import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
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

const HUMANIZED_5XX = {
  500: "Something went wrong on our end. Please try again in a moment — and if it keeps happening, drop us a note via Help → Feedback.",
  502: "We couldn't reach our servers just now — they may be restarting. Try again in 30 seconds.",
  503: "Shelfsort is temporarily busy. Please try again in a moment.",
  504: "The request took too long. We're working on speeding it up — please try again.",
};
const OPAQUE_DETAIL = /^\s*(internal server error|request failed with status code|bad gateway|service unavailable|gateway timeout)/i;

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    if (typeof status === "number" && status >= 500 && status < 600) {
      const existing = err.response?.data?.detail;
      // Keep the backend's message when it's clearly a custom one
      // (e.g. ``"Calibre crashed on this EPUB"``).  Only rewrite the
      // opaque defaults that ship from FastAPI / Cloudflare.
      const isOpaque = !existing || (typeof existing === "string" && OPAQUE_DETAIL.test(existing));
      if (isOpaque) {
        const friendly = HUMANIZED_5XX[status] || `Server hiccup (HTTP ${status}). Please try again in a moment.`;
        if (!err.response.data) err.response.data = {};
        err.response.data.detail = friendly;
        // axios's default `.message` also leaks "Request failed with
        // status code 500" into uncaught toasts; rewrite that too.
        err.message = friendly;
      }
    } else if (!err.response) {
      // Network error (offline, DNS, CORS preflight failure).  axios
      // gives us `err.message = "Network Error"` which is just as
      // opaque as "Error 500" for end users.
      if (!err.message || /^Network Error$/i.test(err.message)) {
        err.message = "Couldn't reach Shelfsort — check your connection and try again.";
      }
    }
    return Promise.reject(err);
  },
);
