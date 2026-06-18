import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Heart, ArrowLeft, GitBranch, Download } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { ShareButtons } from "../components/ShareButtons";
import ConsentBanner from "../components/ConsentBanner";
import { stampView } from "../lib/analytics";

/**
 * Public cover-permalink page at `/cover/:coverId`.  Unauthenticated.
 * Sets `document.title` so client-side SEO has a sensible tab title
 * and pulls OG/Twitter meta tags from `/api/share/cover/:coverId`
 * (server-side HTML) when a link is shared on social.
 */
export default function PublicCoverDetail() {
  const { coverId } = useParams();
  const navigate = useNavigate();
  const [cover, setCover] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState(null);

  useEffect(() => {
    let alive = true;
    stampView("cover", coverId);
    (async () => {
      try {
        const { data } = await api.get(`/community-covers/${coverId}`);
        if (alive) {
          setCover(data);
          document.title = `${data.title || "Cover"} · @${data.shared_by} — Shelfsort`;
          try {
            const old = document.getElementById("shelfsort-ld");
            if (old) old.remove();
            const s = document.createElement("script");
            s.type = "application/ld+json";
            s.id = "shelfsort-ld";
            s.text = JSON.stringify({
              "@context": "https://schema.org",
              "@type": "CreativeWork",
              name: data.title,
              author: data.author,
              creator: { "@type": "Person", name: `@${data.shared_by}` },
              image: `${process.env.REACT_APP_BACKEND_URL}/api/og/cover/${data.cover_id}.png`,
              url: `${window.location.origin}/cover/${data.cover_id}`,
              interactionStatistic: {
                "@type": "InteractionCounter",
                interactionType: "https://schema.org/LikeAction",
                userInteractionCount: data.votes || 0,
              },
            });
            document.head.appendChild(s);
          } catch { /* non-critical */ }
        }
      } catch (e) {
        if (e?.response?.status === 404) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
      try {
        const { data } = await api.get(`/community-covers/${coverId}/lineage`);
        if (alive) setLineage(data);
      } catch { /* lineage is optional */ }
      try {
        const meR = await api.get("/auth/me");
        if (alive) setMe(meR.data);
      } catch { /* unauth — fine */ }
    })();
    return () => { alive = false; document.getElementById("shelfsort-ld")?.remove(); };
  }, [coverId]);

  const onVote = async () => {
    if (!cover) return;
    try {
      const path = me ? `/community-covers/${cover.cover_id}/vote`
                      : `/community-covers/${cover.cover_id}/vote-anon`;
      const { data } = await api.post(path);
      setCover((c) => ({ ...c, votes: data.votes, voted_by_me: data.voted_by_me }));
      if (data.signup_prompt && !me) {
        toast("Save your vote", {
          description: "Sign up to keep your hearts when you switch devices.",
          action: { label: "Sign up", onClick: () => navigate("/login") },
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't vote");
    }
  };

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-14" data-testid="cover-loading">
        <p className="text-[#6B705C]">Loading…</p>
      </main>
    );
  }
  if (notFound || !cover) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-14 text-center" data-testid="cover-not-found">
        <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">Cover not found</h1>
        <p className="text-[#6B705C] mb-6">This cover was either removed or never shared.</p>
        <Link
          to="/explore/covers"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
        >
          Browse the gallery
        </Link>
      </main>
    );
  }

  const shareUrl = `${process.env.REACT_APP_BACKEND_URL}/api/share/cover/${cover.cover_id}`;
  const shareTitle = `"${cover.title}" — cover by @${cover.shared_by} on Shelfsort`;

  return (
    <div className="min-h-screen bg-paper">
      <main
        className="max-w-3xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in"
        data-testid="public-cover-detail"
      >
        <Link
          to="/explore/covers"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-6 hover:text-[#553397]"
        >
          <ArrowLeft className="w-3 h-3" /> Explore
        </Link>

        <div className="grid md:grid-cols-[300px_1fr] gap-8 items-start">
          <div
            className="aspect-[2/3] bg-[#F5F2EA] rounded-lg overflow-hidden shadow-md"
            data-testid="cover-image-wrap"
          >
            {cover.image_base64 && (
              <img
                src={`data:${cover.mime_type};base64,${cover.image_base64}`}
                alt={cover.title || "Community cover"}
                className="w-full h-full object-cover"
              />
            )}
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Community cover
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight tracking-tight">
              {cover.title || "Untitled"}
            </h1>
            {cover.author && (
              <p className="text-lg text-[#6B705C] mt-1">{cover.author}</p>
            )}
            <p className="text-sm text-[#6B705C] mt-3">
              Shared by{" "}
              <Link
                to={`/u/${cover.shared_by}`}
                className="text-[#6B46C1] font-semibold hover:underline"
                data-testid="cover-sharer-link"
              >
                @{cover.shared_by}
              </Link>
              {cover.fandom && <> · <span className="italic">{cover.fandom}</span></>}
            </p>

            <div className="flex items-center gap-3 mt-5">
              <button
                type="button"
                onClick={onVote}
                aria-pressed={cover.voted_by_me}
                data-testid="cover-vote-btn"
                className={
                  "tap-min inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors " +
                  (cover.voted_by_me
                    ? "bg-[#B91C1C] text-white border-[#B91C1C]"
                    : "bg-white text-[#2C2C2C] border-[#E8E6E1] hover:border-[#B91C1C] hover:text-[#B91C1C]")
                }
              >
                <Heart className={"w-4 h-4 " + (cover.voted_by_me ? "fill-current" : "")} />
                {cover.votes || 0}
              </button>
              <span className="inline-flex items-center gap-1 text-sm text-[#6B705C]">
                <Download className="w-4 h-4" /> {cover.import_count || 0} imports
              </span>
            </div>

            <div className="mt-6">
              <ShareButtons shareUrl={shareUrl} title={shareTitle} />
            </div>

            {lineage && (lineage.parent || (lineage.children || []).length > 0) && (
              <div
                className="mt-8 pt-5 border-t border-[#E8E6E1] text-sm"
                data-testid="cover-lineage"
              >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 inline-flex items-center gap-2">
                  <GitBranch className="w-3 h-3" /> Remix lineage
                </p>
                {lineage.parent && (
                  <p className="text-[#2C2C2C]">
                    Remixed from{" "}
                    <Link
                      to={`/cover/${lineage.parent.cover_id}`}
                      className="text-[#6B46C1] font-semibold hover:underline"
                    >
                      “{lineage.parent.title}”
                    </Link>{" "}
                    by @{lineage.parent.shared_by_username || "anon"}.
                  </p>
                )}
                {lineage.remix_count > 0 && (
                  <p className="text-[#6B705C] mt-1">
                    {lineage.remix_count}{" "}
                    {lineage.remix_count === 1 ? "remix" : "remixes"} downstream.
                  </p>
                )}
              </div>
            )}

            {!me && (
              <div
                className="mt-8 p-4 rounded-lg bg-[#FDF3E1] border border-[#B87A00]/30 text-sm"
                data-testid="signup-prompt"
              >
                <p className="font-semibold text-[#2C2C2C] mb-1">
                  Like what you see?
                </p>
                <p className="text-[#6B705C] mb-3">
                  Shelfsort uses AI to generate covers for your fanfic + book
                  library, sorted by fandom, with a community pool just like
                  this one.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
                >
                  Try Shelfsort →
                </Link>
              </div>
            )}
          </div>
        </div>
      </main>
      <ConsentBanner />
    </div>
  );
}
