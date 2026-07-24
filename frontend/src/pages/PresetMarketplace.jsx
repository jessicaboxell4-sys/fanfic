/**
 * Preset Marketplace — browse, upvote, one-click install user-shared
 * column-layout presets.  Extended 2026-08-19 with search, sort
 * toggle (newest / most upvoted / mine), and inline comments.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Trash2, Layers3, Sparkles, ArrowLeft, Search, MessageSquare, X } from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const REORDERABLE_COL_KEYS = ["fandom", "pairings", "wordcount", "size", "status", "added"];
const COL_LABELS = {
  fandom: "Fandom", pairings: "Pairings", wordcount: "Time·Words",
  size: "Size", status: "Status", added: "Added",
};

const SORT_OPTIONS = [
  { key: "upvotes", label: "Most upvoted" },
  { key: "newest",  label: "Newest" },
  { key: "mine",    label: "Mine" },
];

function CommentThread({ presetId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/presets/marketplace/${presetId}/comments`);
      setComments(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load comments");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [presetId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const { data } = await api.post(`/presets/marketplace/${presetId}/comments`, { body });
      setComments((prev) => [data, ...prev]);
      setDraft("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't post");
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (commentId) => {
    try {
      await api.delete(`/presets/marketplace/${presetId}/comments/${commentId}`);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#E4D9C8]" data-testid={`preset-market-comments-${presetId}`}>
      <div className="flex items-start gap-2 mb-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={500}
          placeholder="Leave a tip or note for other readers…"
          className="flex-1 min-w-0 px-2 py-1 text-xs border border-[#E4D9C8] rounded resize-none focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/40"
          data-testid={`preset-market-comment-input-${presetId}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || sending}
          className="px-3 py-1 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#4C2A99] disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-start"
          data-testid={`preset-market-comment-submit-${presetId}`}
        >
          {sending ? "…" : "Post"}
        </button>
      </div>
      {loading ? (
        <p className="text-[11px] text-[#6E6E6E] italic">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-[#6E6E6E] italic" data-testid={`preset-market-comments-empty-${presetId}`}>
          No comments yet — be the first.
        </p>
      ) : (
        <ul className="space-y-2 max-h-40 overflow-auto pr-1">
          {comments.map((c) => (
            <li key={c.id} className="text-xs" data-testid={`preset-market-comment-${c.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-[#6E6E6E]">
                    <span className="font-semibold text-[#4C2A99]">{c.author_name}</span>
                  </p>
                  <p className="text-[#2C2C2C] break-words">{c.body}</p>
                </div>
                {c.can_delete && (
                  <button
                    type="button"
                    onClick={() => removeComment(c.id)}
                    className="p-0.5 rounded text-[#A03D33] hover:bg-[#F5EAE9]"
                    aria-label="Delete this comment"
                    data-testid={`preset-market-comment-delete-${c.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PresetPreviewThumbnail({ preset }) {
  // Renders a tiny visual preview of the column layout so users can
  // eyeball what they'll get before installing.  Each visible column
  // shows as a labeled slice in left-to-right order (matching how the
  // real list view will render).
  const p = preset || {};
  const visibleOrdered = (p.order || []).filter((k) => p.visible?.[k]);
  return (
    <div
      className="mt-2 rounded border border-[#E4D9C8] bg-[#FBFAF6] p-1 overflow-hidden"
      data-testid="preset-preview-thumb"
      aria-hidden
    >
      <div className="flex items-stretch gap-0.5 text-[8px] font-mono text-[#5B5F4D]"> {/* fontsize-ok — micro thumbnail preview of a column layout, intentional 8px */}
        <div className="w-2 shrink-0 bg-[#EEE9FB] rounded-sm text-center text-[#4C2A99]" title="Row #">#</div>
        <div className="flex-1 min-w-0 bg-[#FDFBF3] rounded-sm px-1 truncate text-[#2C2C2C]">Title · Author</div>
        {visibleOrdered.map((k) => (
          <div
            key={k}
            className="shrink-0 px-1 bg-[#F5F0E5] rounded-sm text-center border border-[#EFE7D3]"
            style={{ minWidth: 18 }}
            data-testid={`preset-preview-col-${k}`}
          >
            {COL_LABELS[k] || k}
          </div>
        ))}
      </div>
      {[0, 1].map((row) => (
        <div key={row} className="flex items-stretch gap-0.5 mt-0.5">
          <div className="w-2 shrink-0 h-1.5 bg-[#EEE9FB]/60 rounded-sm" />
          <div className="flex-1 min-w-0 h-1.5 bg-[#F5F3EC] rounded-sm" />
          {visibleOrdered.map((k) => (
            <div
              key={k}
              className="shrink-0 h-1.5 bg-[#EAE4D8] rounded-sm"
              style={{ minWidth: 18 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PresetCard({ item, onUpvote, onInstall, onDelete, isAuthor }) {
  const p = item.preset || {};
  const visibleCols = (p.order || []).filter((k) => p.visible?.[k]);
  const [showComments, setShowComments] = useState(false);
  return (
    <div
      className="rounded-lg border border-[#E4D9C8] bg-white p-4 hover:border-[#D9CCF5] hover:shadow-md transition-all"
      data-testid={`preset-market-card-${item.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg text-[#2C2C2C] leading-tight truncate" data-testid={`preset-market-name-${item.id}`}>
            {item.name}
          </h3>
          <p className="text-[11px] text-[#6E6E6E] mt-0.5">
            by <span className="font-medium text-[#4C2A99]">{item.author_name}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onUpvote}
          data-testid={`preset-market-upvote-${item.id}`}
          aria-pressed={item.viewer_upvoted}
          className={`flex flex-col items-center px-2 py-1 rounded border transition-colors ${
            item.viewer_upvoted
              ? "border-[#6B46C1] bg-[#EEE9FB] text-[#4C2A99]"
              : "border-[#E4D9C8] bg-white text-[#5B5F4D] hover:bg-[#F5F0FB] hover:border-[#D9CCF5]"
          }`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span className="text-[11px] font-mono font-semibold tabular-nums" data-testid={`preset-market-upvote-count-${item.id}`}>{item.upvote_count}</span>
        </button>
      </div>
      {item.description && (
        <p className="text-xs text-[#2C2C2C] mb-2 line-clamp-3">{item.description}</p>
      )}
      <div className="mb-2">
        <p className="text-[10px] uppercase tracking-wide text-[#6E6E6E] font-semibold mb-1">Visible columns</p>
        <div className="flex flex-wrap gap-1">
          {visibleCols.length === 0 ? (
            <span className="text-[10px] text-[#6E6E6E] italic">Only title &amp; author</span>
          ) : visibleCols.map((k) => (
            <span key={k} className="px-1.5 py-0.5 text-[10px] rounded border border-[#E4D9C8] bg-[#FAF6EE] text-[#5B5F4D]">
              {COL_LABELS[k] || k}
            </span>
          ))}
        </div>
        <PresetPreviewThumbnail preset={p} />
      </div>
      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onInstall}
            data-testid={`preset-market-install-${item.id}`}
            className="px-3 py-1 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#4C2A99] transition-colors"
          >
            Install as chip
          </button>
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            data-testid={`preset-market-toggle-comments-${item.id}`}
            aria-expanded={showComments}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-[#E4D9C8] text-[11px] text-[#5B5F4D] hover:bg-[#F5F0FB] hover:border-[#D9CCF5] transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            <span data-testid={`preset-market-comment-count-${item.id}`}>{item.comment_count || 0}</span>
          </button>
        </div>
        {isAuthor && (
          <button
            type="button"
            onClick={onDelete}
            data-testid={`preset-market-delete-${item.id}`}
            className="p-1 rounded text-[#A03D33] hover:bg-[#F5EAE9] transition-colors"
            aria-label="Delete this preset"
            title="Delete this preset (author only)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showComments && <CommentThread presetId={item.id} />}
    </div>
  );
}

export default function PresetMarketplace() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("upvotes");

  const load = async (q, sortKey) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("sort", sortKey);
      const { data } = await api.get(`/presets/marketplace?${params.toString()}`);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't load the marketplace.");
    } finally {
      setLoading(false);
    }
  };
  // Debounce search input so we don't spam the API on every keystroke.
  useEffect(() => {
    const h = setTimeout(() => { load(query, sort); }, query ? 250 : 0);
    return () => clearTimeout(h);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [query, sort]);

  const handleUpvote = async (id) => {
    try {
      const { data } = await api.post(`/presets/marketplace/${id}/upvote`);
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, upvote_count: data.upvote_count, viewer_upvoted: data.viewer_upvoted } : it));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upvote failed");
    }
  };

  const handleInstall = (item) => {
    try {
      const raw = window.localStorage.getItem("shelfsort_list_col_custom_presets");
      const existing = raw ? JSON.parse(raw) : {};
      const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const cleanVisible = REORDERABLE_COL_KEYS.reduce((acc, k) => { acc[k] = !!item.preset.visible?.[k]; return acc; }, {});
      const cleanOrder = (item.preset.order || []).filter((k) => REORDERABLE_COL_KEYS.includes(k));
      existing[key] = {
        label: item.preset.label || item.name,
        visible: cleanVisible,
        order: cleanOrder,
        created_at: new Date().toISOString(),
        imported: true,
        marketplace_id: item.id,
        marketplace_author: item.author_name,
      };
      window.localStorage.setItem("shelfsort_list_col_custom_presets", JSON.stringify(existing));
      toast.success(`"${item.name}" installed — check the columns menu on your library.`);
    } catch (e) {
      toast.error("Couldn't install locally — check browser storage permissions.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this preset from the marketplace? This cannot be undone.")) return;
    try {
      await api.delete(`/presets/marketplace/${id}`);
      setItems((prev) => prev.filter((it) => it.id !== id));
      toast.success("Preset removed from the marketplace.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  const authorSet = useMemo(() => new Set(items.filter((it) => user && it.author_user_id === user.user_id).map((it) => it.id)), [items, user]);

  return (
    <div className="min-h-screen bg-[#FBFAF6]" data-testid="preset-marketplace-page">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link to="/library/all" className="inline-flex items-center gap-1 text-xs text-[#5B5F4D] hover:text-[#4C2A99] mb-3">
          <ArrowLeft className="w-3 h-3" /> Back to library
        </Link>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-serif text-[#2C2C2C]">Preset Marketplace</h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-2xl">
              Column layouts other readers have shared — upvote favourites and install any preset as a custom chip in your library&rsquo;s columns menu.
            </p>
          </div>
          <Layers3 className="w-10 h-10 text-[#6B46C1] shrink-0" aria-hidden />
        </div>
        <div className="mb-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6E6E6E]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search presets by name, description, or author…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#E4D9C8] bg-white rounded-full focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/40"
              data-testid="preset-marketplace-search"
              aria-label="Search the marketplace"
            />
          </div>
          <div className="flex gap-1" data-testid="preset-marketplace-sort">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSort(opt.key)}
                aria-pressed={sort === opt.key}
                data-testid={`preset-marketplace-sort-${opt.key}`}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  sort === opt.key
                    ? "border-[#6B46C1] bg-[#6B46C1] text-white"
                    : "border-[#E4D9C8] bg-white text-[#5B5F4D] hover:bg-[#F5F0FB] hover:border-[#D9CCF5]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div className="rounded border border-[#A03D33]/40 bg-[#FBF3F1] px-4 py-2 text-sm text-[#A03D33] mb-4" data-testid="preset-marketplace-error">
            {error}
          </div>
        )}
        {loading ? (
          <div className="text-center py-16 text-[#6E6E6E]" data-testid="preset-marketplace-loading">Loading shared presets…</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#E4D9C8] bg-white px-6 py-12 text-center" data-testid="preset-marketplace-empty">
            <Sparkles className="w-8 h-8 text-[#6B46C1] mx-auto mb-3" aria-hidden />
            <p className="text-lg font-serif text-[#2C2C2C] mb-1">
              {query ? "No presets match your search" : sort === "mine" ? "You haven't published any presets yet" : "No shared presets yet"}
            </p>
            <p className="text-sm text-[#5B5F4D] max-w-md mx-auto">
              {sort === "mine"
                ? <>Right-click any preset chip on <Link to="/library/all" className="text-[#4C2A99] hover:underline">your library</Link> &rarr; &ldquo;Publish to marketplace&hellip;&rdquo; to share one.</>
                : query
                  ? <>Try a shorter search — or clear it to see all shared presets.</>
                  : <>Be the first to share one! On <Link to="/library/all" className="text-[#4C2A99] hover:underline">your library</Link>, right-click a preset chip in the columns menu &rarr; &ldquo;Publish to marketplace&rdquo;.</>}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="preset-marketplace-grid">
            {items.map((item) => (
              <PresetCard
                key={item.id}
                item={item}
                onUpvote={() => handleUpvote(item.id)}
                onInstall={() => handleInstall(item)}
                onDelete={() => handleDelete(item.id)}
                isAuthor={authorSet.has(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
