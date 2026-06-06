import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, X, Filter as FilterIcon, Link as LinkIcon, Search } from "lucide-react";
import { API, api } from "../lib/api";
import { toast } from "sonner";

// Scrollable checkbox list with a built-in search box. Used for each of
// the four filter dimensions (fandom / pairing / author / category) inside
// the download modal.
function CheckboxFilter({ label, testId, options, selected, onToggle }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => (o.name || "").toLowerCase().includes(needle));
  }, [q, options]);

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-bold uppercase tracking-wide text-[#3A5A40]">
          {label}
        </label>
        {selected.size > 0 && (
          <span className="text-[10px] text-[#6B705C]">{selected.size} picked</span>
        )}
      </div>
      <div className="relative mb-1">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#6B705C]" />
        <input
          type="text"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full pl-7 pr-2 py-1.5 rounded-md border border-[#E5DDC5] bg-white text-xs focus:outline-none focus:border-[#E07A5F]/60"
        />
      </div>
      <div className="rounded-lg border border-[#E5DDC5] bg-white max-h-64 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-xs text-[#6B705C] text-center">
            {options.length === 0 ? "Nothing here yet" : "No matches"}
          </div>
        )}
        {filtered.map((o) => {
          const isOn = selected.has(o.name);
          return (
            <label
              key={o.name}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-b border-[#E5DDC5]/40 last:border-b-0 ${isOn ? "bg-[#FDF3E1]" : "hover:bg-[#FDF3E1]/40"}`}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => onToggle(o.name)}
                className="accent-[#E07A5F]"
              />
              <span className="flex-1 truncate">{o.name}</span>
              <span className="text-xs text-[#6B705C] flex-shrink-0">{o.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// "Download ZIP" / "Download .xlsx" with filters. Lets the user pick a
// fandom, a pairing, an author, and/or a category before kicking off the
// streaming download. Live progress toast + Cancel button preserved.
//
// Props:
//   kind: "zip" (default) — downloads /books/export/zip
//         "xlsx"          — downloads /books/export/links?format=xlsx
export default function DownloadZipButton({ kind = "zip" }) {
  const isXlsx = kind === "xlsx";
  const KIND_COPY = isXlsx
    ? {
        btnLabel: "Library (.xlsx)",
        btnTitle: "Download an Excel workbook — optionally filter by fandom, pairing, author, or category",
        modalTitle: "Download Library Excel",
        modalSubtitle: 'One sheet per fandom. Leave everything as "Any" for your whole library, or narrow it down.',
        ctaFull: "Download full library (.xlsx)",
        ctaFiltered: "Download filtered (.xlsx)",
        verb: "Building",
        successVerb: "Built",
        endpoint: "/books/export/links",
        extraQuery: "format=xlsx",
        ext: "xlsx",
        Icon: LinkIcon,
      }
    : {
        btnLabel: "Download ZIP",
        btnTitle: "Download a ZIP — optionally filter by fandom, pairing, author, or category",
        modalTitle: "Download a ZIP",
        modalSubtitle: 'Leave everything as "Any" for your whole library, or narrow it down.',
        ctaFull: "Download full library ZIP",
        ctaFiltered: "Download filtered ZIP",
        verb: "Streaming",
        successVerb: "Downloaded",
        endpoint: "/books/export/zip",
        extraQuery: "",
        ext: "zip",
        Icon: Download,
      };

  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [relationships, setRelationships] = useState([]);
  const [authors, setAuthors] = useState([]);
  // Each filter is a Set of selected values — empty = no filter ("Any").
  const [fandom, setFandom] = useState(() => new Set());
  const [relationship, setRelationship] = useState(() => new Set());
  const [author, setAuthor] = useState(() => new Set());
  const [category, setCategory] = useState(() => new Set());
  const abortRef = useRef(null);

  const toggleIn = (setter) => (value) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  // Fetch filter options when the modal opens. Three lightweight calls in
  // parallel — overview gives counts, /relationships gives the pairing-→-
  // fandom map we use for filtering the pairing dropdown by fandom.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [ov, rel, au] = await Promise.all([
          api.get("/stats/overview"),
          api.get("/relationships"),
          api.get("/authors"),
        ]);
        if (cancelled) return;
        setOverview(ov.data || {});
        setRelationships(rel.data?.relationships || []);
        setAuthors(au.data?.authors || []);
      } catch {
        /* silent — selects will show "No data" */
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // If user picks one or more fandoms, narrow the pairings list to those.
  const pairingsForFandom = fandom.size > 0
    ? relationships.filter((r) => (r.fandoms || []).some((f) => fandom.has(f)))
    : relationships;

  const fmt = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const startDownload = async () => {
    if (downloading) return;
    setDownloading(true);

    // Build the query string by appending each selected value separately
    // (e.g. ?fandom=Harry+Potter&fandom=Twilight) — FastAPI's List[str] Query
    // collects all repeats into a list.
    const params = new URLSearchParams();
    fandom.forEach((v) => params.append("fandom", v));
    relationship.forEach((v) => params.append("relationship", v));
    author.forEach((v) => params.append("author", v));
    category.forEach((v) => params.append("category", v));
    const qs = params.toString();
    const labelFor = (label, set) => {
      if (set.size === 0) return null;
      if (set.size === 1) return `${label}=${[...set][0]}`;
      return `${label} (${set.size})`;
    };
    const filterLabel = [
      labelFor("fandom", fandom),
      labelFor("pairing", relationship),
      labelFor("author", author),
      labelFor("cat", category),
    ].filter(Boolean).join(" · ") || "full library";

    const toastId = `${kind}-${Date.now()}`;
    const startedAt = Date.now();
    let bytesReceived = 0;
    const controller = new AbortController();
    abortRef.current = controller;
    const cancel = () => {
      controller.abort();
      toast.dismiss(toastId);
    };
    const showProgress = () => {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      toast.loading(
        `${KIND_COPY.verb} ${filterLabel}… ${fmt(bytesReceived)} so far · ${elapsed}s`,
        { id: toastId, duration: 60000, action: { label: "Cancel", onClick: cancel } },
      );
    };

    try {
      setOpen(false);
      showProgress();
      const fullQs = [KIND_COPY.extraQuery, qs].filter(Boolean).join("&");
      const resp = await fetch(`${API}${KIND_COPY.endpoint}${fullQs ? `?${fullQs}` : ""}`, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!resp.ok) {
        if (resp.status === 404) throw new Error("No books match those filters");
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${text ? ` — ${text.slice(0, 120)}` : ""}`);
      }
      if (!resp.body) throw new Error("Streaming not supported in this browser");

      const reader = resp.body.getReader();
      const chunks = [];
      let lastTick = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesReceived += value.byteLength;
        const now = Date.now();
        if (now - lastTick > 300) {
          showProgress();
          lastTick = now;
        }
      }

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Derive a friendly filename from the active filters.
      const singleOrNull = (s) => (s.size === 1 ? [...s][0] : null);
      const fSingle = singleOrNull(fandom);
      const rSingle = singleOrNull(relationship);
      const aSingle = singleOrNull(author);
      const cSingle = singleOrNull(category);
      const totalPicked = fandom.size + relationship.size + author.size + category.size;
      let nameStem;
      if (totalPicked === 0) {
        nameStem = "library";
      } else if (fSingle && rSingle && (author.size + category.size) === 0) {
        nameStem = `${fSingle}_${rSingle}`.replace(/\s+/g, "_");
      } else if (fSingle && totalPicked === 1) {
        nameStem = fSingle.replace(/\s+/g, "_");
      } else if (rSingle && totalPicked === 1) {
        nameStem = rSingle.replace(/\s+/g, "_");
      } else if (aSingle && totalPicked === 1) {
        nameStem = aSingle.replace(/\s+/g, "_");
      } else if (cSingle && totalPicked === 1) {
        nameStem = cSingle.replace(/\s+/g, "_");
      } else {
        nameStem = "filtered";
      }
      a.download = `shelfsort_${nameStem}.${KIND_COPY.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      toast.success(
        `${KIND_COPY.successVerb} ${fmt(bytesReceived)} · ${Math.floor((Date.now() - startedAt) / 1000)}s`,
        { id: toastId },
      );
    } catch (e) {
      if (e.name === "AbortError" || controller.signal.aborted) {
        toast(
          `Download cancelled${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""}`,
          { id: toastId },
        );
      } else {
        toast.error(
          `Download failed${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""} — ${e.message || "try again"}`,
          { id: toastId },
        );
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
    }
  };

  const fandoms = (overview?.fandoms || []);
  const categories = (overview?.categories || []);
  const activeFilterCount = fandom.size + relationship.size + author.size + category.size;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={downloading}
        data-testid={isXlsx ? "navbar-download-links" : "navbar-download-zip"}
        className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
        title={KIND_COPY.btnTitle}
      >
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KIND_COPY.Icon className="w-4 h-4" />}
        <span className="hidden md:inline">{downloading ? `${KIND_COPY.verb}…` : KIND_COPY.btnLabel}</span>
      </button>

      {open && (
        <div
          data-testid={isXlsx ? "xlsx-filter-modal" : "zip-filter-modal"}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[6vh] overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-[#FAF6EE] rounded-2xl shadow-2xl border border-[#E07A5F]/30 w-full max-w-3xl max-h-[min(720px,90vh)] flex flex-col">
            <div className="flex items-start gap-3 p-5 border-b border-[#E07A5F]/20 flex-shrink-0">
              <div className="w-10 h-10 rounded-lg bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
                <FilterIcon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">{KIND_COPY.modalTitle}</h2>
                <p className="text-sm text-[#6B705C] mt-1">{KIND_COPY.modalSubtitle}</p>
              </div>
              <button
                data-testid="zip-filter-close"
                onClick={() => setOpen(false)}
                className="text-[#6B705C] hover:text-[#2C2C2C] p-1 rounded"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto flex-1">
              <CheckboxFilter
                label="Fandom"
                testId="zip-filter-fandom"
                options={fandoms}
                selected={fandom}
                onToggle={(v) => {
                  toggleIn(setFandom)(v);
                  // Clear pairings — they may no longer fit the new fandom set.
                  setRelationship(new Set());
                }}
              />
              <CheckboxFilter
                label={
                  <>
                    Pairing
                    {fandom.size > 0 && (
                      <span className="text-[#6B705C] font-normal normal-case ml-1">
                        — filtered to {fandom.size === 1 ? [...fandom][0] : `${fandom.size} fandoms`}
                      </span>
                    )}
                  </>
                }
                testId="zip-filter-pairing"
                options={pairingsForFandom}
                selected={relationship}
                onToggle={toggleIn(setRelationship)}
              />
              <CheckboxFilter
                label="Author"
                testId="zip-filter-author"
                options={authors}
                selected={author}
                onToggle={toggleIn(setAuthor)}
              />
              <CheckboxFilter
                label="Category"
                testId="zip-filter-category"
                options={categories}
                selected={category}
                onToggle={toggleIn(setCategory)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-t border-[#E07A5F]/20 bg-white/40 flex-shrink-0">
              <button
                data-testid="zip-filter-reset"
                onClick={() => { setFandom(new Set()); setRelationship(new Set()); setAuthor(new Set()); setCategory(new Set()); }}
                disabled={activeFilterCount === 0}
                className="text-xs text-[#6B705C] hover:text-[#2C2C2C] disabled:opacity-40"
              >
                Reset filters
              </button>
              <div className="flex gap-3 ml-auto">
                <button
                  data-testid="zip-filter-cancel"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-[#6B705C] hover:text-[#2C2C2C]"
                >
                  Cancel
                </button>
                <button
                  data-testid="zip-filter-start"
                  onClick={startDownload}
                  disabled={downloading}
                  className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
                >
                  <KIND_COPY.Icon className="w-4 h-4" />
                  {activeFilterCount > 0 ? KIND_COPY.ctaFiltered : KIND_COPY.ctaFull}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
