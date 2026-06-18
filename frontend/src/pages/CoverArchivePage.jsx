import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowLeft } from "lucide-react";
import { api } from "../lib/api";

/**
 * Public archive of every week's #1 community cover.  Reads from
 * `/api/cover-archive` which is written to by the daily leaderboard
 * tick whenever a new winner takes the top spot.  Lets visitors
 * scroll the leaderboard backwards in time.
 */
export default function CoverArchivePage() {
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Cover-of-the-week archive — Shelfsort";
    (async () => {
      try {
        const { data } = await api.get("/cover-archive", { params: { limit: 52 } });
        setWeeks(data?.weeks || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <main
        className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-14 fade-in"
        data-testid="cover-archive-page"
      >
        <Link
          to="/explore/covers"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-6 hover:text-[#553397]"
        >
          <ArrowLeft className="w-3 h-3" /> Explore
        </Link>

        <header className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 inline-flex items-center gap-2">
            <Trophy className="w-3 h-3" /> Cover-of-the-week archive
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight">
            Every week’s leaderboard winner.
          </h1>
        </header>

        {loading ? (
          <p className="text-[#6B705C]">Loading…</p>
        ) : weeks.length === 0 ? (
          <p className="text-[#6B705C] italic">
            No archived weeks yet — check back after the next daily tick.
          </p>
        ) : (
          <ol className="space-y-3" data-testid="archive-list">
            {weeks.map((w) => (
              <li
                key={`${w.iso_year}-${w.iso_week}`}
                className="flex items-center justify-between gap-4 p-4 rounded-lg bg-white border border-[#E8E6E1] shadow-sm"
                data-testid={`archive-week-${w.iso_year}-${w.iso_week}`}
              >
                <div>
                  <p className="text-xs text-[#6B705C] uppercase tracking-wider">
                    Week {w.iso_week}, {w.iso_year}
                  </p>
                  <p className="font-serif text-lg text-[#2C2C2C]">
                    “{w.title || "Untitled"}”
                  </p>
                  <p className="text-sm text-[#6B705C]">
                    {w.votes} hearts
                  </p>
                </div>
                <Link
                  to={`/cover/${w.cover_id}`}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
                >
                  View
                </Link>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
