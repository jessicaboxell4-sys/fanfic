import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { Database, ChevronRight, Search, X as XIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * MongoInspectorCard — read-only Mongo browser for admins.
 *
 * Backed by two endpoints:
 *   GET /api/admin/db/collections                   — list + sizes
 *   GET /api/admin/db/collection/{name}?skip&limit&q — paginated docs
 *
 * UX:
 *   • Left rail: collections sorted by size, with doc-count badge
 *   • Right pane: page header (search, prev/next), table of docs
 *   • Each row: top-level fields summarised; click "Show JSON" to
 *     expand a pretty-printed view of the full (already-redacted) doc.
 *
 * The card mounts the collections manifest lazily on first open so a
 * collapsed Admin Console doesn't hit the API at all.
 */
const PAGE_SIZE = 20;

function fmtBytes(mb) {
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${Math.round(mb * 1024)} KB`;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function MongoInspectorCard() {
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(null); // { name, docs, total, skip, limit, q }
  const [loadingPage, setLoadingPage] = useState(false);
  const [skip, setSkip] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [expandedDoc, setExpandedDoc] = useState(null);

  const loadCollections = useCallback(async () => {
    setLoadingCollections(true);
    try {
      const { data } = await api.get("/admin/db/collections");
      setCollections(data.collections || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load collections");
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  const loadPage = useCallback(async (name, skipVal, q) => {
    setLoadingPage(true);
    setExpandedDoc(null);
    try {
      const { data } = await api.get(`/admin/db/collection/${encodeURIComponent(name)}`, {
        params: { skip: skipVal, limit: PAGE_SIZE, q: q || undefined },
      });
      setPage(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't load ${name}`);
      setPage(null);
    } finally {
      setLoadingPage(false);
    }
  }, []);

  const pickCollection = (name) => {
    setSelected(name);
    setSkip(0);
    setSearchInput("");
    setAppliedQuery("");
    loadPage(name, 0, "");
  };

  const applySearch = () => {
    if (!selected) return;
    const q = searchInput.trim();
    setAppliedQuery(q);
    setSkip(0);
    loadPage(selected, 0, q);
  };

  const clearSearch = () => {
    setSearchInput("");
    setAppliedQuery("");
    setSkip(0);
    if (selected) loadPage(selected, 0, "");
  };

  const gotoPage = (newSkip) => {
    if (!selected) return;
    setSkip(newSkip);
    loadPage(selected, newSkip, appliedQuery);
  };

  const totalPages = page ? Math.max(1, Math.ceil(page.total / PAGE_SIZE)) : 0;
  const currentPage = page ? Math.floor(skip / PAGE_SIZE) + 1 : 0;

  return (
    <div data-testid="admin-mongo-inspector-body">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left rail — collections list */}
        <div className="md:col-span-1 border border-[#E8E6E1] rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#F5F3EC] text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
            Collections ({collections.length})
          </div>
          <div className="max-h-[460px] overflow-y-auto" data-testid="admin-mongo-collections-list">
            {loadingCollections && (
              <div className="p-3 text-xs text-[#5B5F4D] flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> loading…
              </div>
            )}
            {!loadingCollections && collections.length === 0 && (
              <div className="p-3 text-xs text-[#5B5F4D]">No collections found.</div>
            )}
            {collections.map((c) => {
              const active = c.name === selected;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => pickCollection(c.name)}
                  data-testid={`admin-mongo-pick-${c.name}`}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-[#E8E6E1] last:border-b-0 transition-colors ${
                    active
                      ? "bg-[#6B46C1] text-white"
                      : "bg-white text-[#2C2C2C] hover:bg-[#EEE9FB]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium font-mono truncate">{c.name}</span>
                    <ChevronRight className={`w-3 h-3 flex-shrink-0 ${active ? "text-white" : "text-[#5B5F4D]"}`} />
                  </div>
                  <div className={`text-[11px] mt-0.5 ${active ? "text-white/80" : "text-[#5B5F4D]"}`}>
                    {c.doc_count.toLocaleString()} doc{c.doc_count === 1 ? "" : "s"} · {fmtBytes(c.size_mb)} · last {fmtRelative(c.last_doc_at)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right pane — selected collection */}
        <div className="md:col-span-2">
          {!selected && (
            <div className="border border-dashed border-[#E5DDC5] rounded-lg p-6 text-center text-sm text-[#5B5F4D]">
              <Database className="w-6 h-6 mx-auto mb-1.5 text-[#6B46C1]" aria-hidden="true" />
              Pick a collection on the left to browse its documents.
            </div>
          )}

          {selected && (
            <>
              {/* Search header */}
              <div className="mb-3 flex items-center gap-2 flex-wrap" data-testid="admin-mongo-search-row">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] pointer-events-none" aria-hidden="true" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                    placeholder="Search _id, email, name, user_id, or title…"
                    data-testid="admin-mongo-search-input"
                    className="w-full pl-9 pr-9 py-2 rounded-full border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] placeholder:text-[#9A9580] focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#EEE9FB]"
                  />
                  {searchInput && (
                    <button type="button" onClick={clearSearch} aria-label="Clear search" data-testid="admin-mongo-search-clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] hover:text-[#2C2C2C]">
                      <XIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={applySearch}
                  data-testid="admin-mongo-search-submit"
                  className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors"
                >
                  Search
                </button>
              </div>

              {/* Pagination header */}
              {page && (
                <div className="mb-2 flex items-center justify-between text-xs text-[#5B5F4D]" data-testid="admin-mongo-pagination">
                  <span>
                    {page.total === 0 ? "0 documents" : `${(skip + 1).toLocaleString()}–${Math.min(skip + PAGE_SIZE, page.total).toLocaleString()} of ${page.total.toLocaleString()}`}
                    {appliedQuery && <> · <span className="text-[#6B46C1] font-semibold">match "{appliedQuery}"</span></>}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={skip === 0 || loadingPage}
                      onClick={() => gotoPage(Math.max(0, skip - PAGE_SIZE))}
                      data-testid="admin-mongo-prev"
                      className="px-2 py-1 rounded border border-[#E5DDC5] text-xs font-semibold disabled:opacity-40 hover:bg-[#EEE9FB] hover:border-[#6B46C1] hover:text-[#6B46C1]"
                    >
                      ← Prev
                    </button>
                    <span data-testid="admin-mongo-pagination-label">page {currentPage} / {totalPages}</span>
                    <button
                      type="button"
                      disabled={skip + PAGE_SIZE >= page.total || loadingPage}
                      onClick={() => gotoPage(skip + PAGE_SIZE)}
                      data-testid="admin-mongo-next"
                      className="px-2 py-1 rounded border border-[#E5DDC5] text-xs font-semibold disabled:opacity-40 hover:bg-[#EEE9FB] hover:border-[#6B46C1] hover:text-[#6B46C1]"
                    >
                      Next →
                    </button>
                  </span>
                </div>
              )}

              {/* Documents table */}
              <div className="border border-[#E8E6E1] rounded-lg overflow-hidden">
                {loadingPage && (
                  <div className="p-3 text-xs text-[#5B5F4D] flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> loading…
                  </div>
                )}
                {!loadingPage && page && page.docs.length === 0 && (
                  <div className="p-6 text-center text-sm text-[#5B5F4D]" data-testid="admin-mongo-empty">
                    No documents match {appliedQuery ? `"${appliedQuery}"` : "this page"}.
                  </div>
                )}
                {!loadingPage && page && page.docs.map((doc, idx) => {
                  const docKey = doc._id || `idx-${skip + idx}`;
                  const isOpen = expandedDoc === docKey;
                  // Summary: pick the 3 most informative top-level fields.
                  const summary = ["email", "name", "title", "user_id", "type", "kind", "status", "created_at"]
                    .map((f) => doc[f] != null ? `${f}: ${String(doc[f]).slice(0, 80)}` : null)
                    .filter(Boolean)
                    .slice(0, 3);
                  return (
                    <div
                      key={docKey}
                      data-testid={`admin-mongo-row-${idx}`}
                      className="border-b border-[#E8E6E1] last:border-b-0 px-3 py-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[#6B46C1] truncate">_id: {doc._id || "—"}</div>
                          {summary.length > 0 && (
                            <div className="text-[#2C2C2C] mt-0.5 truncate" title={summary.join(" · ")}>
                              {summary.join(" · ")}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedDoc(isOpen ? null : docKey)}
                          data-testid={`admin-mongo-row-toggle-${idx}`}
                          className="text-[10px] uppercase tracking-[0.15em] font-bold text-[#6B46C1] hover:text-[#553397] flex-shrink-0"
                        >
                          {isOpen ? "Hide JSON" : "Show JSON"}
                        </button>
                      </div>
                      {isOpen && (
                        <pre
                          data-testid={`admin-mongo-row-json-${idx}`}
                          className="mt-2 p-2 rounded bg-[#FBFAFE] border border-[#E5DDC5] text-[10px] text-[#2C2C2C] overflow-x-auto max-h-72 overflow-y-auto"
                        >
                          {JSON.stringify(doc, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
