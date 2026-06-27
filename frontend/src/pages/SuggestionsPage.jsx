import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, MessageSquare, Lightbulb, Bug, Sparkles, ChevronUp, Loader2,
  Trash2, ShieldCheck as ShieldCheckIcon, Send, Paperclip, X, Smartphone,
} from "lucide-react";
import Navbar from "../components/Navbar";
import DevicePicker from "../components/DevicePicker";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = [
  { id: "bug", label: "Bug", icon: Bug, color: "#B43F26" },
  { id: "improvement", label: "Improvement", icon: Lightbulb, color: "#B87A00" },
  { id: "feature", label: "New feature", icon: Sparkles, color: "#6B46C1" },
];
const STATUSES = [
  { id: "open", label: "Open" },
  { id: "under_review", label: "Under review" },
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
  { id: "declined", label: "Declined" },
];

function StatusPill({ status }) {
  const map = {
    open: { label: "Open", bg: "#FBFAF6", color: "#6B705C" },
    under_review: { label: "Under review", bg: "#FDF3E1", color: "#B87A00" },
    planned: { label: "Planned", bg: "#EEF3EC", color: "#6B46C1" },
    // "Shipped" reads better than "Done" on a public board and
    // signals to other contributors that suggestions actually land
    // in production.  Same status enum on the backend — display-only.
    done: { label: "Shipped", bg: "#E6F0E8", color: "#1F4D2A" },
    declined: { label: "Declined", bg: "#F4E0DC", color: "#B43F26" },
  };
  const s = map[status] || map.open;
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// Public-facing credit ribbon shown under any shipped suggestion.
// Goal: when a suggestion lands in production, give the submitter
// visible recognition so other readers see "you can actually shape
// this product" and contribute more.  Sits between the body and the
// admin-note block so it reads as a celebratory caption.
function ShippedCredit({ submitterName, isMine }) {
  return (
    <p
      data-testid="suggestion-shipped-credit"
      className="text-[11px] mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EDE7FB] text-[#1F4D2A] font-semibold border border-[#C9DFC9]"
      title={isMine ? "Thanks for making Shelfsort better!" : "Crowd-sourced from a reader's suggestion"}
    >
      <Sparkles className="w-3 h-3 text-[#6B46C1]" />
      {isMine
        ? "Built from your suggestion"
        : <>Built from {submitterName}&apos;s suggestion</>}
    </p>
  );
}

function CategoryIcon({ category }) {
  const c = CATEGORIES.find((x) => x.id === category) || CATEGORIES[2];
  const Icon = c.icon;
  return <Icon className="w-3.5 h-3.5" style={{ color: c.color }} title={c.label} />;
}

/**
 * Inline attachment indicator + preview toggle for a suggestion row.
 *
 * Renders a clickable chip ( 📎 filename · 47 KB ).  Clicking once
 * fetches the bytes from /api/suggestions/{sid}/attachment with the
 * caller's session and inlines a preview:
 *   - Image MIME → <img> thumbnail (max-height 240px)
 *   - PDF MIME   → <embed> mini viewer (max-height 480px)
 *   - Anything else → "Download" link styled the same as the chip
 * Clicking the chip again collapses the preview.  The bytes are
 * fetched lazily — the list response only carries metadata, so
 * scrolling past a suggestion with a 9 MB file doesn't slow the
 * board.
 */
function SuggestionAttachmentChip({ sid, name, mime, size }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const isImage = (mime || "").startsWith("image/");
  const isPdf = (mime || "").includes("pdf");

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (!url) {
      setLoading(true);
      try {
        const res = await api.get(`/suggestions/${sid}/attachment`, {
          responseType: "blob",
        });
        setUrl(URL.createObjectURL(res.data));
      } catch (e) {
        toast.error("Couldn't fetch attachment");
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    setOpen(true);
  };

  return (
    <div className="mb-1" data-testid={`suggestion-attachment-${sid}`}>
      <button
        type="button"
        onClick={toggle}
        data-testid={`suggestion-attachment-toggle-${sid}`}
        className="inline-flex items-center gap-1.5 text-[11px] text-[#6B705C] bg-[#FBFAF6] border border-[#E5DDC5] rounded-full px-2.5 py-1 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
        title={`${name || "attachment"} · click to ${open ? "hide" : "preview"}`}
      >
        <Paperclip className="w-3 h-3" />
        <span className="truncate max-w-[24ch]">{name || "attachment"}</span>
        {size ? (
          <span className="text-[10px] text-[#6B705C]">
            {size < 1024 * 1024
              ? `${Math.round(size / 1024)} KB`
              : `${(size / 1024 / 1024).toFixed(1)} MB`}
          </span>
        ) : null}
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
      </button>
      {open && url && (
        <div
          className="mt-2 p-2 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]"
          data-testid={`suggestion-attachment-preview-${sid}`}
        >
          {isImage ? (
            <img
              src={url}
              alt={name || "attachment"}
              className="max-h-60 rounded border border-[#E5DDC5]"
            />
          ) : isPdf ? (
            <embed
              src={url}
              type="application/pdf"
              className="w-full h-[480px] rounded border border-[#E5DDC5]"
            />
          ) : (
            <a
              href={url}
              download={name || "attachment"}
              className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1"
              data-testid={`suggestion-attachment-download-${sid}`}
            >
              <Paperclip className="w-3 h-3" />
              Download {name || "attachment"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function SuggestionsPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  // New-suggestion form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("feature");
  const [device, setDevice] = useState("");
  const [attachment, setAttachment] = useState(null);   // File | null
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/suggestions", {
        params: {
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
          mine_only: mineOnly ? "true" : undefined,
        },
      });
      setItems(data?.suggestions || []);
      // Personalised "your suggestion shipped" celebration — fires
      // once per shipped suggestion (localStorage flag keyed by
      // suggestion_id) so the user only sees the confetti once per
      // shipment, but across page reloads we don't spam.  Looks for
      // any row that is BOTH mine AND status === done AND we haven't
      // shown the celebration for yet.
      try {
        const myShipped = (data?.suggestions || []).filter(
          (s) => s.is_mine && s.status === "done"
        );
        for (const s of myShipped) {
          const key = `shelfsort.suggestionCelebrated.${s.suggestion_id}`;
          if (localStorage.getItem(key) === "1") continue;
          localStorage.setItem(key, "1");
          // setTimeout so toast doesn't race the page paint.
          setTimeout(() => {
            toast.success(`Your suggestion shipped — "${s.title}"`, {
              description: "Thanks for making Shelfsort better. The badge below credits you publicly.",
              duration: 10000,
            });
          }, 400);
        }
      } catch { /* localStorage unavailable — skip */ }
    } catch { toast.error("Couldn't load suggestions"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, categoryFilter, mineOnly]);

  const submit = async () => {
    if (title.trim().length < 3) {
      toast.error("Title needs at least 3 characters");
      return;
    }
    if (!device.trim()) {
      toast.error("Pick the device you're on (helps us triage faster)");
      return;
    }
    setSubmitting(true);
    try {
      // Multipart so attachments (image / PDF / log / small zip up
      // to 10 MB) can ride along with the title + body.
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("body", body.trim());
      fd.append("category", category);
      fd.append("device", device.trim());
      if (attachment) fd.append("attachment", attachment);
      await api.post("/suggestions", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Suggestion submitted — thanks!");
      setTitle(""); setBody(""); setCategory("feature");
      setAttachment(null);
      // Keep ``device`` selected so a follow-up submission doesn't
      // make the user re-pick on the same session.
      await load();
    } catch (e) {
      const reason = e?.response?.data?.detail;
      if (reason === "attachment_too_large") {
        toast.error("Attachment is larger than 10 MB — try a smaller file.");
      } else if (reason === "attachment_unsafe") {
        toast.error("Attachment didn't pass our antivirus check.");
      } else if (reason === "device_required") {
        toast.error("Pick the device you're on — required for triage.");
      } else {
        toast.error(reason || "Couldn't submit");
      }
    } finally { setSubmitting(false); }
  };

  const vote = async (sid) => {
    try {
      const { data } = await api.post(`/suggestions/${sid}/vote`);
      setItems((prev) => prev.map((s) => s.suggestion_id === sid
        ? { ...s, votes_count: data.votes_count, i_voted: data.action === "voted" }
        : s));
    } catch (e) { toast.error(e?.response?.data?.detail || "Vote failed"); }
  };

  const remove = async (sid) => {
    if (!window.confirm("Delete this suggestion?")) return;
    try {
      await api.delete(`/suggestions/${sid}`);
      toast.success("Deleted");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const adminUpdate = async (sid, patch) => {
    try {
      await api.put(`/admin/suggestions/${sid}`, patch);
      toast.success("Updated");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  const adminDelete = async (sid) => {
    if (!window.confirm("Admin-delete this suggestion? (Used for spam.)")) return;
    try {
      await api.delete(`/admin/suggestions/${sid}`);
      toast.success("Deleted");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="suggestions-page">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
            <Lightbulb className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C]">Suggestions</h1>
            <p className="text-sm text-[#6B705C]">
              Spot a bug, want a feature, or have a tweak in mind? Drop it here. Vote on others&apos; suggestions to push them up the queue.
            </p>
          </div>
        </div>

        {/* Submit form */}
        <section className="shelf-card p-5 mb-5" data-testid="suggestions-form-card">
          <p className="text-xs font-bold uppercase tracking-wider text-[#6B705C] mb-2">Submit a new suggestion</p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="Short, clear title (e.g. Add bookmarks to the reader)"
            data-testid="suggestions-title-input"
            className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white mb-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 4000))}
            placeholder="Optional detail — what's the scenario, how would it work, etc."
            data-testid="suggestions-body-input"
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white mb-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 resize-none"
          />
          <DevicePicker
            value={device}
            onChange={setDevice}
            disabled={submitting}
            testidPrefix="suggestions-device"
          />
          {/* Attachment picker — optional, up to 10 MB.  Any file type
              accepted; the backend AV-scans every upload.  Most folks
              attach a screenshot, but a PDF log dump or small zip
              works too. */}
          <div className="flex items-center gap-3 mb-2" data-testid="suggestions-attachment-row">
            <label
              className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B705C] hover:text-[var(--primary)] cursor-pointer"
              data-testid="suggestions-attachment-label"
            >
              <Paperclip className="w-3.5 h-3.5" />
              {attachment ? "Change screenshot" : "Attach screenshot"}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (!f.type.startsWith("image/")) {
                    toast.error("Pictures only — pick a PNG or JPEG.");
                    return;
                  }
                  if (f.size > 10 * 1024 * 1024) {
                    toast.error("Image is larger than 10 MB — try a smaller one.");
                    return;
                  }
                  setAttachment(f);
                }}
                className="hidden"
                data-testid="suggestions-attachment-input"
              />
            </label>
            {attachment && (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-[#2C2C2C] bg-[#FBFAF6] border border-[#E5DDC5] rounded-full pl-3 pr-1 py-1"
                data-testid="suggestions-attachment-chip"
                title={attachment.name}
              >
                <span className="truncate max-w-[18ch]">{attachment.name}</span>
                <span className="text-[10px] text-[#6B705C]">
                  {(attachment.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                  data-testid="suggestions-attachment-remove"
                  className="w-5 h-5 rounded-full hover:bg-white flex items-center justify-center text-[#6B705C] hover:text-[var(--primary)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <span className="text-[10px] text-[#6B705C] ml-auto">
              Pictures only · max 10 MB
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1" data-testid="suggestions-category-picker">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    data-testid={`suggestions-category-${c.id}`}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                      active ? "border-[var(--primary)] bg-[#FBFAF6] text-[var(--primary)] font-semibold" : "border-[#E5DDC5] text-[#6B705C]"
                    }`}
                  >
                    <Icon className="w-3 h-3" /> {c.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || title.trim().length < 3 || !device.trim()}
              data-testid="suggestions-submit-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit
            </button>
          </div>
        </section>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="font-semibold uppercase tracking-wider text-[#6B705C]">Filters:</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="suggestions-filter-status" className="px-2 py-1 rounded border border-[#E5DDC5] bg-white">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} data-testid="suggestions-filter-category" className="px-2 py-1 rounded border border-[#E5DDC5] bg-white">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} data-testid="suggestions-filter-mine" />
            My submissions
          </label>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-sm text-[#6B705C]"><Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-[#6B705C] italic">No suggestions match. Be the first!</p>
        ) : (
          <ul className="space-y-2" data-testid="suggestions-list">
            {items.map((s) => (
              <li
                key={s.suggestion_id}
                data-testid={`suggestion-row-${s.suggestion_id}`}
                className="shelf-card p-4 flex items-start gap-3"
              >
                <button
                  type="button"
                  onClick={() => vote(s.suggestion_id)}
                  data-testid={`suggestion-vote-btn-${s.suggestion_id}`}
                  className={`flex flex-col items-center justify-center w-12 py-1.5 rounded-lg flex-shrink-0 transition-colors ${
                    s.i_voted ? "bg-[var(--primary)] text-white" : "bg-[#FBFAF6] border border-[#E5DDC5] text-[#6B705C] hover:border-[var(--primary)]"
                  }`}
                  title={s.i_voted ? "Click to remove your vote" : "Upvote this suggestion"}
                >
                  <ChevronUp className="w-4 h-4" />
                  <span className="text-xs font-bold">{s.votes_count}</span>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <CategoryIcon category={s.category} />
                    <p className="text-sm font-semibold text-[#2C2C2C]">{s.title}</p>
                    <StatusPill status={s.status} />
                  </div>
                  {s.body && <p className="text-xs text-[#4A4A4A] whitespace-pre-wrap mb-1">{s.body}</p>}
                  {s.has_attachment && (
                    <SuggestionAttachmentChip
                      sid={s.suggestion_id}
                      name={s.attachment_name}
                      mime={s.attachment_mime}
                      size={s.attachment_size}
                    />
                  )}
                  {s.admin_note && (
                    <p className="text-xs text-[#6B46C1] mt-1 p-2 rounded bg-[#EEF3EC] border-l-2 border-[#6B46C1]">
                      <strong>Admin note:</strong> {s.admin_note}
                    </p>
                  )}
                  {s.status === "done" && (
                    <ShippedCredit submitterName={s.submitter_name} isMine={s.is_mine} />
                  )}
                  <p className="text-[10px] text-[#6B705C] mt-1 inline-flex items-center gap-1.5 flex-wrap">
                    <span>by {s.submitter_name} · {new Date(s.created_at).toLocaleDateString()}</span>
                    {s.device && s.device !== "Unknown" && (
                      <span
                        data-testid={`suggestion-device-${s.suggestion_id}`}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] font-semibold"
                        title="Device the submitter was on"
                      >
                        <Smartphone className="w-2.5 h-2.5" />
                        {s.device}
                      </span>
                    )}
                  </p>
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-1 mt-2" data-testid={`suggestion-admin-${s.suggestion_id}`}>
                      <ShieldCheckIcon className="w-3 h-3 text-[var(--primary)]" />
                      <span className="text-[10px] uppercase font-semibold text-[var(--primary)]">Admin:</span>
                      <select
                        value={s.status}
                        onChange={(e) => adminUpdate(s.suggestion_id, { status: e.target.value })}
                        data-testid={`suggestion-admin-status-${s.suggestion_id}`}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#E5DDC5]"
                      >
                        {STATUSES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const note = window.prompt("Admin note (visible to all):", s.admin_note || "");
                          if (note !== null) adminUpdate(s.suggestion_id, { admin_note: note });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-[#E5DDC5] text-[#6B705C]"
                      >
                        Note
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDelete(s.suggestion_id)}
                        className="text-[10px] px-2 py-0.5 rounded text-[#B43F26]"
                        title="Admin delete (spam)"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                {s.is_mine && (
                  <button
                    type="button"
                    onClick={() => remove(s.suggestion_id)}
                    data-testid={`suggestion-self-delete-${s.suggestion_id}`}
                    className="text-[#6B705C] hover:text-[#B43F26] flex-shrink-0"
                    title="Delete your suggestion"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
