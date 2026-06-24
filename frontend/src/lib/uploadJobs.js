// lib/uploadJobs.js — shared helpers for the async upload-job tracker.
//
// The upload pipeline (POST /api/books/upload/async + GET /jobs/{id})
// runs detached from the original HTTP request, so the SPA mirrors every
// in-flight job_id into localStorage.  Two consumers read this list:
//
//   1. components/UploadZone.jsx — re-attaches to unfinished jobs on
//      mount so a tab refresh doesn't abandon background uploads.
//   2. components/BackgroundJobsBell.jsx — a small navbar dropdown
//      that shows "N uploads processing" with per-job status so power
//      users dropping a folder of 100 books can tab away comfortably.
//
// To keep both consumers in sync without coupling them, every mutation
// to the localStorage list fires a `shelfsort:uploadJobsChanged` event
// on `window`.  Components listen with `subscribePendingJobs(cb)`.
const STORAGE_KEY = "shelfsort.pendingUploadJobs";
const MAX_ENTRIES = 50;
const CHANGE_EVENT = "shelfsort:uploadJobsChanged";

export function loadPendingJobs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function savePendingJobs(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* localStorage full / SSR / private mode — silently degrade */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* no window (SSR) */
  }
}

export function trackPendingJob(jobId, filename) {
  if (!jobId) return;
  const list = loadPendingJobs();
  if (list.some((j) => j.jobId === jobId)) return;
  list.push({
    jobId,
    filename: filename || "(unknown)",
    submittedAt: Date.now(),
  });
  savePendingJobs(list);
}

export function untrackPendingJob(jobId) {
  const list = loadPendingJobs().filter((j) => j.jobId !== jobId);
  savePendingJobs(list);
}

// Cross-tab AND same-tab subscription.  `storage` events only fire in
// OTHER tabs; the custom event covers the current tab too.  Returns
// an unsubscribe fn.
export function subscribePendingJobs(callback) {
  const handler = () => callback(loadPendingJobs());
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
