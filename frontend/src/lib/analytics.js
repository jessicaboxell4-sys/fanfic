/**
 * Lightweight cookie-consent + analytics view-stamping helpers.
 *
 * EU visitors see a small consent banner before any analytics
 * cookie is set.  Once they consent (or are already authenticated),
 * `stampView()` POSTs to `/api/analytics/view` so the SPA pages
 * feed the same funnel as the server-rendered `/api/share/*` pages.
 */
import { api } from "./api";

const CONSENT_KEY = "shelfsort-analytics-consent";

export function hasAnalyticsConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "yes";
  } catch { return false; }
}

export function grantAnalyticsConsent() {
  try { localStorage.setItem(CONSENT_KEY, "yes"); } catch { /* private mode */ }
}

export function denyAnalyticsConsent() {
  try { localStorage.setItem(CONSENT_KEY, "no"); } catch { /* private mode */ }
}

export function consentDecisionMade() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "yes" || v === "no";
  } catch { return false; }
}

/**
 * Best-effort view stamp.  No-ops if the user explicitly declined
 * analytics.  Authenticated users always opt-in via login.
 */
export async function stampView(pageType, slug = "") {
  try {
    // If the user explicitly denied, skip.  Otherwise stamp — the
    // server-side hash dedupe means repeat fires inside 30 min are
    // free.
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === "no") return;
    await api.post("/analytics/view", { page_type: pageType, slug });
  } catch { /* non-blocking */ }
}
