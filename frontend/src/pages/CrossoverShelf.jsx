import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Search, Filter } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Crossover-only browser. Lists every fandom whose canonical form has 2+
// parts (e.g. "Harry Potter / Twilight") and lets the user drill into one
// or pick a single constituent fandom to filter the list down.
export default function CrossoverShelf() {
  const navigate = useNavigate();
  const [fandoms, setFandoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/fandoms");
        if (!cancelled) {
          setFandoms((data?.fandoms || []).filter((f) => f.is_crossover));
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // All distinct constituent fandoms — feed the "include this fandom" filter.
  const allMembers = useMemo(() => {
    const s = new Set();
    fandoms.forEach((f) => (f.parts || []).forEach((p) => s.add(p)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [fandoms]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return fandoms.filter((f) => {
      if (memberFilter && !(f.parts || []).some((p) => p.toLowerCase() === memberFilter.toLowerCase())) return false;
      if (needle && !(f.name || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [fandoms, filter, memberFilter]);

  const totalBooks = filtered.reduce((s, f) => s + (f.count || 0), 0);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="crossover-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
            Fanfiction · Crossover shelf
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05]" data-testid="crossover-title">
            All crossovers
          </h1>
          <p className="text-[#6B705C] mt-2">
            {loading
              ? "Loading…"
              : `${filtered.length} crossover${filtered.length === 1 ? "" : "s"} · ${totalBooks} book${totalBooks === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search crossovers by name…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:outline-none focus:border-[#6B46C1]"
              data-testid="crossover-search"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#6B705C]" />
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm"
              data-testid="crossover-member-filter"
            >
              <option value="">Any fandom included</option>
              {allMembers.map((m) => (
                <option key={m} value={m}>includes {m}</option>
              ))}
            </select>
          </div>
        </div>

        {!loading && filtered.length === 0 && (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            {fandoms.length === 0
              ? "No crossovers in your library yet — add a fanfic tagged with multiple fandoms (e.g. \"Harry Potter & Twilight\") to start one."
              : "No crossovers match those filters."}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((f) => (
            <button
              key={f.name}
              onClick={() => navigate(`/library/fandom/${encodeURIComponent(f.name)}`)}
              data-testid={`open-crossover-${f.name.replace(/\s+/g, "-").toLowerCase()}`}
              className="shelf-card p-4 text-left hover:shadow-md transition border-[#6B46C1]/20 hover:border-[#6B46C1]"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold leading-none">
                  ×{(f.parts || []).length}
                </span>
                <span className="text-xs text-[#6B705C] flex-shrink-0">{f.count} book{f.count === 1 ? "" : "s"}</span>
              </div>
              <div className="text-sm font-semibold text-[#2C2C2C] mb-2 truncate">{f.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {(f.parts || []).map((p) => (
                  <span
                    key={p}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FDF3E1] text-[#6B46C1] border border-[#6B46C1]/20"
                  >
                    {p}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-end mt-3 text-xs text-[#6B46C1]">
                Open shelf <ArrowRight className="w-3 h-3 ml-1" />
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
