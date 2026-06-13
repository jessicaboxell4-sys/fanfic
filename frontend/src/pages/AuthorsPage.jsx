import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search, User, CheckCircle2, Clock } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// AUTHORS DIRECTORY — `/library/authors` lists every author with a book
// count. Clicking an author opens AuthorShelf for that author.
export function AuthorsDirectory() {
  const navigate = useNavigate();
  const [authors, setAuthors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/authors");
        if (!cancelled) setAuthors(data?.authors || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return authors;
    return authors.filter((a) => (a.author || "").toLowerCase().includes(needle));
  }, [authors, search]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="authors-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>
        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Authors</h1>
            <p className="text-sm text-[#6B705C] mt-1 max-w-2xl">
              Every author in your library, sorted by how many books they&apos;ve written for you. Click any name to open their shelf.
            </p>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex items-center gap-4" data-testid="authors-summary">
          <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="authors-count">
            {authors.length}
          </div>
          <div className="text-xs text-[#6B705C] uppercase tracking-wide">
            distinct author{authors.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B705C]" />
          <input
            type="search"
            data-testid="authors-search"
            placeholder="Search authors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            {authors.length === 0
              ? "No authors yet — upload some books to see them here."
              : <p className="text-sm italic">No authors match your filter.</p>}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="authors-list">
            {filtered.map((a) => (
              <li key={a.author}>
                <button
                  onClick={() => navigate(`/library/author/${encodeURIComponent(a.author)}`)}
                  data-testid={`authors-row-${a.author}`}
                  className="shelf-card p-3 w-full text-left flex items-center justify-between hover:bg-[#F5F3EC] transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-[#2C2C2C]">
                    <User className="w-4 h-4 text-[#6B46C1] flex-shrink-0" aria-hidden="true" />
                    {a.author}
                  </span>
                  <span className="text-xs px-2 py-1 rounded-full bg-[#6B46C1]/10 text-[#6B46C1]">
                    {a.count} book{a.count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}


// PER-AUTHOR SHELF — `/library/by-author/:name` lists every book by
// a specific author with category-filter chips and status indicators.
export function AuthorShelf() {
  const { name } = useParams();
  const navigate = useNavigate();
  const author = decodeURIComponent(name || "");
  const [books, setBooks] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/library/by-author?author=${encodeURIComponent(author)}`);
        if (!cancelled) {
          setBooks(data?.books || []);
          setByCategory(data?.by_category || {});
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [author]);

  const filtered = useMemo(() => {
    if (!categoryFilter) return books;
    return books.filter((b) => (b.category || "Uncategorized") === categoryFilter);
  }, [books, categoryFilter]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library/authors")}
          data-testid="author-shelf-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All authors
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#6B705C] uppercase tracking-wide">Author</p>
            <h1 className="font-serif text-3xl text-[#2C2C2C]" data-testid="author-shelf-name">{author}</h1>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="author-shelf-summary">
          <div className="flex-shrink-0">
            <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="author-shelf-count">{books.length}</div>
            <div className="text-xs text-[#6B705C] uppercase tracking-wide">book{books.length === 1 ? "" : "s"}</div>
          </div>
          {Object.keys(byCategory).length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => setCategoryFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  categoryFilter === ""
                    ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                    : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"
                }`}
              >
                All · {books.length}
              </button>
              {Object.entries(byCategory).map(([cat, n]) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    categoryFilter === cat
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {cat} · {n}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C] italic text-sm">No books match this filter.</div>
        ) : (
          <ul className="space-y-2" data-testid="author-shelf-list">
            {filtered.map((b) => {
              const isOngoing = b.effective_status === "ongoing";
              return (
                <li
                  key={b.book_id}
                  className="shelf-card p-3"
                  data-testid={`author-shelf-book-${b.book_id}`}
                >
                  <button
                    onClick={() => navigate(`/book/${b.book_id}`)}
                    className="text-left w-full hover:bg-[#F5F3EC] rounded-md p-1 -m-1 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-medium text-[#2C2C2C]">{b.title || "Untitled"}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                          isOngoing
                            ? "bg-[#F8E8D8] text-[#9E5A2E]"
                            : "bg-[#EEE9FB] text-[#6B46C1]"
                        }`}
                        title={isOngoing ? "Ongoing" : "Finished"}
                      >
                        {isOngoing
                          ? <><Clock className="w-3 h-3" /> Ongoing</>
                          : <><CheckCircle2 className="w-3 h-3" /> Finished</>}
                      </span>
                      {b.series_name && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C]">
                          {b.series_name}{b.series_index ? ` #${b.series_index}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6B705C]">
                      {b.fandom ? <>{b.fandom}</> : null}
                      {b.fandom && b.category ? " · " : null}
                      {b.category}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
