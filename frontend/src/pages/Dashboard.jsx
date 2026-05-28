import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import UploadZone from "../components/UploadZone";
import SelectionBar from "../components/SelectionBar";
import { Search, X, Plus, ArrowRight, CheckSquare } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_CATEGORIES = ["All", "Fanfiction", "Original Fiction", "Non-fiction", "Unclassified"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, categories: [], fandoms: [] });
  const [category, setCategory] = useState("All");
  const [fandom, setFandom] = useState(null);
  const [search, setSearch] = useState("");
  const [customCats, setCustomCats] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (category && category !== "All") params.category = category;
      if (fandom) params.fandom = fandom;
      if (search) params.q = search;
      const [b, s, c] = await Promise.all([
        api.get("/books", { params }),
        api.get("/books/stats"),
        api.get("/categories"),
      ]);
      setBooks(b.data.books || []);
      setStats(s.data);
      setCustomCats(c.data.custom || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [category, fandom, search]);

  useEffect(() => { load(); }, [load]);

  const showEmpty = !loading && stats.total === 0;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2">
            Your library
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]">
            {stats.total > 0 ? `${stats.total} book${stats.total > 1 ? "s" : ""} on the shelves.` : "Let's build your shelves."}
          </h1>
          {stats.fandoms.length > 0 && (
            <p className="text-[#6B705C] mt-2">
              {stats.fandoms.slice(0, 4).map(f => `${f.name} (${f.count})`).join(" · ")}
            </p>
          )}
        </div>

        <div className="mb-10">
          <UploadZone onUploaded={load} />
        </div>

        {showEmpty ? (
          <div className="text-center py-16">
            <img
              src="https://images.pexels.com/photos/35972719/pexels-photo-35972719.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
              alt="Stack of books"
              className="w-48 h-48 object-cover rounded-2xl mx-auto mb-6 opacity-80"
            />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No books just yet</h2>
            <p className="text-[#6B705C]">Drop a few EPUBs above to start sorting your library.</p>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="search-input"
                  type="text"
                  placeholder="Search by title or author…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
              <button
                data-testid="toggle-select-mode"
                onClick={() => {
                  setSelectMode((m) => {
                    if (m) setSelectedIds(new Set());
                    return !m;
                  });
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  selectMode
                    ? "bg-[#2C2C2C] text-white border-[#2C2C2C]"
                    : "bg-white border-[#E8E6E1] text-[#2C2C2C] hover:bg-[#F5F3EC]"
                }`}
              >
                <CheckSquare className="w-4 h-4" />
                {selectMode ? "Done" : "Select"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {DEFAULT_CATEGORIES.map(c => (
                <button
                  key={c}
                  data-testid={`filter-cat-${c.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => { setCategory(c); setFandom(null); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    category === c
                      ? "bg-[#E07A5F] text-white border-[#E07A5F]"
                      : "bg-white border-[#E8E6E1] text-[#2C2C2C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {c}
                </button>
              ))}
              {customCats.map(c => (
                <span
                  key={c}
                  className={`group flex items-center gap-1 pl-4 pr-1.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    category === c
                      ? "bg-[#3A5A40] text-white border-[#3A5A40]"
                      : "bg-[#E5EBE6] border-[#3A5A40]/20 text-[#3A5A40] hover:bg-[#3A5A40] hover:text-white"
                  }`}
                >
                  <button
                    data-testid={`filter-custom-${c.replace(/\s+/g, '-').toLowerCase()}`}
                    onClick={() => { setCategory(c); setFandom(null); }}
                    className="focus:outline-none"
                  >
                    {c}
                  </button>
                  <button
                    data-testid={`delete-custom-${c.replace(/\s+/g, '-').toLowerCase()}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete category "${c}"? Books in it will keep the label until you change them.`)) return;
                      try {
                        await api.delete(`/categories/${encodeURIComponent(c)}`);
                        toast.success(`Removed "${c}"`);
                        if (category === c) setCategory("All");
                        load();
                      } catch (err) {
                        toast.error("Couldn't remove category");
                      }
                    }}
                    className="w-5 h-5 rounded-full hover:bg-black/15 flex items-center justify-center"
                    title={`Remove ${c}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Add custom category */}
            <div className="flex flex-wrap items-center gap-2 mb-8">
              {addingCat ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = newCat.trim();
                    if (!name) return;
                    try {
                      await api.post("/categories", { name });
                      toast.success(`Added shelf "${name}"`);
                      setNewCat("");
                      setAddingCat(false);
                      load();
                    } catch (err) {
                      toast.error("Couldn't add category");
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    autoFocus
                    data-testid="new-category-input"
                    type="text"
                    placeholder="Shelf name (e.g., To Read)"
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    maxLength={40}
                    className="bg-white border border-[#E8E6E1] rounded-full px-4 py-1.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  />
                  <button
                    type="submit"
                    data-testid="confirm-add-category"
                    className="btn-primary text-sm py-1.5"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingCat(false); setNewCat(""); }}
                    className="text-[#6B705C] hover:text-[#2C2C2C] text-sm"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  data-testid="add-category-btn"
                  onClick={() => setAddingCat(true)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border border-dashed border-[#3A5A40]/40 text-[#3A5A40] hover:bg-[#E5EBE6] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New shelf
                </button>
              )}
            </div>

            {stats.fandoms.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40]">
                    Fandom shelves
                  </p>
                  <p className="text-xs text-[#6B705C] hidden sm:block">
                    Click any fandom to open its dedicated shelf
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {stats.fandoms.map(f => (
                    <button
                      key={f.name}
                      data-testid={`open-fandom-${f.name.replace(/\s+/g, '-').toLowerCase()}`}
                      onClick={() => navigate(`/library/fandom/${encodeURIComponent(f.name)}`)}
                      className="px-3 py-1 rounded-full text-xs font-semibold border bg-[#E5EBE6] text-[#3A5A40] border-[#3A5A40]/20 hover:bg-[#3A5A40] hover:text-white transition-colors flex items-center gap-1.5"
                    >
                      {f.name} · {f.count}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-[#6B705C] py-12 text-center">Loading…</p>
            ) : books.length === 0 ? (
              <p className="text-[#6B705C] py-12 text-center">No books match these filters.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="books-grid">
                {books.map(b => (
                  <BookCard
                    key={b.book_id}
                    book={b}
                    selectMode={selectMode}
                    selected={selectedIds.has(b.book_id)}
                    onToggleSelect={(id) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {selectMode && (
        <SelectionBar
          selectedIds={selectedIds}
          customCats={customCats}
          onDone={() => {
            setSelectedIds(new Set());
            setSelectMode(false);
            load();
          }}
          onCancel={() => {
            setSelectedIds(new Set());
            setSelectMode(false);
          }}
        />
      )}
    </div>
  );
}
