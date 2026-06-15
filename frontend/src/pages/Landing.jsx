import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Sparkles, FolderTree, Download, Wand2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PrimaryCTAButton from "../components/PrimaryCTAButton";
import SecondaryCTAButton from "../components/SecondaryCTAButton";

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
          <p className="text-base sm:text-lg text-[#6B705C] leading-relaxed mb-8 max-w-lg">
            Drop in a folder of EPUBs. Shelfsort reads the metadata and uses AI to file
            them by Harry Potter, Twilight, Marvel, original fiction, and anything else hiding
            in your downloads.
          </p>
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
        </div>
        <div className="relative">
          <img
            src="https://static.prod-images.emergentagent.com/jobs/a7cbf064-1bb1-48e6-b642-01b29d2915a4/images/69b714e80ad3526797631c1c9c820d1ffe10c66de28dc4bc99a11bde433fe454.png"
            alt="A cozy reading corner"
            className="rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full"
          />
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 md:px-8 pb-24 grid md:grid-cols-3 gap-6">
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
      <section className="max-w-4xl mx-auto px-6 md:px-8 py-24 text-center">
        <h2 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] mb-4">
          Ready to see your library, sorted?
        </h2>
        <p className="text-base text-[#6B705C] mb-8 max-w-xl mx-auto">
          Free to try with up to 50 books. AI sorting, in-app reader, reading goals, friends, and book clubs included.
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
