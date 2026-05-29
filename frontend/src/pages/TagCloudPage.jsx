import React, { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { ArrowLeft, Tag as TagIcon, Search, Filter } from "lucide-react";
import { toast } from "sonner";

// Size buckets: 5 visual tiers based on percentile rank within the user's library
function sizeClass(count, max) {
  if (max <= 0) return "tag-size-1";
  const ratio = count / max;
  if (ratio >= 0.8) return "tag-size-5";
  if (ratio >= 0.5) return "tag-size-4";
  if (ratio >= 0.25) return "tag-size-3";
  if (ratio >= 0.1) return "tag-size-2";
  return "tag-size-1";
}

const SIZE_STYLES = {
  "tag-size-1": "text-xs px-2.5 py-1",
  "tag-size-2": "text-sm px-3 py-1.5",
  "tag-size-3": "text-base px-3.5 py-1.5 font-semibold",
  "tag-size-4": "text-lg px-4 py-2 font-semibold",
  "tag-size-5": "text-xl px-5 py-2.5 font-bold",
};

export default function TagCloudPage() {
  const navigate = useNavigate();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("count"); // count | alpha

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/tags");
        setTags(data.tags || []);
      } catch (e) {
        toast.error("Couldn't load tags");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const list = search.trim()
      ? tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
      : tags;
    if (sort === "alpha") {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...list].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tags, search, sort]);

  const max = useMemo(() => tags.reduce((m, t) => Math.max(m, t.count), 0), [tags]);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2 flex items-center gap-1.5">
              <TagIcon className="w-3 h-3" /> All tags
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]" data-testid="tag-cloud-title">
              Your library, by the tag.
            </h1>
            <p className="text-[#6B705C] mt-3">
              {loading
                ? "Counting…"
                : tags.length === 0
                  ? "No tags yet — open any book and add some, or upload more so the AI can suggest them."
                  : `${tags.length} distinct tag${tags.length === 1 ? "" : "s"} across your shelves.`}
            </p>
          </div>
          <Link
            to="/library/smart-shelves"
            data-testid="open-smart-shelves"
            className="btn-secondary text-sm inline-flex items-center gap-2"
          >
            <Filter className="w-4 h-4" /> Smart shelves
          </Link>
        </div>

        {tags.length > 0 && (
          <div className="flex items-center gap-3 mb-8 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
              <input
                type="text"
                data-testid="tag-search"
                placeholder="Search tags…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-[#6B705C] font-semibold">Sort</span>
              <select
                data-testid="tag-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm font-semibold"
              >
                <option value="count">Most used</option>
                <option value="alpha">A → Z</option>
              </select>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-12 text-center">
            <TagIcon className="w-10 h-10 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              {search ? "No tags match your search" : "No tags yet"}
            </h2>
            <p className="text-[#6B705C] mb-6 max-w-md mx-auto">
              {search
                ? "Try a different search term."
                : "Open any book and add a few tags — or let the AI classifier suggest them on upload."}
            </p>
            <Link to="/library" className="btn-primary text-sm inline-block">
              Go to library
            </Link>
          </div>
        ) : (
          <div className="shelf-card p-8" data-testid="tag-cloud">
            <div className="flex flex-wrap items-center gap-2.5">
              {filtered.map((t) => (
                <Link
                  key={t.name}
                  to={`/library/tag/${encodeURIComponent(t.name)}`}
                  data-testid={`tag-chip-${t.name}`}
                  className={`inline-flex items-center gap-1.5 rounded-full bg-[#FDF3E1] text-[#B87A00] hover:bg-[#B87A00] hover:text-white border border-[#B87A00]/20 transition-colors ${SIZE_STYLES[sizeClass(t.count, max)]}`}
                  title={`${t.count} book${t.count === 1 ? "" : "s"}`}
                >
                  <TagIcon className="w-3 h-3 flex-shrink-0" />
                  <span>{t.name}</span>
                  <span className="text-[10px] opacity-70 tabular-nums">{t.count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
