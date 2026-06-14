import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import {
  ArrowLeft, ArrowLeftRight, Upload, Sparkles, Layers, RefreshCw, BookOpen, Trash2,
  Filter, Heart, AlertTriangle, Settings, GitCompare, Bell, LineChart,
  Globe, Shield, CheckCircle2, Clock, FileWarning, User as UserIcon, X,
  MessageSquare, Search, ListChecks, AtSign, Target, Compass,
} from "lucide-react";

// Help guide — kept current with the app. Last updated: 2026-06-14.
// When you add a feature, drop a new <Section> here; the sticky table
// of contents builds itself from each section's `id`.

// "What's new" card. The card pulls from `GET /api/announcements/latest`
// at runtime; if the API returns nothing (fresh install, network error)
// we fall back to FALLBACK_WHATS_NEW below. To ship a new note WITHOUT a
// deploy, POST to /api/announcements with a fresh `version` string.
// `version` doubles as the per-user localStorage dismissal key.
const FALLBACK_WHATS_NEW = {
  version: "2026-06-14-handles",
  title: "Fresh in Shelfsort",
  items: [
    { to: "/goals", label: "Reading goals", desc: "— set a yearly or monthly target (books or minutes), watch the SVG ring fill, and get confetti the moment you hit it." },
    { to: "/account#username", label: "Public usernames", desc: "— claim a one-of-a-kind @handle (capital letters welcome) so friends can find you without sharing your email." },
    { to: "/friends", label: "@handle autocomplete", desc: "— type `@` in the friend-invite or bookclub-invite box and pick from a live dropdown of usernames." },
    { to: "/library/all", label: "Navbar book search", desc: "— a typeahead in the top bar jumps straight to any title or author in your library, no clicks required." },
    { to: "/help#tour", label: "First-time tour", desc: "— the welcome overlay walks new accounts through Upload, Library, Friends, and Reading goals. Replay it anytime from the “Replay tour” link below." },
  ],
};
const WHATS_NEW_KEY = "shelfsort.whatsNewDismissed";
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SECTIONS = [
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
  { id: "reading", label: "Reader & stats" },
  { id: "word-count", label: "Word count & reading time" },
  { id: "usernames", label: "Public usernames & @handles" },
  { id: "messages", label: "Messages & friends" },
  { id: "bookclubs", label: "Book-club reading rooms" },
  { id: "recommendations", label: "Friend recommendations" },
  { id: "opds", label: "E-reader sync (OPDS)" },
  { id: "notifications", label: "Notifications & mutes" },
  { id: "auto-theme", label: "Scheduled auto-theme" },
  { id: "account", label: "Account & preferences" },
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
      <main className="max-w-5xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <header className="mb-8">
          <h1 className="font-serif text-5xl md:text-6xl text-[#2C2C2C] leading-tight">Help</h1>
          <p className="text-[#6B705C] mt-2">How to do everything in Shelfsort. Last updated 2026-06-14.</p>
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
            <li><Link to="/goals" className="hover:underline font-semibold">Reading goals</Link> — yearly &amp; monthly targets, confetti on hit</li>
            <li><a href="#usernames" className="hover:underline font-semibold">Public usernames &amp; @handles</a> with autocomplete</li>
            <li><a href="#quick-search" className="hover:underline">Navbar book quick-search</a> — typeahead jumps</li>
            <li><a href="#tour" className="hover:underline">First-time tour</a> — replay any time</li>
            <li><a href="#bookclubs" className="hover:underline">Book-club reading rooms</a> — chat-style layout</li>
            <li><a href="#word-count" className="hover:underline">Word count &amp; reading time</a> with WPM setting</li>
            <li><a href="#recommendations" className="hover:underline">Friend recommendations</a> + weekly Sunday digest</li>
            <li><a href="#auto-theme" className="hover:underline">Scheduled auto-theme</a> (light by day / dark by night)</li>
            <li><a href="#opds" className="hover:underline">E-reader sync (OPDS)</a> for KOReader, Moon+, Marvin</li>
            <li><a href="#notifications" className="hover:underline">Per-kind notification mutes</a></li>
            <li><a href="#messages" className="hover:underline">Friends &amp; DMs unified</a> at /friends with inline chat drawer</li>
            <li><a href="#bookclubs" className="hover:underline">Book-club weekly email digest</a> (opt-in)</li>
          </ul>
        </div>

        <div className="grid md:grid-cols-[200px,minmax(0,1fr)] gap-10">
          <nav
            className="md:sticky md:top-24 self-start min-w-0 md:max-h-[calc(100vh-7rem)] md:overflow-y-auto md:pr-2 md:[scrollbar-width:thin]"
            data-testid="help-toc"
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">Sections</p>
            <ul className="space-y-1.5 text-sm">
              {SECTIONS.filter((s) => matchingSectionIds.includes(s.id)).map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-[#6B705C] hover:text-[#E07A5F]">{s.label}</a>
                </li>
              ))}
              {SECTIONS.length > 0 && matchingSectionIds.length === 0 && (
                <li className="text-[10px] italic text-[#6B705C]">no matches — clear search to see all</li>
              )}
            </ul>
          </nav>

          <article className="min-w-0 break-words">
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
                <li><strong><Link to="/library/originals">Originals</Link></strong> — books you uploaded as PDF/MOBI/etc. while an EPUB version already exists</li>
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
                <li><strong>View / reorder / remove</strong>: open the <Link to="/library/queue">Reading queue page</Link> from the dashboard&apos;s &ldquo;Up next&rdquo; rail. Each row shows index + cover + title/author; use the ▲▼ arrows to reorder or × to remove.</li>
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
                <li><strong>Confetti on hit</strong>: the moment a goal crosses 100%, a CSS-only burst plays and the goal is stamped with a <code>hit_at</code> timestamp so it stays celebrated even if you re-edit the target later.</li>
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
                <li>Lets you download just the new URLs as a <code>.txt</code> or <code>.xlsx</code> — ready to paste into FanFicFare or a download manager.</li>
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

            <Section id="reading" icon={BookOpen} title="Reader & stats">
              <p>Click any book cover to open the in-browser EPUB Reader. Your reading position is saved per-book; come back to where you left off automatically.</p>
              <p><strong>Bookmarks</strong>: while reading, tap the <em>Bookmark</em> button in the reader header to save your current page. Open the <em>Bookmark</em> panel (the icon next to it with the count) to see every saved spot for this book, jump to any of them, or remove one. Each bookmark stores the chapter title, your reading-progress percentage, and the date you saved it. Bookmarks sync to your account so they follow you across devices.</p>
              <p>You can also see every bookmark across your whole library on the <Link to="/bookmarks">All bookmarks</Link> page.</p>
              <p><strong>Surprise me</strong>: on the Dashboard, the &ldquo;Surprise me&rdquo; button picks a random book you haven&apos;t opened yet and drops you straight into it — useful when decision fatigue strikes.</p>
              <p><strong>Books I haven&apos;t read</strong>: the dedicated <Link to="/library/unread">unread shelf</Link> lists every book you&apos;ve never opened, newest upload first.</p>
              <p><strong>Up next queue</strong>: build a personal reading order with the <em>Up next</em> widget on the Dashboard. Books in the queue persist across devices.</p>
              <p>The <Link to="/stats">Reading stats</Link> page covers your library shape, most-read fandoms, and pairing distribution. (Reading streaks + word-count + per-month stats are on the upcoming list.)</p>
              <p><strong>Refresh fanfics</strong>: the URL-fetching feature (FanFicFare + FicHub) is intentionally hidden from the UI but the code is preserved for a future re-enable. No FAQ entry until then.</p>
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
                <strong>Notifications</strong>: the chat-bubble icon in the Navbar shows one combined badge — unread messages + pending friend requests added together. Hover for the breakdown.
              </p>
              <p className="text-xs text-[#6B705C] italic">
                Phase 1c (one-click &ldquo;switch to open&rdquo; banner) and websockets for instant delivery are parked. Current 15-second poll is plenty for casual chat.
              </p>
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

            <Section id="bookclubs" icon={MessageSquare} title="Book-club reading rooms">
              <p>Private invite-only spaces where you and friends read the <em>same book</em> together. Find them at <Link to="/bookclubs">/bookclubs</Link>.</p>
              <ul>
                <li><strong>Chat-style layout</strong>: room list on the left, active conversation in the middle, members + progress + invites in a collapsible right rail. Mobile collapses the room list into a drawer.</li>
                <li><strong>Chapter threads</strong>: every room has a <em>Lobby</em> plus one tab per chapter in the book. Pick a tab to scope your messages to that part of the book — perfect for spoiler-safe discussion.</li>
                <li><strong>Progress slider</strong>: drag to mark your current chapter. When you cross the finish line, every other active member gets a notification (and a row in the Sunday digest if they&apos;ve opted in).</li>
                <li><strong>Roles</strong>: Owner / Moderator / Member. Owners can edit, invite, promote, demote, remove, transfer ownership, or delete. Moderators can edit + invite + remove. Members read &amp; post.</li>
                <li><strong>Friends-only invites</strong>: pick from your accepted-friends list <em>or</em> type an <code>@handle</code> in the quick-invite field at the top of the members rail to invite anyone on Shelfsort. Use <Link to="/friends">/friends</Link> to add people first if you&apos;d rather route through the friends list.</li>
                <li><strong>Notifications</strong>: bookclub invites and per-message pings always fire in the bell. Optional <em>weekly email digest</em> ships every Monday at 08:00 UTC summarising the past week&apos;s activity across all your rooms — opt-in at <Link to="/account/emails">Account → Emails</Link>.</li>
              </ul>
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

            <Section id="notifications" icon={Settings} title="Notifications & mutes">
              <p>The bell icon in the navbar shows every kind of in-app ping — friend requests, accepted requests, friend uploads in fandoms you collect, bookclub invites + messages + finishers, weekly digests, suggestion status changes.</p>
              <ul>
                <li><strong>In-app notifications always fire</strong> — there&apos;s no master &quot;all on/off&quot; toggle. Emails are the only thing you opt into.</li>
                <li><strong>Per-kind mute matrix</strong>: at <Link to="/account/emails">Account → Emails</Link>, scroll past the email channels to the <em>In-app notifications</em> card. Each kind has its own toggle so you can keep bookclub invites loud and silence chatty message pings.</li>
                <li><strong>Critical kinds</strong> (friend requests, bookclub invites) cannot be muted — they&apos;re actionable and would silently disappear if turned off.</li>
                <li><strong>Email channels</strong> (all opt-in, default OFF): Weekly digest, Fic updates, Year-in-Books recap, From-friends weekly, Book-club weekly. Each has a &quot;send sample&quot; button so you can preview before subscribing.</li>
              </ul>
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

            <Section id="account" icon={Settings} title="Account & preferences">
              <p>Your Account page is the control center:</p>
              <ul>
                <li><strong>Library stats card</strong> + <strong>Fandom Treemap</strong> for at-a-glance overview</li>
                <li><strong>Library backup</strong> card (download + history + restore link)</li>
                <li><strong>Smart Shelves</strong> manager — create, edit, delete saved filter combinations</li>
                <li><strong>Fandom aliases</strong> — map your custom shorthand to canonical fandom names</li>
                <li><strong>Format prefs</strong> for the Originals shelf</li>
                <li>
                  <strong>Appearance</strong> (theme + colour) — the Navbar carries a paired button group:
                  the <strong>Sun/Moon icon flips light↔dark on a single click</strong>, and the small
                  palette icon next to it opens an Appearance popover with the seven palette swatches
                  (Peach, Purple, Forest, Ocean, Crimson, Charcoal, and Custom). Hover any swatch to see
                  its name in a live caption. Click a swatch to flip the accent colour site-wide instantly.
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
          </article>
        </div>
      </main>
    </div>
  );
}
