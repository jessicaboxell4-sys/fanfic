import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { X as XIcon, Search, BookOpen, Check, Heart, Loader2 } from "lucide-react";
import { api } from "../lib/api";

// Modal that lets you browse a friend's shared library and request books
// you don't already own. Closes on X click or backdrop click.
export default function FriendLibraryModal({ friend, onClose }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [requestingId, setRequestingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/friends/${friend.other_user_id}/library`, {
          params: { q: q.trim() || undefined, limit: 100 },
        });
        if (!cancelled) setBooks(data?.books || []);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || "Couldn't load library");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [friend.other_user_id, q]);

  const request = async (book) => {
    setRequestingId(book.book_id);
    try {
      await api.post(`/friends/${friend.other_user_id}/book-request`, { book_id: book.book_id });
      toast.success(`Asked ${friend.name || friend.email} for "${book.title}"`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send request");
    } finally { setRequestingId(null); }
  };

  return (
    <div
      data-testid="friend-library-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-[#E8E6E1] flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-[#5B5F4D] font-semibold">Shared library</p>
            <p className="font-serif text-lg text-[#2C2C2C] truncate">{friend.name || friend.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="friend-library-close-btn"
            className="p-1 text-[#5B5F4D] hover:text-[#2C2C2C]"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </header>
        <div className="p-3 border-b border-[#E8E6E1] flex items-center gap-2">
          <Search className="w-4 h-4 text-[#5B5F4D]" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter title or author…"
            data-testid="friend-library-search"
            className="flex-1 text-sm px-2 py-1 rounded border border-[#E5DDC5] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="p-5 text-xs text-[#5B5F4D]"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</p>
          ) : error ? (
            <p className="p-5 text-sm text-[#B43F26]" data-testid="friend-library-error">{error}</p>
          ) : books.length === 0 ? (
            <p className="p-5 text-sm text-[#5B5F4D] italic">No books match.</p>
          ) : (
            <ul className="divide-y divide-[#E8E6E1]">
              {books.map((b) => (
                <li
                  key={b.book_id}
                  data-testid={`friend-library-row-${b.book_id}`}
                  className="px-4 py-2 flex items-center gap-3"
                >
                  <BookOpen className="w-4 h-4 text-[#5B5F4D] flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#2C2C2C] truncate">{b.title}</p>
                    <p className="text-xs text-[#5B5F4D] truncate">
                      {b.author || "Unknown author"}
                      {b.fandom && <span className="ml-2 text-[10px] bg-[#FBFAF6] px-1.5 py-0.5 rounded">{b.fandom}</span>}
                    </p>
                  </div>
                  {b.i_have_it ? (
                    <span
                      data-testid={`friend-library-have-${b.book_id}`}
                      className="inline-flex items-center gap-1 text-[10px] text-[#6B46C1] font-semibold"
                      title="You also have this book"
                    >
                      <Check className="w-3 h-3" /> You have
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => request(b)}
                      disabled={requestingId === b.book_id}
                      data-testid={`friend-library-want-${b.book_id}`}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-[var(--primary)] text-white font-semibold disabled:opacity-50"
                    >
                      {requestingId === b.book_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
                      Want this
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="px-4 py-2 border-t border-[#E8E6E1] text-[10px] text-[#5B5F4D]">
          Clicking <strong>Want this</strong> sends a polite DM to {friend.name || friend.email}. They decide whether to share the file or source URL.
        </footer>
      </div>
    </div>
  );
}
