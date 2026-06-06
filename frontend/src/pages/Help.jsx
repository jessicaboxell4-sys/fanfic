import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import {
  ArrowLeft, Upload, Sparkles, Layers, RefreshCw, BookOpen, Trash2, Download,
  Filter, Heart, AlertTriangle, Pin, Settings, GitCompare, Bell, LineChart,
} from "lucide-react";

// Help guide — kept current with the app. Last updated: 2026-05-31.
// When you add a feature, drop a new <Section> here; the table of contents
// builds itself from each section's `id`.

const SECTIONS = [
  { id: "getting-started", label: "Getting started" },
  { id: "uploads", label: "Uploading books" },
  { id: "url-list", label: "Filtering URL lists" },
  { id: "shelves", label: "Shelves & classification" },
  { id: "smart-shelves", label: "Smart shelves" },
  { id: "relationships", label: "Pairings & relationships" },
  { id: "reading", label: "The Reader" },
  { id: "stats", label: "Reading stats & streaks" },
  { id: "refresh", label: "Refreshing fanfics" },
  { id: "versions", label: "Version history" },
  { id: "duplicates", label: "Duplicate handling" },
  { id: "trash", label: "Trash & undo" },
  { id: "exports", label: "Exports (.zip / .xlsx)" },
  { id: "layout", label: "Customizing the dashboard" },
  { id: "account", label: "Account & danger zone" },
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
  // React Router doesn't auto-scroll to #anchor on cross-route navigation —
  // do it manually so deep-links like /help#url-list land in the right place.
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) {
      // Defer a tick so the layout has settled (sticky navbar offset etc.)
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [hash]);
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <header className="mb-10">
          <h1 className="font-serif text-5xl md:text-6xl text-[#2C2C2C] leading-tight">Help</h1>
          <p className="text-[#6B705C] mt-2">How to do everything in Shelfsort. Last updated 2026-05-31.</p>
        </header>

        <div className="grid md:grid-cols-[200px,1fr] gap-10">
          {/* Sticky table of contents */}
          <nav className="md:sticky md:top-24 self-start" data-testid="help-toc">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-3">Sections</p>
            <ul className="space-y-1.5 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-[#6B705C] hover:text-[#E07A5F]">{s.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <article>
            <Section id="getting-started" icon={Sparkles} title="Getting started">
              <p>Shelfsort organizes your EPUB library by fandom, author, pairing, and reading progress — designed especially for fanfiction readers but works for any ebook collection.</p>
              <ol>
                <li>Sign up with email + password (or use Google OAuth)</li>
                <li>Drop an EPUB onto the upload zone on the main library page</li>
                <li>Watch it get auto-classified onto the right shelf</li>
                <li>Click the cover to read it in-browser</li>
              </ol>
            </Section>

            <Section id="uploads" icon={Upload} title="Uploading books">
              <p>The upload zone on the main library page accepts <strong>files and folders</strong>. Drag-and-drop or click <em>Choose files</em> / <em>Pick a folder</em>.</p>
              <p><strong>Supported formats:</strong></p>
              <ul>
                <li><code>.epub</code> — added silently, full pipeline (metadata + classification + cover + chapters + Reader)</li>
                <li><code>.pdf .mobi .azw .azw3 .kfx .docx .doc .rtf .fb2 .lit .lrf .pdb .html .htm</code> — confirmation prompt, then auto-converted to EPUB via Calibre, then full pipeline</li>
                <li><code>.txt</code> with prose — confirm + convert</li>
                <li><code>.txt</code> with fanfic URLs — see "Filtering URL lists" below</li>
              </ul>
              <p>Folders are walked recursively. Unsupported files are skipped with a count toast.</p>
              <p><strong>Conversions take ~5–30 seconds per book.</strong> Progress shows on the dashboard chip and the dedicated <code>/library/conversions</code> page (with Retry for any that failed).</p>
            </Section>

            <Section id="url-list" icon={Filter} title="Filtering URL lists">
              <p>Have a long list of fanfic URLs (an old bookmarks dump, a reclist from a friend, etc.)? Two ways to dedupe it against your library and grab an Excel of the net-new ones:</p>
              <ol>
                <li><strong>Paste</strong>: small link under the upload zone → opens <code>/library/filter-urls</code> → paste URLs one per line → Filter URLs → Download Excel</li>
                <li><strong>Drop a .txt file</strong> of URLs: detection is automatic. A modal pops with already-owned (stripped) vs new (kept) breakdown</li>
              </ol>
              <p>Recognized sources: AO3, FanFiction.net, RoyalRoad, SpaceBattles, SufficientVelocity, and any URL matching our fanfic-permalink patterns.</p>
            </Section>

            <Section id="shelves" icon={BookOpen} title="Shelves & classification">
              <p>Every book lands on a category shelf:</p>
              <ul>
                <li><strong>Fanfiction</strong> — with a fandom sub-shelf (Harry Potter, Twilight, etc.)</li>
                <li><strong>Fiction / Non-fiction / Children's books / Manga & comics</strong> — keyword + AI fallback</li>
                <li><strong>Needs conversion</strong> — when Calibre conversion fails</li>
                <li><strong>Old stories</strong> — automatically-archived earlier versions (see Version history)</li>
                <li><strong>Updated stories YYYY-MM-DD</strong> — auto-created on refresh / re-upload</li>
                <li><strong>Trash</strong> — soft-deleted books with a 30-day grace window</li>
              </ul>
              <p>You can also create custom categories from the sidebar's <em>+</em> button, then drag-or-edit books onto them.</p>
            </Section>

            <Section id="smart-shelves" icon={Filter} title="Smart shelves">
              <p>Smart shelves are saved filter sets — like "All HP fic by Author X with progress &gt; 50%". Visit <code>/library/smart-shelves</code> to create one with any combo of fandom, author, tag, progress range, last-read date, etc.</p>
              <p>Pin your favorites and they appear in the "At a glance" folder on the dashboard.</p>
            </Section>

            <Section id="relationships" icon={Heart} title="Pairings & relationships">
              <p>Relationships are extracted at upload from EPUB <code>dc:subject</code> tags (AO3) and description "Pairings:" lines (FFnet/SpaceBattles). They're canonicalized so <em>"Hermione/Ron"</em> and <em>"Ron/Hermione"</em> live on the same shelf.</p>
              <p>Browse them via the pink chip row on the dashboard sidebar or click any pairing chip on a book's detail page. The <em>Backfill</em> button in Account re-extracts relationships from legacy books.</p>
            </Section>

            <Section id="reading" icon={BookOpen} title="The Reader">
              <p>Click any book cover to open the in-browser Reader (powered by epub.js). Features:</p>
              <ul>
                <li>Adjustable font size, line height, theme (sepia / dark / light)</li>
                <li>Bookmarks + per-chapter navigation</li>
                <li>Auto-saved reading position (last_opened_at + progress_percent)</li>
                <li>Reading heartbeat — every minute spent reading adds to your streak</li>
                <li>"Re-read changes" jumps to the first changed chapter when a fic updates</li>
              </ul>
            </Section>

            <Section id="stats" icon={LineChart} title="Reading stats & streaks">
              <p>The dashboard "At a glance" folder shows your reading-streak day count, total books finished, pages read this week, and a gradient sparkline of the last 30 days. Click <em>View more</em> for the full <code>/library/stats</code> page with a heatmap-style breakdown by fandom + time.</p>
            </Section>

            <Section id="refresh" icon={RefreshCw} title="Refreshing fanfics">
              <p>For any book with a source URL (AO3, FFnet, RoyalRoad, SpaceBattles…) click <em>Refresh</em> on the book detail page. We use <strong>FanFicFare</strong> to re-fetch the latest chapters.</p>
              <p>If the fic has new chapters, the old copy moves to <em>Old stories</em>, the new copy lands on a dated <em>Updated stories YYYY-MM-DD</em> shelf, and the navbar 🔔 bell badges to show what changed.</p>
              <p><strong>FanFiction.net blocks?</strong> If FFnet returns a Cloudflare 403, the UI offers a manual "Upload new version" flow — fetch the EPUB yourself and drop it in.</p>
            </Section>

            <Section id="versions" icon={GitCompare} title="Version history">
              <p>Every refresh creates a versioned chain via <code>replaces</code> / <code>replaced_by</code> pointers. The book detail page shows a "Compare versions" link that opens a per-chapter diff view — added chapters in green, modified in amber, removed in red.</p>
              <p>You can also <strong>link a manual upload as a historical version</strong> of an existing book through the duplicate-resolution modal (useful for old 2020 FFnet exports).</p>
            </Section>

            <Section id="duplicates" icon={Layers} title="Duplicate handling">
              <p>Every upload is checked against your library by (a) normalized title, (b) source URL, and (c) any shared fanfic permalink. When a match is found, a modal pops with four actions per upload:</p>
              <ul>
                <li><strong>Keep both</strong> — leave both copies on the shelves</li>
                <li><strong>Send to Trash</strong> — soft-delete the upload (30-day window)</li>
                <li><strong>Replace as new version</strong> — archive the existing book, dated-shelf the upload</li>
                <li><strong>Link as historical version</strong> — archive the upload under the existing book (for old snapshots)</li>
              </ul>
              <p>Set a <strong>default policy</strong> in Account → Duplicate handling if you don't want to be asked every time. Auto-resolved actions show an "Undo" strip on the dashboard for 30 seconds.</p>
              <p>Visit Account → <em>Find duplicates</em> for a retroactive scan across your whole library.</p>
            </Section>

            <Section id="trash" icon={Trash2} title="Trash & undo">
              <p>Bulk-deletes from the dashboard selection bar and discarded duplicates go to the <strong>Trash</strong> shelf at <code>/library/trash</code>. Each book has a 30-day grace window before an hourly background sweep hard-deletes it.</p>
              <p>From the Trash page: <em>Restore</em> per book, <em>Restore all</em>, or <em>Empty trash</em> for immediate hard deletion.</p>
              <p>Single-book delete from the BookDetail page is <strong>not</strong> reversible — it's an explicit click on the book's own page.</p>
            </Section>

            <Section id="exports" icon={Download} title="Exports (.zip / .xlsx)">
              <p>Top-nav download buttons:</p>
              <ul>
                <li><strong>Download ZIP</strong> — every book in your library as <em>Fandom / Author - Title.epub</em>, ready to side-load onto a Kindle or Kobo</li>
                <li><strong>Library (.xlsx)</strong> — Excel workbook, one sheet per fandom, columns: Filename · Title · Author · Fandom · Source URL</li>
              </ul>
              <p>From a fandom shelf, the same buttons scope to that fandom only.</p>
            </Section>

            <Section id="layout" icon={Pin} title="Customizing the dashboard">
              <p>The "At a glance" folder at the top of the dashboard groups Continue-reading, Reading stats, and Pinned smart shelves. Click <em>Organize</em> to:</p>
              <ul>
                <li>Re-order sections with ↑/↓ chips</li>
                <li>Show/hide any section with the eye icon</li>
                <li>Click <em>Reset</em> to restore defaults</li>
              </ul>
              <p>Changes save automatically per click.</p>
            </Section>

            <Section id="account" icon={Settings} title="Account & danger zone">
              <p>The Account page (top-right avatar) holds:</p>
              <ul>
                <li>Profile (name, email, password change)</li>
                <li>Duplicate handling default policy</li>
                <li>Find duplicates scanner</li>
                <li>FanFicFare config options (User-Agent, login cookies, etc.)</li>
                <li>Email preferences (weekly digest, fic-update emails, year-recap)</li>
                <li>Reset library state — opt-in checkboxes for reading progress / tags / smart shelves / version history</li>
                <li><strong>Delete entire library</strong> — also surfaced at the bottom of the main library page. Requires typing <code>DELETE EVERYTHING</code> to confirm.</li>
              </ul>
            </Section>

            <div className="mt-10 p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#2C2C2C]">
                <strong>Missing something?</strong> If a feature isn't in this guide, it might be brand-new — ping the dev. The guide is updated whenever a feature ships.
              </p>
            </div>
          </article>
        </div>
      </main>
    </div>
  );
}
