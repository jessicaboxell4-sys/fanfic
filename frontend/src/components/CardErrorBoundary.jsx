// components/CardErrorBoundary.jsx
//
// Section-level error boundary for AdminConsole.
//
// The full-page AppErrorBoundary catches uncaught render errors and
// shows the "Something went sideways" screen — but on /admin one
// crashing card (see iter 102 for the EmailStatsCard `load` bug) took
// down the entire operator console, blocking triage of every OTHER
// card.  This narrower boundary wraps each card individually so a
// single defect degrades gracefully to an inline "This card failed to
// load" note, and the rest of the console renders normally.
//
// Reports the same telemetry as AppErrorBoundary
// (POST /api/analytics/client-errors) so we still see it in the
// admin crash-pulse dashboard.

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

export default class CardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      api.post("/analytics/client-errors", {
        message: String(error?.message || error || "(unknown)").slice(0, 500),
        stack: String(error?.stack || "").slice(0, 4000),
        component_stack: String(info?.componentStack || "").slice(0, 4000),
        href: typeof window !== "undefined" ? window.location.href : "",
        card_id: this.props.cardId || "(unknown card)",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        captured_at: new Date().toISOString(),
        scope: "admin-card",
      }).catch(() => {});
    } catch { /* swallow */ }
    // eslint-disable-next-line no-console
    console.error(`CardErrorBoundary[${this.props.cardId}] caught:`, error, info);
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error || "");
    const cardId = this.props.cardId || "unknown";
    return (
      <div
        className="shelf-card p-4 border border-[#E8D89A] bg-[#FDF8E7]"
        data-testid={`admin-card-error-${cardId}`}
        data-card-id={cardId}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#A03D33] flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-serif text-base text-[#2C2C2C]">
              This card failed to load
            </p>
            <p className="text-xs text-[#5B5F4D] mt-0.5 mb-2">
              <span className="font-mono">{cardId}</span> threw an unhandled
              error. Everything else on this page is fine — you can keep
              working. We&apos;ve logged the details so it can be fixed.
            </p>
            <p
              className="text-xs text-[#A03D33] bg-[#FBE7E4] border border-[#E07A5F]/30 rounded-md p-2 font-mono break-all mb-2"
              data-testid={`admin-card-error-${cardId}-message`}
            >
              {msg}
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 text-xs text-[#6B46C1] hover:underline"
              data-testid={`admin-card-error-${cardId}-retry`}
            >
              <RefreshCw className="w-3 h-3" />
              Try rendering it again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
