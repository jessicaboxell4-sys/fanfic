/**
 * Unread library — every book the user hasn't opened yet. Reads from
 * GET /api/library/unread (the W2 endpoint shipped with the P2 batch-1).
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { ArrowLeft, BookOpen, Loader2 } from "lucide-react";

export default function UnreadLibraryPage() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/library/unread")
      .then(({ data }) => setBooks(data.books || []))
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-10" data-testid="unread-library-page">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#6B46C1] mb-4"
          data-testid="unread-library-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-6 h-6 text-[#6B46C1]" />
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Books I haven&apos;t read</h1>
            <p className="text-sm text-[#6B705C]">
              Every book in your library you haven&apos;t opened yet.
              {!loading && ` ${books.length} total.`}
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[#6B705C]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg" data-testid="unread-library-error">
            {error}
          </div>
        )}
        {!loading && !error && books.length === 0 && (
          <div className="text-center py-16 text-[#6B705C]" data-testid="unread-library-empty">
            🎉 You&apos;ve opened every book in your library. Time to upload more!
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" data-testid="unread-library-grid">
          {books.map((b) => (
            <BookCard
              key={b.book_id}
              book={b}
              selectMode={false}
              selected={false}
              onToggleSelect={() => {}}
              onChanged={() => {}}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
