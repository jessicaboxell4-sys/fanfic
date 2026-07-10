// AppErrorBoundary — catches any uncaught render/render-lifecycle
// error in the wrapped subtree and surfaces a friendly recovery
// screen instead of letting the whole tab go blank.
//
// 2026-06-30 — Added in response to user feedback:
//   "intro tour keeps crashing out on page of 6/9. The screen just
//    goes blank and a refresh starts back at the beginning."
// The tour navigates between routes, and when any destination page
// throws during render (a null context, a missing key in user-pref
// data, etc.) React's default behavior is to unmount the entire
// tree.  Without this boundary the user sees a blank document and
// can't even hit Skip.  With it, they see a soft "Something went
// wrong" panel and a Reload button — and the originating error
// (component stack + message) gets POSTed to
// /api/analytics/client-errors so we can pinpoint the crash
// from the admin telemetry dashboards.

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error, info: null };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Best-effort telemetry — never re-throw from here.
    try {
      const payload = {
        message: String(error?.message || error || "(unknown error)").slice(0, 500),
        stack: String(error?.stack || "").slice(0, 4000),
        component_stack: String(info?.componentStack || "").slice(0, 4000),
        href: typeof window !== "undefined" ? window.location.href : "",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        captured_at: new Date().toISOString(),
      };
      api.post("/analytics/client-errors", payload).catch(() => {});
    } catch {
      /* swallow */
    }
    // Also echo to console so devs can see it during local sessions.
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error, info);
  }

  resetAndReload = () => {
    // Clearing the tour-step so the next mount doesn't immediately
    // re-trigger the crashing step (in case the tour was the
    // navigation source).
    try {
      window.localStorage.removeItem("shelfsort_tour_step");
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  resetGoHome = () => {
    try {
      window.localStorage.removeItem("shelfsort_tour_step");
    } catch {
      /* ignore */
    }
    window.location.assign("/library");
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error || "");
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 bg-[#FBF7EE]"
        data-testid="app-error-boundary"
      >
        <div className="max-w-md w-full bg-white border border-[#E8D89A] rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#A03D33]" />
            <h2 className="font-serif text-xl text-[#2C2C2C]">Something went sideways</h2>
          </div>
          <p className="text-sm text-[#5B5F4D] mb-4 leading-relaxed">
            Shelfsort hit an unexpected error while drawing this page. Your
            library and books are safe &mdash; this only affects what you can see
            right now. We&apos;ve logged the details so we can fix the root cause.
          </p>
          {msg && (
            <p
              className="text-xs text-[#A03D33] bg-[#FBE7E4] border border-[#E07A5F]/30 rounded-md p-2 mb-4 font-mono break-all"
              data-testid="app-error-boundary-message"
            >
              {msg}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.resetAndReload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6B46C1] hover:bg-[#553397] text-white text-sm font-semibold"
              data-testid="app-error-boundary-reload"
            >
              <RefreshCw className="w-4 h-4" />
              Reload this page
            </button>
            <button
              type="button"
              onClick={this.resetGoHome}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-white hover:bg-[#FDFBF7] text-[#2C2C2C] text-sm font-semibold border border-[#E4D9C8]"
              data-testid="app-error-boundary-home"
            >
              Take me home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
