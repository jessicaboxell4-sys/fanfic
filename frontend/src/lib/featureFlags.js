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
