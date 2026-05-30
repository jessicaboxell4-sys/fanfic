import React, { useCallback, useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

export default function UploadZone({ onUploaded }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const handleFiles = useCallback(async (filesList) => {
    const files = Array.from(filesList).filter(f => f.name.toLowerCase().endsWith(".epub"));
    if (files.length === 0) {
      toast.error("Please drop .epub files only");
      return;
    }
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    const duplicates = [];
    try {
      // Upload in batches of 3 for responsiveness
      const batchSize = 3;
      let uploaded = 0;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const form = new FormData();
        batch.forEach(f => form.append("files", f));
        const { data } = await api.post("/books/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        for (const b of (data?.books || [])) {
          if (b?.duplicate_pending && (b.duplicate_of || []).length > 0) {
            duplicates.push(b);
          }
        }
        uploaded += batch.length;
        setProgress({ done: uploaded, total: files.length });
      }
      if (duplicates.length === 0) {
        toast.success(`Sorted ${files.length} book${files.length > 1 ? "s" : ""} into your library`);
      } else {
        toast.success(`Sorted ${files.length} book${files.length > 1 ? "s" : ""} — ${duplicates.length} possible duplicate${duplicates.length > 1 ? "s" : ""} to review`);
      }
      onUploaded && onUploaded(duplicates);
    } catch (e) {
      console.error(e);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [onUploaded]);

  return (
    <div
      data-testid="upload-zone"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`dropzone ${drag ? "active" : ""} flex flex-col items-center justify-center p-10 md:p-16 cursor-pointer text-center`}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        className="hidden"
        data-testid="upload-input"
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
          <p className="font-serif text-2xl text-[#2C2C2C] mb-1">Drop EPUB files here</p>
          <p className="text-sm text-[#6B705C]">or click to choose — bulk upload supported</p>
        </>
      )}
    </div>
  );
}
