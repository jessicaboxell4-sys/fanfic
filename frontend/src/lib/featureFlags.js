// Centralized UI feature flags.
//
// Flipping a flag to `true` re-enables the matching UI surface without
// touching backend code. Backend endpoints stay live regardless — these
// only gate what's rendered to the user.

// Master switch for the URL→EPUB fetching UI (FanFicFare + FicHub). When
// `false`, every entry point that triggers a fanfic-source fetch is hidden:
//   * Navbar "Quick add" URL slot
//   * Global paste-to-fetch toast detector
//   * FilterUrlList inline "want EPUB?" prompt
//   * FilterUrlList "Pull N URLs into library" button + result panel
//   * Account → FanFicFare options card (incl. FicHub fallback toggle)
//   * Dashboard "Refresh all from source" banner
//   * BookDetail "Refresh from source" button
//   * Navbar UpdatesBell (driven by refresh-all events)
// The URL dedupe / Excel export on FilterUrlList stays visible — it never
// hits the source sites.
export const FETCHING_UI_ENABLED = false;

// Send-to-Kindle UI master switch (added 2026-06-22). Each Kindle send
// burns 1 Resend daily-quota slot (the EPUB is delivered as an email
// attachment to Amazon's @kindle.com gateway — that's Amazon's only
// personal-documents API). With Resend on the free tier (100/day), an
// always-visible button on every book invited quota cliffs the operator
// can't easily forecast. Flipping this to `true` re-enables:
//   * Orange "Send to Kindle" button on every BookDetail page
//   * "Send to Kindle" card on /account (Kindle email setting + sender
//     reminder)
//   * "Send to Kindle" section in /help
// Backend endpoints (POST /api/books/{id}/send-to-kindle, GET/PUT
// /api/user/kindle-settings) stay live regardless of this flag — this
// only gates user-facing UI surfaces. The feature also has a real
// backend feature flag (``send_to_kindle_enabled`` in feature_flags.py)
// that an admin can flip at runtime from /admin → Feature flags; that
// one blocks the API endpoint itself. This client-side constant is the
// "design-time hide" so end-users don't see a button that 502s.
export const SEND_TO_KINDLE_UI_ENABLED = false;
