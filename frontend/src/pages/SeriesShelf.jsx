import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { ArrowLeft, Library, BookOpen } from "lucide-react";

export default function SeriesShelf() {
  const { name } = useParams();
  const navigate = useNavigate();
  const seriesName = decodeURIComponent(name || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/series/${encodeURIComponent(seriesName)}`);
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [seriesName]);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2 flex items-center gap-2">
            <Library className="w-3.5 h-3.5" /> Series shelf
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05]" data-testid="series-title">
            {seriesName}
          </h1>
          <p className="text-[#6B705C] mt-3">
            {loading
              ? "Loading shelf…"
              : `${books.length} book${books.length === 1 ? "" : "s"} in order`}
          </p>
        </div>

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No books in this series yet</h2>
            <Link to="/library" className="btn-primary text-sm inline-block mt-4">Go upload</Link>
          </div>
        ) : (
          <ol className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="series-grid">
            {books.map((b) => (
              <li key={b.book_id} className="relative">
                {typeof b.series_index === "number" && (
                  <span
                    className="absolute -top-2 -left-2 z-10 bg-[#2C2C2C] text-white text-xs font-bold rounded-full w-8 h-8 flex items-center justify-center shadow-md"
                    data-testid={`series-index-${b.book_id}`}
                  >
                    #{Number.isInteger(b.series_index) ? b.series_index : b.series_index.toFixed(1)}
                  </span>
                )}
                <BookCard book={b} onChanged={load} />
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
