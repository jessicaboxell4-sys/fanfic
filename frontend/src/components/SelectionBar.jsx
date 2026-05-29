import React, { useState, useEffect } from "react";
import { Trash2, Move, X, ChevronDown, Edit3 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import TagInput from "./TagInput";

const DEFAULT_SHELVES = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", "Updated stories", "Old stories"];

function BulkMetadataDialog({ ids, customCats, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [author, setAuthor] = useState("");
  const [fandom, setFandom] = useState("");
  const [category, setCategory] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesStart, setSeriesStart] = useState("");
  const [prefix, setPrefix] = useState("");
  const [clearFandom, setClearFandom] = useState(false);
  const [clearSeries, setClearSeries] = useState(false);
  const [addTags, setAddTags] = useState([]);
  const [removeTags, setRemoveTags] = useState([]);
  const [tagSuggestions, setTagSuggestions] = useState([]);

  useEffect(() => {
    api.get("/tags").then(({ data }) => {
      setTagSuggestions((data.tags || []).map((t) => t.name));
    }).catch(() => {});
  }, []);

  const allShelves = [...DEFAULT_SHELVES, ...customCats];

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const body = { book_ids: ids };
    if (author.trim()) body.author = author.trim();
    if (category) body.category = category;
    if (clearFandom) body.fandom = "";
    else if (fandom.trim()) body.fandom = fandom.trim();
    if (clearSeries) body.series_name = "";
    else if (seriesName.trim()) {
      body.series_name = seriesName.trim();
      if (seriesStart !== "") body.series_start_index = Number(seriesStart);
    }
    if (prefix.trim()) body.title_prefix_strip = prefix;
    if (addTags.length) body.add_tags = addTags;
    if (removeTags.length) body.remove_tags = removeTags;

    // Need at least one meaningful change
    const keys = Object.keys(body).filter((k) => k !== "book_ids");
    if (keys.length === 0) {
      toast.error("Pick at least one field to update");
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post("/books/bulk/metadata", body);
      toast.success(`Updated ${data.updated} book${data.updated === 1 ? "" : "s"}`);
      onDone && onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#2C2C2C]/40 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="bulk-metadata-overlay"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#E8E6E1] flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-1">Bulk edit</p>
            <h2 className="font-serif text-2xl text-[#2C2C2C]">
              Update {ids.length} book{ids.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            onClick={onClose}
            data-testid="bulk-metadata-close"
            className="w-9 h-9 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center text-[#6B705C]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          <p className="text-xs text-[#6B705C]">
            Only fields you fill in will be changed. Leave the rest blank.
          </p>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
              Author
            </label>
            <input
              data-testid="bulk-meta-author"
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g. Suzanne Collins"
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
              Category
            </label>
            <select
              data-testid="bulk-meta-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— leave unchanged —</option>
              {allShelves.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
              Fandom
            </label>
            <input
              data-testid="bulk-meta-fandom"
              type="text"
              value={fandom}
              disabled={clearFandom}
              onChange={(e) => setFandom(e.target.value)}
              placeholder="e.g. Harry Potter"
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm disabled:bg-[#F5F3EC] disabled:text-[#6B705C] focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
            <label className="flex items-center gap-2 text-xs text-[#6B705C] mt-1.5">
              <input
                type="checkbox"
                data-testid="bulk-meta-clear-fandom"
                checked={clearFandom}
                onChange={(e) => setClearFandom(e.target.checked)}
              />
              Clear fandom (set to none)
            </label>
          </div>

          <div className="border-t border-[#E8E6E1] pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2">
              Series
            </p>
            <input
              data-testid="bulk-meta-series-name"
              type="text"
              value={seriesName}
              disabled={clearSeries}
              onChange={(e) => setSeriesName(e.target.value)}
              placeholder="Series name"
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm mb-2 disabled:bg-[#F5F3EC] disabled:text-[#6B705C] focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
            <input
              data-testid="bulk-meta-series-start"
              type="number"
              step="0.5"
              value={seriesStart}
              disabled={clearSeries || !seriesName.trim()}
              onChange={(e) => setSeriesStart(e.target.value)}
              placeholder="Start numbering at (e.g. 1) — assigns in selection order"
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm disabled:bg-[#F5F3EC] disabled:text-[#6B705C] focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
            <label className="flex items-center gap-2 text-xs text-[#6B705C] mt-2">
              <input
                type="checkbox"
                data-testid="bulk-meta-clear-series"
                checked={clearSeries}
                onChange={(e) => setClearSeries(e.target.checked)}
              />
              Clear series (set to none)
            </label>
          </div>

          <div className="border-t border-[#E8E6E1] pt-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
              Strip title prefix
            </label>
            <input
              data-testid="bulk-meta-prefix"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder='e.g. "[OLD] " — removed from every title that starts with it'
              className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
            />
          </div>

          <div className="border-t border-[#E8E6E1] pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2">Tags</p>
            <label className="text-xs text-[#6B705C] mb-1 block">Add tags to all</label>
            <TagInput
              value={addTags}
              onChange={setAddTags}
              suggestions={tagSuggestions}
              placeholder="add tags…"
              testIdPrefix="bulk-add-tags"
            />
            <label className="text-xs text-[#6B705C] mt-3 mb-1 block">Remove tags from all</label>
            <TagInput
              value={removeTags}
              onChange={setRemoveTags}
              suggestions={tagSuggestions}
              placeholder="remove tags…"
              testIdPrefix="bulk-remove-tags"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="submit"
              disabled={busy}
              data-testid="bulk-meta-save"
              className="btn-primary text-sm flex-1 disabled:opacity-60"
            >
              {busy ? "Saving…" : `Update ${ids.length} book${ids.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-sm px-6"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SelectionBar({ selectedIds, customCats, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [editMeta, setEditMeta] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const ids = Array.from(selectedIds);
  const allShelves = [...DEFAULT_SHELVES, ...customCats];

  const move = async (category) => {
    setBusy(true);
    setShowMenu(false);
    try {
      // If moving to "Fanfiction" with no fandom selected, leave fandom as-is by passing null
      await api.post("/books/bulk/move", {
        book_ids: ids,
        category,
        fandom: category === "Fanfiction" ? null : "",  // clear fandom when leaving Fanfiction
      });
      toast.success(`Moved ${count} book${count === 1 ? "" : "s"} to ${category}`);
      onDone && onDone();
    } catch (e) {
      toast.error("Couldn't move selection");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${count} book${count === 1 ? "" : "s"} from your library? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.post("/books/bulk/delete", { book_ids: ids });
      toast.success(`Removed ${count} book${count === 1 ? "" : "s"}`);
      onDone && onDone();
    } catch (e) {
      toast.error("Couldn't delete selection");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50" data-testid="selection-bar">
        <div className="bg-[#2C2C2C] text-white rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.25)] flex items-center gap-2 px-3 py-2">
          <button
            onClick={onCancel}
            className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
            title="Cancel selection"
            data-testid="selection-cancel"
          >
            <X className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium px-2" data-testid="selection-count">
            {count} selected
          </span>
          <div className="w-px h-6 bg-white/15 mx-1" />

          <button
            data-testid="bulk-edit-metadata-btn"
            disabled={busy}
            onClick={() => setEditMeta(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white/10 text-sm font-medium disabled:opacity-50"
          >
            <Edit3 className="w-4 h-4" />
            Edit metadata
          </button>

          <div className="relative">
            <button
              data-testid="bulk-move-btn"
              disabled={busy}
              onClick={() => setShowMenu((s) => !s)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white/10 text-sm font-medium disabled:opacity-50"
            >
              <Move className="w-4 h-4" />
              Move to shelf
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
            {showMenu && (
              <div
                className="absolute bottom-full mb-2 right-0 bg-white text-[#2C2C2C] rounded-xl shadow-2xl border border-[#E8E6E1] min-w-[200px] py-1 max-h-72 overflow-y-auto"
                data-testid="bulk-move-menu"
              >
                {allShelves.map((s) => (
                  <button
                    key={s}
                    data-testid={`bulk-move-to-${s.replace(/\s+/g, "-").toLowerCase()}`}
                    onClick={() => move(s)}
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-[#F5F3EC]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            data-testid="bulk-delete-btn"
            disabled={busy}
            onClick={remove}
            className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#D9534F]/30 text-sm font-medium text-[#FFB1AD] disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {editMeta && (
        <BulkMetadataDialog
          ids={ids}
          customCats={customCats}
          onClose={() => setEditMeta(false)}
          onDone={() => {
            setEditMeta(false);
            onDone && onDone();
          }}
        />
      )}
    </>
  );
}
