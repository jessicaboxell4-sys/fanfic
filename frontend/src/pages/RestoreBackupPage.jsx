import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, AlertTriangle, CheckCircle2, Loader2, Layers } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// RESTORE WIZARD — three states: empty (file picker) → preview
// (checkboxes + Apply button) → done (summary). The same ZIP file is
// POSTed twice (once to /preview, once to /apply) so the user can
// inspect before committing; the file object stays in memory between
// the two calls so there's no second file picker.
export default function RestoreBackupPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(() => new Set());
  const [selectedShelves, setSelectedShelves] = useState(() => new Set());
  const [overwriteCollisions, setOverwriteCollisions] = useState(false);
  const [result, setResult] = useState(null);

  const runPreview = async (f) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const { data } = await api.post("/library/restore/preview", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreview(data);
      // Default selection: every non-collision book + every non-collision shelf.
      setSelectedBooks(new Set(
        (data?.books || []).filter((b) => !b.collision).map((b) => b.book_id),
      ));
      setSelectedShelves(new Set(
        (data?.smart_shelves || []).filter((s) => !s.collision).map((s) => s.name),
      ));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't read that backup.");
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    runPreview(f);
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("selection", JSON.stringify({
        book_ids: Array.from(selectedBooks),
        shelf_names: Array.from(selectedShelves),
        overwrite_collisions: overwriteCollisions,
      }));
      const { data } = await api.post("/library/restore/apply", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      toast.success(`Restored ${data.restored_books + data.overwritten_books} book${(data.restored_books + data.overwritten_books) === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleBook = (bid) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bid)) next.delete(bid); else next.add(bid);
      return next;
    });
  };
  const toggleShelf = (name) => {
    setSelectedShelves((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const allBookIds = useMemo(
    () => (preview?.books || []).map((b) => b.book_id),
    [preview],
  );
  const selectAll = () => setSelectedBooks(new Set(allBookIds));
  const selectNone = () => setSelectedBooks(new Set());
  const selectOnlyNew = () => setSelectedBooks(new Set(
    (preview?.books || []).filter((b) => !b.collision).map((b) => b.book_id),
  ));

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/account")}
          data-testid="restore-back"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to account
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Restore from backup</h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-2xl">
              Upload a `shelfsort-backup-*.zip`, pick what to bring back, then apply. Books with IDs already in your library are flagged as collisions and default to OFF — you can tick them on if you want to overwrite.
            </p>
          </div>
        </header>

        {!preview && !result && (
          <div className="shelf-card p-8 text-center" data-testid="restore-picker">
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={onFileChange}
              disabled={busy}
              id="restore-file-input"
              data-testid="restore-file-input"
              className="block mx-auto text-sm"
            />
            {busy && <p className="mt-3 text-xs text-[#5B5F4D] italic">Reading manifest…</p>}
          </div>
        )}

        {preview && !result && (
          <div data-testid="restore-preview">
            <div className="shelf-card p-5 mb-4" data-testid="restore-stats">
              <p className="text-sm text-[#2C2C2C]">
                <strong>{preview.stats.book_count}</strong> book{preview.stats.book_count === 1 ? "" : "s"} in this backup
                {preview.stats.collision_count > 0 && (
                  <span className="text-[#9E5A2E]">
                    {" "}· <strong>{preview.stats.collision_count}</strong> collision{preview.stats.collision_count === 1 ? "" : "s"} (book IDs already in your library)
                  </span>
                )}
                {preview.stats.smart_shelf_count > 0 && (
                  <span> · <strong>{preview.stats.smart_shelf_count}</strong> smart shelves</span>
                )}
              </p>
              <p className="text-xs text-[#5B5F4D] mt-1">
                Backup generated {preview.generated_at ? new Date(preview.generated_at).toLocaleString() : "unknown"}
              </p>
            </div>

            {preview.stats.collision_count > 0 && (
              <label className="flex items-center gap-2 text-sm text-[#2C2C2C] mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwriteCollisions}
                  onChange={(e) => setOverwriteCollisions(e.target.checked)}
                  data-testid="restore-overwrite-toggle"
                />
                <AlertTriangle className="w-4 h-4 text-[#9E5A2E]" />
                Overwrite existing books / shelves on collision (otherwise they&apos;re skipped)
              </label>
            )}

            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              <button onClick={selectAll} data-testid="restore-select-all" className="px-3 py-1.5 rounded-full bg-white border border-[#E5DDC5] hover:bg-[#F5F3EC]">Select all</button>
              <button onClick={selectNone} data-testid="restore-select-none" className="px-3 py-1.5 rounded-full bg-white border border-[#E5DDC5] hover:bg-[#F5F3EC]">Select none</button>
              <button onClick={selectOnlyNew} data-testid="restore-select-new" className="px-3 py-1.5 rounded-full bg-white border border-[#E5DDC5] hover:bg-[#F5F3EC]">Only new books</button>
              <span className="ml-2 px-3 py-1.5 text-[#5B5F4D]">
                {selectedBooks.size} / {preview.books.length} books selected
              </span>
            </div>

            <ul className="space-y-1 mb-6 max-h-[400px] overflow-y-auto shelf-card p-2" data-testid="restore-book-list">
              {preview.books.map((b) => (
                <li
                  key={b.book_id}
                  data-testid={`restore-book-${b.book_id}`}
                  className={`flex items-center gap-3 px-2 py-1.5 rounded ${b.collision ? "bg-[#F8E8D8]/40" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedBooks.has(b.book_id)}
                    onChange={() => toggleBook(b.book_id)}
                    data-testid={`restore-book-check-${b.book_id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#2C2C2C] truncate">{b.title}</div>
                    <div className="text-xs text-[#5B5F4D] truncate">
                      {b.author}{b.fandom ? ` · ${b.fandom}` : ""}{b.category ? ` · ${b.category}` : ""}
                    </div>
                  </div>
                  {b.collision && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#9E5A2E]/10 text-[#9E5A2E] uppercase tracking-wide">
                      collision
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {preview.smart_shelves.length > 0 && (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2 flex items-center gap-2">
                  <Layers className="w-3 h-3" /> Smart shelves
                </p>
                <ul className="space-y-1 mb-6 shelf-card p-2" data-testid="restore-shelf-list">
                  {preview.smart_shelves.map((s) => (
                    <li key={s.name} className="flex items-center gap-3 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedShelves.has(s.name)}
                        onChange={() => toggleShelf(s.name)}
                        data-testid={`restore-shelf-check-${s.name}`}
                      />
                      <span className="text-sm text-[#2C2C2C]">{s.name}</span>
                      {s.collision && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#9E5A2E]/10 text-[#9E5A2E] uppercase tracking-wide">
                          collision
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={apply}
                disabled={busy || (selectedBooks.size === 0 && selectedShelves.size === 0)}
                data-testid="restore-apply-btn"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? "Restoring…" : `Restore ${selectedBooks.size} book${selectedBooks.size === 1 ? "" : "s"} + ${selectedShelves.size} shelves`}
              </button>
              <button
                onClick={() => { setFile(null); setPreview(null); setSelectedBooks(new Set()); setSelectedShelves(new Set()); }}
                data-testid="restore-cancel-btn"
                className="px-4 py-2 rounded-lg bg-white border border-[#E5DDC5] text-[#2C2C2C] hover:bg-[#F5F3EC] text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="shelf-card p-6" data-testid="restore-result">
            <div className="flex items-start gap-3 mb-4">
              <CheckCircle2 className="w-6 h-6 text-[#6B46C1] flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-serif text-xl text-[#2C2C2C]">Restore complete.</p>
                <ul className="text-sm text-[#5B5F4D] mt-2 space-y-1">
                  <li>{result.restored_books} new book{result.restored_books === 1 ? "" : "s"} added</li>
                  {result.overwritten_books > 0 && <li>{result.overwritten_books} book{result.overwritten_books === 1 ? "" : "s"} overwritten</li>}
                  {result.skipped_books > 0 && <li>{result.skipped_books} skipped (collision, overwrite OFF)</li>}
                  <li>{result.restored_files} EPUB file{result.restored_files === 1 ? "" : "s"} restored to disk</li>
                  <li>{result.restored_shelves} smart shelves restored</li>
                </ul>
              </div>
            </div>
            <button
              onClick={() => navigate("/library")}
              data-testid="restore-done-btn"
              className="px-4 py-2 rounded-lg bg-[#6B46C1] text-white hover:bg-[#2c4530] text-sm"
            >
              Open library
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
