import React, { useState } from "react";
import { X, Loader2, Link as LinkIcon, CheckCircle2, Download, AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * Modal shown when a user uploads a .txt that's actually a fanfic-URL wishlist.
 * The server has already deduped the URLs against the library; we just display
 * the result and let the user download an Excel of the net-new entries.
 *
 * Props:
 *   - reports: Array<{filename, total, already_owned[], new_urls[], unrecognized[]}>
 *   - onClose: () => void
 */
export default function UrlListDedupeModal({ reports, onClose }) {
  const [exporting, setExporting] = useState(false);

  if (!reports || reports.length === 0) return null;

  // We support multiple .txt files in one upload, but in practice it's almost
  // always one. Flatten for the summary banner.
  const totalUrls = reports.reduce((acc, r) => acc + (r.total || 0), 0);
  const totalOwned = reports.reduce((acc, r) => acc + (r.already_owned?.length || 0), 0);
  const totalNew = reports.reduce((acc, r) => acc + (r.new_urls?.length || 0), 0);
  const totalUnrec = reports.reduce((acc, r) => acc + (r.unrecognized?.length || 0), 0);

  const allNewUrls = reports.flatMap((r) => (r.new_urls || []).map((u) => u.url));

  const exportNew = async () => {
    if (allNewUrls.length === 0) {
      toast("Nothing new to export");
      return;
    }
    setExporting(true);
    try {
      const resp = await api.post("/books/url-list/export-xlsx", { urls: allNewUrls }, { responseType: "blob" });
      const url = window.URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shelfsort_new_urls.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Exported ${allNewUrls.length} new URL${allNewUrls.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Couldn't build Excel");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      data-testid="url-list-dedupe-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#FAF6EE] rounded-2xl shadow-2xl border border-[#E07A5F]/30 w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-start gap-3 p-6 border-b border-[#E07A5F]/20">
          <div className="w-10 h-10 rounded-lg bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <LinkIcon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">
              {reports.length === 1 ? "URL wishlist deduped" : `${reports.length} URL files deduped`}
            </h2>
            <p className="text-sm text-[#5B5F4D] mt-1">
              <strong>{totalUrls}</strong> URL{totalUrls === 1 ? "" : "s"} ·
              {" "}<span className="text-green-700">{totalOwned} already on your shelves</span> ·
              {" "}<span className="text-amber-700">{totalNew} new</span>
              {totalUnrec > 0 && <> · <span className="text-[#5B5F4D]">{totalUnrec} unrecognized</span></>}
            </p>
          </div>
          <button
            data-testid="url-list-close"
            onClick={onClose}
            className="text-[#5B5F4D] hover:text-[#2C2C2C] p-1 rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {reports.map((r, i) => (
            <div key={r.filename || `report-${i}`}>
              {reports.length > 1 && (
                <p className="text-xs uppercase tracking-wide text-[#5B5F4D] mb-3">
                  From <span className="font-mono">{r.filename || "(unnamed)"}</span>
                </p>
              )}
              {r.already_owned?.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wide text-[#5B5F4D] mb-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-700" />
                    Already in your library — removed from the export
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto bg-white rounded-lg border border-[#E5DDC5] p-3">
                    {r.already_owned.map((m, idx) => (
                      <div key={m.book_id || m.source_url || `${m.title}-${m.author}-${idx}`} className="text-sm text-[#2C2C2C] truncate">
                        <span className="font-medium">{m.title || "Untitled"}</span>
                        <span className="text-[#5B5F4D]"> — {m.author || "Unknown"}</span>
                        {m.fandom && <span className="text-[#5B5F4D]"> · {m.fandom}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {r.new_urls?.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wide text-amber-700 mb-2">
                    New URLs (these you don't have yet)
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto bg-amber-50/60 rounded-lg border border-amber-200 p-3">
                    {r.new_urls.map((u, idx) => (
                      <div key={u.url || `new-url-${idx}`} className="text-xs text-[#2C2C2C] font-mono truncate">
                        {u.url}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {r.unrecognized?.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#5B5F4D] mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Unrecognized — not a supported fanfic source
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto bg-white rounded-lg border border-dashed border-[#6B705C]/30 p-3">
                    {r.unrecognized.map((u, idx) => (
                      <div key={`${u}-${idx}`} className="text-xs text-[#5B5F4D] font-mono truncate">{u}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-[#E07A5F]/20 bg-white/40">
          <button
            data-testid="url-list-dismiss"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[#5B5F4D] hover:text-[#2C2C2C]"
          >
            Close
          </button>
          <button
            data-testid="url-list-export"
            onClick={exportNew}
            disabled={exporting || allNewUrls.length === 0}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download Excel of {allNewUrls.length} new URL{allNewUrls.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
