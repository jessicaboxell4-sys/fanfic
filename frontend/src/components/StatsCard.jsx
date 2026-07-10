import React from "react";
import { Link } from "react-router-dom";
import { BookCheck, Layers, Flame, BarChart3 } from "lucide-react";

export default function StatsCard({ stats, viewMoreTo }) {
  if (!stats) return null;
  const tiles = [
    {
      icon: <BookCheck className="w-5 h-5" />,
      label: "Books finished",
      value: stats.books_finished ?? 0,
      tint: "text-[#6B46C1]",
      bg: "bg-[#EDE7FB]",
    },
    {
      icon: <Layers className="w-5 h-5" />,
      label: "Pages read",
      value: (stats.pages_read ?? 0).toLocaleString(),
      tint: "text-[#E07A5F]",
      bg: "bg-[#FDF3E1]",
    },
    {
      icon: <Flame className="w-5 h-5" />,
      label: stats.reading_streak_days === 1 ? "Day streak" : "Day streak",
      value: stats.reading_streak_days ?? 0,
      tint: "text-[#B87A00]",
      bg: "bg-[#FDF3E1]",
      hint: stats.reading_streak_days > 1 ? "🔥 keep it going" : undefined,
    },
  ];

  return (
    <div className="mb-8" data-testid="stats-card-wrap">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4" data-testid="stats-card">
        {tiles.map((t, i) => (
          <div
            key={i}
            className="shelf-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4"
          >
            <div className={`w-11 h-11 rounded-xl ${t.bg} ${t.tint} flex items-center justify-center flex-shrink-0`}>
              {t.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-[#5B5F4D] font-semibold truncate">
                {t.label}
              </p>
              <p className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] tabular-nums leading-none mt-1">
                {t.value}
              </p>
              {t.hint && (
                <p className="text-[10px] text-[#5B5F4D] mt-0.5">{t.hint}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {viewMoreTo && (
        <div className="flex justify-end mt-2">
          <Link
            to={viewMoreTo}
            data-testid="view-detailed-stats"
            className="text-xs text-[#6B46C1] hover:text-[#2C2C2C] inline-flex items-center gap-1 font-semibold tracking-wide uppercase"
          >
            <BarChart3 className="w-3 h-3" />
            View detailed stats
          </Link>
        </div>
      )}
    </div>
  );
}
