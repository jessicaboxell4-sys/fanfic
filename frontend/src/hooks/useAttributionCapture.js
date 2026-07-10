/**
 * useAttributionCapture — fires ONCE per browser session to record
 * where this visitor came from (referrer + UTM query params).
 *
 * Storage:
 *   • localStorage.shelfsort_visitor_id — a stable UUID kept forever.
 *     The backend uses this to (a) dedupe repeated visits and (b) link
 *     anon visits to a user once they sign up.
 *   • sessionStorage.shelfsort_visit_captured — flips true after the
 *     first POST so we don't record every route change as a new visit.
 *
 * Also attaches ``X-Visitor-Session-Id: <visitor_id>`` to every axios
 * request via a one-time interceptor so the auth register/login flows
 * can promote anon attribution rows to the freshly-created user.
 */
import { useEffect } from "react";
import { api } from "../lib/api";

const VISITOR_ID_KEY = "shelfsort_visitor_id";
const CAPTURED_KEY   = "shelfsort_visit_captured";

function getOrMintVisitorId() {
  try {
    let vid = localStorage.getItem(VISITOR_ID_KEY);
    if (!vid) {
      vid = "v_" + (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(VISITOR_ID_KEY, vid);
    }
    return vid;
  } catch { return null; }
}

// One-time axios interceptor install so every request the SPA fires
// carries the visitor id — makes the auth promotion (see backend
// utils/attribution.promote_visit_to_user) automatic on register/login.
let _headerInstalled = false;
function installVisitorHeader() {
  if (_headerInstalled) return;
  const vid = getOrMintVisitorId();
  if (!vid) return;
  api.interceptors.request.use((config) => {
    config.headers = config.headers || {};
    config.headers["X-Visitor-Session-Id"] = vid;
    return config;
  });
  _headerInstalled = true;
}

function readUtmParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source:   p.get("utm_source")   || "",
      utm_medium:   p.get("utm_medium")   || "",
      utm_campaign: p.get("utm_campaign") || "",
      utm_content:  p.get("utm_content")  || "",
      utm_term:     p.get("utm_term")     || "",
    };
  } catch {
    return { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "" };
  }
}

export function useAttributionCapture() {
  useEffect(() => {
    installVisitorHeader();
    try {
      if (sessionStorage.getItem(CAPTURED_KEY) === "1") return;
    } catch { /* private-mode etc — just proceed */ }

    const vid = getOrMintVisitorId();
    if (!vid) return;
    const payload = {
      session_id:   vid,
      referrer_url: document.referrer || "",
      landing_path: window.location.pathname || "/",
      ...readUtmParams(),
    };
    api.post("/analytics/visit", payload)
      .then(() => { try { sessionStorage.setItem(CAPTURED_KEY, "1"); } catch { /* private mode */ } })
      .catch(() => { /* silent — attribution is best-effort */ });
  }, []);
}

export default useAttributionCapture;
