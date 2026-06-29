import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Trash2, BookmarkX } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { toast } from "sonner";

/**
 * "Stuck books" smart shelf — books opened >30d ago and <30% read.
 * Linked from the Sunday re-engagement notification + a hidden URL
 * for now (we'll surface it from the AllBooks shelf chooser next).
 *
 * Each row offers two actions: open the Reader to pick it back up, or
 * mark Did-Not-Finish so the rec engine stops surfacing more by that
 * author.
 */
export default function StuckBooksPage() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/books/stuck", { params: { limit: 50 } });
      setBooks(data?.books || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load stuck books");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "Stuck books — Shelfsort";
    load();
  }, []);

  const markDnf = async (book) => {
    try {
      await api.post(`/books/${book.book_id}/dnf`, { is_dnf: true });
      toast.success(`Marked DNF: ${book.title}`);
      setBooks((bs) => bs.filter((b) => b.book_id !== book.book_id));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't mark DNF");
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main
        className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in"
        data-testid="stuck-books-page"
      >
        <Link
          to="/library"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-6 hover:text-[#553397]"
        >
          <ArrowLeft className="w-3 h-3" /> Library
        </Link>

        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            Smart shelf
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight tracking-tight">
            Stuck books.
          </h1>
          <p className="text-lg text-[#5B5F4D] mt-3 max-w-2xl">
            You started these more than 30 days ago and read less than 30%.
            Pick one back up or mark it DNF so it stops haunting your shelf.
          </p>
        </header>

        {loading ? (
          <p className="text-[#5B5F4D]">Loading…</p>
        ) : books.length === 0 ? (
          <p className="text-[#5B5F4D] italic" data-testid="no-stuck-books">
            Clean slate — no books are stuck. Nice pace.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="stuck-books-list">
            {books.map((b) => {
              const pct = Math.round((b.progress_fraction || 0) * 100);
              return (
                <li
                  key={b.book_id}
                  className="flex items-center gap-4 p-4 bg-white border border-[#E8E6E1] rounded-lg shadow-sm"
                  data-testid={`stuck-row-${b.book_id}`}
                >
                  <div className="w-12 h-16 bg-[#F5F2EA] rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {b.has_cover ? (
                      <img
                        src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : <BookOpen className="w-5 h-5 text-[#5B5F4D]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-lg text-[#2C2C2C] truncate" title={b.title}>
                      {b.title}
                    </p>
                    <p className="text-sm text-[#5B5F4D] truncate">
                      {b.author || "Unknown author"} · {pct}% in
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      to={`/read/${b.book_id}`}
                      className="tap-min inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
                      data-testid={`stuck-resume-${b.book_id}`}
                    >
                      <BookOpen className="w-3 h-3" /> Resume
                    </Link>
                    <button
                      type="button"
                      onClick={() => markDnf(b)}
                      className="tap-min inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-[#5B5F4D] border border-[#E8E6E1] hover:border-[#B91C1C] hover:text-[#B91C1C]"
                      data-testid={`stuck-dnf-${b.book_id}`}
                    >
                      <BookmarkX className="w-3 h-3" /> DNF
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
