import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Sparkles,
  FolderTree,
  Download,
  Wand2,
  PartyPopper,
  Users,
  MessagesSquare,
  Target,
  Tablet,
  PencilLine,
  Shield,
  Smartphone,
  Heart,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PrimaryCTAButton from "../components/PrimaryCTAButton";
import SecondaryCTAButton from "../components/SecondaryCTAButton";
import CommunityShowcase from "../components/CommunityShowcase";

// A curated rotation of well-known fandoms we already sort into. Stays static
// (no API call from the unauthenticated Landing) so the page paints instantly.
// Order matters: Harry Potter first because that's how a lot of visitors
// arrive ("does this thing sort my HP fic?"), then the rest cycle.
const FANDOM_TICKER = [
  "Harry Potter",
  "ACOTAR",
  "Marvel",
  "Twilight",
  "Star Wars",
  "Hunger Games",
  "Percy Jackson",
  "Bridgerton",
  "Stranger Things",
  "Doctor Who",
  "Sherlock",
  "Good Omens",
  "Lord of the Rings",
  "House M.D.",
  "Friends",
  "Avatar",
];

// Three fandoms with believable-but-fake titles to showcase what an
// auto-sorted Shelfsort library actually looks like.  These are not real
// books — they're representative samples for the public landing page.
const SAMPLE_SHELVES = [
  {
    name: "Harry Potter",
    accent: "#6B46C1",
    swatch: "linear-gradient(135deg, #6B46C1 0%, #4C2A99 100%)",
    books: [
      { title: "The Wand-Maker's Daughter", author: "Astrid Vance" },
      { title: "After the Battle", author: "Wren Carrow" },
      { title: "Year One, Again", author: "M. Aldwell" },
      { title: "Letters from the Hat", author: "Rowena Twist" },
    ],
  },
  {
    name: "Twilight",
    accent: "#B43F26",
    swatch: "linear-gradient(135deg, #B43F26 0%, #6D1A11 100%)",
    books: [
      { title: "The Long Winter in Forks", author: "C. Halloway" },
      { title: "Goldfinch on the Rooftop", author: "Lila Mercer" },
      { title: "A Year Without Summer", author: "K. Beaumont" },
    ],
  },
  {
    name: "Marvel",
    accent: "#E07A5F",
    swatch: "linear-gradient(135deg, #E07A5F 0%, #B5503A 100%)",
    books: [
      { title: "Quiet Days in Wakanda", author: "Imani Okafor" },
      { title: "The Backup Avenger", author: "S. Park" },
      { title: "Coffee at Stark Tower", author: "Jaime León" },
      { title: "Notes from a Tesseract", author: "P. Hartley" },
    ],
  },
  {
    name: "House M.D.",
    accent: "#1F4D6B",
    swatch: "linear-gradient(135deg, #1F4D6B 0%, #0E2C40 100%)",
    books: [
      { title: "Differential of the Heart", author: "Maddie Cuddy" },
      { title: "The Last Vicodin", author: "G. Foreman" },
      { title: "Everybody Lies, Quietly", author: "Wilson & House" },
      { title: "Princeton-Plainsboro Nights", author: "A. Hadley" },
    ],
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleStart = () => {
    if (user) navigate("/library");
    else navigate("/login");
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
            <BookOpen className="w-6 h-6 text-[#E07A5F]" />
            <span className="font-serif text-2xl font-medium text-[#2C2C2C]">Shelfsort</span>
          </Link>
          <button
            data-testid="header-cta"
            onClick={handleStart}
            className="btn-primary text-sm"
          >
            {user ? "Open library" : "Sign in"}
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-20 grid lg:grid-cols-2 gap-12 items-center">
        <div className="fade-in">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-6">
            A quieter way to organize ebooks
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05] mb-6">
            Your EPUBs,<br/>
            sorted by <span className="italic text-[#E07A5F]">fandom</span>.
          </h1>
          <p className="text-base sm:text-lg text-[#6B705C] leading-relaxed mb-6 max-w-lg">
            Got a Downloads folder full of nameless EPUBs? Shelfsort reads the
            metadata and uses AI to file them by Harry Potter, Twilight, Marvel,
            original fiction, and anything else hiding in there. Then it gives
            them a home — a clean reader, a year-end recap, friends to talk
            about them with, the works.
          </p>
          <FandomTicker className="mb-8" />
          <div className="flex flex-wrap gap-3">
            <PrimaryCTAButton
              testid="hero-cta-start"
              onClick={handleStart}
            >
              Start sorting
            </PrimaryCTAButton>
            <SecondaryCTAButton
              testid="hero-cta-learn"
              anchor="#features"
            >
              How it works
            </SecondaryCTAButton>
          </div>
          {/* Trust strip — tiny social-proof under the CTA so first-time
              visitors immediately see the three differentiators we ship.
              Each item is icon + ~3 words; the whole row is one line on
              desktop, wraps on mobile.  No claims we can't back up. */}
          <ul
            className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 text-xs text-[#6B705C]"
            data-testid="hero-trust-strip"
          >
            <li className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#6B46C1]" />
              <span>AI auto-sorts by fandom</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#2C7A3E]" />
              <span>Every upload virus-scanned</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-[#E07A5F]" />
              <span>Sync across devices</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-[#B43F26]" />
              <span>Free while we grow</span>
            </li>
          </ul>
        </div>
        <div className="relative">
          <img
            src="/landing-hero.png"
            alt="A cozy reading nook with a sage-green armchair, plum cushion, and books stacked on a sunlit wood floor"
            className="rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full"
          />
        </div>
      </section>

      {/* Social proof strip — three live counters that build credibility
          without screaming.  Cached server-side (10-min TTL) so the
          homepage stays fast under load.  Hidden until the API resolves
          so we never show a flicker of "0 books sorted". */}
      <SocialProofStrip />

      <section id="features" className="max-w-6xl mx-auto px-6 md:px-8 pb-12 grid md:grid-cols-3 gap-6">
        <Feature
          icon={<Sparkles className="w-5 h-5" />}
          title="AI + metadata"
          body="EPUB metadata first, Claude as a quiet second opinion when the title alone won't tell."
        />
        <Feature
          icon={<FolderTree className="w-5 h-5" />}
          title="Folders that feel right"
          body="Fanfiction nests by fandom. Original fiction and non-fiction stay tidy on their own shelves."
        />
        <Feature
          icon={<Download className="w-5 h-5" />}
          title="Take it with you"
          body="Download a perfectly organized ZIP — your library, on any device, anywhere."
        />
      </section>

      {/* "What's inside" — the welcoming reveal.  Sorting is the door, but the
          stuff happening after a user signs in is what keeps them around.
          Six warm cards, mixed accent colors, no screenshots needed. */}
      <section id="inside" className="max-w-6xl mx-auto px-6 md:px-8 pb-24">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
          More than a sorter
        </p>
        <h2 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] mb-3">
          A whole little world for your <span className="italic text-[#E07A5F]">reading life</span>.
        </h2>
        <p className="text-base text-[#6B705C] max-w-2xl mb-10">
          Shelfsort is built for people who read the way you do — bouncing between
          a 200k-word AO3 fic, a non-fic on the nightstand, and three half-read
          novels. Here&apos;s what you get the second you sign in.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          <InsideCard
            icon={<PartyPopper className="w-5 h-5" />}
            accent="#6B46C1"
            tint="bg-[#EDE7FB]"
            title="Year in Books, Wrapped"
            body="A nine-slide cinematic recap at the end of every year — books opened, pages turned, longest streak, top fandom, top author, bookends. Download it as a PNG, paste it into Threads or iMessage, watch friends ask what you've been reading."
          />
          <InsideCard
            icon={<Tablet className="w-5 h-5" />}
            accent="#E07A5F"
            tint="bg-[#FBE7DF]"
            title="A reader that respects your eyes"
            body="EPUB, PDF, TXT and DOCX all open inline. Reading position syncs across devices, bookmarks remember the chapter you loved, dark mode follows your OS, and there are zero ads. Ever."
          />
          <InsideCard
            icon={<Target className="w-5 h-5" />}
            accent="#1F4D6B"
            tint="bg-[#DCE8EF]"
            title="Goals & streaks (gently)"
            body="Set a goal of 30 books, or 200 hours, or a fandom marathon. We track quietly, fire confetti when you hit it, and never guilt-trip you on a Tuesday."
          />
          <InsideCard
            icon={<Users className="w-5 h-5" />}
            accent="#B43F26"
            tint="bg-[#F9DED5]"
            title="Friends who actually read"
            body="Pick a one-of-a-kind @handle, add friends by username, see how many books overlap with theirs, send recs, share a peek at your shelf — all opt-in, all revocable."
          />
          <InsideCard
            icon={<MessagesSquare className="w-5 h-5" />}
            accent="#6B46C1"
            tint="bg-[#EDE7FB]"
            title="Book clubs, with chapters"
            body="Spin up a private room, pick the book, set a chapter-per-week pace. We auto-post discussion prompts, members chat inline, and a weekly digest email keeps the slow readers in the loop."
          />
          <InsideCard
            icon={<PencilLine className="w-5 h-5" />}
            accent="#E07A5F"
            tint="bg-[#FBE7DF]"
            title="Fix messy metadata, in place"
            body="Title got mangled by an AO3 export? Author shows as &ldquo;Unknown&rdquo;? Edit it in two clicks — corrections are rewritten into the EPUB itself, so when you re-download or send to a friend, the fix travels with the file."
          />
        </div>
      </section>

      {/* Sample shelves — the conversion punch.  Shows visitors exactly
          what a sorted library looks like before they sign in.  Pure CSS
          covers, no external assets, so the page stays fast. */}
      <section id="preview" className="bg-[#F2EDDF] border-y border-[#E8E6E1]">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            What it looks like
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] mb-3">
            Three messy folders in. <span className="italic text-[#E07A5F]">Three tidy shelves out.</span>
          </h2>
          <p className="text-base text-[#6B705C] max-w-2xl mb-12">
            Here&apos;s the same library a friend tested with on day one — 11 EPUBs dropped in as a
            single zip, organized in under a minute. No tagging, no renaming, no Calibre wrestling.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {SAMPLE_SHELVES.map((shelf) => (
              <ShelfPreview key={shelf.name} shelf={shelf} />
            ))}
          </div>
          <div className="mt-12 flex items-center gap-3 text-xs font-medium text-[#6B705C]">
            <Wand2 className="w-4 h-4 text-[#6B46C1]" />
            Sample shelves shown — your own library uses real covers, real metadata, real chapters.
          </div>
        </div>
      </section>

      {/* Bottom CTA — last push before the visitor leaves. */}
      <CommunityShowcase />
      <section className="max-w-4xl mx-auto px-6 md:px-8 py-24 text-center">
        <h2 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] mb-4">
          Ready to see your library, sorted?
        </h2>
        <p className="text-base text-[#6B705C] mb-8 max-w-xl mx-auto">
          Free to try with up to 50 books. AI sorting, in-app reader, Year in Books recap,
          reading goals, friends, and book clubs — all included from day one.
        </p>
        <PrimaryCTAButton testid="footer-cta-start" onClick={handleStart}>
          Start sorting — it&apos;s free
        </PrimaryCTAButton>
      </section>
    </div>
  );
}

function ShelfPreview({ shelf }) {
  return (
    <div
      className="shelf-card p-5 hover:shadow-lg transition-shadow"
      data-testid={`landing-shelf-${shelf.name.toLowerCase().replace(/ /g, "-")}`}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-serif text-xl text-[#2C2C2C]">{shelf.name}</h3>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white"
          style={{ background: shelf.accent }}
        >
          {shelf.books.length} books
        </span>
      </div>
      <ul className="space-y-2">
        {shelf.books.map((b) => (
          <li
            key={b.title}
            className="flex items-center gap-3 p-2 -mx-1 rounded-lg hover:bg-[#FAF6EE]"
          >
            <div
              className="w-7 h-10 rounded-sm shrink-0 shadow-sm"
              style={{ background: shelf.swatch }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#2C2C2C] truncate">{b.title}</p>
              <p className="text-[11px] text-[#6B705C] truncate">{b.author}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Feature({ icon, title, body }) {
  return (
    <div className="shelf-card p-6">
      <div className="w-10 h-10 rounded-lg bg-[#EDE7FB] text-[#6B46C1] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-serif text-xl text-[#2C2C2C] mb-2">{title}</h3>
      <p className="text-sm text-[#6B705C] leading-relaxed">{body}</p>
    </div>
  );
}

function InsideCard({ icon, accent, tint, title, body }) {
  return (
    <div className="shelf-card p-6 hover:shadow-lg transition-shadow">
      <div
        className={`w-11 h-11 rounded-xl ${tint} flex items-center justify-center mb-4`}
        style={{ color: accent }}
      >
        {icon}
      </div>
      <h3 className="font-serif text-xl text-[#2C2C2C] mb-2 leading-snug">{title}</h3>
      <p className="text-sm text-[#6B705C] leading-relaxed">{body}</p>
    </div>
  );
}

// Tiny live-feeling marquee — "150+ fandoms · {rotating name}" that fades
// through real fandoms. Pure React state + a 2.4s interval. The fading text
// has a fixed inline-block min-width so the surrounding line doesn't jitter
// as fandom names of different lengths swap in. Pauses on hover so visitors
// who want to read a specific name can.
function FandomTicker({ className = "" }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // Live counters — fetched once from the public /landing/stats endpoint.
  // Falls back to the curated "150+ fandoms" copy until the request lands
  // (or forever if the request fails) so the marquee never renders empty.
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % FANDOM_TICKER.length);
    }, 2400);
    return () => clearInterval(id);
  }, [paused]);

  // One-shot fetch.  Use the bare backend URL (no axios auth header)
  // because the endpoint is unauthenticated.  Silently swallow failures.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_BACKEND_URL}/api/landing/stats`,
          { credentials: "omit" },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch {
        /* keep the static fallback copy */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Format with thousands separators for the books number — keeps the
  // pill aesthetic intact even when the library hits five+ digits.
  const books = stats?.books_sorted;
  const fandoms = stats?.fandoms_recognized;
  const fandomLabel = (typeof fandoms === "number" && fandoms > 0)
    ? `${fandoms}+ fandoms`
    : "150+ fandoms";
  const booksLabel = (typeof books === "number" && books > 0)
    ? `${books.toLocaleString()} books sorted`
    : null;

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#EDE7FB]/60 border border-[#6B46C1]/15 text-sm text-[#4C2A99] ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="fandom-ticker"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#6B46C1] animate-pulse" />
      <span className="font-semibold" data-testid="fandom-ticker-fandoms">
        {fandomLabel}
      </span>
      {booksLabel && (
        <>
          <span aria-hidden className="opacity-50">·</span>
          <span
            className="text-[#4C2A99]/80"
            data-testid="fandom-ticker-books"
          >
            {booksLabel}
          </span>
        </>
      )}
      <span aria-hidden className="opacity-50">·</span>
      <span
        key={idx}
        className="font-serif italic text-[#2C2C2C] min-w-[8.5rem] inline-block fade-in"
        data-testid="fandom-ticker-name"
      >
        {FANDOM_TICKER[idx]}
      </span>
    </div>
  );
}


// ---------------------------------------------------------------------
// SocialProofStrip — three live, cached counters above the Features grid
// ---------------------------------------------------------------------
// Same data source as the FandomTicker (so we don't make two requests)
// — public ``/api/landing/stats`` is 10-min TTL cached server-side and
// returns ``books_sorted`` / ``fandoms_recognized`` / ``readers``.  We
// hide the strip entirely while loading so visitors never see the
// "0 books sorted" flicker.
function SocialProofStrip() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_BACKEND_URL}/api/landing/stats`,
          { credentials: "omit" },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setStats(json);
      } catch { /* silent — strip just doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stats) return null;
  // Bail if every counter is zero — early-stage installs shouldn't
  // advertise emptiness.
  const total = (stats.books_sorted || 0) + (stats.readers || 0) + (stats.fandoms_recognized || 0);
  if (total === 0) return null;

  const cells = [
    { value: stats.books_sorted, label: "books sorted",      testid: "social-proof-books" },
    { value: stats.readers,      label: "readers",           testid: "social-proof-readers" },
    { value: stats.fandoms_recognized, label: "fandoms",     testid: "social-proof-fandoms" },
  ].filter((c) => (c.value || 0) > 0);

  return (
    <section
      className="max-w-6xl mx-auto px-6 md:px-8 pb-10"
      data-testid="social-proof-strip"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        {cells.map((c) => (
          <div
            key={c.testid}
            data-testid={c.testid}
            className="rounded-xl bg-[#FBFAF6] border border-[#E5DDC5] px-4 py-3 sm:px-5 sm:py-4 text-center"
          >
            <p className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] tabular-nums">
              {Number(c.value).toLocaleString()}
            </p>
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.18em] text-[#6B705C] mt-0.5">
              {c.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
