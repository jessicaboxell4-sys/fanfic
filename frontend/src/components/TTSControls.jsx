import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Headphones,
  Play,
  Pause,
  Square,
  Settings,
  X as XIcon,
  Volume2,
} from "lucide-react";

/**
 * TTSControls — browser-native Read-Aloud for the EPUB reader.
 *
 * Built 2026-07-04 in response to a real Facebook-group commenter
 * requesting an audio "read-aloud" feature.  Uses the Web Speech API
 * (`window.speechSynthesis`) so it stays free, private, and adds zero
 * backend cost — every voice runs locally in the user's browser.
 *
 * Design choices:
 *   • Paragraph-by-paragraph speaking so the user's place in the
 *     book is always observable (we add `data-tts-active` to the
 *     current paragraph and scroll-into-view it).
 *   • Auto-advance to the next page when the last paragraph
 *     finishes.  Stops at end-of-book.
 *   • Voice picker + speed slider live in a popover triggered by
 *     a "Listen" button in the reader toolbar.
 *   • Persists chosen voice + rate in localStorage so reopening
 *     a book restores the user's preference.
 *   • Self-contained — receives only the rendition from the
 *     parent.  Works in both paginated and scrolled flows.
 *
 * Browser support: Chrome, Edge, Safari, Firefox ≥49.  Fail-soft —
 * if speechSynthesis is missing the button hides itself.
 */
export default function TTSControls({ rendition, flow, onPageChange }) {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [open, setOpen] = useState(false);          // popover open
  const [playing, setPlaying] = useState(false);    // is anything queued
  const [paused, setPaused] = useState(false);      // pause button state
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(() => {
    try {
      return localStorage.getItem("shelfsort-tts-voice") || "";
    } catch {
      return "";
    }
  });
  const [rate, setRate] = useState(() => {
    try {
      const r = parseFloat(localStorage.getItem("shelfsort-tts-rate"));
      return Number.isFinite(r) && r >= 0.5 && r <= 2 ? r : 1;
    } catch {
      return 1;
    }
  });

  // Internal queue + current paragraph index.  Ref-tracked so the
  // utterance.onend callback can read the latest values without
  // closure staleness.
  const queueRef = useRef([]);  // array of { text, el }
  const idxRef = useRef(0);
  const stoppingRef = useRef(false);
  const currentElRef = useRef(null);

  // Persist preferences.
  useEffect(() => {
    try {
      if (voiceURI) localStorage.setItem("shelfsort-tts-voice", voiceURI);
    } catch {/* ignore */}
  }, [voiceURI]);
  useEffect(() => {
    try { localStorage.setItem("shelfsort-tts-rate", String(rate)); } catch {/* ignore */}
  }, [rate]);

  // Voice list is async on Chrome — wait for the voiceschanged event.
  useEffect(() => {
    if (!supported) return undefined;
    const synth = window.speechSynthesis;
    const refresh = () => {
      const list = synth.getVoices() || [];
      setVoices(list);
    };
    refresh();
    synth.addEventListener?.("voiceschanged", refresh);
    return () => synth.removeEventListener?.("voiceschanged", refresh);
  }, [supported]);

  // Once voices are known, auto-pick a sensible default if the user
  // hasn't chosen one yet (no localStorage value carried over).
  useEffect(() => {
    if (voiceURI || voices.length === 0) return;
    const en = voices.find((v) => v.default && v.lang?.startsWith("en"))
      || voices.find((v) => v.lang?.startsWith("en"))
      || voices[0];
    if (en) setVoiceURI(en.voiceURI);
  }, [voices, voiceURI]);

  // Pull text content from the rendition's current rendered contents.
  // epubjs gives us an array of Contents objects (one per visible
  // section); each has .document we can walk.  We grab paragraphs +
  // headings so chapter titles get spoken too.
  const collectParagraphs = useCallback(() => {
    if (!rendition) return [];
    let contents = [];
    try {
      contents = rendition.getContents() || [];
    } catch {
      return [];
    }
    const out = [];
    for (const c of contents) {
      const doc = c?.document;
      if (!doc) continue;
      const nodes = doc.querySelectorAll(
        "p, h1, h2, h3, h4, h5, h6, blockquote, li",
      );
      nodes.forEach((el) => {
        const txt = (el.textContent || "").trim();
        // Skip empty or single-character (typical drop-cap shells).
        if (txt.length > 1) out.push({ text: txt, el });
      });
    }
    return out;
  }, [rendition]);

  // Highlight the current paragraph + scroll it into view inside the
  // iframe.  A subtle `data-tts-active` attribute lets the parent
  // stylesheet draw a left border without us injecting CSS here.
  const highlight = useCallback((el) => {
    if (currentElRef.current && currentElRef.current !== el) {
      currentElRef.current.removeAttribute("data-tts-active");
    }
    currentElRef.current = el;
    if (!el) return;
    el.setAttribute("data-tts-active", "true");
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {/* ignore */}
  }, []);

  const stopAll = useCallback(() => {
    if (!supported) return;
    stoppingRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {/* ignore */}
    if (currentElRef.current) {
      currentElRef.current.removeAttribute("data-tts-active");
      currentElRef.current = null;
    }
    queueRef.current = [];
    idxRef.current = 0;
    setPlaying(false);
    setPaused(false);
    // Reset the stopping flag on next tick so subsequent plays work.
    setTimeout(() => { stoppingRef.current = false; }, 50);
  }, [supported]);

  // Speak whatever's at idxRef.  When done, advance.  When the queue
  // is exhausted we ask the rendition for the next page and refill.
  const speakAt = useCallback((index) => {
    if (!supported) return;
    if (stoppingRef.current) return;
    const item = queueRef.current[index];
    if (!item) {
      // Out of paragraphs in this view — try to advance the page.
      try {
        rendition?.next?.();
      } catch {/* ignore */}
      // Give epub.js ~600ms to render the next page, then refill.
      setTimeout(() => {
        if (stoppingRef.current) return;
        const next = collectParagraphs();
        if (next.length === 0) {
          // End of book (or empty page) — stop gracefully.
          stopAll();
          return;
        }
        queueRef.current = next;
        idxRef.current = 0;
        speakAt(0);
      }, 650);
      return;
    }
    highlight(item.el);
    const u = new SpeechSynthesisUtterance(item.text);
    const v = voices.find((vv) => vv.voiceURI === voiceURI);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = rate;
    u.onend = () => {
      if (stoppingRef.current) return;
      idxRef.current = index + 1;
      speakAt(idxRef.current);
    };
    u.onerror = () => {
      // Don't get stuck — advance past the failing paragraph.
      if (stoppingRef.current) return;
      idxRef.current = index + 1;
      speakAt(idxRef.current);
    };
    try {
      window.speechSynthesis.speak(u);
    } catch {
      stopAll();
    }
  }, [supported, voices, voiceURI, rate, rendition, collectParagraphs, highlight, stopAll]);

  const startReading = useCallback(() => {
    if (!supported) return;
    // Always cancel any existing queue first.  Older browsers
    // (Safari particularly) get confused if you queue two at once.
    try { window.speechSynthesis.cancel(); } catch {/* ignore */}
    const list = collectParagraphs();
    if (list.length === 0) return;
    queueRef.current = list;
    idxRef.current = 0;
    setPlaying(true);
    setPaused(false);
    speakAt(0);
  }, [supported, collectParagraphs, speakAt]);

  const togglePause = useCallback(() => {
    if (!supported || !playing) return;
    const synth = window.speechSynthesis;
    if (paused) {
      try { synth.resume(); } catch {/* ignore */}
      setPaused(false);
    } else {
      try { synth.pause(); } catch {/* ignore */}
      setPaused(true);
    }
  }, [supported, playing, paused]);

  // If the user manually pages or closes the book mid-read, stop
  // speaking — otherwise the iframe's old paragraph stays "active"
  // visually and the audio keeps reading text the user can't see.
  // We hook the rendition's relocated event for this.
  useEffect(() => {
    if (!rendition) return undefined;
    const onRelocated = () => {
      // Only auto-stop when the user paged manually (NOT when our
      // own .next() advance fired).  Heuristic: if we have a queue
      // we're mid-read and this came from us; otherwise it's a
      // user action.  The simplest safe behavior is: if not playing
      // we don't care, if playing AND queue is empty we don't care,
      // if playing AND idx < queue.length user clicked — stop.
      if (playing && idxRef.current < queueRef.current.length) {
        // We were mid-paragraph and the page moved without us
        // reaching the end — must've been the user.  Stop.
        stopAll();
      }
      onPageChange?.();
    };
    rendition.on("relocated", onRelocated);
    return () => {
      try { rendition.off("relocated", onRelocated); } catch {/* ignore */}
    };
  }, [rendition, playing, stopAll, onPageChange]);

  // Hard-stop when this component unmounts (user closed the reader).
  useEffect(() => {
    return () => {
      if (supported) {
        try { window.speechSynthesis.cancel(); } catch {/* ignore */}
      }
    };
  }, [supported]);

  // Inject one-time CSS into every rendered section's iframe so the
  // current paragraph gets a calm highlight without us mutating each
  // paragraph's inline style.  epubjs fires a `rendered` event for
  // every visible section; we add the rule into its iframe document.
  useEffect(() => {
    if (!rendition) return undefined;
    const STYLE = `
      [data-tts-active] {
        background: linear-gradient(90deg, rgba(224,122,95,0.14), rgba(224,122,95,0));
        border-left: 3px solid #E07A5F;
        padding-left: 8px;
        transition: background 250ms ease;
      }
    `;
    const inject = (section, view) => {
      try {
        const doc = view?.document || view?.contents?.document;
        if (!doc || doc.getElementById("__shelfsort_tts_css")) return;
        const tag = doc.createElement("style");
        tag.id = "__shelfsort_tts_css";
        tag.textContent = STYLE;
        doc.head?.appendChild(tag);
      } catch {/* ignore */}
    };
    rendition.on("rendered", inject);
    // Also inject into anything already rendered when we mount.
    try {
      (rendition.getContents() || []).forEach((c) => {
        if (c?.document && !c.document.getElementById("__shelfsort_tts_css")) {
          const tag = c.document.createElement("style");
          tag.id = "__shelfsort_tts_css";
          tag.textContent = STYLE;
          c.document.head?.appendChild(tag);
        }
      });
    } catch {/* ignore */}
    return () => {
      try { rendition.off("rendered", inject); } catch {/* ignore */}
    };
  }, [rendition]);

  if (!supported) return null;

  return (
    <div className="relative">
      {/* Compact toolbar control: Listen / Pause / Stop */}
      {!playing ? (
        <button
          type="button"
          data-testid="tts-listen-btn"
          onClick={startReading}
          className="flex items-center gap-1.5 text-xs font-medium bg-white border border-[#E8E6E1] rounded-full px-3 py-1.5 hover:bg-[#F5F3EC]"
          title="Read this aloud (uses your browser's voice)"
        >
          <Headphones className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Listen</span>
        </button>
      ) : (
        <div className="flex items-center gap-1 bg-white border border-[#E8E6E1] rounded-full px-1.5 py-1">
          <button
            type="button"
            data-testid="tts-pause-btn"
            onClick={togglePause}
            className="w-7 h-7 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            data-testid="tts-stop-btn"
            onClick={stopAll}
            className="w-7 h-7 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center"
            title="Stop reading"
          >
            <Square className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-[#6B705C] uppercase tracking-wider px-1">
            {paused ? "Paused" : "Reading"}
          </span>
        </div>
      )}

      {/* Settings cog — separate so it's reachable while playing.
          Clicking opens the popover with voice + speed pickers. */}
      <button
        type="button"
        data-testid="tts-settings-btn"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex w-7 h-7 rounded-full hover:bg-[#F5F3EC] items-center justify-center text-[#6B705C]"
        title="Voice and speed"
        aria-pressed={open}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {/* Settings popover */}
      {open && (
        <div
          data-testid="tts-settings-popover"
          className="absolute right-0 top-10 z-50 w-72 bg-white border border-[#E5DDC5] shadow-lg rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="font-serif text-sm text-[#2C2C2C] flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-[#6B46C1]" />
              Read aloud
            </p>
            <button
              type="button"
              data-testid="tts-popover-close"
              onClick={() => setOpen(false)}
              className="text-[#6B705C] hover:text-[#2C2C2C]"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <label className="block text-[10px] uppercase tracking-wider text-[#6B705C] font-semibold mb-1">
            Voice
          </label>
          <select
            data-testid="tts-voice-select"
            value={voiceURI}
            onChange={(e) => {
              setVoiceURI(e.target.value);
              if (playing) {
                // Re-speak from the current paragraph with the new voice.
                stopAll();
                setTimeout(startReading, 80);
              }
            }}
            className="w-full text-sm border border-[#E5DDC5] rounded-md px-2 py-1.5 mb-3 bg-white"
          >
            {voices.length === 0 && <option value="">Loading voices…</option>}
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang}){v.default ? " · default" : ""}
              </option>
            ))}
          </select>

          <label className="block text-[10px] uppercase tracking-wider text-[#6B705C] font-semibold mb-1">
            Speed: <span className="text-[#2C2C2C] font-bold">{rate.toFixed(2)}×</span>
          </label>
          <input
            data-testid="tts-rate-slider"
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-full accent-[#6B46C1]"
          />
          <div className="flex justify-between text-[10px] text-[#6B705C] mt-0.5">
            <span>0.5×</span><span>1×</span><span>2×</span>
          </div>

          <p className="mt-3 text-[11px] text-[#6B705C] leading-snug">
            Voices come from your browser/OS. Free, private, no extra accounts.
            On phones, some Bluetooth headsets pause the speech if the screen
            sleeps — keep the tab visible for the smoothest experience.
          </p>
        </div>
      )}
    </div>
  );
}
