/**
 * useVerdictTaxonomy — fetch /api/verdicts/taxonomy once per session.
 *
 * The taxonomy is the canonical lookup table for reading-state +
 * verdict labels/emojis (built-ins + the user's custom slots).
 * Backend is the source of truth; we don't ship a parallel FE
 * constants file so adding a new built-in slot doesn't require a
 * coordinated deploy.
 *
 * Cached at module level so every component on the library page
 * shares the same fetch (one HTTP request total for the whole
 * session unless the user adds/deletes a custom verdict, in which
 * case we expose a manual `refresh()`).
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

let _cache = null;
let _inflight = null;
const _subscribers = new Set();

function _notify() {
  for (const setter of _subscribers) {
    setter(_cache);
  }
}

async function _fetch() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = api.get("/verdicts/taxonomy").then(({ data }) => {
    _cache = data;
    _inflight = null;
    _notify();
    return data;
  }).catch((e) => {
    _inflight = null;
    throw e;
  });
  return _inflight;
}

export function useVerdictTaxonomy() {
  const [tax, setTax] = useState(_cache);
  useEffect(() => {
    _subscribers.add(setTax);
    if (!_cache) _fetch().catch(() => {});
    return () => { _subscribers.delete(setTax); };
  }, []);
  const refresh = useCallback(async () => {
    _cache = null;
    return _fetch();
  }, []);
  return { taxonomy: tax, refresh };
}

/**
 * Convenience lookup helpers — return {key, label, emoji} for any
 * verdict or reading-state key.  Returns a defensive fallback so an
 * orphaned key (e.g. custom_xyz that was deleted on another device)
 * still renders as a neutral chip instead of crashing the card.
 */
export function lookupVerdict(taxonomy, key) {
  if (!taxonomy || !key) return null;
  const hit = (taxonomy.builtin_verdicts || []).find((v) => v.key === key)
    || (taxonomy.custom_verdicts || []).find((v) => v.key === key);
  return hit || { key, label: key.replace(/^custom_/, "").replace(/_/g, " "), emoji: "🏷️" };
}

export function lookupReadingState(taxonomy, key) {
  if (!taxonomy || !key) return null;
  return (taxonomy.reading_states || []).find((s) => s.key === key) || null;
}
