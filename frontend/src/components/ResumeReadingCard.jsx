import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ArrowRight } from "lucide-react";
import { api } from "../lib/api";

/**
 * "Continue where you left off" hero card on the dashboard.
 *
 * Hits the existing `/api/books/recent` endpoint and shows the
 * single most-recently-opened in-progress book with a Resume CTA
 * that opens the Reader at the cloud cursor.  Auto-hides for users
 * who haven't opened anything yet.
 */
export default function ResumeReadingCard() {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/books/recent", { params: { limit: 5 } });
        // Pick the first not-yet-finished book.  recent returns
        // `last_opened_at`-sorted; we filter for in-progress here.
        const active = (data?.books || []).find((b) => {
          const p = b.progress_fraction || 0;
          return p > 0.01 && p < 0.99;
        });
        setBook(active || null);
      } catch { /* non-blocking */ }
      setLoading(false);
    })();
  }, []);

  if (loading || !book) return null;
  const pct = Math.round((book.progress_fraction || 0) * 100);

  return (
    <Link
      to={`/read/${book.book_id}`}
      data-testid="resume-reading-card"
      className="block bg-[#FDF3E1] border border-[#B87A00]/30 rounded-2xl p-5 mb-7 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-20 bg-white rounded shadow-sm overflow-hidden flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          {book.has_cover ? (
            <img
              src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <BookOpen className="w-6 h-6 text-[#B87A00]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B87A00] mb-0.5">
            Continue reading
          </p>
          <p
            className="font-serif text-xl text-[#2C2C2C] truncate"
            data-testid="resume-card-title"
          >
            {book.title || "Untitled"}
          </p>
          <p className="text-sm text-[#5B5F4D] truncate">
            {book.author || "Unknown author"} · {pct}% in
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-sm font-semibold text-[#B87A00]">
          Resume <ArrowRight className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-3 h-1 rounded-full bg-white/60 overflow-hidden">
        <div
          className="h-full bg-[#B87A00]"
          style={{ width: `${pct}%` }}
          aria-label={`${pct} percent complete`}
        />
      </div>
    </Link>
  );
}
