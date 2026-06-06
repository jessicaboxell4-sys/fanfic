import React, { useEffect, useRef, useState } from "react";
import { Download, Loader2, X, Filter as FilterIcon, Link as LinkIcon } from "lucide-react";
import { API, api } from "../lib/api";
import { toast } from "sonner";

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
  const [fandom, setFandom] = useState("");
  const [relationship, setRelationship] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const abortRef = useRef(null);

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

  // If user picks a fandom, narrow the pairings dropdown to that fandom.
  const pairingsForFandom = fandom
    ? relationships.filter((r) => (r.fandoms || []).includes(fandom))
    : relationships;

  const fmt = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const startDownload = async () => {
    if (downloading) return;
    setDownloading(true);

    const params = new URLSearchParams();
    if (fandom) params.set("fandom", fandom);
    if (relationship) params.set("relationship", relationship);
    if (author) params.set("author", author);
    if (category) params.set("category", category);
    const qs = params.toString();
    const filterLabel = [
      fandom && `fandom=${fandom}`,
      relationship && `pairing=${relationship}`,
      author && `author=${author}`,
      category && `cat=${category}`,
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
      const namePieces = [fandom, relationship, author, category].filter(Boolean).map((s) => s.replace(/\s+/g, "_"));
      a.download = `shelfsort_${namePieces.join("_") || "library"}.${KIND_COPY.ext}`;
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
  const activeFilterCount = [fandom, relationship, author, category].filter(Boolean).length;

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-[#FAF6EE] rounded-2xl shadow-2xl border border-[#E07A5F]/30 w-full max-w-lg flex flex-col">
            <div className="flex items-start gap-3 p-5 border-b border-[#E07A5F]/20">
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

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-[#3A5A40] mb-1">Fandom</label>
                <select
                  data-testid="zip-filter-fandom"
                  value={fandom}
                  onChange={(e) => { setFandom(e.target.value); setRelationship(""); }}
                  className="w-full p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm"
                >
                  <option value="">Any fandom</option>
                  {fandoms.map((f) => (
                    <option key={f.name} value={f.name}>{f.name} ({f.count})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-[#3A5A40] mb-1">
                  Pairing {fandom && <span className="text-[#6B705C] font-normal normal-case">— filtered to {fandom}</span>}
                </label>
                <select
                  data-testid="zip-filter-pairing"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm"
                >
                  <option value="">Any pairing</option>
                  {pairingsForFandom.map((r) => (
                    <option key={r.name} value={r.name}>{r.name} ({r.count})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-[#3A5A40] mb-1">Author</label>
                <select
                  data-testid="zip-filter-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm"
                >
                  <option value="">Any author</option>
                  {authors.map((a) => (
                    <option key={a.name} value={a.name}>{a.name} ({a.count})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-[#3A5A40] mb-1">Category</label>
                <select
                  data-testid="zip-filter-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm"
                >
                  <option value="">Any category</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-t border-[#E07A5F]/20 bg-white/40">
              <button
                data-testid="zip-filter-reset"
                onClick={() => { setFandom(""); setRelationship(""); setAuthor(""); setCategory(""); }}
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
