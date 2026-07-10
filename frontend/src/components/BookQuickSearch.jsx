import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2 } from "lucide-react";
import { api } from "../lib/api";

/**
 * Quick-jump book search for the navbar.  Spotlight-style typeahead:
 * type ≥2 chars → dropdown of up to 8 matching titles (and authors) → click
 * to jump straight to /book/:id.
 *
 * Uses the lightweight `/api/books/quick-search` endpoint (title+author
 * substring), NOT the heavier `/library/search/fulltext` body search.
 * Keyboard support: Esc closes, Enter follows the first result.
 */
export default function BookQuickSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  // Debounced search (200ms — books search is cheap enough to be eager).
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/books/quick-search", { params: { q: trimmed, limit: 8 } });
        setResults(data?.books || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  // Click-outside to close.
  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (b) => {
    navigate(`/book/${b.book_id}`);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e) => {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      pick(results[0]);
    }
  };

  return (
    <div ref={wrapRef} className="relative w-full" data-testid="book-quick-search">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B5F4D] pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search books…"
        data-testid="book-quick-search-input"
        className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#6B46C1]/20"
      />
      {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5B5F4D] animate-spin" />}

      {open && results.length > 0 && (
        <ul
          data-testid="book-quick-search-results"
          className="absolute left-0 right-0 top-[36px] z-30 bg-white border border-[#E5DDC5] rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {results.map((b) => (
            <li key={b.book_id}>
              <button
                type="button"
                data-testid={`book-quick-result-${b.book_id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(b)}
                className="w-full text-left px-3 py-2 hover:bg-[#FBFAF6] border-b border-[#E8E6E1] last:border-b-0"
              >
                <p className="text-sm text-[#2C2C2C] truncate">{b.title || "Untitled"}</p>
                {b.author && <p className="text-[10px] text-[#5B5F4D] truncate">by {b.author}</p>}
                {b.category && (
                  <p className="text-[9px] text-[#6B46C1] font-bold uppercase tracking-wider mt-0.5">{b.category}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && !loading && results.length === 0 && (
        <div
          data-testid="book-quick-search-empty"
          className="absolute left-0 right-0 top-[36px] z-30 bg-white border border-[#E5DDC5] rounded-lg shadow-lg px-3 py-2 text-xs text-[#5B5F4D]"
        >
          No books match &quot;{q.trim()}&quot;.
        </div>
      )}
    </div>
  );
}
