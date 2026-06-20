import React, { useRef, useState } from "react";
import { Lightbulb, Loader2, Send, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * Help-page feedback form.  Captures free-text + an optional
 * attachment (screenshot, PDF log, small zip — any file up to
 * 10 MB).  POSTs as multipart/form-data to ``/api/feedback``.
 *
 *   <SuggestionBox source="help-page" />
 *
 * Pass ``source`` to differentiate where the submission came from
 * (useful when we later embed this on /admin too).
 */
export default function SuggestionBox({ source = "help-page" }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);     // File | null
  const [photoPreview, setPhotoPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const onPhotoPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File is larger than 10 MB.");
      return;
    }
    setPhoto(f);
    // Inline preview only for images; non-image files just show the
    // filename chip so the user knows the attach worked.
    if (f.type.startsWith("image/")) {
      setPhotoPreview(URL.createObjectURL(f));
    } else {
      setPhotoPreview(null);
    }
  };

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    const t = text.trim();
    if (t.length < 4) {
      toast.error("Add a few more words so we can act on it.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("text", t);
      fd.append("page", source);
      if (photo) fd.append("photo", photo);
      await api.post("/feedback", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Thank you — we read every one.");
      setText("");
      clearPhoto();
    } catch (err) {
      const reason = err?.response?.data?.detail;
      if (reason === "photo_too_large") {
        toast.error("That file is larger than 10 MB — try a smaller one.");
      } else if (reason === "not_an_image") {
        toast.error("That file type isn't supported here — try a different file.");
      } else if (reason === "photo_unsafe") {
        toast.error("Attachment didn't pass our antivirus check.");
      } else {
        toast.error("Couldn't send right now — try again in a minute.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="help-suggestion-box"
      className="bg-white rounded-xl border border-[#E8E6E1] p-5 mt-3"
    >
      <p className="text-sm text-[#2C2C2C] mb-2 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-[#E07A5F]" />
        <span className="font-semibold">Tell us what would make Shelfsort better</span>
      </p>
      <p className="text-xs text-[#6B705C] mb-3">
        Bug, feature wish, confusion — anything goes. You can attach a screenshot, PDF or any small file.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What would you change?"
        maxLength={2000}
        rows={5}
        data-testid="help-suggestion-textarea"
        className="w-full text-sm bg-[#FDFBF7] border border-[#E8E6E1] rounded-lg px-3 py-2 focus:outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/30 resize-y"
      />
      <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B705C] hover:text-[#E07A5F] cursor-pointer"
            data-testid="help-suggestion-photo-label"
          >
            <Paperclip className="w-3.5 h-3.5" />
            {photo ? "Change file" : "Attach file"}
            <input
              ref={fileRef}
              type="file"
              onChange={onPhotoPick}
              className="hidden"
              data-testid="help-suggestion-photo-input"
            />
          </label>
          {photo && !photoPreview && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-[#2C2C2C] bg-[#FBFAF6] border border-[#E8E6E1] rounded-full pl-3 pr-1 py-1"
              data-testid="help-suggestion-file-chip"
              title={photo.name}
            >
              <span className="truncate max-w-[18ch]">{photo.name}</span>
              <span className="text-[10px] text-[#6B705C]">
                {(photo.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={clearPhoto}
                aria-label="Remove attachment"
                className="w-5 h-5 rounded-full hover:bg-white flex items-center justify-center text-[#6B705C] hover:text-[#E07A5F]"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {photoPreview && (
            <div className="relative" data-testid="help-suggestion-photo-preview">
              <img src={photoPreview} alt="attachment" className="w-16 h-16 object-cover rounded-md border border-[#E8E6E1]" />
              <button
                type="button"
                onClick={clearPhoto}
                aria-label="Remove image"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-[#E8E6E1] rounded-full flex items-center justify-center text-[#6B705C] hover:text-[#E07A5F]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-[10px] text-[#6B705C]">{text.length}/2000</span>
          <button
            type="button"
            onClick={submit}
            disabled={busy || text.trim().length < 4}
            data-testid="help-suggestion-send"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-[#E07A5F] text-white hover:bg-[#c66a52] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send feedback
          </button>
        </div>
      </div>
    </div>
  );
}
