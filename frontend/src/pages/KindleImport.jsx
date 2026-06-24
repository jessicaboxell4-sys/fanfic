import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FolderUp,
  AlertTriangle,
  Heart,
  CheckCircle2,
} from "lucide-react";
import SiteFooter from "@/components/SiteFooter";

/**
 * Kindle Import Guide — public, no-auth page.
 *
 * Built 2026-07-04 in response to a real Facebook-group commenter
 * asking "I suppose I can't synchronise my kindle library on there?".
 * Honest answer: no, Amazon doesn't expose a public sync API — Kindle
 * is a walled garden.  But there IS a manual workaround that works
 * with Shelfsort's existing upload pipeline (Calibre converts
 * .azw/.azw3/.mobi → EPUB on the fly).  This page walks the user
 * through that workaround in plain English.
 *
 * Routing: public route (no `<ProtectedRoute>`) so we can paste this
 * link straight into FB/Bluesky/Mastodon replies.
 */
export default function KindleImport() {
  useEffect(() => {
    const prevTitle = document.title;
    const TITLE = "Import from Kindle to Shelfsort — step-by-step guide";
    const DESC = "How to bring your Kindle library into Shelfsort. Download .azw / .azw3 files from amazon.com/mycd, drop them onto the upload zone, and Calibre auto-converts them to EPUB so they work in the Reader, OPDS feed, and bulk ZIP export.";
    document.title = TITLE;
    const setMeta = (attr, name, content) => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    const setLink = (rel, href) => {
      let el = document.head.querySelector(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", rel);
        document.head.appendChild(el);
      }
      el.setAttribute("href", href);
    };
    setMeta("name", "description", DESC);
    setMeta("property", "og:title", TITLE);
    setMeta("property", "og:description", DESC);
    setMeta("property", "og:type", "article");
    setMeta("name", "twitter:title", TITLE);
    setMeta("name", "twitter:description", DESC);
    setLink("canonical", "https://shelfsort.com/help/kindle-import");
    return () => { document.title = prevTitle; };
  }, []);

  return (
    <div
      className="min-h-screen bg-[#FBFAF6] text-[#2C2C2C] flex flex-col"
      data-testid="kindle-import-page"
    >
      <header className="border-b border-[#E5DDC5] bg-white">
        <div className="max-w-3xl mx-auto px-6 md:px-8 py-5 flex items-center justify-between">
          <Link
            to="/"
            data-testid="kindle-import-back-home"
            className="inline-flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Shelfsort
          </Link>
          <span className="text-xs uppercase tracking-[0.18em] text-[#6B705C]">
            Import guide
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 md:px-8 py-12 leading-relaxed flex-1 w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFF1E5] border border-[#E07A5F]/40 text-[#9C4521] text-[11px] font-semibold uppercase tracking-wider mb-4">
          <BookOpen className="w-3.5 h-3.5" />
          For Kindle owners
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-3 leading-tight">
          Bringing your Kindle library to Shelfsort
        </h1>
        <p className="text-[#6B705C] mb-10 text-lg">
          The honest answer: Amazon doesn&rsquo;t let any third-party app sync
          directly with your Kindle account. But there&rsquo;s a workaround
          that takes about five minutes and lands every supported book in your
          Shelfsort library, properly auto-categorized.
        </p>

        {/* Honest framing first — set expectations */}
        <Section title="Why this can't be automatic" icon={AlertTriangle} accent="rose">
          <p>
            Kindle is a <em>walled garden</em>. There&rsquo;s no public API
            that lets a third-party tool log into your Amazon account and pull
            your books, and that&rsquo;s by design — Amazon wants Kindle
            content read in Kindle apps. Anyone promising &ldquo;one-click
            Kindle sync&rdquo; is either lying or doing something Amazon will
            eventually shut down.
          </p>
          <p>
            What you <em>can</em> do is download your books from Amazon as
            files and drop them into Shelfsort. Shelfsort runs Calibre on the
            backend and will auto-convert <code>.azw</code>,{" "}
            <code>.azw3</code>, <code>.mobi</code>, <code>.kfx</code>, and{" "}
            <code>.kf8</code> into clean EPUBs, classify them, and shelve them
            with the rest of your library.
          </p>
        </Section>

        {/* The 4-step process */}
        <Section title="The four-step workaround" icon={Download} accent="purple">
          <Step
            n="1"
            title="Open your Amazon content page"
          >
            <p>
              Go to{" "}
              <a
                href="https://www.amazon.com/hz/mycd/myx#/home/content/booksAll"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6B46C1] font-semibold underline"
              >
                Amazon &rarr; Manage Your Content &amp; Devices
              </a>{" "}
              (or the same page on your country&rsquo;s Amazon — .co.uk, .de,
              .com.au all work the same way). Sign in if it asks.
            </p>
          </Step>

          <Step
            n="2"
            title="Find “Download &amp; Transfer via USB”"
          >
            <p>
              For each book, click the <strong>three-dots menu</strong>{" "}
              <code>(...)</code> → <strong>Download &amp; Transfer via USB</strong>{" "}
              → pick any Kindle device from the list (any one works, even an
              old one) → confirm.
            </p>
            <p>
              Your browser downloads an <code>.azw3</code> file. Save them all
              to one folder so you can drag them in together.
            </p>
            <Callout tone="amber">
              <strong>Heads up:</strong> as of February 2025, Amazon removed
              the &ldquo;Download &amp; Transfer via USB&rdquo; option for{" "}
              <em>newly-purchased</em> books. Books bought before that date
              still have the option. Newer ones are stuck in the Kindle app
              unless you find another way to export them (out of scope for
              this guide — sorry).
            </Callout>
          </Step>

          <Step
            n="3"
            title="Drop them into Shelfsort"
          >
            <p>
              Open <Link to="/library" className="text-[#6B46C1] font-semibold underline">your library</Link>,
              drag the whole folder of <code>.azw3</code> files onto the
              upload zone, and confirm when it asks &ldquo;Convert these to
              EPUB?&rdquo; (yes — that&rsquo;s the magic step).
            </p>
            <p className="flex items-center gap-2 text-[#6B705C] text-sm">
              <FolderUp className="w-4 h-4 text-[#E07A5F]" />
              You can drop a whole folder at once — Shelfsort walks the tree
              and grabs every supported file.
            </p>
          </Step>

          <Step
            n="4"
            title="Wait a beat, then refresh"
          >
            <p>
              Calibre converts each book on the server (about 2-5 seconds per
              file, sometimes longer for big PDFs). When it finishes,
              Shelfsort runs Claude over the metadata to auto-classify the
              book into a fandom or shelf, and they all show up in your
              library.
            </p>
            <p className="flex items-center gap-2 text-[#6B705C] text-sm">
              <CheckCircle2 className="w-4 h-4 text-[#22A06B]" />
              You&rsquo;re done. Your Kindle library now lives in Shelfsort
              alongside everything else, fully searchable and re-categorizable.
            </p>
          </Step>
        </Section>

        {/* DRM caveat — be honest */}
        <Section title="A note on DRM" icon={AlertTriangle} accent="rose">
          <p>
            Some <code>.azw3</code> files Amazon serves are wrapped in DRM.
            Calibre will fail to convert those with an &ldquo;encryption&rdquo;
            error, and Shelfsort will put them on the{" "}
            <em>Needs conversion</em> shelf with a note. We can&rsquo;t and
            won&rsquo;t bundle DRM-removal tools into Shelfsort — that&rsquo;s
            a legal-grey area we&rsquo;d rather not dance in. If you have
            books like that, your best bet is to keep them in the official
            Kindle app for now.
          </p>
        </Section>

        {/* Future / asks */}
        <Section title="Anything else?" icon={Heart} accent="purple">
          <p>
            If your books are in <em>another</em> ebook reader (Apple Books,
            Kobo, Google Play Books, etc.), the same idea applies — most of
            those let you export the original file, and Shelfsort accepts
            EPUB, PDF, MOBI, AZW, AZW3, KF8, KFX, DOCX, RTF, FB2, LIT, LRF,
            PDB, TXT, and HTML. Drop and go.
          </p>
          <p>
            Have a use case this guide doesn&rsquo;t cover? Email{" "}
            <a
              href="mailto:hello@shelfsort.com"
              className="text-[#6B46C1] font-semibold underline"
            >
              hello@shelfsort.com
            </a>{" "}
            — a real human (the operator) reads every reply.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-[#E5DDC5] text-sm text-[#6B705C]">
          See also:{" "}
          <Link to="/privacy" className="text-[#6B46C1] underline">
            Privacy
          </Link>
          {" · "}
          <Link to="/terms" className="text-[#6B46C1] underline">
            Terms
          </Link>
          {" · "}
          <Link to="/suggestions" className="text-[#6B46C1] underline">
            Suggestions board
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function Section({ title, icon: Icon, accent, children }) {
  const accents = {
    purple: "text-[#6B46C1]",
    rose: "text-[#9C4521]",
  };
  return (
    <section
      className="mb-10"
      data-testid={`kindle-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
    >
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-4 flex items-center gap-2">
        {Icon ? <Icon className={`w-5 h-5 ${accents[accent] || "text-[#6B46C1]"}`} /> : null}
        {title}
      </h2>
      <div className="prose prose-sm max-w-none text-[#2C2C2C] [&_p]:mb-3 [&_code]:bg-[var(--surface-hover)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px]">
        {children}
      </div>
    </section>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="mb-6 pl-4 border-l-2 border-[#E07A5F]/40" data-testid={`kindle-step-${n}`}>
      <p className="font-serif text-lg text-[#2C2C2C] mb-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#E07A5F] text-white text-sm font-semibold mr-2">
          {n}
        </span>
        {title}
      </p>
      <div className="text-[#2C2C2C]">{children}</div>
    </div>
  );
}

function Callout({ tone, children }) {
  const tones = {
    amber: "bg-[#FFF7E6] border-[#E0A95F]/40 text-[#7C5400]",
    rose: "bg-[#FFEFEC] border-[#E07A5F]/40 text-[#9C4521]",
  };
  return (
    <div
      className={`mt-3 p-3 rounded-md border text-sm ${tones[tone] || tones.amber}`}
    >
      {children}
    </div>
  );
}
