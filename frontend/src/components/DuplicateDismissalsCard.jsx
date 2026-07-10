import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { ShieldCheck, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * DuplicateDismissalsCard — lists (title, author, url) pairs the user
 * has previously marked as "not a duplicate" of a keeper, and lets them
 * undo any of those so dupe detection re-arms for that pair.
 *
 * Renders nothing when the user has no dismissals — this keeps the
 * Account page uncluttered for the majority who never touch the flow.
 */
export default function DuplicateDismissalsCard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/user/duplicate-dismissals");
      setRows(data?.dismissals || []);
    } catch (e) {
      /* silent — this card is optional surface */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const undo = async (id) => {
    setBusyId(id);
    try {
      await api.delete(`/user/duplicate-dismissals/${encodeURIComponent(id)}`);
      toast.success("Re-armed — this pair will be flagged again");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't undo");
    } finally {
      setBusyId(null);
    }
  };

  if (loading || rows.length === 0) return null;

  return (
    <section className="shelf-card p-6 mb-6" data-testid="duplicate-dismissals-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Duplicate dismissals</h2>
          <p className="text-sm text-[#5B5F4D] mt-1">
            Pairs you&apos;ve taught Shelfsort to ignore.  Undo to re-arm dupe detection for that pair — the next matching upload will be flagged again.
          </p>
        </div>
        <span className="text-xs text-[#5B5F4D]" data-testid="duplicate-dismissals-count">{rows.length}</span>
      </div>
      <ul className="divide-y divide-[#E5DDC5]">
        {rows.map((row) => (
          <li key={row.id} data-testid={`dismissal-${row.id}`} className="py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#2C2C2C]">
                <span className="font-medium">{row.dismissed_title || "(untitled)"}</span>
                {row.dismissed_author && <span className="text-[#5B5F4D]"> by {row.dismissed_author}</span>}
              </p>
              <p className="text-xs text-[#5B5F4D] mt-0.5">
                Not a duplicate of{" "}
                {row.keeper?.is_deleted ? (
                  <span className="italic text-[#5B5F4D]">(keeper deleted)</span>
                ) : (
                  <Link
                    to={`/book/${row.keeper.book_id}`}
                    data-testid={`dismissal-keeper-link-${row.id}`}
                    className="text-[#6B46C1] hover:underline"
                  >
                    “{row.keeper.title || "(untitled)"}”{row.keeper.author && ` by ${row.keeper.author}`}
                  </Link>
                )}
                {row.dismissed_at && (
                  <span className="text-[#5B5F4D]"> · {new Date(row.dismissed_at).toLocaleDateString()}</span>
                )}
              </p>
            </div>
            <button
              type="button"
              data-testid={`dismissal-undo-${row.id}`}
              disabled={busyId === row.id}
              onClick={() => undo(row.id)}
              className="px-2.5 py-1 rounded text-xs font-medium bg-white border border-[#5B5F4D]/30 text-[#5B5F4D] hover:bg-[#F5F1E4] hover:text-[#2C2C2C] disabled:opacity-50 inline-flex items-center gap-1 flex-shrink-0"
            >
              {busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Undo
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
