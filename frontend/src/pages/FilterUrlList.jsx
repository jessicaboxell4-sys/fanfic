import React, { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { ArrowLeft, Loader2, Download, Link as LinkIcon, CheckCircle2, AlertCircle, FileText, Upload, BookOpen, DownloadCloud } from "lucide-react";
import { toast } from "sonner";
import HelpHint from "../components/HelpHint";
import UploadZone from "../components/UploadZone";

export default function FilterUrlList() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullReport, setPullReport] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState([]);
  const fileInputRef = useRef(null);

  const ingestFiles = async (filesList) => {
    const files = Array.from(filesList || []).filter((f) => {
      const name = (f.name || "").toLowerCase();
      const okType = !f.type || f.type.startsWith("text/") || f.type === "application/octet-stream";
      const okExt = name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md") || name.endsWith(".log") || !name.includes(".");
      return okType || okExt;
    });
    if (files.length === 0) {
      toast.error("Drop .txt (or other plain-text) files");
      return;
    }
    try {
      const contents = await Promise.all(files.map((f) => f.text()));
      const blob = contents.join("\n").trim();
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${blob}` : blob));
      setLoadedFiles((prev) => [...prev, ...files.map((f) => ({ name: f.name, size: f.size }))]);
      toast.success(`Loaded ${files.length} file${files.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Couldn't read file");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    ingestFiles(e.dataTransfer.files);
  };

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

  const pullIntoLibrary = async () => {
    const urls = (report?.new_urls || []).map((u) => u.canonical || u.url);
    if (urls.length === 0) {
      toast("No new URLs to pull — everything is either already owned or unrecognized.");
      return;
    }
    setPulling(true);
    setPullReport(null);
    toast.info(
      `Fetching ${urls.length} URL${urls.length === 1 ? "" : "s"} one at a time — hang tight…`,
      { duration: 4000 },
    );
    try {
      const resp = await api.post(
        "/books/url-list/pull",
        { urls },
        { timeout: 0 },  // long-running; no client-side timeout
      );
      setPullReport(resp.data);
      const added = resp.data.added?.length || 0;
      const failed = resp.data.failed?.length || 0;
      if (added > 0) {
        toast.success(
          `Pulled ${added} new book${added === 1 ? "" : "s"} into your library${failed ? ` (${failed} failed)` : ""}.`,
          { duration: 8000 },
        );
      } else if (failed > 0) {
        toast.error(`Couldn't fetch any of the ${failed} URLs. See details below.`);
      } else {
        toast("Nothing to add.");
      }
    } catch (e) {
      toast.error("Pull failed — " + (e.response?.data?.detail || e.message || "unknown error"));
    } finally {
      setPulling(false);
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
    const duplicates = (report?.duplicate_in_list || []).map((d) => ({
      url: d.url,
      canonical: d.canonical,
    }));
    if (urls.length === 0 && owned.length === 0 && duplicates.length === 0) {
      toast("Nothing to export");
      return;
    }
    setExporting(true);
    try {
      const resp = await api.post(
        "/books/url-list/export-xlsx",
        { urls, owned, duplicates },
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
      const parts = [];
      if (urls.length) parts.push(`${urls.length} new`);
      if (owned.length) parts.push(`${owned.length} owned`);
      if (duplicates.length) parts.push(`${duplicates.length} duplicate paste${duplicates.length === 1 ? "" : "s"}`);
      toast.success(`Exported ${parts.join(" + ")}`);
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

        <div
          data-testid="url-list-dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-4 border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${dragging ? "border-[#E07A5F] bg-[#E07A5F]/5" : "border-[#E5DDC5] bg-white hover:border-[#E07A5F]/50"}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.csv,.md,.log,text/plain"
            onChange={(e) => { ingestFiles(e.target.files); e.target.value = ""; }}
            className="hidden"
            data-testid="url-list-file-input"
          />
          <div className="flex flex-col items-center gap-1 text-[#6B705C]">
            <Upload className="w-6 h-6 text-[#E07A5F]" />
            <p className="text-sm">
              <span className="font-medium text-[#2C2C2C]">Drop a .txt file</span> with URLs (one per line) or click to browse
            </p>
            <p className="text-xs">…or just paste them into the box below.</p>
          </div>
          {loadedFiles.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2" data-testid="url-list-loaded-files">
              {loadedFiles.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="text-xs px-2 py-1 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C] border border-[#E5DDC5] inline-flex items-center gap-1"
                >
                  <FileText className="w-3 h-3" />
                  {f.name}
                </span>
              ))}
            </div>
          )}
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

        {/* — visually separated EPUB upload zone — */}
        <div className="mt-10 pt-8 border-t border-dashed border-[#E5DDC5]" data-testid="epub-upload-section">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#3A5A40]/10 text-[#3A5A40] flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">Have the EPUBs already? Drop them in.</h2>
              <p className="text-sm text-[#6B705C] mt-1">
                Skip the URL-by-URL check — drag whole folders of <code>.epub</code> files here and Shelfsort sorts them by fandom / category automatically. Other formats (PDF / Mobi / Word) are accepted too and land on the Originals shelf for conversion.
              </p>
            </div>
          </div>
          <UploadZone
            onUploaded={(dupes, actions, urlLists) => {
              const total = (actions?.length || 0) + (dupes?.length || 0);
              if (total === 0) return;
              const parts = [];
              if (actions?.length) parts.push(`${actions.length} sorted`);
              if (dupes?.length) parts.push(`${dupes.length} duplicate${dupes.length === 1 ? "" : "s"} flagged`);
              toast.success(
                `Uploaded ${total} book${total === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}`,
                {
                  action: {
                    label: "Open library",
                    onClick: () => navigate("/library"),
                  },
                  duration: 6000,
                },
              );
              if (urlLists && urlLists.length > 0) {
                toast.message(
                  `Found ${urlLists.length} embedded URL list${urlLists.length === 1 ? "" : "s"} in the EPUBs — review them on the library page.`,
                );
              }
            }}
          />
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

            {report.ao3_mirrors && Object.keys(report.ao3_mirrors).length > 0 && (
              <div
                className="mb-4 p-3 rounded-lg bg-[#FDF4E5] border border-[#E5C97A]/60 text-sm text-[#7A5C00]"
                data-testid="ao3-mirror-banner"
              >
                <p className="font-medium">
                  Heads up — you pasted from {Object.values(report.ao3_mirrors).reduce((a, b) => a + b, 0)} AO3
                  mirror URL{Object.values(report.ao3_mirrors).reduce((a, b) => a + b, 0) === 1 ? "" : "s"}.
                </p>
                <p className="mt-1 text-xs text-[#8A6800]">
                  {Object.entries(report.ao3_mirrors)
                    .map(([host, n]) => `${host}${n > 1 ? ` (×${n})` : ""}`)
                    .join(" · ")}
                  {" — these all point to the same archive. They've been deduped to the canonical "}
                  <code className="text-[11px] bg-white/60 px-1 py-0.5 rounded">archiveofourown.org</code>
                  {" form."}
                </p>
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

            <div className="flex justify-end gap-2 mt-4 flex-wrap">
              <button
                data-testid="url-list-pull"
                onClick={pullIntoLibrary}
                disabled={pulling || report.new_urls.length === 0}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-[#3A5A40] text-white hover:bg-[#2f4933] disabled:opacity-60 inline-flex items-center gap-2"
                title={report.new_urls.length === 0 ? "Nothing new to pull — all URLs are already owned or unrecognized." : "Fetch every new URL into your library, one at a time"}
              >
                {pulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
                Pull {report.new_urls.length} new {report.new_urls.length === 1 ? "URL" : "URLs"} into library
              </button>
              <button
                data-testid="url-list-download"
                onClick={exportXlsx}
                disabled={exporting || (report.new_urls.length === 0 && report.already_owned.length === 0 && (report.duplicate_in_list?.length || 0) === 0)}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download Excel ({report.new_urls.length} new · {report.already_owned.length} owned{report.duplicate_in_list?.length ? ` · ${report.duplicate_in_list.length} dup` : ""})
              </button>
            </div>

            {pullReport && (
              <div className="mt-4 p-4 rounded-lg bg-[#E5EBE6] border border-[#3A5A40]/20" data-testid="pull-result">
                <p className="font-medium text-[#3A5A40] mb-2">
                  Pull complete · <strong>{pullReport.added?.length || 0}</strong> added
                  {pullReport.failed?.length ? <> · <span className="text-amber-700">{pullReport.failed.length} failed</span></> : null}
                </p>
                {pullReport.added?.length > 0 && (
                  <div className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                    {pullReport.added.map((b, idx) => (
                      <div key={idx} className="text-[#2C2C2C] truncate">
                        ✓ <span className="font-medium">{b.title}</span>{b.fandom ? <span className="text-[#6B705C]"> · {b.fandom}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
                {pullReport.failed?.length > 0 && (
                  <div className="text-xs space-y-0.5 max-h-24 overflow-y-auto mt-2">
                    {pullReport.failed.map((b, idx) => (
                      <div key={idx} className="text-amber-800 truncate">
                        ✗ <span className="font-mono">{b.canonical}</span> — {b.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
