import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ReactReader } from "react-reader";
import { ArrowLeft, BookOpen, Minus, Plus, BookText, AlignLeft, Bookmark, BookmarkPlus, X as XIcon, Maximize, Minimize } from "lucide-react";
import { api } from "../lib/api";
import { pulseGoalsCheck } from "../lib/goalHitWatcher";
import { toast } from "sonner";

const FLOW_KEY = "shelfsort-flow"; // "paginated" | "scrolled"

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
    try {
      const saved = window.localStorage.getItem(`shelfsort-loc-${id}`);
      if (saved) savedLocationRef.current = saved;
    } catch (e) {}
  }, [id]);

  // Cross-device handoff: ask the cloud where we left off.  If the
  // cloud copy was written by a different device within the last 6 h
  // AND it's noticeably ahead of (or behind) the local one, surface
  // a toast so the user can jump to the cloud cursor in one tap.
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
        if (!Number.isFinite(ageHours) || ageHours > 6) return;
        // Local progress: read from books endpoint state if available;
        // simpler — use the savedLocationRef heuristic: if cfi differs
        // and remote is fresh, offer the jump.
        const localCfi = savedLocationRef.current;
        if (localCfi && String(localCfi) === String(data.cfi)) return;
        const label = data.device_label || "another device";
        const pctTxt = data.percent ? ` (${Math.round(data.percent * 100)}%)` : "";
        toast(`You were reading on ${label}${pctTxt}`, {
          description: "Jump to that spot?",
          action: {
            label: "Resume there",
            onClick: () => {
              try {
                renditionRef.current?.display(data.cfi);
                savedLocationRef.current = null;
              } catch { /* ignore */ }
            },
          },
          duration: 12000,
        });
      } catch { /* no cursor yet → no prompt */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

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

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-paper">
      <header className="flex-shrink-0 backdrop-blur-xl bg-[#FDFBF7]/85 border-b border-[#E8E6E1] z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <button
            data-testid="reader-back"
            onClick={() => navigate(`/book/${id}`)}
            className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C]"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex-1 min-w-0 text-center">
            {book ? (
              <>
                <p className="font-serif text-base md:text-lg text-[#2C2C2C] truncate" data-testid="reader-title">
                  {book.title}
                </p>
                <p className="text-xs text-[#6B705C] truncate">{book.author}</p>
              </>
            ) : (
              <p className="text-sm text-[#6B705C]">Opening book…</p>
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
