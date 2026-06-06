import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, X, Filter as FilterIcon, Link as LinkIcon, Search } from "lucide-react";
import { API, api } from "../lib/api";
import { toast } from "sonner";

// Scrollable checkbox list with a built-in search box. Used for each of
// the four filter dimensions (fandom / pairing / author / category) inside
// the download modal.
function CheckboxFilter({ label, testId, options, selected, onToggle, onBulkSet }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => (o.name || "").toLowerCase().includes(needle));
  }, [q, options]);

  // Bulk-toggle the visible (filtered) rows. If everything visible is
  // already picked, this DEselects; otherwise it selects all visible.
  const allVisiblePicked = filtered.length > 0 && filtered.every((o) => selected.has(o.name));
  const handleBulk = () => {
    if (!onBulkSet) return;
    const next = new Set(selected);
    if (allVisiblePicked) {
      filtered.forEach((o) => next.delete(o.name));
    } else {
      filtered.forEach((o) => next.add(o.name));
    }
    onBulkSet(next);
  };

  return (
    <fieldset
      data-testid={testId}
      className="border border-[#900] bg-white"
      style={{ fontFamily: "'Lucida Grande', Tahoma, Verdana, Arial, sans-serif" }}
    >
      <legend className="px-2 mx-2 text-xs font-bold text-[#900] uppercase tracking-wide">
        {label}
        {selected.size > 0 && (
          <span className="ml-2 text-[10px] font-normal text-[#666] normal-case tracking-normal">
            ({selected.size} picked)
          </span>
        )}
      </legend>
      <div className="px-2 pb-2 pt-1">
        <div className="relative mb-1">
          <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-[#666]" />
          <input
            type="text"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-6 pr-1.5 py-1 border border-[#999] bg-white text-xs focus:outline-none focus:border-[#900]"
          />
          {filtered.length > 1 && onBulkSet && (
            <button
              type="button"
              onClick={handleBulk}
              className="mt-1 text-[10px] text-[#2a6496] hover:text-[#900] underline"
              data-testid={`${testId}-select-all`}
            >
              {allVisiblePicked
                ? `Deselect all ${filtered.length}`
                : q
                ? `Select all ${filtered.length} matching`
                : `Select all ${filtered.length}`}
            </button>
          )}
        </div>
        <div className="border border-[#ccc] bg-white max-h-[42vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-xs text-[#666] text-center italic">
              {options.length === 0 ? "Nothing here yet" : "No matches"}
            </div>
          )}
          {filtered.map((o) => {
            const isOn = selected.has(o.name);
            return (
              <label
                key={o.name}
                className={`flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer border-b border-[#eee] last:border-b-0 ${isOn ? "bg-[#fdf5dc]" : "hover:bg-[#fcf8e8]"}`}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => onToggle(o.name)}
                  className="accent-[#900]"
                />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-[10px] text-[#666] flex-shrink-0">({o.count})</span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
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
          <div className="bg-[#fffaf0] shadow-2xl border-2 border-[#900] w-full max-w-6xl max-h-[90vh] flex flex-col" style={{ fontFamily: "'Lucida Grande', Tahoma, Verdana, Arial, sans-serif" }}>
            <div className="flex items-center gap-3 px-5 py-3 bg-[#900] text-white flex-shrink-0">
              <FilterIcon className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-base font-bold leading-tight uppercase tracking-wide">{KIND_COPY.modalTitle}</h2>
                <p className="text-xs text-white/85 mt-0.5 normal-case font-normal">{KIND_COPY.modalSubtitle}</p>
              </div>
              <button
                data-testid="zip-filter-close"
                onClick={() => setOpen(false)}
                className="text-white/85 hover:text-white p-1"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto flex-1 bg-[#fffaf0]">
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
                onBulkSet={(next) => { setFandom(next); setRelationship(new Set()); }}
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
                onBulkSet={setRelationship}
              />
              <CheckboxFilter
                label="Author"
                testId="zip-filter-author"
                options={authors}
                selected={author}
                onToggle={toggleIn(setAuthor)}
                onBulkSet={setAuthor}
              />
              <CheckboxFilter
                label="Category"
                testId="zip-filter-category"
                options={categories}
                selected={category}
                onToggle={toggleIn(setCategory)}
                onBulkSet={setCategory}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t-2 border-[#900] bg-[#f5ecd5] flex-shrink-0">
              <button
                data-testid="zip-filter-reset"
                onClick={() => { setFandom(new Set()); setRelationship(new Set()); setAuthor(new Set()); setCategory(new Set()); }}
                disabled={activeFilterCount === 0}
                className="text-xs text-[#2a6496] hover:text-[#900] underline disabled:opacity-40 disabled:no-underline"
              >
                Reset filters
              </button>
              <div className="flex gap-2 ml-auto">
                <button
                  data-testid="zip-filter-cancel"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1 text-xs border border-[#999] bg-[#eee] text-[#333] hover:bg-[#ddd]"
                >
                  Cancel
                </button>
                <button
                  data-testid="zip-filter-start"
                  onClick={startDownload}
                  disabled={downloading}
                  className="px-4 py-1 text-xs font-bold bg-[#900] text-white border border-[#600] hover:bg-[#700] disabled:opacity-60 inline-flex items-center gap-2 uppercase tracking-wide"
                >
                  <KIND_COPY.Icon className="w-3.5 h-3.5" />
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
