import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, UploadCloud, CheckCircle2, XCircle, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  loadPendingJobs,
  subscribePendingJobs,
  untrackPendingJob,
} from "../lib/uploadJobs";

// Navbar dropdown that surfaces in-flight async uploads — the same list
// the resume-after-refresh effect re-attaches to on mount.  Users who
// drop a folder of 100 books and switch tabs would otherwise have no
// signal that the backend is still chewing through their drop.  Now
// they do.
//
// Renders nothing when there are no pending jobs (no visual clutter on
// 99% of pageviews).  When jobs exist, the bell shows a count badge
// and a panel with per-job status.  Beyond the basic display, this
// component also:
//
//   a) fires a cross-page completion toast whenever a job transitions
//      to "done" — so a user who started an upload on /library/all
//      then navigated to /account still sees "📚 N books just
//      finished uploading" wherever they are;
//   b) reflects the active count in document.title — "(3) Shelfsort"
//      — so users who tabbed away to another browser tab notice the
//      progress changing in their tab list;
//   c) makes finished rows clickable — click a completed job to land
//      on the new book's detail page;
//   d) auto-removes "done" entries after 30s so the list stays focused
//      on what's still running (failures stick around — the user
//      needs to act on them).

const POLL_INTERVAL_MS = 3000;
const AUTOCLEAR_DELAY_MS = 30000;

// Foreground tracking: how often do we poll even when the panel is
// CLOSED?  We need a slower background poll so the completion toast +
// document.title fires for users who never open the dropdown.  10s is
// gentle enough not to hammer the API while still feeling responsive.
const BACKGROUND_POLL_MS = 10000;

export default function BackgroundJobsBell() {
  const [jobs, setJobs] = useState(() => loadPendingJobs());
  const [open, setOpen] = useState(false);
  // {jobId: {status, error, response}} — `response` is captured so
  // we can navigate to the resulting book on click.
  const [statuses, setStatuses] = useState({});
  const popoverRef = useRef(null);

  // Set of jobIds we've already fired a completion toast for, so a
  // single completion doesn't spam the user on every subsequent poll.
  const toastedRef = useRef(new Set());
  // Set of jobIds we've scheduled for auto-removal — avoids stacking
  // multiple setTimeouts on the same finished job across polls.
  const autoClearRef = useRef(new Map());

  // Keep `jobs` in sync with the localStorage list.  Fires on the
  // shelfsort:uploadJobsChanged event (same-tab) and the storage event
  // (cross-tab).
  useEffect(() => {
    const unsub = subscribePendingJobs(setJobs);
    return unsub;
  }, []);

  // Single poll function — shared between the foreground (panel open,
  // every 3s) and background (panel closed, every 10s) loops.  Pulls
  // status for every tracked job and side-effects:
  //   - new "done"   → toast + capture book payload + auto-clear timer
  //   - new "failed" → toast (NOT auto-cleared; user needs to act)
  //   - 404          → drop from localStorage silently (TTL'd)
  const pollAll = useCallback(async (snapshot) => {
    if (snapshot.length === 0) return;
    const next = {};
    await Promise.all(snapshot.map(async (j) => {
      try {
        const { data } = await api.get(`/books/upload/jobs/${j.jobId}`);
        next[j.jobId] = {
          status: data.status,
          error: data.error || null,
          response: data.response || null,
        };
        // First-time transition handling.
        if (data.status === "done" && !toastedRef.current.has(j.jobId)) {
          toastedRef.current.add(j.jobId);
          const books = (data.response?.books) || [];
          const firstBook = books.find((b) => !b.failed) || null;
          toast.success(
            books.length > 1
              ? `📚 ${books.length} books just finished uploading`
              : `📚 ${firstBook?.title || j.filename || "Upload"} just finished`,
            {
              duration: 7000,
              action: firstBook?.book_id ? {
                label: "Open",
                onClick: () => {
                  window.location.href = `/book/${firstBook.book_id}`;
                },
              } : undefined,
            },
          );
          // Schedule auto-clear from the panel after 30s.  Stash the
          // timer ID so the cleanup effect can cancel it if the
          // component unmounts.
          if (!autoClearRef.current.has(j.jobId)) {
            const tid = setTimeout(() => {
              untrackPendingJob(j.jobId);
              autoClearRef.current.delete(j.jobId);
            }, AUTOCLEAR_DELAY_MS);
            autoClearRef.current.set(j.jobId, tid);
          }
        } else if (data.status === "failed" && !toastedRef.current.has(j.jobId)) {
          toastedRef.current.add(j.jobId);
          toast.error(
            `Upload failed: ${j.filename}`,
            { duration: 9000, description: data.error || undefined },
          );
        }
      } catch (e) {
        const s = e?.response?.status;
        if (s === 404) {
          // Backend forgot the job (TTL) — drop locally and don't
          // bother the user.
          untrackPendingJob(j.jobId);
        } else {
          next[j.jobId] = { status: "unknown", error: null, response: null };
        }
      }
    }));
    setStatuses((prev) => ({ ...prev, ...next }));
  }, []);

  // Foreground loop: while panel is open, poll fast for snappy live
  // status.  Closed = no foreground polling; the background loop below
  // covers it at a gentler rate.
  useEffect(() => {
    if (!open || jobs.length === 0) return undefined;
    pollAll(jobs);
    const id = setInterval(() => pollAll(jobs), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [open, jobs, pollAll]);

  // Background loop: ALWAYS running while there are tracked jobs,
  // regardless of panel state.  This is what makes (a) and (b) work
  // when the user is on a different page or has the bell closed —
  // we still need to fire the completion toast and update the tab
  // title even if they never open the dropdown.
  useEffect(() => {
    if (jobs.length === 0) return undefined;
    const id = setInterval(() => pollAll(jobs), BACKGROUND_POLL_MS);
    return () => clearInterval(id);
  }, [jobs, pollAll]);

  // (b) Document title indicator.  Reflects the number of jobs still
  // queued or processing into the browser tab title so users who
  // tabbed away notice activity in the tab list.  Restores the
  // original title when the active count returns to zero / on unmount.
  useEffect(() => {
    const activeCount = jobs.filter((j) => {
      const s = statuses[j.jobId]?.status;
      return !s || s === "queued" || s === "processing" || s === "unknown";
    }).length;
    if (activeCount === 0) return undefined;
    const previous = document.title;
    // Strip any existing "(N) " prefix from a prior render so we don't
    // stack them.
    const stripped = previous.replace(/^\(\d+\)\s*/, "");
    document.title = `(${activeCount}) ${stripped}`;
    return () => {
      // Re-strip on cleanup in case another effect updated the title
      // in the meantime.
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, [jobs, statuses]);

  // Cleanup auto-clear timers on unmount so they don't fire after the
  // user logged out / navigated away.
  useEffect(() => {
    const timers = autoClearRef.current;
    return () => {
      timers.forEach((tid) => clearTimeout(tid));
      timers.clear();
    };
  }, []);

  // Close the popover on outside-click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (jobs.length === 0) return null;

  // Active = anything that isn't done/failed.  The badge shows this
  // count because users only care about what's still in flight.
  const activeCount = jobs.filter((j) => {
    const s = statuses[j.jobId]?.status;
    return !s || s === "queued" || s === "processing" || s === "unknown";
  }).length;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="navbar-bgjobs-toggle"
        className="p-2 hover:bg-[#F5F3EC] rounded-lg relative"
        title={`${jobs.length} background upload${jobs.length === 1 ? "" : "s"}`}
        aria-expanded={open}
        aria-label={`${jobs.length} background uploads`}
      >
        <UploadCloud className="w-4 h-4 text-[#6B705C]" />
        {activeCount > 0 && (
          <span
            data-testid="navbar-bgjobs-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E07A5F] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#FDFBF7]"
          >
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="navbar-bgjobs-panel"
          className="absolute right-0 top-full mt-2 w-80 max-h-[60vh] overflow-y-auto bg-white rounded-xl shadow-lg border border-[#E8E6E1] z-50"
        >
          <div className="px-4 py-2.5 border-b border-[#E8E6E1] flex items-center justify-between">
            <span className="font-serif text-sm font-medium text-[#2C2C2C]">
              Background uploads
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C]">
              {jobs.length} total
            </span>
          </div>
          <ul className="divide-y divide-[#F0EDE5]">
            {jobs.map((j) => {
              const st = statuses[j.jobId] || {};
              const status = st.status || "queued";
              const isDone = status === "done";
              const isFailed = status === "failed";
              const isActive = !isDone && !isFailed;
              // (c) — when done, the first successful book in the
              // response payload gives us a book_id we can navigate
              // to.  Fall back to filename label when not present
              // (e.g. fanfic URL list responses).
              const books = (st.response?.books) || [];
              const firstBook = books.find((b) => !b.failed) || null;
              const goHref = isDone && firstBook?.book_id
                ? `/book/${firstBook.book_id}`
                : null;
              const RowWrap = goHref ? Link : "div";
              const wrapProps = goHref
                ? { to: goHref, onClick: () => setOpen(false) }
                : {};
              return (
                <li
                  key={j.jobId}
                  data-testid={`bgjobs-row-${j.jobId}`}
                  className={`relative ${isDone ? "hover:bg-[#FAF6EE]" : ""}`}
                >
                  <RowWrap
                    {...wrapProps}
                    className="block px-4 py-2.5 flex items-center gap-2.5"
                  >
                    <div className="shrink-0">
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                      {isActive && <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#2C2C2C] truncate" title={j.filename}>
                        {isDone && firstBook?.title ? firstBook.title : j.filename}
                      </p>
                      <p className="text-xs text-[#6B705C]">
                        {isDone && (goHref ? "Tap to open →" : "Finished")}
                        {isFailed && (st.error ? `Failed — ${st.error}` : "Failed")}
                        {status === "queued" && "Queued"}
                        {status === "processing" && "Processing…"}
                        {status === "unknown" && "Checking…"}
                      </p>
                    </div>
                    {/* Manual dismiss for failed rows — they don't
                        auto-clear so the user can still see why,
                        but a one-click X removes them once
                        acknowledged. */}
                    {isFailed && (
                      <button
                        type="button"
                        data-testid={`bgjobs-dismiss-${j.jobId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          untrackPendingJob(j.jobId);
                        }}
                        className="shrink-0 p-1 rounded hover:bg-[#F0EDE5] text-[#6B705C]"
                        aria-label="Dismiss"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </RowWrap>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-2 text-[11px] text-[#6B705C] border-t border-[#E8E6E1]">
            Uploads keep running in the background — feel free to close the tab.
          </div>
        </div>
      )}
    </div>
  );
}
