import React, { useEffect, useRef, useState } from "react";
import { Loader2, UploadCloud, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import {
  loadPendingJobs,
  subscribePendingJobs,
  untrackPendingJob,
} from "../lib/uploadJobs";

// Tiny navbar dropdown that surfaces in-flight async uploads — the same
// list the resume-after-refresh effect re-attaches to on mount.  Users
// dropping a folder of 100 books and switching tabs while it works
// otherwise have no signal that the backend is still chewing through
// their drop.
//
// Renders nothing when there are no pending jobs (no visual clutter on
// 99% of pageviews).  When there ARE jobs, shows a small upload icon
// with a count badge; clicking opens a panel with per-file status that
// auto-refreshes every 3s while open.

const POLL_INTERVAL_MS = 3000;

export default function BackgroundJobsBell() {
  const [jobs, setJobs] = useState(() => loadPendingJobs());
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState({}); // {jobId: {status, error}}
  const popoverRef = useRef(null);

  // Keep `jobs` in sync with the localStorage list.  Fires on the
  // shelfsort:uploadJobsChanged event (same-tab) and the storage event
  // (cross-tab).
  useEffect(() => {
    const unsub = subscribePendingJobs(setJobs);
    return unsub;
  }, []);

  // While the popover is open, poll the backend for each job's status
  // so users see the live "processing → done" transitions.  Closed = no
  // polling = no wasted requests on the 99% of pageviews where the bell
  // isn't open.
  useEffect(() => {
    if (!open || jobs.length === 0) return undefined;
    let cancelled = false;
    const tick = async () => {
      const next = {};
      await Promise.all(jobs.map(async (j) => {
        try {
          const { data } = await api.get(`/books/upload/jobs/${j.jobId}`);
          next[j.jobId] = { status: data.status, error: data.error || null };
        } catch (e) {
          const s = e?.response?.status;
          if (s === 404) {
            // Backend forgot the job (TTL) — drop from local list too.
            untrackPendingJob(j.jobId);
          } else {
            next[j.jobId] = { status: "unknown", error: null };
          }
        }
      }));
      if (!cancelled) setStatuses(next);
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [open, jobs]);

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

  // Count "processing" jobs separately from done/failed for the badge.
  const activeCount = jobs.filter((j) => {
    const s = statuses[j.jobId]?.status;
    return !s || s === "queued" || s === "processing";
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
              return (
                <li
                  key={j.jobId}
                  data-testid={`bgjobs-row-${j.jobId}`}
                  className="px-4 py-2.5 flex items-center gap-2.5"
                >
                  <div className="shrink-0">
                    {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                    {isActive && <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#2C2C2C] truncate" title={j.filename}>
                      {j.filename}
                    </p>
                    <p className="text-xs text-[#6B705C]">
                      {isDone && "Finished — refreshing library…"}
                      {isFailed && (st.error ? `Failed — ${st.error}` : "Failed")}
                      {status === "queued" && "Queued"}
                      {status === "processing" && "Processing…"}
                      {status === "unknown" && "Checking…"}
                    </p>
                  </div>
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
