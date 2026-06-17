import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import {
  ArrowLeft,
  Loader2,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

const REASON_LABEL = {
  title: "same title",
  source_url: "same source URL",
  url: "shared fanfic link",
};

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso.slice(0, 10);
  }
}

function GroupCard({ group, onResolved }) {
  // The default keeper is the oldest book (server already sorts groups
  // oldest-first), but the user can switch.
  const [keeperId, setKeeperId] = useState(group.books[0]?.book_id || null);
  const [decisions, setDecisions] = useState(() => {
    const seed = {};
    for (const b of group.books) seed[b.book_id] = "keep";
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const setAction = (bookId, action) => {
    setDecisions((prev) => ({ ...prev, [bookId]: action }));
  };

  const applyGroup = async () => {
    if (!keeperId) {
      toast.error("Pick a keeper first.");
      return;
    }
    // Sanity: the keeper itself is implicitly kept; ignore any decision on it.
    const payload = {
      keeper_id: keeperId,
      decisions: group.books
        .filter((b) => b.book_id !== keeperId)
        .map((b) => ({ book_id: b.book_id, action: decisions[b.book_id] || "keep" })),
    };
    setBusy(true);
    try {
      const { data } = await api.post("/books/resolve-group", payload);
      toast.success(
        `Resolved: ${data.discarded} deleted · ${data.archived} archived · ${data.kept} kept`,
      );
      setDone(true);
      onResolved && onResolved();
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Couldn't resolve group");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`dupe-group-${group.books[0]?.book_id}`}
      className={`shelf-card p-6 mb-6 ${done ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#6B705C] mb-1">
            {group.books.length} books match · {group.match_reasons.map((r) => REASON_LABEL[r] || r).join(" + ")}
          </p>
          <p className="font-serif text-xl text-[#2C2C2C] leading-tight">
            {group.books[0]?.title || "Untitled"}
          </p>
        </div>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
            <CheckCircle2 className="w-3 h-3" /> resolved
          </span>
        )}
      </div>

      <div className="space-y-3 mb-4">
        {group.books.map((b) => {
          const isKeeper = b.book_id === keeperId;
          return (
            <div
              key={b.book_id}
              data-testid={`dupe-book-${b.book_id}`}
              className={`p-4 rounded-lg border ${isKeeper ? "border-[#E07A5F] bg-[#FDF3E1]" : "border-[#E5DDC5] bg-white"}`}
            >
              <div className="flex items-start gap-3 mb-3">
                <input
                  type="radio"
                  name={`keeper-${group.books[0]?.book_id}`}
                  checked={isKeeper}
                  onChange={() => setKeeperId(b.book_id)}
                  disabled={done}
                  data-testid={`dupe-keeper-${b.book_id}`}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-medium text-[#2C2C2C]">
                    <Link to={`/book/${b.book_id}`} className="hover:underline">
                      {b.title || "Untitled"}
                    </Link>
                    {isKeeper && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#E07A5F]">
                        <Sparkles className="w-3 h-3" /> keeper
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#6B705C] mt-0.5">
                    by {b.author || "Unknown"}
                    {b.fandom ? ` · ${b.fandom}` : ""}
                    {b.category ? ` · ${b.category}` : ""}
                    {b.created_at ? ` · uploaded ${formatDate(b.created_at)}` : ""}
                    {b.reading_minutes > 0 ? ` · ${b.reading_minutes} min read` : ""}
                    {b.progress_fraction > 0 ? ` · ${Math.round(b.progress_fraction)}% progress` : ""}
                  </p>
                </div>
              </div>
              {!isKeeper && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Pick an action">
                  {[
                    { val: "keep", label: "Keep alongside", desc: "Leave it." },
                    { val: "archive", label: "Archive as old", desc: "Move to Old stories." },
                    { val: "discard", label: "Delete", desc: "Remove + files." },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      data-testid={`dupe-action-${opt.val}-${b.book_id}`}
                      onClick={() => setAction(b.book_id, opt.val)}
                      disabled={done}
                      className={`text-left p-2.5 rounded border text-sm transition ${
                        decisions[b.book_id] === opt.val
                          ? opt.val === "discard"
                            ? "border-red-400 bg-red-50"
                            : opt.val === "archive"
                            ? "border-amber-400 bg-amber-50"
                            : "border-[#E07A5F] bg-[#FDF3E1]"
                          : "border-[#E5DDC5] hover:border-[#E07A5F]/50"
                      }`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-[#6B705C]">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          data-testid={`dupe-group-apply-${group.books[0]?.book_id}`}
          onClick={applyGroup}
          disabled={busy || done}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {done ? "Resolved" : "Apply to this group"}
        </button>
      </div>
    </div>
  );
}

export default function FindDuplicates() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ groups: [], total_groups: 0, total_dupe_books: 0, backfilled: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/library/duplicates");
      setData(data);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load duplicates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/account" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to account
        </Link>

        <div className="flex items-start gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Find duplicates</h1>
            <p className="text-[#6B705C] mt-1">
              Books on your shelves that share a title, source URL, or fanfic permalink.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mx-auto" />
            <p className="text-sm text-[#6B705C] mt-3">Scanning your library…</p>
          </div>
        ) : data.total_groups === 0 ? (
          <div data-testid="dupe-empty" className="shelf-card p-10 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="font-serif text-2xl text-[#2C2C2C]">No duplicates found</p>
            <p className="text-sm text-[#6B705C] mt-2">
              Every book on your shelves is unique. {data.backfilled > 0 && `(Backfilled URLs on ${data.backfilled} legacy book${data.backfilled === 1 ? "" : "s"} during this scan.)`}
            </p>
          </div>
        ) : (
          <>
            <div data-testid="dupe-summary" className="shelf-card p-4 mb-6 flex items-center gap-3 bg-amber-50/60 border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-sm text-[#2C2C2C]">
                <strong>{data.total_groups}</strong> duplicate group{data.total_groups === 1 ? "" : "s"} found across <strong>{data.total_dupe_books}</strong> books.
                {data.backfilled > 0 && ` Backfilled URLs on ${data.backfilled} legacy book${data.backfilled === 1 ? "" : "s"}.`}
              </p>
            </div>
            {data.groups.map((g) => (
              <GroupCard key={g.books[0]?.book_id} group={g} onResolved={load} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
