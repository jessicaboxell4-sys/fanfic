import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import SiteFooter from "../components/SiteFooter";
import Navbar from "../components/Navbar";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Public, SEO-indexable changelog.  Pulls from the same admin
// `announcements` collection the Help page shows to logged-in users,
// but via a separate `/api/changelog/public` endpoint that doesn't
// require auth — Google can crawl it.  Each entry has a stable
// anchor so we can link to e.g. `/changelog#2026-06-24-pdf-async`.
//
// Adding to sitemap.xml is intentional: this expands Shelfsort's
// indexable surface from 1 page (landing) to 5+ (landing + /help +
// /help/kindle-import + /changelog + /privacy + /terms).
export default function Changelog() {
  const [entries, setEntries] = useState(null); // null = loading, [] = empty
  const [error, setError] = useState(null);
  // Community-shipped feed (from /api/changelog → suggestions.status=done,
  // forward-only from SHIPPED_CREDIT_CUTOFF). Renders @handle credits.
  const [communityShipped, setCommunityShipped] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/changelog/public`, { params: { limit: 10 } });
        if (cancelled) return;
        setEntries(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Couldn't load the changelog");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Separate fetch so a community-shipped backend error never blanks
    // the main announcements feed.
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/changelog`);
        if (cancelled) return;
        setCommunityShipped(res.data?.community_shipped || []);
      } catch { /* silent — section just won't render */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const prevTitle = document.title;
    const TITLE = "Shelfsort Changelog — latest features and improvements";
    const DESC = "Recent changes to Shelfsort: native PDF reading, async uploads, the background uploads bell, fandom-aware sorting, OPDS sync, and more. Updated continuously as the app evolves.";
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
    setLink("canonical", "https://shelfsort.com/changelog");
    return () => { document.title = prevTitle; };
  }, []);

  // Smooth scroll to anchor on initial mount.
  useEffect(() => {
    if (entries == null || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [entries]);

  return (
    <div className="min-h-screen bg-[#FDFBF7]" data-testid="changelog-page">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <header className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            What&rsquo;s new
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-[#2C2C2C] leading-tight">
            Shelfsort Changelog
          </h1>
          <p className="text-[#6B705C] mt-3 max-w-xl">
            A running log of recent improvements to Shelfsort — uploads, the
            reader, sorting, sync, friends. Pulled live from the same
            announcements we show inside the app, so it&rsquo;s always current.
          </p>
        </header>

        {entries === null && (
          <p className="text-sm text-[#6B705C]" data-testid="changelog-loading">Loading…</p>
        )}
        {entries !== null && entries.length === 0 && (
          <p className="text-sm text-[#6B705C]" data-testid="changelog-empty">
            No release notes have been published yet. Check back soon.
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" data-testid="changelog-error">
            {error}
          </p>
        )}

        {entries && entries.length > 0 && (
          <ol className="space-y-10 list-none" data-testid="changelog-list">
            {entries.map((entry) => (
              <ChangelogEntry key={entry.version} entry={entry} />
            ))}
          </ol>
        )}

        {communityShipped.length > 0 && (
          <section className="mt-12 pt-8 border-t border-[#E5DDC5]" data-testid="changelog-community-shipped">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Shipped from the community
            </p>
            <h2 className="font-serif text-2xl md:text-3xl text-[#2C2C2C] leading-tight mb-2">
              Built from your ideas
            </h2>
            <p className="text-[#6B705C] mb-5 max-w-xl">
              Every entry below started as a user suggestion. If you have one too,{" "}
              <Link to="/suggestions" className="text-[#E07A5F] hover:underline font-medium">drop it in the box</Link>.
            </p>
            <ul className="space-y-3" data-testid="changelog-community-shipped-list">
              {communityShipped.map((s, i) => (
                <li
                  key={`${s.shipped_at}-${i}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[#FDF8F0] border border-[#E4D9C8]"
                  data-testid={`changelog-shipped-row-${i}`}
                >
                  <span className="text-[#6B46C1] text-lg shrink-0" aria-hidden="true">🎉</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#2C2C2C] text-sm">{s.title}</div>
                    <div className="text-xs text-[#6B705C] mt-0.5">
                      {s.handle ? (
                        <>
                          Suggested by{" "}
                          <Link to={`/u/${s.handle}`} className="text-[#6B46C1] hover:underline font-semibold">
                            @{s.handle}
                          </Link>
                        </>
                      ) : (
                        <span className="italic">Suggested by an anonymous reader</span>
                      )}
                      {s.shipped_at && (
                        <>
                          {" · "}
                          {new Date(s.shipped_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </>
                      )}
                    </div>
                    {s.admin_note && (
                      <p className="text-xs text-[#6B705C] mt-1.5 italic">{s.admin_note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-12 pt-6 border-t border-[#E5DDC5] text-sm text-[#6B705C]">
          Looking for the user guide? Try the{" "}
          <Link to="/help" className="text-[#E07A5F] hover:underline">
            Help page
          </Link>{" "}
          for step-by-step walkthroughs.
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ChangelogEntry({ entry }) {
  const date = entry.created_at
    ? new Date(entry.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  return (
    <li
      id={entry.version}
      data-testid={`changelog-entry-${entry.version}`}
      className="pl-5 border-l-2 border-[#E07A5F]/30 hover:border-[#E07A5F] transition-colors"
    >
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h2 className="font-serif text-xl md:text-2xl text-[#2C2C2C] leading-tight">
          {entry.title}
        </h2>
        <a
          href={`#${entry.version}`}
          className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C] hover:text-[#E07A5F]"
          title="Direct link to this entry"
        >
          #
        </a>
      </div>
      {date && (
        <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] mb-3">
          {date}
        </p>
      )}
      {entry.items && entry.items.length > 0 && (
        <ul className="space-y-2 text-sm text-[#2C2C2C] leading-relaxed">
          {entry.items.map((item, i) => (
            <li key={i} className="pl-1">
              {item.to ? (
                <Link to={item.to} className="text-[#E07A5F] hover:underline font-medium">
                  {item.label}
                </Link>
              ) : (
                <strong>{item.label}</strong>
              )}
              {item.desc && <span className="ml-1">— {item.desc}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
