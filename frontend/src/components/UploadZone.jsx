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

    // EPUBs always upload silently — no confirmation. Non-EPUBs are routed
    // by the user's per-format preference (Account → Non-EPUB upload prefs):
    //   "convert" → auto-add silently (Calibre will run server-side)
    //   "skip"    → silently drop (helpful if you import lots of .pdb you
    //               never actually want; just set it once and forget)
    //   "ask"     → batched into a single confirm prompt (default behavior)
    const epubs = files.filter((f) => f.name.toLowerCase().endsWith(".epub"));
    const nonEpub = files.filter((f) => !f.name.toLowerCase().endsWith(".epub"));

    const autoAdd = []; // pref === "convert"
    const autoSkip = []; // pref === "skip"
    const toAsk = []; // pref === "ask" (or unknown group → safe default)
    for (const f of nonEpub) {
      const grp = groupOf(f.name);
      const pref = grp ? (formatPrefs[grp] || "ask") : "ask";
      if (pref === "convert") autoAdd.push(f);
      else if (pref === "skip") autoSkip.push(f);
      else toAsk.push(f);
    }
    if (autoSkip.length > 0) {
      toast(
        `Skipped ${autoSkip.length} file${autoSkip.length === 1 ? "" : "s"} per your format preferences`,
        { duration: 3500 },
      );
    }

    let toUpload = [...epubs, ...autoAdd];
    if (toAsk.length > 0) {
      const formats = [...new Set(toAsk.map((f) => extOf(f.name)))];
      const formatList = formats.join(", ");
      const knownCount = epubs.length + autoAdd.length;
      const summary =
        knownCount > 0
          ? `${knownCount} file${knownCount === 1 ? "" : "s"} will be added directly.\n\nAlso add ${toAsk.length} non-EPUB file${toAsk.length === 1 ? "" : "s"} (${formatList})?`
          : `Add ${toAsk.length} non-EPUB file${toAsk.length === 1 ? "" : "s"} (${formatList}) to your library?`;
      const ok = window.confirm(
        `${summary}\n\nNon-EPUBs get auto-converted via Calibre. .txt files containing fanfic URLs are deduped against your library — no book is added for those.\n\nTip: set per-format defaults in Account → "Non-EPUB upload preferences" to skip this prompt next time.`,
      );
      if (ok) {
        toUpload = toUpload.concat(toAsk);
      } else if (toUpload.length === 0) {
        toast("Upload cancelled");
        return;
      } else {
        toast(`Skipping ${toAsk.length} non-EPUB file${toAsk.length === 1 ? "" : "s"} · sorting your ${toUpload.length} file${toUpload.length === 1 ? "" : "s"}`);
      }
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
    let resp = null;
    try {
      // Upload in batches of 3 for responsiveness
      const batchSize = 3;
      let uploaded = 0;
      let totalAuto = 0;
      let lastPolicy = null;
      for (let i = 0; i < filesToSend.length; i += batchSize) {
        const batch = filesToSend.slice(i, i + batchSize);
        const form = new FormData();
        batch.forEach((f) => form.append("files", f));
        const { data } = await api.post("/books/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        for (const b of (data?.books || [])) {
          if (b?.duplicate_pending && (b.duplicate_of || []).length > 0) {
            duplicates.push(b);
          }
        }
        if (Array.isArray(data?.actions)) allActions.push(...data.actions);
        if (Array.isArray(data?.url_lists)) {
          allUrlLists.push(...data.url_lists);
        }
        if (Array.isArray(data?.fandom_suggestions)) {
          allSuggestions.push(...data.fandom_suggestions);
        }
        totalAuto += data?.auto_resolved || 0;
        if (data?.policy) lastPolicy = data.policy;
        uploaded += batch.length;
        setProgress({ done: uploaded, total: filesToSend.length });
      }
      resp = { auto_resolved: totalAuto, policy: lastPolicy, actions: allActions };
      if (allUrlLists.length > 0 && filesToSend.length === allUrlLists.length) {
        // Only URL list(s) — no books actually ingested
        const totalNew = allUrlLists.reduce((acc, r) => acc + (r.new_urls?.length || 0), 0);
        const totalOwned = allUrlLists.reduce((acc, r) => acc + (r.already_owned?.length || 0), 0);
        toast.success(`Found ${totalNew} new URL${totalNew === 1 ? "" : "s"} · ${totalOwned} already in your library`);
      } else if (duplicates.length === 0) {
        const autoCount = (resp && resp.auto_resolved) || 0;
        const policy = resp && resp.policy;
        if (autoCount > 0 && policy && policy !== "ask") {
          const LABEL = { keep_both: "kept both", discard: "discarded", new_version: "replaced as new versions", historical: "linked as historical versions" };
          toast.success(`Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} · ${autoCount} duplicate${autoCount > 1 ? "s" : ""} ${LABEL[policy] || "auto-resolved"}`);
        } else {
          toast.success(`Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} into your library`);
        }
      } else {
        toast.success(
          `Sorted ${filesToSend.length} file${filesToSend.length > 1 ? "s" : ""} — ${duplicates.length} possible duplicate${duplicates.length > 1 ? "s" : ""} to review`,
        );
      }
      onUploaded && onUploaded(duplicates, allActions, allUrlLists);

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
