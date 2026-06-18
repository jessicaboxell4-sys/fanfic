import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Loader2, Check, X as XIcon, Image as ImageIcon, RotateCw,
} from "lucide-react";

/**
 * Bulk cover generation — list every book that doesn't have a cover,
 * let the user kick off generation in small batches, and apply each
 * accepted cover with one click.
 *
 * Why batches, not "generate all"?
 *   Each nano-banana call costs the Universal Key.  Letting the user
 *   click "Generate next N" makes the cost visible and stoppable.
 *   Default batch size is 5 — a sensible smoke-test for the prompt
 *   quality before committing to dozens.
 *
 * State machine per book:
 *   idle      → user clicks Generate → status="loading"
 *   loading   → preview lands → status="preview", imageDataUrl+previewId
 *   preview   → Keep → status="applying" → status="applied"
 *               → Skip → status="idle" (can retry)
 *   error     → toast + status="idle"
 */
export default function PolishCoversPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [batchSize, setBatchSize] = useState(5);
  const [running, setRunning] = useState(false);
  // Selected style applies to every per-book generation kicked off from
  // this page (single or batch).  Empty = Shelfsort house default.
  const [styleId, setStyleId] = useState("");
  const [styles, setStyles] = useState([]);
  // Map<book_id, { status, previewId?, imageDataUrl? }>
  const [perBook, setPerBook] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [bRes, sRes] = await Promise.all([
          api.get("/books/cover-less", { params: { limit: 100 } }),
          api.get("/cover-styles"),
        ]);
        if (cancelled) return;
        setBooks(bRes.data.books || []);
        setTotal(bRes.data.total || 0);
        setStyles(sRes.data?.styles || []);
      } catch {
        if (!cancelled) toast.error("Couldn't load cover-less books");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setStatus = (book_id, patch) => {
    setPerBook((prev) => ({ ...prev, [book_id]: { ...prev[book_id], ...patch } }));
  };

  // Generate a single cover.  Used by both the per-book Generate button
  // and the batch runner.  Resolves once the preview is captured.
  const generateOne = async (book) => {
    setStatus(book.book_id, { status: "loading" });
    try {
      const { data } = await api.post(`/books/${book.book_id}/preview-cover`, {
        style_id: styleId || null,
      });
      setStatus(book.book_id, {
        status: "preview",
        previewId: data.preview_id,
        imageDataUrl: `data:${data.mime_type};base64,${data.image_base64}`,
      });
    } catch (e) {
      setStatus(book.book_id, { status: "error" });
      toast.error(`${book.title}: ${e?.response?.data?.detail || "generation failed"}`);
    }
  };

  const applyOne = async (book) => {
    const entry = perBook[book.book_id];
    if (!entry?.previewId) return;
    setStatus(book.book_id, { status: "applying" });
    try {
      await api.post(`/books/${book.book_id}/apply-cover`, { preview_id: entry.previewId });
      setStatus(book.book_id, { status: "applied" });
    } catch (e) {
      setStatus(book.book_id, { status: "preview" });
      toast.error(`${book.title}: ${e?.response?.data?.detail || "couldn't save"}`);
    }
  };

  const skipOne = (book) => {
    setStatus(book.book_id, { status: "idle", previewId: null, imageDataUrl: null });
  };

  // Kick off the next ``batchSize`` books that don't have a preview yet.
  // Run them in parallel — nano-banana handles concurrent calls fine
  // and the user-perceived time drops linearly.
  const runBatch = async () => {
    if (running) return;
    setRunning(true);
    try {
      const queue = books
        .filter((b) => {
          const s = perBook[b.book_id]?.status;
          return !s || s === "idle" || s === "error";
        })
        .slice(0, batchSize);
      if (queue.length === 0) {
        toast.message("Nothing left to generate in this list.");
        return;
      }
      await Promise.all(queue.map((b) => generateOne(b)));
    } finally {
      setRunning(false);
    }
  };

  // Apply every "preview" entry in one click.  Sequential — apply is
  // cheap (no LLM call) so we don't need parallelism, and sequential
  // gives a cleaner progress feel.
  const applyAll = async () => {
    const queue = books.filter((b) => perBook[b.book_id]?.status === "preview");
    for (const b of queue) {
      await applyOne(b);
    }
    toast.success(`Saved ${queue.length} ${queue.length === 1 ? "cover" : "covers"}`);
  };

  const pendingPreviews = books.filter((b) => perBook[b.book_id]?.status === "preview").length;
  const appliedCount = books.filter((b) => perBook[b.book_id]?.status === "applied").length;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8" data-testid="polish-covers-page">
        <Link to="/library" className="inline-flex items-center gap-1.5 text-sm text-[#6B705C] hover:text-[var(--primary)] mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to library
        </Link>

        <div className="flex items-start gap-3 mb-6 flex-wrap sm:flex-nowrap">
          <div className="w-12 h-12 rounded-2xl bg-[#EDE7FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Polish my covers</h1>
            <p className="text-sm text-[#6B705C] mt-1">
              Generate AI covers for every book that ships without one.  Each call goes through Gemini
              Nano Banana with the Shelfsort house style — sage palette, no faces, serif typography.
              Preview → keep → apply.  Originals are never touched.
            </p>
          </div>
        </div>

        {/* Status strip */}
        <div className="bg-white rounded-xl border border-[#E5DDC5] p-4 mb-6 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            <Stat label="Without cover" value={total} testid="polish-covers-total" />
            <Stat label="Previewed" value={pendingPreviews} testid="polish-covers-previewed" />
            <Stat label="Applied this session" value={appliedCount} testid="polish-covers-applied" />
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-testid="polish-covers-actions">
            <label htmlFor="cover-style-pick" className="text-xs text-[#6B705C]">Style</label>
            <select
              id="cover-style-pick"
              value={styleId}
              onChange={(e) => setStyleId(e.target.value)}
              data-testid="polish-covers-style"
              className="text-sm px-2 py-1.5 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1] max-w-[160px]"
            >
              <option value="">House</option>
              {styles.filter(s => s.id !== "house").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kind === "custom" ? "★ " : ""}{s.name}
                </option>
              ))}
            </select>
            <label htmlFor="batch-size" className="text-xs text-[#6B705C]">Batch</label>
            <select
              id="batch-size"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              data-testid="polish-covers-batch-size"
              className="text-sm px-2 py-1.5 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]"
            >
              {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} at a time</option>)}
            </select>
            <button
              type="button"
              onClick={runBatch}
              disabled={running || loading || books.length === 0}
              data-testid="polish-covers-run-batch"
              className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate next {batchSize}
            </button>
            <button
              type="button"
              onClick={applyAll}
              disabled={pendingPreviews === 0}
              data-testid="polish-covers-apply-all"
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Check className="w-3.5 h-3.5" />
              Apply all kept ({pendingPreviews})
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[#6B705C] italic inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your library…
          </p>
        ) : books.length === 0 ? (
          <div
            data-testid="polish-covers-empty"
            className="bg-white border border-[#E5DDC5] rounded-2xl p-8 text-center"
          >
            <ImageIcon className="w-10 h-10 mx-auto mb-3 text-[#3D8B79]" />
            <h2 className="font-serif text-2xl text-[#2C2C2C]">Every book has a cover</h2>
            <p className="text-sm text-[#6B705C] mt-2">
              Nothing to polish here.  Upload more books or go enjoy what you&apos;ve got.
            </p>
            <button
              type="button"
              onClick={() => navigate("/library")}
              className="btn-primary text-sm mt-4 inline-flex items-center gap-1.5"
            >
              Back to library
            </button>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
            data-testid="polish-covers-grid"
          >
            {books.map((b) => {
              const s = perBook[b.book_id] || {};
              return (
                <CoverTile
                  key={b.book_id}
                  book={b}
                  state={s}
                  onGenerate={() => generateOne(b)}
                  onApply={() => applyOne(b)}
                  onSkip={() => skipOne(b)}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const Stat = ({ label, value, testid }) => (
  <div data-testid={testid}>
    <div className="text-2xl font-serif text-[#2C2C2C] leading-none">{value}</div>
    <div className="text-[10px] uppercase tracking-wider text-[#6B705C] mt-1">{label}</div>
  </div>
);

function CoverTile({ book, state, onGenerate, onApply, onSkip }) {
  const status = state.status || "idle";
  return (
    <div
      data-testid={`polish-covers-tile-${book.book_id}`}
      className="bg-white border border-[#E5DDC5] rounded-xl overflow-hidden flex flex-col"
    >
      <div className="aspect-[2/3] w-full bg-[#F5F3EC] flex items-center justify-center relative">
        {status === "loading" ? (
          <Loader2 className="w-6 h-6 text-[#6B46C1] animate-spin" />
        ) : state.imageDataUrl ? (
          <img
            src={state.imageDataUrl}
            alt={`Cover for ${book.title}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon className="w-8 h-8 text-[#9B9B8C]" />
        )}
        {status === "applied" && (
          <div className="absolute inset-0 bg-[#3D8B79]/70 flex items-center justify-center">
            <Check className="w-10 h-10 text-white" data-testid={`polish-covers-applied-${book.book_id}`} />
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-xs font-medium text-[#2C2C2C] line-clamp-2 leading-tight" title={book.title}>
          {book.title}
        </p>
        <p className="text-[10px] text-[#6B705C] truncate" title={book.author}>{book.author || "—"}</p>
        {/* Per-tile actions */}
        <div className="flex items-center gap-1 mt-1.5">
          {status === "idle" || status === "error" ? (
            <button
              type="button"
              onClick={onGenerate}
              data-testid={`polish-covers-gen-${book.book_id}`}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#EDE7FB] text-[#6B46C1] hover:bg-[#DCD0F7]"
            >
              <Sparkles className="w-3 h-3" /> Generate
            </button>
          ) : status === "preview" ? (
            <>
              <button
                type="button"
                onClick={onApply}
                data-testid={`polish-covers-keep-${book.book_id}`}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#3D8B79] text-white hover:bg-[#2E6B5B]"
              >
                <Check className="w-3 h-3" /> Keep
              </button>
              <button
                type="button"
                onClick={onGenerate}
                title="Try again"
                data-testid={`polish-covers-retry-${book.book_id}`}
                className="inline-flex items-center justify-center px-2 py-1 rounded text-[11px] bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#6B46C1]"
              >
                <RotateCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onSkip}
                title="Skip"
                data-testid={`polish-covers-skip-${book.book_id}`}
                className="inline-flex items-center justify-center px-2 py-1 rounded text-[11px] bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#C04A3F]"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </>
          ) : status === "applying" ? (
            <span className="text-[11px] text-[#6B705C] italic inline-flex items-center gap-1 px-2 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          ) : status === "applied" ? (
            <span className="text-[11px] text-[#3D8B79] font-medium inline-flex items-center gap-1 px-2 py-1">
              <Check className="w-3 h-3" /> Saved
            </span>
          ) : (
            <span className="text-[11px] text-[#6B705C] italic px-2 py-1">…</span>
          )}
        </div>
      </div>
    </div>
  );
}
