/**
 * Nudge preference registry (2026-07-12).
 *
 * Central list of every "small dopamine hit" the app is allowed to trigger
 * for the user — celebration toasts, streak badges, gentle reminders, etc.
 * Every entry here is:
 *   - Rendered in `NudgePreferencesCard` on the admin console.
 *   - Consumed via `getNudgePref(key)` from the specific feature.
 *
 * To add a new nudge:
 *   1. Append one entry to `NUDGE_PREFS`.
 *   2. Read it in your feature with `getNudgePref("your_key")`.
 * That's it — the toggle UI is generated automatically.
 *
 * Storage is browser-local; no server round-trip.  We fire a custom
 * `nudge-pref-change` window event on every write so cards mounted in
 * the same tab can react without needing a full reload.
 */

export const NUDGE_PREFS = [
  {
    key: "celebrate_clean_duplicates",
    localStorageKey: "shelfsort.diagnostics.celebrate",
    label: "Celebrate when duplicates hit zero",
    description:
      "Fire a 🎉 toast the moment your Library Diagnostics card shows 0 excess duplicates.",
    default: true,
    category: "Library upkeep",
  },
  // Future nudges slot in here.  One entry = one toggle.
];

const CHANGE_EVENT = "nudge-pref-change";

function findDef(key) {
  return NUDGE_PREFS.find((p) => p.key === key) || null;
}

export function getNudgePref(key) {
  const def = findDef(key);
  if (!def) return null;
  try {
    const raw = window.localStorage.getItem(def.localStorageKey);
    if (raw === null) return def.default;
    return raw === "1";
  } catch {
    return def.default;
  }
}

export function setNudgePref(key, value) {
  const def = findDef(key);
  if (!def) return;
  try {
    window.localStorage.setItem(def.localStorageKey, value ? "1" : "0");
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { key, value } }),
    );
  } catch {
    /* localStorage unavailable — silent */
  }
}

/**
 * Subscribe to nudge-pref changes.  Returns an unsubscribe function.
 * The callback receives `(key, value)` on every write in the current tab.
 */
export function subscribeToNudgePrefs(callback) {
  const handler = (e) => {
    const detail = (e && e.detail) || {};
    callback(detail.key, detail.value);
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
