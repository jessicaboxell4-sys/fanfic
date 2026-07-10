import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import Navbar from "../components/Navbar";
import StatsCard from "../components/StatsCard";
import ReaderDnaCard from "../components/ReaderDnaCard";
import { ArrowLeft, ArrowRight, TrendingUp, Calendar, UserCircle2, Sparkles, BookCheck, Download } from "lucide-react";

function BarRow({ label, value, max, to, accent }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-[#2C2C2C] truncate pr-3">{label}</span>
        <span className="text-[#5B5F4D] tabular-nums font-semibold">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#F5F3EC] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: accent || "#E07A5F" }}
        />
      </div>
    </>
  );
  if (!to) return <div>{inner}</div>;
  return (
    <Link to={to} className="block group hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  );
}

function Sparkline({ data, height = 56, accent = "#E07A5F" }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data
    .map((d, i) => `${(i * step).toFixed(2)},${(height - (d.value / max) * (height - 6) - 2).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function StatsPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [ov, dt] = await Promise.all([
          api.get("/stats/overview"),
          api.get("/stats/detailed"),
        ]);
        setOverview(ov.data);
        setDetail(dt.data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <p className="text-[#5B5F4D] py-20 text-center">Loading your reading story…</p>
      </div>
    );
  }

  const maxFandom = Math.max(0, ...(detail?.top_fandoms || []).map((f) => f.count));
  const maxAuthor = Math.max(0, ...(detail?.top_authors || []).map((a) => a.count));
  const maxMonthly = Math.max(1, ...(detail?.monthly_finished || []).map((m) => m.finished));
  const maxDaily = Math.max(1, ...(detail?.daily || []).map((d) => d.books_opened));
  const totalDailyOpens = (detail?.daily || []).reduce((sum, d) => sum + d.books_opened, 0);
  const activeDays30 = (detail?.daily || []).filter((d) => d.books_opened > 0).length;

  const isEmpty = !detail || detail.books_total === 0;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Reading statistics
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]" data-testid="stats-page-title">
              Your reading, by the numbers.
            </h1>
            <p className="text-[#5B5F4D] mt-3">
              {isEmpty
                ? "Once you start reading, the patterns will appear here."
                : "What you've been picking up, how often, and from where."}
            </p>
          </div>
          {!isEmpty && (
            <a
              href={`${API}/stats/export.csv`}
              data-testid="stats-export-csv"
              className="btn-secondary text-sm flex items-center gap-2 mt-2 flex-shrink-0"
              title="Download author / fandom / category analytics as CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </a>
          )}
        </div>

        {overview && <StatsCard stats={overview} />}

        {/* Year in books CTA */}
        {!isEmpty && (
          <Link
            to={`/library/year/${new Date().getFullYear()}`}
            data-testid="open-year-in-books"
            className="block shelf-card p-6 mb-6 bg-[#FDF3E1] border-[#B87A00]/20 hover:shadow-lg transition-shadow group"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#E07A5F] mb-1">
                  Year in books
                </p>
                <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C]">
                  Your {new Date().getFullYear()}, told in books.
                </h2>
                <p className="text-sm text-[#5B5F4D] mt-1">
                  A keepsake recap of the year so far — top fandoms, bookends, achievements.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[#E07A5F] font-semibold text-sm group-hover:gap-3 transition-all">
                Open recap <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </Link>
        )}

        {isEmpty ? (
          <div className="shelf-card p-12 text-center">
            <BookCheck className="w-12 h-12 text-[#6B46C1] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No reading history yet</h2>
            <p className="text-[#5B5F4D] mb-6">Open a few books to start building your stats.</p>
            <Link to="/library" className="btn-primary text-sm inline-block">Go to library</Link>
          </div>
        ) : (
          <>
            {/* Activity sparkline (last 30 days) */}
            <section className="shelf-card p-6 mb-6" data-testid="daily-activity-card">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#6B46C1]" />
                  <h2 className="font-serif text-2xl text-[#2C2C2C]">Last 30 days</h2>
                </div>
                <p className="text-sm text-[#5B5F4D]">
                  {activeDays30}/30 active days · {totalDailyOpens} book opens
                </p>
              </div>
              <div className="h-20">
                <Sparkline
                  data={(detail.daily || []).map((d) => ({ value: d.books_opened }))}
                  height={80}
                  accent="#E07A5F"
                />
              </div>
              <div className="grid grid-cols-7 sm:grid-cols-15 md:grid-cols-30 gap-1 mt-4">
                {(detail.daily || []).map((d) => (
                  <div
                    key={d.date}
                    title={`${d.label}: ${d.books_opened} opens`}
                    className="aspect-square rounded-sm"
                    style={{
                      background:
                        d.books_opened === 0
                          ? "var(--surface-hover)"
                          : `rgba(224, 122, 95, ${Math.min(1, 0.25 + (d.books_opened / maxDaily) * 0.75)})`,
                    }}
                  />
                ))}
              </div>
            </section>

            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {/* Top fandoms */}
              <section className="shelf-card p-6" data-testid="top-fandoms-card">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-[#E07A5F]" />
                  <h2 className="font-serif text-2xl text-[#2C2C2C]">Top fandoms</h2>
                </div>
                {(detail.top_fandoms || []).length === 0 ? (
                  <p className="text-sm text-[#5B5F4D]">No fanfiction catalogued yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.top_fandoms.map((f) => (
                      <BarRow
                        key={f.name}
                        label={f.name}
                        value={f.count}
                        max={maxFandom}
                        to={`/library/fandom/${encodeURIComponent(f.name)}`}
                        accent="#E07A5F"
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Top authors */}
              <section className="shelf-card p-6" data-testid="top-authors-card">
                <div className="flex items-center gap-2 mb-4">
                  <UserCircle2 className="w-4 h-4 text-[#6B46C1]" />
                  <h2 className="font-serif text-2xl text-[#2C2C2C]">Most read authors</h2>
                </div>
                {(detail.top_authors || []).length === 0 ? (
                  <p className="text-sm text-[#5B5F4D]">No authors on file yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.top_authors.map((a) => (
                      <BarRow
                        key={a.name}
                        label={a.name}
                        value={a.count}
                        max={maxAuthor}
                        to={`/library/author/${encodeURIComponent(a.name)}`}
                        accent="#6B46C1"
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Books finished per month */}
            <section className="shelf-card p-6 mb-6" data-testid="monthly-finished-card">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-[#6B46C1]" />
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Books finished — last 12 months</h2>
              </div>
              <div className="flex items-end gap-2 h-40">
                {(detail.monthly_finished || []).map((m) => {
                  const pct = (m.finished / maxMonthly) * 100;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end" title={`${m.label}: ${m.finished}`}>
                      <span className="text-[10px] text-[#5B5F4D] mb-1 tabular-nums">{m.finished || ""}</span>
                      <div
                        className="w-full rounded-t-md transition-all"
                        style={{
                          height: `${Math.max(2, pct)}%`,
                          background: m.finished > 0 ? "#6B46C1" : "#E8E6E1",
                          minHeight: "4px",
                        }}
                      />
                      <span className="text-[10px] text-[#5B5F4D] mt-1 truncate w-full text-center">
                        {m.label.split(" ")[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Category split */}
            <section className="shelf-card p-6 mb-6" data-testid="category-breakdown-card">
              <h2 className="font-serif text-2xl text-[#2C2C2C] mb-4">Library by category</h2>
              <div className="space-y-3">
                {(detail.categories || []).map((c) => (
                  <BarRow
                    key={c.name}
                    label={c.name}
                    value={c.count}
                    max={detail.books_total}
                    accent={
                      c.name === "Fanfiction" ? "#E07A5F" :
                      c.name === "Original Fiction" ? "#6B46C1" :
                      c.name === "Non-fiction" ? "#B87A00" : "#5B5F4D"
                    }
                  />
                ))}
              </div>
            </section>

            <ReaderDnaCard />
          </>
        )}
      </main>
    </div>
  );
}
