import React, { useState } from "react";
import { Sparkles, Loader2, X, RotateCw, Check, Share2, Users, Download, Heart } from "lucide-react";
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
  // Style picker (Tier 2) — list fetched once when modal opens.
  // ``styleId`` empty string = Shelfsort house style (the default).
  const [styles, setStyles] = useState([]);
  const [styleId, setStyleId] = useState("");
  // Variants drawer state — fetched lazily when the modal opens so
  // the cover-less browse experience isn't slowed down by a per-card
  // GET on every render.
  const [variants, setVariants] = useState([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);

  const loadVariants = async () => {
    try {
      const { data } = await api.get(`/books/${book.book_id}/cover-variants`);
      setVariants(data?.variants || []);
      setVariantsLoaded(true);
    } catch {
      setVariantsLoaded(true);
    }
  };

  const loadStyles = async () => {
    try {
      const { data } = await api.get("/cover-styles");
      setStyles(data?.styles || []);
    } catch {
      /* fine — picker just shows nothing */
    }
  };

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/books/${book.book_id}/preview-cover`, {
        nudge: nudge.trim() || null,
        style_id: styleId || null,
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
    setVariants([]);
    setVariantsLoaded(false);
    // Fire variants + styles fetches in parallel with the generation.
    loadVariants();
    loadStyles();
    await generate();
  };

  const activateVariant = async (variantId) => {
    try {
      await api.post(`/books/${book.book_id}/cover-variants/${variantId}/activate`);
      toast.success("Switched to that cover");
      setVariants((vs) => vs.map((v) => ({ ...v, active: v.variant_id === variantId })));
      onCoverChanged && onCoverChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't switch cover");
    }
  };

  const deleteVariant = async (variantId) => {
    if (!window.confirm("Remove this cover variant?  This can't be undone.")) return;
    try {
      await api.delete(`/books/${book.book_id}/cover-variants/${variantId}`);
      setVariants((vs) => vs.filter((v) => v.variant_id !== variantId));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete variant");
    }
  };

  const shareVariant = async (variantId) => {
    try {
      const { data } = await api.post(
        `/books/${book.book_id}/cover-variants/${variantId}/share`,
      );
      toast.success(data.deduped ? "Already shared" : "Shared to community");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't share");
    }
  };

  // Community covers — lazy loaded when the user clicks "Browse".
  // Stored separately from `variants` so the Previous-covers drawer
  // stays focused on the user's own work.
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);

  const loadCommunity = async () => {
    setCommunityLoading(true);
    setCommunityOpen(true);
    try {
      const { data } = await api.get("/community-covers", {
        params: { title: book.title, author: book.author || "", fandom: book.fandom || "" },
      });
      setCommunity(data?.covers || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load community covers");
    } finally {
      setCommunityLoading(false);
    }
  };

  const importCommunity = async (coverId) => {
    try {
      await api.post(`/books/${book.book_id}/import-community-cover/${coverId}`);
      toast.success("Imported as new variant");
      await loadVariants();
      onCoverChanged && onCoverChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't import");
    }
  };

  const voteCommunity = async (coverId) => {
    try {
      const { data } = await api.post(`/community-covers/${coverId}/vote`);
      setCommunity((cs) => cs.map(c =>
        c.cover_id === coverId
          ? { ...c, votes: data.votes, voted_by_me: data.voted_by_me }
          : c,
      ));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't vote");
    }
  };

  const apply = async () => {
    if (!previewId) return;
    setApplying(true);
    try {
      await api.post(`/books/${book.book_id}/apply-cover`, { preview_id: previewId });
      toast.success("New cover saved");
      // Refresh variants in-place so the newly-applied cover appears
      // in the drawer without closing the modal.
      await loadVariants();
      setPreviewId(null);
      setImageDataUrl(null);
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
                className="text-[#5B5F4D] hover:text-[#2C2C2C] tap-min flex-shrink-0"
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
                  <div className="text-center text-[#5B5F4D] text-sm">
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
                  <div className="text-center text-[#5B5F4D] text-sm">
                    No preview yet
                  </div>
                )}
              </div>

              {/* Style picker — built-in + custom. Empty string is
                  the default Shelfsort house style. */}
              <div>
                <label htmlFor="cover-style" className="text-xs uppercase tracking-wider font-bold text-[#5B5F4D] block mb-1">
                  Style
                </label>
                <select
                  id="cover-style"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                  disabled={loading}
                  data-testid="regen-cover-style"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]"
                >
                  <option value="">Shelfsort house (default)</option>
                  {styles.filter(s => s.id !== "house").map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.kind === "custom" ? "★ " : ""}{s.name}
                    </option>
                  ))}
                </select>
                {styleId && (() => {
                  const s = styles.find(x => x.id === styleId);
                  return s ? (
                    <p className="text-[11px] text-[#5B5F4D] mt-1 italic">{s.description}</p>
                  ) : null;
                })()}
              </div>

              {/* Free-text nudge — sent on the next regenerate. */}
              <div>
                <label htmlFor="cover-nudge" className="text-xs uppercase tracking-wider font-bold text-[#5B5F4D] block mb-1">
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
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-white border border-[#E5DDC5] text-[#5B5F4D] hover:border-[#6B46C1] hover:text-[#6B46C1] disabled:opacity-60"
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

              <p className="text-[11px] text-[#5B5F4D] italic">
                Original EPUB file is never touched — only the displayed cover changes.
              </p>

              {/* Previous variants drawer — only renders once we know
                  what's there (avoids a flash of empty UI).  Each
                  variant is a 2:3 thumbnail; the active one has a ring,
                  inactive ones can be activated or deleted. */}
              {variantsLoaded && variants.length > 0 && (
                <div data-testid="cover-variants-drawer" className="pt-3 mt-2 border-t border-[#E5DDC5]">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#5B5F4D] mb-2">
                    Previous covers ({variants.length})
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {variants.map((v) => (
                      <div
                        key={v.variant_id}
                        data-testid={`cover-variant-${v.variant_id}`}
                        className={`relative flex-shrink-0 w-16 rounded-md overflow-hidden border-2 ${
                          v.active ? "border-[#6B46C1] ring-2 ring-[#6B46C1]/30" : "border-[#E5DDC5]"
                        }`}
                      >
                        <img
                          src={`data:${v.mime_type};base64,${v.image_base64}`}
                          alt="Variant"
                          className="aspect-[2/3] w-full object-cover cursor-pointer"
                          onClick={() => !v.active && activateVariant(v.variant_id)}
                          title={v.active ? "Active" : "Switch to this cover"}
                        />
                        {!v.active && (
                          <button
                            type="button"
                            onClick={() => deleteVariant(v.variant_id)}
                            data-testid={`cover-variant-delete-${v.variant_id}`}
                            title="Remove this variant"
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 border border-[#E5DDC5] flex items-center justify-center text-[#5B5F4D] hover:text-[#C04A3F]"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => shareVariant(v.variant_id)}
                          data-testid={`cover-variant-share-${v.variant_id}`}
                          title="Share to community"
                          className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 border border-[#E5DDC5] flex items-center justify-center text-[#6B46C1] hover:bg-[#6B46C1] hover:text-white"
                        >
                          <Share2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#5B5F4D] mt-1 italic">
                    Click a thumbnail to switch.  Up to 20 variants stored per book.
                  </p>
                </div>
              )}

              {/* Community covers — lazy-loaded.  Renders a button until
                  the user opens the drawer, then a grid of imported
                  community covers for the same title. */}
              <div data-testid="community-covers-section" className="pt-3 mt-2 border-t border-[#E5DDC5]">
                {!communityOpen ? (
                  <button
                    type="button"
                    onClick={loadCommunity}
                    data-testid="community-covers-browse"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white border border-[#E5DDC5] text-[#5B5F4D] hover:border-[#6B46C1] hover:text-[#6B46C1]"
                  >
                    <Users className="w-3.5 h-3.5" /> Browse community covers
                  </button>
                ) : (
                  <>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5B5F4D] mb-2 flex items-center gap-1.5">
                      <Users className="w-3 h-3" /> Community covers
                      {communityLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    </p>
                    {!communityLoading && community.length === 0 ? (
                      <p className="text-[11px] text-[#5B5F4D] italic">
                        No community covers yet for this book.  Be the first — share
                        any of your variants with the Share button above.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {community.map((c) => (
                          <div
                            key={c.cover_id}
                            data-testid={`community-cover-${c.cover_id}`}
                            className="relative rounded-md overflow-hidden border border-[#E5DDC5]"
                          >
                            <img
                              src={`data:${c.mime_type};base64,${c.image_base64}`}
                              alt={`Cover by ${c.shared_by}`}
                              className="aspect-[2/3] w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => importCommunity(c.cover_id)}
                              data-testid={`community-cover-import-${c.cover_id}`}
                              className="absolute inset-x-0 bottom-0 bg-[#6B46C1]/90 text-white text-[10px] py-1 flex items-center justify-center gap-1 hover:bg-[#6B46C1]"
                            >
                              <Download className="w-3 h-3" /> Use this
                            </button>
                            <p className="absolute top-0.5 left-0.5 text-[9px] bg-white/85 text-[#5B5F4D] px-1.5 py-0.5 rounded">{/* fontsize-ok — corner attribution overlay on a 100px cover thumbnail */}
                              @{c.shared_by} · {c.import_count}×
                            </p>
                            <button
                              type="button"
                              onClick={() => voteCommunity(c.cover_id)}
                              data-testid={`community-cover-vote-${c.cover_id}`}
                              className="absolute top-0.5 right-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-white/85 hover:bg-white"
                              title={c.voted_by_me ? "Remove your heart" : "Heart this cover"}
                            >
                              <Heart
                                className={`w-3 h-3 ${c.voted_by_me ? "fill-[#C04A3F] text-[#C04A3F]" : "text-[#5B5F4D]"}`}
                              />
                              <span className={c.voted_by_me ? "text-[#C04A3F] font-semibold" : "text-[#5B5F4D]"}>
                                {c.votes || 0}
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
