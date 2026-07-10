import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { toast } from "sonner";
import { ArrowLeft, Tag as TagIcon, Filter, Loader2, Trash2 } from "lucide-react";

export default function TagShelfPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const tag = decodeURIComponent(name || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Use the smart-shelves preview endpoint with a tags_any rule.
      // It returns up to 20 books in `sample`; for a full list we'd need
      // /api/smart-shelves/{id}/books, but a one-off preview is enough for
      // the typical tag use-case and avoids creating a shelf doc per visit.
      // We do TWO preview calls if needed — first to get count, then we
      // know there's more than 20 and we can offer "Save as smart shelf".
      const { data } = await api.post("/smart-shelves/preview", {
        query: { combinator: "AND", rules: [{ field: "tags_any", values: [tag] }] },
      });
      setBooks(data.sample || []);
      // Stash the full count so we can show "20 of 47 shown" in the UI
      if (typeof data.count === "number") {
        setBooks((bs) => {
          bs._count = data.count;
          return bs;
        });
      }
    } catch (e) {
      toast.error("Couldn't load this tag");
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  const saveAsSmartShelf = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/smart-shelves", {
        name: `#${tag}`,
        query: { combinator: "AND", rules: [{ field: "tags_any", values: [tag] }] },
        pinned: false,
      });
      toast.success(`Saved "${data.name}" — find it under Smart shelves`);
      navigate(`/library/smart/${data.shelf_id}`);
    } catch (e) {
      toast.error("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const purgeTag = async () => {
    if (!window.confirm(`Remove the "${tag}" tag from every book? This can't be undone (the books themselves are unaffected).`)) return;
    setPurging(true);
    try {
      await api.delete(`/tags/${encodeURIComponent(tag)}`);
      toast.success("Tag removed");
      navigate("/library/tags");
    } catch (e) {
      toast.error("Couldn't remove");
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library/tags")}
          data-testid="back-to-tags"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All tags
        </button>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
              <TagIcon className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
                Tag shelf
              </p>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C]" data-testid="tag-shelf-title">
                #{tag}
              </h1>
              <p className="text-[#5B5F4D] mt-3">
                {loading
                  ? "Loading…"
                  : books.length === 0
                    ? "No books carry this tag."
                    : `${books._count ?? books.length} book${(books._count ?? books.length) === 1 ? "" : "s"} tagged`}
                {!loading && books._count && books._count > books.length && (
                  <span className="text-[#5B5F4D] text-xs ml-2">
                    (showing first {books.length})
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={saveAsSmartShelf}
              disabled={saving || books.length === 0}
              data-testid="save-as-smart-shelf"
              className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
              Save as smart shelf
            </button>
            <button
              onClick={purgeTag}
              disabled={purging || books.length === 0}
              data-testid="purge-tag-btn"
              className="text-sm text-[#D9534F] hover:text-[#a83a36] inline-flex items-center gap-1.5 font-semibold disabled:opacity-60 px-3 py-2"
              title={`Remove "${tag}" tag from all books`}
            >
              {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remove tag everywhere
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-[#5B5F4D] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="shelf-card p-12 text-center">
            <TagIcon className="w-10 h-10 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No books with this tag</h2>
            <p className="text-[#5B5F4D] mb-6">
              Open any book and add <strong>{tag}</strong> to its tags, then come back.
            </p>
            <Link to="/library/tags" className="btn-primary text-sm inline-block">
              All tags
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="tag-shelf-books">
            {books.map((b) => (
              <BookCard key={b.book_id} book={b} onChanged={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
