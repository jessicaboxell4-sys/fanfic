import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2, CheckCheck, RotateCcw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";

/**
 * Bulk metadata cleanup — "Polish my library".
 *
 * Fetches `/books/polish/preview`, lets the user check title / author
 * suggestions per-book, then submits the chosen set to `/books/polish/apply`.
 */
export default function PolishLibraryPage() {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [stats, setStats] = useState({ candidates_scanned: 0, returned: 0 });
  const [selected, setSelected] = useState({}); // book_id -> {apply_title, apply_author}
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(null);
  // 2026-07-04 — Live AV-scan status for the inline progress banner
  // that replaces the older 3-toast chain.  `phase` walks through
  // 'polishing' → 'scanning' → 'complete'/'failed'.  `scanProgress`
  // is polled every 1.5s from /account/safety/rescan-progress while
  // phase === 'scanning' so the user sees "X of Y books scanned"
  // climb in real time.
  const [phase, setPhase] = useState(null); // null | 'polishing' | 'scanning' | 'complete' | 'failed'
  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 0 });
  const [scanSummary, setScanSummary] = useState(null);

  const load = async () => {
    setLoading(true);
    setDone(null);
    try {
      const { data } = await api.get("/books/polish/preview?limit=300");
      setSuggestions(data.suggestions || []);
      setStats({
        candidates_scanned: data.candidates_scanned || 0,
        returned: data.returned || 0,
      });
      // Default: pre-check every suggestion that's non-null.
      const next = {};
      for (const s of data.suggestions || []) {
        next[s.book_id] = {
          apply_title: !!s.suggested_title,
          apply_author: !!s.suggested_author,
        };
      }
      setSelected(next);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't scan your library");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleAll = (value) => {
    const next = {};
    for (const s of suggestions) {
      next[s.book_id] = {
        apply_title: value && !!s.suggested_title,
        apply_author: value && !!s.suggested_author,
      };
    }
    setSelected(next);
  };

  const toggleOne = (bid, field) => {
    setSelected((prev) => ({
      ...prev,
      [bid]: {
        ...(prev[bid] || { apply_title: false, apply_author: false }),
        [field]: !(prev[bid] || {})[field],
      },
    }));
  };

  const acceptedCount = Object.values(selected).reduce(
    (n, v) => n + (v.apply_title ? 1 : 0) + (v.apply_author ? 1 : 0),
    0
  );

  const apply = async () => {
    const items = suggestions
      .filter((s) => {
        const sel = selected[s.book_id];
        return sel && (sel.apply_title || sel.apply_author);
      })
      .map((s) => ({
        book_id: s.book_id,
        apply_title: !!(selected[s.book_id]?.apply_title && s.suggested_title),
        apply_author: !!(selected[s.book_id]?.apply_author && s.suggested_author),
      }));
    if (items.length === 0) {
      toast("Nothing selected to apply");
      return;
    }
    setApplying(true);
    setPhase("polishing");
    setScanSummary(null);
    setScanProgress({ scanned: 0, total: 0 });
    try {
      const { data } = await api.post("/books/polish/apply", { items });
      const epubWrites = (data.details || []).filter((d) => d.epub_written === true).length;
      setDone({
        updated: data.updated,
        skipped: data.skipped,
        epubWrites,
      });
      // Drop the just-applied books from the list and re-fetch quietly to
      // pick up anything we missed (e.g., follow-on candidates after a fix).
      const appliedIds = new Set(items.map((it) => it.book_id));
      setSuggestions((prev) => prev.filter((s) => !appliedIds.has(s.book_id)));

      // 2026-07-04 — Background AV scan with live progress polling.
      // Replaces the older 3-toast chain.  We kick the rescan, then
      // poll /account/safety/rescan-progress every 1.5s until it
      // reports `in_progress: false`.  The inline status banner above
      // the suggestions list reads from `scanProgress` directly.
      setPhase("scanning");
      let pollTimer = null;
      const startPolling = () => {
        pollTimer = setInterval(async () => {
          try {
            const { data: prog } = await api.get("/account/safety/rescan-progress");
            setScanProgress({ scanned: prog.scanned || 0, total: prog.total || 0 });
            if (!prog.in_progress && prog.total > 0) {
              // Scan finished — stop polling. The main rescan
              // promise will resolve with the full summary shortly.
              clearInterval(pollTimer);
              pollTimer = null;
            }
          } catch {
            // Swallow polling errors — we'll find out about a real
            // failure via the main rescan promise.
          }
        }, 1500);
      };
      startPolling();
      try {
        const { data: scan } = await api.post("/account/safety/rescan", {});
        if (pollTimer) clearInterval(pollTimer);
        setScanSummary({
          scanned: scan?.scanned || 0,
          flagged: scan?.flagged || 0,
        });
        // Reflect the final number in the progress display.
        setScanProgress({
          scanned: scan?.scanned || 0,
          total: scan?.scanned || 0,
        });
        setPhase("complete");
      } catch (scanErr) {
        if (pollTimer) clearInterval(pollTimer);
        const status = scanErr?.response?.status;
        if (status === 524 || status === 504) {
          // Scan still running on the server — show that state.
          setPhase("scanning-detached");
        } else if (status === 503) {
          setPhase("av-unavailable");
        } else {
          console.warn("Auto-scan after polish failed:", scanErr);
          setPhase("scan-failed");
        }
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't apply changes");
      setPhase("failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Link to="/library" className="text-sm text-[#6B705C] hover:text-[#2C2C2C] inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> back to library
        </Link>
        <div className="flex items-start gap-3 mb-2">
          <div className="w-11 h-11 rounded-xl bg-[#EDE7FB] text-[#6B46C1] flex items-center justify-center">
            <Wand2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">Bulk cleanup</p>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Polish my library</h1>
            <p className="text-sm text-[#6B705C] mt-2 max-w-2xl">
              We scanned your library for books whose <strong>title</strong> still looks like a
              filename (<code>book_abc123</code>, <code>fic_12345.epub</code>) and whose{" "}
              <strong>author</strong> is <em>Unknown</em>, blank, or anonymous. Where we can guess a
              cleaner value (from the file or the source URL), we&apos;ve queued it below. You stay
              in control — uncheck anything that looks wrong before applying.
            </p>
            <p className="text-xs text-[#6B705C] mt-3">
              Looking to fix missing cover art instead?{" "}
              <Link
                to="/library/polish-covers"
                className="font-semibold text-[#6B46C1] hover:underline"
                data-testid="polish-library-covers-link"
              >
                Polish my covers →
              </Link>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
          <button
            data-testid="polish-apply-btn"
            onClick={apply}
            disabled={applying || acceptedCount === 0}
            className="px-4 py-2 rounded-full bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#5b3aa5] disabled:opacity-60 inline-flex items-center gap-2"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Apply {acceptedCount} change{acceptedCount === 1 ? "" : "s"}
          </button>
          <button
            data-testid="polish-select-all"
            onClick={() => toggleAll(true)}
            disabled={applying}
            className="px-3 py-2 rounded-full bg-white border border-[#E8E6E1] text-sm font-medium hover:bg-[#F5F3EC]"
          >
            Select all
          </button>
          <button
            data-testid="polish-select-none"
            onClick={() => toggleAll(false)}
            disabled={applying}
            className="px-3 py-2 rounded-full bg-white border border-[#E8E6E1] text-sm font-medium hover:bg-[#F5F3EC]"
          >
            Select none
          </button>
          <button
            data-testid="polish-rescan"
            onClick={load}
            disabled={applying || loading}
            className="px-3 py-2 rounded-full bg-white border border-[#E8E6E1] text-sm font-medium hover:bg-[#F5F3EC] inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Rescan
          </button>
          <span className="text-xs text-[#6B705C] ml-auto">
            {stats.returned} suggestion{stats.returned === 1 ? "" : "s"} · {stats.candidates_scanned} candidate{stats.candidates_scanned === 1 ? "" : "s"} scanned
          </span>
        </div>

        {/* 2026-07-04 — Phase-aware status banner replaces the old
            polish-success-only one + the toast chain.  Walks through
            polishing → scanning (with live X/Y counter) → complete. */}
        {phase && (
          <div
            data-testid="polish-status-banner"
            className={`rounded-xl p-4 mb-4 text-sm border ${
              phase === "complete"
                ? "bg-[#E6F4EA] border-[#22A06B]/30 text-[#1E6B3F]"
                : phase === "failed" || phase === "scan-failed"
                ? "bg-[#FDECEC] border-[#E07A5F]/30 text-[#9C4521]"
                : phase === "av-unavailable" || phase === "scanning-detached"
                ? "bg-[#FFF7E6] border-[#E0A95F]/40 text-[#7C5400]"
                : "bg-[#EDE7FB]/60 border-[#6B46C1]/20 text-[#4C2A99]"
            }`}
          >
            {phase === "polishing" && (
              <p className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Polishing your library…
              </p>
            )}
            {phase === "scanning" && (
              <>
                <p className="flex items-center gap-2 font-semibold">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Polished{done && ` ${done.updated} book${done.updated === 1 ? "" : "s"}`} · Scanning for viruses…
                </p>
                {scanProgress.total > 0 ? (
                  <>
                    <p className="text-xs mt-1.5 mb-1.5">
                      <span data-testid="scan-progress-text" className="font-mono">
                        {scanProgress.scanned} / {scanProgress.total}
                      </span>{" "}
                      books scanned
                      {scanProgress.total === 500 && (
                        <span className="text-[#7C5400]"> · (first 500 — see note when complete)</span>
                      )}
                    </p>
                    <div className="w-full h-1.5 rounded-full bg-[#6B46C1]/10 overflow-hidden">
                      <div
                        data-testid="scan-progress-bar"
                        className="h-full bg-[#6B46C1] transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.round((scanProgress.scanned / Math.max(1, scanProgress.total)) * 100))}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs mt-1.5">Counting your library…</p>
                )}
              </>
            )}
            {phase === "complete" && (
              <>
                <p className="flex items-center gap-2 font-semibold">
                  <Sparkles className="w-4 h-4" />
                  Done!
                </p>
                <p className="text-xs mt-1">
                  Polished {done?.updated || 0} book{(done?.updated || 0) === 1 ? "" : "s"}
                  {done?.epubWrites > 0 && ` (${done.epubWrites} EPUB file${done.epubWrites === 1 ? "" : "s"} rewritten)`}
                  {scanSummary?.scanned > 0 && (
                    <> · Scanned {scanSummary.scanned} book{scanSummary.scanned === 1 ? "" : "s"}{scanSummary.flagged > 0 ? ` · ${scanSummary.flagged} flagged` : " · all clean"}</>
                  )}
                  {done?.skipped > 0 && ` · ${done.skipped} skipped`}
                </p>
                {/* 2026-07-04 — Per-scan cap nudge.  The backend caps
                    each rescan at 500 books to keep the run reasonable.
                    When we hit that cap exactly, the user might have
                    more books still unscanned — gently tell them so
                    they can polish again or run a manual rescan. */}
                {scanSummary?.scanned === 500 && (
                  <p className="text-[11px] mt-2 text-[#7C5400] bg-[#FFF7E6] border border-[#E0A95F]/40 rounded px-2 py-1.5">
                    Heads up: each scan covers up to 500 books at a time. If your library has more, polish again — or visit{" "}
                    <Link to="/account/safety" className="underline font-semibold">Account → Library safety</Link>
                    {" "}to sweep the rest.
                  </p>
                )}
              </>
            )}
            {phase === "scanning-detached" && (
              <p>
                ⏳ Polished {done?.updated || 0} book{(done?.updated || 0) === 1 ? "" : "s"}. Scan is still running on the server — check Account → Safety in a few minutes for the result.
              </p>
            )}
            {phase === "av-unavailable" && (
              <p>
                ✅ Polished {done?.updated || 0} book{(done?.updated || 0) === 1 ? "" : "s"}. Antivirus is currently unavailable — your library will be scanned automatically the next time you polish, or you can manually rescan from Account → Safety.
              </p>
            )}
            {phase === "scan-failed" && (
              <p>
                ⚠️ Polished {done?.updated || 0} book{(done?.updated || 0) === 1 ? "" : "s"}, but the antivirus scan couldn&apos;t start. Try a manual rescan from Account → Safety later.
              </p>
            )}
            {phase === "failed" && (
              <p>Couldn&apos;t apply changes. Try again in a moment.</p>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#6B705C]">Scanning…</p>
        ) : suggestions.length === 0 ? (
          <div className="bg-white border border-[#E8E6E1] rounded-xl p-8 text-center">
            <Sparkles className="w-8 h-8 text-[#6B46C1] mx-auto mb-2" />
            <p className="font-serif text-xl text-[#2C2C2C] mb-1">Your library looks great!</p>
            <p className="text-sm text-[#6B705C]">
              Every title and author in your library is either already clean or we couldn&apos;t
              find a reliable cleaner version. You can run this again any time.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="polish-suggestions">
            {suggestions.map((s) => {
              const sel = selected[s.book_id] || {};
              return (
                <li
                  key={s.book_id}
                  data-testid={`polish-row-${s.book_id}`}
                  className="bg-white border border-[#E8E6E1] rounded-xl p-3 hover:shadow-sm transition-shadow"
                >
                  {s.suggested_title && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid={`polish-title-${s.book_id}`}
                        checked={!!sel.apply_title}
                        onChange={() => toggleOne(s.book_id, "apply_title")}
                        className="mt-1.5 accent-[#6B46C1]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-[#6B705C] mb-0.5">Title</p>
                        <p className="text-sm">
                          <span className="text-[#B43F26] line-through font-mono break-all">{s.current_title || "(blank)"}</span>
                          <span className="text-[#6B705C] mx-2">→</span>
                          <span className="text-[#2C2C2C] font-semibold">{s.suggested_title}</span>
                        </p>
                      </div>
                    </label>
                  )}
                  {s.suggested_author && (
                    <label className={`flex items-start gap-3 cursor-pointer ${s.suggested_title ? "mt-2 pt-2 border-t border-[#F5F3EC]" : ""}`}>
                      <input
                        type="checkbox"
                        data-testid={`polish-author-${s.book_id}`}
                        checked={!!sel.apply_author}
                        onChange={() => toggleOne(s.book_id, "apply_author")}
                        className="mt-1.5 accent-[#6B46C1]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-[#6B705C] mb-0.5">
                          Author <span className="text-[#6B705C] normal-case font-normal">(inferred from source URL)</span>
                        </p>
                        <p className="text-sm">
                          <span className="text-[#B43F26] line-through font-mono">{s.current_author || "(blank)"}</span>
                          <span className="text-[#6B705C] mx-2">→</span>
                          <span className="text-[#2C2C2C] font-semibold">{s.suggested_author}</span>
                        </p>
                      </div>
                    </label>
                  )}
                  <div className="mt-2 text-[11px] text-[#6B705C] flex items-center gap-3">
                    <Link to={`/book/${s.book_id}`} className="hover:underline">View book</Link>
                    {s.fandom && <span className="opacity-70">· {s.fandom}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
