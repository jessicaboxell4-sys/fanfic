import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import UploadZone from "../components/UploadZone";
import OnboardingPrompt from "../components/OnboardingPrompt";
import HelpNudge from "../components/HelpNudge";
import BackupReminderBanner from "../components/BackupReminderBanner";
import LibraryActivityWidgets from "../components/LibraryActivityWidgets";
import UrlPasteCard from "../components/UrlPasteCard";
import DashboardHelpCard from "../components/DashboardHelpCard";
import DashboardSuggestionsBox from "../components/DashboardSuggestionsBox";
import FriendRecsCard from "../components/FriendRecsCard";
import DuplicateResolutionModal from "../components/DuplicateResolutionModal";
import UrlListDedupeModal from "../components/UrlListDedupeModal";
import { Library, ArrowRight, Pin, RotateCcw, BarChart3 } from "lucide-react";
import { toast } from "sonner";

// One-shot "what's new" banner fired on the user's next visit to the
// dashboard after a notable visual / UX shift. Bump the version suffix
// to re-fire for everyone after the next big change.
const WHATSNEW_KEY = "shelfsort_whatsnew_2026-06-13_chips";

/**
 * Welcome dashboard at `/library`. Intentionally lean — replaces the old
 * Dashboard.jsx (now AllBooksPage.jsx at /library/all) with a curated
 * landing focused on:
 *   1. Library headline + top fandoms
 *   2. "Since you were last here" activity ribbon
 *   3. Reading-queue stub + Surprise me / Books I haven't read pills
 *   4. Big upload drop zone
 *   5. Spotlighted URL paste card (Filter out URLs you already own)
 *   6. Persistent ribbons: backup reminder, library polish, help nudge
 *   7. Pinned smart shelves rail (only if user has any pinned)
 *
 * Browse-all-books CTA links to `/library/all` for the full grid.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total: 0, fandoms: [] });
  const [pinnedShelves, setPinnedShelves] = useState([]);
  const [pendingDupes, setPendingDupes] = useState([]);
  const [pendingUrlLists, setPendingUrlLists] = useState([]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/books/stats");
      setStats({ total: data?.total || 0, fandoms: data?.fandoms || [] });
    } catch (e) { /* non-blocking */ }
    try {
      const sh = await api.get("/smart-shelves");
      setPinnedShelves((sh.data.shelves || []).filter((s) => s.pinned));
    } catch (e) { /* non-blocking */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // What's new — fire once per user. Toast points at the Help legend so
  // existing readers discover the new chip-icon conventions instantly.
  useEffect(() => {
    let seen = "0";
    try { seen = localStorage.getItem(WHATSNEW_KEY) || "0"; } catch { /* ignore */ }
    if (seen === "1") return;
    const markSeen = () => {
      try { localStorage.setItem(WHATSNEW_KEY, "1"); } catch { /* ignore */ }
    };
    const id = setTimeout(() => {
      toast("New chip icons across your library", {
        description: "⇄ crossover · ♡ pairing · 👤 author — peek at the chip key on the Help page.",
        duration: 12000,
        action: {
          label: "Show me",
          onClick: () => { markSeen(); navigate("/help"); },
        },
        onDismiss: markSeen,
        onAutoClose: markSeen,
      });
    }, 1200);
    return () => clearTimeout(id);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-14 fade-in">
        <BackupReminderBanner />
        <OnboardingPrompt />
        <HelpNudge />

        {/* Hero: eyebrow + book count + top fandoms */}
        <header className="mb-8" data-testid="dashboard-hero">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            Your library
          </p>
          <h1 className="font-serif text-5xl sm:text-6xl text-[#2C2C2C] leading-[1.05] tracking-tight">
            {stats.total > 0
              ? <>{stats.total.toLocaleString()} <span className="text-[#6B705C]">{stats.total > 1 ? "books" : "book"} on the shelves.</span></>
              : "Let’s build your shelves."}
          </h1>
          {stats.fandoms?.length > 0 && (
            <p className="text-[#6B705C] mt-3 text-lg" data-testid="dashboard-top-fandoms">
              {stats.fandoms.slice(0, 4).map(f => `${f.name} (${f.count})`).join(" · ")}
            </p>
          )}
        </header>

        {/* Activity ribbon — includes "Since you were last here" alert,
            Surprise-me + Books-I-haven't-read pills, and the "Up next"
            reading-queue stub. Everything user-facing for daily browsing. */}
        <div className="mb-7">
          <LibraryActivityWidgets />
        </div>

        {/* Single prominent CTA into the full library grid. The activity
            widget above already shows the Surprise/Unread chips so we
            don't repeat them — this is the one new CTA on the lean
            welcome dashboard. */}
        <div className="flex justify-end mb-12">
          <Link
            to="/library/all"
            data-testid="browse-all-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] transition-colors shadow-sm"
          >
            <Library className="w-4 h-4" /> Browse all books
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Big drop zone — primary upload affordance */}
        <section className="mb-8" data-testid="dashboard-upload">
          <UploadZone
            onUploaded={(dupes, _actions, urlLists) => {
              if (dupes && dupes.length > 0) setPendingDupes(dupes);
              if (urlLists && urlLists.length > 0) setPendingUrlLists(urlLists);
              load();
            }}
          />
        </section>

        {/* Spotlighted URL paste card — bigger, always-visible textarea */}
        <section className="mb-10">
          <UrlPasteCard />
        </section>

        {/* Help + Suggestions — surfaced prominently so new users always
            know where to ask, and so the suggestions board grows. */}
        <section
          data-testid="dashboard-help-suggestions"
          className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10"
        >
          <DashboardHelpCard />
          <DashboardSuggestionsBox />
        </section>

        {/* Friend recommendations — auto-hides if there's nothing to show */}
        <FriendRecsCard />

        {/* Pinned smart shelves — only when the user has some */}
        {pinnedShelves.length > 0 && (
          <section className="mb-10" data-testid="dashboard-pinned-shelves">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] inline-flex items-center gap-2">
                <Pin className="w-3 h-3" /> Pinned smart shelves
              </p>
              <Link
                to="/library/smart-shelves"
                data-testid="manage-smart-shelves"
                className="text-xs text-[#6B46C1] hover:text-[#2C2C2C] font-semibold uppercase tracking-wider"
              >
                Manage →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {pinnedShelves.map((s) => (
                <button
                  key={s.shelf_id}
                  data-testid={`open-smart-shelf-${s.shelf_id}`}
                  onClick={() => navigate(`/library/smart/${s.shelf_id}`)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#FDF3E1] text-[#B87A00] border-[#B87A00]/30 hover:bg-[#B87A00] hover:text-white transition-colors flex items-center gap-1.5"
                >
                  {s.name} · {s.count}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Quick-action footer chips */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B705C] pt-6 border-t border-[#E8E6E1]" data-testid="dashboard-quick-actions">
          <Link to="/library/stats" className="inline-flex items-center gap-1 hover:text-[#6B46C1]"><BarChart3 className="w-3 h-3" /> Stats</Link>
          <span>·</span>
          <Link to="/library/smart-shelves" className="hover:text-[#6B46C1]">Smart shelves</Link>
          <span>·</span>
          <Link to="/library/tags" className="hover:text-[#6B46C1]">Tags</Link>
          <span>·</span>
          <Link to="/account" className="hover:text-[#6B46C1]">Backups &amp; account</Link>
          <span>·</span>
          <Link to="/library/cant-find-online" className="hover:text-[#6B46C1] inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Can’t find online</Link>
        </div>
      </main>

      {/* Modal flows that can fire from uploads */}
      {pendingDupes.length > 0 && (
        <DuplicateResolutionModal
          dupes={pendingDupes}
          onClose={() => { setPendingDupes([]); load(); }}
        />
      )}
      {pendingUrlLists.length > 0 && (
        <UrlListDedupeModal
          reports={pendingUrlLists}
          onClose={() => setPendingUrlLists([])}
        />
      )}
    </div>
  );
}
