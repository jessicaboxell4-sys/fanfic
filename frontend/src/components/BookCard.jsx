import React from "react";
import { Book, Check } from "lucide-react";
import { Link } from "react-router-dom";

const categoryBadgeClass = (category) => {
  if (category === "Fanfiction") return "badge-fandom";
  if (category === "Original Fiction") return "badge-original";
  if (category === "Non-fiction") return "badge-nonfic";
  return "badge-unclassified";
};

export default function BookCard({ book, selectMode, selected, onToggleSelect }) {
  const coverUrl = book.has_cover
    ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`
    : null;

  const label = book.category === "Fanfiction" && book.fandom
    ? book.fandom
    : book.category;

  const cardInner = (
    <>
      <div className="aspect-[2/3] bg-[#F5F3EC] relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="book-spine w-full h-full">
            <div>
              <Book className="w-8 h-8 mx-auto mb-2 opacity-80" />
              <p className="text-base leading-tight line-clamp-3">{book.title}</p>
            </div>
          </div>
        )}
        {selectMode && (
          <div
            className={`absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              selected
                ? "bg-[#E07A5F] text-white shadow-lg"
                : "bg-white/90 border border-[#E8E6E1] text-transparent"
            }`}
            aria-hidden
          >
            <Check className="w-4 h-4" />
          </div>
        )}
        {selectMode && selected && (
          <div className="absolute inset-0 ring-4 ring-[#E07A5F] rounded-t-xl pointer-events-none" />
        )}
      </div>
      <div className="p-3">
        <span className={categoryBadgeClass(book.category)} data-testid={`book-badge-${book.book_id}`}>
          {label}
        </span>
        <h3 className="font-serif text-lg mt-2 text-[#2C2C2C] line-clamp-2 leading-tight">
          {book.title}
        </h3>
        <p className="text-xs text-[#6B705C] mt-1 line-clamp-1">{book.author}</p>
      </div>
    </>
  );

  if (selectMode) {
    return (
      <button
        type="button"
        data-testid={`book-card-${book.book_id}`}
        onClick={() => onToggleSelect && onToggleSelect(book.book_id)}
        className={`shelf-card overflow-hidden block text-left w-full ${
          selected ? "border-[#E07A5F]" : ""
        }`}
      >
        {cardInner}
      </button>
    );
  }

  return (
    <Link
      to={`/book/${book.book_id}`}
      data-testid={`book-card-${book.book_id}`}
      className="shelf-card overflow-hidden block group"
    >
      {cardInner}
    </Link>
  );
}
