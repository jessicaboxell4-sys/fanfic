import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getReadingStatus, READING_STATUS_META } from "../lib/readingStatus";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import SelectionBar from "../components/SelectionBar";
import { useVerdictTaxonomy } from "../lib/useVerdictTaxonomy";
import ContinueReadingRail from "../components/ContinueReadingRail";
import StatsCard from "../components/StatsCard";
import PoweredByFanFicFare from "../components/PoweredByFanFicFare";
import OnboardingPrompt from "../components/OnboardingPrompt";
import SuggestionChip from "../components/SuggestionChip";
import HelpNudge from "../components/HelpNudge";
import DuplicateResolutionModal from "../components/DuplicateResolutionModal";
import UrlListDedupeModal from "../components/UrlListDedupeModal";
import BackupReminderBanner from "../components/BackupReminderBanner";
import FriendRequestBanner from "../components/FriendRequestBanner";
import PendingPolishBanner from "../components/PendingPolishBanner";
import FailedUploadsList from "../components/FailedUploadsList";
import SkippedFilesPanel from "../components/SkippedFilesPanel";
import OneTimeTip from "../components/OneTimeTip";
import LibraryActivityWidgets from "../components/LibraryActivityWidgets";
import Ao3FilterChips from "../components/Ao3FilterChips";
import FandomFinder from "../components/FandomFinder";
import UploadZone from "../components/UploadZone";
import { useEventStream } from "../hooks/useEventStream";
import { Search, X, Plus, ArrowRight, ArrowLeftRight, Heart, BookOpen, CheckSquare, Sparkles, Loader2, RefreshCw, Library, UserCircle2, Filter, Pin, FolderOpen, ArrowUpDown, ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw, Trash2, LayoutGrid, Grid3x3, List as ListIcon, UploadCloud, ShieldCheck, ShieldAlert, Clock, GripVertical, Columns3 } from "lucide-react";
import { toast } from "sonner";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const DEFAULT_CATEGORIES = ["All", "Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", "Updated stories", "Old stories"];

// Static column metadata for the list view — shared between the module-
// scope SortableHeaderCell and per-cell body renderers so header + row
// order can never diverge.
const LIST_COL_META = {
  fandom:    { label: "Fandom",       align: "left",   showAt: "" },
  pairings:  { label: "Pairings",     align: "left",   showAt: "hidden lg:inline-block" },
  wordcount: { label: "Time · Words", align: "right",  showAt: "hidden lg:inline-block" },
  size:      { label: "Size",         align: "right",  showAt: "hidden lg:inline-block" },
  status:    { label: "Status",       align: "center", showAt: "" },
  added:     { label: "Added",        align: "right",  showAt: "hidden xl:inline-block" },
};

const DEFAULT_COL_WIDTHS = {
  fandom:    128,
  pairings:  112,
  wordcount: 80,
  size:      72,
  status:    56,
  added:     72,
};
const MIN_COL_WIDTH = 44;

// 2026-08-14 — Named column layout presets.  Each preset defines both
// the visible columns AND the left-to-right order, so a single click
// reshapes the list view for a common workflow.  Hidden columns still
// exist (their persisted widths are preserved), they just aren't
// rendered / are pushed to the tail of the order list.
const LIST_COL_PRESETS = {
  "reading-queue":  { label: "Reading queue",   order: ["wordcount", "status", "added", "fandom", "pairings", "size"], visible: { fandom: false, pairings: false, wordcount: true,  size: false, status: true,  added: true  } },
  "fandom-deep":    { label: "Fandom deep-dive",order: ["fandom", "pairings", "status", "wordcount", "size", "added"], visible: { fandom: true,  pairings: true,  wordcount: false, size: false, status: true,  added: false } },
  "storage-audit":  { label: "Storage audit",   order: ["size", "wordcount", "added", "fandom", "pairings", "status"], visible: { fandom: false, pairings: false, wordcount: true,  size: true,  status: false, added: true  } },
};

// Draggable + click-to-sort + right-edge resize header cell.
function SortableHeaderCell({ colKey, width, sortMode, cycleSort, startColResize }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: colKey });
  const meta = LIST_COL_META[colKey];
  const align = meta.align;
  const arrow = sortMode.col === colKey
    ? <span className="ml-1 text-[#6B46C1]">{sortMode.dir === "desc" ? "▼" : "▲"}</span>
    : null;
  const style = {
    width: `${width}px`,
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <span
      ref={setNodeRef}
      className={`relative shrink-0 truncate ${meta.showAt} bg-[#FAF6EE]`}
      style={style}
      data-testid={`list-header-${colKey}`}
    >
      <span className="flex items-center gap-1 w-full h-full">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#8B7AB8] hover:text-[#6B46C1] shrink-0 touch-none"
          aria-label={`Reorder ${meta.label} column`}
          data-testid={`list-header-drag-${colKey}`}
          title="Drag to reorder column"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => cycleSort(colKey)}
          className={`inline-flex items-center flex-1 min-w-0 h-full uppercase tracking-wider font-semibold hover:text-[#2C2C2C] transition-colors ${
            align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"
          } ${sortMode.col === colKey ? "text-[#2C2C2C]" : "text-[#6E6E6E]"}`}
          data-testid={`list-header-btn-${colKey}`}
        >
          <span className="truncate">{meta.label}</span>
          {arrow}
        </button>
      </span>
      <span
        onMouseDown={startColResize(colKey)}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${meta.label} column`}
        data-testid={`list-header-resize-${colKey}`}
        className="absolute top-0 right-[-6px] h-full w-2 cursor-col-resize select-none group"
        title="Drag to resize"
      >
        <span className="absolute inset-y-1 right-1 w-px bg-[#D8D2C4] group-hover:bg-[#6B46C1] transition-colors" />
      </span>
    </span>
  );
}

// Vertically-draggable section header ("💜 Fanfic · N" / "📖 Original & Non-fic · N").
function SortableSectionHeader({ sec, collapsed, toggleSection }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sec.key });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      className="bg-[#FAF6EE] px-4 py-2"
      style={style}
      data-testid={`books-section-list-${sec.key}`}
    >
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#8B7AB8] hover:text-[#6B46C1] shrink-0 touch-none"
          aria-label={`Reorder ${sec.label} section`}
          data-testid={`section-drag-handle-${sec.key}`}
          title="Drag to reorder this section"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => toggleSection(sec.key)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <span className="font-serif text-base text-[#2C2C2C]">{sec.label}</span>
          <span className="text-xs text-[#6E6E6E]">· {sec.books.length}</span>
          <span aria-hidden="true" className={`ml-auto text-[#5B5F4D] text-xs transition-transform ${collapsed ? "" : "rotate-180"}`}>▼</span>
        </button>
      </div>
    </li>
  );
}
export default function AllBooksPage() {
  const navigate = useNavigate();
  const { user, refresh: refreshAuth } = useAuth();
  // 2026-06-27 — Library mode (fanfic / original / mixed).  Drives the
  // default category chip and (in mixed mode) splits the book list
  // into separate sections.  Read from AuthContext so a change on
  // /account flows here immediately on the next refresh.
  const libraryMode = user?.library_mode || "mixed";
  const [searchParams] = useSearchParams();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, categories: [], fandoms: [], relationships: [] });
  const [linklessCount, setLinklessCount] = useState(0);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [unknownSourcesCount, setUnknownSourcesCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState({ complete: 0, ongoing: 0 });
  // Initial category default is keyed off library_mode:
  //   • fanfic    → "Fanfiction"
  //   • original  → "Original Fiction"
  //   • mixed/any → "All"
  // Users can still click any other chip; this only affects the
  // landing default the first time the page renders for the session.
  const [category, setCategory] = useState(() => (
    libraryMode === "fanfic" ? "Fanfiction" :
    libraryMode === "original" ? "Original Fiction" :
    "All"
  ));
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
        // 2026-06-27 — `verdict` + `readingState` chip dimensions
        // added with the Verdicts feature.  Default both to "all"
        // for older sessions so the active-filter check below
        // doesn't false-fire and force the chip stack open.
        if (parsed && parsed.verdict == null) parsed.verdict = "all";
        if (parsed && parsed.readingState == null) parsed.readingState = "all";
        return parsed;
      }
    } catch { /* ignore */ }
    return { length: "all", status: "all", dateAdded: "any", series: "all", verdict: "all", readingState: "all" };
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_chip_filters", JSON.stringify(chipFilters)); }
    catch { /* ignore */ }
  }, [chipFilters]);
  const setChip = (dim, value) => setChipFilters((f) => ({ ...f, [dim]: value }));
  const clearChipFilters = () => setChipFilters({ length: "all", status: "all", dateAdded: "any", series: "all", verdict: "all", readingState: "all" });

  // 2026-06-27 — Taxonomy hook for the new Verdict + Reading-state
  // chip rows.  Cached at module level so this fetch only fires once
  // per session no matter how many components use it.
  const { taxonomy: verdictTax } = useVerdictTaxonomy();
  const chipFiltersActive =
    chipFilters.length !== "all" ||
    chipFilters.status !== "all" ||
    chipFilters.dateAdded !== "any" ||
    chipFilters.series !== "all" ||
    chipFilters.verdict !== "all" ||
    chipFilters.readingState !== "all";

  // 2026-06-27 — Chip-stack open/closed state.
  // Persisted explicit user choice ("auto" = no choice yet, defer to
  // chipFiltersActive; "open"/"closed" = sticky user override).
  // Default behaviour:
  //   • Fresh visit, no filters       → closed (clean library page)
  //   • Fresh visit, filters present  → open    (so user sees what's filtering)
  //   • After user clicks the toggle  → their choice is honored
  //     across refreshes via localStorage.
  const [chipsPref, setChipsPref] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_chips_pref");
      if (raw === "open" || raw === "closed") return raw;
    } catch { /* ignore */ }
    return "auto";
  });
  const chipsExpanded = chipsPref === "open" || (chipsPref === "auto" && chipFiltersActive);
  const setChipsExpanded = (next) => {
    const value = typeof next === "function" ? next(chipsExpanded) : next;
    const pref = value ? "open" : "closed";
    setChipsPref(pref);
    try { window.localStorage.setItem("shelfsort_chips_pref", pref); } catch { /* ignore */ }
  };

  // 2026-06-27 — List-mode row density.
  // Three options ranging from "see every row" → "more breathing room".
  // Only applies when viewMode === "list" (Grid + Compact already have
  // their own implicit densities via card sizes).  Persisted so the
  // user's pick survives refreshes.
  const [listDensity, setListDensity] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_density");
      if (raw === "compact" || raw === "comfortable" || raw === "cozy") return raw;
    } catch { /* ignore */ }
    return "comfortable";
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_density", listDensity); }
    catch { /* ignore */ }
  }, [listDensity]);
  // py-* class per density level — keeps the existing list row's
  // flex layout intact, only changes vertical padding.
  const listRowPadding = (
    listDensity === "compact"     ? "py-1" :
    listDensity === "cozy"        ? "py-4" :
                                    "py-2"   // comfortable (default)
  );

  // Iter 92-93 — Resizable + sortable + reorderable list-view columns
  // + per-column visibility + draggable section reorder.  All state
  // persists to localStorage.
  const [colWidths, setColWidths] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_widths");
      if (raw) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_COL_WIDTHS;
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_col_widths", JSON.stringify(colWidths)); }
    catch { /* ignore */ }
  }, [colWidths]);
  const startColResize = (colKey) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] ?? DEFAULT_COL_WIDTHS[colKey] ?? 100;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      setColWidths((prev) => ({ ...prev, [colKey]: Math.max(MIN_COL_WIDTH, Math.round(startWidth + dx)) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const resetColWidths = () => setColWidths(DEFAULT_COL_WIDTHS);

  const [sortMode, setSortMode] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_sort");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch { /* ignore */ }
    return { col: null, dir: "asc" };
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_sort", JSON.stringify(sortMode)); }
    catch { /* ignore */ }
  }, [sortMode]);
  const cycleSort = (col) => {
    setSortMode((cur) => {
      if (cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return { col: null, dir: "asc" };
    });
  };
  const clearSort = () => setSortMode({ col: null, dir: "asc" });
  const SORT_COL_LABELS = {
    title: "Title", author: "Author", fandom: "Fandom", pairings: "Pairings",
    wordcount: "Time · Words", size: "Size", status: "Status", added: "Added",
  };
  const fmtSize = (n) => {
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const REORDERABLE_COL_KEYS = ["fandom", "pairings", "wordcount", "size", "status", "added"];
  const [colOrder, setColOrder] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_order");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((k) => REORDERABLE_COL_KEYS.includes(k))) {
          const missing = REORDERABLE_COL_KEYS.filter((k) => !parsed.includes(k));
          return [...parsed, ...missing];
        }
      }
    } catch { /* ignore */ }
    return REORDERABLE_COL_KEYS;
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_col_order", JSON.stringify(colOrder)); }
    catch { /* ignore */ }
  }, [colOrder]);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_visibility");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const out = {};
          REORDERABLE_COL_KEYS.forEach((k) => { out[k] = parsed[k] !== false; });
          return out;
        }
      }
    } catch { /* ignore */ }
    return REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = true; return acc; }, {});
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_col_visibility", JSON.stringify(visibleCols)); }
    catch { /* ignore */ }
  }, [visibleCols]);
  const toggleColVisibility = (key) => setVisibleCols((prev) => ({ ...prev, [key]: !prev[key] }));
  // 2026-08-14 — "Just the essentials" one-click density preset.
  // Hides Pairings + Time·Words so a laptop screen shows only the
  // core columns (Fandom, Size, Status, Added).  Toggling it again
  // (button becomes "Show all") re-enables every column.
  const essentialsActive = visibleCols.pairings === false && visibleCols.wordcount === false;
  const applyEssentials = () => {
    if (essentialsActive) {
      setVisibleCols(REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = true; return acc; }, {}));
    } else {
      setVisibleCols((prev) => ({ ...prev, pairings: false, wordcount: false }));
    }
  };
  // 2026-08-14 — Named column layout presets (Reading queue / Fandom
  // deep-dive / Storage audit).  Applies both visibility and column
  // order in one click; persists via the existing localStorage
  // effects on visibleCols + colOrder.
  //
  // 2026-08-15 — Per-user overrides on top of the defaults: right-
  // click a preset chip to rename or overwrite it with the current
  // column layout.  Stored in localStorage as
  // { [presetKey]: { label?, visible?, order? } }.  A "Reset to
  // default" clears the override for that key.
  const [presetOverrides, setPresetOverrides] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_preset_overrides");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch { /* ignore */ }
    return {};
  });
  // 2026-08-16 — User-created preset chips.  Stored separately from
  // overrides so a delete is a clean removal (not a "reset to default"
  // fallback).  Shape:
  //   { [customKey]: { label, visible, order, created_at } }
  const [customPresets, setCustomPresets] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_custom_presets");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch { /* ignore */ }
    return {};
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_col_custom_presets", JSON.stringify(customPresets)); }
    catch { /* ignore */ }
  }, [customPresets]);
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_list_col_preset_overrides", JSON.stringify(presetOverrides)); }
    catch { /* ignore */ }
  }, [presetOverrides]);

  // 2026-08-15 — Jump-to-row input.  Focus with the `g` keyboard
  // shortcut (spreadsheet-style) or by clicking the tiny "→ #" pill
  // in the list header.  Scrolls the matching `book-row-number-*`
  // into view and briefly highlights the row.
  const [jumpInputOpen, setJumpInputOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpFlashId, setJumpFlashId] = useState(null);
  const jumpInputRef = useRef(null);
  const openJumpInput = () => {
    setJumpInputOpen(true);
    // Focus after the input mounts.
    setTimeout(() => { try { jumpInputRef.current?.focus(); jumpInputRef.current?.select(); } catch { /* ignore */ } }, 0);
  };
  const executeJumpToRow = () => {
    const n = parseInt(String(jumpValue).trim(), 10);
    if (!Number.isFinite(n) || n < 1) {
      setJumpInputOpen(false);
      return;
    }
    // The row-number cell's testid is book-row-number-<book_id> and
    // its text content is the visible number.  Cheapest correct
    // lookup: query all row-number cells, match on text.
    const cells = document.querySelectorAll('[data-testid^="book-row-number-"]');
    for (const cell of cells) {
      if ((cell.textContent || "").trim() === String(n)) {
        cell.scrollIntoView({ behavior: "smooth", block: "center" });
        const bookId = cell.getAttribute("data-testid").replace("book-row-number-", "");
        setJumpFlashId(bookId);
        setTimeout(() => setJumpFlashId(null), 1500);
        break;
      }
    }
    setJumpInputOpen(false);
  };
  // Merged preset table: default + any override on top + user custom
  // presets.  Custom presets are marked with `_custom: true` so the
  // right-click editor can offer "Delete" instead of "Reset".
  const effectivePresets = useMemo(() => {
    const out = {};
    Object.entries(LIST_COL_PRESETS).forEach(([k, base]) => {
      const ov = presetOverrides[k] || {};
      out[k] = {
        label:   ov.label   || base.label,
        visible: ov.visible || base.visible,
        order:   ov.order   || base.order,
        _custom: false,
      };
    });
    Object.entries(customPresets).forEach(([k, cp]) => {
      if (cp && cp.label && cp.visible && cp.order) {
        out[k] = { label: cp.label, visible: cp.visible, order: cp.order, _custom: true };
      }
    });
    return out;
  }, [presetOverrides, customPresets]);
  const applyLayoutPreset = (presetKey) => {
    const preset = effectivePresets[presetKey];
    if (!preset) return;
    setVisibleCols({ ...preset.visible });
    setColOrder([...preset.order]);
  };
  // Right-click popover state for the preset chips.  Positioned at
  // the click point so it hovers next to the chip that was targeted.
  const [presetEditor, setPresetEditor] = useState(null); // { key, x, y }
  const presetEditorRef = useRef(null);
  useEffect(() => {
    if (!presetEditor) return undefined;
    const onDocClick = (e) => {
      if (presetEditorRef.current && !presetEditorRef.current.contains(e.target)) {
        setPresetEditor(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [presetEditor]);
  const renamePreset = (key, newLabel) => {
    const trimmed = String(newLabel || "").trim().slice(0, 40);
    if (!trimmed) return;
    setPresetOverrides((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), label: trimmed },
    }));
  };
  const overwritePresetWithCurrent = (key) => {
    // Snapshot the CURRENT visible columns + order into this preset.
    setPresetOverrides((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        visible: REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = !!visibleCols[k]; return acc; }, {}),
        order: [...colOrder],
      },
    }));
  };
  const resetPreset = (key) => {
    setPresetOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  // 2026-08-16 — Custom preset lifecycle: create captures the current
  // layout under a new key, delete strips a user-created preset,
  // rename works on either flavour (falls through to renamePreset
  // for built-ins and to customPresets for user-created).
  const saveNewCustomPreset = (label) => {
    const trimmed = String(label || "").trim().slice(0, 40);
    if (!trimmed) return;
    const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const snapshotVisible = REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = !!visibleCols[k]; return acc; }, {});
    setCustomPresets((prev) => ({
      ...prev,
      [key]: { label: trimmed, visible: snapshotVisible, order: [...colOrder], created_at: new Date().toISOString() },
    }));
  };
  const renameCustomPreset = (key, newLabel) => {
    const trimmed = String(newLabel || "").trim().slice(0, 40);
    if (!trimmed) return;
    setCustomPresets((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), label: trimmed },
    }));
  };
  const overwriteCustomPresetWithCurrent = (key) => {
    setCustomPresets((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        visible: REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = !!visibleCols[k]; return acc; }, {}),
        order: [...colOrder],
      },
    }));
  };
  const deleteCustomPreset = (key) => {
    setCustomPresets((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  // 2026-08-17 — Cross-device preset sharing.  A tiny JSON blob you
  // can copy to clipboard from any chip's right-click editor and
  // paste back in via the "Paste preset" button in the menu.  The
  // wire format is intentionally boring:
  //   {"shelfsort_preset_v1": {"label": "...", "visible": {...}, "order": [...]}}
  // so a future reader that grows more fields can bump v1.
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");
  const buildPresetShareBlob = (key) => {
    const preset = effectivePresets[key];
    if (!preset) return null;
    return {
      shelfsort_preset_v1: {
        label: preset.label,
        visible: preset.visible,
        order: preset.order,
      },
    };
  };
  const copyPresetToClipboard = async (key) => {
    const blob = buildPresetShareBlob(key);
    if (!blob) return false;
    try {
      await navigator.clipboard.writeText(JSON.stringify(blob));
      return true;
    } catch {
      return false;
    }
  };
  const importPresetFromJson = (jsonStr) => {
    setPasteError("");
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      setPasteError("That doesn't look like valid JSON.");
      return false;
    }
    const p = parsed?.shelfsort_preset_v1;
    if (!p || typeof p !== "object" || !p.label || !Array.isArray(p.order) || typeof p.visible !== "object") {
      setPasteError("Not a shelfsort preset — missing label/order/visible.");
      return false;
    }
    // Sanitize order + visible to known column keys only.
    const order = p.order.filter((k) => REORDERABLE_COL_KEYS.includes(k));
    if (order.length === 0) {
      setPasteError("Preset has no recognisable columns for this version of Shelfsort.");
      return false;
    }
    const visible = REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = !!p.visible[k]; return acc; }, {});
    const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setCustomPresets((prev) => ({
      ...prev,
      [key]: {
        label: String(p.label).trim().slice(0, 40),
        visible,
        order,
        created_at: new Date().toISOString(),
        imported: true,
      },
    }));
    return true;
  };

  // 2026-08-15 — Global `g` shortcut to open the jump-to-row input,
  // Esc to close.  Ignores keystrokes typed into an <input>/<textarea>
  // or contenteditable region so it never steals focus from search
  // boxes, and only activates in list view where the # column exists.
  useEffect(() => {
    const onKey = (e) => {
      if (viewMode !== "list") return;
      const target = e.target;
      const inField = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (inField) return;
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openJumpInput();
      } else if (e.key === "Escape" && jumpInputOpen) {
        e.preventDefault();
        setJumpInputOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewMode, jumpInputOpen]);
  const activeColOrder = useMemo(
    () => colOrder.filter((k) => visibleCols[k]),
    [colOrder, visibleCols],
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  useEffect(() => {
    if (!colMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setColMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [colMenuOpen]);

  const [sectionOrder, setSectionOrder] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_section_order");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return ["fanfic", "original"];
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_section_order", JSON.stringify(sectionOrder)); }
    catch { /* ignore */ }
  }, [sectionOrder]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleColumnDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColOrder((cur) => {
      const from = cur.indexOf(active.id);
      const to = cur.indexOf(over.id);
      if (from === -1 || to === -1) return cur;
      return arrayMove(cur, from, to);
    });
  };
  const handleSectionDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSectionOrder((cur) => {
      const from = cur.indexOf(active.id);
      const to = cur.indexOf(over.id);
      if (from === -1 || to === -1) return cur;
      return arrayMove(cur, from, to);
    });
  };
  const renderBodyCell = (colKey, b, ctx) => {
    const width = `${colWidths[colKey] ?? DEFAULT_COL_WIDTHS[colKey]}px`;
    const showAt = LIST_COL_META[colKey].showAt;
    switch (colKey) {
      case "fandom":
        return (
          <span
            key={colKey}
            className={`shrink-0 text-xs text-[#6B46C1] truncate ${showAt || "hidden md:inline-block"}`}
            style={{ width }}
            title={b.fandom || ""}
            data-testid={`book-row-fandom-${b.book_id}`}
          >
            {b.fandom || "—"}
            {b.category && <span className="ml-1 text-[#6E6E6E]">· {b.category}</span>}
          </span>
        );
      case "pairings":
        return (
          <span key={colKey} className={`shrink-0 text-xs text-[#5B5F4D] truncate ${showAt}`} style={{ width }} title={ctx.pairings}>
            {ctx.pairings || "—"}
          </span>
        );
      case "wordcount":
        return (
          <span key={colKey} className={`shrink-0 text-xs font-mono text-[#5B5F4D] text-right tabular-nums ${showAt}`} style={{ width }} title={`${ctx.wordsK} words · ~${ctx.timeLabel} read at 270 wpm`}>
            {b.word_count ? (
              <>
                <span className="block leading-tight">{ctx.timeLabel}</span>
                <span className="block text-[10px] text-[#6E6E6E] leading-tight">{ctx.wordsK}</span>
              </>
            ) : "—"}
          </span>
        );
      case "size":
        return (
          <span
            key={colKey}
            className={`shrink-0 text-xs font-mono text-[#5B5F4D] text-right tabular-nums ${showAt}`}
            style={{ width }}
            title={b.size_bytes ? `${b.size_bytes.toLocaleString()} bytes` : ""}
            data-testid={`book-row-size-${b.book_id}`}
          >
            {fmtSize(b.size_bytes)}
          </span>
        );
      case "status":
        return (
          <span key={colKey} className="shrink-0 text-xs flex items-center justify-center" style={{ width }} title={`${b.av_status || "clean"} · ${Math.round((b.progress_fraction || 0) * 100)}% · ${READING_STATUS_META[getReadingStatus(b)].label}`}>
            {(() => {
              const s = getReadingStatus(b);
              if (s === "finished") {
                return <span data-testid={`row-status-${b.book_id}`} data-status="finished" className={READING_STATUS_META.finished.listClassName}>Finished</span>;
              }
              if (s === "reading") {
                return <span data-testid={`row-status-${b.book_id}`} data-status="reading" className="text-[10px] font-mono text-[#B7791F] tabular-nums">{Math.round((b.progress_fraction || 0) * 100)}%</span>;
              }
              // Unread — show AV pip if flagged, else the plain Unread label
              if (b.av_status === "infected") return <ShieldAlert className="w-3.5 h-3.5 text-[#D9534F]" aria-label="Infected" />;
              if (b.av_status === "scanning") return <Clock className="w-3.5 h-3.5 text-[#B7791F]" aria-label="Scanning" />;
              return <span data-testid={`row-status-${b.book_id}`} data-status="unread" className={READING_STATUS_META.unread.listClassName}>Unread</span>;
            })()}
          </span>
        );
      case "added":
        return (
          <span key={colKey} className={`shrink-0 text-xs text-[#6E6E6E] text-right tabular-nums ${showAt}`} style={{ width }}>
            {ctx.addedRel}
          </span>
        );
      default:
        return null;
    }
  };

  // 2026-06-27 — Grid-mode card-size slider.
  // Three sizes: S (more columns / smaller covers — great for big
  // libraries), M (default, current behaviour), L (fewer columns /
  // bigger covers — easier to read titles).  Only applies to the
  // main Grid view; Compact mode keeps its own hard-coded high-
  // density grid since it's already explicitly the "see ALL covers"
  // mode.  Persisted across refreshes.
  const [gridSize, setGridSize] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_grid_size");
      if (raw === "s" || raw === "m" || raw === "l") return raw;
    } catch { /* ignore */ }
    return "m";
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_grid_size", gridSize); }
    catch { /* ignore */ }
  }, [gridSize]);
  // Variable-column-count grid class string.  Smaller breakpoints
  // stay stable so mobile / narrow screens get a reasonable layout
  // regardless of the desktop-side preference — the slider mostly
  // affects md+ widths where libraries actually live.
  const gridColsClass = (
    gridSize === "s"
      ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8"
      : gridSize === "l"
        ? "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
  );

  const isMixedMode = libraryMode === "mixed";

  // Per-section collapse state.  Keyed by section.key so users can
  // hide one side of the library while keeping the other expanded.
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = window.localStorage.getItem("shelfsort_section_collapse");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("shelfsort_section_collapse", JSON.stringify(collapsedSections)); }
    catch { /* ignore */ }
  }, [collapsedSections]);
  const toggleSection = (key) => setCollapsedSections((c) => ({ ...c, [key]: !c[key] }));
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

  // Honor `?category=...` query param so Navbar deep-links (Old versions,
  // Updated stories, Unclassified, etc.) land the user on the right chip
  // without them having to hunt for it.  Only sets when the param is a
  // known category so a stale/malformed URL falls back to the default.
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat && DEFAULT_CATEGORIES.includes(cat)) setCategory(cat);
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
    // 2026-06-27 — Library-mode hard filter.  Switching the inline
    // mode pill (Mixed / Fanfic / Original) must ACTUALLY hide
    // books from the other world, not just relabel the layout.
    // Earlier this was a layout-only concern (mixed mode split into
    // two sections) and Original/Fanfic modes inherited whatever
    // category chip happened to be selected — which let fanfics
    // leak into Original view if the user was on the "All" chip.
    //
    // Semantics:
    //   • fanfic   — keep only books whose category is "Fanfiction"
    //                (case-insensitive)
    //   • original — drop books whose category is "Fanfiction".
    //                Original Fiction, Non-fiction, Unclassified,
    //                and any custom user category all stay visible.
    //   • mixed    — no extra filter; the section split below
    //                handles the visual divide.
    //
    // Applied AFTER the chip filters above so users can still ask
    // for "Original mode + Unread + This week" and get the right
    // intersection.
    const lm = user?.library_mode || "mixed";
    if (lm === "fanfic") {
      pool = pool.filter((b) => (b.category || "").toLowerCase() === "fanfiction");
    } else if (lm === "original") {
      pool = pool.filter((b) => (b.category || "").toLowerCase() !== "fanfiction");
    }

    // 2026-06-27 — Verdict filter (private "Verdicts" axis).
    // Two independent dimensions, both applied as AND:
    //   • chipFilters.verdict      — one specific verdict key,
    //                                "favorite" / "least_favorite" /
    //                                "never_again" / "reread_material"
    //                                / "recommend" / custom_*.
    //                                "all" = no filter,
    //                                "any" = at least one verdict set,
    //                                "none" = no verdicts.
    //   • chipFilters.readingState — single-select reading state.
    //                                "all" = no filter,
    //                                "unset" = books with no state set.
    if (chipFilters.verdict !== "all") {
      if (chipFilters.verdict === "any") {
        pool = pool.filter((b) => (b.verdicts || []).length > 0);
      } else if (chipFilters.verdict === "none") {
        pool = pool.filter((b) => (b.verdicts || []).length === 0);
      } else {
        pool = pool.filter((b) => (b.verdicts || []).includes(chipFilters.verdict));
      }
    }
    if (chipFilters.readingState !== "all") {
      if (chipFilters.readingState === "unset") {
        pool = pool.filter((b) => !b.reading_state);
      } else {
        pool = pool.filter((b) => b.reading_state === chipFilters.readingState);
      }
    }
    // Iter 92 — Global sort (applies to list, grid, and compact views).
    if (sortMode.col) {
      const dir = sortMode.dir === "desc" ? -1 : 1;
      const strKey = (v) => (v == null ? "" : String(v)).toLowerCase();
      const numKey = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : 0;
      const timeKey = (raw) => {
        if (!raw) return 0;
        const t = new Date(raw).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      const pick = (b) => {
        switch (sortMode.col) {
          case "title":     return strKey(b.title);
          case "author":    return strKey(b.author);
          case "fandom":    return strKey(b.fandom);
          case "pairings":  return strKey(Array.isArray(b.pairings) ? b.pairings.join(",") : b.pairings);
          case "wordcount": return numKey(b.word_count);
          case "size":      return numKey(b.size_bytes);
          case "status":    return numKey(b.progress_fraction);
          case "added":     return timeKey(b.created_at || b.date_added);
          default:          return 0;
        }
      };
      pool = [...pool].sort((a, b) => {
        const va = pick(a), vb = pick(b);
        if (va < vb) return -dir;
        if (va > vb) return dir;
        return 0;
      });
    }
    return pool;
  }, [books, justAddedIds, chipFilters, user?.library_mode, sortMode]);

  // 2026-06-27 Phase 2 — Mixed-mode visual section split.
  // When library_mode is "mixed", group visibleBooks into two
  // sections (Fanfic / Original & Non-fic) so the user can see
  // each world distinctly without losing the unified library.
  // For "fanfic" / "original" modes a single "section" carries
  // the whole list — the rest of the render code below doesn't
  // need to branch on mode at all.  Category match is case-
  // insensitive against the categories defined at the top of
  // this file (DEFAULT_CATEGORIES).
  //
  // Placement note: this useMemo MUST sit AFTER the visibleBooks
  // declaration above.  An earlier revision placed it before, which
  // landed `visibleBooks` in the dependency array's Temporal Dead
  // Zone and crashed AllBooksPage with "Cannot access 'visibleBooks'
  // before initialization" the moment React evaluated the deps on
  // first render.  Production redeploy 2026-06-27 surfaced this as
  // a blank /library/all screen.
  const bookSections = useMemo(() => {
    if (!isMixedMode) return [{ key: "all", label: null, books: visibleBooks }];
    const fanfic = [];
    const other = [];
    for (const b of visibleBooks) {
      const cat = (b.category || "").toLowerCase();
      if (cat === "fanfiction") fanfic.push(b);
      else other.push(b);
    }
    const built = {
      fanfic:   fanfic.length ? { key: "fanfic",   label: "💜 Fanfic",            books: fanfic } : null,
      original: other.length  ? { key: "original", label: "📖 Original & Non-fic", books: other  } : null,
    };
    // Iter 93 — respect the user's saved section order.
    const seen = new Set();
    const out = [];
    for (const key of sectionOrder) {
      if (built[key] && !seen.has(key)) { out.push(built[key]); seen.add(key); }
    }
    for (const key of Object.keys(built)) {
      if (built[key] && !seen.has(key)) { out.push(built[key]); seen.add(key); }
    }
    if (out.length === 0) return [{ key: "all", label: null, books: [] }];
    return out;
  }, [isMixedMode, visibleBooks, sectionOrder]);

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
          className="inline-flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowRight className="w-4 h-4 rotate-180" /> Back to your library
        </Link>
        <FriendRequestBanner />
        <PendingPolishBanner onPolished={load} />
        <FailedUploadsList
          compact
          days={7}
          onReupload={(files) => {
            // Fire a global event the on-page UploadZone listens for.
            // Avoids prop-drilling or imperative refs through nested
            // sidebars.  See `UploadZone.jsx` useEffect that wires
            // window.addEventListener("shelfsort:upload-files", ...).
            window.dispatchEvent(new CustomEvent("shelfsort:upload-files", { detail: files }));
          }}
        />
        {/* SkippedFilesPanel — renders only when the last upload batch
            actually skipped files.  Otherwise it self-hides. */}
        <SkippedFilesPanel items={[]} onDismiss={() => {}} onDismissAll={() => {}} onReadd={() => {}} onDownloadCsv={() => {}} />
        <OneTimeTip tipKey="characters-and-rationale-2026-06-27">
          two new things to play with — your library now has a{" "}
          <a href="/library/characters" className="underline underline-offset-2 hover:text-[#6B46C1]">Characters browser</a>{" "}
          (every character across your fandoms, sorted by book count), and hovering any book&rsquo;s category badge now shows{" "}
          <strong>why Claude picked that fandom</strong>.
          Each book card also has a tiny ✨ button — click it to re-sort a book if the AI got it wrong.
        </OneTimeTip>
        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            All books
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]">
            {stats.total > 0 ? `Browse your ${stats.total} book${stats.total > 1 ? "s" : ""}` : "No books yet — add some on the dashboard."}
          </h1>
          {/* 2026-07-09 — Inline mini drop-zone for the empty state so
              users don't have to bounce back to /library to add books.
              Uses UploadZone's built-in `compact` mode (~half the
              dashboard height, same drop/pick handlers).  `onUploaded`
              calls the page's existing `load` callback so the new
              books, stats, and category counts refresh in-place — no
              hard refresh, no scroll jump.
              2026-07-10 — Loosened the condition from `stats.total ===
              0` (strict) to `!stats.total` (falsy).  The stats
              endpoint returns objects where `total` can be undefined
              on some accounts; strict equality skipped the zone even
              when the heading was showing "No books yet".  Matches
              the heading's `stats.total > 0` ternary semantics
              exactly. */}
          {!stats.total && (
            <div className="mt-6" data-testid="empty-library-upload-zone">
              <UploadZone
                compact
                onUploaded={() => load()}
              />
            </div>
          )}
          {stats.fandoms.length > 0 && (
            <p className="text-[#5B5F4D] mt-2">
              {stats.fandoms.slice(0, 4).map(f => `${f.name} (${f.count})`).join(" · ")}
            </p>
          )}
          {/* 2026-06-27 — Library-mode pill cluster.  Mirrors the
              /account preference but lets users switch on the fly
              without leaving the library page.  Writes back via the
              same PATCH endpoint and refreshes AuthContext so the
              category default + layout flip immediately. */}
          {stats.total > 0 && (
            <div
              className="inline-flex items-center gap-1 mt-3 p-1 rounded-full border border-[#E8E6E1] bg-white text-xs"
              data-testid="library-mode-pills"
            >
              <span className="px-2 text-[10px] uppercase tracking-wider text-[#6E6E6E] font-semibold">Mode:</span>
              {[
                { value: "mixed",    label: "📚 Mixed"     },
                { value: "fanfic",   label: "💜 Fanfic"    },
                { value: "original", label: "📖 Original"  },
              ].map((opt) => {
                const active = libraryMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={async () => {
                      if (active) return;
                      try {
                        await api.patch("/auth/library-mode", { mode: opt.value });
                        if (typeof refreshAuth === "function") await refreshAuth();
                        toast.success(`Library mode: ${opt.label.replace(/^[^\w]+/, "").trim()}`);
                      } catch (e) {
                        toast.error("Couldn't change library mode");
                      }
                    }}
                    aria-pressed={active}
                    data-testid={`library-mode-pill-${opt.value}`}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      active
                        ? "bg-[#6B46C1] text-white"
                        : "text-[#5B5F4D] hover:bg-[#F5F3EC]"
                    }`}
                    title={
                      opt.value === "fanfic"   ? "Fandom-first navigation, AO3 chrome visible" :
                      opt.value === "original" ? "Author-first, fanfic chrome hidden" :
                                                 "Both worlds, separate sections on the same page"
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
          {trashCount > 0 && (
            <Link
              to="/library/trash"
              data-testid="trash-chip"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-medium border border-[#6B705C]/30 bg-white text-[#5B5F4D] hover:bg-[#6B705C]/10 transition-colors"
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
            className="mb-10 shelf-card p-6 md:p-8 bg-[#FDF3E1] border-[#B87A00]/20"
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
                      <div className="text-xs text-[#5B5F4D] italic px-3 py-2 rounded border border-dashed border-[#B87A00]/30 bg-white/40">
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
                className="px-2 py-1.5 rounded text-sm text-[#5B5F4D] hover:text-[#2C2C2C]"
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
            className="mb-8 shelf-card p-5 flex flex-wrap items-center justify-between gap-4 bg-[#FDF3E1] border-[#E07A5F]/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
                  {unclassifiedCount} book{unclassifiedCount === 1 ? "" : "s"} still need{unclassifiedCount === 1 ? "s" : ""} a shelf
                </p>
                <p className="text-sm text-[#5B5F4D] mt-1">
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
            className="mb-8 shelf-card p-5 flex flex-wrap items-center justify-between gap-4 bg-[#EDE7FB] border-[#6B46C1]/30"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
                  {refreshStatus.refreshable} book{refreshStatus.refreshable === 1 ? "" : "s"} can be updated from FanFicFare
                </p>
                <p className="text-sm text-[#5B5F4D] mt-1">
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
            <p className="text-[#5B5F4D]">Drop a few EPUBs above to start sorting your library.</p>
            <div className="mt-6 flex justify-center">
            {FETCHING_UI_ENABLED && <PoweredByFanFicFare />}
            </div>
            {/* Suggestion-box discoverability chip (Task 8) — first-
                time users land here with an empty shelf; nudge them
                toward the inbound flywheel right at the moment they
                might wish Shelfsort did one more thing.
                2026-06-29: upgraded from static link to the
                SuggestionChip modal so the user never leaves the
                empty-state to capture an idea. */}
            <div className="mt-6">
              <SuggestionChip testid="empty-library-suggest-chip" />
            </div>
          </div>
        ) : (
          <>
            {/* 2026-06-27 — The search/Select/View-mode toolbar used
                to sit here, above the filter chips.  Moved it down
                to just above the book list so it's:
                  (a) Adjacent to the content it actually controls
                  (b) On-screen when the user is staring at books
                  (c) Still present, just lower in the visual hierarchy
                See ``listToolbar`` JSX block below — it's rendered
                directly before the table/grid for that exact reason. */}
            {/* Composable filter chips (iter 61) — Length × Status ×
                Date Added.  Three rows; pick one chip per row; AND-
                combine.  Hidden if the user has zero books. */}
            {books.length > 0 && (
              <div
                className="mb-4 p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E6E1] flex flex-col gap-2 text-sm"
                data-testid="library-chip-filters"
              >
                {/* 2026-06-27 — Collapsible header.  The chip stack
                    used to occupy 4 always-visible rows above the
                    book list; collapsed by default it's a single
                    18px-tall summary, opens on click.  Defaults
                    OPEN when any filter is active (so the user can
                    see WHY their list is filtered) and CLOSED when
                    everything is at "All" / "Any time".  Explicit
                    user toggles are persisted in localStorage so a
                    power-user who wants the chips always-open stays
                    that way across sessions. */}
                <button
                  type="button"
                  onClick={() => setChipsExpanded((v) => !v)}
                  aria-expanded={chipsExpanded}
                  aria-controls="library-chip-rows"
                  className="flex items-center gap-2 text-left -mx-1 px-1 py-0.5 rounded hover:bg-[#F0EAD9] transition-colors"
                  data-testid="library-chip-toggle"
                >
                  <span className="text-xs font-semibold text-[#5B5F4D]">🎛️ Filters</span>
                  {chipFiltersActive ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#6B46C1] text-white"
                      data-testid="library-chip-active-count"
                    >
                      {[
                        chipFilters.length !== "all",
                        chipFilters.status !== "all",
                        chipFilters.dateAdded !== "any",
                        chipFilters.series !== "all",
                      ].filter(Boolean).length} active
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#6E6E6E]">None active</span>
                  )}
                  <span
                    className={`ml-auto text-[#5B5F4D] text-xs transition-transform ${chipsExpanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >▼</span>
                </button>
                {chipsExpanded && (
                <div id="library-chip-rows" className="flex flex-col gap-2">
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
                  // 2026-06-27 — Verdict chip row.  "Any" / "None" are
                  // meta-filters that don't tie to a specific verdict
                  // key (useful for "show me everything I've marked"
                  // or "show me the unmarked backlog").  The named
                  // chips are populated from the live taxonomy so
                  // adding a built-in or custom verdict surfaces
                  // here for filtering automatically.
                  {
                    dim: "verdict",
                    label: "🏷️ Verdict",
                    options: [
                      { value: "all",  label: "All" },
                      { value: "any",  label: "Any verdict" },
                      { value: "none", label: "Unmarked" },
                      ...((verdictTax?.builtin_verdicts || []).map((v) => ({
                        value: v.key,
                        label: `${v.emoji} ${v.label}`,
                      }))),
                      ...((verdictTax?.custom_verdicts || []).map((v) => ({
                        value: v.key,
                        label: `${v.emoji} ${v.label}`,
                      }))),
                    ],
                  },
                  // 2026-06-27 — Reading-state chip row.  Single-select
                  // mutually-exclusive position in the reader's queue.
                  // "Unset" filters to books with no state declared
                  // yet — i.e. the "I haven't decided" backlog.
                  {
                    dim: "readingState",
                    label: "📚 State",
                    options: [
                      { value: "all",   label: "All" },
                      { value: "unset", label: "Unset" },
                      ...((verdictTax?.reading_states || []).map((s) => ({
                        value: s.key,
                        label: `${s.emoji} ${s.label}`,
                      }))),
                    ],
                  },
                ].map((row) => (
                  <div key={row.dim} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#5B5F4D] w-20 shrink-0">{row.label}</span>
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
                              : "bg-white text-[#5B5F4D] border-[#E8E6E1] hover:bg-[#F5F3EC]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
                </div>
                )}
                {chipFiltersActive && (
                  <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
                    <span className="text-xs text-[#6E6E6E]" data-testid="library-chip-filter-count">
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
                      : "bg-white border-[#6B705C]/30 text-[#5B5F4D] hover:bg-[#6B705C]/10"
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
                    className="text-[#5B5F4D] hover:text-[#2C2C2C] text-sm"
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
                  <p className="text-xs text-[#5B5F4D] hidden sm:block">
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
                    Fandom shelves <span className="text-[#5B5F4D] font-normal lowercase tracking-normal ml-1">({stats.fandoms.length})</span>
                  </p>
                  <p className="text-xs text-[#5B5F4D] hidden sm:block">
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
                <button
                  onClick={() => navigate("/library/characters")}
                  data-testid="dashboard-characters-chip"
                  className="mb-3 mr-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1]/10 text-[#6B46C1] border border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                  title="Browse every character mentioned in your library's pairings"
                >
                  Browse characters
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
                        <Search className="w-6 h-6 text-[#5B5F4D] mx-auto mb-1.5" aria-hidden="true" />
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
                  <p className="text-xs text-[#5B5F4D] hidden sm:block">
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

            {/* 2026-06-27 — Search / Select / View-mode toolbar.
                Moved DOWN here from above the chips so it sits
                directly adjacent to the book list/table it actually
                drives.  Users who've scrolled past the chip stack
                still have search + view-mode controls within thumb
                reach when they're actually looking at books. */}
            <div className="flex flex-wrap items-center gap-3 mb-6" data-testid="library-toolbar">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
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
              {selectMode && (
                <>
                  <button
                    data-testid="select-all-visible"
                    type="button"
                    onClick={() => {
                      const allIds = visibleBooks.map((b) => b.book_id);
                      const already = allIds.every((id) => selectedIds.has(id));
                      if (already && allIds.length > 0) {
                        // All in view already picked — treat second click as "deselect these"
                        const next = new Set(selectedIds);
                        allIds.forEach((id) => next.delete(id));
                        setSelectedIds(next);
                      } else {
                        const next = new Set(selectedIds);
                        allIds.forEach((id) => next.add(id));
                        setSelectedIds(next);
                      }
                    }}
                    title={`Add every book that matches the current filters (${visibleBooks.length}) to the selection`}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-[#6B46C1] bg-white text-[#6B46C1] hover:bg-[#EEE9FB] transition-colors"
                  >
                    <CheckSquare className="w-4 h-4" />
                    Select all {visibleBooks.length}
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      data-testid="clear-selection"
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      title="Clear the current selection"
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-[#E8E6E1] bg-white text-[#5B5F4D] hover:bg-[#F5F3EC] transition-colors"
                    >
                      Clear ({selectedIds.size})
                    </button>
                  )}
                </>
              )}
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

            {fulltextMode && (
              <div className="mb-6" data-testid="fulltext-results-panel">
                {fulltextLoading && (
                  <p className="text-[#5B5F4D] py-4 text-center text-sm">Searching inside books…</p>
                )}
                {!fulltextLoading && fulltextResults && search.trim().length >= 2 && (
                  <>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-3">
                      Inside-book matches ({fulltextResults.count})
                    </p>
                    {fulltextResults.results.length === 0 ? (
                      <p className="text-sm text-[#5B5F4D] py-6 text-center" data-testid="fulltext-empty">
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
                              <span className="truncate">{r.title || "Untitled"} <span className="text-[#5B5F4D] font-normal">— {r.author || "Unknown"}</span></span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex-shrink-0">
                                score {r.score}
                              </span>
                            </Link>
                            {r.snippet && (
                              <p className="mt-1.5 text-xs text-[#5B5F4D] italic leading-relaxed">
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
                  <p className="text-sm text-[#5B5F4D] py-4 text-center" data-testid="fulltext-empty-prompt">
                    Type at least 2 characters to search inside your books.
                  </p>
                )}
              </div>
            )}
            {loading ? (
              <p className="text-[#5B5F4D] py-12 text-center">Loading…</p>
            ) : books.length === 0 ? (
              <p className="text-[#5B5F4D] py-12 text-center">No books match these filters.</p>
            ) : (
              <>
                {sortMode.col && viewMode !== "list" && (
                  <div className="mb-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F3EEFC] border border-[#D9CCF5] text-[11px] text-[#4C2A99]" data-testid="sort-indicator-chip">
                    <span>
                      Sorted by <strong>{SORT_COL_LABELS[sortMode.col] || sortMode.col}</strong> {sortMode.dir === "desc" ? "↓" : "↑"}
                    </span>
                    <button type="button" onClick={clearSort} className="underline hover:text-[#2C2C2C]" data-testid="sort-indicator-clear">clear</button>
                  </div>
                )}
                {viewMode === "list" ? (
              // List view (enhanced iter 60) — table-style rows with
              // full metadata.  Responsive columns: pairings/wordcount/
              // date hide on narrow screens so mobile stays tidy.
              <div className="bg-white rounded-xl border border-[#E8E6E1] overflow-hidden" data-testid="books-list">
                {/* 2026-06-27 — Row-density toggle.  Only appears in
                    list mode (Grid + Compact have their own implicit
                    densities via card sizes).  Compact for dense
                    scanning, Comfortable as default, Cozy for users
                    who want more breathing room per row. */}
                <div className="flex items-center justify-end gap-1 px-3 py-1.5 bg-[#FAF6EE] border-b border-[#E8E6E1] text-[10px] uppercase tracking-wider text-[#6E6E6E]" data-testid="list-density-toggle">
                  <span className="mr-1">Density:</span>
                  {[
                    { value: "compact",     label: "Compact" },
                    { value: "comfortable", label: "Comfortable" },
                    { value: "cozy",        label: "Cozy" },
                  ].map((opt) => {
                    const active = listDensity === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setListDensity(opt.value)}
                        aria-pressed={active}
                        data-testid={`list-density-${opt.value}`}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                          active
                            ? "bg-[#6B46C1] text-white"
                            : "text-[#5B5F4D] hover:bg-white"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {/* Iter 92-93 — Column headers are sortable + resizable
                    + reorderable (dnd-kit).  Grip = drag column, label =
                    cycle sort, thin handle at right edge = resize.  All
                    state persists to localStorage. */}
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
                  <div className="hidden md:flex items-stretch gap-3 px-4 py-2 bg-[#FAF6EE] border-b border-[#E8E6E1] text-[10px] uppercase tracking-wider font-semibold text-[#6E6E6E]" data-testid="list-header-row">
                    <span
                      className="w-10 shrink-0 text-right pr-1 tabular-nums text-[#8B7AB8]"
                      data-testid="list-header-row-number"
                      title="Row number in current sort order"
                    >
                      #
                    </span>
                    <span className="w-8 shrink-0" aria-hidden />
                    <span className="relative flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => cycleSort("title")}
                        className={`inline-flex items-center uppercase tracking-wider font-semibold hover:text-[#2C2C2C] transition-colors ${sortMode.col === "title" ? "text-[#2C2C2C]" : "text-[#6E6E6E]"}`}
                        data-testid="list-header-btn-title"
                      >
                        Title / Author
                        {sortMode.col === "title" && (
                          <span className="ml-1 text-[#6B46C1]">{sortMode.dir === "desc" ? "▼" : "▲"}</span>
                        )}
                      </button>
                    </span>
                    <SortableContext items={activeColOrder} strategy={horizontalListSortingStrategy}>
                      {activeColOrder.map((colKey) => (
                        <SortableHeaderCell
                          key={colKey}
                          colKey={colKey}
                          width={colWidths[colKey] ?? DEFAULT_COL_WIDTHS[colKey]}
                          sortMode={sortMode}
                          cycleSort={cycleSort}
                          startColResize={startColResize}
                        />
                      ))}
                    </SortableContext>
                    <div className="relative shrink-0 flex items-center gap-1" ref={colMenuRef}>
                      {jumpInputOpen ? (
                        <div className="flex items-center gap-1 normal-case tracking-normal" data-testid="jump-to-row-input-wrap">
                          <span className="text-[10px] text-[#5B5F4D] uppercase tracking-wider">Go to row</span>
                          <input
                            ref={jumpInputRef}
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={jumpValue}
                            onChange={(e) => setJumpValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); executeJumpToRow(); }
                              else if (e.key === "Escape") { e.preventDefault(); setJumpInputOpen(false); }
                            }}
                            onBlur={() => { if (!jumpValue) setJumpInputOpen(false); }}
                            data-testid="jump-to-row-input"
                            placeholder="#"
                            className="w-14 h-6 px-1.5 text-xs font-mono tabular-nums border border-[#D9CCF5] rounded focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/40"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={openJumpInput}
                          className="px-1.5 h-6 rounded text-[10px] font-mono text-[#8B7AB8] hover:bg-white/60 hover:text-[#4C2A99] transition-colors border border-transparent hover:border-[#D9CCF5]"
                          data-testid="jump-to-row-btn"
                          aria-label="Jump to row number"
                          title="Jump to row (press G)"
                        >
                          → #
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setColMenuOpen((o) => !o)}
                        className="p-1 rounded text-[#5B5F4D] hover:bg-white/60 hover:text-[#2C2C2C] transition-colors"
                        aria-label="Show or hide columns"
                        aria-expanded={colMenuOpen}
                        data-testid="list-cols-menu-btn"
                        title="Show or hide columns"
                      >
                        <Columns3 className="w-3.5 h-3.5" />
                      </button>
                      {colMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-md border border-[#E4D9C8] bg-white shadow-lg py-1 normal-case tracking-normal font-normal" data-testid="list-cols-menu">
                          <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[#6E6E6E] font-semibold">Layout presets</p>
                          <div className="px-2 pb-1 flex flex-wrap gap-1 items-center" data-testid="list-cols-preset-row">
                            {Object.entries(effectivePresets).map(([key, preset]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => applyLayoutPreset(key)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setPresetEditor({ key, x: e.clientX, y: e.clientY, mode: "edit", isCustom: !!preset._custom });
                                }}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-colors flex items-center gap-1 ${
                                  preset._custom
                                    ? "border-[#D9CCF5] bg-[#F5F0FB] text-[#4C2A99] hover:bg-[#EEE9FB] hover:border-[#6B46C1]"
                                    : "border-[#E4D9C8] bg-[#FAF6EE] text-[#5B5F4D] hover:bg-[#EEE9FB] hover:text-[#4C2A99] hover:border-[#D9CCF5]"
                                }`}
                                data-testid={`list-cols-preset-${key}`}
                                data-custom={preset._custom ? "true" : "false"}
                                title={`Apply "${preset.label}" layout · right-click to ${preset._custom ? "rename or delete" : "rename/overwrite"}`}
                              >
                                {preset._custom && <span className="w-1.5 h-1.5 rounded-full bg-[#6B46C1] inline-block" aria-hidden />}
                                {preset.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={(e) => setPresetEditor({ key: null, x: e.clientX, y: e.clientY + 20, mode: "create", isCustom: true })}
                              className="px-2 py-0.5 text-[10px] rounded border border-dashed border-[#D9CCF5] bg-white text-[#6B46C1] hover:bg-[#F5F0FB] hover:border-[#6B46C1] transition-colors"
                              data-testid="list-cols-preset-add"
                              title="Save your current column layout as a new preset chip"
                              aria-label="Add custom preset"
                            >
                              + New
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPasteText(""); setPasteError(""); setPasteModalOpen(true); }}
                              className="px-2 py-0.5 text-[10px] rounded border border-dashed border-[#D9CCF5] bg-white text-[#6B46C1] hover:bg-[#F5F0FB] hover:border-[#6B46C1] transition-colors"
                              data-testid="list-cols-preset-paste"
                              title="Paste a preset JSON shared from another device"
                              aria-label="Paste preset JSON"
                            >
                              Paste
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={applyEssentials}
                            className={`w-full text-left px-3 py-1 text-xs border-t border-b border-[#E8E6E1] transition-colors ${
                              essentialsActive
                                ? "bg-[#EEE9FB] text-[#4C2A99] font-semibold hover:bg-[#E4D9F8]"
                                : "text-[#2C2C2C] hover:bg-[#F5F3EC]"
                            }`}
                            data-testid="list-cols-essentials-toggle"
                            aria-pressed={essentialsActive}
                            title={essentialsActive ? "Show all columns again" : "Hide Pairings + Time·Words for a compact laptop view"}
                          >
                            {essentialsActive ? "✓ Just the essentials (on)" : "Just the essentials"}
                          </button>
                          <p className="px-3 pt-1 text-[10px] uppercase tracking-wider text-[#6E6E6E] font-semibold">Columns</p>
                          {REORDERABLE_COL_KEYS.map((k) => (
                            <label
                              key={k}
                              className="flex items-center gap-2 px-3 py-1 text-xs text-[#2C2C2C] hover:bg-[#F5F3EC] cursor-pointer"
                              data-testid={`list-cols-menu-item-${k}`}
                            >
                              <input
                                type="checkbox"
                                checked={!!visibleCols[k]}
                                onChange={() => toggleColVisibility(k)}
                                className="accent-[#6B46C1]"
                                data-testid={`list-cols-menu-check-${k}`}
                              />
                              <span>{LIST_COL_META[k].label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </DndContext>
                {presetEditor && (
                  <div
                    ref={presetEditorRef}
                    className="fixed z-50 min-w-[240px] rounded-md border border-[#E4D9C8] bg-white shadow-xl p-3"
                    style={{ left: Math.min(presetEditor.x, window.innerWidth - 260), top: Math.min(presetEditor.y, window.innerHeight - 220) }}
                    data-testid="list-cols-preset-editor"
                    data-mode={presetEditor.mode || "edit"}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-[#6E6E6E] font-semibold mb-1.5">
                      {presetEditor.mode === "create"
                        ? "Save current layout as a new preset"
                        : `Edit preset — ${effectivePresets[presetEditor.key]?.label}`}
                    </p>
                    <input
                      type="text"
                      defaultValue={presetEditor.mode === "create" ? "" : (effectivePresets[presetEditor.key]?.label || "")}
                      maxLength={40}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (presetEditor.mode === "create") {
                            saveNewCustomPreset(e.currentTarget.value);
                          } else if (presetEditor.isCustom) {
                            renameCustomPreset(presetEditor.key, e.currentTarget.value);
                          } else {
                            renamePreset(presetEditor.key, e.currentTarget.value);
                          }
                          setPresetEditor(null);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setPresetEditor(null);
                        }
                      }}
                      data-testid="list-cols-preset-rename-input"
                      className="w-full px-2 py-1 text-xs border border-[#E4D9C8] rounded focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/40 mb-2"
                      placeholder={presetEditor.mode === "create" ? "e.g. My audit view" : "New name…"}
                    />
                    <div className="flex flex-col gap-1">
                      {presetEditor.mode !== "create" && (
                        <button
                          type="button"
                          onClick={() => {
                            if (presetEditor.isCustom) overwriteCustomPresetWithCurrent(presetEditor.key);
                            else overwritePresetWithCurrent(presetEditor.key);
                            setPresetEditor(null);
                          }}
                          className="text-left px-2 py-1 text-xs rounded text-[#2C2C2C] hover:bg-[#F5F3EC]"
                          data-testid="list-cols-preset-overwrite"
                        >
                          Overwrite with my current layout
                        </button>
                      )}
                      {presetEditor.mode !== "create" && !presetEditor.isCustom && (
                        <button
                          type="button"
                          onClick={() => { resetPreset(presetEditor.key); setPresetEditor(null); }}
                          className="text-left px-2 py-1 text-xs rounded text-[#A03D33] hover:bg-[#F5EAE9]"
                          data-testid="list-cols-preset-reset"
                        >
                          Reset to default
                        </button>
                      )}
                      {presetEditor.mode !== "create" && (
                        <button
                          type="button"
                          onClick={async () => {
                            const preset = effectivePresets[presetEditor.key];
                            if (!preset) return;
                            setPresetEditor(null);
                            const description = window.prompt(
                              `Publishing "${preset.label}" to the Preset Marketplace.\n\nAdd a short description (optional):`,
                              "",
                            );
                            if (description === null) return; // user cancelled
                            try {
                              await api.post("/presets/marketplace", {
                                name: preset.label,
                                description: description.trim(),
                                preset: { label: preset.label, visible: preset.visible, order: preset.order },
                              });
                              const { toast } = await import("sonner");
                              toast.success(`"${preset.label}" published — visit the marketplace to see it live.`);
                            } catch (e) {
                              const { toast } = await import("sonner");
                              toast.error(e?.response?.data?.detail || "Publish failed");
                            }
                          }}
                          className="text-left px-2 py-1 text-xs rounded text-[#4C2A99] hover:bg-[#F5F0FB]"
                          data-testid="list-cols-preset-publish"
                        >
                          Publish to marketplace…
                        </button>
                      )}
                      {presetEditor.mode !== "create" && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyPresetToClipboard(presetEditor.key);
                            setPresetEditor(null);
                            try {
                              const { toast } = await import("sonner");
                              toast[ok ? "success" : "error"](ok ? "Preset copied to clipboard" : "Couldn't copy — check clipboard permissions");
                            } catch { /* toast optional */ }
                          }}
                          className="text-left px-2 py-1 text-xs rounded text-[#2C2C2C] hover:bg-[#F5F3EC]"
                          data-testid="list-cols-preset-copy"
                        >
                          Copy JSON to share
                        </button>
                      )}
                      {presetEditor.mode !== "create" && presetEditor.isCustom && (
                        <button
                          type="button"
                          onClick={() => { deleteCustomPreset(presetEditor.key); setPresetEditor(null); }}
                          className="text-left px-2 py-1 text-xs rounded text-[#A03D33] hover:bg-[#F5EAE9]"
                          data-testid="list-cols-preset-delete"
                        >
                          Delete preset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPresetEditor(null)}
                        className="text-left px-2 py-1 text-xs rounded text-[#5B5F4D] hover:bg-[#F5F3EC]"
                        data-testid="list-cols-preset-editor-cancel"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-[#6E6E6E] italic">
                      {presetEditor.mode === "create" ? "Enter to save. Your current visible columns + order are captured." : "Enter to save the new name."}
                    </p>
                  </div>
                )}
                {pasteModalOpen && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    data-testid="list-cols-preset-paste-modal"
                    onClick={(e) => { if (e.target === e.currentTarget) setPasteModalOpen(false); }}
                  >
                    <div className="w-full max-w-md rounded-lg border border-[#E4D9C8] bg-white shadow-2xl p-5">
                      <h3 className="font-serif text-lg text-[#2C2C2C] mb-1">Paste a shared preset</h3>
                      <p className="text-xs text-[#5B5F4D] mb-3">
                        Paste the JSON blob you copied from another Shelfsort device. It&rsquo;ll appear as a new custom chip.
                      </p>
                      <textarea
                        value={pasteText}
                        onChange={(e) => { setPasteText(e.target.value); setPasteError(""); }}
                        autoFocus
                        rows={5}
                        placeholder='{"shelfsort_preset_v1": {"label": "…", "visible": {…}, "order": [ … ]}}'
                        className="w-full px-2 py-1.5 text-[11px] font-mono border border-[#E4D9C8] rounded focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/40"
                        data-testid="list-cols-preset-paste-input"
                      />
                      {pasteError && (
                        <p className="mt-1 text-[11px] text-[#A03D33]" data-testid="list-cols-preset-paste-error">{pasteError}</p>
                      )}
                      <div className="flex items-center justify-end gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => setPasteModalOpen(false)}
                          className="px-4 py-1.5 rounded-full border border-[#E4D9C8] text-xs font-semibold text-[#5B5F4D] hover:bg-[#F5F3EC] transition-colors"
                          data-testid="list-cols-preset-paste-cancel"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ok = importPresetFromJson(pasteText);
                            if (ok) setPasteModalOpen(false);
                          }}
                          disabled={!pasteText.trim()}
                          className="px-4 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#4C2A99] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          data-testid="list-cols-preset-paste-import"
                        >
                          Import preset
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {sortMode.col && (
                  <div className="hidden md:flex items-center justify-end gap-2 px-4 py-1 text-[10px] uppercase tracking-wider text-[#6B46C1] bg-[#F3EEFC] border-b border-[#E8E6E1]" data-testid="list-sort-indicator">
                    <span>
                      Sorted by <strong>{SORT_COL_LABELS[sortMode.col] || sortMode.col}</strong> {sortMode.dir === "desc" ? "↓" : "↑"}
                    </span>
                    <button type="button" onClick={clearSort} className="underline hover:text-[#4C2A99]" data-testid="list-sort-clear">clear</button>
                    <span aria-hidden className="text-[#B8B2A3]">·</span>
                    <button type="button" onClick={resetColWidths} className="underline hover:text-[#4C2A99]" data-testid="list-cols-reset">reset widths</button>
                  </div>
                )}
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                  <SortableContext items={bookSections.map((s) => s.key)} strategy={verticalListSortingStrategy}>
                    <ul className="divide-y divide-[#E8E6E1]" data-testid="list-sections">
                      {bookSections.map((sec, secIdx) => {
                        const rowNumberOffset = bookSections
                          .slice(0, secIdx)
                          .reduce((sum, s) => sum + s.books.length, 0);
                        return (
                        <React.Fragment key={sec.key}>
                          {sec.label && (
                            <SortableSectionHeader
                              sec={sec}
                              collapsed={!!collapsedSections[sec.key]}
                              toggleSection={toggleSection}
                            />
                          )}
                          {!collapsedSections[sec.key] && sec.books.map((b, bIdx) => {
                            const rowNumber = rowNumberOffset + bIdx + 1;
                            const wordsK = b.word_count ? (b.word_count >= 1000 ? `${Math.round(b.word_count / 1000)}k` : String(b.word_count)) : "";
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
                            const ctx = { wordsK, timeLabel, addedRel, pairings };
                            return (
                              <li
                                key={b.book_id}
                                data-testid={`book-row-${b.book_id}`}
                                className={`flex items-center gap-3 px-4 ${listRowPadding} hover:bg-[#F5F3EC] transition-colors cursor-pointer ${
                                  selectMode && selectedIds.has(b.book_id) ? "bg-[#EEE9FB]" : ""
                                } ${jumpFlashId === b.book_id ? "ring-2 ring-[#6B46C1] ring-inset bg-[#F3EEFC]" : ""}`}
                                onClick={() => {
                                  if (selectMode) {
                                    setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(b.book_id)) next.delete(b.book_id); else next.add(b.book_id);
                                      return next;
                                    });
                                  } else {
                                    window.location.href = `/book/${b.book_id}`;
                                  }
                                }}
                              >
                                {/* 2026-08-14 — Row number column.  Sticky
                                    leftmost.  Reflects the current sort/filter
                                    order across all sections (global 1..N).
                                    Hidden on narrow screens (< md) so mobile
                                    stays tidy. */}
                                <span
                                  className="hidden md:inline-block w-10 shrink-0 text-right pr-1 text-xs font-mono tabular-nums text-[#8B7AB8] select-none"
                                  data-testid={`book-row-number-${b.book_id}`}
                                  aria-label={`Row ${rowNumber}`}
                                >
                                  {rowNumber}
                                </span>
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
                                      <span className="ml-1.5 text-[10px] text-[#5B5F4D] font-normal">· {b.series}{b.series_index ? ` #${b.series_index}` : ""}</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-[#5B5F4D] truncate">
                                    {b.author || "Unknown"}
                                  </p>
                                </div>
                                {activeColOrder.map((colKey) => renderBodyCell(colKey, b, ctx))}
                              </li>
                            );
                          })}
                        </React.Fragment>
                        );
                      })}
                    </ul>
                  </SortableContext>
                </DndContext>
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
                        window.location.href = `/book/${b.book_id}`;
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
                          <span className="text-[8px] text-white text-center line-clamp-3 leading-tight font-serif"> {/* fontsize-ok — fallback title overlay in a 60px-wide thumbnail tile */}
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
                      {(() => {
                        const s = getReadingStatus(b);
                        if (s === "finished") {
                          return (
                            <span
                              data-testid={`compact-status-${b.book_id}`}
                              data-status="finished"
                              className="absolute top-1 right-1 text-[7px] font-bold uppercase tracking-wider text-white bg-[#81B29A] px-1 py-0.5 rounded"
                            >
                              Finished
                            </span>
                          );
                        }
                        if (s === "reading") {
                          return (
                            <span
                              data-testid={`compact-status-${b.book_id}`}
                              data-status="reading"
                              className="absolute top-1 right-1 text-[7px] font-bold uppercase tracking-wider text-[#8C5C00] bg-[#FDF3E1] border border-[#F5E0A8] px-1 py-0.5 rounded"
                            >
                              Reading
                            </span>
                          );
                        }
                        return (
                          <span
                            data-testid={`compact-status-${b.book_id}`}
                            data-status="unread"
                            className="absolute top-1 right-1 text-[7px] font-bold uppercase tracking-wider text-[#5B5F4D] bg-[#F5F0E5] border border-[#E4D9C8] px-1 py-0.5 rounded"
                          >
                            Unread
                          </span>
                        );
                      })()}
                    </div>
                    <p className="mt-1.5 text-[11px] font-medium text-[#2C2C2C] line-clamp-2 leading-tight w-full" title={b.title}>
                      {b.title || "Untitled"}
                    </p>
                    <p className="text-[10px] text-[#5B5F4D] truncate w-full">
                      {b.author || "—"}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* 2026-06-27 — Grid-size slider.  S = smaller cards
                    + more columns (~50% more covers on screen),
                    M = current default, L = bigger cards + fewer
                    columns (easier to read titles).  Only renders
                    in Grid mode; Compact has its own high-density
                    grid that doesn't need user control. */}
                <div className="flex items-center justify-end gap-1 mb-3 text-[10px] uppercase tracking-wider text-[#6E6E6E]" data-testid="grid-size-toggle">
                  <span className="mr-1">Size:</span>
                  {[
                    { value: "s", label: "S" },
                    { value: "m", label: "M" },
                    { value: "l", label: "L" },
                  ].map((opt) => {
                    const active = gridSize === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGridSize(opt.value)}
                        aria-pressed={active}
                        data-testid={`grid-size-${opt.value}`}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                          active
                            ? "bg-[#6B46C1] text-white"
                            : "text-[#5B5F4D] hover:bg-[#F5F3EC] border border-transparent hover:border-[#E8E6E1]"
                        }`}
                        title={
                          opt.value === "s" ? "Small — see ~50% more covers per screen" :
                          opt.value === "l" ? "Large — easier to read titles" :
                          "Medium (default)"
                        }
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div className={`grid ${gridColsClass} gap-6`} data-testid="books-grid">
                  {bookSections.map((sec) => (
                    <React.Fragment key={sec.key}>
                      {sec.label && (
                        <button
                          type="button"
                          onClick={() => toggleSection(sec.key)}
                          aria-expanded={!collapsedSections[sec.key]}
                          data-testid={`books-section-${sec.key}`}
                          className="col-span-full flex items-center gap-2 px-2 py-2 mt-2 first:mt-0 border-b border-[#E8E6E1] text-left hover:bg-[#F5F3EC] transition-colors"
                        >
                          <span className="font-serif text-xl text-[#2C2C2C]">{sec.label}</span>
                          <span className="text-xs text-[#6E6E6E]">· {sec.books.length}</span>
                          <span
                            aria-hidden="true"
                            className={`ml-auto text-[#5B5F4D] transition-transform ${collapsedSections[sec.key] ? "" : "rotate-180"}`}
                          >▼</span>
                        </button>
                      )}
                      {!collapsedSections[sec.key] && sec.books.map(b => (
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
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}
              </>
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
