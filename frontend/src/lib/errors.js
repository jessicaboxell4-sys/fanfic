// Axios error humanization — pure logic extracted from api.js so it can
// be unit-tested without pulling axios's ESM through Jest's transformer.
//
// Bug context (2026-08-24) — 27 EPUB uploads failed with the raw text
//   "Cannot create property 'detail' on string 'upstream connect error
//    or disconnect/reset before headers. reset reason: connection
//    termination'"
// leaking into the FailedUploadsList banner.  Root cause: the original
// interceptor guarded `if (!err.response.data) …` which only replaced
// falsy bodies.  Envoy / Cloudflare / nginx return 5xx bodies as plain
// TEXT ("upstream connect error…"), which is truthy, so the guard
// skipped and the next `.detail = friendly` assignment threw a
// TypeError on the string primitive in strict mode.  That TypeError
// bubbled to UploadZone.jsx's `.catch`, whose `lastErr.message`
// fallback surfaced the exception text into the user-visible list.
//
// See /app/frontend/src/lib/errors.test.js for the regression suite.

export const HUMANIZED_5XX = {
  500: "Something went wrong on our end. Please try again in a moment — and if it keeps happening, drop us a note via Help → Feedback.",
  502: "We couldn't reach our servers just now — they may be restarting. Try again in 30 seconds.",
  503: "Shelfsort is temporarily busy. Please try again in a moment.",
  504: "The request took too long. We're working on speeding it up — please try again.",
};

export const OPAQUE_DETAIL = /^\s*(internal server error|request failed with status code|bad gateway|service unavailable|gateway timeout)/i;

// Mutates `err` in place; also returns it for convenience.
export function humanizeAxiosError(err) {
  const status = err?.response?.status;
  if (typeof status === "number" && status >= 500 && status < 600) {
    const existing = err.response?.data?.detail;
    // Keep the backend's message when it's clearly a custom one
    // (e.g. "Calibre crashed on this EPUB").  Only rewrite the
    // opaque defaults that ship from FastAPI / Cloudflare.
    const isOpaque = !existing || (typeof existing === "string" && OPAQUE_DETAIL.test(existing));
    if (isOpaque) {
      const friendly = HUMANIZED_5XX[status] || `Server hiccup (HTTP ${status}). Please try again in a moment.`;
      // Coerce ANY non-object body (string, number, array) to a
      // fresh {} before assigning .detail — see file-level comment.
      if (!err.response.data || typeof err.response.data !== "object" || Array.isArray(err.response.data)) {
        err.response.data = {};
      }
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
  return err;
}
