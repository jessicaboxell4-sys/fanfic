/**
 * ContentCards — extracted 2026-08-19 from AdminConsole.jsx (Phase 6C-D).
 *
 * Cards: UnknownFandomsCard, UnknownFandomRow, CrossoverSuggestionsCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { AlertOctagon, Check, ChevronRight, Edit2, Loader2, RotateCcw, Sparkles, X as XIcon } from "lucide-react";
import { Card, fmtBytes } from "./shared";

export function UnknownFandomsCard() {
  const [rows, setRows] = useState([]);
  const [dismissedRows, setDismissedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [renaming, setRenaming] = useState(null); // fandom name currently in inline-rename mode
  const [batchProgress, setBatchProgress] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/unknown-fandoms");
      setRows(data?.unknown || []);
      setDismissedRows(data?.dismissed || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleSelect = (fandom) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fandom)) next.delete(fandom);
      else next.add(fandom);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(rows.map((r) => r.fandom)));
  const clearSelection = () => setSelected(new Set());

  const dismiss = async (fandom) => {
    setBusy(`dismiss:${fandom}`);
    try {
      await api.post(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Dismissed "${fandom}"`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(fandom);
        return next;
      });
      await load();
    } catch { toast.error("Couldn't dismiss"); }
    finally { setBusy(null); }
  };

  const undismiss = async (fandom) => {
    setBusy(`undismiss:${fandom}`);
    try {
      await api.delete(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Restored "${fandom}"`);
      await load();
    } catch { toast.error("Couldn't restore"); }
    finally { setBusy(null); }
  };

  const rescan = async (fandom, count) => {
    if (!window.confirm(
      `Re-scan ${count} book${count === 1 ? "" : "s"} tagged "${fandom}" against the current keyword sets?\n\nBooks whose title/author/description now matches a known fandom will be reassigned. No EPUB re-parse, no AI call.`
    )) return;
    setBusy(`rescan:${fandom}`);
    try {
      const { data } = await api.post(
        `/admin/unknown-fandoms/${encodeURIComponent(fandom)}/rescan`,
        { dry_run: false },
      );
      toast.success(`Scanned ${data.scanned} · reclassified ${data.reclassified}`, { duration: 8000 });
      await load();
    } catch { toast.error("Rescan failed"); }
    finally { setBusy(null); }
  };

  const rescanSelected = async () => {
    const targets = rows.filter((r) => selected.has(r.fandom));
    if (!targets.length) return;
    const totalBooks = targets.reduce((n, t) => n + (t.count || 0), 0);
    if (!window.confirm(
      `Re-scan ${targets.length} fandom${targets.length === 1 ? "" : "s"} `
      + `(${totalBooks} book${totalBooks === 1 ? "" : "s"} total) against the current keyword sets?\n\n`
      + `They'll be scanned one after the other. No EPUB re-parse, no AI call. `
      + `Any fandom that errors will be skipped and reported at the end.`
    )) return;
    setBusy("batch-rescan");
    setBatchProgress({ done: 0, total: targets.length, scanned: 0, reclassified: 0 });
    // 2026-07-11 — tolerant batch: individual fandom failures no longer
    // abort the whole run.  Previously a single 404 (fandom deleted
    // mid-batch by a rename or a concurrent admin action) killed the
    // rest.  Now: skip + collect the failure, keep going, summarise
    // at the end.  Path uses `?fandom=` query param instead of a path
    // segment to sidestep FastAPI's path-encoding gotchas with names
    // containing slashes / punctuation.
    const failed = [];
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i];
        try {
          // eslint-disable-next-line no-await-in-loop
          const { data } = await api.post(
            "/admin/unknown-fandoms/rescan-by-name",
            { fandom: t.fandom, dry_run: false },
          );
          setBatchProgress((prev) => ({
            done: i + 1,
            total: targets.length,
            scanned: (prev?.scanned || 0) + (data?.scanned || 0),
            reclassified: (prev?.reclassified || 0) + (data?.reclassified || 0),
          }));
        } catch (perErr) {
          failed.push({
            fandom: t.fandom,
            reason: perErr?.response?.data?.detail || perErr?.message || "unknown",
          });
          // eslint-disable-next-line no-console
          console.warn("rescan failed for fandom:", t.fandom, perErr?.response?.status, perErr?.response?.data);
          setBatchProgress((prev) => ({
            done: i + 1,
            total: targets.length,
            scanned: prev?.scanned || 0,
            reclassified: prev?.reclassified || 0,
          }));
        }
      }
      if (failed.length && failed.length === targets.length) {
        toast.error(
          `All ${targets.length} rescans failed. `
          + `First error: ${failed[0].reason}. Check console for details.`,
          { duration: 10000 },
        );
      } else if (failed.length) {
        toast.warning(
          `Batch rescan done · ${targets.length - failed.length}/${targets.length} succeeded · `
          + `${failed.length} skipped (see console)`,
          { duration: 8000 },
        );
      } else {
        toast.success(
          `Batch rescan done · ${targets.length} fandom${targets.length === 1 ? "" : "s"} scanned`,
          { duration: 8000 },
        );
      }
      clearSelection();
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Batch rescan failed");
    } finally {
      setBusy(null);
      setBatchProgress(null);
    }
  };

  const startRename = (fandom) => setRenaming(fandom);
  const cancelRename = () => setRenaming(null);
  const submitRename = async (oldFandom, newFandom) => {
    const target = (newFandom || "").trim();
    if (!target || target === oldFandom) return;
    setBusy(`rename:${oldFandom}`);
    try {
      const { data } = await api.post("/admin/unknown-fandoms/rename", {
        old_fandom: oldFandom,
        new_fandom: target,
      });
      toast.success(`Renamed "${oldFandom}" → "${target}" · ${data.modified} book${data.modified === 1 ? "" : "s"} updated`, { duration: 8000 });
      setRenaming(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(oldFandom);
        return next;
      });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Rename failed");
    } finally {
      setBusy(null);
    }
  };

  const anySelected = selected.size > 0;

  return (
    <Card icon={AlertOctagon} title="Unknown fandoms" subtitle="Fandoms appearing in book records that aren't in the keyword classifier yet. Rescan re-runs the classifier on existing books (no AI, no re-parse). Rename bulk-updates the fandom tag to a canonical name across every matching book. Dismiss to hide permanently." testid="admin-unknown-fandoms-card">
      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-[#6B46C1] inline-flex items-center gap-1.5" data-testid="admin-unknown-fandoms-empty">
              <Check className="w-4 h-4" /> All fandoms in your library are recognized.
            </p>
          ) : (
            <>
              <div
                className="flex flex-wrap items-center gap-2 mb-3 text-xs"
                data-testid="admin-unknown-fandoms-toolbar"
              >
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={!!busy || selected.size === rows.length}
                  data-testid="admin-unknown-fandoms-select-all"
                  className="px-2.5 py-1 rounded-lg text-[#6B46C1] hover:bg-[#EEE9FB] disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  Select all ({rows.length})
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={!!busy || !anySelected}
                  data-testid="admin-unknown-fandoms-clear"
                  className="px-2.5 py-1 rounded-lg text-[#5B5F4D] hover:bg-[#F5F3EC] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={rescanSelected}
                  disabled={!!busy || !anySelected}
                  data-testid="admin-unknown-fandoms-rescan-selected"
                  className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white font-bold uppercase tracking-[0.15em] hover:bg-[#5C3AAD] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {busy === "batch-rescan" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  {busy === "batch-rescan" && batchProgress
                    ? `Rescanning ${batchProgress.done}/${batchProgress.total}…`
                    : `Rescan ${selected.size || ""} selected`}
                </button>
              </div>
              {busy === "batch-rescan" && batchProgress && (
                <p
                  className="mb-3 text-[11px] text-[#5B5F4D] italic"
                  data-testid="admin-unknown-fandoms-batch-progress"
                >
                  Fandom {batchProgress.done} of {batchProgress.total} ·
                  {" "}scanned <span className="font-mono">{batchProgress.scanned}</span> books ·
                  {" "}reclassified <span className="font-mono font-semibold text-[#6B46C1]">{batchProgress.reclassified}</span>
                </p>
              )}
              <ul className="space-y-1.5" data-testid="admin-unknown-fandoms-list">
                {rows.map((r) => (
                  <UnknownFandomRow
                    key={r.fandom}
                    r={r}
                    isDismissed={false}
                    busy={busy}
                    isSelected={selected.has(r.fandom)}
                    onToggleSelect={toggleSelect}
                    isRenaming={renaming === r.fandom}
                    onStartRename={startRename}
                    onCancelRename={cancelRename}
                    onSubmitRename={submitRename}
                    onRescan={rescan}
                    onDismiss={dismiss}
                    onUndismiss={undismiss}
                  />
                ))}
              </ul>
            </>
          )}
          {dismissedRows.length > 0 && (
            <details className="mt-4" data-testid="admin-unknown-fandoms-dismissed-details">
              <summary className="text-xs font-semibold text-[#5B5F4D] cursor-pointer hover:text-[#2C2C2C]">
                Dismissed ({dismissedRows.length}) — still scannable
              </summary>
              <ul className="mt-2 space-y-1.5" data-testid="admin-unknown-fandoms-dismissed-list">
                {dismissedRows.map((r) => (
                  <UnknownFandomRow
                    key={r.fandom}
                    r={r}
                    isDismissed={true}
                    busy={busy}
                    isSelected={false}
                    onToggleSelect={() => {}}
                    isRenaming={renaming === r.fandom}
                    onStartRename={startRename}
                    onCancelRename={cancelRename}
                    onSubmitRename={submitRename}
                    onRescan={rescan}
                    onDismiss={dismiss}
                    onUndismiss={undismiss}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Crossover suggestions card (Phase-6 AI feedback loop)
// ---------------------------------------------------------------------------
// When the AI classifier returns a multi-fandom crossover the heuristic
// missed (e.g. AI says "Harry Potter / Twilight" but heuristic only saw
// Harry Potter), the backend logs the gap to `crossover_suggestions`.
// Admins triage here: enter the character names the heuristic should
// have caught, click Accept → keywords merge into the runtime overlay
// and the classifier picks them up within 60 s.

export function UnknownFandomRow({
  r,
  isDismissed,
  busy,
  isSelected,
  onToggleSelect,
  isRenaming,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onRescan,
  onDismiss,
  onUndismiss,
}) {
  const [renameValue, setRenameValue] = React.useState(r.fandom);
  React.useEffect(() => {
    if (isRenaming) setRenameValue(r.fandom);
  }, [isRenaming, r.fandom]);
  const sampleUrls = r.sample_source_urls || [];
  return (
    <li
      className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]"
      data-testid={`admin-unknown-fandom-row-${r.fandom}`}
    >
      <div className="flex items-center gap-3">
        {!isDismissed && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(r.fandom)}
            aria-label={`Select ${r.fandom}`}
            data-testid={`admin-unknown-fandom-select-${r.fandom}`}
            className="w-4 h-4 rounded border-[#B8AA88] text-[#6B46C1] focus:ring-[#6B46C1] cursor-pointer shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onSubmitRename(r.fandom, renameValue); }}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-[#5B5F4D] shrink-0">{r.fandom} →</span>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") onCancelRename(); }}
                placeholder="e.g. My Hero Academia"
                aria-label={`Rename ${r.fandom}`}
                data-testid={`admin-unknown-fandom-rename-input-${r.fandom}`}
                className="flex-1 text-sm px-2 py-1 border border-[#6B46C1] rounded focus:outline-none focus:ring-1 focus:ring-[#6B46C1] bg-white"
              />
              <button
                type="submit"
                disabled={busy === `rename:${r.fandom}` || !renameValue.trim() || renameValue.trim() === r.fandom}
                data-testid={`admin-unknown-fandom-rename-submit-${r.fandom}`}
                className="text-xs px-3 py-1 rounded bg-[#6B46C1] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === `rename:${r.fandom}` ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={onCancelRename}
                data-testid={`admin-unknown-fandom-rename-cancel-${r.fandom}`}
                className="text-xs px-2 py-1 rounded text-[#5B5F4D] hover:bg-[#F5F3EC]"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#2C2C2C] truncate">
                {r.fandom}
                <span className="ml-2 text-xs text-[#5B5F4D] font-normal">{r.count} book{r.count === 1 ? "" : "s"}</span>
                {isDismissed && <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D] font-bold">DISMISSED</span>}
              </p>
              {r.sample_book_ids?.length > 0 && (
                <p className="text-xs text-[#5B5F4D] truncate">
                  Sample IDs: <code>{r.sample_book_ids.slice(0, 3).join(", ")}</code>
                </p>
              )}
            </>
          )}
        </div>
        {!isRenaming && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onStartRename(r.fandom)}
              disabled={!!busy}
              data-testid={`admin-unknown-fandom-rename-${r.fandom}`}
              className="text-xs px-3 py-1.5 rounded-lg text-[#B87A00] hover:bg-[#FDF3E1] inline-flex items-center gap-1 font-semibold"
              title="Rename — change every book's fandom tag to a canonical name"
            >
              <Edit2 className="w-3 h-3" />
              Rename
            </button>
            <button
              type="button"
              onClick={() => onRescan(r.fandom, r.count)}
              disabled={busy === `rescan:${r.fandom}`}
              data-testid={`admin-unknown-fandom-rescan-${r.fandom}`}
              className="text-xs px-3 py-1.5 rounded-lg text-[#6B46C1] hover:bg-[#EEE9FB] inline-flex items-center gap-1 font-semibold"
              title="Re-run keyword classifier on these books"
            >
              {busy === `rescan:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Rescan
            </button>
            {isDismissed ? (
              <button
                type="button"
                onClick={() => onUndismiss(r.fandom)}
                disabled={busy === `undismiss:${r.fandom}`}
                data-testid={`admin-unknown-fandom-undismiss-${r.fandom}`}
                className="text-xs px-3 py-1.5 rounded-lg text-[#5B5F4D] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
              >
                {busy === `undismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDismiss(r.fandom)}
                disabled={busy === `dismiss:${r.fandom}`}
                data-testid={`admin-unknown-fandom-dismiss-${r.fandom}`}
                className="text-xs px-3 py-1.5 rounded-lg text-[#5B5F4D] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
              >
                {busy === `dismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
      {sampleUrls.length > 0 && !isRenaming && (
        <div
          className="pl-7 text-xs text-[#5B5F4D] flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid={`admin-unknown-fandom-urls-${r.fandom}`}
        >
          <span className="font-semibold shrink-0">Sample links:</span>
          {sampleUrls.map((s, i) => (
            <a
              key={s.book_id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title || s.url}
              data-testid={`admin-unknown-fandom-url-${r.fandom}-${i}`}
              className="inline-flex items-center gap-1 text-[#6B46C1] hover:underline max-w-[36ch] truncate"
            >
              <span aria-hidden>↗</span>
              <span className="truncate">{s.title || s.url.replace(/^https?:\/\//, "")}</span>
            </a>
          ))}
        </div>
      )}
    </li>
  );
}


export function CrossoverSuggestionsCard() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, rejected: 0 });
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  // Per-row keyword inputs: { dedup_key: { fandom: "kw1, kw2" } }
  const [kwInputs, setKwInputs] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/crossover-suggestions?status=${status}`);
      // Backend now auto-purges URL-less suggestions (removed from
      // source site) on every list request — the response never
      // contains them, and the DB rows are deleted too.  Frontend
      // just renders whatever comes back.
      setRows(data?.suggestions || []);
      setCounts(data?.counts || { pending: 0, accepted: 0, rejected: 0 });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const onKwChange = (dk, fandom, value) => {
    setKwInputs((prev) => ({
      ...prev,
      [dk]: { ...(prev[dk] || {}), [fandom]: value },
    }));
  };

  const accept = async (row) => {
    const dk = row.dedup_key;
    const inputs = kwInputs[dk] || {};
    const keywords_by_fandom = {};
    for (const f of row.gap_fandoms || []) {
      const raw = (inputs[f] || "").trim();
      if (!raw) continue;
      keywords_by_fandom[f] = raw.split(",").map((k) => k.trim()).filter(Boolean);
    }
    if (Object.keys(keywords_by_fandom).length === 0) {
      toast.error("Add at least one character name for a gap fandom before accepting.");
      return;
    }
    setBusy(`accept:${dk}`);
    try {
      const { data } = await api.post(
        `/admin/crossover-suggestions/${encodeURIComponent(dk)}/accept`,
        { keywords_by_fandom },
      );
      const added = (data?.updated_overlays || []).reduce((n, o) => n + (o.added?.length || 0), 0);
      toast.success(`Added ${added} keyword${added === 1 ? "" : "s"} to the overlay`, { duration: 6000 });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't accept");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (row) => {
    const dk = row.dedup_key;
    if (!window.confirm(`Reject this crossover suggestion?\n\n${row.title || "(no title)"} — gap: ${(row.gap_fandoms || []).join(", ")}`)) return;
    setBusy(`reject:${dk}`);
    try {
      await api.post(`/admin/crossover-suggestions/${encodeURIComponent(dk)}/reject`);
      toast.success("Rejected");
      await load();
    } catch { toast.error("Couldn't reject"); }
    finally { setBusy(null); }
  };

  return (
    <Card
      icon={Sparkles}
      title="Crossover suggestions"
      subtitle="When the AI classifier detects a multi-fandom crossover the keyword scanner missed, those gaps are logged here. Add the character names the heuristic should have caught — they'll merge into the runtime overlay and the classifier will pick them up on the next upload."
      testid="admin-crossover-suggestions-card"
    >
      <div className="flex items-center gap-2 mb-3 text-xs" data-testid="admin-crossover-suggestions-tabs">
        {[
          { id: "pending",  label: `Pending (${counts.pending})` },
          { id: "accepted", label: `Accepted (${counts.accepted})` },
          { id: "rejected", label: `Rejected (${counts.rejected})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setStatus(t.id)}
            className={`px-2.5 py-1 rounded-full border transition-colors ${status === t.id ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#5B5F4D] border-[#E4D9C8] hover:bg-[#FDF3E1]"}`}
            data-testid={`admin-crossover-suggestions-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#6B46C1] inline-flex items-center gap-1.5" data-testid="admin-crossover-suggestions-empty">
          <Check className="w-4 h-4" /> No {status} suggestions.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="admin-crossover-suggestions-list">
          {rows.map((r) => {
            const dk = r.dedup_key;
            const isPending = r.status === "pending";
            return (
              <li
                key={dk}
                className="border border-[#E4D9C8] rounded-lg p-3 bg-[#FDF8F0]"
                data-testid={`admin-crossover-suggestions-row-${dk}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#2C2C2C] truncate" title={r.title}>{r.title || "(no title)"}</div>
                    <div className="text-xs text-[#5B5F4D] truncate" title={r.author}>by {r.author || "(no author)"}</div>
                    {r.source_url && (
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`admin-crossover-suggestions-source-${dk}`}
                        className="inline-flex items-center gap-1 mt-1 text-xs text-[#6B46C1] hover:text-[#553B96] hover:underline break-all"
                        title={r.source_url}
                      >
                        <span aria-hidden>↗</span>
                        <span className="truncate max-w-[42ch]">{r.source_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                      </a>
                    )}
                    {r.book_present === false && (
                      <div
                        className="inline-flex items-center gap-1 mt-1 text-xs text-[#9B9B8C] italic"
                        title="This book is no longer in your library. The suggestion row is kept for accept/reject history."
                        data-testid={`admin-crossover-suggestions-book-removed-${dk}`}
                      >
                        <span aria-hidden>⊘</span>
                        <span>book removed from library</span>
                      </div>
                    )}
                    <div className="mt-1.5 text-xs text-[#5B5F4D]">
                      <span className="font-semibold">AI saw:</span> {(r.ai_fandoms || []).join(" / ") || "—"}{" · "}
                      <span className="font-semibold">Heuristic saw:</span> {(r.heuristic_fandoms || []).join(" / ") || "(none)"}{" · "}
                      <span className="font-semibold">Seen:</span> {r.sightings || 1}×
                    </div>
                  </div>
                  {isPending && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => accept(r)}
                        disabled={busy === `accept:${dk}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#6B46C1] text-white hover:bg-[#5B36B0] disabled:opacity-60"
                        data-testid={`admin-crossover-suggestions-accept-${dk}`}
                      >
                        {busy === `accept:${dk}` ? "Saving…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(r)}
                        disabled={busy === `reject:${dk}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[#E4D9C8] text-[#5B5F4D] hover:bg-[#FDF3E1] disabled:opacity-60"
                        data-testid={`admin-crossover-suggestions-reject-${dk}`}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {isPending && (r.gap_fandoms || []).length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-[#5B5F4D]">
                      Add character names for the missed fandom(s) — comma-separated. They&apos;ll be lowercased + deduped automatically.
                    </div>
                    {(r.gap_fandoms || []).map((f) => (
                      <div key={f} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#6B46C1] w-28 shrink-0 truncate" title={f}>{f}:</span>
                        <input
                          type="text"
                          value={(kwInputs[dk]?.[f]) || ""}
                          onChange={(e) => onKwChange(dk, f, e.target.value)}
                          placeholder="e.g. Bella, Edward Cullen, Renesmee"
                          className="flex-1 text-xs px-2 py-1.5 border border-[#E4D9C8] rounded focus:outline-none focus:border-[#6B46C1] bg-white"
                          data-testid={`admin-crossover-suggestions-input-${dk}-${f}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!isPending && r.accepted_keywords && Object.keys(r.accepted_keywords).length > 0 && (
                  <div className="mt-2 text-xs text-[#5B5F4D]">
                    <span className="font-semibold">Added:</span>{" "}
                    {Object.entries(r.accepted_keywords).map(([f, kws]) => `${f}: ${(kws || []).join(", ")}`).join(" · ")}
                  </div>
                )}

                {r.meta_snapshot?.description && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-[#5B5F4D] cursor-pointer hover:text-[#2C2C2C]">Show description / sample</summary>
                    <div className="mt-1 text-[11px] text-[#5B5F4D] whitespace-pre-wrap leading-relaxed">
                      {r.meta_snapshot.description}
                      {r.meta_snapshot.sample_text && (
                        <>{"\n\n— sample —\n"}{r.meta_snapshot.sample_text}</>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}



// ---------------------------------------------------------------------------
// Email diagnostic card (operator one-shot send)

// ---------------------------------------------------------------------------
// Production canary card — 7-day uptime sparkline
// ---------------------------------------------------------------------------
// Data lands via the `prod-smoke-canary.yml` GitHub workflow which POSTs
// to `/api/canary/report` (gated by CANARY_REPORT_SECRET) on every nightly
// run.  Widget shows uptime %, last-run status, and a dot-grid sparkline
// of the last 7 days.  If nothing has reported yet, the card shows an
// onboarding hint instead of an empty chart.

