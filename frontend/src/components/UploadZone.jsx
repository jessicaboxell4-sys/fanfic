import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, Loader2, FolderUp } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  loadPendingJobs,
  trackPendingJob,
  untrackPendingJob,
} from "../lib/uploadJobs";
import AirdropInfoTip from "./AirdropInfoTip";

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
async function readEntry(entry) {
  const out = [];
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
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
  // `batch` / `batches` are populated when a drop exceeds CHUNK_SIZE so the
  // progress line can read "Batch 2 of 5 · 347 of 1000 processed".  For
  // smaller drops they stay at 1/1 and the UI hides the batch prefix.
  const [progress, setProgress] = useState({ done: 0, total: 0, batch: 1, batches: 1, inFlight: 0, startedAt: 0 });
  // 1-second heartbeat so the "Xs elapsed" line in the progress UI
  // re-renders even when no file has resolved yet.  Only ticking
  // while ``uploading`` is true keeps it a no-op the rest of the time.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!uploading) return undefined;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
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
    const CHUNK_SIZE = 200;
    if (filesToSend.length > CHUNK_SIZE) {
      const batches = Math.ceil(filesToSend.length / CHUNK_SIZE);
      const ok = window.confirm(
        `Whoa, that's a big library! Shelfsort processes ${CHUNK_SIZE} books per batch for stability.\n\n` +
        `We'll auto-queue all ${filesToSend.length} files in ${batches} sequential batches — sit tight and we'll work through them.\n\n` +
        `OK = Sort all ${filesToSend.length} now\n` +
        `Cancel = Stop and try a smaller drop`,
      );
      if (!ok) {
        toast("Upload cancelled — try a smaller drop or pick a folder with up to 200 books at a time.");
        return;
      }
    }

    setUploading(true);
    inFlightRef.current = true;
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
      let CONCURRENCY = 8;
      const transientWindow = [];          // last N booleans, 1 = transient
      const TRANSIENT_WINDOW = 8;
      const TRANSIENT_THROTTLE = 3;
      const THROTTLED_CONCURRENCY = 3;
      const recordTransient = (isTransient) => {
        transientWindow.push(isTransient ? 1 : 0);
        if (transientWindow.length > TRANSIENT_WINDOW) transientWindow.shift();
        const recent = transientWindow.reduce((a, b) => a + b, 0);
        if (recent >= TRANSIENT_THROTTLE && CONCURRENCY > THROTTLED_CONCURRENCY) {
          CONCURRENCY = THROTTLED_CONCURRENCY;
          console.warn(
            `[upload] origin appears saturated (${recent}/${transientWindow.length} recent transients) — ` +
            `dropping concurrency to ${THROTTLED_CONCURRENCY} to give it breathing room`,
          );
        }
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
        const form = new FormData();
        form.append("files", file);
        if (keepSet.has(file.name)) form.append("keep_originals", file.name);
        let lastErr = null;
        // 2026-06-28 — bumped 2 → 4 attempts for transient origin
        // errors.  Backoff schedule: 0ms, ~1000ms, ~3000ms, ~8000ms.
        // Real bugs (400/401/413/422 etc.) still fail-fast on attempt
        // 0 via the ``isTransientOriginError`` gate below.
        const MAX_ATTEMPTS = 4;
        const TRANSIENT_BACKOFFS_MS = [0, 1000, 3000, 8000];
        let sawTransient = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, TRANSIENT_BACKOFFS_MS[attempt] || 8000));
          }
          try {
            const submitRes = await api.post("/books/upload/async", form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            const jobId = submitRes?.data?.job_id;
            if (!jobId) {
              recordTransient(sawTransient);
              return { ok: false, file, error: "Server didn't return a job id.", status: 500 };
            }
            // Persist the job ID so we can resume polling if the user
            // refreshes / closes the tab mid-upload.  Removed in the
            // finally-equivalent paths below (done/failed/timeout).
            trackPendingJob(jobId, file.name);

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
                  return { ok: false, file, error: "Upload job disappeared.", status: 404 };
                }
                continue;
              }
              const status = pollRes?.data?.status;
              if (status === "done") {
                untrackPendingJob(jobId);
                recordTransient(sawTransient);
                return { ok: true, file, data: pollRes.data.response || {} };
              }
              if (status === "failed") {
                untrackPendingJob(jobId);
                recordTransient(sawTransient);
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
            return { ok: false, file, error: "Server processing took too long.", status: 504 };
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
          detail = "Server is temporarily unavailable. Try again in a moment.";
        } else if (status === 413) {
          detail = "File too large for this upload.";
        }
        console.error("File upload failed:", file.name, status, detail, lastErr);
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
      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * CHUNK_SIZE;
        const batchFiles = filesToSend.slice(batchStart, batchStart + CHUNK_SIZE);
        for (let i = 0; i < batchFiles.length; i += CONCURRENCY) {
          const round = batchFiles.slice(i, i + CONCURRENCY);
          // Mark every file in this round as in-flight before we kick
          // off the parallel sendOne calls.  Each call decrements via
          // tickProgress once it resolves.
          setProgress((p) => ({ ...p, inFlight: p.inFlight + round.length }));
          const settled = await Promise.allSettled(round.map(async (file) => {
            const result = await sendOne(file);
            tickProgress(batchIdx);  // bump counter as soon as THIS file finishes
            return result;
          }));
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
      handleFiles(files);
    };
    window.addEventListener("shelfsort:upload-files", onUploadFilesEvent);
    return () => window.removeEventListener("shelfsort:upload-files", onUploadFilesEvent);
  }, [handleFiles]);

  const handleDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    try {
      const files = await filesFromDataTransfer(e.dataTransfer);
      handleFiles(files);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read what you dropped");
    }
  };

  return (
    <>
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
        onChange={(e) => handleFiles(e.target.files)}
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
        onChange={(e) => handleFiles(e.target.files)}
      />
      {uploading ? (
        <>
          <Loader2 className={`${compact ? "w-6 h-6 mb-2" : "w-10 h-10 mb-4"} text-[#E07A5F] animate-spin`} />
          <p className={`font-serif ${compact ? "text-lg" : "text-2xl"} text-[#2C2C2C]`}>
            {progress.airdrop ? "Airdropping your library…" : "Sorting your books…"}
          </p>
          <p className="text-sm text-[#6B705C] mt-1" data-testid="upload-progress-text">
            {progress.batches > 1
              ? `Batch ${progress.batch} of ${progress.batches} · ${progress.done} of ${progress.total} ${progress.airdrop ? "queued" : "processed"}`
              : `${progress.done} of ${progress.total} ${progress.airdrop ? "queued" : "processed"}`}
          </p>
          {progress.airdrop && (
            <p
              className="text-xs text-[#6B705C] mt-1 italic max-w-md text-center"
              data-testid="upload-progress-airdrop-note"
            >
              Bytes are landing fast — sorting, covers and AI classification will fill in on the library page as each book finishes processing.
            </p>
          )}
          {(progress.inFlight > 0 || progress.startedAt > 0) && !progress.airdrop && (
            <p
              className="text-xs text-[#6B705C] mt-1 italic"
              data-testid="upload-progress-flight"
            >
              {progress.inFlight > 0
                ? `${progress.inFlight} book${progress.inFlight === 1 ? "" : "s"} currently sorting`
                : "Wrapping up"}
              {progress.startedAt > 0 && (
                <> · {Math.max(1, Math.floor((Date.now() - progress.startedAt + nowTick * 0) / 1000))}s elapsed</>
              )}
            </p>
          )}
        </>
      ) : compact ? (
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
          <div className="flex items-center gap-3 text-left">
            <UploadCloud className="w-7 h-7 text-[#E07A5F] shrink-0" />
            <div>
              <p className="font-serif text-lg text-[#2C2C2C] leading-tight">Drop files or folders here</p>
              <p className="text-xs text-[#6B705C]">EPUB · PDF · Kindle · DOCX · auto-sorted</p>
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
          <p className="text-sm text-[#6B705C] mb-2">
            EPUB · PDF · Kindle (.azw/.mobi) · DOCX · auto-converted to EPUB and sorted
          </p>
          <p className="text-xs text-[#A09A8B] italic mb-4 max-w-md text-center">
            Tip: Shelfsort processes <strong className="text-[#6B705C] not-italic font-semibold">200 stories at a time</strong> — drop a bigger library and we&apos;ll auto-queue it in sequential batches for you.
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
    </>
  );
}
