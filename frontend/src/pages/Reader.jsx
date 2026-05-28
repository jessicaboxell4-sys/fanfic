import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ReactReader } from "react-reader";
import { ArrowLeft, BookOpen, AlignLeft, AlignCenter, Minus, Plus } from "lucide-react";
import { api, API } from "../lib/api";
import { toast } from "sonner";

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [bookData, setBookData] = useState(null); // ArrayBuffer of the EPUB
  const [location, setLocation] = useState(() => {
    try {
      return window.localStorage.getItem(`shelfsort-loc-${id}`) || null;
    } catch (e) {
      return null;
    }
  });
  const [fontSize, setFontSize] = useState(() => {
    const v = parseInt(window.localStorage.getItem("shelfsort-fontsize") || "100", 10);
    return Number.isFinite(v) ? v : 100;
  });
  const [error, setError] = useState(null);
  const renditionRef = useRef(null);

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
  }, [id]);

  // Apply font size whenever rendition is ready or size changes
  const applyFont = useCallback((size) => {
    try {
      if (renditionRef.current) {
        renditionRef.current.themes.fontSize(`${size}%`);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    applyFont(fontSize);
    try { window.localStorage.setItem("shelfsort-fontsize", String(fontSize)); } catch (e) {}
  }, [fontSize, applyFont]);

  const getRendition = (rendition) => {
    renditionRef.current = rendition;
    rendition.themes.register("paper", {
      "body": {
        "color": "#2C2C2C",
        "background": "#FDFBF7",
        "font-family": "'Manrope', sans-serif",
        "line-height": "1.7",
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
  };

  if (error) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-6 text-center">
        <div>
          <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">{error}</h2>
          <button onClick={() => navigate(-1)} className="btn-primary text-sm mt-4">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="backdrop-blur-xl bg-[#FDFBF7]/85 border-b border-[#E8E6E1] z-30">
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
      </header>

      <div className="flex-1 relative" data-testid="reader-area" style={{ minHeight: 0, height: "calc(100vh - 64px)" }}>
        {bookData ? (
          <ReactReader
            url={bookData}
            location={location}
            locationChanged={onLocationChanged}
            getRendition={getRendition}
            epubOptions={{ flow: "paginated" }}
            showToc={true}
            swipeable={true}
          />
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
