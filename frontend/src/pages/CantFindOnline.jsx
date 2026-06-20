import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import PoweredByFanFicFare from "../components/PoweredByFanFicFare";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";
import { api, API } from "../lib/api";
import { ArrowLeft, ExternalLink, RefreshCw, Edit3, Download, Loader2, Book, AlertTriangle, CheckCircle2, RotateCw, Upload } from "lucide-react";
import { toast } from "sonner";

function suggestSearchUrl(sourceUrl, title, author) {
  const q = encodeURIComponent(`${title || ""} ${author || ""}`.trim());
  if (!q) return null;
  const host = (sourceUrl || "").toLowerCase();
  if (host.includes("archiveofourown.org")) {
    return { label: "Search AO3", url: `https://archiveofourown.org/works/search?work_search%5Bquery%5D=${q}` };
  }
  if (host.includes("fanfiction.net")) {
    return { label: "Search FFnet", url: `https://www.fanfiction.net/search/?keywords=${q}&type=story` };
  }
  if (host.includes("fictionpress.com")) {
    return { label: "Search FictionPress", url: `https://www.fictionpress.com/search/?keywords=${q}&type=story` };
  }
  if (host.includes("royalroad.com")) {
    return { label: "Search Royal Road", url: `https://www.royalroad.com/fictions/search?title=${q}` };
  }
  if (host.includes("spacebattles.com") || host.includes("sufficientvelocity.com") || host.includes("questionablequesting.com")) {
    const m = host.match(/^https?:\/\/([^/]+)/);
    const site = m ? m[1] : "";
    return { label: "Search Google", url: `https://www.google.com/search?q=site%3A${site}+${q}` };
  }
  return { label: "Search Google", url: `https://www.google.com/search?q=${q}` };
}

export default function CantFindOnline() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editUrl, setEditUrl] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [autoTriedIds, setAutoTriedIds] = useState(new Set());
  const [status, setStatus] = useState(null); // {ok, detail, checked_at, cached}
  const [statusLoading, setStatusLoading] = useState(false);
  const [retryAllBusy, setRetryAllBusy] = useState(false);

  const probeStatus = async (force = false) => {
    setStatusLoading(true);
    try {
      const { data } = await api.get("/fanfic/status", { params: force ? { force: true } : {} });
      setStatus(data);
    } catch (e) {
      setStatus({ ok: false, detail: "Couldn't reach the status check", checked_at: null });
    } finally {
      setStatusLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/books", { params: { smart: "unavailable" } });
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { probeStatus(false); }, []);

  const retryAll = async () => {
    if (!window.confirm(`Retry fetching all ${books.length} unavailable book(s)? This may take a minute or two.`)) return;
    setRetryAllBusy(true);
    try {
      const { data } = await api.post("/books/retry-unavailable");
      if (data.refreshed > 0) {
        toast.success(`${data.refreshed} book${data.refreshed === 1 ? "" : "s"} refreshed!`);
      }
      if (data.still_unavailable > 0) {
        toast.warning(`${data.still_unavailable} book${data.still_unavailable === 1 ? "" : "s"} still unavailable — the source may still be down.`);
      }
      if (data.refreshed === 0 && data.still_unavailable === 0 && data.attempted === 0) {
        toast.info("Nothing to retry.");
      }
      probeStatus(true);
      await load();
    } catch (e) {
      toast.error("Couldn't retry");
    } finally {
      setRetryAllBusy(false);
    }
  };


  const replaceEpub = async (bid, file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      toast.error("Please choose an .epub file");
      return;
    }
    setBusyId(bid);
    const t = toast.loading("Saving as a new version…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/books/${bid}/upload-new-version`, fd, {
        timeout: 300000,
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Saved in ${data.updated_shelf || "Updated stories"}`, { id: t });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't upload", { id: t });
    } finally {
      setBusyId(null);
    }
  };


  const retry = async (bid, opts = {}) => {
    const { silent = false } = opts;
    // If we've already auto-tried once for this book, ask for confirmation
    if (!silent && autoTriedIds.has(bid)) {
      if (!window.confirm("We already tried this once. Try again?")) return;
    }
    setBusyId(bid);
    const t = toast.loading("Pulling latest…");
    try {
      const { data } = await api.post(`/books/${bid}/refresh`, {}, { timeout: 300000 });
      toast.success(`Updated to "${data.title}"`, { id: t });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Still can't find it", { id: t });
    } finally {
      setBusyId(null);
      // Mark that this book has had at least one retry this session
      setAutoTriedIds((prev) => {
        const next = new Set(prev);
        next.add(bid);
        return next;
      });
    }
  };

  const saveUrl = async (bid) => {
    try {
      await api.patch(`/books/${bid}/source-url`, { source_url: editUrl.trim() });
      toast.success("Source URL updated. Click Retry to try again.");
      setEditingId(null);
      setEditUrl("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    }
  };

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

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B705C] mb-2">
              🔎 Lost &amp; found
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05]" data-testid="page-title">
              Lost & found
            </h1>
            <p className="text-[#6B705C] mt-3 max-w-xl">
              We couldn't find these online. Try a same-site search to see if the work moved,
              then paste the new URL to bring it back into your refresh queue.
            </p>
            <div className="mt-4">
              {FETCHING_UI_ENABLED && <PoweredByFanFicFare />}
            </div>
          </div>
          {books.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                data-testid="retry-all-btn"
                onClick={retryAll}
                disabled={retryAllBusy}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60"
                title="Clear the unavailable flag on every book and re-attempt fetching"
              >
                {retryAllBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                Retry all ({books.length})
              </button>
              <button
                data-testid="download-list-btn"
                onClick={() => window.open(`${API}/books/export/unavailable`, "_blank")}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download list (.txt)
              </button>
            </div>
          )}
        </div>

        {/* Source-fetch status banner */}
        {status && (
          <div
            data-testid="fanfic-status-banner"
            className={`mb-6 rounded-2xl border p-4 flex items-start gap-3 ${
              status.ok
                ? "bg-[#EDE7FB] border-[#6B46C1]/30 text-[#2C2C2C]"
                : "bg-[#FFF1ED] border-[#E07A5F]/40 text-[#2C2C2C]"
            }`}
          >
            {status.ok ? (
              <CheckCircle2 className="w-5 h-5 text-[#6B46C1] flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-[#E07A5F] flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {status.ok ? "Source fetcher is responding normally" : "Source fetcher is having trouble right now"}
              </p>
              <p className="text-xs text-[#6B705C] mt-0.5" data-testid="fanfic-status-detail">
                {status.detail}
                {status.checked_at && (
                  <span className="ml-1">
                    · checked {new Date(status.checked_at).toLocaleTimeString()}
                    {status.cached && " (cached)"}
                  </span>
                )}
              </p>
              {!status.ok && (
                <p className="text-xs text-[#6B705C] mt-1.5">
                  Your library is safe — books are flagged so we don't keep retrying. Once the source fetcher is back, "Retry all" will sweep them back into sync.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => probeStatus(true)}
              disabled={statusLoading}
              data-testid="recheck-status-btn"
              className="text-xs text-[#6B705C] hover:text-[#2C2C2C] inline-flex items-center gap-1 font-semibold disabled:opacity-60"
            >
              {statusLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-check
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <Book className="w-12 h-12 text-[#6B46C1] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">Nothing's lost</h2>
            <p className="text-[#6B705C]">Every refreshable book in your library is reachable online.</p>
          </div>
        ) : (
          <ul className="space-y-4" data-testid="lost-list">
            {books.map((b) => {
              const cover = b.has_cover
                ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/cover`
                : null;
              const search = suggestSearchUrl(b.source_url, b.title, b.author);
              const isEditing = editingId === b.book_id;
              return (
                <li key={b.book_id} className="shelf-card p-4 flex gap-4" data-testid={`lost-row-${b.book_id}`}>
                  <Link to={`/book/${b.book_id}`} className="flex-shrink-0 w-20 sm:w-24">
                    <div className="aspect-[2/3] rounded-lg overflow-hidden bg-[#F5F3EC]">
                      {cover ? (
                        <img src={cover} alt={b.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="book-spine w-full h-full">
                          <Book className="w-6 h-6 opacity-80" />
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/book/${b.book_id}`} className="font-serif text-xl text-[#2C2C2C] hover:text-[#E07A5F] line-clamp-2 leading-tight">
                      {b.title}
                    </Link>
                    <p className="text-sm text-[#6B705C] mt-0.5">{b.author}</p>
                    {b.source_url && (
                      <a
                        href={b.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`source-link-${b.book_id}`}
                        className="text-xs text-[#E07A5F] hover:underline mt-2 break-all line-clamp-1 inline-flex items-center gap-1"
                        title="Open in a new browser tab"
                      >
                        {b.source_url}
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    )}
                    {b.last_fetch_error && (
                      <p
                        className={`text-xs mt-1 ${
                          /\b403\b/.test(b.last_fetch_error)
                            ? "text-[#B87A00]"
                            : "text-[#D9534F]"
                        }`}
                        data-testid={`error-${b.book_id}`}
                      >
                        {/\b403\b/.test(b.last_fetch_error) ? "⚠ " : ""}
                        Source said: {b.last_fetch_error}
                      </p>
                    )}

                    {isEditing ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveUrl(b.book_id); }}
                        className="mt-3 flex flex-col sm:flex-row gap-2"
                      >
                        <input
                          autoFocus
                          data-testid={`fix-input-${b.book_id}`}
                          type="url"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="https://archiveofourown.org/works/…"
                          className="flex-1 bg-white border border-[#E8E6E1] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                        />
                        <button type="submit" data-testid={`fix-save-${b.book_id}`} className="btn-primary text-sm py-1.5">Save</button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditUrl(""); }}
                          className="text-[#6B705C] hover:text-[#2C2C2C] text-sm px-2"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {b.source_url && (
                          <a
                            data-testid={`open-source-${b.book_id}`}
                            href={b.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                            title="Try opening this URL directly in your browser"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Try in browser
                          </a>
                        )}
                        {search && (
                          <a
                            data-testid={`search-${b.book_id}`}
                            href={search.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {search.label}
                          </a>
                        )}
                        <button
                          data-testid={`fix-${b.book_id}`}
                          onClick={() => { setEditingId(b.book_id); setEditUrl(b.source_url || ""); }}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Fix URL
                        </button>
                        <button
                          data-testid={`retry-${b.book_id}`}
                          onClick={() => retry(b.book_id)}
                          disabled={busyId === b.book_id}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 disabled:opacity-50"
                        >
                          {busyId === b.book_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Retry
                        </button>
                        <label
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 cursor-pointer"
                          data-testid={`upload-new-${b.book_id}`}
                          title="Upload a fresh EPUB as a new version. The old copy moves to 'Old stories'."
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload new version
                          <input
                            type="file"
                            accept=".epub,application/epub+zip"
                            className="hidden"
                            disabled={busyId === b.book_id}
                            data-testid={`upload-new-input-${b.book_id}`}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) replaceEpub(b.book_id, f);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
