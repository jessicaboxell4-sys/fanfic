import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { BookOpen, Calendar, Sparkles, UserCircle2, ArrowRight, Flame, Trophy } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function BigStat({ value, label, color }) {
  return (
    <div className="text-center">
      <p
        className="font-serif tabular-nums leading-none"
        style={{ color, fontSize: "clamp(3rem, 8vw, 5.5rem)" }}
      >
        {value}
      </p>
      <p className="text-xs uppercase tracking-[0.2em] text-[#6B705C] mt-3 font-semibold">
        {label}
      </p>
    </div>
  );
}

function BarRow({ label, value, max, accent }) {
  const pct = max > 0 ? Math.max(6, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-[#2C2C2C] truncate pr-3">{label}</span>
        <span className="text-[#6B705C] tabular-nums font-semibold">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#F5F3EC] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
      </div>
    </div>
  );
}

export default function PublicYearInBooks() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/public/year/${token}`);
        if (!cancelled) setData(data);
      } catch (e) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Update meta tags for nicer link previews
  useEffect(() => {
    if (!data) return;
    const s = data.summary || {};
    const title = `${data.display_name}'s ${data.year} in books — Shelfsort`;
    const desc = data.has_data
      ? `${s.books_opened} books opened, ${s.books_finished} finished, ${s.longest_streak}-day longest streak.`
      : `${data.display_name}'s reading recap on Shelfsort.`;
    document.title = title;
    const setMeta = (attr, name, content) => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("name", "description", desc);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:type", "article");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-[#6B705C]">Loading recap…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-paper">
        <header className="border-b border-[#E8E6E1] bg-paper/95 backdrop-blur sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#E07A5F]" />
              <span className="font-serif text-xl text-[#2C2C2C]">Shelfsort</span>
            </Link>
            <Link to="/login" className="btn-secondary text-xs">Sign in</Link>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-6 py-20 text-center">
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-4">This recap isn't available</h1>
          <p className="text-[#6B705C] mb-8">
            The share link may have been revoked or never existed. Check the URL or ask the sender for a fresh link.
          </p>
          <Link to="/" className="btn-primary text-sm inline-block">Visit Shelfsort</Link>
        </main>
      </div>
    );
  }

  const s = data.summary || {};
  const hasData = data.has_data;
  const maxMonthly = Math.max(1, ...(s.monthly || []).map(m => m.opens));
  const maxFandom = Math.max(0, ...(s.top_fandoms || []).map(f => f.count));
  const maxAuthor = Math.max(0, ...(s.top_authors || []).map(a => a.count));

  return (
    <div className="min-h-screen bg-paper">
      {/* Public header — no auth nav */}
      <header className="border-b border-[#E8E6E1] bg-paper/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="public-shelfsort-logo">
            <BookOpen className="w-5 h-5 text-[#E07A5F]" />
            <span className="font-serif text-xl text-[#2C2C2C]">Shelfsort</span>
          </Link>
          <Link to="/login" data-testid="public-cta-signup" className="btn-primary text-xs flex items-center gap-1.5">
            Make yours <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        {/* Hero */}
        <header className="text-center py-12 md:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#E07A5F] mb-4">
            {data.display_name}'s reading year
          </p>
          <h1
            className="font-serif text-[#2C2C2C] leading-[0.95] mb-3"
            style={{ fontSize: "clamp(4rem, 12vw, 8rem)" }}
            data-testid="public-yib-title"
          >
            {data.year}
          </h1>
          <p className="font-serif text-2xl md:text-3xl text-[#6B46C1] italic">
            {hasData ? "A year in books." : "A quieter year."}
          </p>
        </header>

        {!hasData ? (
          <div className="shelf-card p-10 text-center">
            <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No reading recorded in {data.year}</h2>
            <p className="text-[#6B705C] mb-6">
              {data.display_name} didn't record any reading on Shelfsort in {data.year}.
            </p>
          </div>
        ) : (
          <>
            <section className="shelf-card p-8 md:p-12 mb-8" data-testid="public-headline-stats">
              <div className="grid grid-cols-3 gap-4 md:gap-6">
                <BigStat value={s.books_opened} label="Books opened" color="#E07A5F" />
                <BigStat value={s.books_finished} label="Finished" color="#6B46C1" />
                <BigStat value={s.longest_streak} label="Longest streak" color="#B87A00" />
              </div>
              <div className="grid grid-cols-2 gap-4 md:gap-6 mt-10 pt-8 border-t border-[#E8E6E1]">
                <div className="text-center">
                  <p className="font-serif text-4xl text-[#2C2C2C] tabular-nums">{s.active_days}</p>
                  <p className="text-xs uppercase tracking-wider text-[#6B705C] mt-1 font-semibold">Active days</p>
                </div>
                <div className="text-center">
                  <p className="font-serif text-4xl text-[#2C2C2C] tabular-nums">{(s.pages_read || 0).toLocaleString()}</p>
                  <p className="text-xs uppercase tracking-wider text-[#6B705C] mt-1 font-semibold">Pages read</p>
                </div>
              </div>
              {s.best_month && s.best_month.opens > 0 && (
                <p className="text-center text-[#6B705C] mt-8 italic">
                  Best month: <strong className="text-[#6B46C1] not-italic font-semibold">{s.best_month.name}</strong>{" "}
                  ({s.best_month.opens} book opens).
                </p>
              )}
            </section>

            <section className="shelf-card p-6 md:p-8 mb-8">
              <div className="flex items-center gap-2 mb-5">
                <Calendar className="w-4 h-4 text-[#6B46C1]" />
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Month by month</h2>
              </div>
              <div className="flex items-end gap-2 h-44">
                {(s.monthly || []).map(m => {
                  const pct = (m.opens / maxMonthly) * 100;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end" title={`${m.label}: ${m.opens} opens`}>
                      <span className="text-[10px] text-[#6B705C] mb-1 tabular-nums">{m.opens || ""}</span>
                      <div
                        className="w-full rounded-t-md"
                        style={{
                          height: `${Math.max(2, pct)}%`,
                          background: m.opens > 0 ? "#E07A5F" : "#E8E6E1",
                          minHeight: "4px",
                        }}
                      />
                      <span className="text-[10px] text-[#6B705C] mt-1.5">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {(s.top_fandoms || []).length > 0 && (
                <section className="shelf-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-[#E07A5F]" />
                    <h2 className="font-serif text-2xl text-[#2C2C2C]">Top fandoms</h2>
                  </div>
                  <div className="space-y-3">
                    {s.top_fandoms.map(f => (
                      <BarRow key={f.name} label={f.name} value={f.count} max={maxFandom} accent="#E07A5F" />
                    ))}
                  </div>
                </section>
              )}
              {(s.top_authors || []).length > 0 && (
                <section className="shelf-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <UserCircle2 className="w-4 h-4 text-[#6B46C1]" />
                    <h2 className="font-serif text-2xl text-[#2C2C2C]">Most-read authors</h2>
                  </div>
                  <div className="space-y-3">
                    {s.top_authors.map(a => (
                      <BarRow key={a.name} label={a.name} value={a.count} max={maxAuthor} accent="#6B46C1" />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {(s.first_book || s.last_book) && (
              <section className="shelf-card p-6 md:p-8 mb-8 bg-[#FDF3E1] border-[#B87A00]/20">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B87A00] mb-4">Bookends</p>
                <div className="grid sm:grid-cols-2 gap-6">
                  {s.first_book && s.first_book.title && (
                    <div>
                      <p className="text-xs text-[#6B705C] mb-1">First book of the year</p>
                      <p className="font-serif text-xl text-[#2C2C2C] leading-tight">{s.first_book.title}</p>
                      <p className="text-sm text-[#6B705C] mt-1">{s.first_book.author} · {s.first_book.date}</p>
                    </div>
                  )}
                  {s.last_book && s.last_book.title && (!s.first_book || s.last_book.title !== s.first_book.title) && (
                    <div>
                      <p className="text-xs text-[#6B705C] mb-1">Last book of the year</p>
                      <p className="font-serif text-xl text-[#2C2C2C] leading-tight">{s.last_book.title}</p>
                      <p className="text-sm text-[#6B705C] mt-1">{s.last_book.author} · {s.last_book.date}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-12">
              {s.longest_streak >= 7 && (
                <div className="shelf-card p-4 flex items-center gap-3">
                  <Flame className="w-8 h-8 text-[#E07A5F] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#2C2C2C]">On fire</p>
                    <p className="text-xs text-[#6B705C]">{s.longest_streak}-day streak</p>
                  </div>
                </div>
              )}
              {s.books_finished >= 10 && (
                <div className="shelf-card p-4 flex items-center gap-3">
                  <Trophy className="w-8 h-8 text-[#B87A00] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#2C2C2C]">Finisher</p>
                    <p className="text-xs text-[#6B705C]">{s.books_finished} books closed</p>
                  </div>
                </div>
              )}
              {(s.top_fandoms || []).length >= 3 && (
                <div className="shelf-card p-4 flex items-center gap-3">
                  <Sparkles className="w-8 h-8 text-[#6B46C1] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#2C2C2C]">Eclectic</p>
                    <p className="text-xs text-[#6B705C]">{s.top_fandoms.length}+ fandoms</p>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* Footer CTA */}
        <section className="shelf-card p-8 md:p-10 text-center mb-16 bg-gradient-to-br from-[#FDF3E1] to-[#FDFBF7] border-[#B87A00]/20" data-testid="public-footer-cta">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#E07A5F] mb-2">
            Made on Shelfsort
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-[#2C2C2C] mb-3">
            Track your own reading year.
          </h2>
          <p className="text-[#6B705C] mb-6 max-w-md mx-auto">
            Drop your EPUBs in, sort by fandom, get a free yearly recap like this one.
          </p>
          <Link to="/login" className="btn-primary text-sm inline-flex items-center gap-2">
            Get started — it's free <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
