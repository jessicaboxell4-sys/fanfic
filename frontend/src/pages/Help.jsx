import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import SuggestionBox from "../components/SuggestionBox";
import { api } from "../lib/api";
import {
  ArrowLeft, ArrowLeftRight, Upload, Sparkles, Layers, RefreshCw, BookOpen, Trash2,
  Filter, Heart, AlertTriangle, Settings, GitCompare, Bell, LineChart,
  Globe, Shield, CheckCircle2, Clock, FileWarning, User as UserIcon, X,
  MessageSquare, Search, ListChecks, AtSign, Target, Compass, Lightbulb,
  Dna, Repeat, Command, Send,
} from "lucide-react";

// Help guide — kept current with the app. Last updated: 2026-06-20.
// When you add a feature, drop a new <Section> here; the sticky table
// of contents builds itself from each section's `id`.

// "What's new" card. The card pulls from `GET /api/announcements/latest`
// at runtime; if the API returns nothing (fresh install, network error)
// we fall back to FALLBACK_WHATS_NEW below. To ship a new note WITHOUT a
// deploy, POST to /api/announcements with a fresh `version` string.
// `version` doubles as the per-user localStorage dismissal key.
const FALLBACK_WHATS_NEW = {
  version: "2026-06-20-finished-similar-dna",
  title: "Fresh in Shelfsort",
  items: [
    { to: "/library/all", label: "Finished a book? Get a similar one", desc: "— hit ≥ 95 % on any book and the BookDetail page now shows up to six other titles from YOUR library that share the same fandom or author, prioritising the ones you haven't finished. Soft landing after the last page." },
    { to: "/library/stats", label: "Reader DNA card on /stats", desc: "— a one-glance “what kind of reader am I?” panel: top 3 fandoms, fanfic-vs-original split bar, average book length in words, and Comfort reads — books you finished AND opened again in the last 30 days." },
    { label: "Cmd / Ctrl + Shift + D toggles dark mode", desc: "— a global keyboard shortcut for instant light↔dark flip. Skips text inputs so it never clobbers your paste." },
    { to: "/account/safety", label: "Antivirus rescan nudge", desc: "— a gentle banner appears if your last full library scan is more than 90 days old (or if you have unscanned books). One click runs a fresh sweep; one click dismisses it for the day." },
    { to: "/", label: "Honest homepage counters", desc: "— the Landing page now shows books · readers · fandoms tiles, with test-account fixtures filtered out so the numbers reflect REAL people building libraries." },
    { label: "Shared reader links skip the welcome tour", desc: "— following a /read/<book_id> link or a URL with ?from=share lands you straight in the Reader instead of popping the onboarding tour over your book." },
    { to: "/account/safety", label: "Antivirus on every upload", desc: "— every file you add (and every cloud restore) is scanned by ClamAV before it lands in your library. Visit your Library safety report to see counts + rescan on demand." },
    { to: "/rules", label: "Community rules", desc: "— Shelfsort has a written code of conduct. No spam, no politics, no hate speech or bullying, no piracy promotion, respect IP, be kind. Skim it from the footer or the register checkbox." },
  ],
};
const WHATS_NEW_KEY = "shelfsort.whatsNewDismissed";
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SECTIONS = [
  { id: "feedback", label: "Send us feedback" },
  { id: "getting-started", label: "Getting started" },
  { id: "tour", label: "First-time tour" },
  { id: "dashboard-tour", label: "Dashboard tour" },
  { id: "uploads", label: "Uploading books" },
  { id: "quick-search", label: "Navbar quick-search" },
  { id: "shelves", label: "Shelves & filters" },
  { id: "discovery", label: "Browsing & discovery" },
  { id: "ao3-metadata", label: "AO3 metadata: ratings, warnings, tags" },
  { id: "ao3-filters", label: "AO3 filter chips & Save-as-shelf" },
  { id: "smart-shelves", label: "Smart shelves" },
  { id: "reading-queue", label: "Reading queue (Up next)" },
  { id: "goals", label: "Reading goals" },
  { id: "filter-urls", label: "Filter URLs you already own" },
  { id: "fandoms", label: "Fandoms we sort into" },
  { id: "sources", label: "Sources we recognize" },
  { id: "detection", label: "Detection & overrides" },
  { id: "data-safety", label: "Backup & restore" },
  { id: "cloud-backup", label: "Cloud library mirror" },
  { id: "antivirus", label: "Antivirus & library safety" },
  { id: "rules", label: "Community rules" },
  { id: "reading", label: "Reader & stats" },
  { id: "cross-device", label: "Cross-device reading sync" },
  { id: "reading-insights", label: "Reading insights (Re-read · Pace · Cohort)" },
  { id: "similar-books", label: "Finished a book? Want a similar one" },
  { id: "reader-dna", label: "Reader DNA & comfort reads" },
  { id: "year-in-books", label: "Year in Books (Wrapped recap)" },
  { id: "usernames", label: "Public usernames & @handles" },
  { id: "messages", label: "Messages & friends" },
  { id: "bookclubs", label: "Book-club reading rooms" },
  { id: "covers", label: "Community Covers" },
  { id: "recommendations", label: "Friend recommendations" },
  { id: "opds", label: "E-reader sync (OPDS)" },
  { id: "send-to-kindle", label: "Send to Kindle" },
  { id: "notifications", label: "Notifications & mutes" },
  { id: "push", label: "Web push notifications" },
  { id: "auto-theme", label: "Scheduled auto-theme" },
  { id: "keyboard-shortcuts", label: "Keyboard shortcuts" },
  { id: "word-count", label: "Word count & reading time" },
  { id: "account", label: "Account & preferences" },
  { id: "operator-digest", label: "Operator weekly digest (admin)" },
];

function Section({ id, icon: Icon, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 mb-12">
      <h2 className="font-serif text-2xl md:text-3xl text-[#2C2C2C] flex items-center gap-3 mb-3">
        {Icon && <Icon className="w-6 h-6 text-[#E07A5F]" />}
        {title}
      </h2>
      <div className="prose prose-sm max-w-none text-[#2C2C2C] leading-relaxed">{children}</div>
    </section>
  );
}

export default function Help() {
  const { hash } = useLocation();
  const [whatsNew, setWhatsNew] = useState(FALLBACK_WHATS_NEW);
  const [knownFandoms, setKnownFandoms] = useState([]);
  const [fandomGroups, setFandomGroups] = useState([]);
  const [showWhatsNew, setShowWhatsNew] = useState(() => {
    try {
      return localStorage.getItem(WHATS_NEW_KEY) !== FALLBACK_WHATS_NEW.version;
    } catch {
      return true;
    }
  });
  // Live filter: hides whole <Section>s + TOC entries that don't contain
  // the typed text. Single-state, no debounce — list is small enough.
  const [query, setQuery] = useState("");
  const [matchingSectionIds, setMatchingSectionIds] = useState(SECTIONS.map((s) => s.id));

  // Popular-section ordering: fetch click counts from /api/help/popular
  // and re-rank the TOC by genuine engagement. The top 5 most-clicked
  // sections jump to the top of the list (visually highlighted with a
  // small "popular" pill); the rest preserve the curated order so
  // newer users still get a logical reading flow.
  const [popular, setPopular] = useState([]);   // [{section, hits}]
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/help/popular", { params: { days: 30, limit: 5 } });
        if (!cancelled) setPopular(data?.rows || []);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const popularIds = popular.map((p) => p.section);

  // Re-order: popular ids first (in their hit-count order), then the
  // remaining curated order.  Filter step still applies on top.
  const orderedSections = (() => {
    if (!popularIds.length) return SECTIONS;
    const seen = new Set();
    const out = [];
    for (const pid of popularIds) {
      const s = SECTIONS.find((x) => x.id === pid);
      if (s) { out.push(s); seen.add(pid); }
    }
    for (const s of SECTIONS) {
      if (!seen.has(s.id)) out.push(s);
    }
    return out;
  })();

  // After the article renders, recompute matches whenever query changes.
  // Reads DOM text directly, so it must run after layout.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setMatchingSectionIds(SECTIONS.map((s) => s.id));
      SECTIONS.forEach((s) => {
        const el = document.getElementById(s.id);
        if (el) el.style.display = "";
      });
      return;
    }
    const matches = [];
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      const text = (el.innerText || el.textContent || "").toLowerCase();
      const hit = text.includes(q);
      el.style.display = hit ? "" : "none";
      if (hit) matches.push(s.id);
    });
    setMatchingSectionIds(matches);
  }, [query]);

  // Fetch the latest server-side announcement on mount. If one exists and
  // is newer than what the user has dismissed, swap it in and show the
  // card. Network/auth errors silently keep the bundled fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/announcements/latest`, { withCredentials: true });
        if (cancelled || !res.data || !res.data.version) return;
        setWhatsNew(res.data);
        let dismissedVersion = null;
        try { dismissedVersion = localStorage.getItem(WHATS_NEW_KEY); } catch { /* unavailable */ }
        setShowWhatsNew(dismissedVersion !== res.data.version);
      } catch {
        /* fallback stays */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissWhatsNew = () => {
    try { localStorage.setItem(WHATS_NEW_KEY, whatsNew.version); } catch { /* localStorage unavailable */ }
    setShowWhatsNew(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/fandoms/known`, { withCredentials: true });
        if (cancelled || !res.data?.fandoms) return;
        setKnownFandoms(res.data.fandoms);
        if (Array.isArray(res.data.groups)) setFandomGroups(res.data.groups);
      } catch { /* keep empty — the Section just shows nothing */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hash]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="px-4 lg:px-8 py-10">
        <div className="lg:flex lg:items-start lg:gap-10 max-w-7xl mx-auto">
          {/* Left rail: sticky scrollable TOC.  On mobile it stacks above the
              article inside a collapsible <details>; on lg+ it pins to the
              left edge of the wrapper, Wikipedia-style. */}
          <nav
            className="lg:sticky lg:top-24 lg:w-56 lg:shrink-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2 lg:[scrollbar-width:thin] mb-6 lg:mb-0"
            data-testid="help-toc"
          >
            <details className="lg:open:!block lg:[&]:!block" open>
              <summary className="lg:hidden cursor-pointer select-none text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 px-1 py-2 rounded-lg border border-[#E8E6E1] bg-white">
                Sections
              </summary>
              <p className="hidden lg:block text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
                Sections
              </p>
              <ul className="space-y-1.5 text-sm pt-2 lg:pt-0">
                {orderedSections.filter((s) => matchingSectionIds.includes(s.id)).map((s) => {
                  const popIdx = popularIds.indexOf(s.id);
                  return (
                    <li key={s.id} className="flex items-center gap-1.5">
                      <a
                        href={`#${s.id}`}
                        onClick={() => { try { api.post("/help/track", { section: s.id }); } catch { /* fire-and-forget */ } }}
                        className="text-[#6B705C] hover:text-[#E07A5F] flex-1"
                      >
                        {s.label}
                      </a>
                      {popIdx >= 0 && popIdx < 3 && (
                        <span
                          title={`Popular this month — ${popular[popIdx]?.hits || 0} clicks`}
                          data-testid={`toc-popular-${s.id}`}
                          className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-[#FDF3E1] text-[#8C5C00] border border-[#F5E0A8]"
                        >
                          popular
                        </span>
                      )}
                    </li>
                  );
                })}
                {SECTIONS.length > 0 && matchingSectionIds.length === 0 && (
                  <li className="text-[10px] italic text-[#6B705C]">no matches — clear search to see all</li>
                )}
              </ul>
            </details>
          </nav>

          {/* Right column: back link, header, what's new, then the article.
              Capped at max-w-3xl so paragraphs stay easy to read on large
              screens (matches the Wikipedia content column). */}
          <div className="flex-1 min-w-0 lg:max-w-3xl">
            <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
              <ArrowLeft className="w-4 h-4" /> back to library
            </Link>

        <header className="mb-8">
          <h1 className="font-serif text-5xl md:text-6xl text-[#2C2C2C] leading-tight">Help</h1>
          <p className="text-[#6B705C] mt-2">How to do everything in Shelfsort. Last updated 2026-06-18.</p>
          <p className="text-sm text-[#6B705C] mt-3">
            Don&rsquo;t see what you&rsquo;re looking for? <Link to="/suggestions" className="text-[var(--primary)] font-semibold underline">Drop a suggestion →</Link> — bugs, tweaks, brand new ideas all welcome.
          </p>

          {/* Chip-icon legend — teaches the visual shorthand used across the
              library rails so newcomers can read a chip's "type" at a glance. */}
          <div
            data-testid="help-chip-legend"
            className="mt-5 inline-flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 rounded-2xl border border-[#E5DDC5] bg-white text-xs text-[#6B705C]"
          >
            <span className="font-bold uppercase tracking-[0.15em] text-[#6B46C1]">Chip key</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#EDE7FB] text-[#6B46C1] text-[10px] font-semibold leading-none">
                Aa
              </span>
              fandom
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center gap-0.5 min-w-[26px] h-[18px] px-1.5 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none">
                <ArrowLeftRight className="w-2.5 h-2.5" aria-hidden="true" />2
              </span>
              crossover
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-[#6B46C1]" aria-hidden="true" />
              pairing
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-[#6B46C1]" aria-hidden="true" />
              author
            </span>
          </div>

          <div className="mt-5 relative max-w-md" data-testid="help-search-wrapper">
            <Search className="w-4 h-4 text-[#6B705C] absolute top-1/2 -translate-y-1/2 left-3 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the docs… (e.g. palette, friends, EPUB)"
              data-testid="help-search-input"
              className="w-full pl-9 pr-9 py-2.5 text-sm rounded-full border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                data-testid="help-search-clear"
                className="absolute top-1/2 -translate-y-1/2 right-2 p-1 rounded-full text-[#6B705C] hover:bg-[#FBFAF6]"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {query.trim() && (
            <p
              data-testid="help-search-summary"
              className={`text-xs mt-2 ${matchingSectionIds.length === 0 ? "text-[#B43F26]" : "text-[#6B705C]"}`}
            >
              {matchingSectionIds.length === 0
                ? `No sections match "${query}". Try a broader term.`
                : `${matchingSectionIds.length} section${matchingSectionIds.length === 1 ? "" : "s"} match`}
            </p>
          )}
          {!query.trim() && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3" data-testid="help-search-chips">
              <span className="text-[10px] uppercase tracking-wider text-[#6B705C] font-semibold mr-1">Try:</span>
              {["palette", "goals", "@handle", "friends", "EPUB", "shelves", "backup"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setQuery(chip)}
                  data-testid={`help-search-chip-${chip.replace(/\s+/g, "-")}`}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[#E5DDC5] bg-white text-[#6B705C] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </header>

        <aside
          data-testid="help-whats-new"
          hidden={!showWhatsNew}
          className="mb-10 rounded-2xl border border-[#E07A5F]/30 bg-gradient-to-br from-[#FCEFE6] to-[#F8E3D3] p-5 md:p-6 shadow-sm relative"
        >
          <button
            type="button"
            onClick={dismissWhatsNew}
            data-testid="help-whats-new-dismiss"
            aria-label="Dismiss what's new"
            className="absolute top-3 right-3 p-1.5 rounded-full text-[#6B705C] hover:text-[#2C2C2C] hover:bg-white/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E07A5F] text-white text-[10px] font-bold uppercase tracking-[0.15em] px-2.5 py-1 shrink-0">
              <Sparkles className="w-3 h-3" /> New
            </span>
            <div className="flex-1">
              <h2 className="font-serif text-xl md:text-2xl text-[#2C2C2C] mb-2">{whatsNew.title}</h2>
              <ul className="text-sm text-[#2C2C2C] space-y-1.5 leading-relaxed">
                {whatsNew.items.map((item) => {
                  const [primary, secondary] = item.label.split(" & ");
                  return (
                    <li key={item.to}>
                      <Link to={item.to} className="text-[#E07A5F] hover:underline font-medium">{primary}</Link>
                      {item.link_to_2 && (
                        <>
                          {" & "}
                          <Link to={item.link_to_2} className="text-[#E07A5F] hover:underline font-medium">{secondary}</Link>
                        </>
                      )}
                      {" "}{item.desc}
                    </li>
                  );
                })}
              </ul>
              <a href="#shelves" className="inline-block mt-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#E07A5F]">
                Jump to the full shelf guide →
              </a>
            </div>
          </div>
        </aside>

        {/* What's new strip — surfaces recent features so users can find them */}
        <div className="mb-8 p-5 rounded-2xl border border-[#E5DDC5] bg-[#FDFBF7]" data-testid="whats-new-strip">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">What&apos;s new</p>
            <button
              type="button"
              data-testid="help-replay-tour"
              onClick={() => {
                try { window.localStorage.removeItem("shelfsort_tour_seen"); } catch (e) {/*ignore*/}
                window.dispatchEvent(new Event("shelfsort:replay-tour"));
              }}
              className="text-[11px] font-semibold text-[#6B46C1] hover:text-[#553B96] underline"
            >
              Replay tour →
            </button>
          </div>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-[#2C2C2C] list-disc list-inside">
            <li><a href="#cloud-backup" className="hover:underline font-semibold">Cloud library mirror</a> — survives redeploys, one-click backup, avatar shield-check</li>
            <li><a href="#cross-device" className="hover:underline font-semibold">Cross-device reading sync</a> — Resume on any device, Web Push handoff</li>
            <li><a href="#reading-insights" className="hover:underline font-semibold">Reading insights</a> — Re-read · Pace · Cohort pills on BookDetail</li>
            <li><a href="#covers" className="hover:underline font-semibold">Community Covers</a> — vote, remix, public SEO-friendly profiles</li>
            <li><Link to="/goals" className="hover:underline font-semibold">Reading goals</Link> — yearly &amp; monthly targets, confetti on hit</li>
            <li><a href="#year-in-books" className="hover:underline font-semibold">Year in Books</a> — Spotify-Wrapped style yearly recap</li>
            <li><a href="#usernames" className="hover:underline font-semibold">Public usernames &amp; @handles</a> with autocomplete</li>
            <li><a href="#quick-search" className="hover:underline">Navbar book quick-search</a> — typeahead jumps</li>
            <li><a href="#push" className="hover:underline">Web push notifications</a> — device handoff alerts</li>
            <li><a href="#bookclubs" className="hover:underline">Book-club reading rooms</a> — chat-style + buddy-pacing</li>
            <li><a href="#word-count" className="hover:underline">Word count &amp; reading time</a> with WPM setting</li>
            <li><a href="#recommendations" className="hover:underline">Friend recommendations</a> + weekly Sunday digest</li>
            <li><a href="#auto-theme" className="hover:underline">Scheduled auto-theme</a> (light by day / dark by night)</li>
            <li><a href="#opds" className="hover:underline">E-reader sync (OPDS)</a> for KOReader, Moon+, Marvin</li>
            <li><a href="#notifications" className="hover:underline">Per-kind notification mutes</a></li>
            <li><a href="#messages" className="hover:underline">Friends &amp; DMs unified</a> at /friends with inline chat drawer</li>
            <li><a href="#operator-digest" className="hover:underline">Operator weekly digest</a> (admin-only)</li>
          </ul>
        </div>

        <div className="grid md:grid-cols-1 gap-10">
          <article className="min-w-0 break-words">
            <Section id="feedback" icon={Lightbulb} title="Send us feedback">
              <p>Got a bug, a feature wish, or a screen that feels confusing? Drop us a note here — every suggestion lands in the team&apos;s triage queue. You can attach a screenshot if showing is easier than telling.</p>
              <ul>
                <li><strong>Device picker</strong> (required) — when you submit on the <Link to="/suggestions">Suggestions board</Link>, you pick which device you&apos;re on: <em>iPhone, iPad, Android phone/tablet, Mac, Windows PC, Linux, Chromebook, Amazon Fire, Kindle e-reader,</em> or <em>Other</em>. The picker auto-detects from your browser and remembers your last choice. &ldquo;Other&rdquo; lets you type in a custom device (Steam Deck, BOOX Note, Surface Duo, etc.) — your entry gets added to the picker so other users with the same device see it too.</li>
                <li><strong>Why required?</strong> A bug that says &ldquo;the reader is laggy&rdquo; is unhelpful; &ldquo;the reader is laggy on Amazon Fire&rdquo; is actionable. The device chip shows on every suggestion card so vote-givers know whether a report applies to their setup.</li>
                <li><strong>Pictures only</strong> — attachments are limited to images under 10 MB (PNG/JPEG). Other file types should go via our support email.</li>
              </ul>
              <SuggestionBox source="help-page" />
            </Section>

            <Section id="getting-started" icon={Sparkles} title="Getting started">
              <p>Shelfsort organizes your EPUB library by fandom, author, pairing, completion status, and reading progress — built for fanfiction readers but works for any ebook collection.</p>
              <ol>
                <li>Sign in with email + password (or Google OAuth)</li>
                <li>Drop an EPUB onto the upload zone on the dashboard</li>
                <li>Watch it get auto-classified onto the right shelf, with status and pairings extracted</li>
                <li>Click <Link to="/library/all">Browse all books</Link> to see the full grid; click any cover to read it in-browser</li>
              </ol>
              <p>Everything is auto-detected at upload time — you only step in when you want to override.</p>
            </Section>

            <Section id="tour" icon={Compass} title="First-time tour">
              <p>The first time you land on a fresh account, a friendly overlay walks you through Shelfsort&rsquo;s main hubs: <strong>Library</strong>, <strong>Friends &amp; DMs</strong>, <strong>Reading rooms</strong>, <strong>Recommendations</strong>, <strong>Appearance</strong> (light/dark + colour scheme), <strong>Account &amp; usernames</strong>, and <strong>Suggestions &amp; feedback</strong>. Each step highlights the relevant page so you know where the feature lives, not just what it does.</p>
              <ul>
                <li><strong>Skip any step</strong> — &ldquo;Skip tour&rdquo; dismisses it for good, &ldquo;Next&rdquo; advances one step at a time, &ldquo;Back&rdquo; goes one step back.</li>
                <li><strong>Replay later</strong> — at the top of this Help page, hit the <em>Replay tour →</em> link in the &ldquo;What&rsquo;s new&rdquo; strip. It clears the localStorage flag and re-opens the overlay on your next dashboard visit.</li>
                <li><strong>Per-browser memory</strong> — the &ldquo;seen&rdquo; flag lives in localStorage, so the tour reappears if you sign in on a new device or wipe browser data.</li>
              </ul>
            </Section>

            <Section id="dashboard-tour" icon={Sparkles} title="Dashboard tour (the welcome page)">
              <p>The page you land on after signing in is your <strong>welcome dashboard</strong> at <code>/library</code>. It’s deliberately lean — the full books grid lives on its own <Link to="/library/all">All books</Link> page. From the dashboard you can:</p>
              <ul>
                <li><strong>See your library at a glance</strong> — total book count, top 4 fandoms with counts, &ldquo;Since you were last here&rdquo; activity ribbon.</li>
                <li><strong>Upload</strong> — the big drop zone accepts files OR a whole folder. EPUBs go straight in; PDFs / MOBI / DOCX / TXT get a confirmation prompt then Calibre-convert.</li>
                <li><strong>Filter a URL list</strong> — the spotlighted &ldquo;Have a list of fanfic URLs?&rdquo; card lets you paste a list of AO3 / FFnet / RoyalRoad / SpaceBattles links right on the dashboard. It detects the count live and ships you to the <Link to="/library/filter-urls">full filter page</Link> with the list pre-loaded. See <a href="#filter-urls">Filter URLs you already own</a>.</li>
                <li><strong>Up next</strong> — your reading queue surfaces here (see <a href="#reading-queue">Reading queue</a>).</li>
                <li><strong>Pinned smart shelves</strong> — appear as quick chips once you’ve pinned any.</li>
                <li><strong>Help &amp; Suggestions</strong> — two cards at the bottom: this guide on the left, a 5-second feedback box on the right.</li>
              </ul>
              <p>The persistent ribbons at the top — Backup reminder, Polish your library, Help nudge — only appear when relevant (overdue backup, un-templated EPUBs, etc.). Dismissing one is remembered.</p>
            </Section>

            <Section id="uploads" icon={Upload} title="Uploading books">
              <p>The upload zone accepts <strong>files and folders</strong>. Drag-and-drop or click <em>Choose files</em> / <em>Pick a folder</em>.</p>
              <p><strong>Supported formats:</strong></p>
              <ul>
                <li><code>.epub</code> — added silently, full pipeline (metadata + classification + cover + chapters + Reader)</li>
                <li><code>.pdf .mobi .azw .azw3 .kfx .docx .doc .rtf .fb2 .lit .lrf .pdb .html .htm</code> — confirmation prompt, then auto-converted to EPUB via Calibre</li>
                <li><code>.txt</code> with prose — confirm + convert</li>
                <li><code>.txt</code> with fanfic URLs (≥3 URL lines or ≥40% of lines) — treated as a URL list, dedupe-and-skip flow</li>
              </ul>
              <p><strong>What happens during upload:</strong> metadata is extracted, the book is classified onto a category (Fanfiction / Original Fiction / Non-fiction / etc.), the fandom is detected from <strong>{knownFandoms.length || "150+"}</strong> canonical fandoms, relationships/pairings are extracted, completion status is detected (see &ldquo;Detection &amp; overrides&rdquo;), and any embedded source URLs are saved for future dedupe + the Linkless filter.</p>
              <p><strong>Duplicates</strong> are caught three ways: (1) by exact source-URL or shared canonical fanfic URL (so all AO3 / FFN / RoyalRoad mirrors of the same work collapse together), (2) by <strong>title + author</strong> match (case-insensitive, dots stripped from author so &lsquo;J. K. Rowling&rsquo; and &lsquo;JK Rowling&rsquo; still pair), and (3) by title alone <em>only when one side has no author on file</em>. Two books with the same generic title (e.g. &ldquo;Crossroads&rdquo;) but different authors and different URLs are correctly kept as separate books. When a dupe is flagged you choose: keep both / replace older / skip. Cross-format duplicates (same book uploaded as PDF after the EPUB) are filed under <Link to="/library/originals">Originals</Link>.</p>
            </Section>

            <Section id="quick-search" icon={Search} title="Navbar quick-search">
              <p>The magnifying-glass field in the top navbar is a typeahead jumpgate to anything in your library. Start typing a title, an author, or a fragment of either, and a dropdown shows the top matches. Pick one with a click or hit <kbd>Enter</kbd> on the highlighted row to land directly on that book&rsquo;s detail page.</p>
              <ul>
                <li><strong>Matches both title and author</strong> in a single query — &ldquo;rowling&rdquo; surfaces all J.K. Rowling books, &ldquo;harry potter&rdquo; surfaces every HP fic.</li>
                <li><strong>Debounced</strong> so you can type at full speed without firing a request per keystroke.</li>
                <li><strong>Keyboard-first</strong> — arrow keys move through suggestions, <kbd>Esc</kbd> closes the dropdown, <kbd>Enter</kbd> navigates.</li>
                <li><strong>No match?</strong> The dropdown collapses quietly — your full-text search (inside an open EPUB) is still the place to find a passage by phrase.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Tip: pair this with <strong>Surprise me</strong> on the dashboard when you can&rsquo;t decide what to read.</p>
            </Section>

            <Section id="shelves" icon={Layers} title="Shelves & filters">
              <p>Every book lives on multiple shelves at once. Click any chip on the dashboard or use the URLs below directly.</p>
              <ul>
                <li><strong>Fandom shelves</strong> (auto) — one per detected fandom, with crossover detection</li>
                <li><strong><Link to="/library/crossovers">Crossovers</Link></strong> — fics belonging to 2+ fandoms</li>
                <li><strong><Link to="/library/complete">Finished</Link></strong> <CheckCircle2 className="inline w-3 h-3" /> — books with a definitive ending (default for anything without an explicit ongoing signal)</li>
                <li><strong><Link to="/library/ongoing">Ongoing</Link></strong> <Clock className="inline w-3 h-3" /> — WIPs, in-progress, hiatus, abandoned, or &quot;Chapter X of Y&quot; where X &lt; Y</li>
                <li><strong><Link to="/library/linkless">Linkless</Link></strong> — books with no embedded source URL (originals, very old uploads, manuscripts). Lets you paste a source URL after the fact via the inline claim flow.</li>
                <li><strong><Link to="/library/unreadable">Unreadable</Link></strong> <FileWarning className="inline w-3 h-3" /> — files that couldn&apos;t be parsed (corrupt EPUBs) or converted (Calibre rejected a PDF/Kindle/DOCX). Original bytes stay on disk so you can download a copy to inspect or delete it.</li>
                <li><strong><Link to="/library/originals">Originals</Link></strong> — books you uploaded as PDF/MOBI/AZW/DOCX/etc. and chose to keep as-is (without running Calibre). Each row has three buttons:
                  <ul>
                    <li><strong>Read</strong> opens the smart in-app viewer at <code>/read-original/&lt;book_id&gt;</code>. PDF/HTML/HTM render via your browser&apos;s built-in viewer; TXT renders in a clean serif layout; DOCX is converted to HTML client-side via mammoth.js; everything else (MOBI, AZW, AZW3, KF8, KFX, FB2, LIT, LRF, PDB, DOC, RTF) gets a one-click <em>Convert to EPUB and read</em> button that runs Calibre and lands you in the regular reader.
                      <br />
                      Inside the viewer, PDFs and scroll-based formats (TXT/DOCX) support <strong>bookmarks</strong>: click <em>Bookmark</em> (or hit <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>B</kbd>) to save the current page (PDF — you&apos;ll be asked which page number) or scroll position (TXT/DOCX). The bookmark count chip opens a panel where you can jump back, type a note, and remove bookmarks. Same backend as EPUB bookmarks, so they show up on the <Link to="/bookmarks">Bookmarks page</Link> too.</li>
                    <li><strong>Convert to EPUB</strong> runs Calibre and promotes the book into the main library — same flow as the bulk <em>Convert all</em> button at the top.</li>
                    <li><strong>Download</strong> streams the raw original file so you can read it in an external app like Apple Books, Kindle, or Adobe Reader.</li>
                  </ul>
                  An <strong>Open in new tab</strong> link sits in the Read viewer&apos;s header too — it pops the raw file open in a fresh browser tab so you can use the browser&apos;s built-in viewer / save dialog.
                </li>
                <li><strong>Smart Shelves</strong> — saved filter combinations (fandom + tag + status + …); manage them on the Account page</li>
              </ul>
              <p>The Dashboard surfaces a count chip for any non-empty special shelf so you can see what needs attention.</p>
            </Section>

            <Section id="discovery" icon={UserIcon} title="Browsing & discovery">
              <p>Shelfsort indexes your library by who wrote what and who is shipped with whom.</p>
              <ul>
                <li><strong>Find-a-fandom search</strong> — when your library carries more than 10 fandoms, a search box appears above the Fandom rail on the <Link to="/library/all">All books</Link> page with one-click <em>Try:</em> chips for your top 5 biggest fandoms. Type &ldquo;harry&rdquo; and only the Harry Potter shelf surfaces; clear to bring everything back.</li>
                <li><strong>Chip-icon shorthand</strong> — every chip rail uses a tiny glyph so you can read its type at a glance: <code>Aa</code> for a regular fandom, <code>⇄</code> for a crossover (with the joined-fandom count next to it), <code>♡</code> for a pairing/ship, <code>👤</code> for an author. The compact key at the top of this Help page is the official cheatsheet.</li>
                <li><strong><Link to="/library/authors">Authors directory</Link></strong> — every author in your library with book counts, sorted by count. Click a name to see all their books with status badges. Reachable from the dashboard&apos;s Authors section via &ldquo;View all →&rdquo;.</li>
                <li><strong><Link to="/library/pairings">Pairings browser</Link></strong> — every ship/relationship across your library with counts and sample titles. Click a pairing to see the books featuring it. Pairings are extracted from EPUB metadata at upload time and canonicalized (alphabetical order, slash delimiter) so identical ships from different sources group correctly.</li>
                <li><strong>Smart Shelves</strong> — combine filters into a saved view (Drarry-Complete-only, Sterek-WIPs, etc.).</li>
                <li><strong>Fandom Treemap</strong> on the Account page — visual overview of how your library splits by franchise.</li>
              </ul>
            </Section>

            <Section id="ao3-metadata" icon={Layers} title="AO3-style metadata: ratings, warnings, categories, tags">
              <p>Shelfsort reads AO3 / FF.net export EPUBs and pulls out the canonical metadata fields fanfic readers care about, then stores each on its own field on the book so you can filter and browse by them.</p>
              <p><strong>Rating</strong> (one of 5): <em>General Audiences</em>, <em>Teen And Up Audiences</em>, <em>Mature</em>, <em>Explicit</em>, <em>Not Rated</em>. FF.net&apos;s K, K+, T, M, MA labels are accepted as aliases and normalized to the AO3 equivalent. Stored as <code>rating</code>.</p>
              <p><strong>Archive Warnings</strong> (one or more of 6): <em>Graphic Depictions Of Violence</em>, <em>Major Character Death</em>, <em>Rape/Non-Con</em>, <em>Underage</em>, <em>No Archive Warnings Apply</em>, <em>Choose Not To Use Archive Warnings</em>. Stored as <code>warnings: []</code>.</p>
              <p><strong>Categories</strong> (one or more of 6): <em>F/F</em>, <em>F/M</em>, <em>Gen</em>, <em>M/M</em>, <em>Multi</em>, <em>Other</em>. AO3 short forms like <em>Femslash</em>, <em>Slash</em>, <em>Het</em> are also accepted and canonicalized. Stored as <code>categories: []</code>.</p>
              <p><strong>Relationships</strong> — any <code>&lt;dc:subject&gt;</code> entry containing <code>/</code> (romantic) or <code> &amp; </code> (platonic) is treated as a ship and canonicalized alphabetically so &quot;Hermione/Harry&quot; and &quot;Harry/Hermione&quot; collapse into one. Browse them on the <Link to="/library/pairings">Pairings page</Link>.</p>
              <p><strong>Freeform tags</strong> — everything else from <code>&lt;dc:subject&gt;</code> (Slow Burn, Coffee Shop AU, etc.) lands in <code>ao3_freeform_tags</code>. Distinct from your personal <em>tags</em> field, which is what you add manually via the bulk-edit and tag panels.</p>
              <p><strong>How it works</strong>: a single classifier walks every <code>&lt;dc:subject&gt;</code> element in the EPUB&apos;s OPF metadata. It matches against canonical alias tables (case-insensitive), assigns the subject to a bucket, and dedupes. Anything new is preserved verbatim. The full taxonomy + alias tables live in <code>backend/utils/ao3_metadata.py</code>.</p>
              <p><em>Heads up</em>: the AO3 metadata fields are read at upload time. Books uploaded before this feature shipped won&apos;t have them populated — you can refresh from source (if linked) or re-upload to get the fields filled.</p>
            </Section>

            <Section id="ao3-filters" icon={Layers} title="AO3 filter chips & Save-as-shelf">
              <p>On the <Link to="/library/all">All books</Link> page, click the <strong>AO3 filters</strong> chip near the top to open a collapsible panel with four filter dimensions:</p>
              <ul>
                <li><strong>Rating</strong> — G / T / M / E / NR (single-pick).</li>
                <li><strong>Category</strong> — F/F · F/M · Gen · M/M · Multi · Other.</li>
                <li><strong>Show only Warnings</strong> — show only books that carry the chosen Archive Warning.</li>
                <li><strong>Hide Warnings</strong> — content-safety opt-out: hide books that carry the chosen warning (e.g. Major Character Death).</li>
              </ul>
              <p>Filters compose (AND) and update the books grid live. A small badge counts how many are active; &ldquo;clear all AO3 filters&rdquo; resets the panel.</p>
              <p><strong>Save as Smart Shelf</strong> — once at least one filter is active, the purple &ldquo;Save as shelf&rdquo; button opens a modal where you name the shelf and optionally tick &ldquo;Pin to dashboard sidebar.&rdquo; The saved shelf becomes editable on its dedicated page (<code>/library/smart/&lt;id&gt;</code>) using the full smart-shelf builder — you can swap the rating, add a fandom rule, change combinator, etc. See <a href="#smart-shelves">Smart shelves</a>.</p>
            </Section>

            <Section id="smart-shelves" icon={Layers} title="Smart shelves">
              <p>Smart shelves are saved filter combinations stored under your account. Build them from the <Link to="/library/smart-shelves">Shelves page</Link>, the AO3 filter chips (see above), or by clicking &ldquo;Edit rules&rdquo; on any existing shelf.</p>
              <p><strong>Rule types supported</strong>:</p>
              <ul>
                <li><strong>Has all / any / no tags</strong> — match against personal tag list.</li>
                <li><strong>Category / Fandom / Author</strong> — exact match.</li>
                <li><strong>Status</strong> — reading / finished / unread.</li>
                <li><strong>Word count</strong> — min and/or max.</li>
                <li><strong>AO3 rating / category / warning / exclude warning</strong> — exact match on the AO3 metadata, with the <em>exclude warning</em> rule using <code>$ne</code> so it works as a content-safety filter.</li>
              </ul>
              <p>Rules combine via the top-of-builder AND/OR combinator. A live preview pane shows matching books as you edit so you can see counts before saving. Pin any shelf to surface it as a one-click chip on the welcome dashboard.</p>
            </Section>

            <Section id="reading-queue" icon={BookOpen} title="Reading queue (Up next)">
              <p>The reading queue is a personal stack of books you want to read next.</p>
              <ul>
                <li><strong>Add to queue</strong>: hover any book card on <Link to="/library/all">All books</Link> and click the <ListChecks className="inline w-4 h-4 -mt-0.5" /> icon that appears (left of the read toggle). Click again to remove.</li>
                <li><strong>View / reorder / remove</strong>: open the <Link to="/library/queue">Reading queue page</Link> from the dashboard&apos;s &ldquo;Up next&rdquo; rail. Each row shows index + cover + title/author. Reorder by <strong>dragging the ⋮⋮ handle</strong> at the left of each row, by the ▲▼ arrows for one-step nudges, or × to remove.</li>
                <li><strong>Dashboard surfacing</strong>: while empty you see &ldquo;Up next: nothing queued.&rdquo; Once you add anything, the dashboard rail shows the top 5 with a count + a Manage → link.</li>
              </ul>
              <p>The queue is per-user and order is persisted server-side, so it follows you across devices.</p>
            </Section>

            <Section id="goals" icon={Target} title="Reading goals">
              <p>Set a target, watch the ring fill, get confetti when you hit it. Reading goals live at <Link to="/goals">/goals</Link> and surface as a small ring widget on the Dashboard.</p>
              <ul>
                <li><strong>Two cadences</strong>: <em>Yearly</em> (e.g. &ldquo;52 books in 2026&rdquo;) and <em>Monthly</em> (e.g. &ldquo;5 books this June&rdquo;). You can keep one of each kind running at the same time.</li>
                <li><strong>Two metrics</strong>: <em>Books finished</em> (counts any book you flip to Finished during the period) or <em>Minutes read</em> (sums actual time in the in-app reader plus any manual log entries).</li>
                <li><strong>Live SVG progress ring</strong>: as you finish books or rack up minutes, the ring fills in real time. The fraction is recomputed server-side so it stays honest if you bulk-mark older books finished.</li>
                <li><strong>Confetti on hit, anywhere</strong>: the moment a goal crosses 100%, a CSS-only burst plays and a &ldquo;🎉 You hit &hellip;&rdquo; toast fires — even if you&apos;re on the dashboard, in a reading room, or on a friend&apos;s library. The goal is stamped with a <code>hit_at</code> timestamp so it stays celebrated even if you re-edit the target later, and a localStorage list of celebrated goal-ids stops the same achievement from re-firing on every page load.</li>
                <li><strong>History</strong>: closed-out periods stay listed below the active card with a tiny &ldquo;✓ hit&rdquo; or &ldquo;X / Y&rdquo; summary so you can see how this month compared to last.</li>
                <li><strong>Edit or retire</strong>: bump the target up or down at any time. If you exceed the new target, the hit-state flips on retroactively.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Goals are personal — no one else sees them. They&rsquo;re a self-pacing tool, not a leaderboard.</p>
            </Section>

            <Section id="filter-urls" icon={Globe} title="Filter URLs you already own">
              <p>Got a long list of fanfic links from a recs post, a Discord, or someone&apos;s reading log? Shelfsort can tell you which ones you already have in your library so you only fetch the genuinely new ones.</p>
              <p><strong>From the dashboard</strong>: the &ldquo;Have a list of fanfic URLs?&rdquo; card shows a textarea that detects fanfic URLs live (AO3, FFnet, RoyalRoad, SpaceBattles, Sufficient Velocity, Questionable Questing, FictionPress). Hit <em>Filter my list</em> to be taken to the <Link to="/library/filter-urls">full filter page</Link> with the list pre-populated.</p>
              <p><strong>What the filter does</strong>:</p>
              <ul>
                <li>Normalizes every URL (strips chapter / collection / mirror cruft) so an AO3 URL with <code>?view_adult=true</code> matches the same work without it, and FFnet URLs with or without the trailing chapter ID collapse together.</li>
                <li>Flags <em>owned</em> vs <em>new</em> URLs, and also <em>duplicates within your input list</em> so you don&apos;t waste a fetch on the same fic twice.</li>
                <li>Lets you download just the new URLs as a <code>.txt</code> or <code>.xlsx</code> — ready to paste into a download manager or your reader.</li>
              </ul>
              <p>For uploads, dropping a <code>.txt</code> of mostly-URLs onto the regular upload zone triggers the same flow automatically.</p>
            </Section>


            <Section id="fandoms" icon={BookOpen} title="Fandoms we sort into">
              <p>Shelfsort recognizes <strong>{knownFandoms.length || "…"}</strong> fandoms out of the box and routes a book to one of them automatically when the title, description, or sample text matches enough of that fandom&apos;s keywords. Anything that doesn&apos;t match well enough falls into <em>Original Fiction</em> or <em>Non-fiction</em> — and the admin&apos;s unknown-fandoms queue surfaces popular suggestions for promotion.</p>
              <p>Sorted by community-wide popularity (most-used first) and grouped by franchise so related sub-fandoms (NCIS spin-offs, all Stargate series, Marvel + MCU + Avengers, …) stay together. Counts reflect everyone&apos;s libraries on this instance, anonymized.</p>
              <details
                className="group bg-[#FAF6EE] border border-[#E8E6E1] rounded-lg overflow-hidden"
                data-testid="help-fandoms-collapse"
              >
                <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 text-sm text-[#2C2C2C] hover:bg-[#F5F0E0] transition-colors">
                  <span>
                    <strong className="text-[#6B46C1]">Show the full fandom list</strong>
                    {fandomGroups.length > 0 && (
                      <span className="text-[#6B705C] ml-2">
                        ({fandomGroups.length} group{fandomGroups.length === 1 ? "" : "s"}, {knownFandoms.length} fandom{knownFandoms.length === 1 ? "" : "s"})
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold text-[#6B705C] group-open:hidden">expand ▾</span>
                  <span className="text-xs font-semibold text-[#6B705C] hidden group-open:inline">collapse ▴</span>
                </summary>
                <div
                  className="columns-1 sm:columns-2 lg:columns-3 gap-x-6 text-sm p-4 border-t border-[#E8E6E1] text-[#2C2C2C]"
                  data-testid="help-fandoms-list"
                >
                  {fandomGroups.length === 0 ? (
                    <span className="text-[#6B705C] italic">Loading the list…</span>
                  ) : fandomGroups.map((g) => (
                    <div key={g.name} className="break-inside-avoid mb-4" data-testid={`fandom-group-${g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="font-semibold text-[#6B46C1]">{g.name}</span>
                        {g.total > 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#6B46C1]/10 text-[#6B46C1]" title={`${g.total} book${g.total === 1 ? "" : "s"} across the community`}>
                            {g.total}
                          </span>
                        )}
                      </div>
                      <ul className="font-mono text-xs space-y-0.5 pl-2 border-l border-[#E8E6E1]">
                        {g.fandoms.map((f) => (
                          <li key={f.name} className="flex items-center gap-2">
                            <span className="truncate">{f.name}</span>
                            {f.count > 0 && (
                              <span className="ml-auto text-[10px] text-[#6B705C] tabular-nums shrink-0">{f.count}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
              <p className="mt-3"><em>Don&apos;t see your fandom?</em> Drop it on the <Link to="/suggestions">Suggestions page</Link> with a couple of distinctive title/description keywords and we&apos;ll get it added.</p>
            </Section>

            <Section id="sources" icon={Globe} title="Sources we recognize">
              <p>Shelfsort recognizes fanfic URLs from 10 archives. All variants of the same story (mobile/www/mirrors/chapter IDs/query strings/http vs https) collapse to a single canonical URL so URL-list dedupe, source labels, and the Linkless claim-URL flow all work consistently.</p>
              <ul>
                <li><strong>AO3</strong> — every official mirror (.org / .com / .net / .gay / ao3.org / archive.transformativeworks.org) with www / m / insecure subdomains and /collections/&lt;name&gt;/works/N prefix</li>
                <li><strong>FanFiction.net</strong> — www, bare, and <code>m.fanfiction.net</code> (mobile)</li>
                <li><strong>FictionPress</strong> — www, bare, and <code>m.fictionpress.com</code> (mobile)</li>
                <li><strong>Royal Road</strong></li>
                <li><strong>SpaceBattles</strong>, <strong>SufficientVelocity</strong>, <strong>QuestionableQuesting</strong> (forum threads)</li>
                <li><strong>Adult-FanFiction.org</strong> (all per-fandom subdomains)</li>
                <li><strong>Potions &amp; Snitches</strong>, <strong>Twilighted</strong> (eFiction archives)</li>
              </ul>
              <p><strong>Spotted a URL from a site we don&apos;t recognize?</strong> Shelfsort flags any story-shaped URL (eFiction-style query, forum thread, <code>/works/N</code>, <code>/s/N</code>, etc.) from a new host and queues it on the <strong><Link to="/admin/unknown-sources">Unknown sources</Link></strong> page. You can:</p>
              <ul>
                <li><strong>Mark for adding</strong> — flags the host for the next agent session to canonicalize</li>
                <li><strong>Dismiss</strong> — not a real fic archive, drop it from the queue</li>
                <li><strong>Add manually</strong> — paste a URL + optional note even without an EPUB upload triggering it</li>
              </ul>
              <p>Toasts on upload + URL paste tell you when new hosts are spotted so you don&apos;t need to monitor the queue.</p>
            </Section>

            <Section id="detection" icon={Settings} title="Detection & overrides">
              <p>Most things auto-detect at upload time. When the auto value isn&apos;t right, the override survives re-detection forever.</p>
              <p><strong>Completion status</strong> is detected via a 4-signal cascade:</p>
              <ol>
                <li><em>Status line</em> in EPUB metadata: Status: Complete, Status: In-Progress, Status: Updated, Status: Hiatus, etc.</li>
                <li><em>Tags</em>: <code>complete</code>, <code>wip</code>, <code>ongoing</code>, <code>in-progress</code>, <code>abandoned</code>, <code>discontinued</code>, <code>hiatus</code></li>
                <li><em>Chapter X of Y</em> heuristic — X &lt; Y means ongoing</li>
                <li><em>To-be-continued / TBC</em> marker in the description</li>
              </ol>
              <p>If none match → defaults to <strong>Finished</strong> (sensible for original novels). Override on any book&apos;s detail page via the status badge dropdown — your override lives in <code>manual_status</code> separate from the auto value.</p>
              <p><strong>Category &amp; fandom</strong> are auto-classified using EPUB metadata + a {knownFandoms.length || "150+"}-fandom canonical list + a Claude AI fallback for ambiguous cases. Confidence is shown on the book detail page; correct it manually any time.</p>
              <p><strong>Pairings/relationships</strong> are extracted directly from EPUB metadata, canonicalized (alphabetical order, slash delimiter) so Harry/Draco and Draco/Harry group together.</p>
              <p>
                <strong>In-place metadata editing</strong> — the <em>Edit</em> button on any book&apos;s detail page now lets you fix the <strong>title</strong>, <strong>author</strong>, and <strong>description</strong> alongside category and fandom. Edits land in the database immediately, and if the original EPUB is still on disk, the OPF metadata is rewritten <em>inside the file</em> too — so when you re-download the book or send it to a friend, your corrections travel with it. Chapters, covers, and every other byte in the EPUB stay untouched (we surgically replace only the <code>&lt;dc:title&gt;</code> / <code>&lt;dc:creator&gt;</code> / <code>&lt;dc:description&gt;</code> tags). If the rewrite ever fails (some malformed EPUBs can&apos;t round-trip), the DB save still goes through and a toast lets you know.
              </p>
            </Section>

            <Section id="data-safety" icon={Shield} title="Backup &amp; restore">
              <p>The data-safety loop is end-to-end:</p>
              <ul>
                <li><strong>Download backup</strong> (Account page) — every EPUB + a JSON manifest of all books, tags, smart shelves, and prefs in a single ZIP. The filename is dated so you can keep multiple. Restore is manual; keep the ZIP somewhere safe.</li>
                <li><strong>Reminder banner</strong> on the dashboard fires when (a) you have 100+ books and no backup yet, (b) it&apos;s been 30+ days since the last backup, or (c) 100+ books have been added since the last backup. X button silences it for 14 days; running a backup auto-clears it.</li>
                <li><strong>Backup history</strong> on the Account page shows every backup you&apos;ve run with timestamps + book counts. ZIPs themselves aren&apos;t stored — only metadata. Capped at 50 entries per user.</li>
                <li><strong><Link to="/account/restore">Restore from backup</Link></strong> — upload a backup ZIP, preview what&apos;s inside, tick exactly which books and smart shelves to bring back, and apply. Books with IDs already in your library are flagged as <em>collisions</em> and default to OFF; tick the Overwrite-collisions toggle to opt in.</li>
              </ul>
            </Section>

            <Section id="cloud-backup" icon={Shield} title="Cloud library mirror (durable storage)">
              <p>On top of the manual ZIP backup above, Shelfsort continuously mirrors every EPUB + cover you upload to durable cloud object storage so a server redeploy or crash <em>can&apos;t wipe your library</em>. You don&apos;t have to do anything — the mirror is on by default.</p>
              <ul>
                <li><strong>Constant background mirror</strong> — every 10 minutes a tick walks the file system and uploads anything not already in the cloud. Idempotent: re-uploading the same file is a no-op so the job is cheap to run repeatedly.</li>
                <li><strong>Auto-backfill on boot</strong> — when the server restarts, the very first thing it does (after coming online) is fire a backfill, so every redeploy puts you back in sync within minutes.</li>
                <li><strong>One-tap re-mirror</strong> — visit <Link to="/account#cloud-backup-card">Account → Cloud library mirror</Link> and hit <em>Back up my library now</em> to force an immediate run. Useful right before a big trip or a known maintenance window.</li>
                <li><strong>Visible reassurance signal</strong> — once your library has been backed up in the last 24 h, a tiny green <strong>✓ Shield-Check</strong> badge appears on your avatar in the top navbar. Click it for a popover showing the timestamp, file count, and a one-tap &ldquo;Back up again →&rdquo; button.</li>
                <li><strong>Transparent restore</strong> — if a file goes missing from the server (post-redeploy, never re-uploaded), the next time anyone opens it the bytes are pulled back from cloud storage automatically. First open is slightly slower (10–60 s for a big book); every subsequent open is instant.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Your bytes are stored by Emergent&apos;s managed object storage; Shelfsort never reads them except to serve them back to you. The manual ZIP backup above is the right tool when you want a portable copy you control entirely — the cloud mirror is the safety net that keeps things working even if you forget to make a ZIP.</p>
            </Section>

            <Section id="antivirus" icon={Shield} title="Antivirus &amp; library safety">
              <p>Every file you add to Shelfsort is scanned by <strong>ClamAV</strong> before it lands in your library. The scan runs synchronously on the upload response — if anything is flagged, the file is rejected with a clear message and never enters your library. Same goes for backup-ZIP restores and feedback photo attachments.</p>
              <ul>
                <li><strong>What gets scanned</strong> — every book upload (EPUB, PDF, MOBI, AZW, TXT), every backup-ZIP restore, every photo attached to feedback, and every file restored back from cloud storage on download. The signature database is refreshed daily, so files that were clean yesterday can still be caught if a brand-new threat is published.</li>
                <li><strong>Where to check your own report</strong> — <Link to="/account/safety">Account → Library safety report</Link>. Three live counters: clean, flagged, awaiting first scan. If anything has been flagged it&apos;s listed by filename + signature, with a timestamp.</li>
                <li><strong>Rescan on demand</strong> — the same page has a one-tap <em>Rescan now</em> button that re-runs ClamAV across every book in your library (it pulls cloud-only files back to disk first, so the rescan is complete, not just a cache sweep). Capped at 500 books per run to keep the wait reasonable.</li>
                <li><strong>90-day nudge banner</strong> — if it&apos;s been more than 90 days since your last full library scan (or you have unscanned books with no prior scan ever), a quiet banner appears at the top of every page with a single <em>Run scan</em> button. One click runs the rescan; one click dismisses the nudge for the day. Hidden once the report is fresh again.</li>
                <li><strong>If a flagged file used to be clean</strong> — that&apos;s the normal &ldquo;new signature caught an old file&rdquo; case. The download endpoint rescans before serving the file, so a freshly-flagged book is blocked at the next download attempt. Your earlier downloads are not retroactively recalled — you should manually delete any local copies of a flagged file from your devices.</li>
                <li><strong>What we never do</strong> — ClamAV only sees the file bytes; the result is &ldquo;clean&rdquo; or &ldquo;<em>signature name</em> FOUND&rdquo;. We don&apos;t share files with third-party AV services, we don&apos;t store hashes in any external registry, and your scan results are visible only to you (the admin antivirus dashboard sees aggregate quarantine entries, not your library contents).</li>
              </ul>
              <p className="text-xs text-[#6B705C]">If the AV scanner is temporarily unavailable (e.g. mid-deploy while signatures download), uploads still work but the file is queued for scanning when the daemon is back — the Library safety report banner turns red so you know.</p>
            </Section>

            <Section id="rules" icon={Shield} title="Community rules">
              <p>Shelfsort is a quiet corner of the internet for people who love books. To keep it that way, every account holder agrees to a short, written code of conduct.</p>
              <ul>
                <li><strong>No spam</strong> — no off-platform promotion, no commercial schemes, no link-farming.</li>
                <li><strong>No politics</strong> — keep partisan content and election material off the platform.</li>
                <li><strong>No hate speech or bullying</strong> — targeting users, authors, or communities by identity is not tolerated.</li>
                <li><strong>No piracy promotion</strong> — don&apos;t share download links to unauthorized copies. Shelfsort is for organizing books you already own (or freely-shared works like fanfiction).</li>
                <li><strong>Respect intellectual property</strong> — authors keep rights to their work. Don&apos;t repost full chapters or AI-derivatives that misrepresent the original.</li>
                <li><strong>Be kind</strong> — &ldquo;what one reader would say to another.&rdquo; Curiosity, gentle disagreement, shared favorites — yes. Snark at someone&apos;s taste — no.</li>
              </ul>
              <p>Read the full text at <Link to="/rules" target="_blank">/rules</Link>. Rule breaches lead to a warning, suspension, or ban depending on severity. Appeals can be sent via the feedback box at the top of this page.</p>
            </Section>

            <Section id="reading" icon={BookOpen} title="Reader &amp; stats">
              <p>Click any book cover to open the in-browser EPUB Reader. Your reading position is saved per-book; come back to where you left off automatically.</p>
              <p><strong>Bookmarks</strong>: while reading, tap the <em>Bookmark</em> button in the reader header to save your current page — or just press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>B</kbd>. If the current page is already bookmarked, the button flips to a filled <em>Saved</em> chip so you don&apos;t accidentally save the same spot twice. Open the <em>Bookmark</em> panel (the icon next to it with the count) to see every saved spot for this book, jump to any of them, type or edit a free-form note (saved on blur), and remove on hover. Each bookmark stores the chapter title, your reading-progress percentage, and the date you saved it. Bookmarks sync to your account so they follow you across devices.</p>
              <p>You can also see every bookmark across your whole library on the <Link to="/bookmarks">All bookmarks</Link> page. PDF and TXT/DOCX originals support bookmarks too — see the <Link to="/library/originals">Originals</Link> section above for how they work in the smart viewer.</p>
              <p><strong>Surprise me</strong>: on the Dashboard, the &ldquo;Surprise me&rdquo; button picks a random book you haven&apos;t opened yet and drops you straight into it — useful when decision fatigue strikes.</p>
              <p><strong>Books I haven&apos;t read</strong>: the dedicated <Link to="/library/unread">unread shelf</Link> lists every book you&apos;ve never opened, newest upload first.</p>
              <p><strong>Up next queue</strong>: build a personal reading order with the <em>Up next</em> widget on the Dashboard. Books in the queue persist across devices.</p>
              <p>The <Link to="/stats">Reading stats</Link> page covers your library shape, most-read fandoms, and pairing distribution. For a more cinematic year-end view — books opened, pages turned, longest streak, top fandoms, top author, bookends — open <a href="#year-in-books">Year in Books</a> below.</p>
              <p><strong>Refresh fanfics</strong>: the URL-fetching feature is currently disabled while we tune it. Your existing books and their metadata are unaffected.</p>
            </Section>

            <Section id="cross-device" icon={ArrowLeftRight} title="Cross-device reading sync">
              <p>Start a fic on your laptop on the train; finish it on your phone in bed. Shelfsort tracks your reading position per-device in the cloud (CFI-precise, not just chapter-precise) so the &quot;where was I?&quot; bookmark follows you everywhere.</p>
              <ul>
                <li><strong>Resume Reading dashboard card</strong> — when the latest cursor came from a different device than the one you&apos;re on, the dashboard surfaces a &ldquo;Pick up where you left off on iPhone&rdquo; card with the book cover + chapter title. One tap drops you straight back into the Reader at the right page.</li>
                <li><strong>Yellow Resume pill on book cards</strong> — for books with a fresh cloud cursor from a different device in the last 48 h (and you haven&apos;t finished them), a small yellow Resume pill appears in the corner of the cover on the library grid. Passive nudge that doesn&apos;t require enabling push.</li>
                <li><strong>Reader pill (you vs you elsewhere)</strong> — when you open a book inside the Reader, a small pill in the top bar shows the cursor age + originating device label so you know whether you&apos;re ahead of, behind, or at the same spot as your other devices.</li>
                <li><strong>Web push handoff</strong> — opt-in. When you close a book on one device, your other devices get a soft browser notification asking if you want to continue there. Toggle in <Link to="/account#notifications">Account → Notifications</Link>; see <a href="#push">Web push notifications</a> below for the setup walk-through.</li>
                <li><strong>Realtime updates</strong> — every device&apos;s position is published via Shelfsort&apos;s unified SSE channel, so when you save progress on the laptop, your phone&apos;s Reader pill updates within ~1 second (no polling).</li>
                <li><strong>&ldquo;Finished on your iPhone — want a similar one?&rdquo; strip</strong> — when you&apos;re near the end of a book (≥ 90 %) on a different device than the one you&apos;re currently on, the BookDetail page surfaces a tiny 3-card rail right under the cross-device hint, pulling related books from your library by fandom/author. Hides silently when no matches exist or you dismiss it. Captures the moment of completion as a moment of discovery without nagging.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Privacy: position data is per-user only. Friends never see where you are in a fic — that data isn&apos;t shared even when you&apos;re a member of a Book Club room reading the same book.</p>
            </Section>

            <Section id="reading-insights" icon={LineChart} title="Reading insights (Re-read · Pace · Cohort)">
              <p>BookDetail pages now surface up to three live pills that turn raw cursor data into reading rhythm signals — all opt-in and silently hidden when the data isn&apos;t there yet.</p>
              <ul>
                <li><strong>↻ Re-read pill</strong> — Shelfsort tracks &ldquo;backward jumps&rdquo; (the cursor dropping below 60 % of the running peak after being near 100 %). Three or more of those in 90 days → you&apos;re re-reading. The pill says <em>Re-read</em>, and after the fourth jump in 30 days you get a small in-app nudge (&ldquo;You&apos;ve kept coming back to <em>Title</em> — want to add it to a Cosy Comforts shelf?&rdquo;).</li>
                <li><strong>⚡ Pace pill</strong> — Shelfsort compares your %/hr on this book to your own median across the last six months of finished books. <em>30 % faster than usual</em>, <em>your usual pace</em>, or <em>20 % slower than usual</em>. When you haven&apos;t opened a fresh book yet, the pill becomes <em>~Nh to finish</em>, a projection of total reading hours based on your median pace × the book&apos;s remaining percentage.</li>
                <li><strong>⌖ Cohort progress bar</strong> — the Progress field now renders as a slim bar with your current percent in coral plus a purple tick mark at the community average. Cohort-gated (≥5 opted-in readers of the same canonical title+author) so no individual can be inferred. Surfaces as &ldquo;You: 45 % · Community: 62 %&rdquo;.</li>
                <li><strong>Books most likely to be finished</strong> — admins also see a leaderboard (`/api/books/most-finished-leaderboard`) of canonical titles sorted by community completion rate. Useful for picking the next book-club read.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Cohort insights respect your <em>Share reading data</em> setting under <Link to="/account#privacy">Account → Privacy</Link>. Switching it off both stops contributing to the cohort and stops receiving the cohort pill on your own books.</p>
            </Section>

            <Section id="similar-books" icon={Sparkles} title="Finished a book? Want a similar one">
              <p>The moment you close a book is also the moment you&apos;re most likely to want another. The BookDetail page now ends with a soft strip — <em>&ldquo;Finished on this device. Want a similar one?&rdquo;</em> — pulling up to six other titles from <strong>your own library</strong> that share the seed book&apos;s fandom or author.</p>
              <ul>
                <li><strong>When it appears</strong>: only after the book is effectively done. Either your progress hit ≥ 95 %, or you tapped <em>Mark as finished</em>. Otherwise the strip stays out of your way.</li>
                <li><strong>What it surfaces</strong>: library-local matches scored on fandom (×3) + author (×2) + whether it&apos;s still unfinished (+1) + recency. Unfinished books rise to the top because you&apos;ve already chosen to keep them — the strip is meant to re-surface, not recommend strangers.</li>
                <li><strong>Why library-local</strong>: embedding-based community recs already live behind <Link to="/recommendations">Recommendations</Link>. The finished strip is for resurfacing things you&apos;ve forgotten you own. Stays silent when nothing matches.</li>
              </ul>
            </Section>

            <Section id="reader-dna" icon={Dna} title="Reader DNA & comfort reads">
              <p>Open <Link to="/library/stats">Reading stats</Link> and scroll past the category bars — there&apos;s a new <strong>Reader DNA</strong> card that summarises your reading make-up in one panel.</p>
              <ul>
                <li><strong>Top 3 fandoms</strong> by book count.</li>
                <li><strong>Fanfic vs original split bar</strong> — the proportion of your library that&apos;s fanfic vs original work, rendered as a single coral/purple bar.</li>
                <li><strong>Average book length</strong> in words, computed from each book&apos;s indexed word count (or a rough size-based estimate when missing).</li>
                <li><strong>Comfort reads · last 30 days</strong> — books you&apos;ve finished AND re-opened a session for in the last month. The titles you keep coming back to without thinking about it.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">One API round-trip (<code>/api/insights/reader-dna</code>). Silently hidden when your library is empty.</p>
            </Section>

            <Section id="year-in-books" icon={Sparkles} title="Year in Books (Wrapped recap)">
              <p>
                Every reading year gets its own <strong>Spotify-Wrapped style recap</strong> at <Link to="/library/stats">Reading stats → Year in Books</Link>, or directly at <code>/library/year/&lt;year&gt;</code>. It&apos;s a nine-slide scroll-snap experience — each slide is its own full-screen card with bold gradients and animated reveal-on-view.
              </p>
              <ul>
                <li><strong>The slides:</strong> cover (the year in giant serif) → books opened → pages turned (with a rough hours estimate) → longest streak + active days → best month with a mini monthly bar chart → top fandoms (#1 hero + animated ranking bars 2–5) → most-read author (+ supporting authors) → first &amp; last books of the year (&ldquo;Bookends&rdquo;) → outro with achievement chips and the Share / Email buttons.</li>
                <li><strong>Numbers animate</strong> with a CountUp effect when each slide scrolls into view, and bar charts grow horizontally from zero — the recap is meant to be watched, not just read.</li>
                <li><strong>Navigate</strong>: scroll-snap pages forward, the progress dots on the right let you jump between slides, and prev/next-year chips in the top bar hop between years. The X in the top-left closes back to <Link to="/library/stats">/library/stats</Link>.</li>
                <li><strong>Empty years</strong> show a single calm &ldquo;A quiet year on the shelf&rdquo; slide with a link back to the library — no data, no fake numbers.</li>
              </ul>
              <p>
                <strong>Email it to yourself</strong> with the <em>Email me this recap</em> button on the final slide. The email uses the same numbers in a clean print-friendly layout (no scroll-snap there). It&apos;s also the email sent in early January if you turn on the Year-in-Books channel in <Link to="/account/emails">Email preferences</Link>.
              </p>
              <p>
                <strong>Download as PNG</strong> grabs the whole year as a 1080×1350 Instagram-friendly portrait card — purple gradient, big serif year, your top world &amp; top voice, reading peak. It saves locally as <code>shelfsort-wrapped-&lt;year&gt;.png</code>. On browsers that support image-clipboard (Chrome, Edge, modern Safari) a sister <em>Copy image</em> button puts the same PNG straight on your clipboard so you can paste into Threads, iMessage, or Instagram Stories with no save-then-attach dance. Firefox / older Safari users only see the Download button (graceful fallback).
              </p>
              <p>
                <strong>Share publicly</strong> with the <em>Share my year</em> button — Shelfsort generates a token-protected public URL. Anyone with the link sees the same Wrapped experience (with your display name on the cover) — no Shelfsort account required. The public view never exposes your email or internal book IDs. The link is engineered to <strong>unfurl as a rich preview</strong> when pasted into Twitter, iMessage, Slack, Discord, or LinkedIn: a server-side 1200×630 card with your year, books, streak, and top fandom shows up as the link preview, with full Open Graph + Twitter Card meta tags. Manage the link any time: copy it, open it in a new tab, or <em>Revoke</em> to kill it instantly. View counts and the last-seen date show up in the same dialog so you can see how many friends actually clicked.
              </p>
              <p className="text-xs text-[#6B705C] italic">
                Stat source-of-truth: a book counts as &quot;opened&quot; if it appears in your <code>reading_activity</code> for that year, and as &quot;finished&quot; if its progress is ≥99% and the last-opened date falls inside the year. Pages are estimated from word count (250 wpm × ~250 words per page). Fanfics with no word-count yet contribute zero pages until backfill runs.
              </p>
            </Section>

            <Section id="usernames" icon={AtSign} title="Public usernames &amp; @handles">
              <p>A username is your public handle on Shelfsort — what friends type when they want to find you without trading email addresses. Claiming one is <em>optional</em>: if you skip it, friends can still invite you by email or by name.</p>
              <ul>
                <li><strong>Claim it</strong> at <Link to="/account#username">Account → Username</Link>. 3–20 characters, letters/digits/underscores, must be unique. Capital letters are welcome — &ldquo;<code>@ImCrazy42</code>&rdquo; displays exactly as typed.</li>
                <li><strong>Uniqueness is case-insensitive</strong> — &ldquo;<code>@Bookworm</code>&rdquo; and &ldquo;<code>@bookworm</code>&rdquo; can&rsquo;t both exist, so nobody can impersonate you with a different casing.</li>
                <li><strong>Rename safely</strong>: change your handle whenever you like. Shelfsort remembers your previous handle for a grace period so &ldquo;@NewName (was @OldName)&rdquo; appears in friends&rsquo; cards until you clear it from the same panel.</li>
                <li><strong>@-mention autocomplete</strong>: anywhere Shelfsort accepts a handle (friend invites, bookclub invites), start typing <code>@</code> and a live dropdown surfaces matching users. Empty/short queries stay quiet so the UI doesn&rsquo;t flicker.</li>
                <li><strong>Find-by-handle</strong> from <Link to="/friends">/friends</Link>: type a full or partial handle into the invite box, pick the suggestion, hit send. If you already have an email-style invite open, the same field still accepts <code>name@domain</code>.</li>
                <li><strong>Privacy still applies</strong>: toggling <em>Hide me from user search</em> on the Account page removes you from <code>@</code> autocomplete results too — your existing friends can still DM you.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Heads up: usernames are public. Don&rsquo;t pick something you wouldn&rsquo;t want stamped onto a friend&rsquo;s screenshot.</p>
            </Section>

            <Section id="messages" icon={MessageSquare} title="Messages & friends">
              <p>
                Shelfsort has built-in direct messaging — click <strong>Message</strong> on any friend at <Link to="/friends">/friends</Link> to open an inline chat drawer. Three room types coexist:
              </p>
              <ul>
                <li><strong>Admin-curated group rooms</strong> — an admin creates the room and picks members. Members chat freely inside.</li>
                <li><strong>1-on-1 DMs between friends</strong> — once you and another user are friends, either side can open a DM that lives forever in your sidebar.</li>
                <li><strong>1-on-1 DMs from anyone</strong> — if a user has opened up their privacy to &ldquo;anyone&rdquo;, you can DM them without being friends first.</li>
              </ul>
              <p>Three kinds of messages: text (Enter to send, Shift+Enter for newline), attached <strong>book</strong> (search your library, recipient gets a card linking to it), and attached <strong>palette token</strong> (one-click Apply on the recipient&rsquo;s side using the share-palette work).</p>
              <p>
                <strong>Friends</strong> live at <Link to="/friends">/friends</Link>: search by <strong>@handle</strong>, name, or email (min 2 chars) — typing <code>@</code> opens the autocomplete dropdown for instant picks. Send a request, the other side accepts or declines.
                If both sides happen to send requests at the same time, they auto-pair into accepted. From the Friends page you can also <strong>remove a friend</strong> (wipes the DM room),
                <strong> block someone</strong> (silent, they vanish from your search and can&rsquo;t message you), or <strong>unblock</strong> later.
                <strong> Invite by email</strong> sends a Resend invite to anyone not yet on Shelfsort — they click the one-time link, sign up, and become your friend automatically. Pending invites expire after 30 days and can be cancelled from the same panel.
              </p>
              <p>
                <strong>Privacy</strong> lives on your <Link to="/account#privacy">Account page</Link>:
              </p>
              <ul>
                <li><strong>Who can DM me</strong> — <em>Friends only</em> (default) blocks DMs from strangers; <em>Anyone</em> opens it up. When you have pending requests sitting around, a small &ldquo;Switch to open DM mode&rdquo; link appears on the Friends page so you don&rsquo;t have to dig.</li>
                <li><strong>Hide me from user search</strong> — toggle on to keep your name/email out of other users&rsquo; search results. Existing friends still see you.</li>
                <li><strong>Share my library with friends</strong> — opt-in (off by default). When on, your accepted friends see a Library button on your row in their Friends page. They can browse your books (title + author + fandom), see which ones they already own, and click <em>Want this</em> to politely DM you about anything they want. No EPUB files are ever auto-sent — you decide how to share each one.</li>
              </ul>
              <p>
                On the Friends page, each accepted friend&rsquo;s row also shows a <strong>🤝 mutual count</strong> — the number of books that appear in both of your libraries (matched on lowercase title + author, ignoring &ldquo;the/a/an&rdquo; prefixes).
              </p>
              <p>
                <strong>Notifications</strong>: the chat-bubble icon in the Navbar shows one combined badge — unread messages + pending friend requests added together. Hover for the breakdown. Inside <Link to="/friends">/friends</Link>, each friend&apos;s row gets a red unread-message dot that <strong>auto-refreshes every 20 seconds</strong> (and instantly when you tab back to Shelfsort) — no manual reload needed to see new DMs.
              </p>
              <p className="text-xs text-[#6B705C] italic">
                Phase 1c (one-click &ldquo;switch to open&rdquo; banner) and websockets for instant delivery are parked. Current 15-second poll is plenty for casual chat.
              </p>
            </Section>

            <Section id="bookclubs" icon={MessageSquare} title="Book-club reading rooms">
              <p>Private invite-only spaces where you and friends read the <em>same book</em> together. Find them at <Link to="/bookclubs">/bookclubs</Link>.</p>
              <ul>
                <li><strong>Chat-style layout</strong>: room list on the left, active conversation in the middle, members + progress + invites in a collapsible right rail. Mobile collapses the room list into a drawer.</li>
                <li><strong>Chapter threads</strong>: every room has a <em>Lobby</em> plus one tab per chapter in the book. Pick a tab to scope your messages to that part of the book — perfect for spoiler-safe discussion.</li>
                <li><strong>Progress slider</strong>: drag to mark your current chapter. When you cross the finish line, every other active member gets a notification (and a row in the Sunday digest if they&apos;ve opted in).</li>
                <li><strong>Roles</strong>: Owner / Moderator / Member. Owners can edit, invite, promote, demote, remove, transfer ownership, or delete. Moderators can edit + invite + remove. Members read &amp; post.</li>
                <li><strong>Friends-only invites</strong>: pick from your accepted-friends list <em>or</em> type an <code>@handle</code> in the quick-invite field at the top of the members rail to invite anyone on Shelfsort. Use <Link to="/friends">/friends</Link> to add people first if you&apos;d rather route through the friends list.</li>
                <li><strong>Notifications</strong>: bookclub invites and per-message pings always fire in the bell. Optional <em>weekly email digest</em> ships every Monday at 08:00 UTC summarising the past week&apos;s activity across all your rooms — opt-in at <Link to="/account/emails">Account → Emails</Link>.</li>
                <li><strong>Buddy-pacing prompts</strong>: in 2-person rooms, when both members cross into a new chapter Shelfsort auto-posts a system message (&ldquo;Both of you have reached Chapter 7. Ready to talk about it?&rdquo;) and pings both readers in-app. Larger rooms skip the prompt to avoid spam. Idempotent — one nudge per chapter per room.</li>
              </ul>
            </Section>

            <Section id="covers" icon={Sparkles} title="Community Covers">
              <p>Shelfsort can generate AI cover art for any book that ships without a great one — and once you&apos;re happy with a generated cover, you can share it back to the community pool so other readers of the same book can adopt it.</p>
              <ul>
                <li><strong>Generate</strong>: on any book&apos;s detail page click <em>Regenerate cover</em>. Pick an aesthetic (vintage paperback, minimalist, watercolour, neon, etc.) and Shelfsort renders a new cover via Gemini Nano Banana. You can keep iterating; each render is saved as a variant.</li>
                <li><strong>Share</strong>: the <em>Share to community</em> toggle on a saved variant publishes it to the pool. Public URL: <Link to="/explore/covers">/explore/covers</Link>. Each shared cover gets its own <code>/cover/&lt;id&gt;</code> page with Open Graph + Twitter Card meta so the link unfurls as a rich preview in Discord / Twitter / iMessage.</li>
                <li><strong>Vote &amp; adopt</strong>: any logged-in user can up-vote a cover. The top-voted covers per canonical title bubble to the top of the Explore page and into the &ldquo;Cover of the week&rdquo; dashboard strip. One-click <em>Use this cover</em> on someone else&apos;s variant copies it to your library (with attribution to the original sharer).</li>
                <li><strong>Lineage &amp; profiles</strong>: each cover tracks who shared it, who&apos;s adopted it, and which variants remixed from it. Click any sharer&apos;s @handle to see their <Link to="/library">public profile</Link> with their shared covers gallery.</li>
                <li><strong>SEO &amp; discovery</strong>: the cover pool ships an RSS feed (<code>/feed/covers.xml</code>) and sitemap so search engines + RSS clients can index new community covers. The <em>Explore page</em> exposes browse-by-aesthetic + browse-by-fandom rails.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Privacy: sharing is opt-in per variant. Your library never auto-shares; only covers you explicitly toggle <em>Share to community</em> on become public. Revoke from the same toggle at any time and the public URL 404s within minutes.</p>
            </Section>

            <Section id="recommendations" icon={Sparkles} title="Friend recommendations">
              <p>Once you&apos;ve added friends and at least one of them has opted to share their library, Shelfsort surfaces books they&apos;ve loved that you don&apos;t own yet.</p>
              <ul>
                <li><strong>Ranking</strong>: <code>3 × finishers + 1 × serious_readers + reading_minutes/60</code>, capped. A single very-invested friend can punch above multiple casual finishers.</li>
                <li><strong>Grouping</strong>: when several friends have the same book, the rec collapses into one row showing the combined byline (&ldquo;Alice, Bob +2 more&rdquo;).</li>
                <li><strong>Already-owned filter</strong>: anything matching by canonical URL or normalised title+author is hidden.</li>
                <li><strong>Surfaces</strong>: top 3 on the Dashboard via the <em>From your friends</em> card (auto-hides when empty); full list at <Link to="/library/recommendations">/library/recommendations</Link> with hide / restore controls.</li>
                <li><strong>Weekly &quot;From friends&quot; digest</strong>: an in-app notification lands every Sunday at 18:00 UTC summarising what your sharing friends finished. Opt in at <Link to="/account/emails">Account → Emails</Link> to also receive an email copy.</li>
              </ul>
            </Section>

            <Section id="opds" icon={Globe} title="E-reader sync (OPDS catalog)">
              <p>OPDS is the standard XML feed format that <strong>KOReader, Moon+ Reader, Marvin, Foliate</strong> and other standalone e-reader apps use to browse + download books from a server. Shelfsort serves a per-user OPDS catalog so you can point your e-reader at your library and read offline.</p>
              <ul>
                <li><strong>Setup</strong>: <Link to="/account">Account</Link> → <em>E-reader sync</em> card. Click <em>Generate catalog password</em>, save the username (your email) + password (shown once), and toggle the channel on.</li>
                <li><strong>Catalog URL</strong>: ends with <code>/api/opds</code>, with HTTP Basic auth using the catalog password (separate from your primary login password).</li>
                <li><strong>Feeds</strong>: root → All books / Recently added / By fandom / By author. Acquisition links download the EPUB; cover thumbnails included.</li>
                <li><strong>Privacy</strong>: only your own books are served. The toggle gates access independently of the password — switch it off any time without re-rolling the password.</li>
              </ul>
            </Section>

            <Section id="send-to-kindle" icon={Send} title="Send to Kindle">
              <p>One-click delivery from any book page straight to your <strong>Amazon Kindle</strong>. Useful when you&apos;d rather read on your e-ink device than in the browser.</p>

              <p className="font-semibold text-[#2C2C2C] mt-3 mb-1">One-time setup (~2 min):</p>
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>
                  <strong>Find your Kindle email address.</strong> In the Amazon app: <em>More → Settings → Personal Documents</em>. Or on the web: <a href="https://www.amazon.com/myk" target="_blank" rel="noreferrer" className="text-[#6B46C1] underline">amazon.com/myk</a> → <em>Preferences</em> → <em>Personal Document Settings</em>. It looks like <code>yourname@kindle.com</code> (or <code>@free.kindle.com</code> on older accounts).
                </li>
                <li>
                  <strong>Save it in Shelfsort.</strong> <Link to="/account#send-to-kindle">Account → Send to Kindle</Link> → paste your address → <em>Save</em>.
                </li>
                <li>
                  <strong>Whitelist the Shelfsort sender on Amazon.</strong> This is the step everyone misses — Amazon silently drops emails from unknown senders. On the same <em>Personal Document Settings</em> page, scroll to <em>Approved Personal Document E-mail List</em> and click <em>Add a new approved e-mail address</em>. Paste the sender address shown in the orange reminder block on your Account → Send to Kindle card (click the Copy button so you don&apos;t typo it). Save.
                </li>
                <li>
                  <strong>You&apos;re done.</strong> The orange <em>Send to Kindle</em> button on every book page is now live.
                </li>
              </ol>

              <p className="font-semibold text-[#2C2C2C] mt-4 mb-1">Sending a book:</p>
              <ul>
                <li>Open any book → click the orange <strong>Send to Kindle</strong> button next to <em>Download EPUB</em>.</li>
                <li>Confirm the destination address in the popup.</li>
                <li>Amazon converts the EPUB and pushes it to every Kindle on your account within <strong>~5 min</strong>. The book shows up under <em>Library</em> on the device home screen.</li>
              </ul>

              <p className="font-semibold text-[#2C2C2C] mt-4 mb-1">Limits &amp; guardrails:</p>
              <ul>
                <li><strong>25 MB cap per send</strong> — Amazon&apos;s Personal Documents gateway rejects anything larger. Most fanfic EPUBs are well under 5 MB; only image-heavy art-books usually trip this.</li>
                <li><strong>One send per book every 30 min</strong> — prevents accidental double-clicks from spamming your Kindle inbox with duplicates.</li>
                <li><strong>EPUB only</strong> — Shelfsort stores everything as EPUB after auto-conversion, so this is also Amazon&apos;s safest format for personal documents.</li>
                <li><strong>Quarantined books are blocked</strong> — anything flagged by antivirus stays in Shelfsort.</li>
              </ul>

              <p className="font-semibold text-[#2C2C2C] mt-4 mb-1">Troubleshooting:</p>
              <ul>
                <li>
                  <strong>&quot;Approved sender&quot; error / book never arrives:</strong> 95% of the time, the Shelfsort sender wasn&apos;t added to Amazon&apos;s approved list. Re-check step 3 above — the sender shown on your Account card must match what you pasted into Amazon exactly.
                </li>
                <li>
                  <strong>&quot;Wait 30 min between sends&quot;:</strong> the same book was sent recently. Either wait, or send a different book in the meantime.
                </li>
                <li>
                  <strong>&quot;Email service rejected&quot; (502):</strong> usually means the Shelfsort outbound email quota is temporarily full. Tries again on the next send after the quota window resets (typically &lt;24 h).
                </li>
                <li>
                  <strong>Book arrived on Kindle but title is weird:</strong> Amazon uses the EPUB filename as the on-device title. Shelfsort renders this as <code>Title - Author.epub</code> using the metadata you have on file; fix the metadata in <em>Edit details</em> on the book page and the next send will use the corrected name.
                </li>
              </ul>

              <p className="text-xs text-[#6B705C] mt-3">
                <strong>Privacy:</strong> Send-to-Kindle uses Shelfsort&apos;s normal outbound email provider (Resend) → Amazon&apos;s email gateway. No third party stores the book; the attachment lives in flight for at most a few seconds before Amazon ingests it.
              </p>
            </Section>

            <Section id="notifications" icon={Settings} title="Notifications & mutes">
              <p>The bell icon in the navbar shows every kind of in-app ping — friend requests, accepted requests, friend uploads in fandoms you collect, bookclub invites + messages + finishers, weekly digests, suggestion status changes.</p>
              <ul>
                <li><strong>In-app notifications always fire</strong> — there&apos;s no master &quot;all on/off&quot; toggle. Emails are the only thing you opt into.</li>
                <li><strong>Per-kind mute matrix</strong>: at <Link to="/account/emails">Account → Emails</Link>, scroll past the email channels to the <em>In-app notifications</em> card. Each kind has its own toggle so you can keep bookclub invites loud and silence chatty message pings.</li>
                <li><strong>Critical kinds</strong> (friend requests, bookclub invites) cannot be muted — they&apos;re actionable and would silently disappear if turned off.</li>
                <li><strong>Email channels</strong> (all opt-in, default OFF): Weekly digest, Fic updates, Year-in-Books recap, From-friends weekly, Book-club weekly. Each has a &quot;send sample&quot; button so you can preview before subscribing.</li>
                <li><strong>Account updates · NEW (2026-06-20)</strong>: at the bottom of <Link to="/account/emails">Account → Emails</Link>, a fresh <em>Account updates</em> card lets you choose which one-off emails you want (You&apos;re approved!, Approval declined, Suggestion status updates, Year in Books wrapped, Bookclub invites, Weekly recommendations, Fandom overlap with friends). Turn any off and that email becomes an in-app notification on your next visit. Security-critical emails (password resets) always send regardless.</li>
              </ul>
            </Section>

            <Section id="push" icon={Bell} title="Web push notifications">
              <p>For cross-device handoff (&ldquo;Continue this fic on your phone?&rdquo;), Shelfsort uses Web Push — silent OS-level notifications that fire even when the tab is closed. <em>Strictly opt-in</em>: you have to explicitly enable it.</p>
              <ul>
                <li><strong>Enable</strong>: <Link to="/account#notifications">Account → Notifications</Link> → click <em>Enable browser notifications</em>. Your browser shows a permission prompt; allow it.</li>
                <li><strong>Per-device subscription</strong>: subscribe separately on each device you want to receive handoff pings (phone, work laptop, tablet). The list shows every active subscription with the device label and the date you registered it.</li>
                <li><strong>What triggers a push</strong>: closing a book on one device sends a soft handoff prompt to your other devices (&ldquo;Continue <em>Title</em> on iPhone?&rdquo;). Tapping the push opens the Reader at the same CFI. Nothing else uses push (no marketing pings, no chat alerts — those stay in-app + email).</li>
                <li><strong>Unsubscribe</strong>: revoke any device from the same panel, or just block notifications in the browser. Server-side subscriptions are deleted on revoke.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">Technical: VAPID keys are auto-rotated server-side; the public key ships down with the subscribe call so you never need to copy/paste anything. iOS Safari requires the site to be added to Home Screen as a Web App before push works — Shelfsort prompts you to do this on first enable from iOS.</p>
            </Section>

            <Section id="auto-theme" icon={Sparkles} title="Scheduled auto-theme">
              <p>Three modes at <Link to="/account/appearance">Appearance → Theme</Link>:</p>
              <ul>
                <li><strong>Light</strong> — always.</li>
                <li><strong>Dark</strong> — always.</li>
                <li>
                  <strong>Auto</strong> — switches based on a strategy you pick:
                  <ul>
                    <li><em>Time of day</em> (default): set a <strong>dark window</strong> (e.g. 19:00 → 07:00 local). Windows that span midnight work. Shelfsort re-evaluates every 60 seconds so the flip lands at the right minute without a page reload.</li>
                    <li><em>Follow system</em>: tracks the OS / browser <code>prefers-color-scheme</code> media query. Live-reacts when you change the system theme.</li>
                  </ul>
                </li>
              </ul>
              <p className="text-xs text-[#6B705C]">Stored to localStorage only (per-browser).</p>
            </Section>

            <Section id="keyboard-shortcuts" icon={Command} title="Keyboard shortcuts">
              <p>A handful of global shortcuts for power users. All listeners skip when you&apos;re typing in a text field so they never clobber your paste.</p>
              <ul>
                <li><kbd>Cmd</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> — toggle light ↔ dark theme instantly. Works on every page.</li>
                <li><kbd>/</kbd> — focus the navbar quick-search. See <a href="#quick-search">Navbar quick-search</a> for what it searches.</li>
                <li><kbd>Esc</kbd> — close any open modal, popover, or the Welcome tour overlay.</li>
              </ul>
              <p className="text-xs text-[#6B705C]">More shortcuts coming. Have a request? <Link to="#feedback">Send us feedback</Link>.</p>
            </Section>

            <Section id="word-count" icon={BookOpen} title="Word count & reading time">
              <p>Every uploaded EPUB is indexed for full-text search at upload — the same pass also stamps a <strong>word count</strong> on the book. From that, Shelfsort computes a <strong>reading-time estimate</strong> using your personal reading speed (words-per-minute).</p>
              <ul>
                <li><strong>Per-book</strong>: open any book&apos;s detail page to see its word count and total reading time. For half-read books the estimate splits into &quot;<em>Xh Ym total · Zm left</em>&quot; based on your current progress.</li>
                <li><strong>Dashboard tile</strong>: a &quot;<strong>Reading time</strong>&quot; card shows your full library at a glance — minutes left to read, minutes already read, library total. Hides automatically until at least one book has a word count.</li>
                <li><strong>Reading speed</strong>: change yours at <Link to="/account/appearance">Appearance → Reading speed</Link>. Default is 250 wpm (average adult fiction); presets cover Slow (180), Average (250), Fast (350), Speed reader (500). Slider and number input go from 80 to 1500.</li>
                <li><strong>Backfill</strong>: books uploaded before this feature shipped get their word count filled in lazily by an admin sweep, or instantly if an admin runs <code>POST /api/admin/wordcount/backfill</code>.</li>
              </ul>
            </Section>

            <Section id="account" icon={Settings} title="Account & preferences">
              <p>Your Account page is the control center:</p>
              <ul>
                <li><strong>Library stats card</strong> + <strong>Fandom Treemap</strong> for at-a-glance overview</li>
                <li><strong>Library backup</strong> card (download + history + restore link)</li>
                <li><strong>Smart Shelves</strong> manager — create, edit, delete saved filter combinations</li>
                <li><strong>Fandom aliases</strong> — map your custom shorthand to canonical fandom names</li>
                <li><strong>Format prefs</strong> for the Originals shelf</li>
                <li>
                  <strong>Appearance</strong> (theme + colour) — the Navbar carries a single
                  <strong> Sun/Moon icon</strong> that opens an Appearance popover. Inside the popover
                  you can flip light↔dark and pick from seven palette swatches (Peach, Purple, Forest,
                  Ocean, Crimson, Charcoal, and Custom). Hover any swatch to see its name in a live
                  caption. Click a swatch to flip the accent colour site-wide instantly.
                  Tap <strong>More appearance options</strong> at the bottom of the popover to open the
                  dedicated <Link to="/account/appearance">Appearance page</Link>, which adds:
                  <ul>
                    <li><strong>Light/Dark cards</strong> with descriptions instead of a tiny toggle</li>
                    <li><strong>The full Custom hex picker</strong> — four colour inputs for Primary, Primary hover, and two pale tints. Dark-mode variants are auto-derived via HSL math</li>
                    <li><strong>Live preview</strong> showing your active palette on a primary button, secondary button, NEW pill, and a pale-tint card with link</li>
                    <li><strong>Curated palettes gallery</strong> — six hand-picked named palettes (Cozy Library, Midnight Reader, Sun-bleached Paperback, AO3 Classic, Forest Floor, Vintage Ink) you can apply with one click and then tweak</li>
                    <li>
                      <strong>Share palette</strong> card — three ways to share your current look:
                      <ul>
                        <li><strong>Copy token</strong> — a short string (e.g. <code>ss-p-forest</code> for presets, longer <code>ss-c-…</code> base64 for Custom) that someone else can paste to apply your palette in one tap.</li>
                        <li><strong>Copy as Markdown</strong> — drops a formatted block with the palette name, theme, hex codes, and import token onto your clipboard. Pastes cleanly into Discord, GitHub, Notion, anywhere Markdown lives.</li>
                        <li><strong>Download PNG</strong> — generates an 800×420 screenshot of the four swatches with hex labels and palette name; perfect for sharing on social.</li>
                      </ul>
                    </li>
                    <li><strong>Reset to defaults</strong> link at the bottom — two-click confirmation, restores the default Purple palette + default Custom hexes</li>
                  </ul>
                  Saved to this browser only.
                </li>
                <li>
                  <strong>Danger zone — Delete entire library</strong>: wipes every book, EPUB file, reading
                  history entry, smart shelf, and custom category. <em>Your account stays</em> — your login,
                  profile settings, fandom aliases, format prefs, and theme palette are all preserved. Useful
                  for a fresh start without losing your settings. No undo; a ZIP backup is your only recovery.
                </li>
                <li>
                  <strong>Danger zone — Delete account permanently</strong>: schedules your account for deletion
                  in <strong>30 days</strong>. You&apos;re signed out immediately, but books and files stay
                  intact during the grace window — sign back in any time during those 30 days and a banner
                  appears with a one-click <strong>Cancel deletion</strong> button. When you type your email
                  into the confirmation field, a backup-first reminder appears so you can grab a ZIP before
                  committing. Requires the typed email to match. After day 30 a daily scheduler hard-purges
                  the user record, password hash, sessions, library, files, and reading history — that&apos;s
                  the point of no return; a previously-downloaded ZIP is your only recovery.
                </li>
              </ul>
              <p>Found a bug or want a feature? The agent listens — just ask in chat.</p>
            </Section>
            <Section id="operator-digest" icon={LineChart} title="Operator weekly digest (admins only)">
              <p>If you&apos;re an admin, Shelfsort can email you a Sunday-evening rollup of the past week&apos;s site analytics so you can keep a light pulse on engagement without opening the admin console.</p>
              <ul>
                <li><strong>What&apos;s in it</strong>: explore-page views, cover-page views, new signups, top 5 covers by view count (with the sharer&apos;s @handle), and a top-6 referrer mix (Twitter, Reddit, Discord, direct, etc.).</li>
                <li><strong>Cadence</strong>: Sunday 19:00 UTC. Idempotent per ISO week so you never get two for the same Mon–Sun window.</li>
                <li><strong>Enable</strong>: <Link to="/account/emails">Account → Email preferences</Link> → <em>Operator weekly digest</em> card (admin-only — the card is hidden from non-admins). Toggle it on, hit <em>Send sample email</em> to preview the layout.</li>
                <li><strong>Where the data comes from</strong>: same aggregations the <Link to="/admin">Admin Console</Link> analytics widget uses — no separate tracking pipeline.</li>
              </ul>
            </Section>

          </article>
        </div>
          </div>{/* /right column */}
        </div>{/* /flex wrapper */}
      </main>
    </div>
  );
}
