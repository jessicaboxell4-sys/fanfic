import React, { useEffect, useState } from "react";
import { BarChart3, TrendingUp, Users, Globe, Trophy } from "lucide-react";
import { api } from "../lib/api";

/**
 * Admin-only visitor analytics dashboard widget.  Pulls
 * `/api/analytics/summary` and renders the funnel + ref-bucket + top
 * covers + country distribution as a single card.
 *
 * Designed to live inside AdminConsole below the existing sections.
 */
export default function AdminAnalyticsCard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/analytics/summary", { params: { days } });
        setData(data);
      } catch { /* admin-only — silent on error */ }
      setLoading(false);
    })();
  }, [days]);

  if (loading) {
    return (
      <section className="shelf-card p-6 mb-6" data-testid="admin-analytics-card">
        <p className="text-[#5B5F4D]">Loading analytics…</p>
      </section>
    );
  }
  if (!data) return null;

  const f = data.funnel || {};

  return (
    <section
      className="shelf-card p-6 mb-6"
      data-testid="admin-analytics-card"
    >
      <header className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h2 className="font-serif text-xl text-[#2C2C2C] inline-flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#6B46C1]" />
          Visitor analytics
        </h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          data-testid="analytics-window-select"
          className="text-xs rounded-full border border-[#E8E6E1] px-3 py-1.5 bg-white"
        >
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7d</option>
          <option value={30}>Last 30d</option>
          <option value={90}>Last 90d</option>
        </select>
      </header>

      {/* Funnel — explore → cover → signup */}
      <div className="grid grid-cols-3 gap-3 mb-6" data-testid="analytics-funnel">
        <FunnelCell
          label="Explore views"
          value={f.explore_views || 0}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <FunnelCell
          label="Cover views"
          value={f.cover_views || 0}
          icon={<TrendingUp className="w-4 h-4" />}
          ratio={f.explore_to_cover ? `${f.explore_to_cover}%` : null}
        />
        <FunnelCell
          label="New signups"
          value={f.signups || 0}
          icon={<Users className="w-4 h-4" />}
          ratio={f.cover_to_signup ? `${f.cover_to_signup}%` : null}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top covers */}
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 inline-flex items-center gap-2">
            <Trophy className="w-3 h-3" /> Top covers
          </p>
          {(data.top_covers || []).length === 0 ? (
            <p className="text-xs text-[#5B5F4D] italic">No cover views in this window.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="analytics-top-covers">
              {data.top_covers.slice(0, 6).map((c) => (
                <li
                  key={c.cover_id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate flex-1 text-[#2C2C2C]">
                    {c.title || c.cover_id}
                  </span>
                  <span className="ml-3 text-xs text-[#5B5F4D] font-mono">{c.views}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ref + country */}
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 inline-flex items-center gap-2">
              <Globe className="w-3 h-3" /> By referrer
            </p>
            <ul className="space-y-1.5">
              {(data.by_ref || []).slice(0, 5).map((r) => (
                <li key={r.ref_bucket} className="flex justify-between text-sm">
                  <span className="text-[#2C2C2C] capitalize">{r.ref_bucket}</span>
                  <span className="text-xs text-[#5B5F4D] font-mono">{r.views}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              By country
            </p>
            <ul className="space-y-1.5">
              {(data.by_country || []).slice(0, 5).map((c) => (
                <li key={c.country} className="flex justify-between text-sm">
                  <span className="text-[#2C2C2C] font-mono">{c.country}</span>
                  <span className="text-xs text-[#5B5F4D] font-mono">{c.views}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function FunnelCell({ label, value, icon, ratio }) {
  return (
    <div className="p-3 rounded-lg bg-[#FDFBF7] border border-[#E8E6E1]">
      <div className="text-xs text-[#5B5F4D] inline-flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="font-serif text-2xl text-[#2C2C2C] mt-1">{value.toLocaleString()}</div>
      {ratio && (
        <div className="text-[10px] text-[#6B46C1] mt-0.5 font-semibold">
          {ratio} from previous step
        </div>
      )}
    </div>
  );
}
