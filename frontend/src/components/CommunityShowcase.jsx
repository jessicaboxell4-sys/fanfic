import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ArrowRight } from "lucide-react";
import { api } from "../lib/api";

/**
 * "Loved by readers" rail on the marketing landing page.  Pulls the
 * current top-of-week from the public `/community-covers/featured`
 * endpoint and renders 6 thumbnails.  Auto-hides when the pool is
 * empty so a fresh install doesn't show a sad gap.  Each thumbnail
 * deep-links into the public `/cover/:id` page so anonymous
 * visitors can browse the gallery without signing up first.
 *
 * Also surfaces a small public-counter strip ("X readers signed up
 * this month") above the grid for social proof — pulled from the
 * `/api/analytics/public-stats` endpoint.
 */
export default function CommunityShowcase() {
  const [covers, setCovers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          api.get("/community-covers/featured", { params: { days: 7, limit: 6 } }),
          api.get("/analytics/public-stats"),
        ]);
        setCovers(c.data?.covers || []);
        setStats(s.data || null);
      } catch { /* non-blocking */ }
      setLoading(false);
    })();
  }, []);

  if (loading || covers.length === 0) return null;

  return (
    <section
      id="community"
      className="bg-[#FDFBF7] border-y border-[#E8E6E1]"
      data-testid="landing-community-showcase"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-20">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
              Loved by readers
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight">
              The community pool, this week.
            </h2>
            <p className="text-base text-[#5B5F4D] mt-2 max-w-2xl">
              AI-generated covers readers shared with each other — heart
              your favourites, remix them into your own library.
            </p>
          </div>
          <Link
            to="/explore/covers"
            data-testid="landing-explore-cta"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#6B46C1] hover:text-[#553397]"
          >
            Explore the gallery <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {stats && stats.total_users > 0 && (
          <p
            className="text-xs text-[#5B5F4D] mb-5 -mt-2"
            data-testid="landing-public-counter"
          >
            <strong className="text-[#2C2C2C]">{stats.total_users.toLocaleString()}</strong>{" "}
            readers · <strong className="text-[#2C2C2C]">{stats.total_covers.toLocaleString()}</strong> AI covers shared
            {stats.monthly_signups > 0 && (
              <> · <strong className="text-[#2C2C2C]">{stats.monthly_signups.toLocaleString()}</strong> signed up this month</>
            )}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {covers.map((c) => (
            <Link
              key={c.cover_id}
              to={`/cover/${c.cover_id}`}
              className="bg-white rounded-lg border border-[#E8E6E1] overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              data-testid={`landing-cover-${c.cover_id}`}
            >
              <div className="aspect-[2/3] bg-[#F5F2EA] overflow-hidden">
                <img
                  src={`data:${c.mime_type};base64,${c.image_base64}`}
                  alt={c.title}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-2.5">
                <p className="font-serif text-sm text-[#2C2C2C] leading-tight line-clamp-2">
                  {c.title || "Untitled"}
                </p>
                <p className="text-[11px] text-[#5B5F4D] mt-1 inline-flex items-center gap-1">
                  <Heart className="w-3 h-3" /> {c.votes || 0}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
