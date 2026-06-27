import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";

// pdf.js needs a Web Worker.  We pin the CDN URL to the *exact* version of
// pdfjs-dist that react-pdf ships with — any mismatch breaks page rendering
// with a confusing "API version doesn't match Worker version" error.
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// All pages rendered as a single tall scrolled column.  Feels like a book —
// natural reading flow, no click-to-flip friction — and the IntersectionObserver
// tracks which page is "current" so bookmarks land on the right page.
//
// Props:
//   url          (required)  fully-qualified download URL of the PDF
//   targetPage   (optional)  controlled jump — scrolls to this page when it
//                            changes (e.g. user picked a bookmark)
//   onPageChange (optional)  callback (pageNumber: number) — fires when the
//                            current page changes (after debounce)
//   onTotalPages (optional)  callback (total: number)
//   onProgress   (optional)  callback (pct: 0–1) — fires alongside onPageChange
//   theme        (optional)  "light" | "dark"  — controls bg colour around pages
export default function PdfViewer({
  url,
  targetPage = null,
  onPageChange,
  onTotalPages,
  onProgress,
  theme = "light",
}) {
  const containerRef = useRef(null);
  const pageRefs = useRef([]); // 1-indexed array of div refs, [0] unused
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(800);
  const [scale, setScale] = useState(1.0);
  const [docError, setDocError] = useState(null);

  // Memoise the Document `file` prop so react-pdf doesn't reload the PDF on
  // every render.  Passing an object literal `{ url, withCredentials: true }`
  // would otherwise count as a new file each render and re-fetch the bytes.
  const file = useMemo(() => ({ url, withCredentials: true }), [url]);
  const docOptions = useMemo(() => ({
    // pdf.js downloads its standard fonts and cmaps from the worker bundle —
    // pin both at the CDN matching our worker version.
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
  }), []);

  // Resize observer — keep PDF pages snug to the container width so it works
  // from phone to 4K monitor.  We use 96% of container width to leave a small
  // breathing margin around each page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setPageWidth(Math.min(1100, Math.max(280, Math.floor(w * 0.96))));
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Intersection observer — the page whose centre is closest to the viewport
  // centre is the "current" page.  Fires onPageChange when that flips.
  useEffect(() => {
    if (!numPages) return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the visible entry with the largest intersection ratio.
        let bestRatio = 0;
        let bestPage = currentPage;
        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            const pn = Number(entry.target.getAttribute("data-page"));
            if (Number.isFinite(pn)) {
              bestRatio = entry.intersectionRatio;
              bestPage = pn;
            }
          }
        }
        if (bestPage !== currentPage) {
          setCurrentPage(bestPage);
        }
      },
      { root: el, threshold: [0.25, 0.5, 0.75] }
    );
    for (let i = 1; i <= numPages; i++) {
      const node = pageRefs.current[i];
      if (node) obs.observe(node);
    }
    return () => obs.disconnect();
  }, [numPages, currentPage]);

  // Notify parent of page changes.
  useEffect(() => {
    if (!currentPage || !numPages) return;
    onPageChange && onPageChange(currentPage);
    onProgress && onProgress(currentPage / numPages);
  }, [currentPage, numPages, onPageChange, onProgress]);

  // Controlled jump from outside (e.g. user clicked a bookmark).
  useEffect(() => {
    if (!targetPage || !numPages) return;
    const clamped = Math.max(1, Math.min(numPages, targetPage));
    const node = pageRefs.current[clamped];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targetPage, numPages]);

  const onDocLoad = useCallback((pdf) => {
    setNumPages(pdf.numPages);
    pageRefs.current = new Array(pdf.numPages + 1);
    onTotalPages && onTotalPages(pdf.numPages);
  }, [onTotalPages]);

  const onDocError = useCallback((err) => {
    setDocError(err?.message || "Couldn't open this PDF");
  }, []);

  const goPage = useCallback((n) => {
    const clamped = Math.max(1, Math.min(numPages, n));
    const node = pageRefs.current[clamped];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [numPages]);

  // Keyboard navigation: PageDown/Space/J/ArrowDown = next, PageUp/K/ArrowUp = prev.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key === "PageDown" || key === "ArrowRight" || (key === " " && !e.shiftKey)) {
        e.preventDefault();
        goPage(currentPage + 1);
      } else if (key === "PageUp" || key === "ArrowLeft" || (key === " " && e.shiftKey)) {
        e.preventDefault();
        goPage(currentPage - 1);
      } else if (key.toLowerCase() === "j") {
        e.preventDefault();
        goPage(currentPage + 1);
      } else if (key.toLowerCase() === "k") {
        e.preventDefault();
        goPage(currentPage - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPage, currentPage]);

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col w-full"
      data-testid="pdf-viewer"
    >
      {/* Top control strip — page jumper, zoom controls.  Sticks to the top
          of the viewer so it's always reachable while scrolling. */}
      <div
        className={`sticky top-0 z-10 flex items-center gap-3 px-3 py-2 border-b ${
          isDark ? "bg-zinc-900 border-zinc-700 text-zinc-100" : "bg-white border-[#E5DDC5] text-[#2C2C2C]"
        }`}
        data-testid="pdf-controls"
      >
        <button
          type="button"
          aria-label="Previous page"
          data-testid="pdf-prev"
          onClick={() => goPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className={`p-1.5 rounded-md disabled:opacity-30 ${
            isDark ? "hover:bg-zinc-800" : "hover:bg-[#F5F3EC]"
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1 text-sm">
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={currentPage}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) goPage(n);
            }}
            data-testid="pdf-page-input"
            className={`w-14 text-center rounded border text-sm py-0.5 ${
              isDark ? "bg-zinc-800 border-zinc-700 text-zinc-100" : "bg-white border-[#E5DDC5]"
            }`}
          />
          <span className="opacity-60">/ {numPages || "…"}</span>
        </div>
        <button
          type="button"
          aria-label="Next page"
          data-testid="pdf-next"
          onClick={() => goPage(currentPage + 1)}
          disabled={!numPages || currentPage >= numPages}
          className={`p-1.5 rounded-md disabled:opacity-30 ${
            isDark ? "hover:bg-zinc-800" : "hover:bg-[#F5F3EC]"
          }`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            data-testid="pdf-zoom-out"
            onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}
            className={`p-1.5 rounded-md ${
              isDark ? "hover:bg-zinc-800" : "hover:bg-[#F5F3EC]"
            }`}
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-xs w-10 text-center opacity-70">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            data-testid="pdf-zoom-in"
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}
            className={`p-1.5 rounded-md ${
              isDark ? "hover:bg-zinc-800" : "hover:bg-[#F5F3EC]"
            }`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrolled stack of pages. */}
      <div
        ref={containerRef}
        className={`overflow-y-auto ${isDark ? "bg-zinc-950" : "bg-[#F2EEE5]"}`}
        style={{ height: "calc(100vh - 240px)", minHeight: "560px", maxHeight: "calc(100vh - 240px)" }}
        data-testid="pdf-scroll"
      >
        {docError ? (
          <div className="p-10 text-center text-sm text-red-600">
            Couldn&rsquo;t open this PDF: {docError}
          </div>
        ) : (
          <Document
            file={file}
            options={docOptions}
            onLoadSuccess={onDocLoad}
            onLoadError={onDocError}
            loading={
              <div className="p-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className={`w-6 h-6 animate-spin ${isDark ? "text-zinc-400" : "text-[#6B705C]"}`} />
                <p className={`text-sm ${isDark ? "text-zinc-400" : "text-[#6B705C]"}`}>Opening PDF…</p>
              </div>
            }
            error={
              <div className="p-10 text-center text-sm text-red-600">
                Couldn&rsquo;t open this PDF. The file may be corrupted or password-protected.
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pn) => (
              <div
                key={pn}
                data-page={pn}
                data-testid={`pdf-page-${pn}`}
                ref={(el) => { pageRefs.current[pn] = el; }}
                className="flex justify-center py-3"
              >
                <div className={`shadow ${isDark ? "shadow-black/60" : "shadow-black/10"}`}>
                  <Page
                    pageNumber={pn}
                    width={pageWidth * scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={
                      <div
                        style={{ width: pageWidth * scale, height: (pageWidth * scale) * 1.41 }}
                        className={`flex items-center justify-center ${isDark ? "bg-zinc-800" : "bg-white"}`}
                      >
                        <Loader2 className={`w-5 h-5 animate-spin ${isDark ? "text-zinc-500" : "text-[#6B705C]"}`} />
                      </div>
                    }
                  />
                </div>
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
