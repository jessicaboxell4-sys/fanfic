import React, { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { ArrowLeft, Loader2, Download, Link as LinkIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import HelpHint from "../components/HelpHint";

export default function FilterUrlList() {
  const [text, setText] = useState("");
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const run = async () => {
    if (!text.trim()) {
      toast.error("Paste some URLs first");
      return;
    }
    setRunning(true);
    try {
      const { data } = await api.post("/books/url-list/dedupe", { text });
      setReport(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't process");
    } finally {
      setRunning(false);
    }
  };

  const exportXlsx = async () => {
    const urls = (report?.new_urls || []).map((u) => u.url);
    const owned = (report?.already_owned || []).map((m) => ({
      url: m.url,
      title: m.title,
      author: m.author,
      book_id: m.book_id,
    }));
    if (urls.length === 0 && owned.length === 0) {
      toast("Nothing to export");
      return;
    }
    setExporting(true);
    try {
      const resp = await api.post(
        "/books/url-list/export-xlsx",
        { urls, owned },
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shelfsort_url_list.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(
        `Exported ${urls.length} new + ${owned.length} already-owned URL${urls.length + owned.length === 1 ? "" : "s"}`,
      );
    } catch (e) {
      toast.error("Couldn't build Excel");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>
        <div className="flex items-start gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <LinkIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Filter a URL list</h1>
            <p className="text-[#6B705C] mt-1">
              Paste fanfic URLs (one per line). We&apos;ll split them into &quot;already in your library&quot; vs &quot;new&quot;, and the Excel export bundles both lists in one workbook. AO3 link variants (collections, chapter URLs, mobile <code>m.</code> host, <code>www.</code>, query strings) all dedupe to the same work.
            </p>
            <div className="mt-2">
              <HelpHint section="url-list" label="How does this work?" testId="filter-urls-help" />
            </div>
          </div>
        </div>

        <textarea
          data-testid="url-list-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://archiveofourown.org/works/12345&#10;https://www.fanfiction.net/s/67890/&#10;https://www.royalroad.com/fiction/111&#10;..."
          rows={10}
          className="w-full font-mono text-sm p-4 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#E07A5F]/60"
        />

        <div className="flex justify-end gap-3 mt-4">
          <button
            data-testid="url-list-run"
            onClick={run}
            disabled={running}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            Filter URLs
          </button>
        </div>

        {report && (
          <div className="mt-8 shelf-card p-6" data-testid="url-list-result">
            <p className="text-sm text-[#6B705C] mb-4">
              <strong className="text-[#2C2C2C]">{report.total}</strong> URLs found ·
              {" "}<span className="text-green-700">{report.already_owned.length} already in your library</span> ·
              {" "}<span className="text-amber-700">{report.new_urls.length} new</span>
              {report.duplicate_in_list?.length > 0 && <> · <span className="text-[#6B705C]">{report.duplicate_in_list.length} duplicate paste{report.duplicate_in_list.length === 1 ? "" : "s"}</span></>}
              {report.ao3_non_work?.length > 0 && <> · <span className="text-[#6B705C]">{report.ao3_non_work.length} AO3 non-story link{report.ao3_non_work.length === 1 ? "" : "s"}</span></>}
              {report.unrecognized.length > 0 && <> · <span className="text-[#6B705C]">{report.unrecognized.length} unrecognized</span></>}
            </p>

            {report.by_source && Object.keys(report.by_source).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="url-list-by-source">
                {Object.entries(report.by_source).map(([src, n]) => (
                  <span
                    key={src}
                    className="text-xs px-2.5 py-1 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C] border border-[#E5DDC5]"
                    data-testid={`source-chip-${src.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {src} · {n}
                  </span>
                ))}
              </div>
            )}

            {report.already_owned.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-[#6B705C] mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-700" /> Already on your shelves (removed from the export)
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto bg-white rounded-lg border border-[#E5DDC5] p-3">
                  {report.already_owned.map((m, idx) => (
                    <div key={idx} className="text-sm truncate">
                      <span className="font-medium">{m.title || "Untitled"}</span>
                      <span className="text-[#6B705C]"> — {m.author || "Unknown"}</span>
                      {m.fandom && <span className="text-[#6B705C]"> · {m.fandom}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.new_urls.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-amber-700 mb-2">New URLs</p>
                <div className="space-y-1 max-h-48 overflow-y-auto bg-amber-50/60 rounded-lg border border-amber-200 p-3">
                  {report.new_urls.map((u, idx) => (
                    <div key={idx} className="text-xs font-mono truncate">{u.url}</div>
                  ))}
                </div>
              </div>
            )}

            {report.ao3_non_work?.length > 0 && (
              <div className="mb-4" data-testid="ao3-non-work-block">
                <p className="text-xs uppercase tracking-wide text-[#6B705C] mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> AO3 links that aren&apos;t individual stories
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto bg-white rounded-lg border border-dashed border-[#6B705C]/30 p-3">
                  {report.ao3_non_work.map((item, idx) => (
                    <div key={idx} className="text-xs truncate flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5DDC5]/60 text-[#2C2C2C] uppercase tracking-wide">
                        {item.kind === "ao3_series" ? "series" : item.kind === "ao3_collection" ? "collection" : "user"}
                      </span>
                      <span className="text-[#6B705C] font-mono truncate">{item.url}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#6B705C] mt-1">These point to a series index, collection, or author page — open them in your browser and grab the individual work URLs to dedupe properly.</p>
              </div>
            )}

            {report.unrecognized.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-[#6B705C] mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Unrecognized
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto bg-white rounded-lg border border-dashed border-[#6B705C]/30 p-3">
                  {report.unrecognized.map((u, idx) => (
                    <div key={idx} className="text-xs text-[#6B705C] font-mono truncate">{u}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button
                data-testid="url-list-download"
                onClick={exportXlsx}
                disabled={exporting || (report.new_urls.length === 0 && report.already_owned.length === 0)}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download Excel ({report.new_urls.length} new · {report.already_owned.length} owned)
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
