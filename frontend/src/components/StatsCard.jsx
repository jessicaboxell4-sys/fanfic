import React from "react";
import { BookCheck, Layers, Flame } from "lucide-react";

export default function StatsCard({ stats }) {
  if (!stats) return null;
  const tiles = [
    {
      icon: <BookCheck className="w-5 h-5" />,
      label: "Books finished",
      value: stats.books_finished ?? 0,
      tint: "text-[#3A5A40]",
      bg: "bg-[#E5EBE6]",
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
    <div
      className="grid grid-cols-3 gap-3 sm:gap-4 mb-8"
      data-testid="stats-card"
    >
      {tiles.map((t, i) => (
        <div
          key={i}
          className="shelf-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4"
        >
          <div className={`w-11 h-11 rounded-xl ${t.bg} ${t.tint} flex items-center justify-center flex-shrink-0`}>
            {t.icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-[#6B705C] font-semibold truncate">
              {t.label}
            </p>
            <p className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] tabular-nums leading-none mt-1">
              {t.value}
            </p>
            {t.hint && (
              <p className="text-[10px] text-[#6B705C] mt-0.5">{t.hint}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
