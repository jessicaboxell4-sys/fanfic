import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { toast } from "sonner";
import {
  ArrowLeft,
  GitCompare,
  Plus,
  Minus,
  PencilLine,
  Equal,
  Loader2,
  ArrowRight,
  BookOpen,
} from "lucide-react";

function StatBlock({ value, label, tone = "neutral", testid }) {
  const tones = {
    neutral: "text-[#2C2C2C]",
    positive: "text-[#3A5A40]",
    negative: "text-[#9D2A2A]",
    accent: "text-[#B87A00]",
  };
  return (
    <div className="flex flex-col items-start" data-testid={testid}>
      <span className={`font-serif text-4xl sm:text-5xl ${tones[tone] || tones.neutral}`}>
        {value}
      </span>
      <span className="text-xs uppercase tracking-widest text-[#6E6E6E] mt-1">{label}</span>
    </div>
  );
}

function ChapterRow({ kind, entry, newBookId, navigate }) {
  const palettes = {
    added: {
      border: "border-l-4 border-[#3A5A40]",
      bg: "bg-[#EEF3EC]",
      icon: <Plus className="h-4 w-4 text-[#3A5A40]" />,
      label: "Added",
    },
    removed: {
      border: "border-l-4 border-[#9D2A2A]",
      bg: "bg-[#F8ECEC]",
      icon: <Minus className="h-4 w-4 text-[#9D2A2A]" />,
      label: "Removed",
    },
    changed: {
      border: "border-l-4 border-[#B87A00]",
      bg: "bg-[#FDF3E1]",
      icon: <PencilLine className="h-4 w-4 text-[#B87A00]" />,
      label: "Changed",
    },
    unchanged: {
      border: "border-l-4 border-[#D5D2CC]",
      bg: "bg-[#FBFAF6]",
      icon: <Equal className="h-4 w-4 text-[#6E6E6E]" />,
      label: "Unchanged",
    },
  };
  const p = palettes[kind];
  const wordsLabel = (() => {
    if (kind === "added") return `${entry.words.toLocaleString()} words`;
    if (kind === "removed") return `${entry.words.toLocaleString()} words`;
    if (kind === "unchanged") return `${entry.new_words.toLocaleString()} words`;
    // changed
    const sign = entry.delta > 0 ? "+" : "";
    return `${entry.old_words.toLocaleString()} → ${entry.new_words.toLocaleString()} (${sign}${entry.delta.toLocaleString()})`;
  })();
  const jumpHref = entry.new_href; // present for added, changed, unchanged
  const canJump = kind !== "removed" && jumpHref && newBookId;
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg ${p.border} ${p.bg} ${canJump ? "cursor-pointer hover:brightness-95 transition" : ""}`}
      data-testid={`chapter-row-${kind}`}
      onClick={canJump ? () => navigate(`/read/${newBookId}?at=${encodeURIComponent(jumpHref)}`) : undefined}
      role={canJump ? "button" : undefined}
      tabIndex={canJump ? 0 : undefined}
      onKeyDown={
        canJump
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(`/read/${newBookId}?at=${encodeURIComponent(jumpHref)}`);
              }
            }
          : undefined
      }
    >
      <div className="flex-shrink-0">{p.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-serif text-base text-[#2C2C2C] truncate">{entry.title}</p>
        <p className="text-xs text-[#6E6E6E] mt-0.5">{wordsLabel}</p>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-[#6E6E6E]/70 hidden sm:inline">
        {p.label}
      </span>
    </div>
  );
}

export default function CompareVersions() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/books/${id}/diff`);
      setData(data);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't load version diff";
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-[#6E6E6E] hover:text-[#2C2C2C] mb-6"
          data-testid="compare-back-btn"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-[#FDF3E1] border border-[#B87A00]/30 flex items-center justify-center">
            <GitCompare className="h-6 w-6 text-[#B87A00]" />
          </div>
          <div>
            <h1
              className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight"
              data-testid="compare-title"
            >
              Compare versions
            </h1>
            <p className="text-sm text-[#6E6E6E]">
              See exactly what changed when this fic updated.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-[#6E6E6E]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading chapter diff…
          </div>
        )}

        {!loading && !data && (
          <div
            className="p-6 rounded-2xl border border-[#D5D2CC] bg-white text-[#2C2C2C]"
            data-testid="compare-empty-state"
          >
            <p className="font-serif text-xl mb-2">No counterpart version found</p>
            <p className="text-sm text-[#6E6E6E]">
              Refresh this book from its source URL to create a version history,
              then come back to see a side-by-side chapter diff.
            </p>
            <Link
              to={`/book/${id}`}
              className="inline-block mt-4 text-sm font-semibold text-[#3A5A40] hover:underline"
            >
              ← Back to book
            </Link>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Old → New header */}
            <div
              className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-stretch mb-8"
              data-testid="compare-header"
            >
              <Link
                to={`/book/${data.old.book_id}`}
                className="p-5 rounded-2xl bg-white border border-[#D5D2CC] hover:border-[#B87A00]/50 transition-colors"
                data-testid="compare-old-card"
              >
                <p className="text-[10px] uppercase tracking-widest text-[#6E6E6E] mb-2">
                  Older version
                </p>
                <p className="font-serif text-lg text-[#2C2C2C] line-clamp-2">{data.old.title}</p>
                <p className="text-xs text-[#6E6E6E] mt-1">{data.old.category}</p>
                <p className="text-xs text-[#6E6E6E] mt-3">
                  {data.diff.summary.old_chapter_count} chapters ·{" "}
                  {data.diff.summary.old_total_words.toLocaleString()} words
                </p>
              </Link>
              <div className="hidden md:flex items-center justify-center">
                <ArrowRight className="h-8 w-8 text-[#B87A00]" />
              </div>
              <Link
                to={`/book/${data.new.book_id}`}
                className="p-5 rounded-2xl bg-white border border-[#D5D2CC] hover:border-[#B87A00]/50 transition-colors"
                data-testid="compare-new-card"
              >
                <p className="text-[10px] uppercase tracking-widest text-[#6E6E6E] mb-2">
                  Newer version
                </p>
                <p className="font-serif text-lg text-[#2C2C2C] line-clamp-2">{data.new.title}</p>
                <p className="text-xs text-[#6E6E6E] mt-1">{data.new.category}</p>
                <p className="text-xs text-[#6E6E6E] mt-3">
                  {data.diff.summary.new_chapter_count} chapters ·{" "}
                  {data.diff.summary.new_total_words.toLocaleString()} words
                </p>
              </Link>
            </div>

            {/* Summary stats */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-6 p-6 rounded-2xl bg-white border border-[#D5D2CC] mb-8"
              data-testid="compare-summary"
            >
              <StatBlock
                value={`+${data.diff.summary.chapters_added}`}
                label="Chapters added"
                tone="positive"
                testid="stat-chapters-added"
              />
              <StatBlock
                value={`-${data.diff.summary.chapters_removed}`}
                label="Chapters removed"
                tone={data.diff.summary.chapters_removed > 0 ? "negative" : "neutral"}
                testid="stat-chapters-removed"
              />
              <StatBlock
                value={data.diff.summary.chapters_changed}
                label="Chapters edited"
                tone="accent"
                testid="stat-chapters-changed"
              />
              <StatBlock
                value={`${data.diff.summary.words_delta >= 0 ? "+" : ""}${data.diff.summary.words_delta.toLocaleString()}`}
                label="Word count delta"
                tone={data.diff.summary.words_delta >= 0 ? "positive" : "negative"}
                testid="stat-words-delta"
              />
            </div>

            {/* Re-read changes CTA */}
            {data.diff.first_changed_chapter && (
              <div
                className="mb-8 p-5 rounded-2xl bg-[#FDF3E1] border border-[#B87A00]/30 flex flex-col sm:flex-row sm:items-center gap-4"
                data-testid="reread-cta"
              >
                <div className="flex-1">
                  <p className="font-serif text-lg text-[#2C2C2C] mb-1">
                    Jump straight to what changed
                  </p>
                  <p className="text-sm text-[#6E6E6E]">
                    Skip the parts you've already read. The first {data.diff.first_changed_chapter.kind}{" "}
                    chapter is "{data.diff.first_changed_chapter.title}".
                  </p>
                </div>
                <button
                  onClick={() => {
                    const href = data.diff.first_changed_chapter.new_href || "";
                    const url = href
                      ? `/read/${data.new.book_id}?at=${encodeURIComponent(href)}`
                      : `/read/${data.new.book_id}`;
                    navigate(url);
                  }}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#3A5A40] hover:bg-[#2D4730] text-white font-semibold transition-colors flex-shrink-0"
                  data-testid="reread-changes-btn"
                >
                  <BookOpen className="h-4 w-4" />
                  Re-read changes
                </button>
              </div>
            )}

            {/* Chapter list */}
            <div className="space-y-6">
              {data.diff.added_chapters.length > 0 && (
                <section data-testid="section-added">
                  <h2 className="font-serif text-xl text-[#2C2C2C] mb-3">
                    Added chapters ({data.diff.added_chapters.length})
                  </h2>
                  <div className="space-y-2">
                    {data.diff.added_chapters.map((c, i) => (
                      <ChapterRow key={`a-${i}`} kind="added" entry={c} newBookId={data.new.book_id} navigate={navigate} />
                    ))}
                  </div>
                </section>
              )}

              {data.diff.changed_chapters.length > 0 && (
                <section data-testid="section-changed">
                  <h2 className="font-serif text-xl text-[#2C2C2C] mb-3">
                    Edited chapters ({data.diff.changed_chapters.length})
                  </h2>
                  <div className="space-y-2">
                    {data.diff.changed_chapters.map((c, i) => (
                      <ChapterRow key={`c-${i}`} kind="changed" entry={c} newBookId={data.new.book_id} navigate={navigate} />
                    ))}
                  </div>
                </section>
              )}

              {data.diff.removed_chapters.length > 0 && (
                <section data-testid="section-removed">
                  <h2 className="font-serif text-xl text-[#2C2C2C] mb-3">
                    Removed chapters ({data.diff.removed_chapters.length})
                  </h2>
                  <div className="space-y-2">
                    {data.diff.removed_chapters.map((c, i) => (
                      <ChapterRow key={`r-${i}`} kind="removed" entry={c} newBookId={data.new.book_id} navigate={navigate} />
                    ))}
                  </div>
                </section>
              )}

              {data.diff.unchanged_chapters.length > 0 && (
                <section data-testid="section-unchanged">
                  <h2 className="font-serif text-xl text-[#6E6E6E] mb-3">
                    Unchanged ({data.diff.unchanged_chapters.length})
                  </h2>
                  <div className="space-y-2">
                    {data.diff.unchanged_chapters.map((c, i) => (
                      <ChapterRow key={`u-${i}`} kind="unchanged" entry={c} newBookId={data.new.book_id} navigate={navigate} />
                    ))}
                  </div>
                </section>
              )}

              {data.diff.added_chapters.length === 0 &&
                data.diff.changed_chapters.length === 0 &&
                data.diff.removed_chapters.length === 0 && (
                  <div
                    className="p-6 rounded-2xl border border-[#D5D2CC] bg-white text-center text-[#6E6E6E]"
                    data-testid="compare-no-changes"
                  >
                    Nothing changed between these versions — every chapter has the same word
                    count.
                  </div>
                )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
