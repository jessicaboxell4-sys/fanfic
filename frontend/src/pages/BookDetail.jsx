import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import Navbar from "../components/Navbar";
import TagInput from "../components/TagInput";
import ReadingStatsCard from "../components/ReadingStatsCard";
import BookReadingInsights from "../components/BookReadingInsights";
import BookCohortProgress from "../components/BookCohortProgress";
import AntivirusBadge from "../components/AntivirusBadge";
import SimilarBooksStrip from "../components/SimilarBooksStrip";
import CrossDeviceFinishStrip from "../components/CrossDeviceFinishStrip";
import { ArrowLeft, Download, Trash2, Sparkles, Book, Edit3, Heart, Link as LinkIcon, BookOpen, RefreshCw, Tag as TagIcon, Loader2, Upload, Smartphone, Laptop, Tablet, MonitorSmartphone, Send } from "lucide-react";
import { toast } from "sonner";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";

const DEFAULT_CATEGORIES = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", "Updated stories", "Old stories"];

function relativeAgeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reclassifying, setReclassifying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editFandom, setEditFandom] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [allCategories, setAllCategories] = useState(DEFAULT_CATEGORIES);
  const [allTags, setAllTags] = useState([]);
  const [savingTags, setSavingTags] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState([]);
  // Send-to-Kindle (2026-06-22) — Kindle email comes from
  // /api/user/kindle-settings.  Button is disabled when the user
  // hasn't configured one; clicking the *disabled* state still routes
  // to /account so they can set it.
  //
  // ``null`` = settings GET in flight (button disabled).
  // ``""``   = settings loaded, no Kindle email on file (click → /account).
  // ``"x@kindle.com"`` = ready to send.
  // Per testing-agent feedback (iter 33) — without this loading
  // sentinel, a user who taps the button within ~300 ms of page load
  // got bounced to /account even when their address was already set.
  const [kindleEmail, setKindleEmail] = useState(null);
  const [sendingToKindle, setSendingToKindle] = useState(false);

  const load = async () => {
    try {
      const [bookRes, catRes, tagRes] = await Promise.all([
        api.get(`/books/${id}`),
        api.get(`/categories`),
        api.get(`/tags`),
      ]);
      setBook(bookRes.data);
      setAllTags((tagRes.data.tags || []).map((t) => t.name));
      setEditCategory(bookRes.data.category);
      setEditFandom(bookRes.data.fandom || "");
      setEditTitle(bookRes.data.title || "");
      setEditAuthor(bookRes.data.author || "");
      setEditDescription(bookRes.data.description || "");
      const merged = [...DEFAULT_CATEGORIES, ...(catRes.data.custom || [])];
      // Make sure the current category is in the list even if unknown
      if (bookRes.data.category && !merged.includes(bookRes.data.category)) {
        merged.push(bookRes.data.category);
      }
      setAllCategories(merged);
    } catch (e) {
      toast.error("Couldn't load book");
      navigate("/library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const reclassify = async () => {
    setReclassifying(true);
    try {
      const { data } = await api.post(`/books/${id}/reclassify`, { use_ai: true });
      toast.success(`Reclassified by AI: ${data.category}${data.fandom ? ` · ${data.fandom}` : ""}`);
      await load();
    } catch (e) {
      toast.error("Reclassification failed");
    } finally {
      setReclassifying(false);
    }
  };

  const refreshFromSource = async () => {
    setRefreshing(true);
    const t = toast.loading("Generating a fresh copy…");
    try {
      const { data } = await api.post(`/books/${id}/refresh`, {}, { timeout: 300000 });
      const shelf = data.updated_shelf || "Updated stories";
      toast.success(`Created "${data.title}" in ${shelf}`, { id: t });
      if (data.new_book_id) {
        navigate(`/book/${data.new_book_id}`);
      } else {
        await load();
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Refresh failed";
      toast.error(msg, { id: t });
    } finally {
      setRefreshing(false);
    }
  };

  const replaceEpub = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      toast.error("Please choose an .epub file");
      return;
    }
    setRefreshing(true);
    const t = toast.loading("Saving as a new version…");
    try {
      const { data } = await api.post(`/books/${id}/upload-new-version`, (() => {
        const fd = new FormData();
        fd.append("file", file);
        return fd;
      })(), {
        timeout: 300000,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const shelf = data.updated_shelf || "Updated stories";
      toast.success(`Saved as "${data.title}" in ${shelf}`, { id: t });
      if (data.new_book_id) {
        navigate(`/book/${data.new_book_id}`);
      } else {
        await load();
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Upload failed";
      toast.error(msg, { id: t });
    } finally {
      setRefreshing(false);
    }
  };

  const saveSourceUrl = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/books/${id}/source-url`, { source_url: newSourceUrl.trim() });
      toast.success("Source URL updated — try the refresh now");
      setEditingSource(false);
      setNewSourceUrl("");
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      // 409 with structured body — another book in this library already owns
      // the URL. Show a friendly toast with a "Open the other book →" action
      // so the user can decide whether to merge / dedupe rather than silently
      // creating a duplicate.
      if (
        err?.response?.status === 409 &&
        detail &&
        typeof detail === "object" &&
        detail.code === "url_already_claimed" &&
        detail.conflict_book?.book_id
      ) {
        const c = detail.conflict_book;
        toast.error(
          `Another book in your library already has this URL: "${c.title}" by ${c.author}.`,
          {
            duration: 10000,
            action: {
              label: "Open it",
              onClick: () => navigate(`/book/${c.book_id}`),
            },
          },
        );
        return;
      }
      toast.error(
        typeof detail === "string" ? detail : (detail?.message || "Couldn't save URL"),
      );
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this book from your library?")) return;
    try {
      await api.delete(`/books/${id}`);
      toast.success("Removed");
      navigate("/library");
    } catch (e) {
      toast.error("Couldn't delete");
    }
  };

  const saveEdit = async () => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      // Only send fields the user actually changed — avoids needlessly
      // rewriting the EPUB file on disk for category-only edits.
      const payload = {};
      if (editCategory !== book.category) payload.category = editCategory;
      if ((editFandom || null) !== (book.fandom || null)) {
        payload.fandom = editFandom || null;
      }
      if (editTitle !== (book.title || "")) payload.title = editTitle;
      if (editAuthor !== (book.author || "")) payload.author = editAuthor;
      if (editDescription !== (book.description || "")) {
        payload.description = editDescription;
      }
      if (Object.keys(payload).length === 0) {
        toast("No changes");
        setEditing(false);
        return;
      }
      const { data } = await api.patch(`/books/${id}`, payload);
      if (data.epub_updated === false) {
        toast.success("Updated — note: EPUB file couldn't be re-saved with new metadata");
      } else {
        toast.success("Updated");
      }
      setEditing(false);
      await load();
    } catch (e) {
      toast.error("Couldn't update");
    } finally {
      setSavingEdit(false);
    }
  };

  const download = () => {
    window.open(`${API}/books/${id}/download`, "_blank");
  };

  const downloadLinks = () => {
    window.open(`${API}/books/${id}/links`, "_blank");
  };

  // Fetch the user's Kindle send-to address once on mount so we can
  // render the button's enabled/disabled state without a click-time
  // round trip.  Failures are non-blocking — if the lookup fails we
  // just leave the button in its "not configured" state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/user/kindle-settings");
        if (!cancelled) setKindleEmail((data?.kindle_email || "").trim());
      } catch {
        if (!cancelled) setKindleEmail("");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sendToKindle = async () => {
    if (!kindleEmail) {
      // No address — bounce the user to the settings page where they
      // can set one.  Keeps the disabled-button click path useful.
      toast.info("Add your Kindle email in Account → Send to Kindle first.");
      navigate("/account#send-to-kindle");
      return;
    }
    if (!window.confirm(`Send "${book?.title || 'this book'}" to ${kindleEmail}?`)) return;
    setSendingToKindle(true);
    try {
      const { data } = await api.post(`/books/${id}/send-to-kindle`);
      const mb = data?.size_bytes ? `${(data.size_bytes / 1024 / 1024).toFixed(1)} MB` : "";
      toast.success(
        `Sent to ${data?.to || kindleEmail}${mb ? ` · ${mb}` : ""}. ` +
        `Should appear on your Kindle within ~5 min.`,
      );
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "Couldn't send";
      // Help the user along when Amazon's approved-sender list is the
      // likely culprit (502 from Resend usually means bounce or
      // recipient rejection rather than send-side error).
      if (status === 502) {
        toast.error(`${detail}  (If this is the first send, make sure you've added the Shelfsort sender address to your Amazon "Approved Personal Document E-mail List".)`);
      } else if (status === 413) {
        toast.error(detail);
      } else if (status === 429) {
        toast.warning(detail);
      } else {
        toast.error(detail);
      }
    } finally {
      setSendingToKindle(false);
    }
  };

  if (loading || !book) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <div className="text-center py-20 text-[#6B705C]">Loading…</div>
      </div>
    );
  }

  const coverUrl = book.has_cover
    ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`
    : null;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-8"
          data-testid="back-to-library"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="grid md:grid-cols-[260px_1fr] gap-10">
          <div>
            <div className="aspect-[2/3] rounded-2xl overflow-hidden shelf-card">
              {coverUrl ? (
                <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
              ) : (
                <div className="book-spine w-full h-full">
                  <div>
                    <Book className="w-10 h-10 mx-auto mb-3 opacity-80" />
                    <p className="text-lg">{book.title}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              {book.author && book.author.toLowerCase() !== "unknown" ? (
                <Link
                  to={`/library/author/${encodeURIComponent(book.author)}`}
                  className="hover:text-[#E07A5F] hover:underline"
                  data-testid="author-link"
                >
                  {book.author}
                </Link>
              ) : (
                book.author
              )}
            </p>

            {(book.replaces || book.replaced_by) && (
              <div
                data-testid="version-banner"
                className="mb-4 p-3 rounded-xl border border-[#B87A00]/30 bg-[#FDF3E1] text-sm"
              >
                {book.replaces && (
                  <p className="text-[#2C2C2C]">
                    <span className="font-semibold text-[#B87A00]">Updated copy</span> ·{" "}
                    <Link to={`/book/${book.replaces}`} className="text-[#6B46C1] hover:underline">
                      see original
                    </Link>
                    {" · "}
                    <Link
                      to={`/book/${book.book_id}/compare`}
                      className="text-[#6B46C1] hover:underline font-semibold"
                      data-testid="compare-versions-link"
                    >
                      Compare versions →
                    </Link>
                  </p>
                )}
                {book.replaced_by && (
                  <p className="text-[#2C2C2C]">
                    <span className="font-semibold text-[#B87A00]">Old version</span> · a refreshed copy is in{" "}
                    <Link to={`/book/${book.replaced_by}`} className="text-[#6B46C1] hover:underline">
                      Updated stories
                    </Link>
                    {" · "}
                    <Link
                      to={`/book/${book.book_id}/compare`}
                      className="text-[#6B46C1] hover:underline font-semibold"
                      data-testid="compare-versions-link"
                    >
                      Compare versions →
                    </Link>
                  </p>
                )}
              </div>
            )}
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight mb-4" data-testid="book-detail-title">
              {book.title}
            </h1>

            <div className="flex flex-wrap gap-2 mb-6">
              <span className={
                book.category === "Fanfiction" ? "badge-fandom" :
                book.category === "Original Fiction" ? "badge-original" :
                book.category === "Non-fiction" ? "badge-nonfic" : "badge-unclassified"
              }>
                {book.category}
              </span>
              {book.fandom && <span className="badge-fandom">{book.fandom}</span>}
              <StatusBadge book={book} onChange={(next) => setBook((b) => ({ ...b, ...next }))} />
              {Number.isFinite(book.confidence) && (
                <span className="text-xs text-[#6B705C] px-2 py-1">
                  via {book.classifier} · {Math.round(book.confidence * 100)}% confident
                </span>
              )}
            </div>

            {book.description && (
              <p className="text-[#2C2C2C] leading-relaxed mb-8 max-h-60 overflow-y-auto pr-2" data-testid="book-detail-description">
                {book.description}
              </p>
            )}

            {/* Per-book reading stats (auto-hides if user hasn't read this book) */}
            <div className="mb-8">
              <ReadingStatsCard bookId={book.book_id} />
            </div>

            {/* Tags */}
            <div className="mb-8" data-testid="book-tags-section">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-1.5">
                  <TagIcon className="w-3 h-3" /> Tags
                </p>
                <button
                  type="button"
                  data-testid="suggest-tags-btn"
                  disabled={suggesting}
                  onClick={async () => {
                    setSuggesting(true);
                    try {
                      const { data } = await api.post(`/books/${book.book_id}/suggest-tags`);
                      const newOnes = (data.suggested || []).filter((t) => !(book.tags || []).includes(t));
                      if (newOnes.length === 0) {
                        toast.info("No new tag suggestions — already well-tagged!");
                      } else {
                        setSuggested(newOnes);
                      }
                    } catch (e) {
                      toast.error("Couldn't get suggestions");
                    } finally {
                      setSuggesting(false);
                    }
                  }}
                  className="text-xs text-[#E07A5F] hover:text-[#a8532f] inline-flex items-center gap-1.5 font-semibold disabled:opacity-60"
                >
                  {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Suggest tags
                </button>
              </div>
              <TagInput
                value={book.tags || []}
                onChange={async (next) => {
                  if (savingTags) return;
                  setSavingTags(true);
                  const prev = book.tags || [];
                  setBook((b) => ({ ...b, tags: next }));
                  try {
                    const added = next.filter((t) => !prev.includes(t));
                    const removed = prev.filter((t) => !next.includes(t));
                    if (added.length) {
                      await api.post(`/books/${book.book_id}/tags`, { tags: added });
                    }
                    for (const t of removed) {
                      await api.delete(`/books/${book.book_id}/tags/${encodeURIComponent(t)}`);
                    }
                    const tagRes = await api.get(`/tags`);
                    setAllTags((tagRes.data.tags || []).map((tt) => tt.name));
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Couldn't update tags");
                    setBook((b) => ({ ...b, tags: prev }));
                  } finally {
                    setSavingTags(false);
                  }
                }}
                suggestions={allTags}
                busy={savingTags}
                placeholder="Add tag (e.g. fluff, wip)…"
                testIdPrefix="book-tags"
              />
              {suggested.length > 0 && (
                <div className="mt-3 p-3 rounded-xl bg-[#FDF3E1] border border-[#B87A00]/20" data-testid="tag-suggestions">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B87A00] flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" /> AI suggestions
                    </p>
                    <button
                      type="button"
                      data-testid="dismiss-suggestions"
                      onClick={() => setSuggested([])}
                      className="text-xs text-[#6B705C] hover:text-[#2C2C2C]"
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="text-xs text-[#6B705C] mb-2">Click to add:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggested.map((t) => (
                      <button
                        type="button"
                        key={t}
                        data-testid={`suggestion-${t}`}
                        onClick={async () => {
                          try {
                            await api.post(`/books/${book.book_id}/tags`, { tags: [t] });
                            setBook((b) => ({ ...b, tags: [...(b.tags || []), t] }));
                            setSuggested((s) => s.filter((x) => x !== t));
                          } catch (e) {
                            toast.error("Couldn't add");
                          }
                        }}
                        className="inline-flex items-center gap-1 bg-white text-[#B87A00] border border-[#B87A00]/30 hover:bg-[#B87A00] hover:text-white transition-colors text-xs px-2.5 py-1 rounded-full font-semibold"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {book.unavailable && !editing && (
              <div className="shelf-card p-5 mb-6 bg-[#FDF3E1]/40 border-[#E07A5F]/20" data-testid="recover-source-panel">
                <p className="text-sm font-semibold text-[#2C2C2C] mb-1">
                  🚫 We couldn&apos;t find this story online
                </p>
                <p className="text-xs text-[#6B705C] mb-3">
                  We tried <code className="bg-white/60 px-1.5 py-0.5 rounded text-[#E07A5F]">{book.source_url}</code>. If the work moved
                  (e.g., reposted under a new ID), paste the new URL and we&apos;ll try again.
                </p>
                {editingSource ? (
                  <form onSubmit={saveSourceUrl} className="flex flex-col sm:flex-row gap-2">
                    <input
                      autoFocus
                      data-testid="new-source-url-input"
                      type="url"
                      placeholder="https://archiveofourown.org/works/12345678"
                      value={newSourceUrl}
                      onChange={(e) => setNewSourceUrl(e.target.value)}
                      className="flex-1 bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                    />
                    <button type="submit" data-testid="save-source-url" className="btn-primary text-sm">Save & retry</button>
                    <button
                      type="button"
                      onClick={() => { setEditingSource(false); setNewSourceUrl(""); }}
                      className="text-[#6B705C] hover:text-[#2C2C2C] text-sm px-3"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    data-testid="fix-source-url-btn"
                    onClick={() => { setEditingSource(true); setNewSourceUrl(book.source_url || ""); }}
                    className="btn-secondary text-sm"
                  >
                    Fix the source URL
                  </button>
                )}
              </div>
            )}

            {editing ? (
              <div className="shelf-card p-5 mb-6">
                <p className="text-sm font-semibold text-[#2C2C2C] mb-3">Edit book details</p>
                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-[#6B705C] mb-1 block">Title</label>
                    <input
                      data-testid="edit-title"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={500}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-[#6B705C] mb-1 block">Author</label>
                    <input
                      data-testid="edit-author"
                      type="text"
                      value={editAuthor}
                      onChange={(e) => setEditAuthor(e.target.value)}
                      maxLength={500}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-[#6B705C] mb-1 block">Description</label>
                    <textarea
                      data-testid="edit-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      maxLength={5000}
                      rows={4}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm resize-y"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B705C] mb-1 block">Category</label>
                    <select
                      data-testid="edit-category"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    >
                      {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B705C] mb-1 block">Fandom (optional)</label>
                    <input
                      data-testid="edit-fandom"
                      type="text"
                      placeholder="e.g., Harry Potter"
                      value={editFandom}
                      onChange={(e) => setEditFandom(e.target.value)}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-[#6B705C] mb-3">
                  Title, author and description are rewritten into the EPUB file itself — so when you re-download or send the book to another reader, your edits travel with it.
                </p>
                <div className="flex gap-2">
                  <button data-testid="edit-save" onClick={saveEdit} disabled={savingEdit} className="btn-primary text-sm disabled:opacity-60">
                    {savingEdit ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditing(false)} disabled={savingEdit} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {/* Cross-device hint: appears just above the action
                    row when the cloud cursor came from a different
                    device than this one (within 14 days).  Mirrors the
                    Continue Reading rail caption + Reader handoff
                    ribbon so the awareness is consistent everywhere. */}
                {book.last_device_id && book.last_device_label && (() => {
                  let myDevice = "";
                  try { myDevice = window.localStorage.getItem("shelfsort-device-id") || ""; } catch {}
                  if (!myDevice || myDevice === book.last_device_id) return null;
                  const updated = book.last_cursor_updated_at;
                  const ageDays = updated ? (Date.now() - new Date(updated).getTime()) / 86_400_000 : 999;
                  if (ageDays > 14) return null;
                  const rel = relativeAgeShort(updated);
                  const pct = (book.progress_fraction ?? book.last_cursor_percent);
                  const pctTxt = (pct != null && pct >= 0) ? ` · ${Math.round(pct * 100)}%` : "";
                  const L = book.last_device_label.toLowerCase();
                  const Icon = L.includes("iphone") || L.includes("android") ? Smartphone
                            : L.includes("ipad") ? Tablet
                            : (L.includes("mac") || L.includes("windows")) ? Laptop
                            : MonitorSmartphone;
                  return (
                    <div
                      data-testid="bookdetail-cross-device-hint"
                      className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EEE9FB] dark:bg-[#6B46C1]/20 text-[#6B46C1] text-xs"
                      title={`Last read on ${book.last_device_label}${pctTxt} · ${rel}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>Last read on your {book.last_device_label}{pctTxt} · {rel}</span>
                    </div>
                  );
                })()}
                <CrossDeviceFinishStrip book={book} />
                <div className="flex flex-wrap gap-3">
                <button
                  data-testid="read-book-btn"
                  onClick={() => navigate(`/read/${id}`)}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <BookOpen className="w-4 h-4" /> Read now
                </button>
                <button
                  data-testid="download-book-btn"
                  onClick={download}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" /> Download EPUB
                </button>
                <button
                  data-testid="send-to-kindle-btn"
                  onClick={sendToKindle}
                  disabled={sendingToKindle || kindleEmail === null}
                  title={
                    kindleEmail === null
                      ? "Loading…"
                      : kindleEmail
                        ? `Email this EPUB to ${kindleEmail}`
                        : "Add your Kindle email in Account → Send to Kindle"
                  }
                  className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                    kindleEmail
                      ? "bg-[#FF9900] text-white hover:bg-[#E08800]"
                      : "btn-secondary opacity-70"
                  }`}
                >
                  {sendingToKindle ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {sendingToKindle ? "Sending…" : "Send to Kindle"}
                </button>
                <button
                  data-testid="download-links-btn"
                  onClick={downloadLinks}
                  className="btn-secondary flex items-center gap-2 text-sm"
                  title="Save every URL from this EPUB to a .txt file"
                >
                  <LinkIcon className="w-4 h-4" />
                  Save links (.txt){typeof book.links_count === "number" ? ` · ${book.links_count}` : ""}
                </button>
                <button
                  data-testid="reclassify-btn"
                  onClick={reclassify}
                  disabled={reclassifying}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {reclassifying ? "Asking AI…" : "Reclassify with AI"}
                </button>
                {book.source_url && FETCHING_UI_ENABLED && (
                  <button
                    data-testid="refresh-btn"
                    onClick={refreshFromSource}
                    disabled={refreshing}
                    className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${
                      book.unavailable
                        ? "bg-[#6B705C]/10 text-[#6B705C] hover:bg-[#6B705C]/20 border border-[#6B705C]/30"
                        : "btn-secondary"
                    }`}
                    title={book.unavailable ? ("Last error: " + (book.last_fetch_error || "FanFicFare couldn't find this")) : ("Source: " + book.source_url)}
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                    {refreshing
                      ? "Updating…"
                      : book.unavailable
                      ? "Try FanFicFare again"
                      : "Update from FanFicFare"}
                  </button>
                )}
                {/* Upload-replacement: lets the user drop in an EPUB they
                    grabbed themselves when FanFicFare can't reach the source. */}
                <label
                  className="btn-secondary flex items-center gap-2 text-sm cursor-pointer disabled:opacity-50"
                  title="Upload a freshly-downloaded EPUB as a new version (old version archives to 'Old stories')"
                  data-testid="upload-new-version-label"
                >
                  <Upload className="w-4 h-4" />
                  Upload new version
                  <input
                    type="file"
                    accept=".epub,application/epub+zip"
                    className="hidden"
                    disabled={refreshing}
                    data-testid="upload-new-version-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) replaceEpub(f);
                    }}
                  />
                </label>
                <button
                  data-testid="edit-btn"
                  onClick={() => setEditing(true)}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                <button
                  data-testid="delete-btn"
                  onClick={remove}
                  className="text-[#D9534F] hover:bg-[#D9534F]/10 px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              </div>
              </>
            )}

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Meta label="File" value={book.filename} />
              <Meta label="Size" value={`${(book.size_bytes / 1024).toFixed(0)} KB`} />
              <Meta label="Language" value={book.language || "—"} />
              <AntivirusBadge
                av_status={book.av_status}
                av_scanned_at={book.av_scanned_at}
                av_signature={book.av_signature}
                variant="row"
              />
              {book.publisher && <Meta label="Publisher" value={book.publisher} />}
              {Array.isArray(book.relationships) && book.relationships.length > 0 && (
                <Meta
                  label="Pairings"
                  value={
                    <div className="flex flex-wrap gap-1">
                      {book.relationships.map((r) => (
                        <Link
                          key={r}
                          to={`/library?relationship=${encodeURIComponent(r)}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#EDE7FB] text-[#6B46C1] border border-[#6B46C1]/20 hover:bg-[#6B46C1] hover:text-white transition-colors"
                        >
                          <Heart className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                          {r}
                        </Link>
                      ))}
                    </div>
                  }
                />
              )}
              {book.converted_from && (
                <Meta
                  label="Original format"
                  value={<span className="font-mono uppercase text-xs">.{book.converted_from} → .epub</span>}
                />
              )}
              {book.source_url && (
                <Meta
                  label="Source"
                  value={
                    <a
                      href={book.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#E07A5F] hover:underline break-all"
                      data-testid="source-url-link"
                    >
                      {book.source_url.replace(/^https?:\/\//, "").slice(0, 60)}
                    </a>
                  }
                />
              )}
              {book.last_refreshed_at && (
                <Meta
                  label="Last refreshed online"
                  value={new Date(book.last_refreshed_at).toLocaleString()}
                />
              )}
              {book.unavailable && (
                <Meta
                  label="Online availability"
                  value={
                    <span className="text-[#D9534F]" data-testid="unavailable-tag">
                      🚫 Can&apos;t find online
                    </span>
                  }
                />
              )}
              {book.series_name && (
                <Meta
                  label="Series"
                  value={
                    <Link
                      to={`/library/series/${encodeURIComponent(book.series_name)}`}
                      className="text-[#E07A5F] hover:underline"
                      data-testid="series-link"
                    >
                      {book.series_name}
                      {typeof book.series_index === "number" && ` #${Number.isInteger(book.series_index) ? book.series_index : book.series_index.toFixed(1)}`}
                    </Link>
                  }
                />
              )}
              {typeof book.progress_fraction === "number" && book.progress_fraction > 0 && (
                <Meta
                  label="Progress"
                  value={<BookCohortProgress bookId={book.book_id} yourPercent={book.progress_fraction} />}
                />
              )}
              {book.word_count > 0 && (
                <Meta
                  label="Word count"
                  value={Number(book.word_count).toLocaleString()}
                  testid="book-detail-word-count"
                />
              )}
              {book.word_count > 0 && (
                <BookReadingTime bookId={book.book_id} progress={book.progress_fraction || 0} />
              )}
              {book.source_meta?.chapters && (
                <Meta label="Chapters" value={book.source_meta.chapters} />
              )}
              {book.source_meta?.words && (
                <Meta label="Words" value={Number(book.source_meta.words).toLocaleString()} />
              )}
              {book.source_meta?.status && (
                <Meta label="Status" value={book.source_meta.status} />
              )}
            </div>
            <BookReadingInsights bookId={book.book_id} />
            <SimilarBooksStrip book={book} />
          </div>
        </div>
      </main>
    </div>
  );
}

function Meta({ label, value, testid }) {
  return (
    <div {...(testid ? { "data-testid": testid } : {})}>
      <p className="text-xs uppercase tracking-wider text-[#6B705C] font-semibold mb-1">{label}</p>
      <p className="text-[#2C2C2C] break-words">{value}</p>
    </div>
  );
}


function BookReadingTime({ bookId, progress }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/books/${bookId}/reading-time`)
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [bookId]);
  if (!data || data.minutes_total <= 0) return null;
  const fmt = (m) => {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };
  return (
    <Meta
      label="Reading time"
      testid="book-detail-reading-time"
      value={
        progress > 0 && progress < 1
          ? `${fmt(data.minutes_total)} · ${fmt(data.minutes_remaining)} left`
          : fmt(data.minutes_total)
      }
    />
  );
}


// Status badge + inline override menu. Renders the book's effective
// completion status (manual_status ?? status ?? "complete") and lets
// the user flip it via `PATCH /books/{id}/status`. Clicking "Auto"
// clears `manual_status` and reverts to the upload-time auto-detection.
function StatusBadge({ book, onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const effective = (book.manual_status || book.status || "complete").toLowerCase();
  const isManual = !!book.manual_status;
  const label = effective === "ongoing" ? "Ongoing" : "Finished";
  const cls = effective === "ongoing"
    ? "bg-[#F8E8D8] text-[#9E5A2E] border-[#9E5A2E]/30"
    : "bg-[#EEE9FB] text-[#6B46C1] border-[#6B46C1]/30";

  const apply = async (next) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/books/${book.book_id}/status`, {
        status: next,  // null clears the override
      });
      onChange({ status: data.status, manual_status: data.manual_status });
      toast.success(
        next
          ? `Marked as ${next === "complete" ? "Finished" : "Ongoing"}.`
          : "Cleared manual override — using auto-detected status.",
      );
      setOpen(false);
    } catch (e) {
      toast.error("Couldn't update status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="relative inline-flex" data-testid="book-status-badge-wrap">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        data-testid="book-status-badge"
        className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${cls} hover:opacity-90 transition-opacity disabled:opacity-50`}
        title={isManual ? "Status set manually — click to change or revert" : "Auto-detected status — click to override"}
      >
        {label}
        {isManual && <span className="text-[9px] uppercase tracking-wider opacity-80">manual</span>}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-10 bg-white border border-[#E5DDC5] rounded-lg shadow-lg p-1 min-w-[160px]"
          data-testid="book-status-menu"
        >
          <button
            type="button"
            onClick={() => apply("complete")}
            data-testid="book-status-set-complete"
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[#F5F3EC] flex items-center justify-between"
          >
            Finished
            {effective === "complete" && <span className="text-[#6B46C1]">✓</span>}
          </button>
          <button
            type="button"
            onClick={() => apply("ongoing")}
            data-testid="book-status-set-ongoing"
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[#F5F3EC] flex items-center justify-between"
          >
            Ongoing
            {effective === "ongoing" && <span className="text-[#9E5A2E]">✓</span>}
          </button>
          {isManual && (
            <button
              type="button"
              onClick={() => apply(null)}
              data-testid="book-status-clear-manual"
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[#F5F3EC] text-[#6B705C] border-t border-[#E5DDC5] mt-1"
            >
              Use auto-detected ({(book.status || "complete") === "ongoing" ? "Ongoing" : "Finished"})
            </button>
          )}
        </div>
      )}
    </span>
  );
}
