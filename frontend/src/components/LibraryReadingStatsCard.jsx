import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, AlertCircle } from "lucide-react";
import { api } from "../lib/api";

/**
 * Aggregate reading-time summary for the dashboard. Auto-hides when the
 * user has no books with word_count (e.g. brand-new account or
 * pre-fulltext-backfill library).
 */
function fmtMinutes(m) {
  if (!m || m <= 0) return "0 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export default function LibraryReadingStatsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get("/library/reading-stats")
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch(() => { /* non-blocking widget */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (!data) return null;
  if (data.books_with_wordcount === 0) return null;

  const missing = data.books_without_wordcount;
  const totalShare = data.total_words > 0
    ? Math.round((data.finished_words / data.total_words) * 100)
    : 0;

  return (
    <section
      data-testid="library-reading-stats-card"
      className="mb-8 bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] inline-flex items-center gap-2">
          <Clock className="w-3 h-3" /> Reading time
        </p>
        <Link
          to="/account/appearance"
          data-testid="library-reading-stats-settings"
          className="text-[10px] text-[#6B705C] hover:text-[#6B46C1] font-semibold uppercase tracking-wider"
        >
          {data.wpm} wpm
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Left to read"
          value={fmtMinutes(data.unfinished_minutes)}
          sub={`${Number(data.unfinished_words).toLocaleString()} words`}
          accent="text-[#6B46C1]"
          testid="lib-stats-unfinished"
        />
        <Stat
          label="Already read"
          value={fmtMinutes(data.finished_minutes)}
          sub={`${totalShare}% of library`}
          accent="text-[#1F4D2A]"
          testid="lib-stats-finished"
        />
        <Stat
          label="Library total"
          value={fmtMinutes(data.total_minutes)}
          sub={`${Number(data.total_words).toLocaleString()} words`}
          accent="text-[#2C2C2C]"
          testid="lib-stats-total"
        />
      </div>

      {missing > 0 && (
        <p
          data-testid="lib-stats-missing-warning"
          className="text-[11px] text-[#B87A00] mt-3 flex items-center gap-1"
        >
          <AlertCircle className="w-3 h-3" />
          {missing} book{missing === 1 ? "" : "s"} without word counts —
          {" "}
          <span className="text-[#6B705C]">re-upload or ask an admin to run the backfill.</span>
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, sub, accent, testid }) {
  return (
    <div className="bg-white border border-[#E8E6E1] rounded-xl p-3" data-testid={testid}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B705C] mb-0.5">{label}</p>
      <p className={`font-serif text-xl ${accent}`}>{value}</p>
      <p className="text-[11px] text-[#6B705C] mt-0.5">{sub}</p>
    </div>
  );
}
