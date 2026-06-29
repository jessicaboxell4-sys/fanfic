import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Heart, Loader2, Sparkles, MessageSquare, ExternalLink, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Community Recommendations feed — Phase 1 of the community-library
// idea (iter 59).  Signed-in members see a tabbed feed of books that
// other readers have publicly recommended.  Each rec is a pointer
// into the recommender's public library — clicking through routes
// the viewer to /u/<handle>/library so they can find the book in
// context.  No file sharing.  See backend/routes/community.py.
export default function CommunityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("recent");
  const [hasMore, setHasMore] = useState(false);
  // Track viewer-side heart state for instant UI feedback (we don't
  // round-trip /reaction-status per row to keep the feed fast).
  const [pending, setPending] = useState({});

  const fetchFeed = useCallback(async (nextSort) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/community/feed?sort=${nextSort || sort}&limit=50`);
      setItems(data?.items || []);
      setHasMore(!!data?.has_more);
    } catch (err) {
      toast.error("Couldn't load the community feed", { description: err?.response?.data?.detail || "" });
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => { fetchFeed(sort); }, [fetchFeed, sort]);

  const toggleHeart = async (rec) => {
    if (pending[rec.rec_id]) return;
    setPending((p) => ({ ...p, [rec.rec_id]: true }));
    // Optimistic: toggle count immediately.
    setItems((rows) => rows.map((r) => r.rec_id === rec.rec_id
      ? { ...r, _hearted: !r._hearted, hearts_count: r.hearts_count + (r._hearted ? -1 : 1) }
      : r,
    ));
    try {
      const { data } = await api.post(`/community/recommend/${rec.rec_id}/heart`);
      if (data?.self_react) {
        // Roll back the optimistic toggle — you can't heart your own.
        toast.message("Can't heart your own recommendation");
        setItems((rows) => rows.map((r) => r.rec_id === rec.rec_id
          ? { ...r, _hearted: false, hearts_count: rec.hearts_count }
          : r,
        ));
      }
    } catch {
      // Roll back on error
      setItems((rows) => rows.map((r) => r.rec_id === rec.rec_id
        ? { ...r, _hearted: !r._hearted, hearts_count: rec.hearts_count }
        : r,
      ));
      toast.error("Couldn't update heart");
    } finally {
      setPending((p) => { const n = { ...p }; delete n[rec.rec_id]; return n; });
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
          data-testid="community-back-link"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>

        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <UsersIcon className="w-6 h-6 text-[#6B46C1]" />
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C]" data-testid="community-page-title">
              Community Recommendations
            </h1>
          </div>
          <p className="text-base text-[#5B5F4D] max-w-2xl">
            Books that other Shelfsort readers have picked out of their
            own libraries for you to discover.  Heart what catches your
            eye, then click through to the recommender&apos;s shelves
            to find more like it.
          </p>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6" data-testid="community-sort-tabs">
          {[
            { value: "recent",  label: "Recent" },
            { value: "hearted", label: "Most hearted" },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSort(tab.value)}
              data-testid={`community-sort-${tab.value}`}
              data-state={sort === tab.value ? "active" : "inactive"}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                sort === tab.value
                  ? "bg-[#6B46C1] text-white"
                  : "bg-white text-[#5B5F4D] border border-[#E5E0D5] hover:text-[#2C2C2C]"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          {user && (
            <Link
              to="/library/all"
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FFF8E1] text-[#7C5F1F] border border-[#E8D89A] hover:bg-[#FFF3D6]"
              data-testid="community-recommend-cta"
              title="Mark books from your library as recommended to the community"
            >
              <Sparkles className="w-3.5 h-3.5" /> Recommend from your library
            </Link>
          )}
        </div>

        {/* Empty / loading / list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#5B5F4D]" data-testid="community-loading">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div
            className="shelf-card p-10 text-center bg-white"
            data-testid="community-empty"
          >
            <Sparkles className="w-8 h-8 text-[#6B46C1] mx-auto mb-3" />
            <h3 className="font-serif text-xl text-[#2C2C2C] mb-2">
              No recommendations yet
            </h3>
            <p className="text-sm text-[#5B5F4D] mb-5 max-w-md mx-auto">
              Be the first reader to pick a book out of your library and
              share why it&apos;s worth a stranger&apos;s time.
            </p>
            <Link
              to="/library/all"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
              data-testid="community-empty-cta"
            >
              <Sparkles className="w-4 h-4" /> Recommend a book
            </Link>
          </div>
        ) : (
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            data-testid="community-feed-list"
          >
            {items.map((rec) => (
              <li
                key={rec.rec_id}
                data-testid={`community-rec-${rec.rec_id}`}
                className="shelf-card p-5 bg-white flex flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  {rec.book.cover_url ? (
                    <img
                      src={rec.book.cover_url}
                      alt=""
                      className="w-16 h-24 rounded-md object-cover flex-shrink-0 border border-[#E5E0D5]"
                    />
                  ) : (
                    <div className="w-16 h-24 rounded-md bg-[#F0EBE0] border border-[#E5E0D5] flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] text-[#6E6E6E]">No cover</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[#2C2C2C] truncate" title={rec.book.title}>
                      {rec.book.title || "Untitled"}
                    </h3>
                    <p className="text-sm text-[#5B5F4D] truncate">{rec.book.author || "—"}</p>
                    {rec.book.fandom && (
                      <span className="inline-block mt-1 text-[11px] text-[#6B46C1] bg-[#F0EBFB] px-2 py-0.5 rounded-full">
                        {rec.book.fandom}
                      </span>
                    )}
                  </div>
                </div>

                {rec.note && (
                  <p
                    className="text-sm text-[#2C2C2C] italic border-l-2 border-[#E8D89A] pl-3"
                    data-testid={`community-rec-note-${rec.rec_id}`}
                  >
                    &ldquo;{rec.note}&rdquo;
                  </p>
                )}

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-[#F0EBE0]">
                  <Link
                    to={`/u/${rec.owner.username}/library`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B46C1] hover:text-[#553397] min-w-0"
                    data-testid={`community-rec-owner-${rec.rec_id}`}
                    title={`Visit @${rec.owner.username}'s library`}
                  >
                    {rec.owner.picture ? (
                      <img src={rec.owner.picture} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-[#6B46C1] text-white text-[10px] flex items-center justify-center flex-shrink-0">
                        {(rec.owner.username || "?")[0].toUpperCase()}
                      </span>
                    )}
                    <span className="truncate">@{rec.owner.username || "?"}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </Link>

                  <button
                    type="button"
                    onClick={() => toggleHeart(rec)}
                    disabled={!!pending[rec.rec_id]}
                    data-testid={`community-rec-heart-${rec.rec_id}`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                      rec._hearted
                        ? "bg-[#FBE2E0] text-[#7C2D2A]"
                        : "bg-[#F7F3FF] text-[#6B46C1] hover:bg-[#F0EBFB]"
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${rec._hearted ? "fill-current" : ""}`} />
                    <span>{rec.hearts_count || 0}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <p className="text-center text-xs text-[#6E6E6E] mt-6" data-testid="community-pagination-hint">
            Showing the first 50 — pagination coming soon.
          </p>
        )}

        {/* Footer info */}
        <div className="mt-10 p-4 rounded-xl bg-[#FFF8E1] border border-[#E8D89A]">
          <p className="text-xs text-[#5B5F4D] flex items-start gap-2">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[#B7791F]" />
            <span>
              <strong className="text-[#2C2C2C]">How it works:</strong>{" "}
              Recommendations point to books in the recommender&apos;s own
              public library — no files are shared here.  To unlock the
              ability to recommend, finish your profile (handle + bio +
              public library).{" "}
              <Link to="/account" className="text-[#6B46C1] hover:underline" data-testid="community-profile-link">
                Set up your profile →
              </Link>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
