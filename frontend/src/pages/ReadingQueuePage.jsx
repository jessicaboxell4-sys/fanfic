import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { toast } from "sonner";
import { ArrowLeft, ListChecks, ChevronUp, ChevronDown, X, BookOpen, GripVertical } from "lucide-react";

/**
 * Reading queue ("Up Next") page at /library/queue.
 *
 * Lists the user's queued books in order, with controls to reorder
 * (up/down arrows) and remove individual entries. Backed by the
 * pre-existing /api/library/queue{,/add,/remove,/reorder} endpoints
 * already exercised by LibraryActivityWidgets — we just give it a
 * dedicated browsing/edit surface so the queue can grow past the
 * 3-item peek shown in the dashboard widget.
 */
export default function ReadingQueuePage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  // Native HTML5 drag-and-drop state. We track the index of the row
  // currently being dragged + the row being hovered as a drop target so
  // we can show a clean drop indicator instead of relying on the browser's
  // default ghost rectangle alone.
  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/library/queue");
      // Hydrated queue entries already carry the in-queue flag; mark
      // them so BookCard's queue toggle starts in the "checked" state.
      setQueue((data.queue || []).map((b) => ({ ...b, in_queue: true })));
    } catch (e) {
      toast.error("Couldn't load your reading queue");
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const move = (index, delta) => {
    if (savingOrder) return;
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    setQueue(next);
    saveOrder(next);
  };

  const removeAt = async (bookId, title) => {
    setQueue((q) => q.filter((b) => b.book_id !== bookId));
    try {
      await api.post("/library/queue/remove", { book_id: bookId });
      toast.success(`Removed "${title}" from queue`);
    } catch (e) {
      toast.error("Couldn't remove from queue");
      load();
    }
  };

  // Persist a full ordering to the backend.  Used by both the up/down
  // arrow buttons and the drag-and-drop handler so they share the same
  // optimistic-update + rollback-on-error path.
  const saveOrder = useCallback(async (nextQueue) => {
    setSavingOrder(true);
    try {
      await api.post("/library/queue/reorder", {
        book_ids: nextQueue.map((b) => b.book_id),
      });
    } catch (e) {
      toast.error("Couldn't save the new order");
      load();
    } finally {
      setSavingOrder(false);
    }
  }, [load]);

  // Drag-and-drop ---------------------------------------------------------
  // We use the native HTML5 DnD API directly rather than pulling in a
  // library — the surface is small (one ordered list) and a 30-line
  // implementation is plenty.  The data shape on the DataTransfer object
  // is irrelevant since we keep the dragging index in a ref, but Firefox
  // requires setData to be called for the drag to actually start.
  const onDragStart = (idx) => (e) => {
    dragIndexRef.current = idx;
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); } catch {}
  };

  const onDragOver = (idx) => (e) => {
    // Must preventDefault so the drop event fires.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== idx) setDragOverIndex(idx);
  };

  const onDragLeave = () => setDragOverIndex(null);

  const onDrop = (targetIdx) => (e) => {
    e.preventDefault();
    const fromIdx = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIdx === null || fromIdx === targetIdx) return;
    setQueue((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      // When dragging downward the target index shifts by one after the
      // splice; account for that so the dropped row lands exactly where
      // the user aimed.
      const insertAt = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
      next.splice(insertAt, 0, moved);
      saveOrder(next);
      return next;
    });
  };

  const onDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <Link
          to="/library"
          data-testid="back-to-dashboard"
          className="inline-flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to your library
        </Link>

        <header className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 inline-flex items-center gap-2">
            <ListChecks className="w-4 h-4" /> Up next
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight">
            {queue.length === 0
              ? "Your reading queue is empty."
              : `${queue.length} book${queue.length === 1 ? "" : "s"} queued up.`}
          </h1>
          {queue.length > 0 && (
            <p className="text-[#5B5F4D] mt-3">
              Drag the <GripVertical className="inline w-4 h-4 -mt-0.5" /> handle to reorder, use the arrows for one-step nudges, the × to remove, or tap a card to start reading.
            </p>
          )}
        </header>

        {loading ? (
          <p className="text-[#5B5F4D] py-10 text-center">Loading…</p>
        ) : queue.length === 0 ? (
          <div className="shelf-card p-10 text-center" data-testid="queue-empty-state">
            <BookOpen className="w-12 h-12 text-[#6B46C1] mx-auto mb-4 opacity-60" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">Nothing queued yet</h2>
            <p className="text-[#5B5F4D] mb-6 max-w-md mx-auto">
              Hover any book card and click the <ListChecks className="inline w-4 h-4 -mt-0.5" /> icon to drop it on your stack.
              Books on your queue surface on the dashboard&apos;s &ldquo;Up next&rdquo; row.
            </p>
            <Link to="/library/all" className="btn-primary text-sm inline-flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Browse all books
            </Link>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="queue-list">
            {queue.map((book, i) => (
              <li
                key={book.book_id}
                data-testid={`queue-row-${book.book_id}`}
                draggable
                onDragStart={onDragStart(i)}
                onDragOver={onDragOver(i)}
                onDragLeave={onDragLeave}
                onDrop={onDrop(i)}
                onDragEnd={onDragEnd}
                className={`shelf-card p-3 flex items-center gap-3 transition-shadow ${
                  dragOverIndex === i ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[#FAF6EE]" : ""
                }`}
              >
                <span
                  data-testid={`queue-grip-${book.book_id}`}
                  title="Drag to reorder"
                  className="text-[#5B5F4D] cursor-grab active:cursor-grabbing select-none"
                  aria-hidden
                >
                  <GripVertical className="w-4 h-4" />
                </span>
                <span className="font-mono text-xs text-[#5B5F4D] w-6 text-right tabular-nums">{i + 1}.</span>
                <div className="w-12 flex-shrink-0">
                  <div className="aspect-[2/3] rounded overflow-hidden bg-[#EDE7FB]">
                    {book.has_cover && (
                      <img
                        src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`}
                        alt={book.title}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/library/book/${book.book_id}`)}
                  className="flex-1 min-w-0 text-left hover:opacity-80"
                >
                  <p className="font-serif text-lg text-[#2C2C2C] truncate">{book.title || "Untitled"}</p>
                  <p className="text-xs text-[#5B5F4D] truncate">
                    {book.author || "Unknown"}
                    {book.fandom && ` · ${book.fandom}`}
                  </p>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || savingOrder}
                    data-testid={`queue-up-${book.book_id}`}
                    title="Move up"
                    className="w-8 h-8 rounded flex items-center justify-center text-[#5B5F4D] hover:text-[#6B46C1] hover:bg-[#EDE7FB] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, +1)}
                    disabled={i === queue.length - 1 || savingOrder}
                    data-testid={`queue-down-${book.book_id}`}
                    title="Move down"
                    className="w-8 h-8 rounded flex items-center justify-center text-[#5B5F4D] hover:text-[#6B46C1] hover:bg-[#EDE7FB] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAt(book.book_id, book.title)}
                    data-testid={`queue-remove-${book.book_id}`}
                    title="Remove from queue"
                    className="w-8 h-8 rounded flex items-center justify-center text-[#5B5F4D] hover:text-red-600 hover:bg-red-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
