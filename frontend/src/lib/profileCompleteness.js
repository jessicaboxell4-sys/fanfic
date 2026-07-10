// Shared helpers for the iter-57 profile-completeness flow.
// Used by ProfileCompletenessCard on /account and the toast logic
// in Account.jsx + PrivacyMessagingCard.

// Score formula: handle + bio + library_visible_to_public (max 3).
// Display name doesn't count — it auto-fills from sign-up and isn't
// a discoverability dimension on its own.
export function computeCompletenessScore(input) {
  if (!input) return 0;
  const hasHandle = !!((input.username || "").trim());
  const hasBio = !!((input.bio || "").trim());
  const isPublic = !!input.library_visible_to_public;
  return (hasHandle ? 1 : 0) + (hasBio ? 1 : 0) + (isPublic ? 1 : 0);
}

// Per-dimension labels for the meter dots + toast bodies.
export const COMPLETENESS_DIMS = [
  { key: "handle",  label: "Claim a handle",        cta: "/account#profile" },
  { key: "bio",     label: "Add a bio",             cta: "/account#profile" },
  { key: "public",  label: "Share library publicly", cta: "/account#privacy" },
];

// Returns which dimensions are still missing (label-only).
export function missingDimensions(input) {
  if (!input) return COMPLETENESS_DIMS.map((d) => d.label);
  const hasHandle = !!((input.username || "").trim());
  const hasBio = !!((input.bio || "").trim());
  const isPublic = !!input.library_visible_to_public;
  const out = [];
  if (!hasHandle) out.push(COMPLETENESS_DIMS[0]);
  if (!hasBio)    out.push(COMPLETENESS_DIMS[1]);
  if (!isPublic)  out.push(COMPLETENESS_DIMS[2]);
  return out;
}

// Custom DOM event used by save handlers to tell the meter to
// re-fetch /auth/me without us having to lift state up to the
// Account-page root.  Pass the new score so the meter can also
// drive the "Almost there!" toast in a single place.
export const COMPLETENESS_EVENT = "shelfsort:profile-completeness-changed";

export function emitCompletenessChange(detail) {
  try {
    window.dispatchEvent(new CustomEvent(COMPLETENESS_EVENT, { detail: detail || {} }));
  } catch { /* SSR / private mode */ }
}
