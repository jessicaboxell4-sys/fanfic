import React, { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Loader2, FolderUp } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

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

export default function UploadZone({ onUploaded }) {
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
  const [progress, setProgress] = useState({ done: 0, total: 0 });
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

    setUploading(true);
    inFlightRef.current = true;
    setProgress({ done: 0, total: filesToSend.length });
    const duplicates = [];
    const allActions = [];
    const allUrlLists = [];
    const allSuggestions = [];
    const allCrossDupes = [];
    const allUnknownHosts = new Set();
    const failedFiles = []; // {file, error} — files we couldn't upload (after retry)
    // 2026-07-04 — When AV_SCAN_ON_UPLOAD is off, books arrive with
    // `av_status: "unscanned"`.  We collect their IDs here so the
    // post-upload toast can offer a one-click "Scan now" follow-up
    // instead of letting unscanned files sit silently in the library.
    const unscannedBookIds = [];
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
      const CONCURRENCY = 4;
      let uploaded = 0;
      let totalAuto = 0;
      let lastPolicy = null;
      const keepSet = new Set(keepOriginalNames);

      // Send a single file. Returns {ok, file, data, error, status}.
      // Mirrors the previous per-batch retry/error-mapping logic.
      const sendOne = async (file) => {
        const form = new FormData();
        form.append("files", file);
        if (keepSet.has(file.name)) form.append("keep_originals", file.name);
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await api.post("/books/upload", form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            return { ok: true, file, data: res.data };
          } catch (e) {
            lastErr = e;
            const status = e?.response?.status;
            // Server returned a real status — not transient. Don't retry.
            if (typeof status === "number" && status >= 400) break;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
          }
        }
        const status = lastErr?.response?.status;
        let detail =
          lastErr?.response?.data?.detail ||
          lastErr?.message ||
          "Upload failed";
        if (status === 524 || status === 504) {
          detail = "Server took too long to process this file (likely the AI classifier is slow). Try again in a few minutes.";
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
      const tickProgress = () => {
        uploaded += 1;
        setProgress({ done: uploaded, total: filesToSend.length });
      };

      // Walk the files list in rounds of CONCURRENCY.
      for (let i = 0; i < filesToSend.length; i += CONCURRENCY) {
        const round = filesToSend.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(round.map(async (file) => {
          const result = await sendOne(file);
          tickProgress();  // bump the counter as soon as THIS file finishes
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
            // Track books that landed without an AV scan (because
            // AV_SCAN_ON_UPLOAD=false).  We'll prompt the user to
            // scan them at the end so the speed-up doesn't quietly
            // leave the library exposed.
            if (b?.book_id && b?.av_status === "unscanned") {
              unscannedBookIds.push(b.book_id);
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
      resp = { auto_resolved: totalAuto, policy: lastPolicy, actions: allActions };
      const succeededCount = filesToSend.length - failedFiles.length;
      if (failedFiles.length > 0) {
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

      // 2026-07-04 — Post-upload AV scan prompt.  When the operator has
      // set `AV_SCAN_ON_UPLOAD=false` to speed uploads up, books land
      // with `av_status: "unscanned"`.  We surface a sticky toast with
      // a one-click "Scan now" action so the speed-up doesn't quietly
      // leave the library exposed.  Skipped silently when every book
      // was scanned at upload time (`unscannedBookIds` would be empty).
      if (unscannedBookIds.length > 0) {
        const n = unscannedBookIds.length;
        toast(
          `${n} new book${n === 1 ? "" : "s"} ready · scan for viruses?`,
          {
            duration: 18000,
            description: "We skipped the antivirus check at upload time to keep things fast. Want to run it now?",
            action: {
              label: "Scan now",
              onClick: async () => {
                const scanning = toast.loading("Scanning your library… this can take a few minutes for large collections.");
                try {
                  const { data } = await api.post("/account/safety/rescan", {});
                  toast.dismiss(scanning);
                  const flagged = data?.flagged || 0;
                  const scanned = data?.scanned || 0;
                  if (flagged > 0) {
                    toast.error(`${flagged} infected file${flagged === 1 ? "" : "s"} found · ${scanned} scanned. Open Account → Safety to review.`, { duration: 18000 });
                  } else {
                    toast.success(`Library scan complete · ${scanned} book${scanned === 1 ? "" : "s"} checked, all clean.`);
                  }
                } catch (e) {
                  toast.dismiss(scanning);
                  const status = e?.response?.status;
                  if (status === 503) {
                    toast.error("Antivirus is currently unavailable. Try again in a minute or open Account → Safety to retry.");
                  } else if (status === 524 || status === 504) {
                    toast(
                      "Scan still running on the server — open Account → Safety in a few minutes to see the result.",
                      { duration: 14000 },
                    );
                  } else {
                    toast.error("Could not start the scan. Open Account → Safety to retry.");
                  }
                }
              },
            },
          },
        );
      }

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
    } catch (e) {
      console.error(e);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setProgress({ done: 0, total: 0 });
      inFlightRef.current = false;
    }
  }, [onUploaded, formatPrefs]);

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
    <div
      data-testid="upload-zone"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      className={`dropzone ${drag ? "active" : ""} flex flex-col items-center justify-center p-10 md:p-16 cursor-pointer text-center`}
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
          <Loader2 className="w-10 h-10 text-[#E07A5F] animate-spin mb-4" />
          <p className="font-serif text-2xl text-[#2C2C2C]">Sorting your books…</p>
          <p className="text-sm text-[#6B705C] mt-2">
            {progress.done} of {progress.total} processed
          </p>
        </>
      ) : (
        <>
          <UploadCloud className="w-10 h-10 text-[#E07A5F] mb-4" />
          <p className="font-serif text-2xl text-[#2C2C2C] mb-1">Drop files or folders here</p>
          <p className="text-sm text-[#6B705C] mb-4">
            EPUB · PDF · Kindle (.azw/.mobi) · DOCX · auto-converted to EPUB and sorted
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
  );
}
