import React, { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, Square } from "lucide-react";

// PDF-flavoured Text-to-Speech.
//
// The EPUB TTSControls is tightly coupled to epubjs's `rendition`
// concept (it walks `Contents` objects, listens to `relocated`, etc.).
// PDFs render via react-pdf's text-layer divs in the DOM, so it's
// simpler to drive a smaller dedicated controller that:
//
//   1. Scrapes the rendered text layer for the current page out of
//      the DOM (we use the `[data-testid="pdf-page-N"]` wrappers
//      PdfViewer already provides).
//   2. Speaks every paragraph-ish chunk through Web Speech API.
//   3. When the page is done, calls `onAdvance()` so the parent can
//      scroll to the next page; we re-scrape on the next tick.
//   4. Stops cleanly on pause / page-change-from-outside / unmount.
//
// Reuses the same Web Speech API as EPUB TTS, so the voice the user
// picked there persists here (localStorage key `shelfsort-tts-voice`).
const SUPPORTED = typeof window !== "undefined" && "speechSynthesis" in window;

export default function PdfTtsControls({ currentPage, totalPages, scrollContainerRef, onAdvance }) {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const stoppingRef = useRef(false);
  const queueRef = useRef([]);
  const idxRef = useRef(0);
  const pageRef = useRef(currentPage);
  useEffect(() => { pageRef.current = currentPage; }, [currentPage]);

  // Pull paragraph-like chunks out of the rendered text layer of the
  // currently visible PDF page.  react-pdf renders each glyph as its
  // own `<span>` but groups them into a per-line wrapper, so we walk
  // the page wrapper's children and collect the joined per-line text.
  const collectPageText = useCallback((pageNum) => {
    const wrap = document.querySelector(`[data-testid="pdf-page-${pageNum}"]`);
    if (!wrap) return [];
    const layer = wrap.querySelector(".react-pdf__Page__textContent");
    if (!layer) return [];
    // Each direct-child div of the textContent layer corresponds to a
    // line.  We join their text content; the browser already handles
    // spacing within a line via the inner spans.
    const lines = Array.from(layer.querySelectorAll(":scope > span, :scope > div"))
      .map((el) => (el.textContent || "").trim())
      .filter((s) => s.length > 1);
    // Coalesce short fragments into ~paragraph chunks so utterances
    // are smoothly readable (1–2 sentences each).
    const out = [];
    let buf = "";
    for (const line of lines) {
      if (buf && /[.!?]"?$/.test(buf)) { out.push(buf); buf = ""; }
      buf = buf ? `${buf} ${line}` : line;
    }
    if (buf) out.push(buf);
    return out;
  }, []);

  const stopAll = useCallback(() => {
    if (!SUPPORTED) return;
    stoppingRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {/* ignore */}
    queueRef.current = [];
    idxRef.current = 0;
    setPlaying(false);
    setPaused(false);
    setTimeout(() => { stoppingRef.current = false; }, 50);
  }, []);

  // Speak one chunk; chain to next on `onend`.  When the queue is
  // exhausted, advance to the next page (if any) and re-scrape.
  const speakAt = useCallback((index) => {
    if (!SUPPORTED || stoppingRef.current) return;
    const text = queueRef.current[index];
    if (!text) {
      // End of page — advance.
      const next = (pageRef.current || 1) + 1;
      if (next > (totalPages || 0)) {
        stopAll();
        return;
      }
      onAdvance && onAdvance(next);
      // Give the page a beat to render its text layer, then re-prime.
      setTimeout(() => {
        if (stoppingRef.current) return;
        const chunks = collectPageText(next);
        queueRef.current = chunks;
        idxRef.current = 0;
        if (chunks.length > 0) speakAt(0);
        else {
          // Some PDF pages have no text layer (scanned images).
          // Skip past them gracefully.
          speakAt(0);
        }
      }, 400);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    // Re-use the voice the user picked in EPUB TTS, if any.
    try {
      const stored = localStorage.getItem("shelfsort-tts-voice");
      const rate = parseFloat(localStorage.getItem("shelfsort-tts-rate") || "1.0");
      if (Number.isFinite(rate)) u.rate = rate;
      if (stored) {
        const v = (window.speechSynthesis.getVoices() || []).find((vv) => vv.voiceURI === stored);
        if (v) u.voice = v;
      }
    } catch {/* ignore */}
    u.onend = () => {
      if (stoppingRef.current) return;
      idxRef.current = index + 1;
      speakAt(idxRef.current);
    };
    u.onerror = () => { if (!stoppingRef.current) { idxRef.current = index + 1; speakAt(idxRef.current); } };
    try {
      window.speechSynthesis.speak(u);
    } catch {/* ignore */}
  }, [totalPages, collectPageText, onAdvance, stopAll]);

  const start = useCallback(() => {
    if (!SUPPORTED) return;
    try { window.speechSynthesis.cancel(); } catch {/* ignore */}
    const chunks = collectPageText(pageRef.current || 1);
    if (chunks.length === 0) return;
    queueRef.current = chunks;
    idxRef.current = 0;
    setPlaying(true);
    setPaused(false);
    speakAt(0);
  }, [collectPageText, speakAt]);

  const togglePause = useCallback(() => {
    if (!SUPPORTED) return;
    const synth = window.speechSynthesis;
    if (paused) { synth.resume(); setPaused(false); }
    else { synth.pause(); setPaused(true); }
  }, [paused]);

  // Stop on unmount.
  useEffect(() => stopAll, [stopAll]);

  if (!SUPPORTED) return null;

  return (
    <div className="flex items-center gap-1" data-testid="pdf-tts-controls">
      {!playing && (
        <button
          type="button"
          data-testid="pdf-tts-start"
          onClick={start}
          className="px-2 py-1 text-xs rounded-md border border-[#E5DDC5] hover:bg-[#F5F3EC] text-[#2C2C2C] inline-flex items-center gap-1"
          title="Read this PDF aloud (Web Speech)"
        >
          <Headphones className="w-3.5 h-3.5" /> Read aloud
        </button>
      )}
      {playing && (
        <>
          <button
            type="button"
            data-testid="pdf-tts-pause"
            onClick={togglePause}
            className="p-1 rounded hover:bg-[#F5F3EC]"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="w-4 h-4 text-[#2C2C2C]" /> : <Pause className="w-4 h-4 text-[#2C2C2C]" />}
          </button>
          <button
            type="button"
            data-testid="pdf-tts-stop"
            onClick={stopAll}
            className="p-1 rounded hover:bg-[#F5F3EC]"
            title="Stop"
          >
            <Square className="w-4 h-4 text-[#2C2C2C]" />
          </button>
        </>
      )}
    </div>
  );
}
