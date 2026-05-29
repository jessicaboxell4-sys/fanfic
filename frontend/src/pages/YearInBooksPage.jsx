import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BookOpen, Flame, Trophy, Calendar, Sparkles, UserCircle2, Mail, Loader2, Share2, Copy, Link as LinkIcon, Eye, X, Trash2 } from "lucide-react";

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

function BarRow({ label, value, max, to, accent }) {
  const pct = max > 0 ? Math.max(6, (value / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-[#2C2C2C] truncate pr-3">{label}</span>
        <span className="text-[#6B705C] tabular-nums font-semibold">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#F5F3EC] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="block hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

export default function YearInBooksPage() {
  const { year: yearParam } = useParams();
  const navigate = useNavigate();
  const year = Number(yearParam) || new Date().getFullYear() - 1;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Sharing
  const [share, setShare] = useState(null); // {shared, token, url, view_count, ...}
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/year-in-books/${year}`);
        if (!cancelled) setData(data);
      } catch (e) {
        toast.error("Couldn't load your year recap");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/year-in-books/${year}/share`);
        if (!cancelled) setShare(data);
      } catch (e) { /* ignore — non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const createShare = async () => {
    setSharing(true);
    try {
      const { data } = await api.post(`/year-in-books/${year}/share`);
      setShare(data);
      setShareDialogOpen(true);
      toast.success("Share link ready");
    } catch (e) {
      toast.error("Couldn't create share link");
    } finally {
      setSharing(false);
    }
  };

  const revokeShare = async () => {
    if (!window.confirm("Revoke this share link? The URL will stop working immediately.")) return;
    setSharing(true);
    try {
      await api.delete(`/year-in-books/${year}/share`);
      setShare({ shared: false });
      setShareDialogOpen(false);
      toast.success("Share link revoked");
    } catch (e) {
      toast.error("Couldn't revoke");
    } finally {
      setSharing(false);
    }
  };

  const copyShareUrl = async () => {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      toast.success("Link copied!");
    } catch (e) {
      toast.error("Couldn't copy — please copy manually");
    }
  };

  const emailMe = async () => {
    setSendingEmail(true);
    try {
      const { data } = await api.post(`/year-in-books/${year}/email`);
      if (data.delivered) toast.success("Year recap emailed!");
      else if (data.logged) toast.warning("Email isn't configured on this server — but the recap is right here on this page.");
      else toast.error("Couldn't send email");
    } catch (e) {
      toast.error("Couldn't send email");
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <p className="text-[#6B705C] py-20 text-center">Reading your year…</p>
      </div>
    );
  }

  const s = data?.summary || {};
  const hasData = data?.has_data;
  const maxMonthly = Math.max(1, ...(s.monthly || []).map(m => m.opens));
  const maxFandom = Math.max(0, ...(s.top_fandoms || []).map(f => f.count));
  const maxAuthor = Math.max(0, ...(s.top_authors || []).map(a => a.count));
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-8">
          <button
            onClick={() => navigate("/library/stats")}
            data-testid="back-to-stats"
            className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to stats
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/library/year/${year - 1}`)}
              data-testid="prev-year"
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3 h-3" /> {year - 1}
            </button>
            {year < currentYear && (
              <button
                onClick={() => navigate(`/library/year/${year + 1}`)}
                data-testid="next-year"
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                {year + 1} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Hero */}
        <header className="text-center py-12 md:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#E07A5F] mb-4">
            Shelfsort recap
          </p>
          <h1
            className="font-serif text-[#2C2C2C] leading-[0.95] mb-3"
            style={{ fontSize: "clamp(4rem, 12vw, 8rem)" }}
            data-testid="year-in-books-title"
          >
            {year}
          </h1>
          <p className="font-serif text-2xl md:text-3xl text-[#3A5A40] italic">
            {hasData ? "Your year in books." : "A quiet year on the shelf."}
          </p>
        </header>

        {!hasData ? (
          <div className="shelf-card p-10 text-center">
            <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No reading recorded in {year}</h2>
            <p className="text-[#6B705C] mb-6">
              {year >= currentYear
                ? "The year isn't over yet — come back when it is, or check a previous year."
                : "Try a different year, or head back to your library."}
            </p>
            <Link to="/library" className="btn-primary text-sm inline-block">
              Open library
            </Link>
          </div>
        ) : (
          <>
            {/* Three big numbers */}
            <section className="shelf-card p-8 md:p-12 mb-8" data-testid="year-headline-stats">
              <div className="grid grid-cols-3 gap-4 md:gap-6">
                <BigStat value={s.books_opened} label="Books opened" color="#E07A5F" />
                <BigStat value={s.books_finished} label="Finished" color="#3A5A40" />
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
                <p className="text-center text-[#6B705C] mt-8 italic" data-testid="best-month-line">
                  Your most active month was <strong className="text-[#3A5A40] not-italic font-semibold">{s.best_month.name}</strong>{" "}
                  ({s.best_month.opens} book opens).
                </p>
              )}
            </section>

            {/* Monthly chart */}
            <section className="shelf-card p-6 md:p-8 mb-8" data-testid="year-monthly-chart">
              <div className="flex items-center gap-2 mb-5">
                <Calendar className="w-4 h-4 text-[#3A5A40]" />
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Month by month</h2>
              </div>
              <div className="flex items-end gap-2 h-44">
                {(s.monthly || []).map(m => {
                  const pct = (m.opens / maxMonthly) * 100;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end" title={`${m.label}: ${m.opens} opens, ${m.finished} finished`}>
                      <span className="text-[10px] text-[#6B705C] mb-1 tabular-nums">{m.opens || ""}</span>
                      <div
                        className="w-full rounded-t-md transition-all"
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
              {/* Top fandoms */}
              {(s.top_fandoms || []).length > 0 && (
                <section className="shelf-card p-6" data-testid="year-top-fandoms">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-[#E07A5F]" />
                    <h2 className="font-serif text-2xl text-[#2C2C2C]">Top fandoms</h2>
                  </div>
                  <div className="space-y-3">
                    {s.top_fandoms.map(f => (
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
                </section>
              )}

              {/* Top authors */}
              {(s.top_authors || []).length > 0 && (
                <section className="shelf-card p-6" data-testid="year-top-authors">
                  <div className="flex items-center gap-2 mb-4">
                    <UserCircle2 className="w-4 h-4 text-[#3A5A40]" />
                    <h2 className="font-serif text-2xl text-[#2C2C2C]">Most-read authors</h2>
                  </div>
                  <div className="space-y-3">
                    {s.top_authors.map(a => (
                      <BarRow
                        key={a.name}
                        label={a.name}
                        value={a.count}
                        max={maxAuthor}
                        to={`/library/author/${encodeURIComponent(a.name)}`}
                        accent="#3A5A40"
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Bookends */}
            {(s.first_book || s.last_book) && (
              <section className="shelf-card p-6 md:p-8 mb-8 bg-[#FDF3E1] border-[#B87A00]/20" data-testid="year-bookends">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B87A00] mb-4">Bookends</p>
                <div className="grid sm:grid-cols-2 gap-6">
                  {s.first_book && s.first_book.title && (
                    <div>
                      <p className="text-xs text-[#6B705C] mb-1">First book of the year</p>
                      <p className="font-serif text-xl text-[#2C2C2C] leading-tight">{s.first_book.title}</p>
                      <p className="text-sm text-[#6B705C] mt-1">
                        {s.first_book.author} · {s.first_book.date}
                      </p>
                    </div>
                  )}
                  {s.last_book && s.last_book.title && (!s.first_book || s.last_book.book_id !== s.first_book.book_id) && (
                    <div>
                      <p className="text-xs text-[#6B705C] mb-1">Last book of the year</p>
                      <p className="font-serif text-xl text-[#2C2C2C] leading-tight">{s.last_book.title}</p>
                      <p className="text-sm text-[#6B705C] mt-1">
                        {s.last_book.author} · {s.last_book.date}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Achievements row */}
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-12" data-testid="year-achievements">
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
                  <Sparkles className="w-8 h-8 text-[#3A5A40] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#2C2C2C]">Eclectic</p>
                    <p className="text-xs text-[#6B705C]">{s.top_fandoms.length}+ fandoms</p>
                  </div>
                </div>
              )}
            </section>

            {/* Email me + Share */}
            <section className="text-center mb-16">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={emailMe}
                  disabled={sendingEmail}
                  data-testid="email-year-recap"
                  className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Email this recap to myself
                </button>
                <button
                  onClick={share?.shared ? () => setShareDialogOpen(true) : createShare}
                  disabled={sharing}
                  data-testid="share-year-recap"
                  className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  {share?.shared ? "Manage share link" : "Share this recap"}
                </button>
              </div>
              <p className="text-xs text-[#6B705C] mt-3">
                Public link works without a Shelfsort account — revoke any time.
              </p>
            </section>
          </>
        )}
      </main>

      {/* Share dialog */}
      {shareDialogOpen && share?.shared && (
        <div
          className="fixed inset-0 z-[60] bg-[#2C2C2C]/40 flex items-center justify-center p-4"
          onClick={() => setShareDialogOpen(false)}
          data-testid="share-dialog-overlay"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-[#E8E6E1] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-1">Public link</p>
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Share your {year}</h2>
              </div>
              <button
                onClick={() => setShareDialogOpen(false)}
                data-testid="share-dialog-close"
                className="w-9 h-9 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center text-[#6B705C]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-[#6B705C]">
                Anyone with this link can see your {year} recap — no Shelfsort account needed.
                Your email and book IDs stay private.
              </p>

              <div className="relative">
                <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="share-url-input"
                  type="text"
                  readOnly
                  value={share.url || ""}
                  onClick={(e) => e.target.select()}
                  className="w-full bg-[#F5F3EC] border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm text-[#2C2C2C] font-mono"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={copyShareUrl}
                  data-testid="share-copy-btn"
                  className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy link
                </button>
                <a
                  href={share.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="share-open-btn"
                  className="btn-secondary text-sm inline-flex items-center gap-2"
                >
                  <ArrowRight className="w-4 h-4" />
                  Open
                </a>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#E8E6E1]">
                <div className="flex items-center gap-2 text-sm text-[#6B705C]" data-testid="share-view-count">
                  <Eye className="w-4 h-4" />
                  {share.view_count ?? 0} view{(share.view_count ?? 0) === 1 ? "" : "s"}
                  {share.last_viewed_at && (
                    <span className="text-xs text-[#6B705C]">
                      · last seen {new Date(share.last_viewed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={revokeShare}
                  disabled={sharing}
                  data-testid="share-revoke-btn"
                  className="text-sm text-[#D9534F] hover:text-[#a83a36] inline-flex items-center gap-1.5 font-semibold disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
