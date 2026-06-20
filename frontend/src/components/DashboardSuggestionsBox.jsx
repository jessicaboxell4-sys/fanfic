import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Sparkles, Lightbulb, Bug, Send, ArrowRight, Loader2, Paperclip, X } from "lucide-react";

/**
 * Compact "Suggestions" box on the welcome dashboard.
 *
 * Mirrors the long-form ``SuggestionsPage`` form (POST /api/suggestions
 * with ``{title, body, category}``) but trimmed down to title + category +
 * a single optional detail row so a user can drop a note in 5 seconds
 * without navigating. Successful submits clear the form and surface a
 * link to the full suggestions board where the user can vote, see
 * status, etc.
 */
const CATEGORIES = [
  { id: "feature", label: "New feature", icon: Sparkles },
  { id: "improvement", label: "Improvement", icon: Lightbulb },
  { id: "bug", label: "Bug", icon: Bug },
];

export default function DashboardSuggestionsBox() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("feature");
  const [attachment, setAttachment] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastSent, setLastSent] = useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      // Multipart so the optional attachment (screenshot, PDF, small
      // zip up to 10 MB) rides along with the title/body.
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("body", body.trim());
      fd.append("category", category);
      if (attachment) fd.append("attachment", attachment);
      const { data } = await api.post("/suggestions", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLastSent({ id: data?.id || null, title: title.trim() });
      setTitle("");
      setBody("");
      setAttachment(null);
      toast.success("Thanks — your suggestion's in.");
    } catch (err) {
      const reason = err?.response?.data?.detail;
      if (reason === "attachment_too_large") {
        toast.error("Attachment is larger than 10 MB — try a smaller file.");
      } else if (reason === "attachment_unsafe") {
        toast.error("Attachment didn't pass our antivirus check.");
      } else {
        toast.error(reason || "Couldn't submit. Try the full board.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid="dashboard-suggestions-box"
      className="shelf-card p-6 md:p-7 bg-[#FAF6EE] border border-[#6B46C1]/15 rounded-2xl"
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-white border border-[#6B46C1]/30 text-[#6B46C1] flex items-center justify-center flex-shrink-0 shadow-sm">
          <Lightbulb className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] leading-tight">
            Got an idea?
          </h2>
          <p className="text-sm text-[#6B705C] mt-1">
            Drop a feature request, polish suggestion, or bug. Anyone on the suggestions board can upvote — popular ones jump the queue.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short, clear title — e.g. “Drag-and-drop queue reorder”"
          maxLength={120}
          required
          data-testid="dashboard-suggestion-title"
          className="w-full px-3 py-2 rounded-lg border border-[#E8E6E1] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 focus:border-[#6B46C1]"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Optional detail — what’s the scenario, what would help?"
          data-testid="dashboard-suggestion-body"
          className="w-full px-3 py-2 rounded-lg border border-[#E8E6E1] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 focus:border-[#6B46C1] resize-y"
        />
        <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-suggestion-categories">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                data-testid={`dashboard-suggestion-cat-${c.id}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                    : "bg-white text-[#6B705C] border-[#E8E6E1] hover:border-[#6B46C1] hover:text-[#6B46C1]"
                }`}
              >
                <Icon className="w-3 h-3" />
                {c.label}
              </button>
            );
          })}
        </div>
        {/* Attachment row — optional screenshot / PDF / log up to 10 MB. */}
        <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-suggestion-attachment-row">
          <label
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B705C] hover:text-[#6B46C1] cursor-pointer"
            data-testid="dashboard-suggestion-attachment-label"
          >
            <Paperclip className="w-3.5 h-3.5" />
            {attachment ? "Change file" : "Attach screenshot or file"}
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) {
                  toast.error("File is larger than 10 MB — try a smaller one.");
                  return;
                }
                setAttachment(f);
              }}
              className="hidden"
              data-testid="dashboard-suggestion-attachment-input"
            />
          </label>
          {attachment && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-[#2C2C2C] bg-white border border-[#E8E6E1] rounded-full pl-3 pr-1 py-0.5"
              data-testid="dashboard-suggestion-attachment-chip"
              title={attachment.name}
            >
              <span className="truncate max-w-[18ch]">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                data-testid="dashboard-suggestion-attachment-remove"
                className="w-5 h-5 rounded-full hover:bg-[#FBFAF6] flex items-center justify-center text-[#6B705C] hover:text-[#6B46C1]"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <span className="text-[10px] text-[#6B705C] ml-auto">Max 10 MB · any file</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link
            to="/suggestions"
            data-testid="dashboard-suggestion-view-board"
            className="text-xs text-[#6B705C] hover:text-[#6B46C1] inline-flex items-center gap-1"
          >
            View &amp; upvote the board <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            data-testid="dashboard-suggestion-submit"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? "Sending…" : "Send suggestion"}
          </button>
        </div>
      </form>

      {lastSent && (
        <p
          className="text-xs text-[#6B705C] mt-3 italic"
          data-testid="dashboard-suggestion-last-sent"
        >
          Sent: “{lastSent.title}”.{" "}
          <Link to="/suggestions" className="underline hover:text-[#6B46C1]">Track it on the board →</Link>
        </p>
      )}
    </section>
  );
}
