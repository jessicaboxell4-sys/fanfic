import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ReactReader } from "react-reader";
import { ArrowLeft, BookOpen, Minus, Plus, BookText, AlignLeft } from "lucide-react";
import { api } from "../lib/api";
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
      }, 1200);
    } catch (e) {}
  }, [id]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`shelfsort-loc-${id}`);
      if (saved) savedLocationRef.current = saved;
    } catch (e) {}
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

      <div className="flex-1 relative" data-testid="reader-area" style={{ minHeight: 0 }}>
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
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
              <p className="mt-4 text-[#6B705C] font-serif text-lg">Opening your book…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
