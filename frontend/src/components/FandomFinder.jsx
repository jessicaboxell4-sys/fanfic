import React from "react";
import { Search, X as XIcon } from "lucide-react";

/**
 * FandomFinder — section-search box for the Library "Fandom shelves" rail.
 * Renders an input with leading magnifier + trailing clear, and a row of
 * top-5-by-count "Try:" suggestion chips so users with sprawling fandom
 * collections don't have to scroll a thousand chips to find what they want.
 *
 * Filtering and the empty-state are owned by the parent (AllBooksPage) —
 * this component is purely the search input + helper chips.
 */
export default function FandomFinder({ fandoms, query, onChange }) {
  const q = (query || "").trim().toLowerCase();
  const visibleCount = q
    ? fandoms.filter((f) => (f.name || "").toLowerCase().includes(q)).length
    : fandoms.length;
  // Top 5 by count make the most useful one-click suggestions for a real
  // reader's library (Harry Potter, Marvel, MHA, etc. usually dominate).
  const suggestions = [...fandoms]
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 5)
    .map((f) => f.name)
    .filter(Boolean);

  return (
    <div className="mb-4" data-testid="fandom-finder">
      <div className="relative">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Find a fandom shelf… (e.g. harry, marvel, star wars)"
          data-testid="fandom-finder-input"
          className="w-full pl-9 pr-9 py-2 rounded-full border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] placeholder:text-[#9A9580] focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#EEE9FB] transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear fandom search"
            data-testid="fandom-finder-clear"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] hover:text-[#2C2C2C]"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-[#5B5F4D]">
        <span className="italic">Try:</span>
        {suggestions.map((name) => {
          const active = q === name.toLowerCase();
          const slug = name.replace(/\s+/g, "-").toLowerCase();
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              data-testid={`fandom-finder-suggest-${slug}`}
              className={`px-2 py-0.5 rounded-full border text-xs font-semibold transition-colors ${
                active
                  ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                  : "bg-[#FBFAF6] text-[#6B46C1] border-[#E5DDC5] hover:bg-[#EEE9FB] hover:border-[#6B46C1]"
              }`}
            >
              {name}
            </button>
          );
        })}
        {q && (
          <span
            className="ml-auto text-[11px] uppercase tracking-[0.15em] font-bold text-[#6B46C1]"
            data-testid="fandom-finder-count"
          >
            {visibleCount} of {fandoms.length} fandoms
          </span>
        )}
      </div>
    </div>
  );
}
