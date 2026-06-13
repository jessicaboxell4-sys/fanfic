import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import TagInput from "../components/TagInput";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, Edit3, Pin, PinOff, X, Save, Filter,
  Sparkles, Tag as TagIcon, ArrowRight, Loader2,
} from "lucide-react";
import { RATINGS, CATEGORIES as AO3_CATEGORIES, WARNINGS } from "../components/Ao3FilterChips";

const DEFAULT_QUERY = { combinator: "AND", rules: [] };

const RULE_FIELDS = [
  { value: "tags_all", label: "Has all tags" },
  { value: "tags_any", label: "Has any tag" },
  { value: "tags_none", label: "Doesn't have tag" },
  { value: "category", label: "Category is" },
  { value: "fandom", label: "Fandom is" },
  { value: "author", label: "Author is" },
  { value: "status", label: "Status is" },
  { value: "words", label: "Word count" },
  // AO3 metadata — surface here so any shelf saved from the AO3 filter
  // chips is editable in the same builder. Mirrors the four backend
  // rule types added 2026-06-13.
  { value: "rating", label: "AO3 rating is" },
  { value: "ao3_category", label: "AO3 category is" },
  { value: "warning", label: "Has archive warning" },
  { value: "exclude_warning", label: "Hide archive warning" },
];

const STATUS_OPTIONS = [
  { value: "reading", label: "Currently reading" },
  { value: "finished", label: "Finished" },
  { value: "unread", label: "Not started" },
];

function RuleEditor({ rule, onChange, onRemove, tagSuggestions, fandomList, authorList, categories }) {
  const set = (patch) => onChange({ ...rule, ...patch });
  const field = rule.field;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-[#F5F3EC] border border-[#E8E6E1]">
      <select
        data-testid={`rule-field-${rule._id}`}
        value={field}
        onChange={(e) => {
          // Reset value/values when field type changes
          const f = e.target.value;
          const next = { _id: rule._id, field: f };
          if (["tags_all", "tags_any", "tags_none"].includes(f)) next.values = [];
          else if (f === "words") {
            next.min = "";
            next.max = "";
          } else next.value = "";
          onChange(next);
        }}
        className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm font-semibold"
      >
        {RULE_FIELDS.map((rf) => (
          <option key={rf.value} value={rf.value}>{rf.label}</option>
        ))}
      </select>

      {["tags_all", "tags_any", "tags_none"].includes(field) && (
        <div className="flex-1 min-w-[200px]">
          <TagInput
            value={rule.values || []}
            onChange={(values) => set({ values })}
            suggestions={tagSuggestions}
            placeholder="type tags…"
            testIdPrefix={`rule-tags-${rule._id}`}
          />
        </div>
      )}

      {field === "category" && (
        <select
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          className="flex-1 min-w-[160px] bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">— pick —</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {field === "fandom" && (
        <input
          type="text"
          list={`fandom-list-${rule._id}`}
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          placeholder="e.g. Harry Potter"
          className="flex-1 min-w-[160px] bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        />
      )}
      <datalist id={`fandom-list-${rule._id}`}>
        {fandomList.map((f) => <option key={f} value={f} />)}
      </datalist>

      {field === "author" && (
        <input
          type="text"
          list={`author-list-${rule._id}`}
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          placeholder="e.g. Ada Lovelace"
          className="flex-1 min-w-[160px] bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        />
      )}
      <datalist id={`author-list-${rule._id}`}>
        {authorList.map((a) => <option key={a} value={a} />)}
      </datalist>

      {field === "status" && (
        <select
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">— pick —</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}

      {field === "rating" && (
        <select
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">— pick —</option>
          {RATINGS.map((r) => <option key={r.v} value={r.v}>{r.title}</option>)}
        </select>
      )}

      {field === "ao3_category" && (
        <select
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">— pick —</option>
          {AO3_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {(field === "warning" || field === "exclude_warning") && (
        <select
          data-testid={`rule-value-${rule._id}`}
          value={rule.value || ""}
          onChange={(e) => set({ value: e.target.value })}
          className="flex-1 min-w-[200px] bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">— pick —</option>
          {WARNINGS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      )}

      {field === "words" && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="number"
            data-testid={`rule-min-${rule._id}`}
            value={rule.min ?? ""}
            placeholder="min"
            onChange={(e) => set({ min: e.target.value })}
            className="w-24 bg-white border border-[#E8E6E1] rounded-lg px-2 py-1.5 text-sm"
          />
          <span className="text-[#6B705C]">to</span>
          <input
            type="number"
            data-testid={`rule-max-${rule._id}`}
            value={rule.max ?? ""}
            placeholder="max"
            onChange={(e) => set({ max: e.target.value })}
            className="w-24 bg-white border border-[#E8E6E1] rounded-lg px-2 py-1.5 text-sm"
          />
          <span className="text-xs text-[#6B705C]">words</span>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        data-testid={`rule-remove-${rule._id}`}
        className="ml-auto text-[#6B705C] hover:text-[#D9534F] p-1.5"
        title="Remove rule"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function SmartShelfBuilder({ initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || "");
  const [combinator, setCombinator] = useState(initial?.query?.combinator || "AND");
  const [pinned, setPinned] = useState(initial?.pinned || false);
  const [rules, setRules] = useState(() => {
    const init = initial?.query?.rules || [];
    return init.map((r, i) => ({ ...r, _id: `rule_${i}_${Math.random().toString(36).slice(2, 7)}` }));
  });
  const [preview, setPreview] = useState({ count: null, sample: [] });
  const [tagSuggestions, setTagSuggestions] = useState([]);
  const [fandomList, setFandomList] = useState([]);
  const [authorList, setAuthorList] = useState([]);
  const [categories, setCategories] = useState(["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified"]);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [tg, st, au, cat] = await Promise.all([
          api.get("/tags"),
          api.get("/books/stats"),
          api.get("/authors"),
          api.get("/categories"),
        ]);
        setTagSuggestions((tg.data.tags || []).map((t) => t.name));
        setFandomList((st.data.fandoms || []).map((f) => f.name));
        setAuthorList((au.data.authors || []).map((a) => a.name));
        const customCats = cat.data.custom || [];
        setCategories(["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", ...customCats]);
      } catch (e) { /* non-critical */ }
    })();
  }, []);

  const buildQuery = useCallback(() => ({
    combinator,
    rules: rules.map(({ _id, ...rest }) => rest), // strip internal _id
  }), [combinator, rules]);

  // Live preview (debounced)
  useEffect(() => {
    const handle = setTimeout(async () => {
      setPreviewing(true);
      try {
        const { data } = await api.post("/smart-shelves/preview", { query: buildQuery() });
        setPreview(data);
      } catch (e) {
        setPreview({ count: null, sample: [] });
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [buildQuery]);

  const addRule = () => {
    setRules((rs) => [
      ...rs,
      { _id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, field: "tags_any", values: [] },
    ]);
  };

  const updateRule = (id, next) => setRules((rs) => rs.map((r) => (r._id === id ? next : r)));
  const removeRule = (id) => setRules((rs) => rs.filter((r) => r._id !== id));

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give your shelf a name");
      return;
    }
    setSaving(true);
    try {
      const body = { name: name.trim(), query: buildQuery(), pinned };
      let resp;
      if (initial?.shelf_id) {
        resp = await api.patch(`/smart-shelves/${initial.shelf_id}`, body);
      } else {
        resp = await api.post("/smart-shelves", body);
      }
      toast.success(initial ? "Shelf updated" : "Shelf created");
      onSaved && onSaved(resp.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#2C2C2C]/40 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="smart-shelf-builder-overlay"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#E8E6E1] flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1">Smart shelf</p>
            <h2 className="font-serif text-2xl text-[#2C2C2C]">
              {initial ? "Edit shelf" : "New smart shelf"}
            </h2>
          </div>
          <button onClick={onClose} data-testid="builder-close" className="w-9 h-9 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center text-[#6B705C]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="mb-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
              Name
            </label>
            <input
              type="text"
              data-testid="builder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Long fanfic WIPs"
              maxLength={64}
              className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
          </div>

          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Match</span>
              <select
                data-testid="builder-combinator"
                value={combinator}
                onChange={(e) => setCombinator(e.target.value)}
                className="bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 text-sm font-semibold"
              >
                <option value="AND">All rules (AND)</option>
                <option value="OR">Any rule (OR)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#2C2C2C] ml-auto">
              <input
                type="checkbox"
                data-testid="builder-pinned"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Pin to dashboard
            </label>
          </div>

          <div className="space-y-2 mb-4" data-testid="builder-rules">
            {rules.length === 0 && (
              <p className="text-sm text-[#6B705C] italic px-3">No rules yet — every book matches.</p>
            )}
            {rules.map((r) => (
              <RuleEditor
                key={r._id}
                rule={r}
                onChange={(next) => updateRule(r._id, next)}
                onRemove={() => removeRule(r._id)}
                tagSuggestions={tagSuggestions}
                fandomList={fandomList}
                authorList={authorList}
                categories={categories}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addRule}
            data-testid="builder-add-rule"
            className="btn-secondary text-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add rule
          </button>

          <div className="mt-6 p-4 rounded-xl bg-[#FDF3E1] border border-[#B87A00]/20" data-testid="builder-preview">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B87A00]">Live preview</p>
              {previewing && <Loader2 className="w-3 h-3 animate-spin text-[#B87A00]" />}
            </div>
            <p className="text-sm text-[#2C2C2C]">
              {preview.count === null
                ? "Building…"
                : preview.count === 0
                  ? "No books match these rules yet."
                  : `${preview.count} book${preview.count === 1 ? "" : "s"} match.`}
            </p>
            {preview.sample?.length > 0 && (
              <p className="text-xs text-[#6B705C] mt-2 truncate">
                Including: {preview.sample.slice(0, 3).map((b) => `"${b.title}"`).join(", ")}
                {preview.count > 3 && ` and ${preview.count - 3} more`}
              </p>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-[#E8E6E1] flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-testid="builder-save"
            className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {initial ? "Update shelf" : "Create shelf"}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm px-6">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function SmartShelves() {
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/smart-shelves");
      setShelves(data.shelves || []);
    } catch (e) {
      toast.error("Couldn't load smart shelves");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const togglePin = async (s) => {
    try {
      await api.patch(`/smart-shelves/${s.shelf_id}`, { pinned: !s.pinned });
      load();
    } catch (e) { toast.error("Couldn't update"); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete smart shelf "${s.name}"? Books are unaffected.`)) return;
    try {
      await api.delete(`/smart-shelves/${s.shelf_id}`);
      toast.success("Shelf removed");
      load();
    } catch (e) { toast.error("Couldn't delete"); }
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

        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Saved queries
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C]" data-testid="smart-shelves-title">
              Smart shelves
            </h1>
            <p className="text-[#6B705C] mt-3">
              Filters that stay alive — pin them to your dashboard for one-click access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/library/tags"
              data-testid="open-tag-cloud"
              className="btn-secondary text-sm inline-flex items-center gap-2"
              title="Browse all tags"
            >
              <TagIcon className="w-4 h-4" /> Browse tags
            </Link>
            <button
              onClick={() => { setEditing(null); setBuilderOpen(true); }}
              data-testid="new-smart-shelf-btn"
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New smart shelf
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : shelves.length === 0 ? (
          <div className="shelf-card p-12 text-center">
            <Filter className="w-10 h-10 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">No smart shelves yet</h2>
            <p className="text-[#6B705C] mb-6 max-w-md mx-auto">
              Combine tags, fandoms, authors, status, and word counts into living filters. "Long Harry Potter WIPs", "Comfort re-reads", "Quick non-fiction" — your library, your rules.
            </p>
            <button
              onClick={() => { setEditing(null); setBuilderOpen(true); }}
              data-testid="empty-create-smart-shelf"
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create your first smart shelf
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4" data-testid="smart-shelves-grid">
            {shelves.map((s) => (
              <div
                key={s.shelf_id}
                data-testid={`smart-shelf-card-${s.shelf_id}`}
                className="shelf-card p-5 group hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {s.pinned && (
                      <Pin className="w-3.5 h-3.5 text-[#E07A5F] flex-shrink-0" />
                    )}
                    <h3 className="font-serif text-xl text-[#2C2C2C] truncate">{s.name}</h3>
                  </div>
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => togglePin(s)}
                      data-testid={`toggle-pin-${s.shelf_id}`}
                      className="p-1.5 rounded hover:bg-[#F5F3EC] text-[#6B705C]"
                      title={s.pinned ? "Unpin" : "Pin to dashboard"}
                    >
                      {s.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => { setEditing(s); setBuilderOpen(true); }}
                      data-testid={`edit-${s.shelf_id}`}
                      className="p-1.5 rounded hover:bg-[#F5F3EC] text-[#6B705C]"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      data-testid={`delete-${s.shelf_id}`}
                      className="p-1.5 rounded hover:bg-[#F5F3EC] text-[#D9534F]"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-[#6B705C] mb-3">
                  {(s.query?.combinator || "AND")} · {s.query?.rules?.length || 0} rule{s.query?.rules?.length === 1 ? "" : "s"}
                </p>

                <Link
                  to={`/library/smart/${s.shelf_id}`}
                  className="text-sm font-semibold text-[#6B46C1] hover:text-[#2C2C2C] inline-flex items-center gap-1"
                >
                  {s.count} book{s.count === 1 ? "" : "s"} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>

      {builderOpen && (
        <SmartShelfBuilder
          initial={editing}
          onClose={() => setBuilderOpen(false)}
          onSaved={() => { setBuilderOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// Export the builder so it can be used elsewhere (e.g. quick-create from elsewhere)
export { SmartShelfBuilder };
