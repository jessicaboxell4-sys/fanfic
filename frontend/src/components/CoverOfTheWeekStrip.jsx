import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Sparkles, Trophy, Flame } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * "Featured covers this week" horizontal strip for the dashboard.
 *
 * Surfaces the top-voted community covers from the last 7 days using
 * the `/api/community-covers/featured?days=7` endpoint shipped with the
 * Tier-3 voting ecosystem.  Auto-hides entirely if there are no
 * featured covers yet (fresh installs / quiet weeks) so the lean
 * dashboard stays lean.
 *
 * Each card shows the thumbnail, title + author, the sharer's handle,
 * and a Heart toggle that round-trips through the same vote endpoint
 * used inside the regenerate-cover modal.  Voting is optimistic.
 */
export default function CoverOfTheWeekStrip() {
  const [covers, setCovers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/community-covers/featured", {
        params: { days: 7, limit: 8 },
      });
      setCovers(data?.covers || []);
    } catch (e) {
      // Non-blocking — strip just stays hidden if the endpoint errors.
      setCovers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vote = async (coverId) => {
    // Optimistic toggle so the heart pops immediately.
    setCovers((cs) => cs.map((c) =>
      c.cover_id === coverId
        ? {
          ...c,
          voted_by_me: !c.voted_by_me,
          votes: Math.max(0, (c.votes || 0) + (c.voted_by_me ? -1 : 1)),
        }
        : c,
    ));
    try {
      const { data } = await api.post(`/community-covers/${coverId}/vote`);
      setCovers((cs) => cs.map((c) =>
        c.cover_id === coverId
          ? { ...c, votes: data.votes, voted_by_me: data.voted_by_me }
          : c,
      ));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't vote");
      // Roll back on failure.
      load();
    }
  };

  // Hide entirely while loading the first response, or if the week has
  // nothing to surface.  The strip is a dashboard sweetener, not a
  // load-bearing element.
  if (loading || covers.length === 0) return null;

  return (
    <section
      className="mb-10"
      data-testid="cover-of-the-week-strip"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] inline-flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          Covers of the week
        </p>
        <span className="text-xs text-[#6B705C]">
          Top-voted by readers · last 7 days
        </span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory"
        data-testid="cover-of-the-week-scroll"
      >
        {covers.map((c, idx) => {
          // Sort comes back votes-desc from the backend, so idx 0 is #1.
          // Only show the ribbon when the top card has actual votes —
          // otherwise "#1 with 0 votes" feels silly on a quiet week.
          const isTop = idx === 0 && (c.votes || 0) > 0;
          return (
          <article
            key={c.cover_id}
            className="snap-start shrink-0 w-[148px] sm:w-[164px] bg-white rounded-lg border border-[#E8E6E1] overflow-hidden shadow-sm hover:shadow-md transition-shadow relative"
            data-testid={`cover-of-week-${c.cover_id}`}
          >
            {isTop && (
              <div
                className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#B87A00] text-white text-[10px] font-bold uppercase tracking-wider shadow-md"
                data-testid="cover-of-week-top-ribbon"
              >
                <Trophy className="w-3 h-3 fill-current" />
                #1 this week
              </div>
            )}
            {!isTop && c.trending && (
              <div
                className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D14545] text-white text-[10px] font-bold uppercase tracking-wider shadow-md"
                data-testid={`cover-of-week-trending-${c.cover_id}`}
              >
                <Flame className="w-3 h-3 fill-current" />
                Trending
              </div>
            )}
            <div className="aspect-[2/3] bg-[#F5F2EA] overflow-hidden">
              {c.image_base64 && (
                <img
                  src={`data:${c.mime_type || "image/png"};base64,${c.image_base64}`}
                  alt={c.title || "Community cover"}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="p-2.5">
              <p
                className="font-serif text-sm text-[#2C2C2C] leading-tight line-clamp-2 break-words"
                title={c.title}
              >
                {c.title || "Untitled"}
              </p>
              {c.author && (
                <p className="text-[11px] text-[#6B705C] mt-0.5 truncate" title={c.author}>
                  {c.author}
                </p>
              )}
              <div className="flex items-center justify-between mt-2">
                <button
                  type="button"
                  onClick={() => vote(c.cover_id)}
                  aria-pressed={c.voted_by_me}
                  data-testid={`cover-of-week-vote-${c.cover_id}`}
                  className={
                    "tap-min inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors " +
                    (c.voted_by_me
                      ? "bg-[#B91C1C] text-white border-[#B91C1C]"
                      : "bg-white text-[#6B705C] border-[#E8E6E1] hover:border-[#B91C1C] hover:text-[#B91C1C]")
                  }
                >
                  <Heart
                    className={"w-3 h-3 " + (c.voted_by_me ? "fill-current" : "")}
                  />
                  {c.votes || 0}
                </button>
                <Link
                  to={`/u/${c.shared_by}`}
                  className="text-[10px] text-[#6B705C] hover:text-[#6B46C1] truncate ml-2"
                  title={`See @${c.shared_by}'s covers`}
                  data-testid={`cover-of-week-handle-${c.cover_id}`}
                >
                  @{c.shared_by}
                </Link>
              </div>
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}
