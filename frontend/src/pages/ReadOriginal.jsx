import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, ExternalLink, RefreshCw, AlertTriangle, FileText, BookmarkPlus, Bookmark } from "lucide-react";
import mammoth from "mammoth/mammoth.browser";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";

// Formats the browser can natively render with a simple iframe.
const NATIVE_IFRAME = new Set(["pdf", "html", "htm"]);
// Text formats fetched and rendered in a <pre> for readable wrapping.
const PLAINTEXT = new Set(["txt"]);
// DOCX uses mammoth.js to convert to HTML in the browser.
const DOCX_LIKE = new Set(["docx"]);
// Everything else needs Calibre — we offer a one-click convert-and-read
// flow that round-trips through /library/originals/{id}/convert and lands
// the user on the regular EPUB reader.
const CALIBRE_FORMATS = new Set([
  "mobi", "azw", "azw3", "kf8", "kfx",
  "fb2", "lit", "lrf", "pdb",
  "doc", "rtf",
]);

// Smart viewer for non-EPUB books on the Originals shelf. Picks the right
// renderer per format and falls back to a one-click "Convert to EPUB" CTA
// for formats no browser can render natively (Kindle, FB2, LIT, etc.).
export default function ReadOriginal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Per-format render state — only used by the formats that fetch bytes
  // client-side (TXT, DOCX).  PDF/HTML use plain <iframe> tags so they
  // bypass this.
  const [text, setText] = useState(null);
  const [docxHtml, setDocxHtml] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [converting, setConverting] = useState(false);
  // Bookmarks for non-EPUB formats.  The backend's `cfi` field doubles
  // as an opaque anchor string — we encode `page:5` for PDFs (so we can
  // re-mount the iframe with the right #page hash) and `scroll:0.42` for
  // scroll-based viewers (TXT / DOCX / HTML).
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);
  // Ref to the scrollable inner viewer so we can read / set scrollTop
  // without polluting window-scroll (the page itself can still scroll).
  const scrollRef = useRef(null);
  const iframeRef = useRef(null);
  // Goal hash sent to the iframe when the user picks a PDF bookmark.
  // We append a query string to force the browser to reload the iframe
  // (otherwise just changing the hash doesn't jump the PDF viewer).
  const [pdfReloadKey, setPdfReloadKey] = useState(0);
  const [pdfTargetPage, setPdfTargetPage] = useState(null);

  const ext = useMemo(
    () => (book?.original_format || "").toLowerCase().replace(/^\./, ""),
    [book],
  );
  const originalUrl = useMemo(
    () => `${process.env.REACT_APP_BACKEND_URL}/api/books/${id}/download-original`,
    [id],
  );

  // Load the book record so we know the format before picking a renderer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${id}`);
        if (!cancelled) setBook(data);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || "Book not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // If the book is actually an EPUB (already converted), bounce to the
  // proper EPUB reader — this page is only for raw originals.
  useEffect(() => {
    if (book && !ext) {
      // No original_format means it's a regular EPUB book.
      navigate(`/read/${id}`, { replace: true });
    }
  }, [book, ext, id, navigate]);

  // Load bookmarks once we know the book exists.
  useEffect(() => {
    if (!book || !ext) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${id}/bookmarks`);
        if (!cancelled) setBookmarks(data?.bookmarks || []);
      } catch { /* silent — bookmarks are optional */ }
    })();
    return () => { cancelled = true; };
  }, [book, ext, id]);

  // --- Bookmarks --------------------------------------------------------
  // The cfi field stores an opaque anchor encoded as `"page:N"` for PDFs
  // and `"scroll:0.42"` for scroll-based viewers. EPUBs use the real CFI;
  // these prefixes can't collide with epubcfi(...) strings.
  const isScrollViewer = PLAINTEXT.has(ext) || DOCX_LIKE.has(ext);
  const isPdf = ext === "pdf";

  const currentAnchor = useCallback(() => {
    if (isPdf) {
      // We can't read the iframe's PDF.js state from outside, so we ask
      // the user. Prefilled with the most recent bookmark when present.
      const last = bookmarks[0];
      const default_ = last?.cfi?.startsWith("page:") ? last.cfi.slice(5) : "1";
      const ans = window.prompt("Save which page number?", default_);
      if (!ans) return null;
      const n = parseInt(ans, 10);
      if (!n || n < 1) { toast.error("Page must be a positive number"); return null; }
      return { cfi: `page:${n}`, chapter_label: `Page ${n}`, percent: null };
    }
    if (isScrollViewer) {
      const el = scrollRef.current;
      if (!el) return null;
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 0 ? el.scrollTop / max : 0;
      return {
        cfi: `scroll:${pct.toFixed(4)}`,
        chapter_label: `${Math.round(pct * 100)}% through`,
        percent: pct,
      };
    }
    return null;
  }, [isPdf, isScrollViewer, bookmarks]);

  const addBookmark = useCallback(async () => {
    const anchor = currentAnchor();
    if (!anchor) return;
    try {
      const { data } = await api.post(`/books/${id}/bookmarks`, {
        ...anchor,
        note: "",
      });
      setBookmarks((prev) => {
        const without = prev.filter((b) => b.bookmark_id !== data.bookmark.bookmark_id);
        return [data.bookmark, ...without];
      });
      toast.success("Bookmarked");
      setShowBookmarkPanel(true);
    } catch (e) { toast.error("Couldn't save bookmark"); }
  }, [currentAnchor, id]);

  const jumpToBookmark = useCallback((bm) => {
    const cfi = bm?.cfi || "";
    if (cfi.startsWith("page:") && isPdf) {
      const n = parseInt(cfi.slice(5), 10) || 1;
      setPdfTargetPage(n);
      setPdfReloadKey((k) => k + 1);
      return;
    }
    if (cfi.startsWith("scroll:") && isScrollViewer) {
      const pct = parseFloat(cfi.slice(7)) || 0;
      const el = scrollRef.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTo({ top: max * pct, behavior: "smooth" });
      }
    }
  }, [isPdf, isScrollViewer]);

  const removeBookmark = useCallback(async (bookmark_id) => {
    try {
      await api.delete(`/books/${id}/bookmarks/${bookmark_id}`);
      setBookmarks((prev) => prev.filter((b) => b.bookmark_id !== bookmark_id));
    } catch { toast.error("Couldn't remove bookmark"); }
  }, [id]);

  const updateBookmarkNote = useCallback(async (bookmark_id, note) => {
    setBookmarks((prev) => prev.map((b) =>
      b.bookmark_id === bookmark_id ? { ...b, note } : b
    ));
    try { await api.patch(`/books/${id}/bookmarks/${bookmark_id}`, { note }); }
    catch { toast.error("Couldn't save note"); }
  }, [id]);

  // Cmd/Ctrl+B keyboard shortcut, same as the EPUB reader.
  useEffect(() => {
    if (!book || !ext) return;
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      addBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addBookmark, book, ext]);

  // Plaintext loader — kept tiny on purpose, just stream the bytes and
  // hand them to <pre>.
  useEffect(() => {
    if (!ext || !PLAINTEXT.has(ext)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(originalUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const t = await res.text();
        if (!cancelled) setText(t);
      } catch (e) {
        if (!cancelled) setRenderError(e.message || "Could not load text");
      }
    })();
    return () => { cancelled = true; };
  }, [ext, originalUrl]);

  // DOCX loader — mammoth.js converts the .docx zip to safe HTML client-side.
  // We only render the body; styles live in our own CSS so the output looks
  // consistent with the rest of the app instead of inheriting Word styling.
  useEffect(() => {
    if (!ext || !DOCX_LIKE.has(ext)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(originalUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (!cancelled) setDocxHtml(result.value || "<p>(empty document)</p>");
      } catch (e) {
        if (!cancelled) setRenderError(e.message || "Could not render DOCX");
      }
    })();
    return () => { cancelled = true; };
  }, [ext, originalUrl]);

  // For Kindle / FB2 / LIT / etc. — one-click Calibre conversion that
  // promotes the book into the main library, then redirects to the EPUB
  // reader.  Uses the existing /library/originals/{id}/convert endpoint.
  const convertAndRead = async () => {
    setConverting(true);
    try {
      const { data } = await api.post(`/library/originals/${id}/convert`);
      if (data?.ok) {
        toast.success("Converted — opening reader…");
        navigate(`/read/${id}`, { replace: true });
      } else {
        toast.error(`Conversion failed: ${data?.error || "unknown error"}`);
        setConverting(false);
      }
    } catch (e) {
      toast.error("Conversion failed — try again");
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF6EE]">
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center text-[#6B705C]">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading…
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FAF6EE]">
        <Navbar />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center text-[#6B705C]">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-[#B43F26]" />
          {error}
          <div className="mt-4">
            <Link to="/library/originals" className="text-[var(--primary)] underline">Back to Originals</Link>
          </div>
        </main>
      </div>
    );
  }

  const formatLabel = (ext || "").toUpperCase();

  return (
    <div className="min-h-screen bg-[#FAF6EE]" data-testid="read-original-page">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 lg:px-6 py-6">
        {/* Header strip — back link, title, format badge, action buttons */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C]"
            data-testid="read-original-back"
          >
            <ArrowLeft className="w-4 h-4" /> back
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-xl md:text-2xl text-[#2C2C2C] truncate" data-testid="read-original-title">
              {book?.title || "Untitled"}
            </h1>
            <p className="text-xs text-[#6B705C] truncate">
              {book?.author || "Unknown"} ·{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#6B46C1]/10 text-[#6B46C1] font-mono text-[10px] font-semibold">
                {formatLabel}
              </span>
            </p>
          </div>
          <a
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-original-tab"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[var(--primary)] hover:text-[var(--primary)]"
            title="Open the raw file in a new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
          </a>
          {(isPdf || isScrollViewer) && (
            <>
              <button
                onClick={addBookmark}
                data-testid="readoriginal-bookmark-add"
                title={isPdf
                  ? "Bookmark a page (Cmd/Ctrl+B) — we'll ask which page number to save"
                  : "Bookmark this scroll position (Cmd/Ctrl+B)"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <BookmarkPlus className="w-3.5 h-3.5" /> Bookmark
              </button>
              <button
                onClick={() => setShowBookmarkPanel((v) => !v)}
                data-testid="readoriginal-bookmark-toggle"
                title="Show / hide saved bookmarks"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <Bookmark className="w-3.5 h-3.5" /> {bookmarks.length}
              </button>
            </>
          )}
          {CALIBRE_FORMATS.has(ext) || DOCX_LIKE.has(ext) ? (
            <button
              onClick={convertAndRead}
              disabled={converting}
              data-testid="convert-and-read"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-60"
              title="Run Calibre conversion and open in the EPUB reader"
            >
              {converting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {converting ? "Converting…" : "Convert to EPUB"}
            </button>
          ) : null}
        </div>

        {/* Format-aware viewer */}
        <div
          className="bg-white border border-[#E5DDC5] rounded-xl overflow-hidden shadow-sm"
          data-testid="read-original-viewer"
        >
          {NATIVE_IFRAME.has(ext) && (
            <iframe
              ref={iframeRef}
              key={pdfReloadKey}
              src={isPdf && pdfTargetPage ? `${originalUrl}#page=${pdfTargetPage}` : originalUrl}
              title={book?.title || "Book"}
              data-testid="viewer-iframe"
              sandbox={ext === "pdf" ? undefined : "allow-same-origin"}
              className="w-full"
              style={{ height: "calc(100vh - 200px)", minHeight: "600px", border: "none" }}
            />
          )}

          {PLAINTEXT.has(ext) && (
            renderError
              ? <ErrorBlock msg={renderError} />
              : text === null
                ? <LoadingBlock label="Loading text…" />
                : (
                  <div
                    ref={scrollRef}
                    data-testid="viewer-text-scroll"
                    className="overflow-y-auto"
                    style={{ height: "calc(100vh - 200px)", minHeight: "600px" }}
                  >
                    <pre
                      data-testid="viewer-text"
                      className="whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-[#2C2C2C] p-6 md:p-10 max-w-3xl mx-auto"
                    >
                      {text}
                    </pre>
                  </div>
                )
          )}

          {DOCX_LIKE.has(ext) && (
            renderError
              ? <FallbackConvertBlock book={book} ext={ext} onConvert={convertAndRead} converting={converting} msg={renderError} />
              : docxHtml === null
                ? <LoadingBlock label="Rendering DOCX…" />
                : (
                  <div
                    ref={scrollRef}
                    data-testid="viewer-docx-scroll"
                    className="overflow-y-auto"
                    style={{ height: "calc(100vh - 200px)", minHeight: "600px" }}
                  >
                    <div
                      data-testid="viewer-docx"
                      className="prose prose-sm max-w-3xl mx-auto p-6 md:p-10 text-[#2C2C2C]"
                      // mammoth output is safe HTML built from a known schema — no
                      // user-supplied scripts can survive its converter pipeline.
                      dangerouslySetInnerHTML={{ __html: docxHtml }}
                    />
                  </div>
                )
          )}

          {CALIBRE_FORMATS.has(ext) && (
            <FallbackConvertBlock
              book={book}
              ext={ext}
              onConvert={convertAndRead}
              converting={converting}
            />
          )}

          {ext && !NATIVE_IFRAME.has(ext) && !PLAINTEXT.has(ext) && !DOCX_LIKE.has(ext) && !CALIBRE_FORMATS.has(ext) && (
            <FallbackConvertBlock book={book} ext={ext} onConvert={convertAndRead} converting={converting} />
          )}
        </div>

        {/* Bookmark panel — only renders for formats that support bookmarks.
            Mirrors the EPUB Reader's panel: jump, inline-edit note on blur,
            remove on hover.  Notes share the same 280-char cap as the backend. */}
        {(isPdf || isScrollViewer) && showBookmarkPanel && (
          <aside
            data-testid="readoriginal-bookmark-panel"
            className="mt-4 bg-white border border-[#E5DDC5] rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#2C2C2C]">
                Bookmarks
                {bookmarks.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-[#6B705C]">({bookmarks.length})</span>
                )}
              </h3>
              <button
                onClick={() => setShowBookmarkPanel(false)}
                className="text-xs text-[#6B705C] hover:text-[#2C2C2C]"
                data-testid="readoriginal-bookmark-panel-close"
              >
                Hide
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="text-sm text-[#6B705C] italic">
                No bookmarks yet. {isPdf
                  ? "Click Bookmark, type the page you want to save, and we'll remember it."
                  : "Scroll to a spot you want to keep and click Bookmark."}
              </p>
            ) : (
              <ul className="space-y-2">
                {bookmarks.map((bm) => (
                  <li
                    key={bm.bookmark_id}
                    data-testid={`readoriginal-bookmark-row-${bm.bookmark_id}`}
                    className="border border-[#E8E6E1] rounded-lg p-3 hover:bg-[#FAF6EE] group"
                  >
                    <button
                      type="button"
                      onClick={() => jumpToBookmark(bm)}
                      className="w-full text-left"
                      data-testid={`readoriginal-bookmark-jump-${bm.bookmark_id}`}
                    >
                      <p className="text-sm font-medium text-[#2C2C2C]">
                        {bm.chapter_label || bm.cfi}
                      </p>
                      <p className="text-xs text-[#9B9B8C] mt-1">
                        {new Date(bm.created_at).toLocaleDateString()}
                      </p>
                    </button>
                    <textarea
                      defaultValue={bm.note || ""}
                      maxLength={280}
                      placeholder="Add a note…"
                      rows={2}
                      data-testid={`readoriginal-bookmark-note-${bm.bookmark_id}`}
                      onBlur={(e) => {
                        const next = (e.target.value || "").trim();
                        if (next !== (bm.note || "")) updateBookmarkNote(bm.bookmark_id, next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 w-full text-sm text-[#2C2C2C] bg-[#FAF6EE] border border-[#E8E6E1] rounded p-2 focus:outline-none focus:border-[var(--primary)] resize-y italic"
                    />
                    <button
                      type="button"
                      onClick={() => removeBookmark(bm.bookmark_id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-red-600 hover:underline mt-2"
                      data-testid={`readoriginal-bookmark-remove-${bm.bookmark_id}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

const LoadingBlock = ({ label }) => (
  <div className="py-20 text-center text-[#6B705C]">
    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
    {label}
  </div>
);

const ErrorBlock = ({ msg }) => (
  <div className="py-12 text-center text-[#B43F26]" data-testid="viewer-error">
    <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
    {msg}
  </div>
);

// Centred card explaining that the browser can't render this format
// natively, with a single button that runs Calibre and opens the resulting
// EPUB in the regular reader.  Reused by both the explicit Calibre-format
// branch and the catch-all fallback.
const FallbackConvertBlock = ({ book, ext, onConvert, converting, msg }) => (
  <div className="py-16 px-6 text-center max-w-xl mx-auto" data-testid="viewer-fallback">
    <FileText className="w-10 h-10 mx-auto text-[#6B46C1] mb-3" />
    <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">
      No native viewer for .{(ext || "?").toUpperCase()}
    </h2>
    <p className="text-sm text-[#6B705C] mb-6">
      {msg
        ? msg
        : `Browsers can't render this format directly. We can run Calibre once to convert "${book?.title || "this book"}" into an EPUB — then it opens instantly in the normal reader, where text size, fonts, bookmarks, and progress tracking all work.`}
    </p>
    <button
      onClick={onConvert}
      disabled={converting}
      data-testid="viewer-fallback-convert"
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-60"
    >
      {converting
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <RefreshCw className="w-4 h-4" />}
      {converting ? "Converting…" : "Convert to EPUB and read"}
    </button>
    <p className="text-[11px] text-[#6B705C] mt-4">
      Or use the <strong>Open in new tab</strong> button at the top to download the raw file and read it in another app.
    </p>
  </div>
);
