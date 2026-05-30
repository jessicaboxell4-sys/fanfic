import React, { useCallback, useRef, useState } from "react";
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
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    const duplicates = [];
    const allActions = [];
    let resp = null;
    try {
      // Upload in batches of 3 for responsiveness
      const batchSize = 3;
      let uploaded = 0;
      let totalAuto = 0;
      let lastPolicy = null;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
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
        totalAuto += data?.auto_resolved || 0;
        if (data?.policy) lastPolicy = data.policy;
        uploaded += batch.length;
        setProgress({ done: uploaded, total: files.length });
      }
      resp = { auto_resolved: totalAuto, policy: lastPolicy, actions: allActions };
      if (duplicates.length === 0) {
        const autoCount = (resp && resp.auto_resolved) || 0;
        const policy = resp && resp.policy;
        if (autoCount > 0 && policy && policy !== "ask") {
          const LABEL = { keep_both: "kept both", discard: "discarded", new_version: "replaced as new versions", historical: "linked as historical versions" };
          toast.success(`Sorted ${files.length} file${files.length > 1 ? "s" : ""} · ${autoCount} duplicate${autoCount > 1 ? "s" : ""} ${LABEL[policy] || "auto-resolved"}`);
        } else {
          toast.success(`Sorted ${files.length} file${files.length > 1 ? "s" : ""} into your library`);
        }
      } else {
        toast.success(
          `Sorted ${files.length} file${files.length > 1 ? "s" : ""} — ${duplicates.length} possible duplicate${duplicates.length > 1 ? "s" : ""} to review`,
        );
      }
      onUploaded && onUploaded(duplicates, allActions);
    } catch (e) {
      console.error(e);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [onUploaded]);

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
