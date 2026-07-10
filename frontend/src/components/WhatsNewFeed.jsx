import React, { useEffect, useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, Link as LinkIcon, RefreshCw, Calendar } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * <WhatsNewFeed /> — Renders the most recent CHANGELOG.md entries
 * fetched from GET /api/admin/whats-new.
 *
 * - Initial load: top 5 entries, body_preview only
 * - Expand control: load up to 20, swap to body_full
 * - Each card: date pill, status emoji, copy-anchor button, refresh
 *
 * Used in AdminHelp.jsx at the top, above the TOC sections.
 */
function formatDate(iso, suffix) {
  if (!iso) return "";
  // 2026-06-20 → "Jun 20, 2026"
  const d = new Date(`${iso}T00:00:00Z`);
  const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}${suffix ? ` · ${suffix}` : ""}`;
}

// Minimal markdown → JSX renderer for the body preview.  Handles:
//   **bold**, `inline code`, bullet lines starting with "- ", blank lines.
// We deliberately don't pull in react-markdown to keep the bundle small —
// the CHANGELOG vocabulary is narrow.
function renderBody(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const out = [];
  let bullets = [];
  const flushBullets = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 my-1.5 space-y-0.5 text-[13px] text-[#2C2C2C]">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    if (ln.startsWith("- ")) {
      bullets.push(ln.slice(2));
    } else if (ln.trim() === "") {
      flushBullets();
    } else {
      flushBullets();
      out.push(
        <p key={`p-${i}`} className="text-[13px] text-[#2C2C2C] my-1.5 leading-relaxed">
          {renderInline(ln)}
        </p>
      );
    }
  });
  flushBullets();
  return out;
}

function renderInline(s) {
  // **bold** → <strong>, `code` → <code>
  const parts = [];
  let buf = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > 0) {
        if (buf) { parts.push(buf); buf = ""; }
        parts.push(<strong key={`b-${i}`} className="text-[#2C2C2C]">{s.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) {
        if (buf) { parts.push(buf); buf = ""; }
        parts.push(
          <code key={`c-${i}`} className="bg-[#FBFAF6] border border-[#E5DDC5] px-1 py-0.5 rounded text-[12px] text-[#6B46C1]">
            {s.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  if (buf) parts.push(buf);
  return parts;
}

function EntryCard({ entry, expanded, onToggle, onCopyLink }) {
  const body = expanded ? entry.body_full : entry.body_preview;
  const wasTruncated = entry.body_full && entry.body_full.length > (entry.body_preview || "").length;
  return (
    <article
      id={entry.slug}
      data-testid={`whats-new-entry-${entry.slug}`}
      className="shelf-card p-4 scroll-mt-20"
    >
      <header className="flex items-start gap-3 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#5B5F4D] font-semibold">
          <Calendar className="w-3 h-3" />
          {formatDate(entry.date, entry.suffix)}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onCopyLink(entry.slug)}
          className="inline-flex items-center gap-1 text-[11px] text-[#5B5F4D] hover:text-[#6B46C1] px-1.5 py-0.5 rounded hover:bg-[#FBFAF6]"
          title="Copy link to this entry"
          data-testid={`whats-new-copy-${entry.slug}`}
        >
          <LinkIcon className="w-3 h-3" />
          Copy link
        </button>
      </header>
      <h3 className="font-serif text-lg text-[#2C2C2C] flex items-center gap-2 mb-1">
        {entry.title}
        {entry.status_emoji ? <span aria-hidden="true">{entry.status_emoji}</span> : null}
      </h3>
      <div data-testid={`whats-new-body-${entry.slug}`}>{renderBody(body)}</div>
      {wasTruncated ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-[#6B46C1] hover:underline"
          data-testid={`whats-new-toggle-${entry.slug}`}
        >
          {expanded ? <><ChevronUp className="w-3 h-3" />Show less</> : <><ChevronDown className="w-3 h-3" />Show full entry</>}
        </button>
      ) : null}
    </article>
  );
}

export default function WhatsNewFeed() {
  const [data, setData] = useState(null); // { entries, total, cached_at, source_mtime }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(5);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = React.useCallback(async (lim) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/admin/whats-new?limit=${lim}`);
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(limit);
  }, [load, limit]);

  // If the URL has a #2026-06-... hash, ensure the matching entry is expanded
  // and scrolled into view once data is loaded.
  useEffect(() => {
    if (!data?.entries?.length) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const match = data.entries.find((e) => e.slug === hash);
    if (match) {
      setExpanded((prev) => new Set(prev).add(match.slug));
      // give the DOM a tick to render the full body, then scroll
      setTimeout(() => {
        const el = document.getElementById(match.slug);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }, [data]);

  const onCopyLink = async (slug) => {
    try {
      const url = `${window.location.origin}/admin/help#${slug}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access");
    }
  };

  const onToggleEntry = (slug) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <section
      data-testid="whats-new-feed"
      className="mb-8 border border-[#E5DDC5] rounded-lg bg-[#FBFAF6] p-5"
    >
      <header className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[#6B46C1]" aria-hidden="true" />
        <h2 className="font-serif text-xl text-[#2C2C2C]">What&apos;s new in Shelfsort</h2>
        <span className="text-[11px] text-[#5B5F4D] ml-1">
          {data?.total ? `(${data.total} total)` : ""}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => load(limit)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-[#5B5F4D] hover:text-[#6B46C1] px-2 py-1 rounded hover:bg-white disabled:opacity-50"
          data-testid="whats-new-refresh"
          title="Re-parse CHANGELOG.md (cache TTL 5 min)"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error ? (
        <p
          data-testid="whats-new-error"
          className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2"
        >
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p data-testid="whats-new-loading" className="text-sm text-[#5B5F4D] py-4">
          Loading changelog…
        </p>
      ) : null}

      {data?.entries?.length === 0 ? (
        <p className="text-sm text-[#5B5F4D] py-4">
          No entries parsed from CHANGELOG.md — check the file format.
        </p>
      ) : null}

      <div className="space-y-3">
        {(data?.entries || []).map((e) => (
          <EntryCard
            key={e.slug}
            entry={e}
            expanded={expanded.has(e.slug)}
            onToggle={() => onToggleEntry(e.slug)}
            onCopyLink={onCopyLink}
          />
        ))}
      </div>

      {data && data.entries.length < data.total ? (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setLimit(20)}
            disabled={limit >= 20}
            className="text-[12px] text-[#6B46C1] hover:underline disabled:text-[#5B5F4D] disabled:no-underline disabled:cursor-default"
            data-testid="whats-new-load-more"
          >
            {limit >= 20
              ? `Showing latest 20 of ${data.total} — see CHANGELOG.md for older`
              : `Show last 20 entries (currently ${data.entries.length})`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
