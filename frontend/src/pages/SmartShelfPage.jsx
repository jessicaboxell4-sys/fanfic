import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { toast } from "sonner";
import { ArrowLeft, Filter, Edit3, BookOpen } from "lucide-react";
import { SmartShelfBuilder } from "./SmartShelves";

const STATUS_LABELS = {
  reading: "currently reading",
  finished: "finished",
  unread: "not started",
};

function ruleSummary(r) {
  if (["tags_all", "tags_any", "tags_none"].includes(r.field)) {
    const verb = r.field === "tags_all" ? "all of" : r.field === "tags_any" ? "any of" : "none of";
    return `tags ${verb}: ${(r.values || []).join(", ")}`;
  }
  if (r.field === "status") return `status: ${STATUS_LABELS[r.value] || r.value}`;
  if (r.field === "words") {
    const parts = [];
    if (r.min) parts.push(`>${r.min}`);
    if (r.max) parts.push(`<${r.max}`);
    return `words ${parts.join(" & ") || "any"}`;
  }
  return `${r.field}: ${r.value}`;
}

export default function SmartShelfPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/smart-shelves/${id}/books`);
      setData(data);
    } catch (e) {
      toast.error("Couldn't load this shelf");
      setData({ shelf: null, books: [], count: 0 });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <p className="text-[#6B705C] py-20 text-center">Loading shelf…</p>
      </div>
    );
  }

  if (!data?.shelf) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 py-20 text-center">
          <h1 className="font-serif text-3xl text-[#2C2C2C] mb-4">Shelf not found</h1>
          <p className="text-[#6B705C] mb-6">It may have been deleted.</p>
          <Link to="/library/smart-shelves" className="btn-primary text-sm">All smart shelves</Link>
        </main>
      </div>
    );
  }

  const { shelf, books, count } = data;
  const rules = shelf.query?.rules || [];

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library/smart-shelves")}
          data-testid="back-to-smart-shelves"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All smart shelves
        </button>

        <div className="mb-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2">
              Smart shelf
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]" data-testid="smart-shelf-page-title">
              {shelf.name}
            </h1>
            <p className="text-[#6B705C] mt-3">{count} book{count === 1 ? "" : "s"}</p>
            {rules.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="text-xs text-[#6B705C] uppercase tracking-wider font-semibold mr-1">
                  {shelf.query?.combinator || "AND"}:
                </span>
                {rules.map((r, i) => (
                  <span key={i} className="text-xs bg-[#FDF3E1] text-[#B87A00] px-2 py-0.5 rounded-full">
                    {ruleSummary(r)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            data-testid="edit-smart-shelf-btn"
            className="btn-secondary text-sm inline-flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" /> Edit rules
          </button>
        </div>

        {books.length === 0 ? (
          <div className="shelf-card p-12 text-center">
            <Filter className="w-10 h-10 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No books match these rules</h2>
            <p className="text-[#6B705C] mb-6">Edit the shelf to widen the query, or add tags to your books.</p>
            <button onClick={() => setEditing(true)} className="btn-primary text-sm">
              Edit rules
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="smart-shelf-books">
            {books.map((b) => (
              <BookCard key={b.book_id} book={b} onChanged={load} />
            ))}
          </div>
        )}
      </main>

      {editing && (
        <SmartShelfBuilder
          initial={shelf}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}
