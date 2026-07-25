// 2026-08-27 — Opt-in per-upload diagnostic logging.
//
// USAGE (from browser DevTools console):
//   window.__shelfsort_upload_debug__ = true    // start capturing
//   // ... reproduce the bug ...
//   window.__shelfsort_upload_export__()        // copies log to clipboard as JSON
//   window.__shelfsort_upload_debug__ = false   // stop capturing
//
// The helper is DELIBERATELY zero-cost when disabled — the flag check
// short-circuits before any object construction, so a 2,000-file batch
// with debug off pays only 2,000 boolean reads (a few microseconds
// total).  When enabled we ring-buffer the last 1,000 events on
// `window.__shelfsort_upload_log__` so a long batch doesn't fill up
// memory forever.

const MAX_LOG_ENTRIES = 1000;

function ensureRing() {
  if (typeof window === "undefined") return null;
  if (!Array.isArray(window.__shelfsort_upload_log__)) {
    window.__shelfsort_upload_log__ = [];
  }
  return window.__shelfsort_upload_log__;
}

/** Log a diagnostic event.  No-op unless `window.__shelfsort_upload_debug__` is truthy. */
export function dbg(event, payload = {}) {
  if (typeof window === "undefined") return;
  if (!window.__shelfsort_upload_debug__) return;
  const ring = ensureRing();
  const entry = {
    t: Date.now(),
    tsIso: new Date().toISOString(),
    event,
    ...payload,
  };
  if (ring) {
    ring.push(entry);
    if (ring.length > MAX_LOG_ENTRIES) ring.shift();
  }
  // Console output for real-time debugging.  Using `debug` (not warn)
  // so the DevTools "Verbose" filter can hide it in noisy sessions.
  // eslint-disable-next-line no-console
  console.debug(`[shelfsort-upload] ${event}`, payload);
}

// One-shot copy helper — attach to window for easy console access.
if (typeof window !== "undefined") {
  window.__shelfsort_upload_export__ = async () => {
    const ring = window.__shelfsort_upload_log__ || [];
    const json = JSON.stringify(ring, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        // eslint-disable-next-line no-console
        console.info(`[shelfsort-upload] ${ring.length} log entries copied to clipboard.`);
      } else {
        // eslint-disable-next-line no-console
        console.info("[shelfsort-upload] Clipboard blocked — log below:");
        // eslint-disable-next-line no-console
        console.info(json);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[shelfsort-upload] Couldn't copy to clipboard:", e);
    }
    return ring;
  };
  window.__shelfsort_upload_clear__ = () => {
    window.__shelfsort_upload_log__ = [];
    // eslint-disable-next-line no-console
    console.info("[shelfsort-upload] Log cleared.");
  };
}

export default dbg;
