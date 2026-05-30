import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Clock, CalendarDays, Repeat2, History } from "lucide-react";

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(iso);
}

function Stat({ icon, label, value, sub, testid }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#6B705C] mb-1">
        {icon}
        {label}
      </div>
      <span className="font-serif text-2xl text-[#2C2C2C] leading-tight">{value}</span>
      {sub && <span className="text-xs text-[#6B705C] mt-0.5">{sub}</span>}
    </div>
  );
}

export default function ReadingStatsCard({ bookId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${bookId}/reading-stats`);
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) return null;
  if (!stats) return null;
  // Hide entirely if the user has never read this book
  if (!stats.reading_minutes && !stats.session_count) return null;

  return (
    <section
      className="bg-white border border-[#E8E6E1] rounded-2xl p-5 sm:p-6"
      data-testid="reading-stats-card"
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-serif text-xl text-[#2C2C2C]">Your reading on this book</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-5">
        <Stat
          icon={<Clock className="h-3 w-3" />}
          label="Time spent"
          value={formatDuration(stats.reading_minutes)}
          testid="stat-time-spent"
        />
        <Stat
          icon={<Repeat2 className="h-3 w-3" />}
          label="Sessions"
          value={stats.session_count}
          sub={stats.session_count === 1 ? "day" : "days"}
          testid="stat-sessions"
        />
        <Stat
          icon={<CalendarDays className="h-3 w-3" />}
          label="First opened"
          value={stats.first_opened_at ? formatDate(stats.first_opened_at) : "—"}
          testid="stat-first-opened"
        />
        <Stat
          icon={<History className="h-3 w-3" />}
          label="Last opened"
          value={stats.last_opened_at ? formatRelative(stats.last_opened_at) : "—"}
          testid="stat-last-opened"
        />
      </div>
      {/* Sparkline: last 30 days, binary active/inactive */}
      <div data-testid="reading-stats-sparkline">
        <p className="text-[10px] uppercase tracking-widest text-[#6B705C] mb-2">
          Last 30 days
        </p>
        <div className="flex items-end gap-[3px] h-8">
          {(stats.sparkline || []).map((d) => (
            <div
              key={d.date}
              title={`${d.date}${d.active ? " · read" : ""}`}
              className={`flex-1 rounded-sm ${
                d.active ? "bg-[#3A5A40] h-full" : "bg-[#F1EFE8] h-1.5 self-end"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
