// SectionSidebar — 2026-08-22
// ---------------------------------------------------------------------------
// Shared Table-of-Contents primitive extracted from Account.jsx and
// EmailPreferences.jsx (which were near-verbatim copies of each
// other's SettingsToC / SettingsMobileJump / SettingsSectionHeader).
//
// Exposes three pieces so consumers can wire them into their existing
// two-column layout without further boilerplate:
//
//   <SectionSidebar     manifest testidPrefix storageKey ... />  // desktop
//   <MobileSectionJump  manifest testidPrefix ... />              // mobile
//   <SectionHeader      label order testidPrefix />               // sticky pill
//
// A "manifest" is `[{ anchor, category, label, keywords? }]`.  Each
// anchor is looked up as either `[data-testid="{anchor}"]` or an
// element `#id` — matching Account.jsx's jump() resolution order.
//
// All state (search query, expanded categories, recent anchors,
// active scroll-spy category) is self-contained per instance.
// Recent + expanded state persist to localStorage under the
// consumer-supplied `storageKey` so each page has its own memory.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, ChevronRight, X as XIcon } from "lucide-react";

// Resolve an anchor to a DOM element — data-testid first, then #id.
function resolveAnchor(anchor) {
  return (
    document.querySelector(`[data-testid="${anchor}"]`) ||
    document.getElementById(anchor)
  );
}

// Build the ordered category list (first-appearance order) from a manifest.
function useCategories(manifest) {
  return useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of manifest) {
      if (!seen.has(row.category)) {
        seen.add(row.category);
        out.push(row.category);
      }
    }
    return out;
  }, [manifest]);
}

// Shared IntersectionObserver scroll-spy — tracks which category the
// topmost visible section belongs to.
function useScrollSpy(manifest) {
  const categories = useCategories(manifest);
  const [activeCategory, setActiveCategory] = useState(categories[0] || "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const anchorToCategory = new Map(
      manifest.map((r) => [r.anchor, r.category]),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const testid =
          visible[0].target.getAttribute("data-testid") || visible[0].target.id;
        const cat = anchorToCategory.get(testid);
        if (cat) setActiveCategory(cat);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    manifest.forEach((row) => {
      const el = resolveAnchor(row.anchor);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [manifest]);
  return activeCategory;
}

// ---------------------------------------------------------------------------
// SectionSidebar — desktop sticky ToC (hidden below lg).
// ---------------------------------------------------------------------------
export function SectionSidebar({
  manifest,
  testidPrefix,
  storageKey,
  ariaLabel = "Section navigation",
  searchPlaceholder = "Search sections…",
  enableRecent = false,
  flashClassName = "settings-toc-flash",
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filter = (row) =>
    !q ||
    row.label.toLowerCase().includes(q) ||
    row.category.toLowerCase().includes(q) ||
    (row.keywords || "").toLowerCase().includes(q);

  const filtered = manifest.filter(filter);
  const categories = useCategories(manifest);
  const rowsByCategory = useMemo(() => {
    const g = {};
    for (const row of filtered)
      (g[row.category] = g[row.category] || []).push(row);
    return g;
  }, [filtered]);

  // Expanded category state — persisted so a user's preferred layout
  // survives across visits.
  const EXPAND_KEY = `${storageKey || testidPrefix}.expanded_categories`;
  const [expandedCats, setExpandedCats] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(EXPAND_KEY) || "[]");
      return new Set(Array.isArray(raw) ? raw : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(EXPAND_KEY, JSON.stringify([...expandedCats]));
    } catch {
      /* ignore */
    }
  }, [EXPAND_KEY, expandedCats]);
  const toggleCategoryExpand = (cat) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // "Recent" — last 3 anchors the user has jumped to (optional).
  const RECENT_KEY = `${storageKey || testidPrefix}.recent`;
  const RECENT_MAX = 3;
  const [recentAnchors, setRecentAnchors] = useState(() => {
    if (!enableRecent) return [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(raw) ? raw.slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  });
  const pushRecent = (anchor) => {
    if (!enableRecent) return;
    setRecentAnchors((prev) => {
      const next = [anchor, ...prev.filter((x) => x !== anchor)].slice(
        0,
        RECENT_MAX,
      );
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const recentRows = recentAnchors
    .map((a) => manifest.find((r) => r.anchor === a))
    .filter(Boolean);

  const activeCategory = useScrollSpy(manifest);

  const jump = (anchor) => {
    const el = resolveAnchor(anchor);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (flashClassName) {
      el.classList.add(flashClassName);
      setTimeout(() => el.classList.remove(flashClassName), 1200);
    }
    if (typeof el.focus === "function") {
      const hadTabIndex = el.hasAttribute("tabindex");
      if (!hadTabIndex) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      if (!hadTabIndex) setTimeout(() => el.removeAttribute("tabindex"), 500);
    }
    pushRecent(anchor);
  };

  const jumpToCategory = (cat) => {
    if (!expandedCats.has(cat)) toggleCategoryExpand(cat);
    const firstRow = manifest.find((r) => r.category === cat);
    if (firstRow) {
      const el = resolveAnchor(firstRow.anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const anyMatch = filtered.length > 0;
  return (
    <aside
      className="hidden lg:block bg-white dark:bg-zinc-900 border border-[#E8E6E1] dark:border-zinc-700 rounded-2xl p-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto scrollbar-hidden"
      aria-label={ariaLabel}
      data-testid={`${testidPrefix}-toc`}
    >
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7457] dark:text-white/60" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-[#E8E6E1] dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-[#2C2C2C] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
          data-testid={`${testidPrefix}-toc-search`}
          aria-label={searchPlaceholder}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#7A7457] hover:text-[#2C2C2C] dark:hover:text-white"
            aria-label="Clear search"
            data-testid={`${testidPrefix}-toc-clear`}
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {enableRecent && !q && recentRows.length > 0 && (
        <div className="mb-4" data-testid={`${testidPrefix}-toc-recent-sticky`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] dark:text-white/60 mb-2 px-2">
            Recent
          </p>
          <nav className="space-y-0.5" aria-label="Recently viewed sections">
            {recentRows.map((row) => (
              <button
                key={row.anchor}
                type="button"
                onClick={() => jump(row.anchor)}
                title={row.category}
                data-testid={`${testidPrefix}-toc-recent-${row.anchor}`}
                className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-[#5B5F4D] dark:text-white/70 hover:bg-[#FDF3E1] dark:hover:bg-zinc-800 hover:text-[#B87A00] dark:hover:text-[#E5B76D] transition-colors truncate"
              >
                <span className="text-[10px] mr-1.5 opacity-60">↻</span>
                {row.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {!q && (
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] dark:text-white/60 mb-3 px-2">
          Sections
        </p>
      )}

      {!anyMatch ? (
        <p
          className="text-sm text-[#5B5F4D] dark:text-white/70 italic px-2 py-2"
          data-testid={`${testidPrefix}-toc-empty`}
        >
          No sections match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <nav className="space-y-1" aria-label="Sections">
          {categories.map((cat) => {
            const rows = rowsByCategory[cat] || [];
            if (rows.length === 0) return null;
            const totalInCategory = manifest.filter(
              (r) => r.category === cat,
            ).length;
            const active = activeCategory === cat && !q;
            const isOpen = !!q || expandedCats.has(cat) || active;
            return (
              <div key={cat}>
                <div
                  className={`w-full flex items-stretch rounded-lg text-xs transition-all duration-300 ease-out overflow-hidden ${
                    active
                      ? "bg-[#6B46C1] text-white font-semibold shadow-sm shadow-[#6B46C1]/30"
                      : "text-[#5B5F4D] dark:text-white/70 hover:bg-[#EEE9FB] dark:hover:bg-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCategoryExpand(cat)}
                    aria-expanded={isOpen}
                    aria-controls={`${testidPrefix}-toc-cat-${cat}-list`}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${cat}`}
                    data-testid={`${testidPrefix}-toc-toggle-${cat}`}
                    className={`px-1.5 flex items-center justify-center transition-colors ${
                      active
                        ? "hover:bg-white/10"
                        : "hover:bg-[#DAD4EF] dark:hover:bg-zinc-700 hover:text-[#6B46C1] dark:hover:text-white"
                    }`}
                  >
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${
                        isOpen ? "" : "-rotate-90"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToCategory(cat)}
                    data-testid={`${testidPrefix}-toc-cat-${cat}`}
                    data-active={active ? "true" : "false"}
                    className={`flex-1 text-left flex items-center justify-between px-2 py-1.5 transition-colors ${
                      active
                        ? ""
                        : "hover:text-[#6B46C1] dark:hover:text-white"
                    }`}
                  >
                    <span className="uppercase tracking-wider text-[10px] font-bold">
                      {cat}
                    </span>
                    <span
                      className={`text-[10px] tabular-nums ${
                        active
                          ? "text-[#EEE9FB]"
                          : "text-[#6E6E6E] dark:text-white/40"
                      }`}
                    >
                      {totalInCategory}
                    </span>
                  </button>
                </div>
                {isOpen && rows.length > 0 && (
                  <nav
                    id={`${testidPrefix}-toc-cat-${cat}-list`}
                    className="space-y-0.5 mt-1 ml-4 mb-1"
                    aria-label={`${cat} sections`}
                  >
                    {rows.map((row) => (
                      <button
                        key={row.anchor}
                        type="button"
                        onClick={() => jump(row.anchor)}
                        className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#2C2C2C] dark:text-white hover:bg-[#F5F0E5] dark:hover:bg-zinc-800 hover:text-[#6B46C1] dark:hover:text-[#B589FF] transition-colors group truncate"
                        data-testid={`${testidPrefix}-toc-link-${row.anchor}`}
                        title={row.label}
                      >
                        <ChevronRight className="w-3 h-3 text-[#9B9B8C] dark:text-white/40 group-hover:text-[#6B46C1] group-hover:translate-x-0.5 transition-all shrink-0" />
                        <span className="truncate">{row.label}</span>
                      </button>
                    ))}
                  </nav>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// MobileSectionJump — compact <select> replacing the sidebar on mobile.
// ---------------------------------------------------------------------------
export function MobileSectionJump({ manifest, testidPrefix, label = "Jump to section" }) {
  const categories = useCategories(manifest);
  const activeCategory = useScrollSpy(manifest);
  const jumpToCategory = (cat) => {
    if (!cat) return;
    const firstRow = manifest.find((r) => r.category === cat);
    if (!firstRow) return;
    const el = resolveAnchor(firstRow.anchor);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div
      className="lg:hidden mb-4 sticky top-16 z-10 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded-xl p-2 border border-[#E8E6E1] dark:border-zinc-700" /* dark-ok — bg-white/90 is deliberately paired with dark:bg-zinc-900/90 */
      data-testid={`${testidPrefix}-mobile-jump-wrap`}
    >
      <label
        htmlFor={`${testidPrefix}-mobile-jump`}
        className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60 mb-1 block px-1"
      >
        {label}
      </label>
      <select
        id={`${testidPrefix}-mobile-jump`}
        data-testid={`${testidPrefix}-mobile-jump`}
        value={activeCategory}
        onChange={(e) => jumpToCategory(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[#E8E6E1] dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-[#2C2C2C] dark:text-white focus:border-[#6B46C1] focus:outline-none transition-colors"
      >
        {categories.map((cat) => {
          const count = manifest.filter((r) => r.category === cat).length;
          // Interpolate label+count into a single text child so the
          // visual-editor runtime doesn't inject a <span> inside <option>
          // (invalid HTML → React hydration warning).
          return (
            <option key={cat} value={cat}>
              {`${cat} (${count})`}
            </option>
          );
        })}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — sticky purple-pill label above each category's first card.
// ---------------------------------------------------------------------------
export function SectionHeader({ label, order, testidPrefix, background = "bg-paper" }) {
  return (
    <div
      className={`sticky top-16 z-10 ${background} flex items-center gap-3 mt-6 mb-4 first:mt-0 py-2`}
      data-testid={`${testidPrefix}-section-header-${label.toLowerCase()}`}
      style={order != null ? { order } : undefined}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#6B46C1] dark:text-[#B589FF] shrink-0">
        {label}
      </span>
      <span
        className="flex-1 h-px bg-[#E8E6E1] dark:bg-zinc-700"
        aria-hidden="true"
      />
    </div>
  );
}
