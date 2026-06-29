import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import Breadcrumb from "../components/Breadcrumb";
import { ArrowLeft, ArrowLeftRight, Download, Link as LinkIcon, Search, BookOpen, Users, X } from "lucide-react";
import { toast } from "sonner";

export default function FandomShelf() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fandom = decodeURIComponent(params.fandom || "");
  const character = (searchParams.get("character") || "").trim();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [related, setRelated] = useState([]);
  const [topCharacters, setTopCharacters] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/books", {
        params: {
          category: "Fanfiction",
          fandom,
          ...(search ? { q: search } : {}),
          ...(character ? { character } : {}),
        },
      });
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  }, [fandom, search, character]);

  useEffect(() => { load(); }, [load]);

  // Reverse-index: pull every crossover containing this single fandom so we
  // can surface them at the bottom. Only meaningful when the page itself is
  // a single fandom (not already a crossover).
  useEffect(() => {
    const xPieces = (fandom || "").split(" / ").map((p) => p.trim()).filter(Boolean);
    if (xPieces.length >= 2) { setRelated([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/fandoms/${encodeURIComponent(fandom)}/crossovers`);
        if (!cancelled) setRelated(data?.crossovers || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [fandom]);

  // Top characters within this fandom shelf — derived from each book's
  // relationships field at read-time (see /api/library/characters).
  // Surfaced as a chip rail at the top of the books grid so the user
  // can jump straight to a per-character shelf without leaving the
  // fandom context.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/characters", {
          params: { fandom, limit: 8 },
        });
        if (!cancelled) setTopCharacters(data?.characters || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [fandom]);

  const downloadAsFile = async (path, fallbackName) => {
    try {
      const resp = await api.get(path, { responseType: "blob" });
      const ct = (resp.headers["content-type"] || resp.headers["Content-Type"] || "").toLowerCase();
      if (ct.includes("application/json")) {
        const text = await resp.data.text();
        try {
          const j = JSON.parse(text);
          toast.error(j.detail || "Download failed");
        } catch { toast.error("Download failed"); }
        return;
      }
      let name = fallbackName;
      const disp = resp.headers["content-disposition"] || resp.headers["Content-Disposition"];
      if (disp) {
        const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
        if (m && m[1]) name = decodeURIComponent(m[1]);
      }
      const url = window.URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      if (e.response && e.response.data) {
        try {
          const text = await e.response.data.text();
          const j = JSON.parse(text);
          toast.error(j.detail || "Download failed");
          return;
        } catch { /* fall through */ }
      }
      toast.error("Download failed");
    }
  };

  const exportZip = () => {
    const params = new URLSearchParams({ category: "Fanfiction", fandom });
    downloadAsFile(`/books/export/zip?${params}`, `shelfsort_${fandom}.zip`);
  };

  const exportLinks = () => {
    const params = new URLSearchParams({ category: "Fanfiction", fandom, format: "zip" });
    downloadAsFile(`/books/export/links?${params}`, `shelfsort_${fandom}_links.zip`);
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>
        <Breadcrumb
          testId="fandom-breadcrumb"
          items={[
            { label: "Library", to: "/library" },
            character
              ? { label: fandom, to: `/library/fandom/${encodeURIComponent(fandom)}` }
              : { label: fandom },
            ...(character ? [{ label: `${character} books` }] : []),
          ]}
        />

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Fanfiction · Fandom shelf
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05]" data-testid="fandom-title">
              {fandom}
            </h1>
            {(() => {
              // If this is a crossover shelf (canonical form "A / B [/ C]"),
              // surface each constituent fandom as a sub-chip so the user
              // can jump to that single-fandom view.
              const xPieces = (fandom || "").split(" / ").map((p) => p.trim()).filter(Boolean);
              if (xPieces.length < 2) return null;
              return (
                <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="crossover-constituents">
                  <span className="text-xs uppercase tracking-wide text-[#6B46C1] font-bold">Crossover · drill into one:</span>
                  {xPieces.map((p) => (
                    <button
                      key={p}
                      onClick={() => navigate(`/library/fandom/${encodeURIComponent(p)}`)}
                      data-testid={`constituent-${p.replace(/\s+/g, "-").toLowerCase()}`}
                      className="px-3 py-1 rounded-full text-xs font-semibold border bg-[#FDF3E1] text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              );
            })()}
            <p className="text-[#5B5F4D] mt-3" data-testid="fandom-books-count">
              {loading
                ? "Loading shelf…"
                : character
                  ? `${books.length} ${fandom} book${books.length === 1 ? "" : "s"} featuring ${character}`
                  : `${books.length} book${books.length === 1 ? "" : "s"} on this shelf`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="fandom-export-links"
              onClick={exportLinks}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <LinkIcon className="w-4 h-4" />
              {fandom} links (.txt)
            </button>
            <button
              data-testid="fandom-export-zip"
              onClick={exportZip}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download {fandom} ZIP
            </button>
          </div>
        </div>

        <div className="relative mb-8 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
          <input
            data-testid="fandom-search"
            type="text"
            placeholder={`Search within ${fandom}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
          />
        </div>

        {topCharacters.length > 0 && (
          <section className="mb-8" data-testid="fandom-top-characters">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              Top characters in {fandom}
            </p>
            <div className="flex flex-wrap gap-2">
              {topCharacters.map((c) => {
                const isActive = c.name.toLowerCase() === character.toLowerCase();
                return (
                  <button
                    key={c.name}
                    onClick={() => {
                      // Drill DOWN inside the current fandom shelf instead
                      // of jumping to the global by-character view. Click
                      // again on the active chip to clear the filter.
                      const next = new URLSearchParams(searchParams);
                      if (isActive) {
                        next.delete("character");
                      } else {
                        next.set("character", c.name);
                      }
                      setSearchParams(next, { replace: false });
                    }}
                    data-testid={`fandom-top-character-${c.name.replace(/\s+/g, "-").toLowerCase()}`}
                    aria-pressed={isActive}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border inline-flex items-center gap-2 transition-colors ${
                      isActive
                        ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                        : "bg-[#FDF3E1] text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white"
                    }`}
                    title={
                      isActive
                        ? `Showing only ${c.name} books in ${fandom} — click to clear`
                        : `${c.count} book${c.count === 1 ? "" : "s"} in ${fandom} feature ${c.name}`
                    }
                  >
                    <span>{c.name}</span>
                    <span className="text-[10px] opacity-70">· {c.count}</span>
                    {isActive && <X className="w-3 h-3" aria-hidden="true" />}
                  </button>
                );
              })}
              <Link
                to="/library/characters"
                data-testid="fandom-top-characters-see-all"
                className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-transparent text-[#5B5F4D] border-[#E5DDC5] hover:bg-[#F5F3EC] hover:text-[#2C2C2C] transition-colors inline-flex items-center gap-1"
                title="Browse every character across your whole library"
              >
                See all →
              </Link>
            </div>
            {character && (
              <p
                className="text-xs text-[#5B5F4D] italic mt-2"
                data-testid="fandom-character-filter-status"
              >
                Filtered to books featuring <span className="font-semibold text-[#2C2C2C]">{character}</span>
                {" — "}
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("character");
                    setSearchParams(next, { replace: false });
                  }}
                  data-testid="fandom-character-filter-clear"
                  className="underline underline-offset-2 hover:text-[#6B46C1]"
                >
                  clear filter
                </button>
              </p>
            )}
          </section>
        )}

        {loading ? (
          <p className="text-[#5B5F4D] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              No {fandom} books yet
            </h2>
            <p className="text-[#5B5F4D] mb-6">
              Upload an EPUB and we&apos;ll route any {fandom} fanfic onto this shelf automatically.
            </p>
            <Link to="/library" className="btn-primary text-sm inline-block">
              Go upload
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="fandom-books-grid">
            {books.map((b) => (
              <BookCard key={b.book_id} book={b} onChanged={load} />
            ))}
          </div>
        )}

        {/* Reverse-index: crossovers that include this fandom */}
        {related.length > 0 && (
          <section className="mt-12" data-testid="fandom-related-crossovers">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
              Also appears in {related.length} crossover{related.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-2">
              {related.map((r) => (
                <button
                  key={r.name}
                  onClick={() => navigate(`/library/fandom/${encodeURIComponent(r.name)}`)}
                  data-testid={`related-crossover-${r.name.replace(/\s+/g, "-").toLowerCase()}`}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#FDF3E1] text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white transition-colors inline-flex items-center gap-2"
                  title={`${r.count} book${r.count === 1 ? "" : "s"} · ${(r.parts || []).join(" + ")}`}
                >
                  <span className="inline-flex items-center justify-center gap-0.5 min-w-[26px] h-[18px] px-1.5 rounded-full bg-[#6B46C1] text-white text-[10px] font-bold leading-none">
                    <ArrowLeftRight className="w-2.5 h-2.5" aria-hidden="true" />
                    {(r.parts || []).length}
                  </span>
                  <span>{r.name}</span>
                  <span className="text-[10px] opacity-70">· {r.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
