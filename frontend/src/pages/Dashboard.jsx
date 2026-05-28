import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import UploadZone from "../components/UploadZone";
import SelectionBar from "../components/SelectionBar";
import ContinueReadingRail from "../components/ContinueReadingRail";
import { Search, X, Plus, ArrowRight, CheckSquare, Sparkles, Loader2, RefreshCw } from "lucide-react";
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
  const [reclassifyingAll, setReclassifyingAll] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState({ refreshable: 0, last_refreshed_at: null });
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [recentBooks, setRecentBooks] = useState([]);
  const [smart, setSmart] = useState(null); // null | "reading" | "finished"

  const unclassifiedCount = useMemo(() => {
    const row = (stats.categories || []).find((c) => c.name === "Unclassified");
    return row ? row.count : 0;
  }, [stats]);

  const reclassifyAll = async () => {
    if (!window.confirm(`Send ${unclassifiedCount} Unclassified book${unclassifiedCount === 1 ? "" : "s"} to the AI for sorting? This may take a moment.`)) return;
    setReclassifyingAll(true);
    try {
      const { data } = await api.post("/books/reclassify-all", { only_unclassified: true });
      toast.success(`AI sorted ${data.changed} of ${data.processed} book${data.processed === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      toast.error("Couldn't reclassify with AI");
    } finally {
      setReclassifyingAll(false);
    }
  };

  const refreshAll = async () => {
    const n = refreshStatus.refreshable;
    if (!n) return;
    if (!window.confirm(`Pull the latest version of ${n} book${n === 1 ? "" : "s"} from FicHub? Long fics can take a minute each.`)) return;
    setRefreshingAll(true);
    const t = toast.loading(`Updating ${n} book${n === 1 ? "" : "s"} from FicHub…`);
    try {
      const { data } = await api.post("/books/refresh-all", {}, { timeout: 600000 });
      toast.success(`Updated ${data.refreshed} of ${data.eligible} from FicHub`, { id: t });
      if (data.failures && data.failures.length) {
        console.warn("FicHub failures:", data.failures);
      }
      await load();
    } catch (e) {
      toast.error("Couldn't update from FicHub", { id: t });
    } finally {
      setRefreshingAll(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (category && category !== "All") params.category = category;
      if (fandom) params.fandom = fandom;
      if (search) params.q = search;
      if (smart) params.smart = smart;
      const [b, s, c] = await Promise.all([
        api.get("/books", { params }),
        api.get("/books/stats"),
        api.get("/categories"),
      ]);
      setBooks(b.data.books || []);
      setStats(s.data);
      setCustomCats(c.data.custom || []);
      try {
        const rs = await api.get("/books/refresh-status");
        setRefreshStatus(rs.data);
      } catch (e) {}
      try {
        const rc = await api.get("/books/recent", { params: { limit: 8 } });
        setRecentBooks(rc.data.books || []);
      } catch (e) {}
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [category, fandom, search, smart]);

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
          {recentBooks.length > 0 && <ContinueReadingRail books={recentBooks} />}
          <UploadZone onUploaded={load} />
        </div>

        {unclassifiedCount > 0 && (
          <div
            data-testid="reclassify-all-banner"
            className="mb-8 shelf-card p-5 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#FDF3E1] to-white border-[#E07A5F]/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
                  {unclassifiedCount} book{unclassifiedCount === 1 ? "" : "s"} still need{unclassifiedCount === 1 ? "s" : ""} a shelf
                </p>
                <p className="text-sm text-[#6B705C] mt-1">
                  Let Claude read the metadata and file each one for you.
                </p>
              </div>
            </div>
            <button
              data-testid="reclassify-all-btn"
              onClick={reclassifyAll}
              disabled={reclassifyingAll}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {reclassifyingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sorting…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Sort with AI
                </>
              )}
            </button>
          </div>
        )}

        {refreshStatus.refreshable > 0 && (
          <div
            data-testid="refresh-all-banner"
            className="mb-8 shelf-card p-5 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#E5EBE6] to-white border-[#3A5A40]/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#3A5A40]/10 text-[#3A5A40] flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
                  {refreshStatus.refreshable} book{refreshStatus.refreshable === 1 ? "" : "s"} can be updated from FicHub
                </p>
                <p className="text-sm text-[#6B705C] mt-1">
                  Pull the newest chapters straight from AO3, FFnet, Royal Road and friends —
                  we'll replace each EPUB with the latest version.
                </p>
              </div>
            </div>
            <button
              data-testid="refresh-all-btn"
              onClick={refreshAll}
              disabled={refreshingAll}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#3A5A40" }}
            >
              {refreshingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Update all from FicHub
                </>
              )}
            </button>
          </div>
        )}

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
                  onClick={() => { setCategory(c); setFandom(null); setSmart(null); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    category === c && !smart
                      ? "bg-[#E07A5F] text-white border-[#E07A5F]"
                      : "bg-white border-[#E8E6E1] text-[#2C2C2C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {c}
                </button>
              ))}
              {stats.reading > 0 && (
                <button
                  data-testid="filter-smart-reading"
                  onClick={() => {
                    if (smart === "reading") setSmart(null);
                    else { setSmart("reading"); setCategory("All"); setFandom(null); }
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                    smart === "reading"
                      ? "bg-[#E07A5F] text-white border-[#E07A5F]"
                      : "bg-white border-[#E07A5F]/40 text-[#E07A5F] hover:bg-[#E07A5F]/10"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${smart === "reading" ? "bg-white" : "bg-[#E07A5F]"} animate-pulse`} />
                  Currently reading · {stats.reading}
                </button>
              )}
              {stats.finished > 0 && (
                <button
                  data-testid="filter-smart-finished"
                  onClick={() => {
                    if (smart === "finished") setSmart(null);
                    else { setSmart("finished"); setCategory("All"); setFandom(null); }
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    smart === "finished"
                      ? "bg-[#3A5A40] text-white border-[#3A5A40]"
                      : "bg-white border-[#3A5A40]/30 text-[#3A5A40] hover:bg-[#3A5A40]/10"
                  }`}
                >
                  ✓ Finished · {stats.finished}
                </button>
              )}
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
                    onClick={() => { setCategory(c); setFandom(null); setSmart(null); }}
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
                    onChanged={load}
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
