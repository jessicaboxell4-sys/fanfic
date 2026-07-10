import React, { useEffect, useState } from "react";
import { Cookie, X } from "lucide-react";
import {
  hasAnalyticsConsent,
  grantAnalyticsConsent,
  denyAnalyticsConsent,
  consentDecisionMade,
} from "../lib/analytics";

/**
 * Tiny consent banner that pops on first visit to a public page
 * (explore / cover detail / profile) for visitors who haven't made
 * a choice yet.  We don't try to be GDPR-perfect; we offer a clear
 * Accept / Decline + a no-op dismiss-by-clicking-X.  The choice is
 * persisted in localStorage.
 */
export default function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!consentDecisionMade()) setShow(true);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  const accept = () => { grantAnalyticsConsent(); setShow(false); };
  const decline = () => { denyAnalyticsConsent(); setShow(false); };

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[calc(100%-1.5rem)] bg-[#2C2C2C] text-white rounded-2xl shadow-2xl p-4 sm:p-5 flex items-start gap-3"
      role="dialog"
      aria-live="polite"
      data-testid="consent-banner"
    >
      <Cookie className="w-5 h-5 text-[#FDF3E1] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          We count anonymous page views to see which covers get the
          most traction.  No tracking pixels, no third parties — just
          a hashed visit count.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={accept}
            className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#553397]"
            data-testid="consent-accept"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={decline}
            className="px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/20"
            data-testid="consent-decline"
          >
            Decline
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="text-white/60 hover:text-white"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
