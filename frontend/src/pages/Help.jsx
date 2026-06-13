import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import {
  ArrowLeft, Upload, Sparkles, Layers, RefreshCw, BookOpen, Trash2,
  Filter, Heart, AlertTriangle, Settings, GitCompare, Bell, LineChart,
  Globe, Shield, CheckCircle2, Clock, FileWarning, User as UserIcon, X,
  MessageSquare, Search,
} from "lucide-react";

// Help guide — kept current with the app. Last updated: 2026-06-09.
// When you add a feature, drop a new <Section> here; the sticky table
// of contents builds itself from each section's `id`.

// "What's new" card. The card pulls from `GET /api/announcements/latest`
// at runtime; if the API returns nothing (fresh install, network error)
// we fall back to FALLBACK_WHATS_NEW below. To ship a new note WITHOUT a
// deploy, POST to /api/announcements with a fresh `version` string.
// `version` doubles as the per-user localStorage dismissal key.
const FALLBACK_WHATS_NEW = {
  version: "2026-06-13",
  title: "Fresh in Shelfsort",
  items: [
    { to: "/library/unread", label: "Reader bookmarks", desc: "— save any page in the Reader, jump back from the bookmark panel, and see all your bookmarks across the library." },
    { to: "/library/unread", label: "Books I haven't read shelf", desc: "— a one-click filter for everything in your library you haven't opened yet." },
    { to: "/", label: "\u201CSurprise me\u201D random book", desc: "— Dashboard button that opens a random unread book." },
    { to: "/", label: "Reading queue", desc: "— stack your next reads as an \u201CUp next\u201D list that follows you across devices." },
    { to: "/friends", label: "Friend uploads pings", desc: "— get notified when friends add a book in a fandom you also collect." },
  ],
};
const WHATS_NEW_KEY = "shelfsort.whatsNewDismissed";
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SECTIONS = [
  { id: "getting-started", label: "Getting started" },
  { id: "uploads", label: "Uploading books" },
  { id: "shelves", label: "Shelves & filters" },
  { id: "discovery", label: "Browsing & discovery" },
  { id: "ao3-metadata", label: "AO3 metadata: ratings, warnings, tags" },
  { id: "fandoms", label: "Fandoms we sort into" },
  { id: "sources", label: "Sources we recognize" },
  { id: "detection", label: "Detection & overrides" },
  { id: "data-safety", label: "Backup & restore" },
  { id: "reading", label: "Reader & stats" },
  { id: "messages", label: "Messages & friends" },
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
          <p className="text-[#6B705C] mt-2">How to do everything in Shelfsort. Last updated 2026-06-13.</p>
          <p className="text-sm text-[#6B705C] mt-3">
            Don&rsquo;t see what you&rsquo;re looking for? <Link to="/suggestions" className="text-[var(--primary)] font-semibold underline">Drop a suggestion →</Link> — bugs, tweaks, brand new ideas all welcome.
          </p>
          <div className="mt-5 relative max-w-md" data-testid="help-search-wrapper">
            <Search className="w-4 h-4 text-[#6B705C] absolute top-1/2 -translate-y-1/2 left-3 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the docs… (e.g. palette, friends, EPUB)"
              data-testid="help-search-input"
              className="w-full pl-9 pr-9 py-2.5 text-sm rounded-full border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#3A5A40]/30"
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
              {["palette", "friends", "EPUB", "shelves", "backup", "dark mode"].map((chip) => (
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
              <a href="#shelves" className="inline-block mt-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#3A5A40] hover:text-[#E07A5F]">
                Jump to the full shelf guide →
              </a>
            </div>
          </div>
        </aside>

        <div className="grid md:grid-cols-[200px,1fr] gap-10">
          <nav className="md:sticky md:top-24 self-start" data-testid="help-toc">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-3">Sections</p>
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

          <article>
            <Section id="getting-started" icon={Sparkles} title="Getting started">
              <p>Shelfsort organizes your EPUB library by fandom, author, pairing, completion status, and reading progress — built for fanfiction readers but works for any ebook collection.</p>
              <ol>
                <li>Sign in with email + password (or Google OAuth)</li>
                <li>Drop an EPUB onto the upload zone on the main library page</li>
                <li>Watch it get auto-classified onto the right shelf, with status and pairings extracted</li>
                <li>Click the cover to read it in-browser</li>
              </ol>
              <p>Everything is auto-detected at upload time — you only step in when you want to override.</p>
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

            <Section id="fandoms" icon={BookOpen} title="Fandoms we sort into">
              <p>Shelfsort recognizes <strong>{knownFandoms.length || "…"}</strong> fandoms out of the box and routes a book to one of them automatically when the title, description, or sample text matches enough of that fandom&apos;s keywords. Anything that doesn&apos;t match well enough falls into <em>Original Fiction</em> or <em>Non-fiction</em> — and the admin&apos;s unknown-fandoms queue surfaces popular suggestions for promotion.</p>
              <p>Sorted by community-wide popularity (most-used first) and grouped by franchise so related sub-fandoms (NCIS spin-offs, all Stargate series, Marvel + MCU + Avengers, …) stay together. Counts reflect everyone&apos;s libraries on this instance, anonymized.</p>
              <div className="columns-1 sm:columns-2 lg:columns-3 gap-x-6 text-sm bg-[#FAF6EE] border border-[#E8E6E1] rounded-lg p-4 text-[#2C2C2C]" data-testid="help-fandoms-list">
                {fandomGroups.length === 0 ? (
                  <span className="text-[#6B705C] italic">Loading the list…</span>
                ) : fandomGroups.map((g) => (
                  <div key={g.name} className="break-inside-avoid mb-4" data-testid={`fandom-group-${g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="font-semibold text-[#3A5A40]">{g.name}</span>
                      {g.total > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#3A5A40]/10 text-[#3A5A40]" title={`${g.total} book${g.total === 1 ? "" : "s"} across the community`}>
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

            <Section id="messages" icon={MessageSquare} title="Messages & friends">
              <p>
                Shelfsort has built-in direct messaging at <Link to="/messages">/messages</Link>. Three room types coexist:
              </p>
              <ul>
                <li><strong>Admin-curated group rooms</strong> — an admin creates the room and picks members. Members chat freely inside.</li>
                <li><strong>1-on-1 DMs between friends</strong> — once you and another user are friends, either side can open a DM that lives forever in your sidebar.</li>
                <li><strong>1-on-1 DMs from anyone</strong> — if a user has opened up their privacy to &ldquo;anyone&rdquo;, you can DM them without being friends first.</li>
              </ul>
              <p>Three kinds of messages: text (Enter to send, Shift+Enter for newline), attached <strong>book</strong> (search your library, recipient gets a card linking to it), and attached <strong>palette token</strong> (one-click Apply on the recipient&rsquo;s side using the share-palette work).</p>
              <p>
                <strong>Friends</strong> live at <Link to="/friends">/friends</Link>: search by name or email (min 2 chars), send a request, the other side accepts or declines.
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

            <Section id="account" icon={Settings} title="Account & preferences">
              <p>Your Account page is the control center:</p>
              <ul>
                <li><strong>Library stats card</strong> + <strong>Fandom Treemap</strong> for at-a-glance overview</li>
                <li><strong>Library backup</strong> card (download + history + restore link)</li>
                <li><strong>Smart Shelves</strong> manager — create, edit, delete saved filter combinations</li>
                <li><strong>Fandom aliases</strong> — map your custom shorthand to canonical fandom names</li>
                <li><strong>Format prefs</strong> for the Originals shelf</li>
                <li>
                  <strong>Appearance</strong> (theme + colour) — click the sun/moon icon in the Navbar.
                  A small popover drops down with the Light/Dark toggle and the seven palette swatches
                  (Peach, Purple, Forest, Ocean, Crimson, Charcoal, and Custom). Hover any swatch to see
                  its name in a live caption. Click a swatch to flip the accent colour site-wide instantly.
                  Tap <strong>More appearance options</strong> at the bottom of the popover to open the
                  dedicated <Link to="/account/appearance">Appearance page</Link>, which adds:
                  <ul>
                    <li><strong>Light/Dark cards</strong> with descriptions instead of a tiny toggle</li>
                    <li><strong>The full Custom hex picker</strong> — four colour inputs for Primary, Primary hover, and two pale tints. Dark-mode variants are auto-derived via HSL math</li>
                    <li><strong>Live preview</strong> showing your active palette on a primary button, secondary button, NEW pill, and a pale-tint card with link</li>
                    <li><strong>Curated palettes gallery</strong> — six hand-picked named palettes (Cozy Library, Midnight Reader, Sun-bleached Paperback, AO3 Classic, Forest Floor, Vintage Ink) you can apply with one click and then tweak</li>
                    <li><strong>Share palette</strong> card — copy your current palette as a short token (e.g. <code>ss-p-forest</code> for presets, longer <code>ss-c-…</code> base64 for Custom) and apply tokens others have shared with you</li>
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
