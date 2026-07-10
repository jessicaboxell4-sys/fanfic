import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, CheckCircle2, Clock } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Shared shelf renderer for the Complete and Ongoing pages — both look
// identical apart from the endpoint, icon, copy, and accent color. Keeps
// the layout, search, category-filter chips, and book list logic in one
// place so a tweak (e.g. adding cover thumbnails) lands on both shelves.
function StatusShelf({ target, icon: Icon, accent, title, blurb, emptyMsg, dataTestPrefix }) {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/library/${target}`);
        if (!cancelled) {
          setBooks(data?.books || []);
          setByCategory(data?.by_category || {});
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [target]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return books.filter((b) => {
      if (categoryFilter && (b.category || "Uncategorized") !== categoryFilter) return false;
      if (!needle) return true;
      return (
        (b.title || "").toLowerCase().includes(needle) ||
        (b.author || "").toLowerCase().includes(needle) ||
        (b.fandom || "").toLowerCase().includes(needle)
      );
    });
  }, [books, search, categoryFilter]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid={`${dataTestPrefix}-back`}
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className={`w-12 h-12 rounded-2xl ${accent.bg} ${accent.text} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">{title}</h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-2xl">{blurb}</p>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid={`${dataTestPrefix}-summary`}>
          <div className="flex-shrink-0">
            <div className="font-serif text-3xl text-[#2C2C2C]" data-testid={`${dataTestPrefix}-count`}>{books.length}</div>
            <div className="text-xs text-[#5B5F4D] uppercase tracking-wide">book{books.length === 1 ? "" : "s"}</div>
          </div>
          {Object.keys(byCategory).length > 0 && (
            <div className="flex flex-wrap gap-2 items-center" data-testid={`${dataTestPrefix}-categories`}>
              <button
                onClick={() => setCategoryFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  categoryFilter === ""
                    ? `${accent.solid} text-white border-transparent`
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
                      ? `${accent.solid} text-white border-transparent`
                      : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {cat} · {n}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5B5F4D]" />
          <input
            type="search"
            data-testid={`${dataTestPrefix}-search`}
            placeholder="Search title, author, or fandom…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none ${accent.focus}`}
          />
        </div>

        {loading ? (
          <p className="text-[#5B5F4D] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#5B5F4D]">
            {books.length === 0 ? (
              <>
                <Icon className={`w-10 h-10 mx-auto mb-3 ${accent.text}`} />
                <p className="font-medium text-[#2C2C2C] mb-1">{emptyMsg}</p>
              </>
            ) : (
              <p className="text-sm italic">No books match your filter.</p>
            )}
          </div>
        ) : (
          <ul className="space-y-2" data-testid={`${dataTestPrefix}-list`}>
            {filtered.map((b) => (
              <li
                key={b.book_id}
                className="shelf-card p-3"
                data-testid={`${dataTestPrefix}-book-${b.book_id}`}
              >
                <button
                  onClick={() => navigate(`/book/${b.book_id}`)}
                  className="text-left w-full hover:bg-[#F5F3EC] rounded-md p-1 -m-1 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-medium text-[#2C2C2C]">{b.title || "Untitled"}</span>
                    {b.is_manual_status && (
                      <span
                        data-testid={`${dataTestPrefix}-manual-${b.book_id}`}
                        className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide bg-[#E5DDC5]/60 text-[#5B5F4D]"
                        title="Status set manually by you (overrides auto-detection)"
                      >
                        manually set
                      </span>
                    )}
                    {b.series_name && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C]">
                        {b.series_name}{b.series_index ? ` #${b.series_index}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#5B5F4D]">
                    {b.author || "Unknown"}
                    {b.fandom ? <> · {b.fandom}</> : null}
                    {b.category ? <> · {b.category}</> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

const COMPLETE_ACCENT = {
  bg: "bg-[#6B46C1]/10",
  text: "text-[#6B46C1]",
  solid: "bg-[#6B46C1]",
  focus: "focus:border-[#6B46C1]/60",
};
const ONGOING_ACCENT = {
  bg: "bg-[#D08C60]/15",
  text: "text-[#9E5A2E]",
  solid: "bg-[#9E5A2E]",
  focus: "focus:border-[#9E5A2E]/60",
};

export function CompleteShelf() {
  return (
    <StatusShelf
      target="complete"
      icon={CheckCircle2}
      accent={COMPLETE_ACCENT}
      title="Finished"
      blurb="Books with a definitive ending — fanfics tagged Complete, published novels, and anything without an explicit ongoing/WIP signal."
      emptyMsg="No finished books yet."
      dataTestPrefix="complete"
    />
  );
}

export function OngoingShelf() {
  return (
    <StatusShelf
      target="ongoing"
      icon={Clock}
      accent={ONGOING_ACCENT}
      title="Ongoing"
      blurb="Works in progress — fanfics tagged WIP, In-Progress, Hiatus, Abandoned, or showing a 'Chapter X of Y' with X < Y."
      emptyMsg="No ongoing books — your library is all finished."
      dataTestPrefix="ongoing"
    />
  );
}
