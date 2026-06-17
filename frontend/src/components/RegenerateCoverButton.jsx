import React, { useState } from "react";
import { Sparkles, Loader2, X, RotateCw, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * Floating "Regenerate cover" button + preview modal for a single book.
 *
 * Two-phase UX (mirrors the backend endpoints):
 *   1. Click button  → POST /preview-cover     → modal shows AI cover
 *      with "Use this" / "Try again" / a free-text nudge field.
 *   2. Click Use this → POST /apply-cover      → persists, closes,
 *      tells parent to refetch via onCoverChanged().
 *
 * Renders as an overlay icon on the BookCard.  Hidden by default,
 * fades in on group-hover so the card stays clean when idle.
 */
export default function RegenerateCoverButton({ book, onCoverChanged }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [nudge, setNudge] = useState("");
  const [applying, setApplying] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/books/${book.book_id}/preview-cover`, {
        nudge: nudge.trim() || null,
      });
      setPreviewId(data.preview_id);
      setImageDataUrl(`data:${data.mime_type};base64,${data.image_base64}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cover generation failed");
    } finally {
      setLoading(false);
    }
  };

  const openAndGenerate = async (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setOpen(true);
    setNudge("");
    setPreviewId(null);
    setImageDataUrl(null);
    await generate();
  };

  const apply = async () => {
    if (!previewId) return;
    setApplying(true);
    try {
      await api.post(`/books/${book.book_id}/apply-cover`, { preview_id: previewId });
      toast.success("New cover saved");
      setOpen(false);
      onCoverChanged && onCoverChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save cover");
    } finally {
      setApplying(false);
    }
  };

  const close = () => {
    if (loading || applying) return;
    setOpen(false);
    setPreviewId(null);
    setImageDataUrl(null);
    setNudge("");
  };

  return (
    <>
      <button
        type="button"
        onClick={openAndGenerate}
        data-testid={`regen-cover-btn-${book.book_id}`}
        title="Regenerate cover with AI"
        aria-label="Regenerate cover with AI"
        className="absolute top-2 left-2 w-9 h-9 rounded-full flex items-center justify-center bg-white/90 border border-[#E8E6E1] text-[#6B46C1] opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:shadow-lg tap-min"
      >
        <Sparkles className="w-4 h-4" />
      </button>

      {open && (
        <div
          onClick={close}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="regen-cover-modal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-[#E5DDC5] shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="regen-cover-title"
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-5 h-5 text-[#6B46C1] flex-shrink-0" />
                <h3 id="regen-cover-title" className="font-serif text-xl text-[#2C2C2C] truncate">
                  AI cover for &ldquo;{book.title}&rdquo;
                </h3>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={loading || applying}
                data-testid="regen-cover-close"
                aria-label="Close"
                className="text-[#6B705C] hover:text-[#2C2C2C] tap-min flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Preview area — always shows a 2:3 frame so the modal
                  doesn't jump around during loading. */}
              <div
                className="aspect-[2/3] w-full max-w-[220px] mx-auto bg-[#F5F3EC] border border-[#E5DDC5] rounded-lg overflow-hidden flex items-center justify-center"
                data-testid="regen-cover-preview"
              >
                {loading ? (
                  <div className="text-center text-[#6B705C] text-sm">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Designing your cover…
                  </div>
                ) : imageDataUrl ? (
                  <img
                    src={imageDataUrl}
                    alt={`Generated cover for ${book.title}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-[#6B705C] text-sm">
                    No preview yet
                  </div>
                )}
              </div>

              {/* Free-text nudge — sent on the next regenerate. */}
              <div>
                <label htmlFor="cover-nudge" className="text-xs uppercase tracking-wider font-bold text-[#6B705C] block mb-1">
                  Optional direction
                </label>
                <input
                  id="cover-nudge"
                  type="text"
                  value={nudge}
                  onChange={(e) => setNudge(e.target.value)}
                  placeholder='e.g. "more moody" or "include a lantern motif"'
                  disabled={loading}
                  maxLength={120}
                  data-testid="regen-cover-nudge"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]"
                />
              </div>

              {/* Actions — Try again + Use this. */}
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading || applying}
                  data-testid="regen-cover-retry"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#6B46C1] hover:text-[#6B46C1] disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                  {imageDataUrl ? "Try again" : "Generate"}
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={!imageDataUrl || loading || applying}
                  data-testid="regen-cover-apply"
                  className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
                >
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Use this cover
                </button>
              </div>

              <p className="text-[11px] text-[#6B705C] italic">
                Original EPUB file is never touched — only the displayed cover changes.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
