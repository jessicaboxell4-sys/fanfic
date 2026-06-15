import React, { useState } from "react";
import { Book, Check, CheckCircle2, Circle, ListPlus, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { pulseGoalsCheck } from "../lib/goalHitWatcher";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const categoryBadgeClass = (category) => {
  if (category === "Fanfiction") return "badge-fandom";
  if (category === "Original Fiction") return "badge-original";
  if (category === "Non-fiction") return "badge-nonfic";
  return "badge-unclassified";
};

// Tiny single-letter chip showing how a book got its current
// category/fandom. Admin-only — surfaces classifier provenance without
// cluttering the card for regular users.
//
//   M  metadata        — keyword classifier on EPUB metadata at upload
//   R  metadata_rescan — rescued from "Other" via admin rescan
//   A  ai              — Claude classified (heuristic fell through)
//   X  manual          — user picked the fandom by hand
const CLASSIFIER_CHIPS = {
  metadata:        { letter: "M", title: "Classified by keyword metadata match",  cls: "bg-[#EEE9FB] text-[#6B46C1]" },
  metadata_rescan: { letter: "R", title: "Rescued from 'Other' by admin rescan",  cls: "bg-[#FDF3E1] text-[#8C5C00]" },
  ai:              { letter: "A", title: "Classified by AI (Claude)",             cls: "bg-[#F0E8F5] text-[#6B4A8C]" },
  manual:          { letter: "X", title: "Classified manually",                   cls: "bg-[#E8EEF5] text-[#3A5A8C]" },
};

function ClassifierChip({ classifier }) {
  const cfg = CLASSIFIER_CHIPS[classifier];
  if (!cfg) return null;
  return (
    <span
      data-testid={`book-classifier-chip-${classifier}`}
      title={cfg.title}
      className={`inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded ${cfg.cls}`}
    >
      {cfg.letter}
    </span>
  );
}

export default function BookCard({ book, selectMode, selected, onToggleSelect, onChanged }) {
  const { user } = useAuth();
  const [marking, setMarking] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [inQueue, setInQueue] = useState(!!book.in_queue);
  const coverUrl = book.has_cover
    ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`
    : null;

  const label = book.category === "Fanfiction" && book.fandom
    ? book.fandom
    : book.category;

  const isRead = typeof book.progress_fraction === "number" && book.progress_fraction >= 0.99;

  const toggleRead = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (marking) return;
    setMarking(true);
    try {
      await api.post(`/books/${book.book_id}/mark`, { read: !isRead });
      toast.success(!isRead ? `Marked "${book.title}" as read` : `Marked "${book.title}" as unread`);
      onChanged && onChanged();
      // If this mark just flipped a Reading-goal, fire global confetti.
      // Only check when moving to "read" (unread never triggers a hit).
      if (!isRead) pulseGoalsCheck();
    } catch (err) {
      toast.error("Couldn't update");
    } finally {
      setMarking(false);
    }
  };

  const toggleQueue = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (queueing) return;
    setQueueing(true);
    try {
      if (inQueue) {
        await api.post("/library/queue/remove", { book_id: book.book_id });
        setInQueue(false);
        toast.success(`Removed "${book.title}" from queue`);
      } else {
        await api.post("/library/queue/add", { book_id: book.book_id });
        setInQueue(true);
        toast.success(`Added "${book.title}" to queue`);
      }
      onChanged && onChanged();
    } catch (err) {
      toast.error("Couldn't update queue");
    } finally {
      setQueueing(false);
    }
  };

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

        {/* Read indicator: persistent badge on finished books */}
        {!selectMode && isRead && (
          <div
            data-testid={`read-badge-${book.book_id}`}
            className="absolute top-2 right-2 bg-[#6B46C1] text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full flex items-center gap-1 shadow"
          >
            <CheckCircle2 className="w-3 h-3" /> Read
          </div>
        )}

        {/* Hover-only quick action: add/remove from reading queue */}
        {!selectMode && (
          <button
            type="button"
            data-testid={`toggle-queue-${book.book_id}`}
            onClick={toggleQueue}
            disabled={queueing}
            title={inQueue ? "Remove from reading queue" : "Add to reading queue"}
            className={`absolute bottom-2 right-12 w-9 h-9 rounded-full flex items-center justify-center transition-all
              ${inQueue
                ? "bg-white text-[#6B46C1] border border-[#6B46C1]/30 opacity-100"
                : "bg-white text-[#6B705C] border border-[#E8E6E1] opacity-0 group-hover:opacity-100 hover:text-[#6B46C1]"
              }
              ${queueing ? "animate-pulse" : ""} shadow-md hover:shadow-lg`}
          >
            {inQueue ? <ListChecks className="w-4 h-4" /> : <ListPlus className="w-4 h-4" />}
          </button>
        )}

        {/* Hover-only quick action: mark read / unread */}
        {!selectMode && (
          <button
            type="button"
            data-testid={`toggle-read-${book.book_id}`}
            onClick={toggleRead}
            disabled={marking}
            title={isRead ? "Mark as unread" : "Mark as read"}
            className={`absolute bottom-2 right-2 w-9 h-9 rounded-full flex items-center justify-center transition-all
              ${isRead
                ? "bg-white text-[#6B46C1] border border-[#6B46C1]/30 opacity-0 group-hover:opacity-100"
                : "bg-white text-[#6B705C] border border-[#E8E6E1] opacity-0 group-hover:opacity-100 hover:text-[#6B46C1]"
              }
              ${marking ? "animate-pulse" : ""} shadow-md hover:shadow-lg`}
          >
            {isRead ? <Circle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </button>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          <span className={categoryBadgeClass(book.category)} data-testid={`book-badge-${book.book_id}`}>
            {label}
          </span>
          {user?.is_admin && <ClassifierChip classifier={book.classifier} />}
        </div>
        <h3 className="font-serif text-lg mt-2 text-[#2C2C2C] line-clamp-2 leading-tight">
          {book.title}
        </h3>
        <p className="text-xs text-[#6B705C] mt-1 line-clamp-1">{book.author}</p>
        {(book.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 max-h-7 overflow-hidden" data-testid={`book-tags-${book.book_id}`}>
            {(book.tags || []).slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] bg-[#FDF3E1] text-[#B87A00] px-1.5 py-0.5 rounded-full font-semibold"
              >
                {t}
              </span>
            ))}
            {(book.tags || []).length > 3 && (
              <span className="text-[10px] text-[#6B705C]">+{book.tags.length - 3}</span>
            )}
          </div>
        )}
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
