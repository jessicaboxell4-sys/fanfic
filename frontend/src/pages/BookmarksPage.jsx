/**
 * Cross-library bookmarks — every bookmark across every book, newest first.
 * Pulls from GET /api/bookmarks which hydrates each row with the book metadata.
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { ArrowLeft, Bookmark, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function BookmarksPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/bookmarks");
      setItems(data.bookmarks || []);
    } catch (e) {
      toast.error("Couldn't load bookmarks");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (bm) => {
    try {
      await api.delete(`/books/${bm.book_id}/bookmarks/${bm.bookmark_id}`);
      setItems((prev) => prev.filter((x) => x.bookmark_id !== bm.bookmark_id));
    } catch { toast.error("Couldn't remove that bookmark"); }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-10" data-testid="bookmarks-page">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#3A5A40] mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <Bookmark className="w-6 h-6 text-[#3A5A40]" />
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">All bookmarks</h1>
            <p className="text-sm text-[#6B705C]">
              {loading ? "Loading…" : `${items.length} saved spot${items.length === 1 ? "" : "s"} across your library.`}
            </p>
          </div>
        </div>

        {loading && <Loader2 className="w-5 h-5 animate-spin text-[#6B705C]" />}
        {!loading && items.length === 0 && (
          <div className="text-center py-16 text-[#6B705C]" data-testid="bookmarks-empty">
            No bookmarks yet. Open any book in the reader and tap <strong>Bookmark</strong> to save your spot.
          </div>
        )}

        <ul className="space-y-3" data-testid="bookmarks-list">
          {items.map((bm) => (
            <li
              key={bm.bookmark_id}
              className="bg-white border border-[#E8E2D4] rounded-xl p-4 flex items-start gap-4 group"
              data-testid={`bookmarks-row-${bm.bookmark_id}`}
            >
              <button
                type="button"
                onClick={() => navigate(`/read/${bm.book_id}`)}
                className="flex-1 text-left"
              >
                <p className="font-medium text-[#2C2C2C]">
                  {bm.book?.title || "Unknown book"}
                  {bm.book?.author && <span className="text-[#6B705C] text-sm font-normal"> — {bm.book.author}</span>}
                </p>
                {bm.chapter_label && (
                  <p className="text-sm text-[#3A5A40] mt-1">{bm.chapter_label}</p>
                )}
                {bm.note && (
                  <p className="text-sm italic text-[#2C2C2C] mt-1">&ldquo;{bm.note}&rdquo;</p>
                )}
                <p className="text-xs text-[#9B9B8C] mt-1">
                  {bm.percent != null && `${Math.round(bm.percent * 100)}% through · `}
                  {new Date(bm.created_at).toLocaleDateString()}
                </p>
              </button>
              <button
                type="button"
                onClick={() => remove(bm)}
                className="opacity-0 group-hover:opacity-100 text-xs text-red-600 hover:underline"
                data-testid={`bookmarks-remove-${bm.bookmark_id}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
