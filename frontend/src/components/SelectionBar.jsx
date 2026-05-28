import React, { useState } from "react";
import { Trash2, Move, X, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

const DEFAULT_SHELVES = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified"];

export default function SelectionBar({ selectedIds, customCats, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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
  );
}
