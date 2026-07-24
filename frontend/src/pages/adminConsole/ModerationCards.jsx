/**
 * ModerationCards — extracted 2026-08-18 from AdminConsole.jsx.
 *
 * Cards: FeedbackInboxCard, HelpFeedbackCard, SignupRulesCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { Check, Edit, Image, Loader2, MessageSquare, Paperclip, Save, Send, ShieldCheck, X as XIcon } from "lucide-react";
import { Card, fmtBytes, fmtTime, fmtAgo } from "./shared";
import { ImageIconAlias, InviteLinksWidget, CampaignStatsWidget, StatList } from "./widgets";
import OneTimeTip from "../../components/OneTimeTip";

export function FeedbackInboxCard() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("open"); // open | under_review | planned | done | declined | all
  const [loading, setLoading] = useState(true);
  const [openCount, setOpenCount] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // 2026-06-27 — Show/hide test-fixture rows in the inbox.  Defaults
  // to OFF (real-user view) so TEST_ship_* / TEST_dbg noise from
  // integration tests stays out of the admin's eyeline.  Toggle is
  // persisted to localStorage so an admin who flipped it ON for
  // debugging stays in that mode across reloads.
  const [includeTests, setIncludeTests] = useState(() => {
    try { return localStorage.getItem("admin.feedback.include_tests") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("admin.feedback.include_tests", includeTests ? "1" : "0"); }
    catch { /* ignore */ }
  }, [includeTests]);
  // Mark-Shipped modal state.  `shipItem` is the suggestion row being
  // shipped (null = modal closed); the modal collects admin_note + a
  // "send celebration email" checkbox before PUT-ing status=done in
  // one go.  Combines what used to be 3 separate admin steps.
  const [shipItem, setShipItem] = useState(null);
  const [shipNote, setShipNote] = useState("");
  const [shipSendEmail, setShipSendEmail] = useState(true);
  const [shipBusy, setShipBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter === "all" ? {} : { status: filter };
      if (includeTests) params.include_tests = true;
      const [{ data: list }, { data: count }] = await Promise.all([
        api.get("/suggestions", { params }),
        api.get("/admin/suggestions/open-count", { params: includeTests ? { include_tests: true } : {} }),
      ]);
      setItems(list?.suggestions || []);
      setOpenCount(count?.open || 0);
    } catch { toast.error("Couldn't load feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, includeTests]);

  const setStatus = async (sid, status) => {
    setBusyId(sid);
    try {
      await api.put(`/admin/suggestions/${sid}`, { status });
      toast.success(`Marked ${status.replace("_", " ")}`);
      // Optimistic: drop the item from the current view if filter no longer matches
      if (filter !== "all" && filter !== status) {
        setItems(items.filter((i) => i.suggestion_id !== sid));
        if (status !== "open") setOpenCount(Math.max(0, openCount - 1));
      } else {
        setItems(items.map((i) => i.suggestion_id === sid ? { ...i, status } : i));
      }
    } catch { toast.error("Couldn't update"); }
    finally { setBusyId(null); }
  };

  // Mark Shipped flow — opens a small modal so admin can attach a
  // public-facing changelog note + choose whether to fire the
  // celebration email, all in one click (used to be 3 steps).
  const openShipModal = (it) => {
    setShipItem(it);
    setShipNote(it.admin_note || "");
    // Default ON unless we've already sent the credit email for this
    // suggestion (re-shipping = no double notification).
    setShipSendEmail(!it.shipped_credit_sent_at);
  };
  const closeShipModal = () => {
    if (shipBusy) return; // don't drop the modal mid-request
    setShipItem(null);
    setShipNote("");
    setShipSendEmail(true);
  };
  const submitShip = async () => {
    if (!shipItem) return;
    setShipBusy(true);
    const sid = shipItem.suggestion_id;
    try {
      const trimmed = shipNote.trim();
      await api.put(`/admin/suggestions/${sid}`, {
        status: "done",
        admin_note: trimmed || null,
        skip_email: !shipSendEmail,
      });
      toast.success(shipSendEmail ? "🚢 Shipped — celebration email sent" : "🚢 Shipped — email skipped");
      // Same optimistic-update rules as setStatus().
      if (filter !== "all" && filter !== "done") {
        setItems(items.filter((i) => i.suggestion_id !== sid));
        setOpenCount(Math.max(0, openCount - 1));
      } else {
        setItems(items.map((i) => i.suggestion_id === sid ? { ...i, status: "done", admin_note: trimmed || null } : i));
      }
      setShipItem(null);
      setShipNote("");
      setShipSendEmail(true);
    } catch (err) {
      // Surface the real server reason instead of a generic toast so
      // admins aren't left wondering why nothing happened (review
      // finding from iteration_46).
      const detail = err?.response?.data?.detail || err?.message || "Try again.";
      toast.error(`Couldn't mark shipped — ${detail}`);
    } finally {
      setShipBusy(false);
    }
  };

  const statusBadge = (s) => {
    const map = {
      open: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Open" },
      under_review: { bg: "bg-[#F5F0E0]", fg: "text-[#8B4F00]", label: "Reviewing" },
      planned: { bg: "bg-[#E8EEF5]", fg: "text-[#3A5A8C]", label: "Planned" },
      done: { bg: "bg-[#EEF3EC]", fg: "text-[#1F4D2A]", label: "Done" },
      declined: { bg: "bg-[#F5F3EC]", fg: "text-[#5B5F4D]", label: "Declined" },
    };
    const t = map[s] || map.open;
    return <span className={`px-2 py-0.5 rounded-full ${t.bg} ${t.fg} text-xs font-medium`}>{t.label}</span>;
  };

  const cat = (c) => ({
    bug: { fg: "text-[#B43F26]", label: "Bug" },
    improvement: { fg: "text-[#3A5A8C]", label: "Tweak" },
    feature: { fg: "text-[#6B46C1]", label: "Feature" },
  }[c] || { fg: "text-[#5B5F4D]", label: c });

  return (
    <Card
      icon={MessageSquare}
      title={`Feedback inbox${openCount > 0 ? ` (${openCount} open)` : ""}`}
      subtitle="Bugs, tweaks, and feature requests from your users."
      testid="admin-feedback-inbox-card"
    >
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="feedback-filter-row">
        {[
          ["open", "Open"],
          ["under_review", "Reviewing"],
          ["planned", "Planned"],
          ["done", "Done"],
          ["declined", "Declined"],
          ["all", "All"],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            data-testid={`feedback-filter-${val}`}
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
              filter === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
            }`}
          >
            {lbl}
          </button>
        ))}
        {/* 2026-06-27 — Test-fixture toggle.  Off by default so the
            inbox shows only real-user feedback; flip ON to debug
            fixture leakage / verify integration-test rows landed
            correctly.  Sits at the end of the chip row with a
            distinct amber tint so it doesn't read as a status. */}
        <button
          type="button"
          onClick={() => setIncludeTests((v) => !v)}
          aria-pressed={includeTests}
          data-testid="feedback-toggle-include-tests"
          title={includeTests
            ? "Hide TEST_ fixture rows from agent/test users"
            : "Show TEST_ fixture rows submitted by test/agent accounts"}
          className={`ml-auto px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
            includeTests
              ? "bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]/30"
              : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4] border border-transparent"
          }`}
        >
          {includeTests ? "🧪 Tests: shown" : "🧪 Tests: hidden"}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> No {filter === "all" ? "" : filter.replace("_", " ")} feedback right now.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="feedback-list">
          {items.map((it) => {
            const c = cat(it.category);
            const open = expanded === it.suggestion_id;
            return (
              <li
                key={it.suggestion_id}
                className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
                data-testid={`feedback-row-${it.suggestion_id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold uppercase tracking-[0.15em] ${c.fg}`}>{c.label}</span>
                      {statusBadge(it.status)}
                      <span className="text-xs text-[#5B5F4D]">· {it.votes_count} vote{it.votes_count === 1 ? "" : "s"}</span>
                      {it.has_attachment && (() => {
                        // Pick a label + accent based on MIME family
                        // so admins can spot screenshots vs log dumps
                        // at a glance before they expand the row.
                        const mime = (it.attachment_mime || "").toLowerCase();
                        let label = "file";
                        let tone = "bg-[#EEE9FB] text-[#6B46C1] border-[#6B46C1]/30";
                        if (mime.startsWith("image/")) {
                          label = "image";
                          tone = "bg-emerald-50 text-emerald-800 border-emerald-300";
                        } else if (mime.includes("pdf")) {
                          label = "pdf";
                          tone = "bg-rose-50 text-rose-800 border-rose-300";
                        } else if (
                          mime.startsWith("text/") ||
                          mime.includes("log") ||
                          mime.includes("json") ||
                          mime.includes("csv")
                        ) {
                          label = "log";
                          tone = "bg-amber-50 text-amber-800 border-amber-300";
                        } else if (
                          mime.includes("zip") ||
                          mime.includes("compressed") ||
                          mime.includes("tar") ||
                          mime.includes("octet-stream")
                        ) {
                          label = "zip";
                          tone = "bg-slate-100 text-slate-700 border-slate-300";
                        }
                        return (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] border rounded-full px-2 py-0.5 ${tone}`}
                            data-testid={`feedback-attachment-badge-${it.suggestion_id}`}
                            data-mime-family={label}
                            title={`Attachment: ${it.attachment_name || ""} (${it.attachment_mime || "unknown"})`}
                          >
                            <Paperclip className="w-2.5 h-2.5" /> {label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="font-medium text-[#2C2C2C] mt-1">{it.title}</p>
                    <p className="text-xs text-[#5B5F4D] mt-0.5">
                      {it.submitter_name || it.submitter_email || "Anonymous"} · {fmtTime(it.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpanded(open ? null : it.suggestion_id)}
                    data-testid={`feedback-expand-${it.suggestion_id}`}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553B96]"
                  >
                    {open ? "Hide" : "Show"}
                  </button>
                </div>
                {open && (
                  <div className="mt-3 pt-3 border-t border-[#E5DDC5]">
                    {it.body ? (
                      <p className="text-sm text-[#2C2C2C] whitespace-pre-wrap mb-3">{it.body}</p>
                    ) : (
                      <p className="text-sm text-[#5B5F4D] italic mb-3">No description.</p>
                    )}
                    {it.has_attachment && (
                      <div className="mb-3" data-testid={`feedback-attachment-${it.suggestion_id}`}>
                        <a
                          href={`${process.env.REACT_APP_BACKEND_URL}/api/suggestions/${it.suggestion_id}/attachment`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[#6B46C1] bg-white border border-[#E5DDC5] rounded-full px-2.5 py-1 hover:border-[#6B46C1]"
                          data-testid={`feedback-attachment-open-${it.suggestion_id}`}
                          title={it.attachment_name || "attachment"}
                        >
                          <Paperclip className="w-3 h-3" />
                          <span className="truncate max-w-[22ch]">{it.attachment_name || "attachment"}</span>
                          {it.attachment_size ? (
                            <span className="text-[10px] text-[#5B5F4D]">
                              {it.attachment_size < 1024 * 1024
                                ? `${Math.round(it.attachment_size / 1024)} KB`
                                : `${(it.attachment_size / 1024 / 1024).toFixed(1)} MB`}
                            </span>
                          ) : null}
                        </a>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Primary action: ship the suggestion in one
                          modal click (status=done + admin_note +
                          celebration email).  Hidden when the
                          suggestion is already done — admin can still
                          change status via the secondary chips below. */}
                      {it.status !== "done" && (
                        <button
                          onClick={() => openShipModal(it)}
                          disabled={busyId === it.suggestion_id || shipBusy}
                          data-testid={`feedback-mark-shipped-${it.suggestion_id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#6B46C1] hover:bg-[#553B96] text-white text-xs font-semibold disabled:opacity-60 transition-colors"
                        >
                          <Send className="w-3 h-3" /> Mark shipped
                        </button>
                      )}
                      {["under_review", "planned", "done", "declined", "open"]
                        .filter((s) => s !== it.status && s !== "done")
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() => setStatus(it.suggestion_id, s)}
                            disabled={busyId === it.suggestion_id}
                            data-testid={`feedback-status-${it.suggestion_id}-${s}`}
                            className="px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#2C2C2C] text-xs disabled:opacity-60 capitalize"
                          >
                            → {s.replace("_", " ")}
                          </button>
                        ))}
                      {it.status === "done" && (
                        // Once shipped, allow re-opening via the same
                        // chip row.  Less-common path so it sits as a
                        // de-emphasized chip.
                        <button
                          onClick={() => setStatus(it.suggestion_id, "open")}
                          disabled={busyId === it.suggestion_id}
                          data-testid={`feedback-status-${it.suggestion_id}-open`}
                          className="px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#2C2C2C] text-xs disabled:opacity-60 capitalize"
                        >
                          → open
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* Mark Shipped modal — opens from the primary button on each
          row.  Combines status=done + admin_note + email-checkbox so
          the most-rewarding admin action is one click + one submit. */}
      {shipItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeShipModal}
          data-testid="feedback-ship-modal-backdrop"
        >
          <div
            className="bg-[#FBF7EE] dark:bg-zinc-900 rounded-2xl shadow-2xl border border-[#E5DDC5] dark:border-zinc-700 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-ship-modal-title"
            data-testid="feedback-ship-modal"
          >
            <div className="p-5 border-b border-[#E5DDC5] dark:border-zinc-700 flex items-start justify-between gap-3">
              <div>
                <h3 id="feedback-ship-modal-title" className="font-serif text-lg text-[#2C2C2C] dark:text-zinc-100 flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#6B46C1]" /> Mark suggestion shipped
                </h3>
                <p className="text-xs text-[#5B5F4D] mt-1 truncate max-w-[36ch]" title={shipItem.title}>
                  &ldquo;{shipItem.title}&rdquo;
                </p>
              </div>
              <button
                onClick={closeShipModal}
                disabled={shipBusy}
                className="text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50 p-1 -m-1"
                aria-label="Close"
                data-testid="feedback-ship-modal-close"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label htmlFor="feedback-ship-note" className="block text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-1.5">
                  Public note (optional)
                </label>
                <textarea
                  id="feedback-ship-note"
                  value={shipNote}
                  onChange={(e) => setShipNote(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder='e.g. "Now ships with iPhone Safari support."'
                  disabled={shipBusy}
                  className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-[#2C2C2C] dark:text-zinc-100 placeholder-[#A5A29A] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/40 resize-none"
                  data-testid="feedback-ship-note-input"
                />
                <p className="text-[11px] text-[#5B5F4D] mt-1">
                  Shown publicly on the <span className="font-medium">/changelog</span> credit row.
                </p>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none" data-testid="feedback-ship-email-label">
                <input
                  type="checkbox"
                  checked={shipSendEmail}
                  onChange={(e) => setShipSendEmail(e.target.checked)}
                  disabled={shipBusy || !!shipItem.shipped_credit_sent_at}
                  className="mt-1 w-4 h-4 accent-[#6B46C1]"
                  data-testid="feedback-ship-email-checkbox"
                />
                <span className="text-sm text-[#2C2C2C] dark:text-zinc-100">
                  Send celebration email to <span className="font-medium">{shipItem.submitter_name || shipItem.submitter_email || "submitter"}</span>
                  {shipItem.shipped_credit_sent_at ? (
                    <span className="block text-[11px] text-[#5B5F4D] mt-0.5 italic">
                      Already sent — re-shipping won&rsquo;t notify again.
                    </span>
                  ) : (
                    <span className="block text-[11px] text-[#5B5F4D] mt-0.5">
                      Fires the &ldquo;Your idea shipped!&rdquo; email (once per suggestion).
                    </span>
                  )}
                </span>
              </label>
            </div>
            <div className="p-5 pt-3 border-t border-[#E5DDC5] dark:border-zinc-700 flex items-center justify-end gap-2">
              <button
                onClick={closeShipModal}
                disabled={shipBusy}
                className="px-4 py-1.5 rounded-full text-sm text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50"
                data-testid="feedback-ship-modal-cancel"
              >
                Cancel
              </button>
              <button
                onClick={submitShip}
                disabled={shipBusy}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#6B46C1] hover:bg-[#553B96] text-white text-sm font-semibold disabled:opacity-60 transition-colors"
                data-testid="feedback-ship-modal-submit"
              >
                {shipBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {shipBusy ? "Shipping…" : "Ship it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// HelpFeedbackCard — Help-page SuggestionBox feed
// ---------------------------------------------------------------------------
// Distinct from FeedbackInboxCard (which sits on the older `/api/suggestions`
// product board with titles/votes/categories). This card surfaces the
// short-form Help-page SuggestionBox stream: free-text + optional screenshot,
// grouped by the page the user was on when they wrote it.  The aggregation
// widget on top reveals which routes generate the most friction; clicking
// a row drills into that page's entries below.

export function HelpFeedbackCard() {
  const [byPage, setByPage] = useState([]);
  const [rows, setRows] = useState([]);
  // 2026-07-01 — Match FeedbackInboxCard's full status filter row so
  // Help-page friction reports move through the same open →
  // reviewing → planned → done / declined lifecycle.  Was previously
  // just [open | all] before the operator experience unification.
  const [status, setStatus] = useState("open"); // open | under_review | planned | done | declined | all
  const [pageFilter, setPageFilter] = useState(""); // "" = all pages
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // 2026-06-27 — Help-page feedback is also polluted by integration
  // tests posting placeholder text from agent-account submitters
  // (@example.com / user_* / etc.).  Mirror the FeedbackInboxCard
  // toggle so admins see the real-user friction queue by default.
  const [includeTests, setIncludeTests] = useState(() => {
    try { return localStorage.getItem("admin.helpfeedback.include_tests") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("admin.helpfeedback.include_tests", includeTests ? "1" : "0"); }
    catch { /* ignore */ }
  }, [includeTests]);

  const load = async () => {
    setLoading(true);
    try {
      const statusParam = status === "all" ? "" : status;
      const baseParams = { status: statusParam, ...(includeTests ? { include_tests: true } : {}) };
      const [{ data: agg }, { data: list }] = await Promise.all([
        api.get("/admin/feedback/by-page", { params: { ...baseParams, limit: 30 } }),
        api.get("/admin/feedback", { params: { ...baseParams, page: pageFilter || undefined, limit: 100 } }),
      ]);
      setByPage(agg?.rows || []);
      setRows(list?.rows || []);
    } catch { toast.error("Couldn't load help feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, pageFilter, includeTests]);

  const totalCount = byPage.reduce((s, r) => s + (r.count || 0), 0);

  const setRowStatus = async (fid, newStatus) => {
    if (!fid) return;
    setBusyId(fid);
    try {
      await api.put(`/admin/feedback/${fid}`, { status: newStatus });
      toast.success(`Marked ${newStatus.replace("_", " ")}`);
      // Optimistic: drop the row from the current view if the filter
      // no longer matches, otherwise update in place.
      if (status !== "all" && status !== newStatus) {
        setRows(rows.filter((r) => r.feedback_id !== fid));
      } else {
        setRows(rows.map((r) => r.feedback_id === fid ? { ...r, status: newStatus } : r));
      }
    } catch { toast.error("Couldn't update"); }
    finally { setBusyId(null); }
  };

  // Shared status pill — same palette as FeedbackInboxCard so operators
  // read both inboxes at a glance without re-learning the colors.
  const statusBadge = (s) => {
    const map = {
      open: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Open" },
      under_review: { bg: "bg-[#F5F0E0]", fg: "text-[#8B4F00]", label: "Reviewing" },
      planned: { bg: "bg-[#E8EEF5]", fg: "text-[#3A5A8C]", label: "Planned" },
      done: { bg: "bg-[#EEF3EC]", fg: "text-[#1F4D2A]", label: "Done" },
      declined: { bg: "bg-[#F5F3EC]", fg: "text-[#5B5F4D]", label: "Declined" },
    };
    const t = map[s] || map.open;
    return <span className={`px-2 py-0.5 rounded-full ${t.bg} ${t.fg} text-xs font-medium`}>{t.label}</span>;
  };

  return (
    <Card
      icon={MessageSquare}
      title={`Help-page feedback${totalCount > 0 ? ` (${totalCount})` : ""}`}
      subtitle="Free-text + screenshot reports from the Help page, grouped by where the user was."
      testid="admin-help-feedback-card"
    >
      {/* 2026-07-01 — Announce the new lifecycle chips + per-row status
          transitions to existing admins.  Uses the shared `OneTimeTip`
          pattern so it self-dismisses on first click. */}
      <OneTimeTip tipKey="help-inbox-lifecycle-chips" title="New:" compact>
        Help-page reports now use the same lifecycle as the Feedback Inbox —
        filter by Reviewing / Planned / Done / Declined, and move rows
        through the pipeline with the transition chips inside each row.
      </OneTimeTip>
      {/* Status filter — mirrors the FeedbackInboxCard chip row so
          operators use one vocabulary across both admin inboxes. */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="help-feedback-filter-row">
        {[
          ["open", "Open"],
          ["under_review", "Reviewing"],
          ["planned", "Planned"],
          ["done", "Done"],
          ["declined", "Declined"],
          ["all", "All"],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => { setStatus(val); setPageFilter(""); setExpanded(null); }}
            data-testid={`help-feedback-status-${val}`}
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
              status === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
            }`}
          >
            {lbl}
          </button>
        ))}
        {pageFilter && (
          <button
            type="button"
            onClick={() => { setPageFilter(""); setExpanded(null); }}
            data-testid="help-feedback-clear-page"
            className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] bg-[#FBE9E5] text-[#B43F26] hover:bg-[#F6D7CE]"
          >
            <XIcon className="w-3 h-3" />
            Page: {pageFilter}
          </button>
        )}
        {/* 2026-06-27 — Tests toggle.  Sits at the end of the chip
            row (or right of the page-filter clear if visible).
            Distinct amber tint so it doesn't read as a status pill. */}
        <button
          type="button"
          onClick={() => setIncludeTests((v) => !v)}
          aria-pressed={includeTests}
          data-testid="help-feedback-toggle-include-tests"
          title={includeTests
            ? "Hide test-account submissions from the friction queue"
            : "Show test-account submissions (debug fixture leakage)"}
          className={`${pageFilter ? "" : "ml-auto"} px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
            includeTests
              ? "bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]/30"
              : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4] border border-transparent"
          }`}
        >
          {includeTests ? "🧪 Tests: shown" : "🧪 Tests: hidden"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {/* Per-page aggregation widget */}
          {byPage.length === 0 ? (
            <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5 mb-2" data-testid="help-feedback-empty">
              <Check className="w-3.5 h-3.5" /> No {status === "all" ? "" : status} feedback yet.
            </p>
          ) : (
            <div className="mb-5" data-testid="help-feedback-by-page">
              <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] font-bold mb-2">By page</p>
              <ul className="grid gap-1.5">
                {byPage.map((r) => {
                  const active = pageFilter === r.page;
                  return (
                    <li key={r.page || "(unknown)"}>
                      <button
                        type="button"
                        onClick={() => { setPageFilter(active ? "" : r.page); setExpanded(null); }}
                        data-testid={`help-feedback-page-${r.page || "unknown"}`}
                        className={`w-full flex items-center justify-between gap-3 text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#EDE6FA] border-[#6B46C1] text-[#2C2C2C]"
                            : "bg-[#FBFAF6] border-[#E5DDC5] hover:bg-[#F5F0E0] text-[#2C2C2C]"
                        }`}
                      >
                        <span className="truncate font-mono text-xs">{r.page || "(unknown)"}</span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          {r.with_photo > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D]">
                              <ImageIconAlias /> {r.with_photo}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold">{r.count}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Drill-down list */}
          {rows.length > 0 && (
            <div data-testid="help-feedback-list">
              <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] font-bold mb-2">
                {pageFilter ? `Entries on ${pageFilter}` : "Latest entries"} · {rows.length}
              </p>
              <ul className="space-y-2">
                {rows.map((r, idx) => {
                  const fid = r.feedback_id;
                  const id = fid || `${r.ts}-${idx}`;
                  const open = expanded === id;
                  const text = r.text || "";
                  const rowStatus = r.status || "open";
                  const alwaysExpandable = true;
                  return (
                    <li
                      key={id}
                      className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
                      data-testid={`help-feedback-row-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {statusBadge(rowStatus)}
                            <p className="text-xs text-[#5B5F4D] font-mono truncate">{r.page || "(unknown)"}</p>
                          </div>
                          <p className="text-sm text-[#2C2C2C] mt-1 line-clamp-2">{text}</p>
                          <p className="text-xs text-[#5B5F4D] mt-1">
                            {r.user_email || r.user_id || "anonymous"} · {fmtTime(r.ts)}
                            {r.photo_b64 && <span className="ml-2 text-[#6B46C1] font-bold">· photo</span>}
                          </p>
                        </div>
                        {alwaysExpandable && (
                          <button
                            onClick={() => setExpanded(open ? null : id)}
                            data-testid={`help-feedback-expand-${idx}`}
                            className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553B96] flex-shrink-0"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="mt-3 pt-3 border-t border-[#E5DDC5]">
                          <p className="text-sm text-[#2C2C2C] whitespace-pre-wrap mb-3">{text}</p>
                          {r.photo_b64 && (
                            <a
                              href={`data:${r.photo_mime || "image/png"};base64,${r.photo_b64}`}
                              target="_blank"
                              rel="noreferrer"
                              data-testid={`help-feedback-photo-${idx}`}
                            >
                              <img
                                src={`data:${r.photo_mime || "image/png"};base64,${r.photo_b64}`}
                                alt="attachment"
                                className="max-w-full max-h-80 rounded-md border border-[#E5DDC5] mb-3"
                              />
                            </a>
                          )}
                          {/* Per-row status transition chips — mirrors
                              FeedbackInboxCard so operators can move
                              friction reports through the same lifecycle
                              without leaving the admin console. */}
                          {fid && (
                            <div className="flex flex-wrap items-center gap-1.5" data-testid={`help-feedback-actions-${idx}`}>
                              {["under_review", "planned", "done", "declined", "open"]
                                .filter((s) => s !== rowStatus)
                                .map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => setRowStatus(fid, s)}
                                    disabled={busyId === fid}
                                    data-testid={`help-feedback-status-set-${idx}-${s}`}
                                    className="px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#2C2C2C] text-xs disabled:opacity-60 capitalize"
                                  >
                                    → {s.replace("_", " ")}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Tiny inline icon used in the aggregation row's "N with photo" badge.
// Defined locally so we don't have to re-import lucide's Image elsewhere
// (the file already imports MessageSquare etc., but not Image).

export function SignupRulesCard() {
  const [cfg, setCfg] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [draftRules, setDraftRules] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: c }, { data: s }] = await Promise.all([
        api.get("/admin/signup-config"),
        api.get("/admin/onboarding-stats"),
      ]);
      setCfg(c);
      setStats(s);
      setDraftRules(c?.rules_md || "");
    } catch { toast.error("Couldn't load sign-up config"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const patch = async (body) => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/signup-config", body);
      setCfg(data);
      if (body.rules_md !== undefined) setDraftRules(data.rules_md || "");
      toast.success("Saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSaving(false); }
  };

  return (
    <Card
      icon={ShieldCheck}
      title="Sign-up rules & questions"
      subtitle="Toggle the approval gate, onboarding questions, and edit the community rules."
      testid="admin-signup-rules-card"
    >
      {loading || !cfg ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Two toggles */}
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => patch({ approval_gate_enabled: !cfg.approval_gate_enabled })}
              disabled={saving}
              data-testid="signup-toggle-approval-gate"
              className={`text-left rounded-xl border p-3 transition-colors ${
                cfg.approval_gate_enabled
                  ? "bg-[#EDE6FA] dark:bg-purple-900/40 border-[#6B46C1] text-[#2C2C2C] dark:text-purple-50"
                  : "bg-[#FBFAF6] dark:bg-zinc-800/60 border-[#E5DDC5] dark:border-zinc-700 hover:border-[#6B46C1] text-[#2C2C2C] dark:text-zinc-100"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                Approval gate
              </p>
              <p className="font-medium mt-1">
                {cfg.approval_gate_enabled ? "ON — admin reviews every sign-up" : "OFF — auto-approve everyone"}
              </p>
              <p className="text-xs text-[#3F4034] dark:text-zinc-400 mt-1.5">
                {cfg.approval_gate_enabled
                  ? "Click to disable: new users land in the library immediately."
                  : "Click to re-enable: new users queue for admin review."}
              </p>
            </button>

            <button
              type="button"
              onClick={() => patch({ questions_enabled: !cfg.questions_enabled })}
              disabled={saving}
              data-testid="signup-toggle-questions"
              className={`text-left rounded-xl border p-3 transition-colors ${
                cfg.questions_enabled
                  ? "bg-[#EDE6FA] dark:bg-purple-900/40 border-[#6B46C1] text-[#2C2C2C] dark:text-purple-50"
                  : "bg-[#FBFAF6] dark:bg-zinc-800/60 border-[#E5DDC5] dark:border-zinc-700 hover:border-[#6B46C1] text-[#2C2C2C] dark:text-zinc-100"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                Onboarding questions
              </p>
              <p className="font-medium mt-1">
                {cfg.questions_enabled ? "ON — questions shown at sign-up" : "OFF — skip onboarding"}
              </p>
              <p className="text-xs text-[#3F4034] dark:text-zinc-400 mt-1.5">
                {cfg.questions_enabled
                  ? "Click to stop asking — keeps signed-up users' existing answers."
                  : "Click to start collecting referral, fandom, reader-type, age."}
              </p>
            </button>
          </div>

          {/* Onboarding-answer aggregation */}
          {cfg.questions_enabled && stats && (
            <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-onboarding-stats">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                  Onboarding answers
                </p>
                <p className="text-xs text-[#5B5F4D] dark:text-zinc-400">
                  {stats.total_with_onboarding} user{stats.total_with_onboarding === 1 ? "" : "s"} answered
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatList title="How they found us" rows={stats.referral} testid="signup-stats-referral" />
                <StatList title="Reader type"        rows={stats.reader_type} testid="signup-stats-reader-type" />
                <StatList title="Top fandoms"        rows={stats.favorite_fandoms} testid="signup-stats-favorite-fandoms" />
                <div data-testid="signup-stats-age">
                  <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400 font-bold mb-1.5">Age</p>
                  <p className="text-sm text-[#2C2C2C] dark:text-zinc-100">
                    13+: <strong>{stats.age_13_plus}</strong> · Under 13: <strong>{stats.age_under_13}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tracked invite links (2026-06-18) */}
          <InviteLinksWidget />

          {/* Campaign conversion funnel (2026-06-19) — pairs with
              InviteLinksWidget above: shows how each tracked channel
              actually converts (signup → approved → uploaded → active). */}
          <CampaignStatsWidget />

          {/* Rules editor */}
          <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
                Community rules (markdown)
              </p>
              <a
                href="/rules"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#6B46C1] hover:text-[#553397] font-semibold"
                data-testid="signup-rules-view-link"
              >
                View public page →
              </a>
            </div>
            {editingRules ? (
              <>
                <textarea
                  value={draftRules}
                  onChange={(e) => setDraftRules(e.target.value)}
                  rows={14}
                  data-testid="signup-rules-textarea"
                  className="w-full text-sm font-mono bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/30 resize-y"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => { patch({ rules_md: draftRules }); setEditingRules(false); }}
                    disabled={saving || draftRules.trim().length < 20}
                    data-testid="signup-rules-save"
                    className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] disabled:opacity-60"
                  >
                    Save rules
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingRules(false); setDraftRules(cfg.rules_md || ""); }}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] hover:text-[#2C2C2C]"
                  >
                    Cancel
                  </button>
                  <span className="text-[10px] text-[#5B5F4D] ml-auto">{draftRules.length}/50000</span>
                </div>
              </>
            ) : (
              <>
                <pre className="text-xs text-[#2C2C2C] whitespace-pre-wrap line-clamp-6 mb-2" data-testid="signup-rules-preview">
                  {cfg.rules_md}
                </pre>
                <button
                  type="button"
                  onClick={() => setEditingRules(true)}
                  data-testid="signup-rules-edit"
                  className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553397]"
                >
                  Edit rules →
                </button>
              </>
            )}
            {cfg.updated_at && (
              <p className="text-[10px] text-[#5B5F4D] mt-2">
                Last updated {fmtTime(cfg.updated_at)}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// InviteLinksWidget — tracked-URL builder + copy buttons
// ---------------------------------------------------------------------------
// Hands the admin a one-click copy for ``?ref=<channel>`` invite URLs
// that pre-tag the new signup's onboarding.referral field.  Works
// regardless of whether the onboarding-questions toggle is on — the
// register handler falls through to a referral-only ``onboarding``
// payload when questions are off, so attribution survives both modes.

