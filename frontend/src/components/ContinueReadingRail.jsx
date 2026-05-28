import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Book } from "lucide-react";

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function ContinueReadingRail({ books }) {
  if (!books || books.length === 0) return null;

  return (
    <section className="mb-10" data-testid="continue-reading-rail">
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-1">
            Continue reading
          </p>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Pick up where you left off</h2>
        </div>
        {books.length > 0 && (
          <Link
            to={`/read/${books[0].book_id}`}
            className="btn-primary text-sm flex items-center gap-2"
            data-testid="resume-last-btn"
          >
            <BookOpen className="w-4 h-4" />
            Resume "{books[0].title.length > 28 ? books[0].title.slice(0, 28) + "…" : books[0].title}"
          </Link>
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
        {books.map((b) => {
          const coverUrl = b.has_cover
            ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`
            : null;
          return (
            <Link
              key={b.book_id}
              to={`/read/${b.book_id}`}
              data-testid={`continue-card-${b.book_id}`}
              className="shelf-card flex-shrink-0 w-40 sm:w-48 overflow-hidden block snap-start"
            >
              <div className="aspect-[2/3] bg-[#F5F3EC] relative">
                {coverUrl ? (
                  <img src={coverUrl} alt={b.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="book-spine w-full h-full">
                    <div>
                      <Book className="w-7 h-7 mx-auto mb-2 opacity-80" />
                      <p className="text-sm leading-tight line-clamp-3">{b.title}</p>
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pt-6 pb-2">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-white/85 font-semibold">
                      {relTime(b.last_opened_at)}
                    </span>
                    {typeof b.progress_percent === "number" && b.progress_percent > 0 && (
                      <span className="text-[11px] font-semibold text-white tabular-nums">
                        {Math.round(b.progress_percent * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                    <div
                      className="h-full bg-[#E07A5F] rounded-full transition-all"
                      style={{ width: `${Math.max(2, Math.round((b.progress_percent || 0) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="p-3">
                <h3 className="font-serif text-base text-[#2C2C2C] line-clamp-2 leading-tight">
                  {b.title}
                </h3>
                <p className="text-xs text-[#6B705C] mt-1 line-clamp-1">{b.author}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
