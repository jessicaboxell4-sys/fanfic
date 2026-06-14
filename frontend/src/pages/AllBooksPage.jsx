import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import UploadZone from "../components/UploadZone";
import SelectionBar from "../components/SelectionBar";
import ContinueReadingRail from "../components/ContinueReadingRail";
import StatsCard from "../components/StatsCard";
import PoweredByFanFicFare from "../components/PoweredByFanFicFare";
import OnboardingPrompt from "../components/OnboardingPrompt";
import HelpNudge from "../components/HelpNudge";
import DuplicateResolutionModal from "../components/DuplicateResolutionModal";
import UrlListDedupeModal from "../components/UrlListDedupeModal";
import BackupReminderBanner from "../components/BackupReminderBanner";
import LibraryActivityWidgets from "../components/LibraryActivityWidgets";
import Ao3FilterChips from "../components/Ao3FilterChips";
import FandomFinder from "../components/FandomFinder";
import { Search, X, Plus, ArrowRight, ArrowLeftRight, Heart, BookOpen, CheckSquare, Sparkles, Loader2, RefreshCw, Library, UserCircle2, Filter, Pin, FolderOpen, ArrowUpDown, ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";

const DEFAULT_CATEGORIES = ["All", "Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", "Updated stories", "Old stories"];

export default function AllBooksPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, categories: [], fandoms: [], relationships: [] });
  const [linklessCount, setLinklessCount] = useState(0);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [unknownSourcesCount, setUnknownSourcesCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState({ complete: 0, ongoing: 0 });
  const [category, setCategory] = useState("All");
  const [fandom, setFandom] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [ao3Filters, setAo3Filters] = useState({ rating: null, ao3_category: null, warning: null, exclude_warning: null });
  const [search, setSearch] = useState("");
  const [fulltextMode, setFulltextMode] = useState(false);
  const [fulltextResults, setFulltextResults] = useState(null);
  const [fulltextLoading, setFulltextLoading] = useState(false);
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
  const [overview, setOverview] = useState(null);
  const [seriesList, setSeriesList] = useState([]);
  const [fandomQuery, setFandomQuery] = useState("");
  const [authorsList, setAuthorsList] = useState([]);
  const [pinnedShelves, setPinnedShelves] = useState([]);
  const reloadPinnedShelves = useCallback(async () => {
    try {
      const sh = await api.get("/smart-shelves");
      setPinnedShelves((sh.data.shelves || []).filter((s) => s.pinned));
    } catch (e) { /* non-blocking */ }
  }, []);
  const [pendingDupes, setPendingDupes] = useState([]);
  const [pendingUrlLists, setPendingUrlLists] = useState([]);
  const [undoActions, setUndoActions] = useState([]);  // {book_id, title, action, target_book_id, undoable}
  const [trashCount, setTrashCount] = useState(0);
  const [conversions, setConversions] = useState({ converting: 0, recent_done: 0, recent_failed: 0, visibility_hours: 4, jobs: [] });
  const [glanceOrder, setGlanceOrder] = useState(["continue", "stats", "shelves"]);
  const [glanceHidden, setGlanceHidden] = useState([]);
  const [organizing, setOrganizing] = useState(false);

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
    if (!window.confirm(`Pull the latest version of ${n} book${n === 1 ? "" : "s"} from FanFicFare? Long fics can take a minute each.`)) return;
    setRefreshingAll(true);
    const t = toast.loading(`Updating ${n} book${n === 1 ? "" : "s"} from FanFicFare…`);
    try {
      const { data } = await api.post("/books/refresh-all", {}, { timeout: 600000 });
      toast.success(`Updated ${data.refreshed} of ${data.eligible} from FanFicFare`, { id: t });
      if (data.failures && data.failures.length) {
        console.warn("FanFicFare failures:", data.failures);
      }
      await load();
    } catch (e) {
      toast.error("Couldn't update from FanFicFare", { id: t });
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
      if (relationship) params.relationship = relationship;
      if (ao3Filters.rating) params.rating = ao3Filters.rating;
      if (ao3Filters.ao3_category) params.ao3_category = ao3Filters.ao3_category;
      if (ao3Filters.warning) params.warning = ao3Filters.warning;
      if (ao3Filters.exclude_warning) params.exclude_warning = ao3Filters.exclude_warning;
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
      } catch (e) { /* ignore */ }
      try {
        const ll = await api.get("/library/linkless");
        setLinklessCount(ll.data?.count || 0);
      } catch (e) { /* ignore — non-blocking */ }
      try {
        const ur = await api.get("/library/unreadable");
        setUnreadableCount(ur.data?.count || 0);
      } catch (e) { /* ignore — non-blocking */ }
      try {
        const us = await api.get("/admin/unknown-sources");
        setUnknownSourcesCount(us.data?.count || 0);
      } catch (e) { /* ignore — non-blocking */ }
      try {
        const sc = await api.get("/library/status-counts");
        setStatusCounts({
          complete: sc.data?.complete || 0,
          ongoing: sc.data?.ongoing || 0,
        });
      } catch (e) { /* ignore — non-blocking */ }
      try {
        const rc = await api.get("/books/recent", { params: { limit: 8 } });
        setRecentBooks(rc.data.books || []);
      } catch (e) { /* ignore */ }
      try {
        const ov = await api.get("/stats/overview");
        setOverview(ov.data);
      } catch (e) { /* ignore */ }
      try {
        const sr = await api.get("/series");
        setSeriesList(sr.data.series || []);
      } catch (e) { /* ignore */ }
      try {
        const au = await api.get("/authors");
        setAuthorsList(au.data.authors || []);
      } catch (e) { /* ignore */ }
      try {
        const sh = await api.get("/smart-shelves");
        setPinnedShelves((sh.data.shelves || []).filter((s) => s.pinned));
      } catch (e) { /* ignore — handled by reloadPinnedShelves later */ }
      try {
        const dl = await api.get("/user/dashboard-layout");
        if (Array.isArray(dl.data.order) && dl.data.order.length === 3) {
          setGlanceOrder(dl.data.order);
        }
        if (Array.isArray(dl.data.hidden)) {
          setGlanceHidden(dl.data.hidden);
        }
      } catch (e) { /* ignore */ }
      try {
        const t = await api.get("/trash");
        setTrashCount(t.data?.count || 0);
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [category, fandom, relationship, ao3Filters, search, smart]);

  useEffect(() => { load(); }, [load]);

  // Full-text search: when the toggle is on and the user types ≥ 2 chars,
  // debounce 350 ms then call the dedicated `/api/library/search/fulltext`
  // endpoint. Results render in a panel above the regular book grid; the
  // grid filters themselves keep working untouched so the user can clear
  // the full-text mode and instantly fall back to metadata search.
  useEffect(() => {
    if (!fulltextMode) {
      setFulltextResults(null);
      return;
    }
    const q = search.trim();
    if (q.length < 2) {
      setFulltextResults(null);
      return;
    }
    let cancelled = false;
    setFulltextLoading(true);
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/library/search/fulltext", { params: { q, limit: 20 } });
        if (!cancelled) setFulltextResults(data);
      } catch {
        if (!cancelled) setFulltextResults({ q, count: 0, results: [] });
      } finally {
        if (!cancelled) setFulltextLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [fulltextMode, search]);

  // Honor `?relationship=...` query param on first mount so deep-links from
  // BookDetail pairing chips land on a pre-filtered library.
  useEffect(() => {
    const rel = searchParams.get("relationship");
    if (rel) setRelationship(rel);
  }, []);

  // Poll the conversion-status endpoint while uploads with heavy formats
  // (PDF, MOBI etc.) are running — Calibre conversion can take 30+ seconds.
  // The endpoint also surfaces recently-completed jobs within a 4-hour
  // visibility window so users see what happened across browser sessions.
  useEffect(() => {
    let stopped = false;
    let interval = null;
    const tick = async () => {
      try {
        const { data } = await api.get("/conversions/status");
        if (stopped) return;
        setConversions(data || { converting: 0, recent_done: 0, recent_failed: 0, visibility_hours: 4, jobs: [] });
      } catch (e) { /* non-fatal */ }
    };
    tick();
    // Poll every 3s when anything is in-flight, every 30s otherwise (keeps
    // the chip fresh without hammering the API on idle dashboards).
    interval = setInterval(tick, 3000);
    return () => { stopped = true; if (interval) clearInterval(interval); };
  }, []);

  const moveGlance = (key, dir) => {
    setGlanceOrder((prev) => {
      const idx = prev.indexOf(key);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const out = [...prev];
      [out[idx], out[next]] = [out[next], out[idx]];
      api.put("/user/dashboard-layout", { order: out, hidden: glanceHidden }).catch(() => {
        toast.error("Couldn't save layout");
      });
      return out;
    });
  };

  const toggleGlanceHidden = (key) => {
    setGlanceHidden((prev) => {
      const out = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      api.put("/user/dashboard-layout", { order: glanceOrder, hidden: out }).catch(() => {
        toast.error("Couldn't save layout");
      });
      return out;
    });
  };

  const resetGlanceLayout = () => {
    const defaults = { order: ["continue", "stats", "shelves"], hidden: [] };
    setGlanceOrder(defaults.order);
    setGlanceHidden(defaults.hidden);
    api.put("/user/dashboard-layout", defaults).then(() => {
      toast.success("Layout reset to defaults");
    }).catch(() => {
      toast.error("Couldn't save layout");
    });
  };
  const showEmpty = !loading && stats.total === 0;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <Link
          to="/library"
          data-testid="back-to-dashboard"
          className="inline-flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowRight className="w-4 h-4 rotate-180" /> Back to your library
        </Link>
        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            All books
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]">
            {stats.total > 0 ? `Browse your ${stats.total} book${stats.total > 1 ? "s" : ""}` : "No books yet — add some on the dashboard."}
          </h1>
          {stats.fandoms.length > 0 && (
            <p className="text-[#6B705C] mt-2">
              {stats.fandoms.slice(0, 4).map(f => `${f.name} (${f.count})`).join(" · ")}
            </p>
          )}
          {trashCount > 0 && (
            <Link
              to="/library/trash"
              data-testid="trash-chip"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-medium border border-[#6B705C]/30 bg-white text-[#6B705C] hover:bg-[#6B705C]/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Trash · {trashCount}
            </Link>
          )}
          <div className="mt-5">
            <LibraryActivityWidgets />
          </div>
        </div>

        {(recentBooks.length > 0 ||
          pinnedShelves.length > 0 ||
          (overview && (overview.books_finished > 0 || overview.pages_read > 0 || overview.reading_streak_days > 0))) && (
          <section
            data-testid="at-a-glance-folder"
            className="mb-10 shelf-card p-6 md:p-8 bg-gradient-to-br from-[#FDF3E1]/60 via-white to-[#EDE7FB]/40 border-[#B87A00]/20"
          >
            <div className="flex items-center justify-between mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-2">
                <FolderOpen className="w-4 h-4" /> At a glance
              </p>
              <div className="flex items-center gap-2">
                {organizing && (
                  <button
                    data-testid="reset-glance-btn"
                    onClick={resetGlanceLayout}
                    className="text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1 px-2 py-1 rounded text-[#6B46C1] hover:text-[#2C2C2C] hover:bg-white/60"
                    title="Restore the default order with everything visible"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                )}
                <button
                  data-testid="organize-glance-btn"
                  onClick={() => setOrganizing((v) => !v)}
                  className={`text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1 px-2 py-1 rounded ${
                    organizing ? "text-white bg-[#6B46C1]" : "text-[#6B46C1] hover:text-[#2C2C2C]"
                  }`}
                  title="Reorder or hide these sections"
                >
                  <ArrowUpDown className="w-3 h-3" /> {organizing ? "Done" : "Organize"}
                </button>
              </div>
            </div>
            <div className="space-y-6">
              {glanceOrder.map((key, idx) => {
                const hasContinue = recentBooks.length > 0;
                const hasStats = overview && (overview.books_finished > 0 || overview.pages_read > 0 || overview.reading_streak_days > 0);
                const hasShelves = pinnedShelves.length > 0;
                const isHidden = glanceHidden.includes(key);

                const LABEL = { continue: "Continue reading", stats: "Reading stats", shelves: "Pinned smart shelves" };

                const hasContent = (key === "continue" && hasContinue) || (key === "stats" && hasStats) || (key === "shelves" && hasShelves);

                // In organize mode we always render every section (hidden or not)
                // so the user can un-hide. Outside organize mode hidden+content-less
                // sections collapse entirely.
                if (!organizing && (isHidden || !hasContent)) return null;

                const section = (() => {
                  if (!hasContent) {
                    return (
                      <div className="text-xs text-[#6B705C] italic px-3 py-2 rounded border border-dashed border-[#B87A00]/30 bg-white/40">
                        {LABEL[key]} — nothing here yet
                      </div>
                    );
                  }
                  if (key === "continue") return <ContinueReadingRail books={recentBooks} />;
                  if (key === "stats") return <StatsCard stats={overview} viewMoreTo="/library/stats" />;
                  if (key === "shelves") {
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-2">
                            <Pin className="w-3 h-3" /> Pinned smart shelves
                          </p>
                          <Link
                            to="/library/smart-shelves"
                            data-testid="manage-smart-shelves"
                            className="text-xs text-[#6B46C1] hover:text-[#2C2C2C] font-semibold uppercase tracking-wider inline-flex items-center gap-1"
                          >
                            <Filter className="w-3 h-3" /> Manage
                          </Link>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {pinnedShelves.map((s) => (
                            <button
                              key={s.shelf_id}
                              data-testid={`open-smart-shelf-${s.shelf_id}`}
                              onClick={() => navigate(`/library/smart/${s.shelf_id}`)}
                              className="px-3 py-1 rounded-full text-xs font-semibold border bg-[#FDF3E1] text-[#B87A00] border-[#B87A00]/30 hover:bg-[#B87A00] hover:text-white transition-colors flex items-center gap-1.5"
                            >
                              <Filter className="w-3 h-3" />
                              {s.name} · {s.count}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })();

                return (
                  <div key={key} className={`relative ${isHidden && organizing ? "opacity-40" : ""}`}>
                    {organizing && (
                      <div
                        data-testid={`glance-reorder-${key}`}
                        className="absolute -left-2 top-0 flex flex-col gap-1 z-10"
                      >
                        <button
                          data-testid={`glance-up-${key}`}
                          onClick={() => moveGlance(key, -1)}
                          disabled={idx === 0}
                          className="w-6 h-6 rounded bg-white border border-[#B87A00]/30 text-[#6B46C1] hover:bg-[#FDF3E1] disabled:opacity-30 flex items-center justify-center"
                          title="Move up"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          data-testid={`glance-down-${key}`}
                          onClick={() => moveGlance(key, +1)}
                          disabled={idx === glanceOrder.length - 1}
                          className="w-6 h-6 rounded bg-white border border-[#B87A00]/30 text-[#6B46C1] hover:bg-[#FDF3E1] disabled:opacity-30 flex items-center justify-center"
                          title="Move down"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <button
                          data-testid={`glance-hide-${key}`}
                          onClick={() => toggleGlanceHidden(key)}
                          className={`w-6 h-6 rounded border flex items-center justify-center ${
                            isHidden
                              ? "bg-[#FDF3E1] border-[#B87A00] text-[#B87A00]"
                              : "bg-white border-[#B87A00]/30 text-[#6B46C1] hover:bg-[#FDF3E1]"
                          }`}
                          title={isHidden ? "Show on dashboard" : "Hide from dashboard"}
                        >
                          {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                    <div className={organizing ? "pl-6 transition-all" : ""}>{section}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mb-10">
          {/* Upload zone moved to the new welcome Dashboard at /library.
              AllBooksPage focuses on browsing the existing library. */}
        </div>

        {undoActions.length > 0 && (
          <div
            data-testid="undo-strip"
            className="mb-6 shelf-card p-4 flex flex-wrap items-center justify-between gap-3 bg-amber-50 border-amber-200"
          >
            <div className="flex items-center gap-3">
              <RotateCcw className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-sm text-[#2C2C2C]">
                Just auto-resolved <strong>{undoActions.length}</strong> duplicate{undoActions.length === 1 ? "" : "s"}
                {(() => {
                  const kind = undoActions[0]?.action;
                  if (kind === "historical") return " · linked as historical versions";
                  if (kind === "new_version") return " · replaced as new versions";
                  if (kind === "discard") return " · sent to Trash";
                  return "";
                })()}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                data-testid="undo-all-btn"
                onClick={async () => {
                  let failed = 0;
                  for (const a of undoActions) {
                    try {
                      await api.post(`/books/${a.book_id}/undo-resolve`);
                    } catch (e) {
                      failed += 1;
                    }
                  }
                  if (failed === 0) toast.success(`Undid ${undoActions.length} action${undoActions.length === 1 ? "" : "s"}`);
                  else toast.error(`${failed} couldn't be undone`);
                  setUndoActions([]);
                  load();
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-700 text-white hover:bg-amber-800"
              >
                Undo
              </button>
              <button
                data-testid="undo-dismiss-btn"
                onClick={() => setUndoActions([])}
                className="px-2 py-1.5 rounded text-sm text-[#6B705C] hover:text-[#2C2C2C]"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {pendingDupes.length > 0 && (
          <DuplicateResolutionModal
            pending={pendingDupes}
            onClose={() => setPendingDupes([])}
            onResolved={() => { setPendingDupes([]); load(); }}
          />
        )}

        {pendingUrlLists.length > 0 && (
          <UrlListDedupeModal
            reports={pendingUrlLists}
            onClose={() => setPendingUrlLists([])}
          />
        )}

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

        {refreshStatus.refreshable > 0 && FETCHING_UI_ENABLED && (
          <div
            data-testid="refresh-all-banner"
            className="mb-8 shelf-card p-5 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#EDE7FB] to-white border-[#6B46C1]/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
                  {refreshStatus.refreshable} book{refreshStatus.refreshable === 1 ? "" : "s"} can be updated from FanFicFare
                </p>
                <p className="text-sm text-[#6B705C] mt-1">
                  Pull the newest chapters straight from AO3, FFnet, Royal Road and friends —
                  we&apos;ll replace each EPUB with the latest version.
                </p>
              </div>
            </div>
            <button
              data-testid="refresh-all-btn"
              onClick={refreshAll}
              disabled={refreshingAll}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#6B46C1" }}
            >
              {refreshingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Update all from FanFicFare
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
            <div className="mt-6 flex justify-center">
              {FETCHING_UI_ENABLED && <PoweredByFanFicFare />}
            </div>
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
                  placeholder={fulltextMode ? "Search inside book text…" : "Search by title or author…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#EEE9FB]"
                />
              </div>
              <button
                type="button"
                onClick={() => { setFulltextMode((v) => !v); setFulltextResults(null); }}
                data-testid="toggle-fulltext-search"
                title="Toggle searching the body text of EPUBs (vs. just titles/authors)"
                aria-pressed={fulltextMode}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  fulltextMode
                    ? "bg-[#6B46C1] text-white border-[#6B46C1] hover:bg-[#553397]"
                    : "bg-white text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#EEE9FB]"
                }`}
              >
                <BookOpen className="w-4 h-4" /> Search inside
              </button>
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
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-white border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#6B46C1]/10"
                  }`}
                >
                  ✓ Finished · {stats.finished}
                </button>
              )}
              {stats.unreadable > 0 && (
                <button
                  data-testid="filter-cant-open"
                  onClick={() => {
                    setCategory("Can't Open");
                    setFandom(null);
                    setSmart(null);
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                    category === "Can't Open"
                      ? "bg-[#D9534F] text-white border-[#D9534F]"
                      : "bg-white border-[#D9534F]/30 text-[#D9534F] hover:bg-[#D9534F]/10"
                  }`}
                  title="EPUBs that couldn't be parsed — file is corrupted or not a real EPUB"
                >
                  ⚠ Can&apos;t open · {stats.unreadable}
                </button>
              )}
              {refreshStatus.unavailable > 0 && (
                <button
                  data-testid="filter-smart-unavailable"
                  onClick={() => {
                    if (smart === "unavailable") setSmart(null);
                    else { setSmart("unavailable"); setCategory("All"); setFandom(null); }
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                    smart === "unavailable"
                      ? "bg-[#6B705C] text-white border-[#6B705C]"
                      : "bg-white border-[#6B705C]/30 text-[#6B705C] hover:bg-[#6B705C]/10"
                  }`}
                  title="FanFicFare couldn't find these — skipped on bulk update"
                >
                  🚫 Can&apos;t find online · {refreshStatus.unavailable}
                </button>
              )}
              {smart === "unavailable" && refreshStatus.unavailable > 0 && (
                <>
                  <button
                    data-testid="export-unavailable-btn"
                    onClick={() => window.open(`${process.env.REACT_APP_BACKEND_URL}/api/books/export/unavailable`, "_blank")}
                    className="px-4 py-1.5 rounded-full text-sm font-medium border bg-white border-[#E8E6E1] text-[#2C2C2C] hover:bg-[#F5F3EC] transition-colors flex items-center gap-1.5"
                    title="Download a .txt list with titles, authors, and source URLs"
                  >
                    ⤓ Download list (.txt)
                  </button>
                  <button
                    data-testid="open-cant-find-page"
                    onClick={() => navigate("/library/cant-find-online")}
                    className="px-4 py-1.5 rounded-full text-sm font-medium border bg-white border-[#E8E6E1] text-[#2C2C2C] hover:bg-[#F5F3EC] transition-colors flex items-center gap-1.5"
                    title="Open the Lost & Found page to recover URLs"
                  >
                    🔎 Recover URLs
                  </button>
                </>
              )}
              {customCats.map(c => (
                <span
                  key={c}
                  className={`group flex items-center gap-1 pl-4 pr-1.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    category === c
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-[#EDE7FB] border-[#6B46C1]/20 text-[#6B46C1] hover:bg-[#6B46C1] hover:text-white"
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
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border border-dashed border-[#6B46C1]/40 text-[#6B46C1] hover:bg-[#EDE7FB] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New shelf
                </button>
              )}
            </div>

            {seriesList.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-2">
                    <Library className="w-3 h-3" /> Series detected
                  </p>
                  <p className="text-xs text-[#6B705C] hidden sm:block">
                    Click to open a series shelf in reading order
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {seriesList.map(s => (
                    <button
                      key={s.name}
                      data-testid={`open-series-${s.name.replace(/\s+/g, '-').toLowerCase()}`}
                      onClick={() => navigate(`/library/series/${encodeURIComponent(s.name)}`)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-[#2C2C2C] border-[#E8E6E1] hover:bg-[#2C2C2C] hover:text-white hover:border-[#2C2C2C] transition-colors flex items-center gap-1.5"
                    >
                      <Library className="w-3 h-3" />
                      {s.name} · {s.count}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {linklessCount > 0 && (
              <div className="mb-4">
                <button
                  onClick={() => navigate("/library/linkless")}
                  data-testid="dashboard-linkless-chip"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#EDE7FB] text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                  title="Books with no embedded source URL"
                >
                  {linklessCount} linkless book{linklessCount === 1 ? "" : "s"} · open browser
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {unreadableCount > 0 && (
              <div className="mb-4">
                <button
                  onClick={() => navigate("/library/unreadable")}
                  data-testid="dashboard-unreadable-chip"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FDECE6] text-[#E07A5F] border border-[#E07A5F]/40 hover:bg-[#E07A5F] hover:text-white transition-colors"
                  title="Files we couldn't parse at upload time"
                >
                  <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#E07A5F] text-white text-[10px] font-bold leading-none">!</span>
                  {unreadableCount} unreadable file{unreadableCount === 1 ? "" : "s"} · open browser
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {unknownSourcesCount > 0 && (
              <div className="mb-4">
                <button
                  onClick={() => navigate("/admin/unknown-sources")}
                  data-testid="dashboard-unknown-sources-chip"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#EEE9FB] text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                  title="Potential new fanfic sources Shelfsort flagged for review"
                >
                  <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none">?</span>
                  {unknownSourcesCount} unknown source{unknownSourcesCount === 1 ? "" : "s"} · review
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {(statusCounts.complete > 0 || statusCounts.ongoing > 0) && (
              <div className="mb-4 flex flex-wrap gap-2" data-testid="dashboard-status-chips">
                {statusCounts.complete > 0 && (
                  <button
                    onClick={() => navigate("/library/complete")}
                    data-testid="dashboard-complete-chip"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#EEE9FB] text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                    title="Books with a definitive ending"
                  >
                    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none">✓</span>
                    {statusCounts.complete} finished
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {statusCounts.ongoing > 0 && (
                  <button
                    onClick={() => navigate("/library/ongoing")}
                    data-testid="dashboard-ongoing-chip"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F8E8D8] text-[#9E5A2E] border border-[#9E5A2E]/30 hover:bg-[#9E5A2E] hover:text-white transition-colors"
                    title="Works-in-progress (WIPs, hiatus, abandoned)"
                  >
                    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#9E5A2E] text-white text-[10px] font-bold leading-none">…</span>
                    {statusCounts.ongoing} ongoing
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {stats.fandoms.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">
                    Fandom shelves <span className="text-[#6B705C] font-normal lowercase tracking-normal ml-1">({stats.fandoms.length})</span>
                  </p>
                  <p className="text-xs text-[#6B705C] hidden sm:block">
                    Click any fandom to open its dedicated shelf
                  </p>
                </div>
                {stats.fandoms.length > 10 && (
                  <FandomFinder
                    fandoms={stats.fandoms}
                    query={fandomQuery}
                    onChange={setFandomQuery}
                  />
                )}
                {stats.crossover_count > 0 && (
                  <button
                    onClick={() => navigate("/library/crossovers")}
                    data-testid="dashboard-crossover-chip"
                    className="mb-3 mr-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FDF3E1] text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                  >
                    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none">
                      <ArrowLeftRight className="w-2.5 h-2.5" aria-hidden="true" />
                    </span>
                    {stats.crossover_count} crossover{stats.crossover_count === 1 ? "" : "s"} · open browser
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => navigate("/library/pairings")}
                  data-testid="dashboard-pairings-chip"
                  className="mb-3 mr-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1]/10 text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                  title="Browse all pairings / ships across your library"
                >
                  Browse pairings
                  <ArrowRight className="w-3 h-3" />
                </button>
                {(() => {
                  const q = fandomQuery.trim().toLowerCase();
                  const visibleFandoms = q
                    ? stats.fandoms.filter((f) => (f.name || "").toLowerCase().includes(q))
                    : stats.fandoms;
                  if (q && visibleFandoms.length === 0) {
                    return (
                      <div
                        className="rounded-xl border border-dashed border-[#E5DDC5] bg-[#FBFAF6] p-6 text-center"
                        data-testid="fandom-finder-empty"
                      >
                        <Search className="w-6 h-6 text-[#6B705C] mx-auto mb-1.5" aria-hidden="true" />
                        <p className="text-sm text-[#2C2C2C] mb-2">
                          No fandom matches "{fandomQuery}" in your library.
                        </p>
                        <button
                          type="button"
                          onClick={() => setFandomQuery("")}
                          data-testid="fandom-finder-empty-clear"
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors"
                        >
                          Show all fandoms
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-2" data-testid="fandom-chips-grid">
                      {visibleFandoms.map(f => {
                        // Crossover detection: canonical form uses " / " between
                        // fandoms, so 2+ slash-separated parts → multi-fandom.
                        const xPieces = (f.name || "").split(" / ").map(p => p.trim()).filter(Boolean);
                        const isCrossover = xPieces.length >= 2;
                        return (
                          <button
                            key={f.name}
                            data-testid={`open-fandom-${f.name.replace(/\s+/g, '-').toLowerCase()}`}
                            onClick={() => navigate(`/library/fandom/${encodeURIComponent(f.name)}`)}
                            title={isCrossover ? `Crossover · ${xPieces.length} fandoms` : f.name}
                            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                              isCrossover
                                ? "bg-[#FDF3E1] text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white"
                                : "bg-[#EDE7FB] text-[#6B46C1] border-[#6B46C1]/20 hover:bg-[#6B46C1] hover:text-white"
                            }`}
                          >
                            {isCrossover && (
                              <span
                                data-testid={`crossover-badge-${f.name.replace(/\s+/g, '-').toLowerCase()}`}
                                className="inline-flex items-center justify-center gap-0.5 min-w-[26px] h-[18px] px-1.5 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none"
                                title={`Crossover · ${xPieces.length} fandoms`}
                              >
                                <ArrowLeftRight className="w-2.5 h-2.5" aria-hidden="true" />
                                {xPieces.length}
                              </span>
                            )}
                            {f.name} · {f.count}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {stats.relationships && stats.relationships.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">
                    Relationships
                  </p>
                  <p className="text-xs text-[#6B705C] hidden sm:block">
                    Click a pairing to filter the library
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {stats.relationships.slice(0, 20).map(r => {
                    const active = relationship === r.name;
                    return (
                      <button
                        key={r.name}
                        data-testid={`open-relationship-${r.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
                        onClick={() => {
                          if (active) setRelationship(null);
                          else { setRelationship(r.name); setCategory("All"); setFandom(null); setSmart(null); }
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                          active
                            ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                            : "bg-[#EDE7FB] text-[#6B46C1] border-[#6B46C1]/20 hover:bg-[#6B46C1] hover:text-white hover:border-[#6B46C1]"
                        }`}
                      >
                        <Heart className={`w-3 h-3 flex-shrink-0 ${active ? "fill-current" : ""}`} aria-hidden="true" />
                        {r.name} · {r.count}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {authorsList.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-2">
                    <UserCircle2 className="w-3 h-3" /> Authors
                  </p>
                  <button
                    onClick={() => navigate("/library/authors")}
                    data-testid="dashboard-authors-view-all"
                    className="text-xs text-[#6B46C1] hover:text-[#2C2C2C] hover:underline"
                  >
                    View all →
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {authorsList.slice(0, 12).map(a => (
                    <button
                      key={a.name}
                      data-testid={`open-author-${a.name.replace(/\s+/g, '-').toLowerCase()}`}
                      onClick={() => navigate(`/library/author/${encodeURIComponent(a.name)}`)}
                      className="px-3 py-1 rounded-full text-xs font-semibold border bg-[#EDE7FB] text-[#6B46C1] border-[#6B46C1]/20 hover:bg-[#6B46C1] hover:text-white hover:border-[#6B46C1] transition-colors flex items-center gap-1.5"
                    >
                      <UserCircle2 className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                      {a.name} · {a.count}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {relationship && (
              <div data-testid="active-relationship-banner" className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-[#EDE7FB] text-[#6B46C1] border border-[#6B46C1]/30">
                <Heart className="w-3 h-3 fill-current flex-shrink-0" aria-hidden="true" />
                Showing pairing · <span className="font-semibold">{relationship}</span>
                <button onClick={() => setRelationship(null)} className="hover:text-[#553397]" aria-label="Clear relationship filter">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <Ao3FilterChips value={ao3Filters} onChange={setAo3Filters} onShelfSaved={() => { load(); reloadPinnedShelves(); }} />
            {fulltextMode && (
              <div className="mb-6" data-testid="fulltext-results-panel">
                {fulltextLoading && (
                  <p className="text-[#6B705C] py-4 text-center text-sm">Searching inside books…</p>
                )}
                {!fulltextLoading && fulltextResults && search.trim().length >= 2 && (
                  <>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-3">
                      Inside-book matches ({fulltextResults.count})
                    </p>
                    {fulltextResults.results.length === 0 ? (
                      <p className="text-sm text-[#6B705C] py-6 text-center" data-testid="fulltext-empty">
                        No book bodies contain "{search.trim()}". Books are indexed at upload time — older books may need an admin to run the Full-text backfill.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {fulltextResults.results.map((r) => (
                          <li
                            key={r.book_id}
                            data-testid={`fulltext-hit-${r.book_id}`}
                            className="shelf-card p-3"
                          >
                            <Link
                              to={`/book/${r.book_id}`}
                              className="font-medium text-[#2C2C2C] hover:text-[#6B46C1] flex items-center justify-between gap-2"
                            >
                              <span className="truncate">{r.title || "Untitled"} <span className="text-[#6B705C] font-normal">— {r.author || "Unknown"}</span></span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex-shrink-0">
                                score {r.score}
                              </span>
                            </Link>
                            {r.snippet && (
                              <p className="mt-1.5 text-xs text-[#6B705C] italic leading-relaxed">
                                {r.snippet}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {!fulltextLoading && (!fulltextResults || search.trim().length < 2) && (
                  <p className="text-sm text-[#6B705C] py-4 text-center" data-testid="fulltext-empty-prompt">
                    Type at least 2 characters to search inside your books.
                  </p>
                )}
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

        {stats.total > 0 && (
          <div className="mt-16 mb-8 text-center" data-testid="dashboard-danger-zone">
            <button
              data-testid="wipe-all-btn"
              onClick={async () => {
                const phrase = window.prompt(
                  "This will PERMANENTLY delete every book in your library — EPUBs, covers, reading history, smart shelves, the lot.\n\nThis cannot be undone.\n\nType DELETE EVERYTHING (in capitals, exactly) to confirm:",
                );
                if (phrase !== "DELETE EVERYTHING") {
                  if (phrase !== null) toast.error("Phrase didn't match. Nothing was deleted.");
                  return;
                }
                const t = toast.loading("Wiping library…");
                try {
                  const { data } = await api.post("/books/wipe-library", { confirm: "DELETE_EVERYTHING" }, { timeout: 600000 });
                  toast.success(data.message || "Library wiped.", { id: t });
                  setTimeout(() => { window.location.reload(); }, 1200);
                } catch (e) {
                  toast.error(e?.response?.data?.detail || "Couldn't wipe library", { id: t });
                }
              }}
              className="text-xs text-red-600/70 hover:text-red-700 underline-offset-4 hover:underline transition-colors"
              title="Permanently delete every book + all reading history. Requires typing a phrase to confirm."
            >
              Delete entire library
            </button>
          </div>
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
