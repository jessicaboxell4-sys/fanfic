import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Heart, Download, Trophy, ArrowLeft, Sparkles, Rss, BookOpen } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { toast } from "sonner";
import { ShareButtons } from "../components/ShareButtons";
import ConsentBanner from "../components/ConsentBanner";
import { stampView } from "../lib/analytics";

/**
 * Public-but-auth-gated profile page surfacing a user's community
 * cover-sharing track record.  Reachable from any community cover
 * card via the @handle link, and from the "Covers of the week" strip
 * on the dashboard.
 *
 * Sections:
 *   * Header — display name, join date, lifetime totals.
 *   * Trophies — `cover_achievements` rendered as badge pills.
 *   * Top covers — grid of their highest-voted shares.
 */
export default function PublicCoverProfile() {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState(null);
  // Lazy probe — checks whether this user has flipped on public
  // library sharing.  If so, we render an extra "View library" link
  // in the header.  A 404 from the public-library endpoint means
  // either "no such user" or "not public" — same UX either way.
  const [hasPublicLibrary, setHasPublicLibrary] = useState(false);

  useEffect(() => {
    let alive = true;
    stampView("profile", username);
    (async () => {
      try {
        const { data } = await api.get(`/users/${username}/cover-profile`);
        if (alive) {
          setProfile(data);
          document.title = `@${data.username} · Shelfsort covers`;
          // JSON-LD structured data so search engines surface the
          // profile page with a rich Person + CreativeWork preview.
          try {
            const old = document.getElementById("shelfsort-ld");
            if (old) old.remove();
            const s = document.createElement("script");
            s.type = "application/ld+json";
            s.id = "shelfsort-ld";
            s.text = JSON.stringify({
              "@context": "https://schema.org",
              "@type": "ProfilePage",
              mainEntity: {
                "@type": "Person",
                name: data.display_name || `@${data.username}`,
                alternateName: `@${data.username}`,
                url: `${window.location.origin}/u/${data.username}`,
                image: `${process.env.REACT_APP_BACKEND_URL}/api/og/user/${data.username}.png`,
              },
            });
            document.head.appendChild(s);
          } catch { /* JSON-LD is non-critical */ }
        }
      } catch (e) {
        if (e?.response?.status === 404) setNotFound(true);
        else toast.error(e?.response?.data?.detail || "Couldn't load profile");
      } finally {
        if (alive) setLoading(false);
      }
      try {
        const r = await api.get("/auth/me");
        if (alive) setMe(r.data);
      } catch { /* unauth — fine */ }
      // Lightweight probe for public library opt-in.  We request the
      // smallest possible payload (limit=1) and only care about the
      // 200/404 status.
      try {
        await api.get(`/users/${username}/public-library?limit=1`);
        if (alive) setHasPublicLibrary(true);
      } catch { /* 404 = not public; no link rendered */ }
    })();
    return () => { alive = false; document.getElementById("shelfsort-ld")?.remove(); };
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-5xl mx-auto px-6 py-14">
          <p className="text-[#6B705C]" data-testid="profile-loading">Loading…</p>
        </main>
      </div>
    );
  }
  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-5xl mx-auto px-6 py-14 text-center" data-testid="profile-not-found">
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">No such reader</h1>
          <p className="text-[#6B705C] mb-6">
            We couldn’t find a public profile for <code>@{username}</code>.
          </p>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to your library
          </Link>
        </main>
      </div>
    );
  }

  const wonTopOfWeek = (profile.achievements || []).some(a => a.kind === "top_of_week");

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main
        className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in"
        data-testid="public-cover-profile"
      >
        <Link
          to={me ? "/library" : "/explore/covers"}
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-6 hover:text-[#553397]"
          data-testid="profile-back-link"
        >
          <ArrowLeft className="w-3 h-3" /> {me ? "Back" : "Explore"}
        </Link>

        <header className="mb-10" data-testid="profile-header">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            Cover-sharer profile
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight tracking-tight">
            @{profile.username}
          </h1>
          {profile.display_name && profile.display_name !== profile.username && (
            <p className="text-lg text-[#6B705C] mt-1">{profile.display_name}</p>
          )}
          <div className="flex flex-wrap items-center gap-5 mt-5 text-sm text-[#2C2C2C]">
            <span data-testid="profile-total-shared">
              <strong>{profile.totals?.shared || 0}</strong>{" "}
              <span className="text-[#6B705C]">covers shared</span>
            </span>
            <span className="text-[#E8E6E1]">·</span>
            <span data-testid="profile-total-votes">
              <strong>{profile.totals?.votes || 0}</strong>{" "}
              <span className="text-[#6B705C]">hearts earned</span>
            </span>
            <span className="text-[#E8E6E1]">·</span>
            <span data-testid="profile-total-imports">
              <strong>{profile.totals?.imports || 0}</strong>{" "}
              <span className="text-[#6B705C]">imports</span>
            </span>
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <ShareButtons
              shareUrl={`${process.env.REACT_APP_BACKEND_URL}/api/share/u/${profile.username}`}
              title={`@${profile.username}'s AI book covers on Shelfsort`}
            />
            <a
              href={`${process.env.REACT_APP_BACKEND_URL}/api/feeds/covers/user/${profile.username}.rss`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#6B705C] hover:text-[#6B46C1]"
              data-testid="profile-rss-link"
            >
              <Rss className="w-3 h-3" /> RSS
            </a>
            {hasPublicLibrary && (
              <Link
                to={`/u/${profile.username}/library`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#EEE9FB] text-[#6B46C1] hover:bg-[#DDD1F3] transition-colors"
                data-testid="profile-public-library-link"
              >
                <BookOpen className="w-3.5 h-3.5" /> Browse library
              </Link>
            )}
          </div>
        </header>

        {(profile.achievements || []).length > 0 && (
          <section className="mb-10" data-testid="profile-achievements">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 inline-flex items-center gap-2">
              <Trophy className="w-3 h-3" /> Trophies
            </p>
            <div className="flex flex-wrap gap-2">
              {wonTopOfWeek && (
                <span
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-[#B87A00] text-white"
                  data-testid="trophy-top-of-week"
                >
                  <Trophy className="w-3 h-3 fill-current" />
                  Cover of the week winner
                </span>
              )}
              {profile.achievements.length > 1 && (
                <span className="text-xs text-[#6B705C] self-center">
                  · {profile.achievements.length} all-time
                </span>
              )}
            </div>
          </section>
        )}

        <section data-testid="profile-cover-grid">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 inline-flex items-center gap-2">
            <Sparkles className="w-3 h-3" /> Top covers
          </p>
          {(profile.covers || []).length === 0 ? (
            <p className="text-[#6B705C] italic">
              {profile.username} hasn’t shared any covers yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {profile.covers.map((c) => (
                <Link
                  key={c.cover_id}
                  to={`/cover/${c.cover_id}`}
                  className="bg-white rounded-lg border border-[#E8E6E1] overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  data-testid={`profile-cover-${c.cover_id}`}
                >
                  <div className="aspect-[2/3] bg-[#F5F2EA] overflow-hidden">
                    <img
                      src={`data:${c.mime_type || "image/png"};base64,${c.image_base64}`}
                      alt={c.title || "Community cover"}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3">
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
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-[#6B705C]">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="w-3 h-3" /> {c.votes || 0}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Download className="w-3 h-3" /> {c.import_count || 0}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <ConsentBanner />
    </div>
  );
}
