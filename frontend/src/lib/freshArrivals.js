// lib/freshArrivals.js — small client-only tracker for "books that just
// landed in your library this session".  Used to:
//
//   1. Pulse the freshly-added card in any library grid (BookCard reads
//      `isBookFresh(book_id)` on mount and applies a 3s coral-border
//      animation).
//   2. Power the "View all N new books" link in the BackgroundJobsBell
//      panel — the bell calls `markBookFresh()` for every job that
//      transitions to "done", then composes the link from the current
//      fresh set.
//
// sessionStorage (not localStorage) because "fresh" is a per-session
// notion — a tab reopened a day later shouldn't suddenly pulse books
// the user added last week.  Entries auto-expire after 30s so the pulse
// is a brief celebration, not a permanent badge.
const KEY = "shelfsort.freshArrivals";
const EVENT = "shelfsort:bookJustAdded";
const STALE_MS = 30000;

function _load() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function _save(obj) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* sessionStorage unavailable — degrade silently */
  }
}

function _sweepStale(obj) {
  const out = {};
  const now = Date.now();
  for (const id of Object.keys(obj)) {
    if (now - obj[id] < STALE_MS) out[id] = obj[id];
  }
  return out;
}

export function markBookFresh(bookId) {
  if (!bookId) return;
  const all = _sweepStale(_load());
  all[bookId] = Date.now();
  _save(all);
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { bookId } }));
  } catch {
    /* no window — SSR */
  }
}

export function isBookFresh(bookId) {
  if (!bookId) return false;
  const ts = _load()[bookId];
  return Boolean(ts && Date.now() - ts < STALE_MS);
}

export function getFreshIds() {
  return Object.keys(_sweepStale(_load()));
}

export function clearFreshArrivals() {
  _save({});
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { cleared: true } }));
  } catch {
    /* SSR */
  }
}

export function subscribeFreshArrivals(callback) {
  const handler = (e) => callback(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
