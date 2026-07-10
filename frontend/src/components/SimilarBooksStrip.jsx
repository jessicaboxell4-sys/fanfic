import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Sparkles, BookOpen } from "lucide-react";

/**
 * "Finished on device. Want a similar one?"
 *
 * Appears at the bottom of /book/:id when the user has effectively
 * finished the seed book — either they marked it finished
 * (`progress_fraction >= 0.95`) or they hand-flagged it via the
 * mark-finished action.  Pulls up to 6 books from their *own*
 * library that share fandom or author with the seed, prioritising
 * unfinished ones so they have somewhere to go next.
 *
 * Hidden entirely when the user hasn't finished, when the seed
 * has no fandom/author signal, or when no matches exist.
 *
 * Backend: GET /api/recommendations/similar/{book_id}
 */
export default function SimilarBooksStrip({ book }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const finished = (book?.progress_fraction ?? 0) >= 0.95 || !!book?.finished_at;

  useEffect(() => {
    if (!finished || !book?.book_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/recommendations/similar/${book.book_id}`, {
          params: { limit: 6 },
        });
        if (!cancelled) setRecs(data?.recommendations || []);
      } catch {
        // Silent — strip just doesn't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [book?.book_id, finished]);

  if (!finished) return null;
  if (loading) return null;
  if (!recs.length) return null;

  return (
    <section
      className="mt-10 pt-8 border-t border-[#E5DDC5]"
      data-testid="similar-books-strip"
    >
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E07A5F] flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            Finished on this device
          </p>
          <h3 className="font-serif text-2xl text-[#2C2C2C] mt-1">
            Want a similar one?
          </h3>
          <p className="text-xs text-[#5B5F4D] mt-0.5">
            From your library — same fandom or author, mostly ones you haven&apos;t finished yet.
          </p>
        </div>
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
        data-testid="similar-books-grid"
      >
        {recs.map((r) => (
          <Link
            key={r.book_id}
            to={`/book/${r.book_id}`}
            data-testid={`similar-book-${r.book_id}`}
            className="group block rounded-lg overflow-hidden border border-[#E5DDC5] bg-white hover:border-[#E07A5F] hover:shadow-md transition-all"
          >
            <div className="aspect-[2/3] bg-[#FBFAF6] flex items-center justify-center overflow-hidden">
              {r.has_cover ? (
                <img
                  src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${r.book_id}/cover`}
                  alt={`Cover of ${r.title}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <BookOpen className="w-8 h-8 text-[#C8C2B0]" aria-hidden="true" />
              )}
            </div>
            <div className="p-2.5">
              <p className="text-xs font-medium text-[#2C2C2C] line-clamp-2 leading-tight">
                {r.title}
              </p>
              {r.author && (
                <p className="text-[10px] text-[#5B5F4D] mt-1 line-clamp-1">{r.author}</p>
              )}
              <p
                className="text-[9px] text-[#E07A5F] mt-1 uppercase tracking-wider line-clamp-1"
                data-testid={`similar-book-reason-${r.book_id}`}
              >
                {r.match_reason}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
