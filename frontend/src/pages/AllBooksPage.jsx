import React, { useEffect, useMemo, useState, useCallback } from "react";import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
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
import { useEventStream } from "../hooks/useEventStream";
import { Search, X, Plus, ArrowRight, ArrowLeftRight, Heart, BookOpen, CheckSquare, Sparkles, Loader2, RefreshCw, Library, UserCircle2, Filter, Pin, FolderOpen, ArrowUpDown, ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, Trash2, LayoutGrid, Grid3x3, List as ListIcon, UploadCloud, ShieldCheck, ShieldAlert, Clock } from "lucide-react";
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
  // Grid vs List view.  Persisted per-browser so each visit feels stable.
  // List mode is the "declutter" answer for libraries with hundreds of
  // books — single-line rows fit 4–5× more books per scroll.
  const [viewMode, setViewMode] = useState(() => {
    try { return window.localStorage.getItem("shelfsort_view_mode") || "grid"; }
    catch { return "grid"; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_view_mode", viewMode); }
    catch { /* ignore */ }
  }, [viewMode]);
  const [reclassifyingAll, setReclassifyingAll] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState({ refreshable: 0, last_refreshed_at: null });
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [recentBooks, setRecentBooks] = useState([]);
  const [smart, setSmart] = useState(null); // null | "reading" | "finished"

  // Iter 61 — composable filter chips (length / status / date added).
  // Pure frontend — these chip selections AND-combine on the loaded
  // `books` array.  Distinct from `smart` (which is a backend
  // query-param fast-path); the chip strip composes freely so a user
  // can ask for "Quick + Unread + This week" in one click.
  // Persisted to localStorage so the chip state survives refreshes.
  const [chipFilters, setChipFilters] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_chip_filters");
      if (raw) {
        const parsed = JSON.parse(raw);
        // 2026-06-27 — `series` chip dimension added; older
        // localStorage payloads won't have it.  Default to "all"
        // so an upgraded session doesn't fail the active-filter
        // check below.
        if (parsed && parsed.series == null) parsed.series = "all";
        return parsed;
      }
    } catch { /* ignore */ }
    return { length: "all", status: "all", dateAdded: "any", series: "all" };
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_chip_filters", JSON.stringify(chipFilters)); }
    catch { /* ignore */ }
  }, [chipFilters]);
  const setChip = (dim, value) => setChipFilters((f) => ({ ...f, [dim]: value }));
  const clearChipFilters = () => setChipFilters({ length: "all", status: "all", dateAdded: "any", series: "all" });
  const chipFiltersActive =
    chipFilters.length !== "all" ||
    chipFilters.status !== "all" ||
    chipFilters.dateAdded !== "any" ||
    chipFilters.series !== "all";
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

  // Cross-device hints: fetch the set of books with a fresh cloud
  // cursor from a different device.  Used by BookCard to render the
  // passive "Resume" badge so the user discovers cross-device sync
  // even before enabling push.  Cheap (single Mongo query) and runs
  // once per library mount.
  const [crossDeviceHints, setCrossDeviceHints] = useState({});
  const fetchHints = useCallback(async () => {
    try {
      const deviceId = localStorage.getItem("shelfsort-device-id") || "";
      const { data } = await api.get("/reading-sync/hints", {
        params: { device_id: deviceId, hours: 48 },
      });
      const map = {};
      for (const h of (data?.hints || [])) {
        if (h?.book_id) map[h.book_id] = h;
      }
      setCrossDeviceHints(map);
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { fetchHints(); }, [fetchHints]);

  // Live refresh: when any of the user's devices saves a new cursor,
  // re-fetch the hint set so the "Resume" badge appears immediately
  // on every other open tab without waiting for a remount.  Skips
  // the refetch when the event came from this tab's own device id.
  useEventStream({
    "reading_cursor": (data) => {
      const ownDevice = localStorage.getItem("shelfsort-device-id") || "";
      if (data?.device_id && data.device_id === ownDevice) return;
      fetchHints();
    },
  });

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

  // Honor `?just_added=id1,id2,id3` from the BackgroundJobsBell's
  // "View all N new books" CTA — clamps the visible book grid to just
  // those IDs and surfaces a clear banner so the user knows why the
  // count looks small.  Client-side filter; works even when the
  // backend doesn't support an ID filter, and survives page refreshes.
  const justAddedIds = React.useMemo(() => {
    const raw = searchParams.get("just_added");
    if (!raw) return null;
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  }, [searchParams]);
  const visibleBooks = React.useMemo(() => {
    let pool = books;
    if (justAddedIds) pool = pool.filter((b) => justAddedIds.has(b.book_id));

    // Chip filters (iter 61) — Length / Status / Added.  Compose
    // freely; each dimension applies independently.
    if (chipFilters.length !== "all") {
      pool = pool.filter((b) => {
        const w = b.word_count || 0;
        if (chipFilters.length === "quick")     return w > 0 && w < 30000;
        if (chipFilters.length === "afternoon") return w >= 30000 && w < 80000;
        if (chipFilters.length === "weekend")   return w >= 80000 && w < 160000;
        if (chipFilters.length === "tome")      return w >= 160000;
        return true;
      });
    }
    if (chipFilters.status !== "all") {
      pool = pool.filter((b) => {
        const p = b.progress_fraction;
        if (chipFilters.status === "unread")     return !p || p < 0.001;
        if (chipFilters.status === "in_progress") return p > 0.001 && p < 0.99;
        if (chipFilters.status === "finished")   return p >= 0.99;
        return true;
      });
    }
    if (chipFilters.dateAdded !== "any") {
      const now = Date.now();
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      const MONTH = 30 * 24 * 60 * 60 * 1000;
      pool = pool.filter((b) => {
        const raw = b.created_at || b.date_added;
        if (!raw) return chipFilters.dateAdded === "older"; // missing date counts as old
        const ts = new Date(raw).getTime();
        if (isNaN(ts)) return chipFilters.dateAdded === "older";
        const age = now - ts;
        if (chipFilters.dateAdded === "week")  return age <= WEEK;
        if (chipFilters.dateAdded === "month") return age <= MONTH;
        if (chipFilters.dateAdded === "older") return age >  MONTH;
        return true;
      });
    }
    // 2026-06-27 — Series / Standalone chip.  Operates entirely on
    // already-loaded EPUB metadata (`series_name`).  "Partway"
    // requires looking across all books to find series where ≥1 is
    // finished and ≥1 is unread, so we precompute the partway set
    // once per chip evaluation rather than recomputing per row.
    if (chipFilters.series !== "all") {
      if (chipFilters.series === "standalone") {
        pool = pool.filter((b) => !b.series_name);
      } else if (chipFilters.series === "in_series") {
        pool = pool.filter((b) => !!b.series_name);
      } else if (chipFilters.series === "partway") {
        // Build the partway set from the FULL books list (not the
        // currently-filtered pool) so other chip filters can
        // narrow down WITHIN a partway series.
        const seriesProgress = new Map();  // series_name → {finished, total}
        for (const b of books) {
          if (!b.series_name) continue;
          const slot = seriesProgress.get(b.series_name) || { finished: 0, started: 0, total: 0 };
          slot.total += 1;
          const p = b.progress_fraction;
          if (p >= 0.99) slot.finished += 1;
          else if (p > 0.001) slot.started += 1;
          seriesProgress.set(b.series_name, slot);
        }
        const partwaySet = new Set();
        for (const [name, s] of seriesProgress) {
          // "Partway" = at least one finished AND at least one not
          // finished, OR at least one in-progress and total > 1.
          // Avoids flagging single-book "series" as partway forever.
          if (s.total < 2) continue;
          if ((s.finished > 0 && s.finished < s.total) || s.started > 0) {
            partwaySet.add(name);
          }
        }
        pool = pool.filter((b) => b.series_name && partwaySet.has(b.series_name));
      }
    }
    return pool;
  }, [books, justAddedIds, chipFilters]);

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

        {/* "Just added" filter banner — surfaces when the user lands
            here from the BackgroundJobsBell's "View all N new books"
            link.  Client-side filter so it works without backend
            changes and survives a refresh (since the IDs live in the
            URL). */}
        {justAddedIds && (
          <section className="mb-6" data-testid="just-added-banner">
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#FDF3E1] border border-[#E07A5F]/40">
              <div className="flex items-center gap-2.5 text-sm text-[#8C5C00]">
                <UploadCloud className="w-4 h-4" />
                <span>
                  Showing your <strong>{visibleBooks.length} just-uploaded</strong>{" "}
                  book{visibleBooks.length === 1 ? "" : "s"}.
                </span>
              </div>
              <Link
                to="/library/all"
                data-testid="just-added-clear"
                className="text-xs font-medium text-[#6B46C1] hover:underline"
              >
                Show full library →
              </Link>
            </div>
          </section>
        )}

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
            {/* Suggestion-box discoverability chip (Task 8) — first-
                time users land here with an empty shelf; nudge them
                toward the inbound flywheel right at the moment they
                might wish Shelfsort did one more thing. */}
            <p className="mt-6 text-sm text-[#6B705C]">
              Wish Shelfsort did something it doesn&rsquo;t yet?{" "}
              <Link
                to="/help#suggestions"
                data-testid="empty-library-suggest-feature-link"
                className="text-[#6B46C1] font-semibold hover:underline inline-flex items-center gap-1"
              >
                💡 Suggest a feature →
              </Link>
            </p>
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
              {/* View-mode toggle — Grid (cards) vs List (compact rows).
                  List mode dramatically reduces visual noise for libraries
                  with hundreds of books. Persisted to localStorage. */}
              <div
                className="inline-flex border border-[#E8E6E1] rounded-lg overflow-hidden bg-white"
                data-testid="view-mode-toggle"
                role="radiogroup"
                aria-label="View mode"
              >
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  data-testid="view-mode-grid"
                  aria-pressed={viewMode === "grid"}
                  title="Card grid — see every cover"
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                    viewMode === "grid"
                      ? "bg-[#2C2C2C] text-white"
                      : "text-[#2C2C2C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden sm:inline">Grid</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("compact")}
                  data-testid="view-mode-compact"
                  aria-pressed={viewMode === "compact"}
                  title="Compact grid — fit ~2× more covers on screen"
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-l border-[#E8E6E1] transition-colors ${
                    viewMode === "compact"
                      ? "bg-[#2C2C2C] text-white"
                      : "text-[#2C2C2C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  <Grid3x3 className="w-4 h-4" />
                  <span className="hidden sm:inline">Compact</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  data-testid="view-mode-list"
                  aria-pressed={viewMode === "list"}
                  title="List — full metadata, table-style"
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-l border-[#E8E6E1] transition-colors ${
                    viewMode === "list"
                      ? "bg-[#2C2C2C] text-white"
                      : "text-[#2C2C2C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  <ListIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">List</span>
                </button>
              </div>
            </div>

            {/* Composable filter chips (iter 61) — Length × Status ×
                Date Added.  Three rows; pick one chip per row; AND-
                combine.  Hidden if the user has zero books. */}
            {books.length > 0 && (
              <div
                className="mb-4 p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E6E1] flex flex-col gap-2 text-sm"
                data-testid="library-chip-filters"
              >
                {[
                  {
                    dim: "length",
                    label: "📚 Length",
                    options: [
                      { value: "all",       label: "All" },
                      { value: "quick",     label: "Quick · <2hr · <30k" },
                      { value: "afternoon", label: "Afternoon · 2-5hr · 30-80k" },
                      { value: "weekend",   label: "Weekend · 5-10hr · 80-160k" },
                      { value: "tome",      label: "Tome · 10hr+ · 160k+" },
                    ],
                  },
                  {
                    dim: "status",
                    label: "📖 Status",
                    options: [
                      { value: "all",         label: "All" },
                      { value: "unread",      label: "Unread" },
                      { value: "in_progress", label: "In progress" },
                      { value: "finished",    label: "Finished" },
                    ],
                  },
                  {
                    dim: "dateAdded",
                    label: "📆 Added",
                    options: [
                      { value: "any",   label: "Any time" },
                      { value: "week",  label: "This week" },
                      { value: "month", label: "This month" },
                      { value: "older", label: "Older" },
                    ],
                  },
                  {
                    // 2026-06-27 — Series / Standalone chip.  Helps
                    // readers who keep coming back to a library wall
                    // of "what was I in the middle of?" answer that
                    // question fast.  "Partway" surfaces only series
                    // where ≥1 book is finished and ≥1 isn't — the
                    // exact set of "I should keep reading these".
                    dim: "series",
                    label: "📖 Series",
                    options: [
                      { value: "all",        label: "All" },
                      { value: "standalone", label: "Standalone" },
                      { value: "in_series",  label: "In a series" },
                      { value: "partway",    label: "Partway through" },
                    ],
                  },
                ].map((row) => (
                  <div key={row.dim} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#6B705C] w-20 shrink-0">{row.label}</span>
                    {row.options.map((opt) => {
                      const active = chipFilters[row.dim] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setChip(row.dim, opt.value)}
                          data-testid={`chip-${row.dim}-${opt.value}`}
                          aria-pressed={active}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                              : "bg-white text-[#6B705C] border-[#E8E6E1] hover:bg-[#F5F3EC]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {chipFiltersActive && (
                  <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
                    <span className="text-xs text-[#A09A8B]" data-testid="library-chip-filter-count">
                      {visibleBooks.length} of {books.length} books match
                    </span>
                    <div className="flex items-center gap-2">
                      {visibleBooks.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              // Pure-random shuffle (iter 62) — picks
                              // uniformly from the filtered pool.
                              const pick = visibleBooks[Math.floor(Math.random() * visibleBooks.length)];
                              if (pick && pick.book_id) {
                                window.location.href = `/read/${pick.book_id}`;
                              }
                            }}
                            data-testid="chip-shuffle-filtered"
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white text-[#6B46C1] border border-[#D6CCE8] hover:bg-[#F0EBFB]"
                            title={`Pick a uniformly-random book from the ${visibleBooks.length} matching your filters`}
                          >
                            <Sparkles className="w-3 h-3" />
                            Shuffle these {visibleBooks.length}
                          </button>
                          {/* Taste-weighted pick (iter 63) — opt-in
                              per-click.  Scores each filtered book by
                              how closely its fandom/category/author
                              matches what the user has previously
                              finished, then picks weighted-random.
                              Falls back to uniform when the user has
                              no reading history yet. */}
                          <button
                            type="button"
                            onClick={() => {
                              const finished = books.filter((b) => (b.progress_fraction || 0) >= 0.99);
                              // Build taste profile from finished books
                              const fandomCount = {};
                              const catCount = {};
                              const authorCount = {};
                              // 2026-06-27 (ROADMAP #20) — pairings
                              // intersection.  For fic-heavy libraries,
                              // readers stick with their ships harder
                              // than their fandoms (you might read across
                              // multiple Marvel pairings but never stray
                              // from your one Steve/Bucky preference).
                              // Each finished book contributes its
                              // pairings into the tally; the scorer
                              // below counts how many of the candidate
                              // book's pairings overlap.
                              const pairingCount = {};
                              for (const b of finished) {
                                if (b.fandom) fandomCount[b.fandom] = (fandomCount[b.fandom] || 0) + 1;
                                if (b.category) catCount[b.category] = (catCount[b.category] || 0) + 1;
                                if (b.author) authorCount[b.author] = (authorCount[b.author] || 0) + 1;
                                for (const p of (b.pairings || [])) {
                                  if (p) pairingCount[p] = (pairingCount[p] || 0) + 1;
                                }
                              }
                              // Score each filtered book.  Baseline of
                              // 1 so unfamiliar books still have a
                              // chance — pure "echo chamber" picks
                              // would defeat the purpose.
                              const weighted = visibleBooks.map((b) => {
                                let pairingOverlap = 0;
                                for (const p of (b.pairings || [])) {
                                  if (pairingCount[p]) pairingOverlap += pairingCount[p];
                                }
                                return {
                                  book: b,
                                  weight: 1
                                    + (fandomCount[b.fandom] || 0) * 3
                                    + (catCount[b.category] || 0) * 2
                                    + (authorCount[b.author] || 0) * 2
                                    + pairingOverlap * 2,
                                };
                              });
                              const total = weighted.reduce((s, w) => s + w.weight, 0);
                              let r = Math.random() * total;
                              let pick = weighted[0].book;
                              for (const w of weighted) {
                                r -= w.weight;
                                if (r <= 0) { pick = w.book; break; }
                              }
                              if (pick && pick.book_id) {
                                window.location.href = `/read/${pick.book_id}`;
                              }
                            }}
                            data-testid="chip-pick-for-me"
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
                            title="Like Shuffle, but biased toward books that match the fandoms, categories, authors, and ships you've already finished. Falls back to random if you have no reading history yet."
                          >
                            <Heart className="w-3 h-3" />
                            Pick for me
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={clearChipFilters}
                        data-testid="chip-clear-all"
                        className="text-xs font-semibold text-[#6B46C1] hover:text-[#553397] underline"
                      >
                        Clear filters
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
                  title="We couldn't find these online — skipped on bulk update"
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
            ) : viewMode === "list" ? (
              // List view (enhanced iter 60) — table-style rows with
              // full metadata.  Responsive columns: pairings/wordcount/
              // date hide on narrow screens so mobile stays tidy.
              <div className="bg-white rounded-xl border border-[#E8E6E1] overflow-hidden" data-testid="books-list">
                {/* Sticky-ish header row.  Sortability deliberately
                    deferred — the existing top-bar sort dropdown
                    already drives this list. */}
                <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-[#FAF6EE] border-b border-[#E8E6E1] text-[10px] uppercase tracking-wider font-semibold text-[#A09A8B]">
                  <span className="w-8 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">Title / Author</span>
                  <span className="w-32 shrink-0 truncate">Fandom</span>
                  <span className="w-28 shrink-0 truncate hidden lg:inline">Pairings</span>
                  <span className="w-20 shrink-0 text-right tabular-nums hidden lg:inline">Time · Words</span>
                  <span className="w-14 shrink-0 text-center">Status</span>
                  <span className="w-16 shrink-0 text-right hidden xl:inline">Added</span>
                </div>
                <ul className="divide-y divide-[#E8E6E1]">
                  {visibleBooks.map(b => {
                    const wordsK = b.word_count ? (b.word_count >= 1000 ? `${Math.round(b.word_count / 1000)}k` : String(b.word_count)) : "";
                    // Iter 61 — also surface a reading-time estimate
                    // (270 wpm avg).  Shown next to the word count so
                    // readers who think in time see both.
                    const readingHours = b.word_count ? b.word_count / 16200 : 0;
                    const timeLabel = !b.word_count ? "" :
                      readingHours < 1   ? `${Math.round(readingHours * 60)}m` :
                      readingHours < 10  ? `${readingHours.toFixed(1)}h` :
                                            `${Math.round(readingHours)}h`;
                    const addedRel = (() => {
                      const raw = b.created_at || b.date_added;
                      if (!raw) return "";
                      try {
                        const d = new Date(raw);
                        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      } catch { return ""; }
                    })();
                    const pairings = Array.isArray(b.pairings) ? b.pairings.filter(Boolean).join(", ") : (b.pairings || "");
                    return (
                      <li
                        key={b.book_id}
                        data-testid={`book-row-${b.book_id}`}
                        className={`flex items-center gap-3 px-4 py-2 hover:bg-[#FAF6EE] transition-colors cursor-pointer ${
                          selectMode && selectedIds.has(b.book_id) ? "bg-[#EEE9FB]" : ""
                        }`}
                        onClick={() => {
                          if (selectMode) {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.book_id)) next.delete(b.book_id); else next.add(b.book_id);
                              return next;
                            });
                          } else {
                            window.location.href = `/books/${b.book_id}`;
                          }
                        }}
                      >
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(b.book_id)}
                            onChange={() => {}}
                            className="w-4 h-4 accent-[var(--primary)] shrink-0"
                            data-testid={`book-row-checkbox-${b.book_id}`}
                          />
                        )}
                        {b.has_cover ? (
                          <img
                            src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`}
                            alt=""
                            className="w-8 h-11 rounded-sm shrink-0 object-cover shadow-sm"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-8 h-11 rounded-sm shrink-0 bg-gradient-to-br from-[#6B46C1] to-[#4C2A99] shadow-sm" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[#2C2C2C] truncate" title={b.title}>
                            {b.title || "Untitled"}
                            {b.series && (
                              <span className="ml-1.5 text-[10px] text-[#6B705C] font-normal">· {b.series}{b.series_index ? ` #${b.series_index}` : ""}</span>
                            )}
                          </p>
                          <p className="text-xs text-[#6B705C] truncate">
                            {b.author || "Unknown"}
                          </p>
                        </div>
                        <span className="w-32 shrink-0 text-xs text-[#6B46C1] truncate hidden md:inline" title={b.fandom || ""}>
                          {b.fandom || "—"}
                          {b.category && <span className="ml-1 text-[#A09A8B]">· {b.category}</span>}
                        </span>
                        <span className="w-28 shrink-0 text-xs text-[#6B705C] truncate hidden lg:inline" title={pairings}>
                          {pairings || "—"}
                        </span>
                        <span className="w-20 shrink-0 text-xs font-mono text-[#6B705C] text-right tabular-nums hidden lg:inline" title={`${wordsK} words · ~${timeLabel} read at 270 wpm`}>
                          {b.word_count ? (
                            <>
                              <span className="block leading-tight">{timeLabel}</span>
                              <span className="block text-[10px] text-[#A09A8B] leading-tight">{wordsK}</span>
                            </>
                          ) : "—"}
                        </span>
                        <span className="w-14 shrink-0 text-xs flex items-center justify-center" title={`${b.av_status || "clean"} · ${Math.round((b.progress_fraction || 0) * 100)}%`}>
                          {b.progress_fraction >= 0.99 ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#81B29A]">Read</span>
                          ) : (b.progress_fraction != null && b.progress_fraction > 0) ? (
                            <span className="text-[10px] font-mono text-[#6B705C] tabular-nums">{Math.round(b.progress_fraction * 100)}%</span>
                          ) : b.av_status === "infected" ? (
                            <ShieldAlert className="w-3.5 h-3.5 text-[#D9534F]" aria-label="Infected" />
                          ) : b.av_status === "scanning" ? (
                            <Clock className="w-3.5 h-3.5 text-[#B7791F]" aria-label="Scanning" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-[#A09A8B]" aria-label="Clean" />
                          )}
                        </span>
                        <span className="w-16 shrink-0 text-xs text-[#A09A8B] text-right tabular-nums hidden xl:inline">
                          {addedRel}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : viewMode === "compact" ? (
              // Compact grid (iter 60) — same shape as the regular
              // grid but ~2x density: smaller covers, tighter gap,
              // and a stripped-down per-tile render that drops the
              // BookCard heavy hover-actions in favor of a click-
              // through-only link.  Tap a cover → BookDetail.  Great
              // for big libraries where Grid feels cramped but List
              // is too text-heavy.
              <div
                className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10 gap-3"
                data-testid="books-compact-grid"
              >
                {visibleBooks.map(b => (
                  <button
                    key={b.book_id}
                    type="button"
                    data-testid={`book-compact-${b.book_id}`}
                    onClick={() => {
                      if (selectMode) {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.book_id)) next.delete(b.book_id); else next.add(b.book_id);
                          return next;
                        });
                      } else {
                        window.location.href = `/books/${b.book_id}`;
                      }
                    }}
                    className={`group flex flex-col items-start text-left ${
                      selectMode && selectedIds.has(b.book_id) ? "ring-2 ring-[#6B46C1] rounded-md" : ""
                    }`}
                  >
                    <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden shadow-sm border border-[#E8E6E1] group-hover:shadow-md transition-shadow">
                      {b.has_cover ? (
                        <img
                          src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`}
                          alt={b.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#6B46C1] to-[#4C2A99] flex items-center justify-center p-1">
                          <span className="text-[8px] text-white text-center line-clamp-3 leading-tight font-serif">
                            {b.title || "Untitled"}
                          </span>
                        </div>
                      )}
                      {b.progress_fraction != null && b.progress_fraction > 0 && b.progress_fraction < 0.99 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                          <div
                            className="h-full bg-[#6B46C1]"
                            style={{ width: `${Math.round(b.progress_fraction * 100)}%` }}
                          />
                        </div>
                      )}
                      {b.progress_fraction >= 0.99 && (
                        <span className="absolute top-1 right-1 text-[7px] font-bold uppercase tracking-wider text-white bg-[#81B29A] px-1 py-0.5 rounded">
                          Read
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] font-medium text-[#2C2C2C] line-clamp-2 leading-tight w-full" title={b.title}>
                      {b.title || "Untitled"}
                    </p>
                    <p className="text-[10px] text-[#6B705C] truncate w-full">
                      {b.author || "—"}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="books-grid">
                {visibleBooks.map(b => (
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
                    crossDeviceHint={crossDeviceHints[b.book_id]}
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
