import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { Download, Loader2, ArrowLeft, Filter as FilterIcon, Link as LinkIcon, Search } from "lucide-react";
import { API, api } from "../lib/api";
import { toast } from "sonner";
import Navbar from "../components/Navbar";

// AO3-themed scrollbar styles — slim maroon track, dense look. Scoped to the
// .ao3-scrollbar selector so it doesn't leak into the rest of the app.
const AO3_SCROLLBAR_CSS = `
.ao3-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
.ao3-scrollbar::-webkit-scrollbar-track { background: #fffaf0; border-left: 1px solid #d0c8b0; }
.ao3-scrollbar::-webkit-scrollbar-thumb { background: #900; border: 2px solid #fffaf0; border-radius: 0; }
.ao3-scrollbar::-webkit-scrollbar-thumb:hover { background: #700; }
.ao3-scrollbar { scrollbar-color: #900 #fffaf0; scrollbar-width: thin; }
`;

function CheckboxFilter({ label, testId, options, selected, onToggle, onBulkSet }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => (o.name || "").toLowerCase().includes(needle));
  }, [q, options]);

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
    >
      <legend className="px-2 mx-2 text-sm font-bold text-[#900] uppercase tracking-wide">
        {label}
        {selected.size > 0 && (
          <span className="ml-2 text-xs font-normal text-[#666] normal-case tracking-normal">
            ({selected.size} picked)
          </span>
        )}
      </legend>
      <div className="px-2 pb-2 pt-1">
        <div className="relative mb-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#666]" />
          <input
            type="text"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-7 pr-2 py-1 border border-[#999] bg-white text-sm focus:outline-none focus:border-[#900]"
          />
          {filtered.length > 1 && onBulkSet && (
            <button
              type="button"
              onClick={handleBulk}
              className="mt-1 text-xs text-[#2a6496] hover:text-[#900] underline"
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
        <div className="border border-[#ccc] bg-white max-h-[55vh] overflow-y-auto ao3-scrollbar">
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-sm text-[#666] text-center italic">
              {options.length === 0 ? "Nothing here yet" : "No matches"}
            </div>
          )}
          {filtered.map((o) => {
            const isOn = selected.has(o.name);
            return (
              <label
                key={o.name}
                className={`flex items-center gap-2 px-2 py-1 text-sm cursor-pointer border-b border-[#eee] last:border-b-0 ${isOn ? "bg-[#fdf5dc]" : "hover:bg-[#fcf8e8]"}`}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => onToggle(o.name)}
                  className="accent-[#900]"
                />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-xs text-[#666] flex-shrink-0">({o.count})</span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

// Full-page Download experience — replaces the previous modal. The page is
// reached via /library/download (zip) or /library/download?kind=xlsx.
// Keeps streaming progress toast + Cancel-mid-download behavior.
export default function DownloadPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const kind = params.get("kind") === "xlsx" ? "xlsx" : "zip";
  const isXlsx = kind === "xlsx";

  const KIND_COPY = isXlsx
    ? {
        title: "Download Library Excel",
        subtitle: 'One sheet per fandom. Leave everything as "Any" for your whole library, or narrow it down.',
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
        title: "Download a ZIP",
        subtitle: 'Leave everything as "Any" for your whole library, or narrow it down.',
        ctaFull: "Download full library ZIP",
        ctaFiltered: "Download filtered ZIP",
        verb: "Streaming",
        successVerb: "Downloaded",
        endpoint: "/books/export/zip",
        extraQuery: "",
        ext: "zip",
        Icon: Download,
      };

  const [downloading, setDownloading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [relationships, setRelationships] = useState([]);
  const [authors, setAuthors] = useState([]);
  const [fandomsAll, setFandomsAll] = useState([]);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ov, rel, au, fd] = await Promise.all([
          api.get("/stats/overview"),
          api.get("/relationships"),
          api.get("/authors"),
          api.get("/fandoms"),
        ]);
        if (cancelled) return;
        setOverview(ov.data || {});
        setRelationships(rel.data?.relationships || []);
        setAuthors(au.data?.authors || []);
        setFandomsAll(fd.data?.fandoms || []);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

    const qsParams = new URLSearchParams();
    fandom.forEach((v) => qsParams.append("fandom", v));
    relationship.forEach((v) => qsParams.append("relationship", v));
    author.forEach((v) => qsParams.append("author", v));
    category.forEach((v) => qsParams.append("category", v));
    const qs = qsParams.toString();
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
    const cancel = () => { controller.abort(); toast.dismiss(toastId); };
    const showProgress = () => {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      toast.loading(
        `${KIND_COPY.verb} ${filterLabel}… ${fmt(bytesReceived)} so far · ${elapsed}s`,
        { id: toastId, duration: 60000, action: { label: "Cancel", onClick: cancel } },
      );
    };

    try {
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
        if (now - lastTick > 300) { showProgress(); lastTick = now; }
      }

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const singleOrNull = (s) => (s.size === 1 ? [...s][0] : null);
      const fSingle = singleOrNull(fandom);
      const rSingle = singleOrNull(relationship);
      const aSingle = singleOrNull(author);
      const cSingle = singleOrNull(category);
      const totalPicked = fandom.size + relationship.size + author.size + category.size;
      let nameStem;
      if (totalPicked === 0) nameStem = "library";
      else if (fSingle && rSingle && (author.size + category.size) === 0) nameStem = `${fSingle}_${rSingle}`.replace(/\s+/g, "_");
      else if (fSingle && totalPicked === 1) nameStem = fSingle.replace(/\s+/g, "_");
      else if (rSingle && totalPicked === 1) nameStem = rSingle.replace(/\s+/g, "_");
      else if (aSingle && totalPicked === 1) nameStem = aSingle.replace(/\s+/g, "_");
      else if (cSingle && totalPicked === 1) nameStem = cSingle.replace(/\s+/g, "_");
      else nameStem = "filtered";
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
        toast(`Download cancelled${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""}`, { id: toastId });
      } else {
        toast.error(`Download failed${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""} — ${e.message || "try again"}`, { id: toastId });
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
    }
  };

  const fandoms = fandomsAll;
  const categories = (overview?.categories || []);
  const activeFilterCount = fandom.size + relationship.size + author.size + category.size;

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <style>{AO3_SCROLLBAR_CSS}</style>
      <Navbar />
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"
        style={{ fontFamily: "'Lucida Grande', Tahoma, Verdana, Arial, sans-serif" }}
      >
        <Link
          to="/library"
          data-testid="download-back"
          className="inline-flex items-center gap-1.5 text-sm text-[#2a6496] hover:text-[#900] mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to library
        </Link>

        {/* AO3-style header band */}
        <div
          data-testid={isXlsx ? "xlsx-download-page" : "zip-download-page"}
          className="border-2 border-[#900] bg-white"
        >
          <div className="flex items-center gap-3 px-5 py-3 bg-[#900] text-white">
            <FilterIcon className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
              <h1 className="text-lg font-bold leading-tight uppercase tracking-wide">{KIND_COPY.title}</h1>
              <p className="text-xs text-white/85 mt-0.5 normal-case font-normal">{KIND_COPY.subtitle}</p>
            </div>
          </div>

          {/* Filter sections in a roomy 2x2 grid */}
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 bg-[#fffaf0]">
            <CheckboxFilter
              label="Fandom"
              testId="zip-filter-fandom"
              options={fandoms}
              selected={fandom}
              onToggle={(v) => { toggleIn(setFandom)(v); setRelationship(new Set()); }}
              onBulkSet={(next) => { setFandom(next); setRelationship(new Set()); }}
            />
            <CheckboxFilter
              label={
                <>
                  Pairing
                  {fandom.size > 0 && (
                    <span className="text-[#666] font-normal normal-case ml-1">
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

          {/* Active filter chips — quick at-a-glance summary, one click to remove */}
          {activeFilterCount > 0 && (
            <div
              data-testid="active-filter-chips"
              className="px-5 py-3 bg-[#fffaf0] border-t border-[#900]/30 flex flex-wrap items-center gap-2"
            >
              <span className="text-xs font-bold uppercase tracking-wide text-[#900]">Active:</span>
              {[
                { setName: "Fandom", set: fandom, setSetter: setFandom, extra: () => setRelationship(new Set()) },
                { setName: "Pairing", set: relationship, setSetter: setRelationship },
                { setName: "Author", set: author, setSetter: setAuthor },
                { setName: "Category", set: category, setSetter: setCategory },
              ].map(({ setName, set, setSetter, extra }) => (
                [...set].map((val) => (
                  <button
                    key={`${setName}-${val}`}
                    onClick={() => {
                      const next = new Set(set);
                      next.delete(val);
                      setSetter(next);
                      if (extra) extra();
                    }}
                    data-testid={`chip-${setName.toLowerCase()}-${val}`}
                    title={`Remove ${setName.toLowerCase()} filter`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-[#fdf5dc] border border-[#900] text-[#900] hover:bg-[#900] hover:text-white"
                  >
                    <span className="font-semibold uppercase">{setName}:</span>
                    <span>{val}</span>
                    <span className="ml-1 text-base leading-none">×</span>
                  </button>
                ))
              ))}
            </div>
          )}

          {/* Footer with reset / cancel / download */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t-2 border-[#900] bg-[#f5ecd5]">
            <button
              data-testid="zip-filter-reset"
              onClick={() => { setFandom(new Set()); setRelationship(new Set()); setAuthor(new Set()); setCategory(new Set()); }}
              disabled={activeFilterCount === 0}
              className="text-sm text-[#2a6496] hover:text-[#900] underline disabled:opacity-40 disabled:no-underline"
            >
              Reset filters
            </button>
            <div className="flex gap-2 ml-auto">
              <button
                data-testid="zip-filter-cancel"
                onClick={() => navigate("/library")}
                className="px-4 py-1.5 text-sm border border-[#999] bg-[#eee] text-[#333] hover:bg-[#ddd]"
              >
                Cancel
              </button>
              <button
                data-testid="zip-filter-start"
                onClick={startDownload}
                disabled={downloading}
                className="px-5 py-1.5 text-sm font-bold bg-[#900] text-white border border-[#600] hover:bg-[#700] disabled:opacity-60 inline-flex items-center gap-2 uppercase tracking-wide"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KIND_COPY.Icon className="w-4 h-4" />}
                {downloading ? `${KIND_COPY.verb}…` : activeFilterCount > 0 ? KIND_COPY.ctaFiltered : KIND_COPY.ctaFull}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
