import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, Loader2, FolderUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  loadPendingJobs,
  trackPendingJob,
  untrackPendingJob,
} from "../lib/uploadJobs";
import AirdropInfoTip from "./AirdropInfoTip";
import StagedUploadTray from "./StagedUploadTray";
import StagedDraftRestoreBanner from "./StagedDraftRestoreBanner";
import UploadFileList from "./UploadFileList";
import { useFileProgressState } from "../hooks/useFileProgressState";

// Every format the backend accepts — .epub goes through the EPUB pipeline,
// the rest land on the "Needs conversion" shelf with a Calibre nudge.
const ACCEPTED_EXTS = [
  ".epub",
  ".pdf",
  ".mobi", ".azw", ".azw3", ".kf8", ".kfx",
  ".docx", ".doc", ".rtf", ".fb2", ".lit", ".lrf", ".pdb",
  ".txt", ".html", ".htm",
];

// Map each extension to a group that matches the backend's `format_prefs`.
// EPUBs are not in the table — they always upload silently.
const EXT_TO_GROUP = {
  ".pdf": "pdf",
  ".mobi": "kindle", ".azw": "kindle", ".azw3": "kindle", ".kf8": "kindle", ".kfx": "kindle",
  ".docx": "word", ".doc": "word", ".rtf": "word",
  ".fb2": "other_ebook", ".lit": "other_ebook", ".lrf": "other_ebook", ".pdb": "other_ebook",
  ".txt": "txt",
  ".html": "html", ".htm": "html",
};

function extOf(name) {
  const lower = (name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function groupOf(name) {
  return EXT_TO_GROUP[extOf(name)] || null;
}

function isAccepted(name) {
  const lower = (name || "").toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

// Recursively walk a webkit FileSystemEntry tree, yielding File objects.
// 2026-06-30 — Also stamps ``__relativePath`` on each File so the
// staging tray can show the user *where* the files came from
// ("Books/Fantasy/Tolkien") when restoring a saved draft.  The
// ``fullPath`` from the FileSystem API looks like
// ``"/MyBooks/Fantasy/lotr.epub"`` — we strip the leading slash so
// it matches the format ``File.webkitRelativePath`` uses on
// folder-picker uploads.
async function readEntry(entry) {
  const out = [];
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    try {
      const fp = entry.fullPath || "";
      file.__relativePath = fp.startsWith("/") ? fp.slice(1) : fp;
    } catch {
      // Setting on a real File is allowed; defend against edge browsers.
    }
    out.push(file);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries may return in batches — loop until empty
    const entries = [];
    while (true) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch || batch.length === 0) break;
      entries.push(...batch);
    }
    for (const sub of entries) {
      const subFiles = await readEntry(sub);
      out.push(...subFiles);
    }
  }
  return out;
}

async function filesFromDataTransfer(dt) {
  // Prefer the FileSystem entry API (lets us walk folders); fall back to
  // dt.files for plain file drops.
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length > 0) {
    const all = [];
    for (const e of entries) {
      const fs = await readEntry(e);
      all.push(...fs);
    }
    return all;
  }
  return Array.from(dt.files || []);
}

// ---- Persistent upload-job tracker --------------------------------------
// Helpers live in `lib/uploadJobs.js` so the Navbar's BackgroundJobsBell
// can read the same in-flight list without duplicating the logic.  This
// file just imports `trackPendingJob` / `untrackPendingJob` and uses
// `loadPendingJobs` on mount for the resume-after-refresh flow.

export default function UploadZone({ onUploaded, compact = false }) {
  const navigate = useNavigate();
  // 2026-07-08 — Screen Wake Lock ref for the "Keep me awake" upload
  // guard.  Held for the duration of a bulk upload so the laptop can't
  // sleep the display out from under us (which is one of the ways
  // Chrome throttles the tab and drops silent-upload requests).  Ref
  // rather than state because React re-renders would trigger release/
  // re-acquire cycles.  Set to `null` when not held.
  const wakeLockRef = useRef(null);
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);
  // 2026-07-04 — guard against parallel uploads.  The retry-failed
  // toast surfaces a "Retry N" action that calls handleFiles again.
  // If a user has started a second upload (drag-drop, file picker) in
  // the ~20s the toast is sticky, we'd otherwise have two concurrent
  // upload loops racing on `progress`, the duplicates list, and the
  // `uploading` state.  A ref-based mutex is simpler than a setState
  // race because `useState` reads are stale inside the async callback.
  const inFlightRef = useRef(false);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 2026-07-06 — "Stage before upload" mode.  When enabled, dropped /
  // picked files accumulate in a local tray instead of firing
  // handleFiles() immediately.  The user hits "Start uploading" when
  // they're ready, at which point we feed the entire batch through
  // the existing pipeline.  Toggle is persisted to localStorage so
  // it sticks across reloads, and the staging tray itself is
  // intentionally NOT persisted — File objects can't be re-hydrated
  // from localStorage anyway, and the bytes would be lost on refresh.
  // Explicit retry events (`shelfsort:upload-files` from the failed-
  // uploads banner, the retry-server flow) bypass staging — those
  // are deliberate "go now" actions.
  //
  // 2026-07-06 — Draft persistence (filenames + folder hints, NOT
  // bytes).  When the tray has files we POST a debounced upsert to
  // `/api/uploads/staged-drafts` so a refresh/close-laptop can
  // surface a "you had N files staged from `<folder>`" restore
  // banner.  The bytes themselves still have to be re-picked by the
  // user — there's no IndexedDB BLOB persistence — but knowing
  // *which folder* they came from is the friction-killer.
  const STAGED_CAP = 2000;
  const STAGED_PREF_KEY = "shelfsort_stage_before_upload";
  const [stagingEnabled, setStagingEnabled] = useState(() => {
    // 2026-08-27 — Default ON per user request.  Only treat the pref
    // as OFF when the user has EXPLICITLY set "0" — a first-time
    // visitor with no stored pref should see the staging tray so
    // they can review the drop before hitting Start.
    try {
      return localStorage.getItem(STAGED_PREF_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedDraft, setStagedDraft] = useState(null);  // { files, source_hints, updated_at, total_bytes }
  const draftSaveTimer = useRef(null);
  const toggleStaging = (v) => {
    setStagingEnabled(v);
    try {
      localStorage.setItem(STAGED_PREF_KEY, v ? "1" : "0");
    } catch {
      // localStorage disabled (private mode) — toggle still works in-memory.
    }
    // 2026-08-27 — Broadcast so any other UploadZone mounted in the
    // same tab (e.g. Dashboard + AllBooksPage side by side) picks up
    // the new value immediately.  Cross-tab sync happens automatically
    // via the `storage` event listener below.
    try {
      window.dispatchEvent(new CustomEvent("shelfsort:staging-pref-changed", { detail: v }));
    } catch { /* CustomEvent unsupported — no-op */ }
    // Flipping the toggle off should empty the queue so users
    // don't accidentally lose track of files that won't be uploaded.
    if (!v && stagedFiles.length > 0) {
      setStagedFiles([]);
    }
  };
  // `batch` / `batches` are populated when a drop exceeds CHUNK_SIZE so the
  // progress line can read "Batch 2 of 5 · 347 of 1000 processed".  For
  // smaller drops they stay at 1/1 and the UI hides the batch prefix.
  const [progress, setProgress] = useState({ done: 0, total: 0, batch: 1, batches: 1, inFlight: 0, startedAt: 0 });
  // 2026-08-27 — Per-file upload progress list state, plus retry helpers.
  // Extracted into `useFileProgressState` so UploadZone.jsx doesn't have
  // to own the coalesced patcher, localStorage rehydrate, `File` registry
  // and event-bus retry logic.  See /app/frontend/src/hooks/useFileProgressState.js
  const {
    fileStates,
    patchFile,
    initFiles,
    scheduleClearIfComplete,
    markStuckAsFailed,
    clearAll: clearFileStates,
    retryFileById,
    retryAllFailed,
    fileRefsRef,
  } = useFileProgressState();

  // 2026-08-27 — Cross-instance + cross-tab sync of the staging
  // preference.  When any other UploadZone mount toggles it, or when
  // another tab writes to the same localStorage key, we update our
  // local state so all upload surfaces (Dashboard, AllBooksPage,
  // FilterUrlList, etc.) stay in lockstep.  Fixes the "one page says
  // ON, the other says OFF" confusion the user reported.
  useEffect(() => {
    const onSameTabChange = (e) => {
      if (typeof e.detail === "boolean") setStagingEnabled(e.detail);
    };
    const onCrossTabChange = (e) => {
      if (e.key !== STAGED_PREF_KEY) return;
      setStagingEnabled(e.newValue !== "0");   // matches the same default-ON logic
    };
    window.addEventListener("shelfsort:staging-pref-changed", onSameTabChange);
    window.addEventListener("storage", onCrossTabChange);
    return () => {
      window.removeEventListener("shelfsort:staging-pref-changed", onSameTabChange);
      window.removeEventListener("storage", onCrossTabChange);
    };
  }, []);

  // 2026-08-27 — Non-terminal count for the reload warning + amber
  // "reload will require a re-drop" banner.  Recomputed on every
  // fileStates change.
  const inProgressCount = useMemo(
    () => fileStates.filter((f) => f.status === "queued" || f.status === "uploading" || f.status === "processing").length,
    [fileStates],
  );

  // Warn the user if they try to close/reload the tab while uploads
  // are in flight.  The auto-resume path lets them recover any
  // interrupted files by re-dropping, but a friendly prompt still
  // spares an unnecessary re-drop dance.  Firefox / Chromium show
  // the browser's native confirmation and ignore the custom message.
  useEffect(() => {
    if (inProgressCount === 0) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "You have uploads in progress. Reloading will require re-dropping those files.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [inProgressCount]);

  // 1-second heartbeat so the "Xs elapsed" line in the progress UI
  // re-renders even when no file has resolved yet.  Only ticking
  // while ``uploading`` is true keeps it a no-op the rest of the time.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!uploading) return undefined;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [uploading]);

  // 2026-06-28 — Real-progress strip below the upload bar.  Even in
  // airdrop mode (where the per-file poller is skipped), users want
  // to see "yes things are happening" — the existing line shows only
  // bytes-queued, not what the backend has actually finished.  We
  // poll a lightweight summary endpoint every 2s and render a second
  // strip: "Saved N to library · M still sorting · K queued".
  // No new schema — counts come from existing upload_jobs +
  // books.classifier columns.
  const [queueSummary, setQueueSummary] = useState(null);
  // Retry-inbox modal — opens when the user clicks the
  // "N couldn't classify" chip on the queue-summary strip.  Lazy-loads
  // the list of polish-failed books from /api/polish/failed and lets
  // the user retry the whole set with one button.  Keeping the modal
  // logic here (rather than a separate page) means the UX flows
  // continuously from the strip → the modal → the retry button, all
  // without a route change interrupting an in-flight upload.
  const [retryInboxOpen, setRetryInboxOpen] = useState(false);
  const [retryInboxLoading, setRetryInboxLoading] = useState(false);
  const [retryInboxBooks, setRetryInboxBooks] = useState([]);
  const [retryInboxBusy, setRetryInboxBusy] = useState(false);

  const openRetryInbox = useCallback(async () => {
    setRetryInboxOpen(true);
    setRetryInboxLoading(true);
    try {
      const { data } = await api.get("/polish/failed");
      setRetryInboxBooks(data?.books || []);
    } catch (e) {
      toast.error("Couldn't load the retry inbox. Try again in a moment.");
      setRetryInboxBooks([]);
    } finally {
      setRetryInboxLoading(false);
    }
  }, []);

  const retryAllStuck = useCallback(async () => {
    setRetryInboxBusy(true);
    try {
      const { data } = await api.post("/polish");
      toast.success(
        data?.queued
          ? `Retrying ${data.queued + retryInboxBooks.length} book${data.queued + retryInboxBooks.length === 1 ? "" : "s"}.`
          : `Retrying ${retryInboxBooks.length} stuck book${retryInboxBooks.length === 1 ? "" : "s"}.`
      );
      setRetryInboxOpen(false);
      setRetryInboxBooks([]);
      // Immediate re-poll so the chip count updates without waiting
      // for the 2 s tick.
      try {
        const { data: qs } = await api.get("/books/upload/queue-summary");
        setQueueSummary(qs);
      } catch { /* silent */ }
    } catch (e) {
      toast.error("Retry failed. Please try again.");
    } finally {
      setRetryInboxBusy(false);
    }
  }, [retryInboxBooks.length]);

  useEffect(() => {
    if (!uploading) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get("/books/upload/queue-summary");
        if (!cancelled) setQueueSummary(data);
      } catch {
        /* silent — the strip just hides until the next poll succeeds */
      }
    };
    tick();  // fire once immediately so the strip renders without 2s gap
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [uploading]);
  const [formatPrefs, setFormatPrefs] = useState({}); // {pdf: "ask"|"convert"|"skip", ...}

  // Lazy-load the user's per-format preferences once. Default to "ask"
  // for every group if the fetch fails — preserves current behavior.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/user/format-prefs");
        if (!cancelled) setFormatPrefs(data || {});
      } catch {
        if (!cancelled) setFormatPrefs({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Resume in-flight upload jobs after a tab refresh / re-mount.
  // Walks the localStorage list, polls each job once; if it's already
  // done, finalise it and tell the parent.  If it's still running,
  // keep polling in a lightweight loop until done/failed.
  //
  // This makes the async upload pipeline truly fire-and-forget — users
  // can close the tab during a slow LLM classification and come back
  // to find their books waiting for them.
  const [resumingCount, setResumingCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const initial = loadPendingJobs();
    if (initial.length === 0) return undefined;

    // Drop entries older than 6 hours — anything that old is either
    // truly stuck or the backend's 24h TTL has wiped the job record.
    // Don't bug the user about ancient zombies.
    const fresh = initial.filter((j) => Date.now() - (j.submittedAt || 0) < 6 * 60 * 60 * 1000);
    // Trim stale entries via the shared helper.
    if (fresh.length !== initial.length) {
      const stale = initial.filter((j) => !fresh.includes(j));
      stale.forEach((j) => untrackPendingJob(j.jobId));
    }
    if (fresh.length === 0) return undefined;

    setResumingCount(fresh.length);

    // Per-job poll loop — runs in parallel across all resumed jobs.
    const pollOne = async (entry) => {
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 240;  // ~8 min headroom; the backend may still
                              // be churning on a slow LLM classify call.
      for (let i = 0; i < MAX_POLLS && !cancelled; i++) {
        let res;
        try {
          res = await api.get(`/books/upload/jobs/${entry.jobId}`);
        } catch (e) {
          const s = e?.response?.status;
          if (s === 404) {
            // Job vanished — most likely TTL'd, no work to recover.
            untrackPendingJob(entry.jobId);
            return { ok: false, entry, reason: "expired" };
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        const status = res?.data?.status;
        if (status === "done") {
          untrackPendingJob(entry.jobId);
          return { ok: true, entry, response: res.data.response || {} };
        }
        if (status === "failed") {
          untrackPendingJob(entry.jobId);
          return { ok: false, entry, reason: res.data.error || "failed" };
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      // Still running after MAX_POLLS — leave it tracked, the next
      // mount will pick up where we left off.
      return { ok: false, entry, reason: "still-running" };
    };

    (async () => {
      const results = await Promise.all(fresh.map(pollOne));
      if (cancelled) return;
      setResumingCount(0);

      const completed = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok && r.reason !== "still-running");
      const stillRunning = results.filter((r) => r.reason === "still-running");

      if (completed.length > 0) {
        // Aggregate side-effects (duplicates, URL lists) across all
        // resumed jobs so the parent can refresh and surface the
        // duplicate modal exactly like a foreground upload.
        const dupes = [];
        const allActions = [];
        const allUrlLists = [];
        for (const r of completed) {
          const data = r.response || {};
          for (const b of (data.books || [])) {
            if (b?.duplicate_pending && (b.duplicate_of || []).length > 0) {
              dupes.push(b);
            }
          }
          if (Array.isArray(data.actions)) allActions.push(...data.actions);
          if (Array.isArray(data.url_lists)) allUrlLists.push(...data.url_lists);
        }
        toast.success(
          `Welcome back — ${completed.length} upload${completed.length === 1 ? "" : "s"} finished while you were away`,
          { duration: 6000 },
        );
        onUploaded && onUploaded(dupes, allActions, allUrlLists);
      }
      if (failed.length > 0) {
        const sample = failed[0]?.entry?.filename || "an upload";
        toast.error(
          `${failed.length} resumed upload${failed.length === 1 ? "" : "s"} couldn't be recovered`,
          {
            duration: 9000,
            description: failed.length === 1 ? `${sample} — ${failed[0].reason}` : undefined,
          },
        );
      }
      if (stillRunning.length > 0) {
        toast(
          `${stillRunning.length} background upload${stillRunning.length === 1 ? "" : "s"} still processing — we'll surface them when you next come back.`,
          { duration: 6000 },
        );
      }
    })();

    return () => { cancelled = true; };
  // We intentionally run this ONCE on mount.  `onUploaded` from the
  // parent is stable enough across renders that re-running on every
  // change would re-poll already-polled jobs.
  }, []);

  const handleFiles = useCallback(async (filesList) => {
    // Hard guard: never run two upload loops at once. The retry-failed
    // toast can fire `handleFiles(retryFiles)` while another upload is
    // already in progress (e.g. user drag-dropped a fresh batch).  In
    // that case, politely tell them to wait — we don't want to mix
    // batches mid-flight.
    if (inFlightRef.current) {
      toast("Already uploading — please wait for the current batch to finish before starting another.");
      return;
    }
    const all = Array.from(filesList);
    const files = all.filter((f) => isAccepted(f.name));
    const skipped = all.length - files.length;
    if (files.length === 0) {
      toast.error(
        skipped > 0
          ? `None of the ${skipped} file${skipped === 1 ? "" : "s"} are supported (EPUB, PDF, Kindle, etc.)`
          : "Drop EPUBs, PDFs, Kindle (.azw/.mobi), or other ebook files",
      );
      return;
    }
    if (skipped > 0) {
      toast(`Skipping ${skipped} unsupported file${skipped === 1 ? "" : "s"}`, { duration: 3500 });
    }

    // EPUBs always upload silently — no confirmation. For non-EPUBs we ask
    // PER FORMAT GROUP (PDF, Kindle, Word/RTF, ...) so the user can opt-in
    // to converting some formats while skipping others in the same drop.
    // The user's per-format preferences (Account → Non-EPUB upload prefs)
    // can be set to "skip" to drop a group silently. Silent auto-convert
    // was removed 2026-06-06: every non-EPUB upload now always prompts
    // the user — they get to decide Convert / Keep original / Skip.
    const epubs = files.filter((f) => f.name.toLowerCase().endsWith(".epub"));
    const nonEpub = files.filter((f) => !f.name.toLowerCase().endsWith(".epub"));

    // Friendly labels for each format group so the prompt reads nicely.
    const GROUP_LABELS = {
      pdf: "PDF",
      kindle: "Kindle (.mobi/.azw/.azw3/.kf8/.kfx)",
      word: "Word / RTF (.docx/.doc/.rtf)",
      other_ebook: "other ebook (.fb2/.lit/.lrf/.pdb)",
      txt: "plain text (.txt — will dedupe URL lists)",
      html: "HTML (.html/.htm)",
    };

    const autoSkip = []; // pref === "skip"
    const askByGroup = {}; // {group: [File, ...]}
    for (const f of nonEpub) {
      const grp = groupOf(f.name) || "other_ebook";
      const pref = formatPrefs[grp] || "ask";
      if (pref === "skip") autoSkip.push(f);
      else { askByGroup[grp] = askByGroup[grp] || []; askByGroup[grp].push(f); }
    }
    if (autoSkip.length > 0) {
      toast(
        `Skipped ${autoSkip.length} file${autoSkip.length === 1 ? "" : "s"} per your format preferences`,
        { duration: 3500 },
      );
    }

    let toUpload = [...epubs];
    const keepOriginalNames = []; // filenames the user wants kept as-is
    const askGroups = Object.keys(askByGroup);
    for (const grp of askGroups) {
      const groupFiles = askByGroup[grp];
      const label = GROUP_LABELS[grp] || grp;
      const exts = [...new Set(groupFiles.map((f) => extOf(f.name)))].join(", ");
      // Two-stage prompt: Convert → if no, Keep original → if no, Skip.
      const convert = window.confirm(
        `Convert ${groupFiles.length} ${label} file${groupFiles.length === 1 ? "" : "s"} (${exts}) to EPUB and add to your library?\n\n` +
        `OK = Convert (Calibre runs server-side, lands in main library)\n` +
        `Cancel = ask about keeping the originals on a separate page`,
      );
      if (convert) {
        toUpload = toUpload.concat(groupFiles);
        continue;
      }
      const keep = window.confirm(
        `Keep ${groupFiles.length} ${label} file${groupFiles.length === 1 ? "" : "s"} as-is on the Originals page (no conversion)?\n\n` +
        `OK = Upload originals, they'll appear at /library/originals\n` +
        `Cancel = Skip these files entirely`,
      );
      if (keep) {
        toUpload = toUpload.concat(groupFiles);
        keepOriginalNames.push(...groupFiles.map((f) => f.name));
      } else {
        toast(`Skipping ${groupFiles.length} ${label} file${groupFiles.length === 1 ? "" : "s"}`);
      }
    }
    if (askGroups.length > 0 && toUpload.length === 0) {
      toast("Upload cancelled");
      return;
    }
    const filesToSend = toUpload;
    if (filesToSend.length === 0) {
      // Everything got filtered out (e.g. all on "skip"). Already toasted above.
      return;
    }

    // 2026-07-05 — Big-library auto-chunking.  The backend's
    // /books/upload/async caps any *single* request at 200 files
    // (`_MAX_FILES_PER_JOB`).  The current sendOne POSTs one file at
    // a time so we don't hit that cap directly, but funneling 1000+
    // simultaneous job rows through the backend still risks RAM/disk
    // pressure on the staging dir and makes progress reporting feel
    // like it'll never end.  When the user drops a huge library we:
    //   1. Show a friendly confirm so they know what's coming
    //   2. Split filesToSend into sequential batches of CHUNK_SIZE
    //   3. Run the existing concurrency-4 upload loop per batch
    //   4. Surface "Batch 3 of 6" in the progress line so the user
    //      can see we're making steady progress
    // The accumulators (duplicates, allActions, …) naturally span all
    // batches so the final toast and onUploaded callback look identical
    // to a single-batch drop.
    // 2026-07-08 — Keep-Me-Awake (minimum viable) — after the 638-of-2000
    // overnight upload loss.  When the drop is big enough to take >2min,
    // (a) surface a clearer warning that Chrome/Firefox WILL throttle
    // background tabs and pause the upload if the operator walks away,
    // and (b) acquire a Screen Wake Lock so the laptop can't sleep the
    // display out from under us.  The Wake Lock alone won't beat every
    // browser's throttling algorithm, but combined with the operator
    // knowing to keep the tab visible, it's enough for a 2,000-book run.
    const CHUNK_SIZE = 200;
    if (filesToSend.length > CHUNK_SIZE) {
      const batches = Math.ceil(filesToSend.length / CHUNK_SIZE);
      const estMin = Math.max(2, Math.round(filesToSend.length / 60));
      const ok = window.confirm(
        `Big library — ${filesToSend.length.toLocaleString()} books in ${batches} batches (~${estMin} min).\n\n` +
        `IMPORTANT — to prevent silent drops:\n` +
        `• Keep this tab OPEN and VISIBLE the whole time\n` +
        `• Don't let the laptop sleep (plug in + brightness low is fine)\n` +
        `• We'll acquire a screen-wake lock automatically\n` +
        `• Chrome throttles background tabs — books can silently drop\n\n` +
        `OK = Start uploading (stay at your laptop)\n` +
        `Cancel = Stop and try a smaller drop`,
      );
      if (!ok) {
        toast("Upload cancelled — try a smaller drop or pick a folder with up to 200 books at a time.");
        return;
      }
    }

    setUploading(true);
    inFlightRef.current = true;
    // 2026-07-08 — Acquire Screen Wake Lock for bulk uploads.  Only
    // fires for CHUNK_SIZE+ drops (small drops are fast enough that
    // the display sleeping mid-upload is a non-issue).  Non-blocking:
    // if the browser doesn't expose ``navigator.wakeLock`` (Firefox on
    // some OS, Safari <16.4, etc.) we just skip — the warning modal
    // already told the operator to keep the tab focused.
    if (filesToSend.length > CHUNK_SIZE && "wakeLock" in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        // If the OS auto-releases (e.g. the tab loses visibility for
        // longer than the browser permits), null out the ref so our
        // finally-block doesn't try to release an already-dead lock.
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch (_e) {
        wakeLockRef.current = null;  // permission denied, low battery, etc.
      }
    }
    const totalBatches = Math.ceil(filesToSend.length / CHUNK_SIZE);
    // Airdrop mode: when the user drops more than AIRDROP_THRESHOLD
    // files at once, the frontend stops blocking on the per-job
    // processing pipeline.  ``sendOne`` returns the moment the
    // backend has buffered the bytes (HTTP 202 + job_id), and the
    // server keeps grinding through metadata extraction / Calibre
    // conversion / classification / R2 mirror in the background.
    // The user gets the upload bar to 100% in seconds instead of
    // minutes, and the library hydrates as books finish processing.
    //
    // 20 is the sweet spot from the user trial — a casual drop of
    // 1-10 books still gets clean metadata immediately on the cards,
    // but a bulk archive import (50, 200, 1000+ books) flies.
    //
    // The persisted localStorage job IDs still survive the early
    // return so the backend's recovery cron + a future "Pending
    // uploads" admin page can reconcile any work that didn't finish.
    const AIRDROP_THRESHOLD = 20;
    const airdropMode = filesToSend.length > AIRDROP_THRESHOLD;
    setProgress({ done: 0, total: filesToSend.length, batch: 1, batches: totalBatches, inFlight: 0, startedAt: Date.now(), airdrop: airdropMode });
    // 2026-08-27 — Seed per-file state via the useFileProgressState hook.
    // It handles the fileRefsRef Map + tags each File with `._shelfsortId`
    // internally so sendOne can look up its progress row without an id arg.
    // 2026-08-27 (evening) — initFiles now returns a `resumedCount` when
    // the smart-merge detects rows previously marked `sessionInterrupted`
    // that match the incoming drop by name+size.  Toast the count so the
    // user knows their re-drop auto-recovered the interrupted files.
    const { resumedCount } = initFiles(filesToSend);
    if (resumedCount > 0) {
      toast.success(
        `Auto-resumed ${resumedCount} interrupted file${resumedCount === 1 ? "" : "s"} from your previous session.`,
      );
    }
    const duplicates = [];
    const allActions = [];
    const allUrlLists = [];
    const allSuggestions = [];
    const allCrossDupes = [];
    const allUnknownHosts = new Set();
    const failedFiles = []; // {file, error} — files we couldn't upload (after retry)
    let resp = null;
    try {
      // 2026-07-04 EVENING HOTFIX #3 — Parallel uploads (1 file per
      // HTTP request, multiple requests in flight).
      //
      // Earlier today we shipped two iterations:
      //   v1: batches of 3 files per request + per-batch retry on
      //       transient errors.  Failed when each batch took > 100s
      //       (Cloudflare's edge timeout) because of a slow upstream
      //       Claude classifier — every batch 524'd.
      //   v2: batch size dropped to 1 file per request to fit each
      //       call into the 100s window.  Worked but sent 24 sequential
      //       requests = ~13min for a 24-book drop.  Users would tab away.
      //   v3 (here): keep 1 file per request (Cloudflare safe) BUT send
      //       CONCURRENCY requests in parallel via Promise.allSettled.
      //       24 books = 6 rounds × ~30s = ~3min.  Throughput
      //       recovered 4x without bigger per-request payloads.
      //
      // We use allSettled rather than all so one slow/failed file
      // doesn't poison the whole round — every promise resolves and we
      // partition into success/failure ourselves.
      //
      // Failure handling preserved from v1:
      //   • 5xx (incl. Cloudflare 524) fails fast — retrying is useless,
      //     the server gave up
      //   • Transient *network* errors (no response) get one retry with
      //     800ms backoff per-request inside sendOne
      //   • Failed files accumulate in `failedFiles[]` and the final
      //     toast surfaces a sticky one-click "Retry N" button
      // 2026-06-27 — Bumped CONCURRENCY 6 → 8 alongside the airdrop
      // mode work.  The backend's AV_BG_CONCURRENCY and
      // POLISH_CONCURRENCY are both 4, but neither competes with
      // upload-staging directly — upload_jobs is just buffered disk
      // I/O + a fire-and-forget task.  Cloudflare's per-IP
      // connection ceiling is well above 8, and the backend event
      // loop happily handles 8 simultaneous async file copies.
      //   • Airdrop mode (filesToSend > 20): no polling, so 8
      //     concurrent POSTs sustain near-line-rate bandwidth.
      //   • Classic mode (≤ 20 files): still 8 concurrent POSTs,
      //     each polling its job for completion.
      // 2026-06-28 — Cloudflare 520-class hardening.  Production hit
      // a 200-file bulk where Cloudflare returned ~176 "origin web
      // server sent a response that Cloudflare could not parse"
      // errors after ~24 successful uploads.  Classic origin
      // saturation: the first wave consumes the connection pool /
      // worker slots, subsequent requests die mid-flight, Cloudflare
      // can't parse the (empty/dropped) origin response, frontend
      // sees a wall of 520s.
      //
      // Fix has three layers:
      //   1. Treat 5xx as TRANSIENT (auto-retry with exp backoff)
      //      not terminal.  Up to 4 attempts: ~1s, 3s, 8s.
      //   2. Sliding-window transient-error counter throttles
      //      CONCURRENCY 8 → 3 when 3+ of the last 8 sendOne calls
      //      came back transient, giving the origin breathing room.
      //   3. Friendly error message replaces the raw Cloudflare body
      //      in the toast.  The "Retry N" button still works as
      //      before — but with the new retry-on-transient behaviour
      //      the typical user never has to click it.
      //
      // 2026-08-24 — Tuning after 27 prod upload failures overnight
      // (user report + screenshot).  Two knobs dropped:
      //   • Baseline CONCURRENCY 8 → 6 — the first burst was hitting
      //     origin harder than it could handle when the pod was cold.
      //     6 preserves ~75% of the peak throughput of 8 while cutting
      //     initial pressure by 25 %.
      //   • TRANSIENT_THROTTLE 3 → 2 — the sliding-window throttle
      //     reacts one wave earlier now, so the origin gets breathing
      //     room after just 2 transient blips instead of waiting for
      //     a 3rd (by which point 3+ files were already past retries).
      // The TypeError bug in api.js's response interceptor was fixed
      // in the same commit — see /app/frontend/src/lib/errors.js.
      //
      // 2026-08-24 (afternoon) — Post-tuning result: 19/200 failures
      // (was 27/200 = 30% improvement).  User target: ≤5/200.  Root
      // cause of the remaining 19: all show the friendly "Server
      // briefly overloaded" message, meaning all 4 retries exhausted.
      // The retries themselves are the herd — they all fire at the
      // same t+1s / t+3s / t+8s marks and collide with each other on
      // recovery.  Adding three surgical changes to break the herd
      // and give the origin adaptive breathing room:
      //   (A) Slow-start ramp — begin CONCURRENCY at 3, +1 per 5
      //       consecutive successes, cap at CONCURRENCY_CEILING (6).
      //       Drop -2 (down to THROTTLED_CONCURRENCY = 3) on any
      //       transient.  This means a cold-start batch of 200 files
      //       never hits the origin with more than 3 concurrent for
      //       the first ~15 seconds, ramping up only if the origin
      //       proves it can handle more.
      //   (B) Jittered exponential backoff — retries now spread over
      //       ±30 % random jitter around each nominal delay so waves
      //       of retries don't collide with each other.
      //   (C) Bumped MAX_ATTEMPTS 4 → 5 with a longer overall retry
      //       budget (~90 s worst case) — catches origin recoveries
      //       that arrive after the old 8s ceiling.
      // See TRANSIENT_BACKOFFS_MS below for the new schedule.
      const CONCURRENCY_CEILING = 6;
      const CONCURRENCY_FLOOR = 1;
      const THROTTLED_CONCURRENCY = 3;
      const SLOW_START_INITIAL = 3;
      const SLOW_START_STEP_SUCCESSES = 5;
      let CONCURRENCY = SLOW_START_INITIAL;
      let consecutiveSuccesses = 0;
      const transientWindow = [];          // last N booleans, 1 = transient
      const TRANSIENT_WINDOW = 8;
      const TRANSIENT_THROTTLE = 2;
      // Per-batch telemetry — posted once when the batch finishes so
      // the admin dashboard can chart failure-rate trends by day and
      // correlate them with the concurrency-tuning history.
      const batchStats = {
        batch_id: (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        started_at: Date.now(),
        total_files: filesToSend.length,
        transient_retries: 0,                // sum of extra attempts across all files
        throttled_events: 0,                 // # of times we dropped to THROTTLED_CONCURRENCY
        ramp_events: 0,                      // # of times slow-start bumped concurrency up
        peak_concurrency: SLOW_START_INITIAL,
        min_concurrency_after_start: SLOW_START_INITIAL,
        // succeeded / failed / durations / failure_reasons filled at the end.
      };
      const recordTransient = (isTransient) => {
        transientWindow.push(isTransient ? 1 : 0);
        if (transientWindow.length > TRANSIENT_WINDOW) transientWindow.shift();
        const recent = transientWindow.reduce((a, b) => a + b, 0);
        if (isTransient) {
          // Reset the slow-start success counter — origin proved fragile.
          consecutiveSuccesses = 0;
        } else {
          // Successful send — count toward the next ramp bump.
          consecutiveSuccesses += 1;
          if (
            CONCURRENCY < CONCURRENCY_CEILING &&
            recent < TRANSIENT_THROTTLE &&
            consecutiveSuccesses >= SLOW_START_STEP_SUCCESSES
          ) {
            CONCURRENCY = Math.min(CONCURRENCY + 1, CONCURRENCY_CEILING);
            batchStats.ramp_events += 1;
            batchStats.peak_concurrency = Math.max(batchStats.peak_concurrency, CONCURRENCY);
            consecutiveSuccesses = 0;
            console.info(
              `[upload] slow-start ramp — CONCURRENCY → ${CONCURRENCY} ` +
              `(no transients in last ${transientWindow.length} results)`,
            );
          }
        }
        if (recent >= TRANSIENT_THROTTLE && CONCURRENCY > THROTTLED_CONCURRENCY) {
          CONCURRENCY = THROTTLED_CONCURRENCY;
          batchStats.throttled_events += 1;
          batchStats.min_concurrency_after_start = Math.min(batchStats.min_concurrency_after_start, CONCURRENCY);
          consecutiveSuccesses = 0;
          console.warn(
            `[upload] origin appears saturated (${recent}/${transientWindow.length} recent transients) — ` +
            `dropping concurrency to ${THROTTLED_CONCURRENCY} to give it breathing room`,
          );
        }
        // Belt-and-braces floor — should never fire but keeps CONCURRENCY
        // from accidentally going to 0 if future tuning inverts a sign.
        if (CONCURRENCY < CONCURRENCY_FLOOR) CONCURRENCY = CONCURRENCY_FLOOR;
      };

      // Detect the "transient origin error" pattern we want to
      // auto-retry.  Covers Cloudflare 5xx (520-527 = origin
      // connectivity / parse / SSL / no-reachable-origin), classic
      // server-overload codes (502/503/504), and the body-text
      // signature Cloudflare uses when it returns a parseable status
      // but the body says "could not parse" (some edges return 200
      // with an HTML error page in unusual configurations).
      const isTransientOriginError = (status, errMessage) => {
        if (typeof status === "number") {
          if (status === 500) return true;  // 2026-06-29 — see comment below
          if (status === 502 || status === 503 || status === 504) return true;
          if (status >= 520 && status <= 527) return true;
        }
        const msg = String(errMessage || "").toLowerCase();
        if (msg.includes("cloudflare could not parse")) return true;
        if (msg.includes("origin web server")) return true;
        if (msg.includes("malformed http")) return true;
        if (msg.includes("empty response")) return true;
        return false;
      };
      // 2026-06-29 — 500 added to the transient set.  Real "bad
      // request" errors (400/401/413/422) still fail-fast.  500 in
      // practice is almost always a transient backend hiccup
      // (classifier crash, Mongo failover, AV daemon paused) that
      // resolves on the next attempt — and the polish_worker's
      // permanent-vs-transient split (2026-06-28) already protects
      // the book row from being silently sentinelized server-side,
      // so a retried 500 won't double-process anything.

      let uploaded = 0;
      let totalAuto = 0;
      let lastPolicy = null;
      const keepSet = new Set(keepOriginalNames);

      // Send a single file via the *async* job pipeline (P0, 2026-06-24).
      // The old flow held one HTTP connection open for the entire
      // parse + classify + R2-mirror duration — slow uploads got 524'd
      // by Cloudflare at the 100s edge timeout.  The new flow:
      //   1. POST /books/upload/async  → 202 + {job_id} in ~1s
      //   2. GET  /books/upload/jobs/{job_id} every 1.5s
      //   3. status === "done" → return the same {books,actions,...}
      //      response shape the old endpoint produced
      // Net result: the SUBMIT half can never 524.  Only the poll
      // window can stall, and a stall there doesn't lose work — the
      // backend keeps processing and the next poll picks it up.
      const sendOne = async (file) => {
        // 2026-06-29 — Pre-validation: catch obvious failures before
        // they hit the server.  Cuts the 4xx noise in the failed-
        // uploads banner and prevents 0-byte files from consuming an
        // upload slot that a real file could have used.
        if (!file || file.size === 0) {
          patchFile(file?._shelfsortId, { status: "failed", reason: "Empty file (0 bytes)", progress: 0 });
          return {
            ok: false,
            file: file || { name: "(unknown)" },
            error: "File is empty (0 bytes) — likely a bad copy/move on your side.",
            status: 400,
            preValidated: true,
          };
        }
        // Mark this file as actively uploading the moment we pick it
        // up (the 0–250ms jitter delay below is still "uploading" from
        // the user's perspective — better than sitting on "queued"
        // while another concurrency slot has already started).
        patchFile(file._shelfsortId, { status: "uploading", progress: 0 });
        // Light client-side jitter (0–250ms) before firing.  When the
        // upload queue dispatches N files near-simultaneously they
        // thundering-herd the backend; even staggered by a few
        // hundred ms the 502/503 rate drops noticeably.  Cheap, no
        // downside on small drops (one file: ~125ms p50).
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 250)));

        const form = new FormData();
        form.append("files", file);
        if (keepSet.has(file.name)) form.append("keep_originals", file.name);
        let lastErr = null;
        // 2026-06-28 — bumped 2 → 4 attempts for transient origin
        // errors.  Backoff schedule: 0ms, ~1000ms, ~3000ms, ~8000ms.
        // Real bugs (400/401/413/422 etc.) still fail-fast on attempt
        // 0 via the ``isTransientOriginError`` gate below.
        //
        // 2026-08-24 (afternoon) — Bumped 4 → 5 attempts with a longer,
        // JITTERED exponential schedule.  Previously all 4 retries
        // landed within an ~8-second window, which meant a cold-start
        // origin blip that took ~15s to recover killed every file in
        // the burst.  The new schedule spreads retries over ~90s
        // worst-case AND randomizes each delay by ±30% so retry waves
        // from different files don't sync up and re-slam the origin.
        //   attempt 1 (retry 0): fires immediately
        //   attempt 2 (retry 1): 2s ± 30%   =>  1.4 – 2.6s
        //   attempt 3 (retry 2): 6s ± 30%   =>  4.2 – 7.8s
        //   attempt 4 (retry 3): 15s ± 30%  =>  10.5 – 19.5s
        //   attempt 5 (retry 4): 45s ± 30%  =>  31.5 – 58.5s
        // The final 45s wait catches longer origin recoveries (Mongo
        // failover, R2 slow-start, LLM cold-start) that used to
        // manifest as false "Server briefly overloaded" failures.
        const MAX_ATTEMPTS = 5;
        const TRANSIENT_BACKOFFS_MS_BASE = [0, 2000, 6000, 15000, 45000];
        const jitterMs = (base) => {
          if (!base) return 0;
          // ±30% uniform jitter.
          const factor = 1 + (Math.random() * 0.6 - 0.3);
          return Math.max(0, Math.floor(base * factor));
        };
        let sawTransient = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            batchStats.transient_retries += 1;
            const base = TRANSIENT_BACKOFFS_MS_BASE[attempt] || 45000;
            await new Promise((r) => setTimeout(r, jitterMs(base)));
          }
          try {
            const submitRes = await api.post("/books/upload/async", form, {
              headers: { "Content-Type": "multipart/form-data" },
              onUploadProgress: (e) => {
                // e.total is 0 when the server hasn't set Content-Length
                // yet or the axios adapter can't compute it — fall back
                // to file.size which is authoritative from the browser.
                const total = e.total || file.size || 0;
                const loaded = e.loaded || 0;
                if (total > 0) {
                  const pct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
                  patchFile(file._shelfsortId, { status: "uploading", progress: pct });
                }
              },
            });
            const jobId = submitRes?.data?.job_id;
            if (!jobId) {
              patchFile(file._shelfsortId, { status: "failed", reason: "Server didn't return a job id.", progress: 100 });
              recordTransient(sawTransient);
              return { ok: false, file, error: "Server didn't return a job id.", status: 500 };
            }
            // 2026-08-27 (iter-122) — PROD-DUPLICATE BUG FIX.
            // Once we have a job_id, the file's bytes are ON THE SERVER
            // and a background job has been enqueued.  Any error that
            // happens from this point forward (weird response shape,
            // patchFile edge case, transient network glitch during
            // polling) MUST NOT bubble to the outer retry-with-backoff
            // — otherwise the retry POSTs the same file AGAIN, creating
            // a duplicate on the server.  Wrap everything in a nested
            // try/catch that soft-fails without re-throwing.
            try {
              // Persist the job ID so we can resume polling if the user
              // refreshes / closes the tab mid-upload.  Removed in the
              // finally-equivalent paths below (done/failed/timeout).
              trackPendingJob(jobId, file.name);
              // Bytes are on the server — flip the per-file bar to the
              // indeterminate "Processing" shimmer while the async worker
              // parses / classifies / R2-mirrors the epub.
              patchFile(file._shelfsortId, { status: "processing", progress: 100 });

            // Airdrop short-circuit: bytes are safely on the backend
            // (HTTP 202 received), the asyncio task is already
            // running, and the backend cron + on-startup recovery
            // hook will pick up any work we lose track of.  Return
            // immediately so the next file in the concurrency slot
            // can start uploading.
            if (airdropMode) {
              recordTransient(sawTransient);
              // We keep the job ID in localStorage — a future visit
              // to the library will reconcile.  No data lost.
              // Airdrop mode won't get a "done" per file (we don't
              // poll individual jobs); mark the file as done so the
              // list doesn't get stuck on "Processing…" forever.  A
              // second-pass reconciliation on the library page will
              // catch any that ultimately failed server-side.
              patchFile(file._shelfsortId, { status: "done" });
              return { ok: true, file, data: {}, airdrop: true };
            }
            // Poll up to ~3 minutes.  Larger EPUBs + slow Claude can
            // take 30–60s; we give 4–5× headroom so an LLM hiccup
            // doesn't surface as a fake failure.
            const POLL_INTERVAL_MS = 1000;
            const MAX_POLLS = 180;  // 3 min wall-clock at 1s intervals
            for (let i = 0; i < MAX_POLLS; i++) {
              await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
              let pollRes;
              try {
                pollRes = await api.get(`/books/upload/jobs/${jobId}`);
              } catch (pollErr) {
                // Transient polling error — keep trying, the job is
                // still running server-side.  Only break out if the
                // server explicitly says 404 (the job was deleted).
                const ps = pollErr?.response?.status;
                if (ps === 404) {
                  untrackPendingJob(jobId);
                  recordTransient(sawTransient);
                  patchFile(file._shelfsortId, {
                    status: "failed",
                    reason: "Upload job disappeared.",
                  });
                  return { ok: false, file, error: "Upload job disappeared.", status: 404 };
                }
                continue;
              }
              const status = pollRes?.data?.status;
              if (status === "done") {
                untrackPendingJob(jobId);
                recordTransient(sawTransient);
                // Mark done — unless the backend reported a per-file
                // "failed:true" inside the books array, or a
                // "duplicate_pending" entry which shows in the list as
                // Skipped so the user knows the file was well-formed
                // but sat in the duplicates prompt instead of the shelf.
                const responseData = pollRes.data.response || {};
                const firstBook = Array.isArray(responseData?.books) ? responseData.books[0] : null;
                if (firstBook?.failed) {
                  patchFile(file._shelfsortId, {
                    status: "failed",
                    reason: firstBook.error || "Upload failed",
                  });
                } else if (firstBook?.duplicate_pending) {
                  patchFile(file._shelfsortId, {
                    status: "skipped",
                    reason: "Duplicate — see prompt when this batch finishes",
                  });
                } else {
                  patchFile(file._shelfsortId, { status: "done" });
                }
                return { ok: true, file, data: responseData };
              }
              if (status === "failed") {
                untrackPendingJob(jobId);
                recordTransient(sawTransient);
                patchFile(file._shelfsortId, {
                  status: "failed",
                  reason: pollRes.data.error || "Upload job failed",
                });
                return {
                  ok: false,
                  file,
                  error: pollRes.data.error || "Upload job failed",
                  status: 500,
                };
              }
            }
            // Poll loop ran to MAX_POLLS without resolving — leave the
            // job tracked so the next mount can pick it up.  The
            // backend is likely still processing.
            recordTransient(sawTransient);
            patchFile(file._shelfsortId, {
              status: "failed",
              reason: "Server processing took too long.",
            });
            return { ok: false, file, error: "Server processing took too long.", status: 504 };
            } catch (postSuccessErr) {
              // 2026-08-27 (iter-122) — Anything that throws AFTER we
              // have a job_id is soft-failed here.  We do NOT re-throw
              // to the outer retry-with-backoff — that would duplicate
              // the file on the server.  This was the "extra books
              // uploaded" bug in prod.
              console.error("Post-POST error for file, marking failed (NOT retrying POST):", file.name, postSuccessErr);
              try { untrackPendingJob(jobId); } catch { /* best-effort */ }
              recordTransient(sawTransient);
              patchFile(file._shelfsortId, {
                status: "failed",
                reason: "Upload was received but processing hit a snag.  Refresh your library — if this file isn't there, drop it again.",
                progress: 100,
              });
              return { ok: false, file, error: String(postSuccessErr?.message || postSuccessErr), status: 500 };
            }
          } catch (e) {
            lastErr = e;
            const status = e?.response?.status;
            const body = e?.response?.data;
            // Body might be a Cloudflare HTML page; stringify to scan.
            const bodyText = typeof body === "string" ? body : JSON.stringify(body || "");
            const transient = isTransientOriginError(status, e?.message + " " + bodyText);
            if (transient) {
              sawTransient = true;
              // Loop to next attempt with backoff.
              continue;
            }
            // No status = network blip; treat as transient too.
            if (typeof status !== "number") {
              sawTransient = true;
              continue;
            }
            // Real client error (4xx that isn't 429) — fail-fast.
            break;
          }
        }
        // All attempts exhausted.
        recordTransient(sawTransient);
        const status = lastErr?.response?.status;
        let detail =
          lastErr?.response?.data?.detail ||
          lastErr?.message ||
          "Upload failed";
        if ((typeof status === "number" && status >= 520 && status <= 527)
            || isTransientOriginError(status, detail + " " + JSON.stringify(lastErr?.response?.data || ""))) {
          detail = "Server briefly overloaded — please wait a moment and retry. Other uploads will keep running.";
        } else if (status === 524 || status === 504) {
          detail = "Server took too long to accept this file. Try again in a few minutes.";
        } else if (status === 502 || status === 503) {
          // 2026-07-01 — Strict cloud-staging mode (UPLOAD_REQUIRE_CLOUD_STAGING=1)
          // returns 503 when R2 mirroring fails 3× — surface the
          // server's specific detail if present so the user knows to
          // retry vs "something's on fire".
          const serverDetail = lastErr?.response?.data?.detail;
          if (typeof serverDetail === "string" && serverDetail.toLowerCase().includes("storage")) {
            detail = serverDetail;
          } else {
            detail = "Server is temporarily unavailable. Try again in a moment.";
          }
        } else if (status === 500) {
          // 2026-06-29 — Raw axios "Request failed with status code 500"
          // was leaking into the failed-uploads banner.  Humanize it so
          // the row reads consistently with the other transient cases
          // and doesn't look scarier than the rest.
          detail = "Server hit an unexpected error processing this file. Re-drop it in a moment.";
        } else if (status === 413) {
          detail = "File too large for this upload.";
        }
        console.error("File upload failed:", file.name, status, detail, lastErr);
        patchFile(file._shelfsortId, { status: "failed", reason: detail, progress: 100 });
        return { ok: false, file, error: detail, status };
      };

      // 2026-07-04 — Smooth progress ticker.  Originally we incremented
      // `uploaded` inside the for-of-settled loop *after* a whole round
      // of CONCURRENCY=4 files finished, which made the counter visibly
      // jump 0→4→8→12.  Now we bump it inside sendOne the moment each
      // individual file resolves (success OR failure), so the user sees
      // it tick 1, 2, 3, 4… in real time even while files upload in
      // parallel.  JS is single-threaded so the `uploaded += 1` is safe
      // across the 4 concurrent promises, and React batches the rapid
      // setProgress calls naturally.
      const tickProgress = (batchIdx) => {
        uploaded += 1;
        setProgress((p) => ({
          ...p,
          done: uploaded,
          total: filesToSend.length,
          batch: batchIdx + 1,
          batches: totalBatches,
          // inFlight is decremented when a file resolves; the round
          // dispatcher below increments it before kicking off each
          // file.  Together they give the user a live "currently
          // working on N books" readout.
          inFlight: Math.max(0, p.inFlight - 1),
        }));
      };

      // Walk the files list in batches of CHUNK_SIZE (sequential) and
      // within each batch in rounds of CONCURRENCY (parallel).  For
      // small drops (≤200) this collapses to a single batch and the
      // behaviour matches the pre-chunking loop exactly.
      //
      // 2026-08-27 (BUG FIX) — CONCURRENCY is a mutable `let` that
      // slow-start ramps up / transient-throttle drops down DURING the
      // `await Promise.allSettled` in each round.  The old loop used
      // `i += CONCURRENCY` in the for-header, which read the value
      // AFTER the mutation, meaning:
      //   • Ramp 3→6:  slice[0..3), then i+=6 → next slice starts at
      //     6, skipping files 3,4,5 entirely.  Those files never enter
      //     sendOne and end up marked "stuck" by markStuckAsFailed at
      //     batch end.  This is the source of the "some files get
      //     lost, have to be put back in" report from the user.
      //   • Throttle 6→3:  slice[0..6), then i+=3 → next slice starts
      //     at 3, re-processing files 3,4,5 (harmless — server dedupes
      //     — but wastes bandwidth).
      // Fix: snapshot the CONCURRENCY value at ROUND START and use the
      // same value for both the slice size AND the increment.
      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * CHUNK_SIZE;
        const batchFiles = filesToSend.slice(batchStart, batchStart + CHUNK_SIZE);
        for (let i = 0; i < batchFiles.length; ) {
          const roundSize = CONCURRENCY;   // snapshot — do NOT re-read after await
          const round = batchFiles.slice(i, i + roundSize);
          // Mark every file in this round as in-flight before we kick
          // off the parallel sendOne calls.  Each call decrements via
          // tickProgress once it resolves.
          setProgress((p) => ({ ...p, inFlight: p.inFlight + round.length }));
          const settled = await Promise.allSettled(round.map(async (file) => {
            const result = await sendOne(file);
            tickProgress(batchIdx);  // bump counter as soon as THIS file finishes
            return result;
          }));
          i += roundSize;             // advance by the SAME value we sliced by
          for (const r of settled) {
            // sendOne never throws — it returns {ok:false}.  Defensive
            // handling here in case a future refactor breaks that.
            const val = r.status === "fulfilled" ? r.value : { ok: false, file: null, error: String(r.reason) };
            if (!val.ok) {
              if (val.file) failedFiles.push({ file: val.file, error: val.error });
              continue;
            }
            const data = val.data;
            // Per-file `failed:true` entries from the backend (corrupt
            // EPUB, AV-flagged, classifier crash) — these come back in a
            // 200 response but still represent a failure for the user.
            for (const b of (data?.books || [])) {
              if (b?.duplicate_pending && (b.duplicate_of || []).length > 0) {
                duplicates.push(b);
              }
              if (b?.failed) {
                const orig = b.filename === val.file.name ? val.file : null;
                if (orig) {
                  failedFiles.push({ file: orig, error: b.error || "Upload failed" });
                }
              }
            }
            if (Array.isArray(data?.actions)) allActions.push(...data.actions);
            if (Array.isArray(data?.url_lists)) allUrlLists.push(...data.url_lists);
            if (Array.isArray(data?.fandom_suggestions)) allSuggestions.push(...data.fandom_suggestions);
            if (Array.isArray(data?.cross_format_duplicates)) allCrossDupes.push(...data.cross_format_duplicates);
            if (Array.isArray(data?.unknown_sources_found)) {
              data.unknown_sources_found.forEach((h) => allUnknownHosts.add(h));
            }
            for (const ul of (data?.url_lists || [])) {
              (ul?.unknown_sources_found || []).forEach((h) => allUnknownHosts.add(h));
            }
            totalAuto += data?.auto_resolved || 0;
            if (data?.policy) lastPolicy = data.policy;
          }
        }
      }
      resp = { auto_resolved: totalAuto, policy: lastPolicy, actions: allActions };
      const succeededCount = filesToSend.length - failedFiles.length;
      // 2026-08-24 — Batch telemetry.  Post one summary record per
      // batch (regardless of success / failure counts) so the admin
      // dashboard can chart failure-rate trends by day and correlate
      // them with concurrency-tuning history.  Fire-and-forget; a
      // telemetry POST that itself fails must not create a nested
      // failed-uploads toast (that would be recursion-worthy).
      const failureReasons = {};
      for (const ff of failedFiles) {
        const key = String(ff.error || "Upload failed").slice(0, 100);
        failureReasons[key] = (failureReasons[key] || 0) + 1;
      }
      const finalStats = {
        ...batchStats,
        finished_at: Date.now(),
        duration_ms: Date.now() - batchStats.started_at,
        succeeded: succeededCount,
        failed: failedFiles.length,
        // Truncate the reasons list — top-5 by count is plenty for the
        // admin dashboard and keeps individual documents small.
        failure_reasons: Object.entries(failureReasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count })),
        airdrop_mode: !!airdropMode,
      };
      api.post("/upload-jobs/batch-stats", finalStats).catch(() => {});
      // 2026-06-28 — Auto-dismiss any previously-failed
      // upload_failures rows whose filename matches one of the files
      // we just successfully uploaded.  Makes the banner feel magic:
      // re-drop the failed files → their entries quietly disappear
      // without the user clicking dismiss.  Fire-and-forget.
      if (succeededCount > 0) {
        const failedNames = new Set(failedFiles.map((f) => f.file?.name));
        const successNames = filesToSend
          .map((f) => f?.name)
          .filter((n) => n && !failedNames.has(n));
        if (successNames.length > 0) {
          api.post("/uploads/failures/dismiss-by-filenames", {
            filenames: successNames,
          }).catch(() => {});
        }
      }
      if (failedFiles.length > 0) {
        // 2026-06-28 — Persist per-file failures so the user can
        // review them later from the banner on /library/all and
        // the section on /account.  Fire-and-forget; we don't want
        // a telemetry POST to surface its own error toast on top
        // of the upload one the user is already looking at.
        for (const ff of failedFiles) {
          api.post("/uploads/failures", {
            filename: ff.file?.name || "(unknown)",
            size_bytes: ff.file?.size || 0,
            error: String(ff.error || "Upload failed").slice(0, 500),
            failure_stage: "network",
          }).catch(() => {});
        }
        // Some files failed.  Pop a sticky summary toast with a
        // one-click retry button so the user doesn't lose their work.
        // 5xx errors are fast-failed (no retry), so the user sees the
        // count quickly rather than waiting through multiple timeouts.
        const retryFiles = failedFiles.map((x) => x.file);
        toast.error(
          `Uploaded ${succeededCount} of ${filesToSend.length} · ${failedFiles.length} failed`,
          {
            duration: 20000,
            description:
              failedFiles[0]?.error
                ? `First failure: ${String(failedFiles[0].error).slice(0, 140)}`
                : undefined,
            action: {
              label: `Retry ${failedFiles.length}`,
              onClick: () => handleFiles(retryFiles),
            },
          },
        );
        // Still notify parent of any successful work so the library refreshes.
        onUploaded && onUploaded(duplicates, allActions, allUrlLists);
      } else if (allUrlLists.length > 0 && filesToSend.length === allUrlLists.length) {
        // Only URL list(s) — no books actually ingested
        const totalNew = allUrlLists.reduce((acc, r) => acc + (r.new_urls?.length || 0), 0);
        const totalOwned = allUrlLists.reduce((acc, r) => acc + (r.already_owned?.length || 0), 0);
        toast.success(`Found ${totalNew} new URL${totalNew === 1 ? "" : "s"} · ${totalOwned} already in your library`);
        onUploaded && onUploaded(duplicates, allActions, allUrlLists);
      } else if (duplicates.length === 0) {
        const autoCount = (resp && resp.auto_resolved) || 0;
        const policy = resp && resp.policy;
        if (autoCount > 0 && policy && policy !== "ask") {
          const LABEL = { keep_both: "kept both", discard: "discarded", new_version: "replaced as new versions", historical: "linked as historical versions" };
          toast.success(`Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} · ${autoCount} duplicate${autoCount > 1 ? "s" : ""} ${LABEL[policy] || "auto-resolved"}`);
        } else {
          toast.success(`Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} into your library`);
        }
        onUploaded && onUploaded(duplicates, allActions, allUrlLists);
      } else {
        toast.success(
          `Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} — ${duplicates.length} possible duplicate${duplicates.length > 1 ? "s" : ""} to review`,
        );
        onUploaded && onUploaded(duplicates, allActions, allUrlLists);
      }

      // 2026-07-04 — Post-upload AV scan is now run automatically as
      // part of the "Polish my library" flow (PolishLibraryPage.jsx),
      // not as a separate prompt here.  Removed the dedicated toast
      // because nagging users after every upload was friction; the
      // polish step is a more natural "library tidy-up" moment to
      // pair with an AV sweep.  Books still arrive as
      // `av_status: "unscanned"` and the existing /account/safety
      // banner + 90-day nudge catch users who never polish.

      // Soft warning: backend flagged some uploaded fandoms as suspiciously
      // close to existing ones — likely a typo. Surface in a sticky toast
      // so the user can pop open Account → Fandom aliases to fix it.
      if (allSuggestions.length > 0) {
        const lines = allSuggestions.slice(0, 3).map((s) =>
          `"${s.new_fandom}" looks like ${s.suggestions.slice(0, 2).map((x) => `"${x}"`).join(" or ")}`
        );
        const more = allSuggestions.length > 3 ? ` (+${allSuggestions.length - 3} more)` : "";
        toast(
          `Possible fandom typos: ${lines.join(" · ")}${more}. Add an alias in Account → Fandom aliases to merge them.`,
          { duration: 12000 },
        );
      }
      if (allCrossDupes.length > 0) {
        const sample = allCrossDupes.slice(0, 2).map((d) =>
          `"${d.new_filename}" matches your EPUB "${d.matched_title}" by ${d.matched_author}`
        ).join(" · ");
        const more = allCrossDupes.length > 2 ? ` (+${allCrossDupes.length - 2} more)` : "";
        toast(
          `Heads up: ${allCrossDupes.length} original${allCrossDupes.length === 1 ? "" : "s"} duplicate book${allCrossDupes.length === 1 ? "" : "s"} you already have as EPUB. ${sample}${more}. They're saved on /library/originals.`,
          { duration: 14000 },
        );
      }
      // Heads-up: we found story-shaped URLs from hosts that aren't on
      // Shelfsort's accepted-sources list yet. Logged for review — does
      // NOT block the upload.
      if (allUnknownHosts.size > 0) {
        const hosts = Array.from(allUnknownHosts).slice(0, 3);
        const more = allUnknownHosts.size > 3 ? ` (+${allUnknownHosts.size - 3} more)` : "";
        toast(
          `Heads-up: spotted ${allUnknownHosts.size} potential new fanfic source${allUnknownHosts.size === 1 ? "" : "s"} (${hosts.join(", ")}${more}). They've been logged so we can review adding them.`,
          { duration: 14000 },
        );
      }

      // 2026-06-27 — "Smart split" post-big-import nudge.
      // When a user just chunked through 200+ books we surface a
      // celebratory CTA that funnels them straight into their
      // Year-in-Books Wrapped — the heaviest onboarding moment
      // becomes the most rewarding one (and shareable, since the
      // Wrapped page has a public-share token).  Gated on:
      //   • Drop actually used chunking (totalBatches > 1)
      //   • Majority of files succeeded — no point celebrating a
      //     batch where most files failed
      // We fire-and-forget the navigate via toast action so the
      // user can ignore the nudge if they want to keep uploading.
      const usedChunking = totalBatches > 1;
      const mostlySucceeded = failedFiles.length < filesToSend.length / 2;
      if (usedChunking && mostlySucceeded) {
        const succeeded = filesToSend.length - failedFiles.length;
        const year = new Date().getFullYear();
        toast.success(
          `🎉 ${succeeded.toLocaleString()} books sorted — that's a real library!`,
          {
            duration: 18000,
            description: `Want to see your ${year} Year-in-Books Wrapped? It's perfect for sharing.`,
            action: {
              label: "See my Wrapped",
              onClick: () => navigate(`/library/year/${year}`),
            },
          },
        );
      }
    } catch (e) {
      console.error(e);
      toast.error("Upload failed. Please try again.");
    } finally {
      // Airdrop-mode-specific success toast: the rest of the success
      // path can't fire toasts about "N classified" or "fandom merge
      // suggestions" because we never waited for the backend to
      // produce that data.  Replace the standard "N books sorted"
      // toast with a friendly "your books are landing" message that
      // also nudges the user toward the polish banner.
      if (airdropMode && failedFiles.length === 0) {
        toast.success(
          `Airdropped ${filesToSend.length.toLocaleString()} books — they're sorting in the background.`,
          {
            duration: 12000,
            description: "You can close the tab. Refresh the library page to see them appear as each one finishes.",
          },
        );
      }
      setUploading(false);
      setProgress({ done: 0, total: 0, batch: 1, batches: 1 });
      inFlightRef.current = false;
      // 2026-08-27 (evening hotfix) — Guardrail against orphaned rows.
      // If ANY code in the try{} block above threw mid-batch (rare — a
      // malformed response body, a state-mutation exception, etc.), the
      // outer catch on line 1317 bails BEFORE all files got their
      // terminal patchFile.  Without this fallback those files sit in
      // "queued" forever, which is exactly the "stuck for 15 min"
      // failure mode reported 2026-08-27 (13 done, 3 stuck queued,
      // zero server-side POSTs for the 3).  Snap any survivors to
      // `failed` so the user can Retry from the list.
      markStuckAsFailed();
      // 2026-08-27 — Clear the per-file progress list after a short
      // linger so users can review the batch outcome; then it disappears
      // (and the localStorage entry is wiped by the persist effect
      // when fileStates becomes empty).
      scheduleClearIfComplete();
      // 2026-07-08 — Release the Screen Wake Lock if we're still
      // holding one.  ``release()`` returns a promise but we don't
      // await it — nothing downstream cares whether the release lands
      // synchronously, and swallowing errors here keeps the finally
      // block simple.
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch (_e) { /* ignore */ }
        wakeLockRef.current = null;
      }
    }
  }, [onUploaded, formatPrefs]);

  // 2026-06-28 — Global "shelfsort:upload-files" event listener.
  // Pages outside the UploadZone subtree (e.g. the FailedUploadsList
  // banner on /library/all and the section on /account) need a way
  // to hand a `File[]` array back to this component without
  // prop-drilling refs or restructuring the layout.  A page-level
  // CustomEvent is a tiny, declarative integration point that
  // survives router changes and keeps the upload pipeline as the
  // single place where retry / throttle / progress / failure
  // telemetry lives.
  useEffect(() => {
    const onUploadFilesEvent = (e) => {
      const files = e?.detail;
      if (!files || (Array.isArray(files) && files.length === 0)) return;
      // Explicit retry actions bypass staging — the user already
      // clicked "Re-drop" or "Retry on server", so they expect the
      // pipeline to fire immediately.
      handleFiles(files);
    };
    window.addEventListener("shelfsort:upload-files", onUploadFilesEvent);
    return () => window.removeEventListener("shelfsort:upload-files", onUploadFilesEvent);
  }, [handleFiles]);

  // 2026-07-06 — Staging tray helpers.  ``addToStagedQueue`` dedupes
  // by ``name::size`` so re-dropping the same folder doesn't double
  // it, and enforces a soft cap so the browser doesn't OOM on
  // tens of thousands of File objects.  The new shim key
  // ``__stageKey`` is non-enumerable on the underlying File so the
  // upload pipeline ignores it.
  const stagedKey = (f) => `${f.name}::${f.size}`;
  const addToStagedQueue = (filesList) => {
    const incoming = Array.from(filesList || []);
    if (incoming.length === 0) return;
    setStagedFiles((prev) => {
      const seen = new Set(prev.map((f) => f.__stageKey));
      const fresh = [];
      let duplicates = 0;
      for (const f of incoming) {
        const key = stagedKey(f);
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        // Stamp the dedupe key onto the File for stable React keys
        // + cheap removal.  File is iterable so we attach as a
        // direct property (writable but non-enumerable wouldn't
        // matter — the upload pipeline only reads name/size/etc.).
        try {
          f.__stageKey = key;
        } catch {
          // Shouldn't happen with real File objects, but defend.
        }
        seen.add(key);
        fresh.push(f);
      }
      const next = [...prev, ...fresh];
      if (next.length > STAGED_CAP) {
        const dropped = next.length - STAGED_CAP;
        toast(
          `Queue capped at ${STAGED_CAP.toLocaleString()} files — ${dropped} skipped. Hit Start to send what you have, then add more.`,
          { duration: 6000 },
        );
        next.length = STAGED_CAP;
      }
      if (duplicates > 0) {
        toast(`${duplicates} duplicate file${duplicates === 1 ? "" : "s"} already in queue`, { duration: 3500 });
      }
      const added = next.length - prev.length;
      if (added > 0) {
        toast.success(
          `Queued ${added} file${added === 1 ? "" : "s"} — ${next.length} ready to upload`,
          { duration: 3000 },
        );
      }
      return next;
    });
  };
  const removeFromStaged = (key) => {
    setStagedFiles((prev) => prev.filter((f) => f.__stageKey !== key));
  };
  const startStagedUpload = () => {
    if (stagedFiles.length === 0 || uploading) return;
    const batch = stagedFiles;
    // 2026-08-27 (iter-121) — Clear the tray at Start.  In the new
    // flow the tray is review-only and the compact `<UploadFileList/>`
    // takes over as the sole progress display, so we don't need to
    // keep stagedFiles populated during upload.  Clearing here also
    // means an accidental double-click on Start doesn't double-queue.
    setStagedFiles([]);
    // The draft has done its job — clear it so the restore banner
    // doesn't fire next time the user comes back.
    api.delete("/uploads/staged-drafts").catch(() => {});
    setStagedDraft(null);
    handleFiles(batch);
  };

  // "Clear all" wipes both the staged tray AND any fileStates from
  // a previous batch's progress list, giving the user a truly fresh
  // slate.  Also called by the compact list's "Clear all" link.
  const clearStaged = () => {
    setStagedFiles([]);
    clearFileStates();
  };

  // 2026-07-06 — Debounced draft autosave.  Fires ~1s after the last
  // change to stagedFiles so a rapid sequence of folder picks
  // doesn't slam the API.  Empty queue → server-side delete.
  useEffect(() => {
    if (!stagingEnabled) return undefined;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(async () => {
      try {
        if (stagedFiles.length === 0) {
          // Only call delete if we previously had a draft on the
          // server — saves a useless DELETE on every page load.
          if (stagedDraft) {
            await api.delete("/uploads/staged-drafts").catch(() => {});
            setStagedDraft(null);
          }
          return;
        }
        const payload = {
          files: stagedFiles.map((f) => ({
            name: f.name,
            size: f.size,
            rel_path: f.webkitRelativePath || f.__relativePath || "",
          })),
        };
        const { data } = await api.put("/uploads/staged-drafts", payload);
        // Stash the source hints the server derived so the tray
        // can show "from <folder>" without re-deriving them client-side.
        setStagedDraft({
          files: payload.files,
          source_hints: data?.source_hints || [],
          total_bytes: data?.total_bytes || 0,
          updated_at: new Date().toISOString(),
        });
      } catch {
        // Best-effort persistence — silently fail.
      }
    }, 1000);
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [stagedFiles, stagingEnabled]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-07-06 — On mount: fetch the user's last saved draft so the
  // restore banner can render below the dropzone.  Only when staging
  // is on and the tray is currently empty.
  useEffect(() => {
    if (!stagingEnabled) return;
    if (stagedFiles.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/uploads/staged-drafts");
        if (cancelled) return;
        if (data?.draft && Array.isArray(data.draft.files) && data.draft.files.length > 0) {
          setStagedDraft(data.draft);
        }
      } catch {
        // No-op — restore is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stagingEnabled]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dismissStagedDraft = async () => {
    try {
      await api.delete("/uploads/staged-drafts");
    } catch {
      // ignore
    }
    setStagedDraft(null);
  };

  const restoreFromDraft = () => {
    // Browser security forbids us from accessing the user's files
    // without a fresh user gesture, so the best we can do is pop
    // open the folder picker.  The user re-picks the same folder,
    // the dedupe-by-name-size in addToStagedQueue means re-picking
    // is idempotent if they accidentally restore twice.
    if (folderInputRef.current) {
      folderInputRef.current.click();
    } else {
      inputRef.current?.click();
    }
  };

  // Routes a fresh drop / file-pick.  Goes to the tray when staging
  // is on (and we're not mid-upload), otherwise straight into the
  // pipeline.  Staging during an in-flight upload silently falls
  // through to the existing "Already uploading…" toast in
  // handleFiles so the guard logic stays single-sourced.
  const acceptIncomingFiles = (filesList) => {
    if (stagingEnabled && !uploading) {
      addToStagedQueue(filesList);
      return;
    }
    handleFiles(filesList);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    try {
      const files = await filesFromDataTransfer(e.dataTransfer);
      acceptIncomingFiles(files);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read what you dropped");
    }
  };

  return (
    <>
      <div className="flex justify-end mb-2" data-testid="upload-ai-off-pill-wrap">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#6B46C1]/30 bg-[#6B46C1]/5 text-[10px] font-medium text-[#6B46C1]"
          data-testid="upload-ai-off-pill"
          title="Turn off AI classification in Account settings"
        >
          <ShieldCheck className="w-3 h-3" aria-hidden="true" /> AI-off mode available
        </span>
      </div>
      {/* 2026-08-27 — Reload-warning amber banner.  Complements the
          browser's native beforeunload prompt above.  Purely
          informational; auto-resume already handles the recovery
          case if the user does reload. */}
      {inProgressCount > 0 && (
        <div
          data-testid="upload-in-progress-banner"
          className="mb-3 px-4 py-2 rounded-lg bg-[#FBF1D6] border border-[#E8D89A] text-xs text-[#7C5F1F] flex items-center gap-2"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>
            {inProgressCount} upload{inProgressCount === 1 ? "" : "s"} in progress — reloading now
            will require {inProgressCount === 1 ? "a" : "another"} re-drop.
          </span>
        </div>
      )}
      {/* Resume-after-refresh banner — shown briefly on mount while we
          re-attach to any in-flight upload jobs that were started in a
          previous tab/session.  Vanishes the moment those jobs finish
          (or are reported still-running). */}
      {resumingCount > 0 && (
        <div
          data-testid="upload-resume-banner"
          className={`mb-3 px-4 py-2.5 rounded-lg bg-[#FFF6E5] border border-[#E07A5F]/30 text-sm text-[#2C2C2C] flex items-center gap-2.5`}
        >
          <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin shrink-0" />
          <span>
            Picking up where you left off — checking on{" "}
            <strong>{resumingCount}</strong> background upload
            {resumingCount === 1 ? "" : "s"} from earlier…
          </span>
        </div>
      )}
      {/* One-time educational tip: tab-close-safe upload pipeline. */}
      <AirdropInfoTip compact={compact} />

      {/* 2026-07-06 — "Stage before upload" toggle.  Sits above the
          dropzone (outside its click target) so flipping it doesn't
          fire the picker.  Hidden during an active upload to keep
          the in-flight UI focused. */}
      {!uploading && (
        <div
          className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-[#EDE6D5]"
          data-testid="staging-toggle-row"
        >
          <div className="flex items-center gap-2 text-xs text-[#5B5F4D]">
            <span className="font-semibold text-[#2C2C2C]">Stage before upload</span>
            <span className="hidden sm:inline">— review your batch, then hit Start</span>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stagingEnabled}
              onChange={(e) => toggleStaging(e.target.checked)}
              className="sr-only peer"
              data-testid="staging-toggle"
              aria-label="Stage files before upload"
            />
            <span className="relative inline-block w-9 h-5 rounded-full bg-[#E4D9C8] peer-checked:bg-[#6B46C1] transition-colors">
              <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs text-[#5B5F4D]">{stagingEnabled ? "On" : "Off"}</span>
          </label>
        </div>
      )}
      <div
        data-testid="upload-zone"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        className={`dropzone ${drag ? "active" : ""} flex flex-col items-center justify-center ${compact ? "p-5 md:p-6" : "p-10 md:p-16"} cursor-pointer text-center`}
        onClick={() => !uploading && inputRef.current?.click()}
      >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTS.join(",")}
        multiple
        className="hidden"
        data-testid="upload-input"
        onChange={(e) => acceptIncomingFiles(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        // Non-standard attributes — Chromium + WebKit support webkitdirectory,
        // Firefox also accepts it. Reading lints can't see these directly.
        // eslint-disable-next-line react/no-unknown-property
        webkitdirectory=""
        // eslint-disable-next-line react/no-unknown-property
        directory=""
        // eslint-disable-next-line react/no-unknown-property
        mozdirectory=""
        multiple
        className="hidden"
        data-testid="upload-folder-input"
        onChange={(e) => acceptIncomingFiles(e.target.files)}
      />
      {uploading ? (
        <>
          <Loader2 className={`${compact ? "w-6 h-6 mb-2" : "w-10 h-10 mb-4"} text-[#E07A5F] animate-spin`} />
          <p className={`font-serif ${compact ? "text-lg" : "text-2xl"} text-[#2C2C2C]`}>
            {progress.airdrop ? "Airdropping your library…" : "Sorting your books…"}
          </p>
          <p className="text-sm text-[#5B5F4D] mt-1" data-testid="upload-progress-text">
            {progress.batches > 1
              ? `Batch ${progress.batch} of ${progress.batches} · ${progress.done} of ${progress.total} ${progress.airdrop ? "queued" : "processed"}`
              : `${progress.done} of ${progress.total} ${progress.airdrop ? "queued" : "processed"}`}
          </p>
          {wakeLockRef.current && (
            <p
              className="text-[11px] text-[#3D6B3D] mt-1.5 inline-flex items-center gap-1.5 bg-[#EAF5EA] px-2 py-0.5 rounded-full"
              data-testid="upload-progress-wakelock"
              title="Screen wake lock is active — your laptop won't sleep while this upload runs. Keep the tab visible."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#3D6B3D]" aria-hidden />
              Keep-awake active
            </p>
          )}
          {progress.airdrop && (
            <p
              className="text-xs text-[#5B5F4D] mt-1 italic max-w-md text-center"
              data-testid="upload-progress-airdrop-note"
            >
              Bytes are landing fast — sorting, covers and AI classification will fill in on the library page as each book finishes processing.
            </p>
          )}
          {(progress.inFlight > 0 || progress.startedAt > 0) && !progress.airdrop && (
            <p
              className="text-xs text-[#5B5F4D] mt-1 italic"
              data-testid="upload-progress-flight"
            >
              {progress.inFlight > 0
                ? `${progress.inFlight} book${progress.inFlight === 1 ? "" : "s"} currently sorting`
                : "Wrapping up"}
              {progress.startedAt > 0 && (
                <> · {Math.max(1, Math.floor((Date.now() - progress.startedAt) / 1000))}s elapsed</>
              )}
              {(() => {
                // 2026-08-27 — Estimated-time-remaining chip.
                // Rate = done_count / elapsed_ms; ETA = pending * (1 / rate).
                // Requires at least 2 done files + 5s elapsed before we
                // trust the average enough to display it, otherwise the
                // first blazing-fast file makes the ETA look wildly wrong
                // for 30 seconds.
                if (progress.airdrop) return null;
                // Reference `nowTick` so this IIFE re-computes on every
                // 1s heartbeat (see setInterval near line 200).
                void nowTick;
                const elapsedMs = Date.now() - progress.startedAt;
                if (elapsedMs < 5_000) return null;
                let done = 0, pending = 0;
                for (const f of fileStates) {
                  if (f.status === "done" || f.status === "skipped") done += 1;
                  else if (f.status === "queued" || f.status === "uploading" || f.status === "processing") pending += 1;
                }
                if (done < 2 || pending === 0) return null;
                const msPerFile = elapsedMs / done;
                const etaMs = Math.round(pending * msPerFile);
                if (etaMs < 1_000) return null;
                // Human-readable: "1h 12m", "8m 34s", "42s".
                const totalSec = Math.round(etaMs / 1000);
                const h = Math.floor(totalSec / 3600);
                const m = Math.floor((totalSec % 3600) / 60);
                const s = totalSec % 60;
                let label;
                if (h > 0) label = `${h}h ${m}m`;
                else if (m > 0) label = `${m}m ${s}s`;
                else label = `${s}s`;
                return (
                  <>
                    {" "}·{" "}
                    <span
                      className="not-italic font-medium text-[#5B5F4D]"
                      data-testid="upload-progress-eta"
                      title={`Averaging ${(msPerFile / 1000).toFixed(1)}s per file across ${done} completed. Extrapolated over the ${pending} still to go.`}
                    >
                      ~{label} left
                    </span>
                  </>
                );
              })()}
            </p>
          )}
          {queueSummary && (
            queueSummary.jobs_done_recent > 0 ||
            queueSummary.polish_pending > 0 ||
            queueSummary.jobs_queued > 0 ||
            queueSummary.jobs_processing > 0 ||
            queueSummary.polish_failed > 0
          ) && (
            <div
              className="mt-3 inline-flex items-center gap-2 flex-wrap justify-center text-[11px] text-[#5B5F4D]"
              data-testid="upload-queue-summary-strip"
            >
              {queueSummary.jobs_done_recent > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2E6] text-[#3D6B3D] border border-[#C8E1C8] font-semibold"
                  data-testid="qs-saved"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5C8A5C]" />
                  {queueSummary.jobs_done_recent.toLocaleString()} saved to library
                </span>
              )}
              {queueSummary.polish_pending > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FBF1D6] text-[#7C5F1F] border border-[#E8D89A] font-semibold"
                  data-testid="qs-polishing"
                  title="Claude is filling in fandom + category for these books in the background."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D49A33] animate-pulse" />
                  {queueSummary.polish_pending.toLocaleString()} still sorting
                </span>
              )}
              {queueSummary.jobs_processing > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8E0F4] text-[#553397] border border-[#D4C5EE] font-semibold"
                  data-testid="qs-processing"
                  title="Async upload jobs currently being parsed by the worker."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#6B46C1] animate-pulse" />
                  {queueSummary.jobs_processing.toLocaleString()} processing
                </span>
              )}
              {queueSummary.jobs_queued > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F0EBE2] text-[#5B5F4D] border border-[#E4D9C8] font-semibold"
                  data-testid="qs-queued"
                  title="Async upload jobs waiting for the worker to pick them up."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#A09A8B]" />
                  {queueSummary.jobs_queued.toLocaleString()} queued
                </span>
              )}
              {queueSummary.polish_failed > 0 && (
                <button
                  type="button"
                  onClick={openRetryInbox}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FBE2E0] text-[#7C2D2A] border border-[#E8B5B0] font-semibold hover:bg-[#F8D2CE] focus:outline-none focus:ring-2 focus:ring-[#7C2D2A]/40 cursor-pointer transition-colors"
                  data-testid="qs-polish-failed"
                  title="Click to review and retry stuck books."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C75450]" />
                  {queueSummary.polish_failed.toLocaleString()} couldn&apos;t classify
                  <span className="ml-1 opacity-70 text-[10px]">↗</span>
                </button>
              )}
            </div>
          )}
        </>
      ) : compact ? (
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
          <div className="flex items-center gap-3 text-left">
            <UploadCloud className="w-7 h-7 text-[#E07A5F] shrink-0" />
            <div>
              <p className="font-serif text-lg text-[#2C2C2C] leading-tight">Drop files or folders here</p>
              <p className="text-xs text-[#5B5F4D]">EPUB · PDF · Kindle · DOCX · auto-sorted</p>
            </div>
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              data-testid="pick-files-btn"
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] inline-flex items-center gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5" /> Choose files
            </button>
            <button
              type="button"
              data-testid="pick-folder-btn"
              onClick={() => folderInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E07A5F]/40 text-[#E07A5F] hover:bg-[#FDF3E1] inline-flex items-center gap-1.5"
            >
              <FolderUp className="w-3.5 h-3.5" /> Pick a folder
            </button>
          </div>
        </div>
      ) : (
        <>
          <UploadCloud className="w-10 h-10 text-[#E07A5F] mb-4" />
          <p className="font-serif text-2xl text-[#2C2C2C] mb-1">Drop files or folders here</p>
          <p className="text-sm text-[#5B5F4D] mb-2">
            EPUB · PDF · Kindle (.azw/.mobi) · DOCX · auto-converted to EPUB and sorted
          </p>
          <p className="text-xs text-[#6E6E6E] italic mb-4 max-w-md text-center">
            Tip: Shelfsort processes <strong className="text-[#5B5F4D] not-italic font-semibold">200 stories at a time</strong> — drop a bigger library and we&apos;ll auto-queue it in sequential batches for you.
          </p>
          <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              data-testid="pick-files-btn"
              onClick={() => inputRef.current?.click()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] inline-flex items-center gap-2"
            >
              <UploadCloud className="w-4 h-4" /> Choose files
            </button>
            <button
              type="button"
              data-testid="pick-folder-btn"
              onClick={() => folderInputRef.current?.click()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#E07A5F]/40 text-[#E07A5F] hover:bg-[#FDF3E1] inline-flex items-center gap-2"
            >
              <FolderUp className="w-4 h-4" /> Pick a folder
            </button>
          </div>
        </>
      )}
    </div>
    {/* 2026-08-27 (iter-121) — Compact per-file progress list.
        Now renders REGARDLESS of the staging setting so users get
        the same progress UX in both flows: staging=on tray → Start
        → this list; staging=off drop → this list.  Sits OUTSIDE
        the `uploading` gate so:
          • rows stay visible after a batch completes (users can
            review done/skipped/failed rows and retry failures)
          • rows rehydrated from localStorage on page refresh are
            visible immediately.
        When `uploading` is false and there are still rows to show,
        the list header shows a "Clear all" / "Dismiss last batch
        results" link so the user can wipe and start fresh. */}
    {fileStates.length > 0 && (
      <div className="mt-4">
        {/* 2026-08-27 (iter-121) — Clear all button always available.
            Shows regardless of upload state.  During active upload
            this clears the CLIENT UI only — in-flight XHRs continue
            server-side (and the auto-resume path picks them up if
            the user re-drops later). */}
        <div className="flex justify-between items-center mb-2 gap-2">
          <span className="text-xs text-[#5B5F4D]">
            {uploading
              ? `${fileStates.length} file${fileStates.length === 1 ? "" : "s"} in this batch`
              : `${fileStates.length} file${fileStates.length === 1 ? "" : "s"} · batch complete`}
          </span>
          <button
            type="button"
            onClick={clearFileStates}
            className="text-xs text-[#5B5F4D] hover:text-[#2C2C2C] underline underline-offset-2"
            data-testid="upload-progress-clear-all"
            title={uploading
              ? "Wipes the visible list.  Server-side uploads already in flight will still complete; re-drop those files later if you want them back on the list."
              : "Wipe the results and start fresh."}
          >
            Clear all
          </button>
        </div>
        <UploadFileList
          files={fileStates}
          onRetry={retryFileById}
          onRetryAll={retryAllFailed}
        />
      </div>
    )}
    {/* 2026-08-27 (iter-121) — Reverted iter-119's "tray stays visible
        during upload" behaviour.  Now the tray is a pure review UI:
        gated back to `!uploading`.  Once the user hits Start, the
        tray disappears and the compact `<UploadFileList/>` renders
        as the sole progress display — same UX regardless of the
        staging setting.  The user found the tray-during-upload
        confusing and asked for uniform progress UX between
        staging-on and staging-off. */}
    {!uploading && stagingEnabled && (
      <StagedUploadTray
        files={stagedFiles}
        onRemove={removeFromStaged}
        onClear={clearStaged}
        onStart={startStagedUpload}
        busy={uploading}
        capacity={STAGED_CAP}
      />
    )}
    {/* 2026-07-06 — Restore banner: only render when staging is on,
        the tray is currently empty, AND there's a saved draft from a
        previous session.  Disappears the moment the user drops a
        fresh file (which would shadow the saved intent anyway). */}
    {!uploading && stagingEnabled && stagedFiles.length === 0 && stagedDraft && (
      <StagedDraftRestoreBanner
        draft={stagedDraft}
        onRestore={restoreFromDraft}
        onDismiss={dismissStagedDraft}
      />
    )}
    {retryInboxOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
        data-testid="retry-inbox-modal"
        onClick={() => !retryInboxBusy && setRetryInboxOpen(false)}
      >
        <div
          className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-white border border-[#EDE6D5] shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-5 border-b border-[#EDE6D5]">
            <h3 className="font-serif text-2xl text-[#2C2C2C]">
              Books that couldn&apos;t classify
            </h3>
            <p className="text-sm text-[#5B5F4D] mt-1">
              The classifier gave up on these — usually a transient Claude/network blip.
              Hit <strong>Retry all</strong> to send them back through the pipeline.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4" data-testid="retry-inbox-list">
            {retryInboxLoading && (
              <p className="text-sm text-[#5B5F4D] py-6 text-center">
                <Loader2 className="w-4 h-4 inline-block animate-spin mr-2" /> Loading…
              </p>
            )}
            {!retryInboxLoading && retryInboxBooks.length === 0 && (
              <p className="text-sm text-[#5B5F4D] py-6 text-center" data-testid="retry-inbox-empty">
                No stuck books right now — everything classified successfully.
              </p>
            )}
            {!retryInboxLoading && retryInboxBooks.map((b) => (
              <div
                key={b.book_id}
                className="py-3 border-b border-[#EDE6D5] last:border-b-0"
                data-testid={`retry-inbox-item-${b.book_id}`}
              >
                <p className="font-serif text-base text-[#2C2C2C] truncate">
                  {b.title || b.filename || "Untitled"}
                </p>
                <p className="text-xs text-[#5B5F4D] truncate">
                  {b.author || "Unknown author"}
                </p>
                {b.polish_last_error && (
                  <p
                    className="text-xs text-[#7C2D2A] font-mono mt-1 line-clamp-1"
                    title={b.polish_last_error}
                    data-testid={`retry-inbox-error-${b.book_id}`}
                  >
                    ✗ {b.polish_last_error}
                  </p>
                )}
                {b.polish_attempts > 1 && (
                  <p className="text-[10px] text-[#6E6E6E] uppercase tracking-[0.12em] mt-1">
                    {b.polish_attempts} attempts
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="px-6 py-4 border-t border-[#EDE6D5] flex items-center justify-between gap-3">
            <p className="text-xs text-[#5B5F4D]">
              {retryInboxBooks.length > 0
                ? `${retryInboxBooks.length} book${retryInboxBooks.length === 1 ? "" : "s"} ready to retry.`
                : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRetryInboxOpen(false)}
                disabled={retryInboxBusy}
                data-testid="retry-inbox-close-btn"
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-[#EDE6D5] text-[#5B5F4D] hover:bg-[#FDFBF7] disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={retryAllStuck}
                disabled={retryInboxBusy || retryInboxLoading || retryInboxBooks.length === 0}
                data-testid="retry-inbox-retry-all-btn"
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {retryInboxBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Retry all
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
