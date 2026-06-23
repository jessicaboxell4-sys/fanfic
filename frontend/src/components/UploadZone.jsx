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
    setProgress({ done: 0, total: filesToSend.length });
    const duplicates = [];
    const allActions = [];
    const allUrlLists = [];
    const allSuggestions = [];
    const allCrossDupes = [];
    const allUnknownHosts = new Set();
    const failedFiles = []; // {file, error} — files we couldn't upload (after retry)
    let resp = null;
    try {
      // Upload in batches of 3 for responsiveness.
      // 2026-07-04 fix — Pre-fix, the try/catch wrapped the WHOLE loop so a
      // single batch failure (transient network, R2 hiccup, ClamAV crash on
      // one file) would abort the remaining ~80 files of a 100-book drop
      // with a generic "Upload failed" toast. Now each batch is its own
      // isolated unit: we retry once with a small backoff, and if it still
      // fails we record the affected files in `failedFiles` and CONTINUE
      // with the next batch. At the end we surface a single summary toast
      // with a one-click "Retry failed" action.
      const batchSize = 3;
      let uploaded = 0;
      let totalAuto = 0;
      let lastPolicy = null;
      const keepSet = new Set(keepOriginalNames);
      for (let i = 0; i < filesToSend.length; i += batchSize) {
        const batch = filesToSend.slice(i, i + batchSize);
        const form = new FormData();
        batch.forEach((f) => {
          form.append("files", f);
          if (keepSet.has(f.name)) form.append("keep_originals", f.name);
        });
        let data = null;
        let lastErr = null;
        // 2 attempts: first try + one retry with 800ms backoff for transients.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await api.post("/books/upload", form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            data = res.data;
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 800));
            }
          }
        }
        if (lastErr) {
          // Batch failed twice — record every file in it as failed and
          // continue. Don't abort the queue.
          const detail =
            lastErr?.response?.data?.detail ||
            lastErr?.message ||
            "Upload failed";
          console.error("Batch upload failed:", detail, lastErr);
          batch.forEach((f) => failedFiles.push({ file: f, error: detail }));
          uploaded += batch.length;
          setProgress({ done: uploaded, total: filesToSend.length });
          continue;
        }
        // Backend may now return per-file `failed: true` entries when one
        // file in a batch couldn't be processed (corrupt EPUB, AV-flagged,
        // classifier crash). Surface those in the failed list too so the
        // user sees them in the summary toast and can retry.
        for (const b of (data?.books || [])) {
          if (b?.duplicate_pending && (b.duplicate_of || []).length > 0) {
            duplicates.push(b);
          }
          if (b?.failed) {
            // Match the original File object by filename so the Retry
            // button can resend it. Falls back to a stub if we somehow
            // can't find it (shouldn't happen).
            const orig = batch.find((x) => x.name === b.filename);
            if (orig) {
              failedFiles.push({ file: orig, error: b.error || "Upload failed" });
            }
          }
        }
        if (Array.isArray(data?.actions)) allActions.push(...data.actions);
        if (Array.isArray(data?.url_lists)) {
          allUrlLists.push(...data.url_lists);
        }
        if (Array.isArray(data?.fandom_suggestions)) {
          allSuggestions.push(...data.fandom_suggestions);
        }
        if (Array.isArray(data?.cross_format_duplicates)) {
          allCrossDupes.push(...data.cross_format_duplicates);
        }
        // Story-shaped URLs whose host isn't on the accepted-sources list.
        // Aggregate across batches and pop a single heads-up toast at the
        // end so the user knows we flagged a potential new fic archive.
        if (Array.isArray(data?.unknown_sources_found)) {
          data.unknown_sources_found.forEach((h) => allUnknownHosts.add(h));
        }
        for (const r of (data?.url_lists || [])) {
          (r?.unknown_sources_found || []).forEach((h) => allUnknownHosts.add(h));
        }
        totalAuto += data?.auto_resolved || 0;
        if (data?.policy) lastPolicy = data.policy;
        uploaded += batch.length;
        setProgress({ done: uploaded, total: filesToSend.length });
      }
      resp = { auto_resolved: totalAuto, policy: lastPolicy, actions: allActions };
      const succeededCount = filesToSend.length - failedFiles.length;
      if (failedFiles.length > 0) {
        // Some files failed even after retry. Pop a sticky summary toast
        // with a one-click retry button so the user doesn't lose their work.
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
