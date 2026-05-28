import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api, API } from "../lib/api";
import { ArrowLeft, ExternalLink, RefreshCw, Edit3, Download, Loader2, Book } from "lucide-react";
import { toast } from "sonner";

function suggestSearchUrl(sourceUrl, title, author) {
  const q = encodeURIComponent(`${title || ""} ${author || ""}`.trim());
  if (!q) return null;
  const host = (sourceUrl || "").toLowerCase();
  if (host.includes("archiveofourown.org")) {
    return { label: "Search AO3", url: `https://archiveofourown.org/works/search?work_search%5Bquery%5D=${q}` };
  }
  if (host.includes("fanfiction.net")) {
    return { label: "Search FFnet", url: `https://www.fanfiction.net/search/?keywords=${q}&type=story` };
  }
  if (host.includes("fictionpress.com")) {
    return { label: "Search FictionPress", url: `https://www.fictionpress.com/search/?keywords=${q}&type=story` };
  }
  if (host.includes("royalroad.com")) {
    return { label: "Search Royal Road", url: `https://www.royalroad.com/fictions/search?title=${q}` };
  }
  if (host.includes("spacebattles.com") || host.includes("sufficientvelocity.com") || host.includes("questionablequesting.com")) {
    const m = host.match(/^https?:\/\/([^/]+)/);
    const site = m ? m[1] : "";
    return { label: "Search Google", url: `https://www.google.com/search?q=site%3A${site}+${q}` };
  }
  return { label: "Search Google", url: `https://www.google.com/search?q=${q}` };
}

export default function CantFindOnline() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editUrl, setEditUrl] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [autoTriedIds, setAutoTriedIds] = useState(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/books", { params: { smart: "unavailable" } });
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const retry = async (bid, opts = {}) => {
    const { silent = false } = opts;
    // If we've already auto-tried once for this book, ask for confirmation
    if (!silent && autoTriedIds.has(bid)) {
      if (!window.confirm("FicHub already tried this once. Try again?")) return;
    }
    setBusyId(bid);
    const t = toast.loading("Pulling latest from FicHub…");
    try {
      const { data } = await api.post(`/books/${bid}/refresh`, {}, { timeout: 300000 });
      toast.success(`Updated to "${data.title}"`, { id: t });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Still can't find it", { id: t });
    } finally {
      setBusyId(null);
      // Mark that this book has had at least one retry this session
      setAutoTriedIds((prev) => {
        const next = new Set(prev);
        next.add(bid);
        return next;
      });
    }
  };

  const saveUrl = async (bid) => {
    try {
      await api.patch(`/books/${bid}/source-url`, { source_url: editUrl.trim() });
      toast.success("Source URL updated — trying FicHub…");
      setEditingId(null);
      setEditUrl("");
      // Auto-fire one retry attempt. Subsequent manual retries will ask first.
      await retry(bid, { silent: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B705C] mb-2">
              🚫 Can't find online
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05]" data-testid="page-title">
              Lost & found
            </h1>
            <p className="text-[#6B705C] mt-3 max-w-xl">
              FicHub couldn't find these online. Try a same-site search to see if the work moved,
              then paste the new URL to bring it back into your refresh queue.
            </p>
          </div>
          {books.length > 0 && (
            <button
              data-testid="download-list-btn"
              onClick={() => window.open(`${API}/books/export/unavailable`, "_blank")}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download list (.txt)
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <Book className="w-12 h-12 text-[#3A5A40] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">Nothing's lost</h2>
            <p className="text-[#6B705C]">Every refreshable book in your library is reachable on FicHub.</p>
          </div>
        ) : (
          <ul className="space-y-4" data-testid="lost-list">
            {books.map((b) => {
              const cover = b.has_cover
                ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`
                : null;
              const search = suggestSearchUrl(b.source_url, b.title, b.author);
              const isEditing = editingId === b.book_id;
              return (
                <li key={b.book_id} className="shelf-card p-4 flex gap-4" data-testid={`lost-row-${b.book_id}`}>
                  <Link to={`/book/${b.book_id}`} className="flex-shrink-0 w-20 sm:w-24">
                    <div className="aspect-[2/3] rounded-lg overflow-hidden bg-[#F5F3EC]">
                      {cover ? (
                        <img src={cover} alt={b.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="book-spine w-full h-full">
                          <Book className="w-6 h-6 opacity-80" />
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/book/${b.book_id}`} className="font-serif text-xl text-[#2C2C2C] hover:text-[#E07A5F] line-clamp-2 leading-tight">
                      {b.title}
                    </Link>
                    <p className="text-sm text-[#6B705C] mt-0.5">{b.author}</p>
                    {b.source_url && (
                      <p className="text-xs text-[#E07A5F] mt-2 break-all line-clamp-1">
                        {b.source_url}
                      </p>
                    )}
                    {b.fichub_last_error && (
                      <p className="text-xs text-[#D9534F] mt-1">
                        FicHub said: {b.fichub_last_error}
                      </p>
                    )}

                    {isEditing ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveUrl(b.book_id); }}
                        className="mt-3 flex flex-col sm:flex-row gap-2"
                      >
                        <input
                          autoFocus
                          data-testid={`fix-input-${b.book_id}`}
                          type="url"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="https://archiveofourown.org/works/…"
                          className="flex-1 bg-white border border-[#E8E6E1] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                        />
                        <button type="submit" data-testid={`fix-save-${b.book_id}`} className="btn-primary text-sm py-1.5">Save</button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditUrl(""); }}
                          className="text-[#6B705C] hover:text-[#2C2C2C] text-sm px-2"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {search && (
                          <a
                            data-testid={`search-${b.book_id}`}
                            href={search.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {search.label}
                          </a>
                        )}
                        <button
                          data-testid={`fix-${b.book_id}`}
                          onClick={() => { setEditingId(b.book_id); setEditUrl(b.source_url || ""); }}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Fix URL
                        </button>
                        <button
                          data-testid={`retry-${b.book_id}`}
                          onClick={() => retry(b.book_id)}
                          disabled={busyId === b.book_id}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 disabled:opacity-50"
                        >
                          {busyId === b.book_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Retry FicHub
                        </button>
                      </div>
                    )}
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
