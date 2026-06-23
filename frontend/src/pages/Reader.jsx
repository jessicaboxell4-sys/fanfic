import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ReactReader } from "react-reader";
import { ArrowLeft, BookOpen, Minus, Plus, BookText, AlignLeft, Bookmark, BookmarkPlus, X as XIcon, Maximize, Minimize, Palette } from "lucide-react";
import { api } from "../lib/api";
import { armReadingHandoff } from "../lib/push";
import { pulseGoalsCheck } from "../lib/goalHitWatcher";
import { toast } from "sonner";
import ReaderThemePanel, { READER_THEMES, READER_FONTS, DEFAULT_THEME, DEFAULT_FONT } from "../components/ReaderThemePanel";
import TTSControls from "../components/TTSControls";

const FLOW_KEY = "shelfsort-flow"; // "paginated" | "scrolled"
const THEME_KEY = "shelfsort-reader-theme";
const FONT_KEY = "shelfsort-reader-font";

function relativeAge(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jumpAt = searchParams.get("at"); // chapter href to jump to on open
  const [book, setBook] = useState(null);
  const [bookData, setBookData] = useState(null);
  const [location, setLocation] = useState(null);
  const [flow, setFlow] = useState(() => window.localStorage.getItem(FLOW_KEY) || "paginated");
  const [fontSize, setFontSize] = useState(() => {
    const v = parseInt(window.localStorage.getItem("shelfsort-fontsize") || "100", 10);
    return Number.isFinite(v) ? v : 100;
  });
  const [error, setError] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);
  // Cross-device "Furthest read position" — populated by the cursor
  // fetch effect on mount when a different device left off ahead of us.
  const [handoff, setHandoff] = useState(null);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [themeId, setThemeId] = useState(() => {
    const v = window.localStorage.getItem(THEME_KEY);
    return (v && READER_THEMES[v]) ? v : DEFAULT_THEME;
  });
  const [fontId, setFontId] = useState(() => {
    const v = window.localStorage.getItem(FONT_KEY);
    return (v && READER_FONTS[v]) ? v : DEFAULT_FONT;
  });
  // Aggregated cross-reader heatmap data for this canonical book.
  // Loaded once on mount; gated server-side so it's null for books
  // with fewer than 10 unique readers contributing.
  const [heatmap, setHeatmap] = useState(null);
  // Mobile reading mode: full-screen viewport + tap-edge page flips.
  // `isFullscreen` is mirrored from the actual fullscreenchange event so
  // pressing ESC (which the browser handles) still updates our button.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const readerWrapRef = useRef(null);
  const renditionRef = useRef(null);
  const savedLocationRef = useRef(null);
  const progressTimerRef = useRef(null);
  const lastProgressRef = useRef(null);

  const sendProgress = useCallback((cfi) => {
    try {
      const book = renditionRef.current?.book;
      if (!book?.locations?.length || book.locations.length() === 0) return;
      const pct = book.locations.percentageFromCfi(cfi);
      if (pct == null || Number.isNaN(pct)) return;
      // Debounce — only POST after 1.2s of no further movement, and only on change
      if (Math.abs((lastProgressRef.current ?? -1) - pct) < 0.005) return;
      lastProgressRef.current = pct;
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      progressTimerRef.current = setTimeout(() => {
        api.post(`/books/${id}/progress`, { percent: pct, cfi }).catch(() => {});
        // Also push the cursor to the cloud so the same book picked
        // up on another device can resume from this exact spot.
        try {
          let deviceId = localStorage.getItem("shelfsort-device-id");
          if (!deviceId) {
            deviceId = "dev_" + Math.random().toString(36).slice(2, 14);
            localStorage.setItem("shelfsort-device-id", deviceId);
          }
          // Best-effort UA label so the handoff prompt reads naturally.
          const ua = (navigator.userAgent || "").toLowerCase();
          const label = ua.includes("iphone") ? "iPhone"
            : ua.includes("ipad") ? "iPad"
            : ua.includes("android") ? "Android"
            : ua.includes("mac") ? "Mac"
            : ua.includes("win") ? "Windows"
            : "this device";
          api.post(`/books/${id}/cursor`, {
            cfi: String(cfi || ""),
            percent: pct,
            chapter_label: "",
            device_id: deviceId,
            device_label: label,
          }).catch(() => {});
        } catch { /* localStorage blocked — fine */ }
        if (pct >= 0.99) pulseGoalsCheck();
      }, 1200);
    } catch (e) {}
  }, [id]);

  useEffect(() => {
    // localStorage is the fast-path default: same device, same book =
    // resume instantly without a round-trip.  When it's empty (fresh
    // device, cleared cache), we fall back to the cloud cursor below
    // so the user never starts at chapter 1 just because they switched
    // devices.  That's THE Kindle-parity moment.
    let cancelled = false;
    let localFound = false;
    try {
      const saved = window.localStorage.getItem(`shelfsort-loc-${id}`);
      if (saved) {
        savedLocationRef.current = saved;
        localFound = true;
      }
    } catch (e) {}

    if (!localFound) {
      (async () => {
        try {
          const { data } = await api.get(`/books/${id}/cursor`);
          if (cancelled || !data?.cfi) return;
          savedLocationRef.current = data.cfi;
          // If the rendition already mounted at chapter 1 (cloud
          // request lost the race against epubjs's first paint), jump
          // now.  feels like a 200-300ms "thinking" load.
          if (renditionRef.current) {
            try { renditionRef.current.display(data.cfi); } catch (e) {}
          }
        } catch (e) { /* 404 (never opened anywhere) or offline — silent */ }
      })();
    }
    return () => { cancelled = true; };
  }, [id]);

  // Cross-device handoff: ask the cloud where we left off.  If the
  // cloud copy was written by a different device within the last 14
  // days AND it's noticeably ahead of (or behind) the local one,
  // surface a toast so the user can jump to the cloud cursor in one
  // tap.  (Was 6h originally — too short for casual readers who go a
  // few days between sessions.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${id}/cursor`);
        if (cancelled || !data?.cfi) return;
        const myDevice = localStorage.getItem("shelfsort-device-id");
        if (data.device_id && myDevice && data.device_id === myDevice) return;
        const updatedAt = new Date(data.updated_at);
        const ageHours = (Date.now() - updatedAt.getTime()) / 3_600_000;
        if (!Number.isFinite(ageHours) || ageHours > 24 * 14) return;
        const localCfi = savedLocationRef.current;
        if (localCfi && String(localCfi) === String(data.cfi)) return;
        // Persistent ribbon — see <CrossDeviceRibbon /> below.  Stays
        // visible until the user either jumps to the saved spot or
        // dismisses with the × button.  Dismissals are remembered per
        // (book, cfi) in localStorage so reopening doesn't nag again.
        const dismissed = (() => {
          try { return localStorage.getItem(`shelfsort-handoff-dismissed-${id}-${data.cfi}`) === "1"; }
          catch { return false; }
        })();
        if (dismissed) return;
        setHandoff({
          cfi: data.cfi,
          percent: data.percent,
          deviceLabel: data.device_label || "another device",
          updatedAt: data.updated_at,
        });
      } catch { /* no cursor yet → no prompt */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Cross-device "Furthest read position" ribbon state.  Lives at the
  // top of the reader area, just below the toolbar.
  const dismissHandoff = useCallback(() => {
    if (!handoff) return;
    try { localStorage.setItem(`shelfsort-handoff-dismissed-${id}-${handoff.cfi}`, "1"); } catch {}
    setHandoff(null);
  }, [handoff, id]);

  const jumpToHandoff = useCallback(() => {
    if (!handoff) return;
    try {
      renditionRef.current?.display(handoff.cfi);
      savedLocationRef.current = null;
    } catch {}
    dismissHandoff();
  }, [handoff, dismissHandoff]);

  // Load this book's bookmarks once the book is open.
  const loadBookmarks = useCallback(async () => {
    try {
      const { data } = await api.get(`/books/${id}/bookmarks`);
      setBookmarks(data.bookmarks || []);
    } catch (e) { /* silent — bookmarks are non-critical */ }
  }, [id]);
  useEffect(() => { loadBookmarks(); }, [loadBookmarks]);

  // Save the current page as a bookmark.
  const addBookmark = useCallback(async () => {
    if (!location) {
      toast.error("Couldn't grab your current position");
      return;
    }
    // Best-effort: compute reading % + chapter label so the bookmark
    // entry is informative without requiring the user to type anything.
    let percent = null;
    let chapter_label = "";
    try {
      const book = renditionRef.current?.book;
      if (book?.locations?.length && book.locations.length() > 0) {
        percent = book.locations.percentageFromCfi(location);
      }
      // Walk the TOC to find the chapter containing this CFI.
      try {
        const loc = renditionRef.current?.currentLocation?.();
        const href = loc?.start?.href;
        const toc = book?.navigation?.toc || [];
        const flat = [];
        const walk = (items) => items.forEach((it) => { flat.push(it); if (it.subitems) walk(it.subitems); });
        walk(toc);
        const match = flat.find((it) => it.href && href && (it.href === href || href.startsWith(it.href.split("#")[0])));
        if (match?.label) chapter_label = match.label;
      } catch (e) {}
    } catch (e) {}
    try {
      const { data } = await api.post(`/books/${id}/bookmarks`, {
        cfi: location,
        percent,
        chapter_label,
        note: "",
      });
      toast.success("Bookmark added");
      // Optimistic + refetch for canonical order.
      setBookmarks((prev) => {
        const without = prev.filter((b) => b.cfi !== location);
        return [...without, data.bookmark].sort((a, b) => (a.percent ?? 1) - (b.percent ?? 1));
      });
    } catch (e) {
      toast.error("Couldn't save bookmark");
    }
  }, [id, location]);

  // Jump the reader to a bookmark's CFI.
  const jumpToBookmark = useCallback((cfi) => {
    try {
      renditionRef.current?.display(cfi);
      setShowBookmarkPanel(false);
    } catch (e) { toast.error("Couldn't jump to that bookmark"); }
  }, []);

  // Delete a bookmark from the panel.
  const removeBookmark = useCallback(async (bookmark_id) => {
    try {
      await api.delete(`/books/${id}/bookmarks/${bookmark_id}`);
      setBookmarks((prev) => prev.filter((b) => b.bookmark_id !== bookmark_id));
    } catch (e) { toast.error("Couldn't remove bookmark"); }
  }, [id]);

  // Inline-edit a bookmark's note from the panel.  Debounce-free on purpose:
  // each note is short, blur fires once per edit, and the optimistic state
  // means the user never sees a flicker.
  const updateBookmarkNote = useCallback(async (bookmark_id, note) => {
    setBookmarks((prev) => prev.map((b) =>
      b.bookmark_id === bookmark_id ? { ...b, note } : b
    ));
    try {
      await api.patch(`/books/${id}/bookmarks/${bookmark_id}`, { note });
    } catch (e) { toast.error("Couldn't save note"); }
  }, [id]);

  // Is the user's current position already bookmarked? Used to flip the
  // bookmark button between "Add" and "Saved" so they don't accidentally
  // double-bookmark the exact same CFI.
  const currentIsBookmarked = location
    ? bookmarks.some((b) => b.cfi === location)
    : false;

  // Cmd/Ctrl+B keyboard shortcut to add (or focus the panel for editing)
  // the current page.  Skips when an input is focused so we don't fight
  // browser-native bold-text in textareas inside the bookmark panel.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      addBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addBookmark]);

  // Mobile reading mode — fullscreen toggle + tap-edge page nav.
  // Listens to the browser's own fullscreenchange so ESC also updates
  // our local flag.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Cross-device handoff push — fires a single beacon when the user
  // backgrounds / closes the tab after meaningful progress.  The
  // backend pushes the resume prompt to every other registered
  // device of the same user.  Opt-in (no-ops unless Push has been
  // enabled in Account settings).
  useEffect(() => armReadingHandoff(id, () => lastProgressRef.current), [id]);

  // Fetch the cross-reader heatmap once on mount.  Errors here are
  // fatal-to-the-widget only — the reader UI carries on regardless.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${id}/heatmap`);
        if (!cancelled) setHeatmap(data);
      } catch { /* no heatmap = no widget */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        (readerWrapRef.current || document.documentElement).requestFullscreen?.();
      }
    } catch { /* unsupported — best effort */ }
  }, []);

  const flipNext = useCallback(() => {
    try { renditionRef.current?.next(); } catch { /* no-op */ }
  }, []);
  const flipPrev = useCallback(() => {
    try { renditionRef.current?.prev(); } catch { /* no-op */ }
  }, []);

  // Reading-time heartbeat: every 60s, if the tab is visible AND user is
  // active (mouse/scroll/key/touch in the last 90s), send a 60-second ping.
  useEffect(() => {
    let lastActivity = Date.now();
    const bump = () => { lastActivity = Date.now(); };
    const events = ["mousemove", "scroll", "keydown", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));

    const tick = () => {
      if (document.hidden) return;
      const idleMs = Date.now() - lastActivity;
      if (idleMs > 90_000) return; // user is idle
      api
        .post(`/books/${id}/heartbeat`, { seconds: 60 })
        .catch(() => {});
    };
    const handle = setInterval(tick, 60_000);
    return () => {
      clearInterval(handle);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, [id]);

  // Load book metadata + EPUB bytes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, blob] = await Promise.all([
          api.get(`/books/${id}`),
          api.get(`/books/${id}/download`, { responseType: "arraybuffer" }),
        ]);
        if (cancelled) return;
        setBook(meta.data);
        setBookData(blob.data);
        // Mark as recently opened (fire-and-forget)
        api.post(`/books/${id}/touch`).catch(() => {});
      } catch (e) {
        if (!cancelled) {
          setError("Couldn't open this book");
          toast.error("Couldn't open this book");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const onLocationChanged = useCallback((loc) => {
    setLocation(loc);
    try { window.localStorage.setItem(`shelfsort-loc-${id}`, String(loc)); } catch (e) {}
    if (loc) sendProgress(loc);
  }, [id, sendProgress]);

  const applyFont = useCallback((size) => {
    try {
      renditionRef.current?.themes.fontSize(`${size}%`);
    } catch (e) {}
  }, []);

  // Re-register a custom epubjs theme whenever the user picks a
  // different skin or font.  epubjs only paints what's in the iframe,
  // so we also keep the outer reader wrap recoloured (see header
  // overlay + reader-area inline styles below) so the page doesn't
  // look like a dark page in a light frame (or vice versa).
  const applyAppearance = useCallback((tid, fid, rendition) => {
    const r = rendition || renditionRef.current;
    if (!r) return;
    const t = READER_THEMES[tid] || READER_THEMES[DEFAULT_THEME];
    const f = READER_FONTS[fid] || READER_FONTS[DEFAULT_FONT];
    const themeName = `skin-${tid}-${fid}`;
    try {
      r.themes.register(themeName, {
        body: {
          color: t.css.body.color,
          background: t.css.body.background,
          "font-family": f.family,
          "line-height": "1.7",
          padding: "0 8px",
        },
        p: { "font-family": f.family },
        "h1, h2, h3, h4": {
          color: t.css["h1, h2, h3, h4"].color,
          "font-family": f.family,
        },
        a: { color: t.css.a.color },
      });
      r.themes.select(themeName);
    } catch (e) { /* iframe not ready yet — first paint will re-apply */ }
  }, []);

  // Cross-device hydration: on mount, pull the saved
  // `reader_prefs` sub-doc from the user's account.  localStorage is
  // the fast-path default at first paint (no network), but a
  // subsequent server value silently upgrades the UI when it arrives.
  // This is what makes "Sepia Night + Lora" follow the reader from
  // laptop to phone.  We skip the upgrade entirely if the user just
  // changed something locally (avoids stomping mid-debounce).
  const hasUserEditedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/account/reader-prefs");
        if (cancelled || hasUserEditedRef.current) return;
        if (data?.theme && READER_THEMES[data.theme]) setThemeId(data.theme);
        if (data?.font && READER_FONTS[data.font]) setFontId(data.font);
      } catch (e) { /* unauth or offline — localStorage stays canonical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced PATCH back to the server whenever the user picks a new
  // theme or font.  600ms gap so rapid clicks (e.g. cycling through
  // skins in the panel) collapse into one network round-trip.
  const prefsPatchTimerRef = useRef(null);
  useEffect(() => {
    applyAppearance(themeId, fontId);
    try { window.localStorage.setItem(THEME_KEY, themeId); } catch (e) {}
    try { window.localStorage.setItem(FONT_KEY, fontId); } catch (e) {}

    // Skip the very first effect run — that's the hydration paint, not
    // a real user edit.  ``hasUserEditedRef`` guards both directions.
    if (!hasUserEditedRef.current) {
      hasUserEditedRef.current = true;
      return;
    }
    if (prefsPatchTimerRef.current) clearTimeout(prefsPatchTimerRef.current);
    prefsPatchTimerRef.current = setTimeout(() => {
      api.patch("/account/reader-prefs", { theme: themeId, font: fontId })
        .catch(() => { /* offline / unauth — localStorage is still canonical */ });
    }, 600);
    return () => {
      if (prefsPatchTimerRef.current) clearTimeout(prefsPatchTimerRef.current);
    };
  }, [themeId, fontId, applyAppearance]);

  useEffect(() => {
    applyFont(fontSize);
    try { window.localStorage.setItem("shelfsort-fontsize", String(fontSize)); } catch (e) {}
  }, [fontSize, applyFont]);

  // Auto-fallback: paginated layouts can fail on EPUBs whose stylesheets
  // collide with epubjs. If the iframe stays at 0 height for >1.2s in
  // paginated mode, switch to scrolled silently.
  const fallbackTriedRef = useRef(false);
  useEffect(() => {
    fallbackTriedRef.current = false;
  }, [flow, id]);

  const getRendition = (rendition) => {
    renditionRef.current = rendition;

    // Generate (or load cached) CFI locations so we can compute reading %
    const book = rendition.book;
    if (book) {
      const cacheKey = `shelfsort-locs-${id}`;
      const cached = (() => { try { return window.localStorage.getItem(cacheKey); } catch (e) { return null; } })();
      if (cached) {
        try { book.locations.load(cached); } catch (e) {}
      } else {
        book.ready.then(() => book.locations.generate(1600)).then(() => {
          try { window.localStorage.setItem(cacheKey, book.locations.save()); } catch (e) {}
          // After locations are generated, push current progress once.
          if (location) sendProgress(location);
        }).catch(() => {});
      }
    }

    rendition.themes.register("paper", {
      "body": {
        "color": "#2C2C2C",
        "background": "#FDFBF7",
        "font-family": "'Manrope', sans-serif",
        "line-height": "1.7",
        "padding": "0 8px",
      },
      "p": { "font-family": "'Manrope', sans-serif" },
      "h1, h2, h3, h4": {
        "font-family": "'Cormorant Garamond', serif",
        "color": "#2C2C2C",
      },
      "a": { "color": "#E07A5F" },
    });
    rendition.themes.select("paper");
    applyFont(fontSize);
    // Apply the user's saved skin + font preset on top of the
    // base "paper" theme.  The helper just re-registers a custom
    // theme each time it's called, so live changes work too.
    applyAppearance(themeId, fontId, rendition);

    const saved = savedLocationRef.current;
    // If we have a ?at=<href> jump target, prefer it over the saved location.
    // This is used by the "Re-read changed chapters" button on the Compare page.
    if (jumpAt) {
      try {
        rendition.display(jumpAt);
        toast.success("Jumped to changed chapter");
      } catch (e) {
        // Fallback: try the saved location instead
        if (saved) {
          try { rendition.display(saved); } catch (e2) {}
        }
      }
      savedLocationRef.current = null;
    } else if (saved) {
      try { rendition.display(saved); } catch (e) {}
      savedLocationRef.current = null;
    }

    const forceResize = () => {
      try { rendition.resize(); } catch (e) {}
    };
    window.addEventListener("resize", forceResize);

    // Keyboard navigation
    const onKey = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        try { rendition.next(); } catch (err) {}
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        try { rendition.prev(); } catch (err) {}
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);

    // Forward arrow keys pressed inside the iframe too
    let fallbackChecked = false;
    rendition.on("rendered", (_section, view) => {
      try {
        const doc = view?.document || view?.iframe?.contentDocument;
        if (doc) {
          doc.addEventListener("keydown", onKey);
        }
      } catch (e) {}

      // One-shot auto-fallback: check iframe height ONLY on the very first
      // render. Page transitions also fire "rendered" but mid-transition
      // dimensions are unreliable.
      if (flow === "paginated" && !fallbackChecked && !fallbackTriedRef.current) {
        fallbackChecked = true;
        setTimeout(() => {
          try {
            const iframe = document.querySelector('[data-testid="reader-area"] iframe');
            if (iframe && iframe.getBoundingClientRect().height === 0) {
              fallbackTriedRef.current = true;
              toast.message("This EPUB doesn't paginate well — switching to scroll mode");
              setFlow("scrolled");
              window.localStorage.setItem(FLOW_KEY, "scrolled");
            }
          } catch (e) {}
        }, 1500);
      }
    });

    renditionRef.current._cleanup = () => {
      window.removeEventListener("resize", forceResize);
      window.removeEventListener("keydown", onKey);
    };
  };

  useEffect(() => {
    return () => {
      try { renditionRef.current?._cleanup?.(); } catch (e) {}
    };
  }, []);

  const toggleFlow = () => {
    const next = flow === "paginated" ? "scrolled" : "paginated";
    setFlow(next);
    try { window.localStorage.setItem(FLOW_KEY, next); } catch (e) {}
  };

  if (error) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6 text-center">
        <div>
          <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">{error}</h2>
          <button onClick={() => navigate(-1)} className="btn-primary text-sm mt-4">Go back</button>
        </div>
      </div>
    );
  }

  const activeTheme = READER_THEMES[themeId] || READER_THEMES[DEFAULT_THEME];
  const isDarkSkin = activeTheme.side === "night";

  return (
    <div className="h-screen overflow-hidden flex flex-col" style={{ background: activeTheme.wrapBg }}>
      <header
        className="flex-shrink-0 backdrop-blur-xl border-b z-30"
        style={{
          background: isDarkSkin ? `${activeTheme.wrapBg}E6` : "#FDFBF7D9",
          borderColor: isDarkSkin ? "#3a3a3a" : "#E8E6E1",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <button
            data-testid="reader-back"
            onClick={() => navigate(`/book/${id}`)}
            className="flex items-center gap-2 text-sm hover:opacity-100"
            style={{ color: isDarkSkin ? `${activeTheme.wrapText}B3` : "#6B705C" }}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex-1 min-w-0 text-center">
            {book ? (
              <>
                <p className="font-serif text-base md:text-lg truncate" data-testid="reader-title" style={{ color: activeTheme.wrapText }}>
                  {book.title}
                </p>
                <p className="text-xs truncate" style={{ color: isDarkSkin ? `${activeTheme.wrapText}99` : "#6B705C" }}>{book.author}</p>
              </>
            ) : (
              <p className="text-sm" style={{ color: isDarkSkin ? `${activeTheme.wrapText}99` : "#6B705C" }}>Opening book…</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Bookmark button — fills in (Saved) when the current CFI
                already has a bookmark, so users know they don't need to
                save again.  Keyboard shortcut: Cmd/Ctrl+B. */}
            <button
              data-testid="bookmark-add-btn"
              onClick={addBookmark}
              disabled={!location}
              data-saved={currentIsBookmarked || undefined}
              className={`hidden sm:flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 disabled:opacity-50 ${
                currentIsBookmarked
                  ? "bg-[var(--primary)] text-white border-[var(--primary)] hover:opacity-90"
                  : "bg-white text-[#2C2C2C] border-[#E8E6E1] hover:bg-[#F5F3EC]"
              }`}
              title={currentIsBookmarked
                ? "This page is bookmarked — click to update note"
                : "Bookmark this page (Cmd/Ctrl+B)"}
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>{currentIsBookmarked ? "Saved" : "Bookmark"}</span>
            </button>

            {/* Bookmark panel toggle */}
            <button
              data-testid="bookmark-list-toggle"
              onClick={() => setShowBookmarkPanel((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 hover:bg-[#F5F3EC]"
              title={`${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span data-testid="bookmark-count">{bookmarks.length}</span>
            </button>

            {/* Cross-reader heatmap pill — only renders when the
                cohort gate (≥10 readers) is met and the user hasn't
                opted out of reading-data sharing. */}
            {heatmap?.ready && (
              <div
                className="hidden md:flex items-center gap-2 text-xs bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5"
                data-testid="reader-heatmap-pill"
                title={`${heatmap.cohort} readers · ${Math.round((heatmap.completion_rate || 0) * 100)}% finish rate`}
              >
                <span className="text-[#6B705C] font-medium">
                  {heatmap.cohort}
                </span>
                <span className="text-[#6B705C]">readers</span>
                {/* Mini sparkline of the 10-bucket completion curve */}
                <span className="flex items-end gap-0.5 h-3 ml-1">
                  {(heatmap.chapter_curve || []).map((c, i) => (
                    <span
                      key={i}
                      className={
                        "block w-1 rounded-sm " +
                        (heatmap.you?.percent * 100 >= c.bucket
                          ? "bg-[#6B46C1]"
                          : "bg-[#E8E6E1]")
                      }
                      style={{ height: `${4 + c.fraction_reached * 8}px` }}
                      aria-hidden="true"
                    />
                  ))}
                </span>
                {heatmap.dnf_cliff && (
                  <span
                    className="text-[10px] font-semibold text-[#B91C1C] ml-1"
                    title={`${Math.round(heatmap.dnf_cliff.abandon_rate * 100)}% of readers stop near ${heatmap.dnf_cliff.percent_bucket}%`}
                  >
                    ⚠ {heatmap.dnf_cliff.percent_bucket}%
                  </span>
                )}
              </div>
            )}

            {/* Read-aloud (Web Speech API).  Hides itself if the
                browser doesn't support speechSynthesis.  Built
                2026-07-04 in response to a real FB-group user
                request. */}
            <TTSControls
              rendition={renditionRef.current}
            />

            {/* Flow toggle */}
            <button
              data-testid="flow-toggle"
              onClick={toggleFlow}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 hover:bg-[#F5F3EC]"
              title={flow === "paginated" ? "Switch to scroll mode" : "Switch to page mode"}
            >
              {flow === "paginated" ? <BookText className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
              <span>{flow === "paginated" ? "Pages" : "Scroll"}</span>
            </button>

            {/* Fullscreen toggle — best for mobile reading.  On
                desktop it just hides the OS chrome; on phones it
                expands the reader to cover the address bar too. */}
            <button
              data-testid="fullscreen-toggle"
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 text-xs font-medium bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 hover:bg-[#F5F3EC]"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen reading mode"}
              aria-pressed={isFullscreen}
            >
              {isFullscreen
                ? <Minimize className="w-3.5 h-3.5" />
                : <Maximize className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Focus"}</span>
            </button>

            {/* Appearance — skin + font picker */}
            <button
              data-testid="reader-appearance-toggle"
              onClick={() => setShowThemePanel((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 hover:bg-[#F5F3EC]"
              title="Reading appearance (theme & font)"
              aria-pressed={showThemePanel}
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Aa</span>
            </button>

            <div className="flex items-center gap-1 bg-white border border-[#E8E6E1] rounded-full px-1.5 py-1">
              <button
                data-testid="font-decrease"
                onClick={() => setFontSize((s) => Math.max(70, s - 10))}
                className="w-7 h-7 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center"
                title="Smaller text"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-[#6B705C] tabular-nums w-9 text-center">{fontSize}%</span>
              <button
                data-testid="font-increase"
                onClick={() => setFontSize((s) => Math.min(160, s + 10))}
                className="w-7 h-7 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center"
                title="Larger text"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div
        ref={readerWrapRef}
        className="flex-1 relative"
        data-testid="reader-area"
        style={{ minHeight: 0 }}
      >
        {/* Cross-device "Furthest read position" ribbon — a Kindle-style
            persistent hint shown when the cloud cursor was last
            updated on a different device than this one.  Sits in the
            top-right corner so it doesn't cover content.  Two
            actions: "Jump there" (move + dismiss) and × (dismiss only). */}
        {handoff && (
          <div
            data-testid="reader-handoff-ribbon"
            className="absolute top-3 right-3 z-30 max-w-[280px] sm:max-w-sm shelf-card px-3 py-2 shadow-lg border border-[#6B46C1]/30 bg-[#FDFBF7] dark:bg-zinc-800 flex items-start gap-2 fade-in"
            style={{ borderRadius: 12 }}
          >
            <span className="text-[#6B46C1] mt-0.5 flex-shrink-0">
              <BookOpen className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0 text-xs">
              <p className="text-[#2C2C2C] dark:text-zinc-100 leading-tight">
                You were <span className="font-semibold">{handoff.percent ? `${Math.round(handoff.percent * 100)}%` : "reading"}</span> through this on your <span className="font-semibold">{handoff.deviceLabel}</span>
                {handoff.updatedAt ? <span className="text-[#6B705C] dark:text-zinc-400"> · {relativeAge(handoff.updatedAt)}</span> : null}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  type="button"
                  data-testid="reader-handoff-jump"
                  onClick={jumpToHandoff}
                  className="text-[11px] font-semibold text-[#6B46C1] hover:underline"
                >
                  Jump there →
                </button>
              </div>
            </div>
            <button
              type="button"
              data-testid="reader-handoff-dismiss"
              onClick={dismissHandoff}
              aria-label="Dismiss"
              className="text-[#6B705C] hover:text-[#2C2C2C] dark:hover:text-zinc-100 flex-shrink-0"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {bookData ? (
          <div style={{ position: "absolute", inset: 0 }}>
            <ReactReader
              key={flow /* remount on flow change so epubOptions re-applies */}
              url={bookData}
              location={location}
              locationChanged={onLocationChanged}
              getRendition={getRendition}
              epubOptions={{ flow }}
              showToc={true}
              swipeable={flow === "paginated"}
            />

            {/* Tap-edge page flips for mobile / touch.  Only in paginated
                mode; scrolled flow doesn't need them.  Anchored to the
                outer reader wrap so the central iframe (where the user
                actually reads) stays untouched.  Hidden visually but
                hit-testable on every viewport size. */}
            {flow === "paginated" && (
              <>
                <button
                  type="button"
                  aria-label="Previous page"
                  data-testid="reader-tap-prev"
                  onClick={flipPrev}
                  className="absolute left-0 top-12 bottom-12 w-[12%] z-10 bg-transparent focus:outline-none cursor-w-resize"
                  style={{ WebkitTapHighlightColor: "transparent" }}
                />
                <button
                  type="button"
                  aria-label="Next page"
                  data-testid="reader-tap-next"
                  onClick={flipNext}
                  className="absolute right-0 top-12 bottom-12 w-[12%] z-10 bg-transparent focus:outline-none cursor-e-resize"
                  style={{ WebkitTapHighlightColor: "transparent" }}
                />
              </>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
              <p className="mt-4 text-[#6B705C] font-serif text-lg">Opening your book…</p>
            </div>
          </div>
        )}

        {/* Appearance panel — slides in from the right (above bookmarks panel) */}
        <ReaderThemePanel
          open={showThemePanel}
          onClose={() => setShowThemePanel(false)}
          themeId={themeId}
          fontId={fontId}
          onThemeChange={setThemeId}
          onFontChange={setFontId}
        />

        {/* Bookmarks panel — slides in from the right */}
        {showBookmarkPanel && (
          <div
            className="absolute top-0 right-0 bottom-0 w-80 bg-[#FDFBF7] border-l border-[#E8E6E1] shadow-xl z-40 overflow-y-auto"
            data-testid="bookmark-panel"
          >
            <div className="sticky top-0 bg-[#FDFBF7] border-b border-[#E8E6E1] p-4 flex items-center justify-between">
              <h3 className="font-serif text-lg text-[#2C2C2C]">Bookmarks</h3>
              <button
                onClick={() => setShowBookmarkPanel(false)}
                className="text-[#6B705C] hover:text-[#2C2C2C]"
                data-testid="bookmark-panel-close"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              {bookmarks.length === 0 ? (
                <p className="text-sm text-[#6B705C] italic" data-testid="bookmark-panel-empty">
                  No bookmarks yet. Tap the Bookmark button while reading to save your spot.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bookmarks.map((bm) => (
                    <li
                      key={bm.bookmark_id}
                      className="border border-[#E8E6E1] rounded-lg p-3 hover:bg-white group"
                      data-testid={`bookmark-row-${bm.bookmark_id}`}
                    >
                      <button
                        type="button"
                        onClick={() => jumpToBookmark(bm.cfi)}
                        className="w-full text-left"
                      >
                        {bm.chapter_label && (
                          <p className="text-sm font-medium text-[#2C2C2C]">{bm.chapter_label}</p>
                        )}
                        {bm.percent != null && (
                          <p className="text-xs text-[#6B705C]">
                            {Math.round(bm.percent * 100)}% through
                          </p>
                        )}
                        <p className="text-xs text-[#9B9B8C] mt-1">
                          {new Date(bm.created_at).toLocaleDateString()}
                        </p>
                      </button>
                      {/* Inline-editable note. Persists on blur so the user
                          can type freely without hammering the network.
                          280-char ceiling matches the backend cap. */}
                      <textarea
                        defaultValue={bm.note || ""}
                        maxLength={280}
                        placeholder="Add a note…"
                        data-testid={`bookmark-note-${bm.bookmark_id}`}
                        onBlur={(e) => {
                          const next = (e.target.value || "").trim();
                          if (next !== (bm.note || "")) {
                            updateBookmarkNote(bm.bookmark_id, next);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        rows={2}
                        className="mt-2 w-full text-sm text-[#2C2C2C] bg-[#FAF6EE] border border-[#E8E6E1] rounded p-2 focus:outline-none focus:border-[var(--primary)] resize-y italic"
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeBookmark(bm.bookmark_id); }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-red-600 hover:underline mt-2"
                        data-testid={`bookmark-remove-${bm.bookmark_id}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
