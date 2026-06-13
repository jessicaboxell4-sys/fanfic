/**
 * AO3 / FF.net metadata filter chips for the library view.
 *
 * Surfaces 3 filter dimensions added in 2026-06-13:
 *   • Rating (single-select)
 *   • Category (single-select; AO3's F/F, F/M, Gen, M/M, Multi, Other)
 *   • Warning — with two modes: "must include" and "must not include"
 *     (the second is the content-safety opt-out)
 *
 * Parent passes current values + a single ``onChange(patch)`` callback;
 * a "Clear" button on each row wipes that row's selection. Designed to
 * collapse to nothing visible when nothing's set, so it stays
 * unobtrusive for users who don't care.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronUp, X as XIcon, ShieldAlert, BookmarkPlus, Loader2, Pin } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";


function SaveAsShelfModal({ open, name, setName, pinned, setPinned, onCancel, onSave, saving }) {
  if (!open) return null;
  const submit = (e) => {
    e?.preventDefault?.();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed.slice(0, 64), pinned });
  };
  return (
    <div
      data-testid="ao3-save-shelf-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}
    >
      <form
        onSubmit={submit}
        className="bg-[#FAF6EE] rounded-2xl shadow-2xl border border-[#6B46C1]/30 w-full max-w-md flex flex-col"
      >
        <div className="flex items-start gap-3 p-5 border-b border-[#6B46C1]/20">
          <div className="w-9 h-9 rounded-lg bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <BookmarkPlus className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-xl text-[#2C2C2C] leading-tight">Save as Smart Shelf</h2>
            <p className="text-xs text-[#6B705C] mt-1">Filter rules from the active AO3 chips will become this shelf&apos;s query.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            data-testid="ao3-save-shelf-close"
            className="text-[#6B705C] hover:text-[#2C2C2C] p-1 rounded disabled:opacity-50"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-[#3A3A3A]">Shelf name</span>
            <input
              type="text"
              autoFocus
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="ao3-save-shelf-name-input"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E8E6E1] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/40 focus:border-[#6B46C1]"
            />
            <span className="text-[10px] text-[#6B705C] mt-1 block">{name.length}/64</span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              data-testid="ao3-save-shelf-pin-checkbox"
              className="mt-0.5 w-4 h-4 rounded border-[#E8E6E1] text-[#6B46C1] focus:ring-[#6B46C1]/40 accent-[#6B46C1]"
            />
            <span className="text-sm text-[#2C2C2C]">
              <span className="inline-flex items-center gap-1 font-medium"><Pin className="w-3 h-3" /> Pin to dashboard sidebar</span>
              <span className="block text-xs text-[#6B705C] mt-0.5">Surfaces this shelf in the &ldquo;Shelves&rdquo; rail on your dashboard for one-click filtering.</span>
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            data-testid="ao3-save-shelf-cancel"
            className="px-3 py-1.5 text-sm rounded-lg text-[#6B705C] hover:bg-[#EDE7FB] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            data-testid="ao3-save-shelf-submit"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Save shelf"}
          </button>
        </div>
      </form>
    </div>
  );
}

const RATINGS = [
  { v: "General Audiences", label: "G", title: "General Audiences" },
  { v: "Teen And Up Audiences", label: "T", title: "Teen And Up" },
  { v: "Mature", label: "M", title: "Mature" },
  { v: "Explicit", label: "E", title: "Explicit" },
  { v: "Not Rated", label: "NR", title: "Not Rated" },
];

const CATEGORIES = ["F/F", "F/M", "Gen", "M/M", "Multi", "Other"];

const WARNINGS = [
  "Graphic Depictions Of Violence",
  "Major Character Death",
  "Rape/Non-Con",
  "Underage",
  "No Archive Warnings Apply",
  "Choose Not To Use Archive Warnings",
];

export default function Ao3FilterChips({ value, onChange, onShelfSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalName, setModalName] = useState("");
  const [modalPinned, setModalPinned] = useState(false);
  const v = value || {};
  const anyActive = !!(v.rating || v.ao3_category || v.warning || v.exclude_warning);

  const patch = (k, val) => onChange({ ...v, [k]: val });
  const clear = (k) => onChange({ ...v, [k]: null });
  const clearAll = () => onChange({ rating: null, ao3_category: null, warning: null, exclude_warning: null });

  // Pre-fill a human-readable shelf name from the active filters so the
  // user can hit Enter without typing.
  const suggestedName = (() => {
    const parts = [];
    if (v.rating) parts.push(v.rating);
    if (v.ao3_category) parts.push(v.ao3_category);
    if (v.warning) parts.push(`+ ${v.warning}`);
    if (v.exclude_warning) parts.push(`no ${v.exclude_warning}`);
    return parts.join(" · ").slice(0, 64);
  })();

  const handleSave = async ({ name, pinned }) => {
    const rules = [];
    if (v.rating) rules.push({ field: "rating", value: v.rating });
    if (v.ao3_category) rules.push({ field: "ao3_category", value: v.ao3_category });
    if (v.warning) rules.push({ field: "warning", value: v.warning });
    if (v.exclude_warning) rules.push({ field: "exclude_warning", value: v.exclude_warning });
    setSaving(true);
    try {
      await api.post("/smart-shelves", {
        name,
        query: { combinator: "AND", rules },
        pinned: !!pinned,
      });
      toast.success(
        pinned
          ? `Saved "${name.slice(0, 32)}" and pinned to your sidebar.`
          : `Saved "${name.slice(0, 32)}" as a shelf.`,
      );
      setModalOpen(false);
      if (typeof onShelfSaved === "function") onShelfSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save shelf");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[#E8E2D4] rounded-xl bg-white p-3 mb-4" data-testid="ao3-filter-chips">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between text-sm text-[#2C2C2C]"
        data-testid="ao3-filter-toggle"
      >
        <span className="font-medium inline-flex items-center gap-2">
          AO3 filters
          {anyActive && (
            <span className="text-xs bg-[#6B46C1] text-white px-2 py-0.5 rounded-full" data-testid="ao3-filter-active-count">
              {[v.rating, v.ao3_category, v.warning, v.exclude_warning].filter(Boolean).length} active
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3" data-testid="ao3-filter-panel">
          {/* Rating */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#6B705C]">Rating</span>
              {v.rating && <button type="button" onClick={() => clear("rating")} className="text-xs text-[#6B46C1] hover:underline">clear</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RATINGS.map((r) => (
                <button
                  key={r.v}
                  type="button"
                  onClick={() => patch("rating", v.rating === r.v ? null : r.v)}
                  title={r.title}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono border ${
                    v.rating === r.v
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-white text-[#2C2C2C] border-[#E8E2D4] hover:bg-[#F7F4EE]"
                  }`}
                  data-testid={`ao3-rating-${r.label}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#6B705C]">Category</span>
              {v.ao3_category && <button type="button" onClick={() => clear("ao3_category")} className="text-xs text-[#6B46C1] hover:underline">clear</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patch("ao3_category", v.ao3_category === c ? null : c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono border ${
                    v.ao3_category === c
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-white text-[#2C2C2C] border-[#E8E2D4] hover:bg-[#F7F4EE]"
                  }`}
                  data-testid={`ao3-category-${c.replace(/\//g, "")}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Warning - show only */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#6B705C]">Show only books warned for</span>
              {v.warning && <button type="button" onClick={() => clear("warning")} className="text-xs text-[#6B46C1] hover:underline">clear</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WARNINGS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => patch("warning", v.warning === w ? null : w)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${
                    v.warning === w
                      ? "bg-amber-200 text-amber-900 border-amber-400"
                      : "bg-white text-[#2C2C2C] border-[#E8E2D4] hover:bg-[#F7F4EE]"
                  }`}
                  data-testid={`ao3-warning-${w.split(" ").slice(0,2).join("-").toLowerCase()}`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {/* Warning - exclude (content-safety) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-red-700 inline-flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                Hide books warned for
              </span>
              {v.exclude_warning && <button type="button" onClick={() => clear("exclude_warning")} className="text-xs text-[#6B46C1] hover:underline">clear</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WARNINGS.filter((w) => w !== "No Archive Warnings Apply").map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => patch("exclude_warning", v.exclude_warning === w ? null : w)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${
                    v.exclude_warning === w
                      ? "bg-red-100 text-red-800 border-red-300"
                      : "bg-white text-[#2C2C2C] border-[#E8E2D4] hover:bg-[#F7F4EE]"
                  }`}
                  data-testid={`ao3-exclude-${w.split(" ").slice(0,2).join("-").toLowerCase()}`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {anyActive && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setModalName(suggestedName); setModalPinned(false); setModalOpen(true); }}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid="ao3-filter-save-shelf"
                title="Save this filter as a Smart Shelf"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
                {saving ? "Saving…" : "Save as shelf"}
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-[#6B705C] hover:text-[#6B46C1] underline inline-flex items-center gap-1"
                data-testid="ao3-filter-clear-all"
              >
                <XIcon className="w-3 h-3" /> clear all AO3 filters
              </button>
            </div>
          )}
        </div>
      )}
      <SaveAsShelfModal
        open={modalOpen}
        name={modalName}
        setName={setModalName}
        pinned={modalPinned}
        setPinned={setModalPinned}
        saving={saving}
        onCancel={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
