import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, UploadCloud, CheckCircle2, XCircle, X, Sparkles, ArrowRight, FolderUp } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  loadPendingJobs,
  subscribePendingJobs,
  untrackPendingJob,
} from "../lib/uploadJobs";
import { markBookFresh } from "../lib/freshArrivals";

// Navbar dropdown that surfaces in-flight async uploads.
//
// Layout (new, 2026-06-24):
//   ┌─ Books arriving ─────────────┐
//   │ The Hobbit             ✓     │   ← main panel — compact rows,
//   │ HP and the Sorc… ✓     ◄     │     just title + status icon.
//   │ Three Men in a Boat   ⏳     │     Hovered row is highlighted.
//   ├──────────────────────────────┤
//   │ ✨ View all 3 new books →    │
//   │ Tucked in — close anytime.   │
//   └──────────────────────────────┘
//
//   ┌──────── (flyout) ────────┐    ← opens to the LEFT of the main
//   │  [Cover thumb 96×128]    │      panel when the user hovers (or
//   │  HP and the Sorcerer's   │      taps, on touch) any row.  Shows
//   │  J.K. Rowling            │      the full picture: cover, title,
//   │  📚 Harry Potter          │      author, fandom chip, cozy
//   │  ✨ Found its spot.       │      success message, and a big
//   │  [ Open it → ]           │      "Open it →" CTA.
//   └──────────────────────────┘
//
// Tone is the "cozy literary" option from the 2026-06-24 review —
// matches the rest of Shelfsort's voice (dropzone copy, "Surprise me",
// "Books I haven't read") instead of the previous mechanical phrasing.

const POLL_INTERVAL_MS = 3000;
const AUTOCLEAR_DELAY_MS = 30000;
const BACKGROUND_POLL_MS = 10000;

export default function BackgroundJobsBell() {
  const [jobs, setJobs] = useState(() => loadPendingJobs());
  const [open, setOpen] = useState(false);
  // {jobId: {status, error, response}} — `response` is captured so
  // we can navigate to the resulting book on click + render the
  // flyout card.
  const [statuses, setStatuses] = useState({});
  // Which row's flyout is showing.  null = no flyout.  Lives at this
  // component level (not row-level state) so only one flyout is
  // visible at a time, even when the mouse glides over multiple rows.
  const [hoveredJobId, setHoveredJobId] = useState(null);
  const popoverRef = useRef(null);

  // Set of jobIds we've already fired a completion toast for, so a
  // single completion doesn't spam the user on every subsequent poll.
  const toastedRef = useRef(new Set());
  const autoClearRef = useRef(new Map());
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  // Drag-over the bell icon itself.  Lets power users drop a folder
  // directly onto the navbar without ever opening a panel.  Tracked
  // as a single piece of state so both bell-icon render paths
  // (empty-state and active-state) can share the same visual hint.
  const [dragOverBell, setDragOverBell] = useState(false);
  // Walk a DataTransferItemList for folder support — same shape as
  // UploadZone's folder handler.  Resolves to a flat list of Files.
  const readEntryRecursive = useCallback(async (entry) => {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise((res) => entry.file((f) => res([f]), () => res([])));
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () => new Promise((res) => reader.readEntries(res));
      // readEntries returns ≤100 entries per call; keep going until empty.
      while (true) {
        const batch = await readBatch();
        if (!batch || batch.length === 0) break;
        for (const child of batch) {
          collected.push(...await readEntryRecursive(child));
        }
      }
      return collected;
    }
    return [];
  }, []);

  const filesFromDragEvent = useCallback(async (dt) => {
    if (!dt) return [];
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (entries.length > 0) {
      const out = [];
      for (const e of entries) out.push(...await readEntryRecursive(e));
      return out;
    }
    return Array.from(dt.files || []);
  }, [readEntryRecursive]);

  // Shared drag handlers for both render paths of the bell button.
  // Returning the object as a memoised value would be overkill — these
  // are stable references because `submitFilesViaBell` is `useCallback`'d
  // and React's event system handles per-render closures fine here.
  const dragHandlers = {
    onDragOver: (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (!dragOverBell) setDragOverBell(true);
    },
    onDragEnter: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverBell(true);
    },
    onDragLeave: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverBell(false);
    },
    onDrop: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverBell(false);
      const files = await filesFromDragEvent(e.dataTransfer);
      if (files.length > 0) submitFilesViaBell(files);
    },
  };

  // Quick upload from the bell's empty state.  Files are pushed
  // through the same async pipeline as the dashboard's UploadZone,
  // tracked in localStorage so the resume-after-refresh effect picks
  // them up, then the bell's own polling surfaces progress / toasts.
  // Single source of truth, no duplicated UI state.
  const submitFilesViaBell = useCallback(async (files) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    setSubmitting(true);
    // Submit up to 4 in parallel — mirrors the chunk size the
    // dashboard UploadZone uses so we don't hammer the API harder.
    const CHUNK = 4;
    const submitOne = async (file) => {
      try {
        const form = new FormData();
        form.append("files", file);
        const { data } = await api.post("/books/upload/async", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (data?.job_id) {
          // trackPendingJob is in the shared module — but we deferred
          // importing it at the top to avoid widening this file's
          // import surface; pull it in lazily.
          const { trackPendingJob } = await import("../lib/uploadJobs");
          trackPendingJob(data.job_id, file.name);
        }
      } catch (e) {
        toast.error(`Couldn't queue ${file.name}`, {
          description: e?.response?.data?.detail || e?.message,
        });
      }
    };
    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        await Promise.all(list.slice(i, i + CHUNK).map(submitOne));
      }
      toast(
        list.length === 1
          ? `📥 ${list[0].name} is on its way`
          : `📥 ${list.length} files lined up`,
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Keep `jobs` in sync with the localStorage list.
  useEffect(() => {
    const unsub = subscribePendingJobs(setJobs);
    return unsub;
  }, []);

  // Single poll function — shared between foreground (panel open, 3s)
  // and background (panel closed, 10s) loops.
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
        if (data.status === "done" && !toastedRef.current.has(j.jobId)) {
          toastedRef.current.add(j.jobId);
          const books = (data.response?.books) || [];
          const firstBook = books.find((b) => !b.failed) || null;
          books.forEach((b) => {
            if (b?.book_id && !b.failed) markBookFresh(b.book_id);
          });
          // Cozy-literary completion toast — matches the rest of
          // Shelfsort's voice instead of "📚 X just finished".
          toast.success(
            books.length > 1
              ? `📚 ${books.length} new books found their spots`
              : `📚 ${firstBook?.title || j.filename || "A new book"} found its spot`,
            {
              duration: 7000,
              action: firstBook?.book_id ? {
                label: "Open it",
                onClick: () => {
                  window.location.href = `/book/${firstBook.book_id}`;
                },
              } : undefined,
            },
          );
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
            `Couldn't sort ${j.filename}`,
            { duration: 9000, description: data.error || undefined },
          );
        }
      } catch (e) {
        const s = e?.response?.status;
        if (s === 404) {
          untrackPendingJob(j.jobId);
        } else {
          next[j.jobId] = { status: "unknown", error: null, response: null };
        }
      }
    }));
    setStatuses((prev) => ({ ...prev, ...next }));
  }, []);

  // Foreground loop — snappy poll while the panel is open.
  useEffect(() => {
    if (!open || jobs.length === 0) return undefined;
    pollAll(jobs);
    const id = setInterval(() => pollAll(jobs), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [open, jobs, pollAll]);

  // Background loop — gentle poll regardless of panel state, so
  // completion toast + tab title still update when the bell is closed.
  useEffect(() => {
    if (jobs.length === 0) return undefined;
    const id = setInterval(() => pollAll(jobs), BACKGROUND_POLL_MS);
    return () => clearInterval(id);
  }, [jobs, pollAll]);

  // Document title indicator — prefixes "📚 (N)" while jobs are active.
  // Strips on cleanup so the prefix doesn't bleed into other routes.
  useEffect(() => {
    const activeCount = jobs.filter((j) => {
      const s = statuses[j.jobId]?.status;
      return !s || s === "queued" || s === "processing" || s === "unknown";
    }).length;
    if (activeCount === 0) return undefined;
    const previous = document.title;
    const stripped = previous.replace(/^📚\s*\(\d+\)\s*/, "");
    document.title = `📚 (${activeCount}) ${stripped}`;
    return () => {
      document.title = document.title.replace(/^📚\s*\(\d+\)\s*/, "");
    };
  }, [jobs, statuses]);

  // Cancel auto-clear timers on unmount.
  useEffect(() => {
    const timers = autoClearRef.current;
    return () => {
      timers.forEach((tid) => clearTimeout(tid));
      timers.clear();
    };
  }, []);

  // Close popover on outside-click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
        setHoveredJobId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (jobs.length === 0) {
    // Always-visible empty state — the bell stays in the navbar so
    // users know where their background uploads will appear.  Greyed
    // out, no badge, calming "nothing in the works" panel on click.
    return (
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="navbar-bgjobs-toggle"
          {...dragHandlers}
          className={`p-2 rounded-lg relative transition-all ${
            dragOverBell
              ? "bg-[#FDF3E1] ring-2 ring-[#E07A5F] opacity-100 scale-110"
              : "opacity-60 hover:opacity-90 hover:bg-[#F5F3EC]"
          }`}
          title={dragOverBell ? "Drop to upload" : "Background uploads — nothing in the works"}
          aria-expanded={open}
          aria-label="Background uploads"
        >
          <UploadCloud className={`w-4 h-4 ${dragOverBell ? "text-[#E07A5F]" : "text-[#6B705C]"}`} />
        </button>
        {open && (
          <div
            data-testid="navbar-bgjobs-panel"
            className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-[#E8E6E1] z-50 overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-[#E8E6E1]">
              <span className="font-serif text-sm font-medium text-[#2C2C2C]">
                Books arriving
              </span>
            </div>
            <div className="px-4 py-6 text-center">
              <div className="text-3xl mb-2 opacity-50">📚</div>
              <p className="font-serif text-sm text-[#2C2C2C] mb-1">
                Nothing in the works
              </p>
              <p className="text-xs text-[#6B705C] leading-relaxed mb-4">
                Drop a book on the upload zone and we&rsquo;ll
                <br />
                line it up here for you.
              </p>
              {/* Quick upload from anywhere in the app — same async
                  pipeline as the dashboard UploadZone, tracked in
                  localStorage so the bell's existing polling picks
                  it up automatically. */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  data-testid="bgjobs-quick-pick-files"
                  disabled={submitting}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E07A5F] hover:bg-[#d06a4f] disabled:opacity-60 text-white inline-flex items-center justify-center gap-1.5"
                >
                  {submitting ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <><UploadCloud className="w-3.5 h-3.5" /> Choose files</>
                  )}
                </button>
                <button
                  type="button"
                  data-testid="bgjobs-quick-pick-folder"
                  disabled={submitting}
                  onClick={() => folderInputRef.current?.click()}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-[#E07A5F]/40 hover:bg-[#FDF3E1] disabled:opacity-60 text-[#E07A5F] inline-flex items-center justify-center gap-1.5"
                >
                  <FolderUp className="w-3.5 h-3.5" /> Pick a folder
                </button>
              </div>
              {/* Hidden inputs the buttons above trigger. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="bgjobs-files-input"
                onChange={(e) => {
                  submitFilesViaBell(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="bgjobs-folder-input"
                /* eslint-disable react/no-unknown-property */
                webkitdirectory=""
                directory=""
                mozdirectory=""
                /* eslint-enable react/no-unknown-property */
                onChange={(e) => {
                  submitFilesViaBell(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="px-4 py-2 text-[11px] text-[#6B705C] border-t border-[#E8E6E1] text-center">
              We&rsquo;ll keep this bell tucked in your navbar.
            </div>
          </div>
        )}
      </div>
    );
  }

  const activeCount = jobs.filter((j) => {
    const s = statuses[j.jobId]?.status;
    return !s || s === "queued" || s === "processing" || s === "unknown";
  }).length;

  const justAddedIds = jobs.flatMap((j) => {
    const books = (statuses[j.jobId]?.response?.books) || [];
    return books.filter((b) => !b.failed && b.book_id).map((b) => b.book_id);
  });

  // Resolve the hovered job's flyout content.  Renders a different
  // card depending on status (active → "Sorting…", done → full card,
  // failed → error card).
  const hoveredJob = hoveredJobId ? jobs.find((j) => j.jobId === hoveredJobId) : null;
  const hoveredStatus = hoveredJobId ? statuses[hoveredJobId] || {} : {};
  const hoveredBook = hoveredJob ? ((hoveredStatus.response?.books) || []).find((b) => !b.failed) : null;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setHoveredJobId(null);
        }}
        data-testid="navbar-bgjobs-toggle"
        {...dragHandlers}
        className={`p-2 rounded-lg relative transition-all ${
          dragOverBell
            ? "bg-[#FDF3E1] ring-2 ring-[#E07A5F] scale-110"
            : "hover:bg-[#F5F3EC]"
        }`}
        title={dragOverBell ? "Drop to upload" : `${jobs.length} book${jobs.length === 1 ? "" : "s"} arriving`}
        aria-expanded={open}
        aria-label={`${jobs.length} books arriving`}
      >
        <UploadCloud className={`w-4 h-4 ${dragOverBell ? "text-[#E07A5F]" : "text-[#6B705C]"}`} />
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
        <>
          {/* Flyout — anchored to the LEFT of the main panel.  Renders
              before the main panel in the DOM so right-edge users see
              it slide in towards them (cozy, not aggressive). */}
          {hoveredJob && (
            <div
              data-testid="bgjobs-flyout"
              className="absolute right-[336px] top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-[#E8E6E1] z-50 overflow-hidden pointer-events-none animate-fade-in"
              style={{ animation: "bgjobs-flyout-in 140ms ease-out" }}
            >
              <FlyoutCard
                job={hoveredJob}
                status={hoveredStatus.status}
                error={hoveredStatus.error}
                book={hoveredBook}
              />
            </div>
          )}

          {/* Main bell panel. */}
          <div
            data-testid="navbar-bgjobs-panel"
            className="absolute right-0 top-full mt-2 w-80 max-h-[60vh] overflow-y-auto bg-white rounded-xl shadow-lg border border-[#E8E6E1] z-50"
            onMouseLeave={() => setHoveredJobId(null)}
          >
            <div className="px-4 py-2.5 border-b border-[#E8E6E1] flex items-center justify-between">
              <span className="font-serif text-sm font-medium text-[#2C2C2C]">
                Books arriving
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C]">
                {jobs.length} {jobs.length === 1 ? "book" : "books"}
              </span>
            </div>
            <ul className="divide-y divide-[#F0EDE5]">
              {jobs.map((j) => {
                const st = statuses[j.jobId] || {};
                const status = st.status || "queued";
                const isDone = status === "done";
                const isFailed = status === "failed";
                const isActive = !isDone && !isFailed;
                const books = (st.response?.books) || [];
                const firstBook = books.find((b) => !b.failed) || null;
                const goHref = isDone && firstBook?.book_id ? `/book/${firstBook.book_id}` : null;
                const isHovered = hoveredJobId === j.jobId;
                const displayTitle = (isDone && firstBook?.title) || j.filename;

                const RowInner = (
                  <div className="px-4 py-2.5 flex items-center gap-2.5">
                    <div className="shrink-0">
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                      {isActive && <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#2C2C2C] truncate" title={displayTitle}>
                        {displayTitle}
                      </p>
                    </div>
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
                  </div>
                );

                const rowProps = {
                  "data-testid": `bgjobs-row-${j.jobId}`,
                  onMouseEnter: () => setHoveredJobId(j.jobId),
                  onFocus: () => setHoveredJobId(j.jobId),
                  // Touch support — tap a row to toggle the flyout.
                  // Same row again closes it.
                  onClick: goHref ? undefined : (e) => {
                    e.preventDefault();
                    setHoveredJobId((cur) => (cur === j.jobId ? null : j.jobId));
                  },
                  className: `block cursor-pointer transition-colors ${
                    isHovered ? "bg-[#FAF6EE]" : "hover:bg-[#FAF6EE]"
                  }`,
                };

                return (
                  <li key={j.jobId}>
                    {goHref ? (
                      <Link
                        to={goHref}
                        onClick={() => { setOpen(false); setHoveredJobId(null); }}
                        {...rowProps}
                      >
                        {RowInner}
                      </Link>
                    ) : (
                      <div {...rowProps} role="button" tabIndex={0}>{RowInner}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            {justAddedIds.length >= 2 && (
              <Link
                to={`/library/all?just_added=${justAddedIds.join(",")}`}
                onClick={() => { setOpen(false); setHoveredJobId(null); }}
                data-testid="bgjobs-view-all"
                className="block px-4 py-2.5 border-t border-[#E8E6E1] bg-[#FDF3E1] hover:bg-[#FBE8C8] text-[#8C5C00] text-sm font-medium flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                View all {justAddedIds.length} new book{justAddedIds.length === 1 ? "" : "s"} →
              </Link>
            )}

            <div className="px-4 py-2 text-[11px] text-[#6B705C] border-t border-[#E8E6E1]">
              Tucked in — feel free to close the tab, we&rsquo;ll keep tidying.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Right-hand rich card the flyout renders.  Three flavours: active
// (still sorting), done (full picture), failed (apologetic explainer).
function FlyoutCard({ job, status, error, book }) {
  if (status === "failed") {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="w-4 h-4 text-red-500" />
          <h4 className="font-serif text-sm text-[#2C2C2C]">Couldn&rsquo;t sort this one</h4>
        </div>
        <p className="text-sm text-[#6B705C] mb-1 truncate" title={job.filename}>{job.filename}</p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-xs text-[#6B705C] mt-3">
          You can dismiss it from the list and try uploading again.
        </p>
      </div>
    );
  }

  if (status !== "done" || !book) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
          <h4 className="font-serif text-sm text-[#2C2C2C]">Finding a shelf…</h4>
        </div>
        <p className="text-sm text-[#6B705C] truncate" title={job.filename}>{job.filename}</p>
        <p className="text-xs text-[#6B705C] mt-3 italic">
          {status === "queued" && "Lining up — your turn next."}
          {status === "processing" && "Sorting metadata and finding the right shelf."}
          {(!status || status === "unknown") && "Checking on it…"}
        </p>
      </div>
    );
  }

  const hasCover = Boolean(book.has_cover && book.book_id);
  const coverUrl = hasCover
    ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`
    : null;

  return (
    <div className="pointer-events-auto">
      {/* Top: cover + headline */}
      <div className="flex gap-3 p-4 bg-[#FAF6EE]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="shrink-0 w-20 h-28 object-cover rounded-md shadow-md border border-[#E8E6E1]"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="shrink-0 w-20 h-28 rounded-md bg-[#E8E6E1] flex items-center justify-center text-[#6B705C] text-2xl shadow-md">
            📕
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <h4
            className="font-serif text-sm font-medium text-[#2C2C2C] leading-snug line-clamp-3"
            title={book.title}
          >
            {book.title || job.filename}
          </h4>
          {book.author && (
            <p className="text-xs text-[#6B705C] mt-1 truncate" title={book.author}>
              {book.author}
            </p>
          )}
        </div>
      </div>

      {/* Middle: chips + cozy success message */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {book.fandom && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FDF3E1] text-[#8C5C00] font-medium">
              📚 {book.fandom}
            </span>
          )}
          {book.category && book.category !== book.fandom && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EAE4D6] text-[#6B5436]">
              {book.category}
            </span>
          )}
        </div>
        <p className="text-xs text-[#6B705C] italic">
          ✨ Found its spot — settled onto your shelf.
        </p>
      </div>

      {/* Bottom: open CTA */}
      <Link
        to={`/book/${book.book_id}`}
        data-testid={`bgjobs-flyout-open-${book.book_id}`}
        className="block mx-4 mb-4 mt-1 px-3 py-2 rounded-lg bg-[#E07A5F] hover:bg-[#d06a4f] text-white text-sm font-medium text-center inline-flex items-center justify-center gap-1.5"
      >
        Open it
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
