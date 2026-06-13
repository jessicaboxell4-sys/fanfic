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
import { ChevronDown, ChevronUp, X as XIcon, ShieldAlert, BookmarkPlus, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

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
  const v = value || {};
  const anyActive = !!(v.rating || v.ao3_category || v.warning || v.exclude_warning);

  const patch = (k, val) => onChange({ ...v, [k]: val });
  const clear = (k) => onChange({ ...v, [k]: null });
  const clearAll = () => onChange({ rating: null, ao3_category: null, warning: null, exclude_warning: null });

  const saveAsShelf = async () => {
    if (!anyActive) return;
    // Build a human-readable default name so the prompt is one Enter away.
    const parts = [];
    if (v.rating) parts.push(v.rating);
    if (v.ao3_category) parts.push(v.ao3_category);
    if (v.warning) parts.push(`+ ${v.warning}`);
    if (v.exclude_warning) parts.push(`no ${v.exclude_warning}`);
    const suggested = parts.join(" · ").slice(0, 64);
    const name = window.prompt("Name this shelf", suggested);
    if (!name || !name.trim()) return;
    const rules = [];
    if (v.rating) rules.push({ field: "rating", value: v.rating });
    if (v.ao3_category) rules.push({ field: "ao3_category", value: v.ao3_category });
    if (v.warning) rules.push({ field: "warning", value: v.warning });
    if (v.exclude_warning) rules.push({ field: "exclude_warning", value: v.exclude_warning });
    setSaving(true);
    try {
      await api.post("/smart-shelves", {
        name: name.trim().slice(0, 64),
        query: { combinator: "AND", rules },
        pinned: false,
      });
      toast.success(`Saved as shelf "${name.trim().slice(0, 32)}". Pin it from Shelves to surface it on the dashboard.`);
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
                onClick={saveAsShelf}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#6B46C1] text-white hover:bg-[#2C4730] disabled:opacity-60 disabled:cursor-not-allowed"
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
    </div>
  );
}
