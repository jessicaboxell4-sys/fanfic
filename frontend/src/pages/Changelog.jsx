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
          {/* Public trust signal: live status of the production smoke
              canary that hits shelfsort.com every night.  Image is a
              live SVG from shields.io that reads the GitHub Actions
              workflow state, so this stays fresh with zero backend code.
              The caption below adds "checked X ago" by polling
              /api/canary/status (5-min cached). */}
          <div className="mt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href="https://github.com/jessicaboxell4-sys/fanfic/actions/workflows/prod-smoke-canary.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block hover:opacity-80 transition-opacity"
                data-testid="changelog-canary-badge-link"
                title="Live status of Shelfsort's nightly production health check"
              >
                <img
                  src="https://img.shields.io/github/actions/workflow/status/jessicaboxell4-sys/fanfic/prod-smoke-canary.yml?branch=main&label=production%20canary&style=flat-square&logo=githubactions&logoColor=white"
                  alt="Production canary status"
                  data-testid="changelog-canary-badge-img"
                />
              </a>
              <CanaryUptimePill />
            </div>
            <CanaryCaption />
          </div>
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

        <div className="mt-12 pt-6 border-t border-[#E5DDC5] text-sm text-[#6B705C] space-y-3">
          <p>
            Looking for the user guide? Try the{" "}
            <Link to="/help" className="text-[#E07A5F] hover:underline">
              Help page
            </Link>{" "}
            for step-by-step walkthroughs.
          </p>
          {/* Suggestion-box discoverability chip (Task 8) — readers of
              the changelog are the most-primed audience for "wish it
              had X" thoughts.  Place the chip right where they're
              already celebrating what we shipped. */}
          <p>
            See something missing?{" "}
            <Link
              to="/suggestions"
              data-testid="changelog-suggest-feature-link"
              className="text-[#6B46C1] font-semibold hover:underline inline-flex items-center gap-1"
            >
              💡 Suggest a feature →
            </Link>{" "}
            We ship community ideas regularly.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

// Small "uptime" pill rendered inline with the GH Actions badge.
// Pulls /api/canary/uptime (5-min server-cached) and displays
// "99.7% uptime · 30 days".  Renders nothing on {available:false}
// so a fresh install (no canary_runs yet) doesn't show a 0% pill.
//
// 2026-06-27 — Now also fetches a per-day breakdown via
// ?include_daily=true and renders a 30-cell mini bar chart next
// to the pill.  Each cell = one UTC calendar day:
//   • green = 100% pass on that day
//   • amber = mixed pass/fail
//   • red   = 100% fail
//   • blank = no canary ran that day (gap in the schedule)
// The bar gives at-a-glance pattern recognition that a flat
// "99.7%" percentage can't — clusters of red cells reveal incidents
// that hit on consecutive days even when overall uptime stays high.
function CanaryUptimePill() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/canary/uptime?days=30&include_daily=true`);
        if (cancelled) return;
        if (res.data && res.data.available) setInfo(res.data);
      } catch { /* silent — pill is optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  const pct = info.uptime_pct;
  // Color tiers: green ≥ 99, amber 95-99, red < 95.  Keeps the pill
  // honest without being alarmist — a single bad week shouldn't go
  // straight to red.
  let cls;
  if (pct >= 99) cls = "bg-[#E6F2E6] text-[#3D6B3D] border-[#C8E1C8]";
  else if (pct >= 95) cls = "bg-[#FBF1D6] text-[#7C5F1F] border-[#E8D89A]";
  else cls = "bg-[#FBE2E0] text-[#7C2D2A] border-[#E8B5B0]";

  const label = `${pct.toFixed(pct === 100 ? 0 : 1)}% uptime · ${info.days} days`;
  const title = `${info.pass_count}/${info.total_runs} canary runs passed over the last ${info.days} days`;

  // Sparkline cell classifier — mirrors the pill color tiers but
  // applied per-day so the eye can scan for incident clusters.
  // Blank/grey for "no data" days keeps the chart length stable
  // (always 30 cells, oldest left) so visual comparisons across
  // visits aren't thrown off by missing cron runs.
  const cellClass = (d) => {
    if (!d || d.total === 0) return "bg-[#EDE9DF]";        // no-data grey
    if (d.fail === 0) return "bg-[#5C8A5C]";               // all green
    if (d.pass === 0) return "bg-[#C75450]";               // all red
    return "bg-[#D49A33]";                                 // mixed
  };
  const cellTitle = (d) => {
    if (!d || d.total === 0) return `${d?.date || ""} — no canary run`;
    if (d.fail === 0) return `${d.date} — ${d.pass}/${d.total} passed (✓)`;
    if (d.pass === 0) return `${d.date} — ${d.fail}/${d.total} failed (✗)`;
    return `${d.date} — mixed: ${d.pass} passed, ${d.fail} failed`;
  };

  return (
    <span
      className="inline-flex items-center gap-2 flex-wrap"
      data-testid="changelog-canary-uptime-wrap"
    >
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}
        data-testid="changelog-canary-uptime-pill"
        title={title}
      >
        <span data-testid="changelog-canary-uptime-pct">{label}</span>
      </span>
      {info.daily && info.daily.length > 0 && (
        <span
          className="inline-flex items-end gap-[2px] py-1"
          data-testid="changelog-canary-uptime-sparkline"
          aria-label={`Daily canary status for the last ${info.daily.length} days`}
        >
          {info.daily.map((d) => (
            <span
              key={d.date}
              title={cellTitle(d)}
              className={`inline-block w-[5px] h-3.5 rounded-[1.5px] ${cellClass(d)}`}
              data-testid={`changelog-canary-spark-${d.date}`}
            />
          ))}
        </span>
      )}
    </span>
  );
}


// Small caption shown under the shields.io badge.  Pulls
// /api/canary/status (5-min cached server-side) to render a friendly
// "Last checked: 2h ago" line.  Renders nothing when the endpoint
// returns {available:false} so we never show a broken state.
//
// 2026-06-27 — backend now also fetches the retry workflow in
// parallel and returns `effective_state` ∈ {healthy, retrying,
// recovered, failing}.  We surface that as a word + colored dot
// so visitors instantly know whether prod is fine, mid-recovery,
// or actually broken — without having to read the badge SVG.
//
// 2026-06-27 (later) — Live heartbeat behaviour:
//   • Re-render every 60 s so the "X min ago" relative string
//     ticks naturally without any network call.
//   • Re-fetch /api/canary/status every 5 min, matching the
//     server-side cache TTL exactly — polling faster than that
//     would just hit the cache and burn bandwidth.
//   • Pause BOTH timers when the tab is hidden
//     (`document.visibilityState !== "visible"`).  Resume on
//     visibilitychange, and trigger an immediate refetch so the
//     visitor sees fresh data the moment they tab back in.
//   • No spinner, no loading shimmer on background refetches —
//     the caption is meant to be ambient, not attention-grabbing.
function CanaryCaption() {
  const [info, setInfo] = useState(null);
  // Tick counter — incrementing this every 60 s re-runs the
  // relative-time calculation below.  Lets the caption say
  // "5 min ago" → "6 min ago" without any network traffic.
  const [, setClockTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await axios.get(`${API}/canary/status`);
        if (cancelled) return;
        if (res.data && res.data.available) setInfo(res.data);
      } catch { /* silent — caption is optional */ }
    };

    // Initial fetch on mount.
    fetchStatus();

    // Local clock tick — drives the "X min ago" relative label.
    // 60 s is the smallest unit our formatter renders, so finer
    // ticks would just re-render with the same string.
    const clockInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        setClockTick((t) => t + 1);
      }
    }, 60_000);

    // Backend refresh — every 5 min to match the server-side
    // cache TTL (anything faster hits the cached response).
    const fetchInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchStatus();
      }
    }, 5 * 60_000);

    // When the tab becomes visible again after being hidden,
    // immediately refetch so the visitor isn't staring at stale
    // data from before they tabbed away.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
        setClockTick((t) => t + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(clockInterval);
      clearInterval(fetchInterval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!info || !info.updated_at) return null;

  const updated = new Date(info.updated_at);
  const ageMs = Date.now() - updated.getTime();
  const minutes = Math.floor(ageMs / 60000);
  let relative;
  if (minutes < 1) relative = "just now";
  else if (minutes < 60) relative = `${minutes} min ago`;
  else if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60);
    relative = `${h} ${h === 1 ? "hour" : "hours"} ago`;
  } else {
    const d = Math.floor(minutes / (60 * 24));
    relative = `${d} ${d === 1 ? "day" : "days"} ago`;
  }

  // Map effective_state → (label, color).  Fall back to the old
  // pass/fail logic when the backend hasn't shipped the new field
  // yet (graceful degrade for live deploys mid-rollout).
  const state = info.effective_state || (info.conclusion === "success" ? "healthy" : "failing");
  const STATE_LABELS = {
    healthy:   { word: "healthy",                dot: "bg-[#5C8A5C]", text: "text-[#5C8A5C]" },
    recovered: { word: "recovered after blip",   dot: "bg-[#5C8A5C]", text: "text-[#5C8A5C]" },
    retrying:  { word: "retrying after blip",    dot: "bg-[#D49A33]", text: "text-[#D49A33]" },
    failing:   { word: "needs attention",        dot: "bg-[#C75450]", text: "text-[#C75450]" },
    unknown:   { word: "status pending",         dot: "bg-[#A09A8B]", text: "text-[#6B705C]" },
  };
  const cfg = STATE_LABELS[state] || STATE_LABELS.unknown;

  // When the retry recovered prod, prefer linking to the retry run
  // so curious visitors can see exactly what triggered the bounce.
  const recoveredViaRetry = state === "recovered" && info.retry && info.retry.html_url;

  return (
    <p
      className="text-xs text-[#6B705C] mt-1.5 flex items-center gap-1.5 flex-wrap"
      data-testid="changelog-canary-caption"
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`}
        aria-hidden="true"
        data-testid="changelog-canary-state-dot"
      />
      <span
        className={`font-medium ${cfg.text}`}
        data-testid="changelog-canary-state-word"
      >
        {cfg.word}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        last checked <span className="font-medium" data-testid="changelog-canary-relative">{relative}</span>
      </span>
      {info.run_number ? <span aria-hidden="true">·</span> : null}
      {info.run_number ? <span>run #{info.run_number}</span> : null}
      {recoveredViaRetry ? (
        <>
          <span aria-hidden="true">·</span>
          <a
            href={info.retry.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#5C8A5C] underline decoration-dotted hover:opacity-80"
            data-testid="changelog-canary-retry-link"
          >
            recovered via 15-min retry
          </a>
        </>
      ) : null}
    </p>
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
