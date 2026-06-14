import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, Loader2, X as XIcon, ArrowRight, Users } from "lucide-react";
import { api } from "../lib/api";

/**
 * Compact recommendations widget for the Dashboard — shows up to 3 books
 * friends loved that the user doesn't own yet. Auto-hides if there are
 * no recs (e.g. no friends opted in to sharing).
 *
 * Click a card to follow the friend's link; "Hide" dismisses the rec
 * forever. Full list lives at /library/recommendations.
 */
export default function FriendRecsCard() {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/recommendations/friends?limit=4");
      setRecs(data?.recommendations || []);
    } catch { /* widget is non-blocking */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dismiss = async (rec) => {
    setBusyKey(rec.rec_key);
    try {
      await api.post("/recommendations/dismiss", { rec_key: rec.rec_key });
      setRecs((prev) => prev.filter((r) => r.rec_key !== rec.rec_key));
      toast.success("Hidden");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't hide");
    } finally { setBusyKey(null); }
  };

  if (loading) {
    return null; // don't flash empty
  }
  if (recs.length === 0) return null;

  const top = recs.slice(0, 3);

  return (
    <section
      data-testid="friend-recs-card"
      className="mb-10 bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] inline-flex items-center gap-2">
          <Sparkles className="w-3 h-3" /> From your friends
        </p>
        <Link
          to="/library/recommendations"
          data-testid="recs-see-all"
          className="text-xs text-[#6B46C1] hover:text-[#2C2C2C] font-semibold uppercase tracking-wider inline-flex items-center gap-1"
        >
          See all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {top.map((rec) => {
          const friendNames = rec.friends.slice(0, 3).map((f) => f.name);
          const moreCount = Math.max(0, rec.friend_count - friendNames.length);
          const byline = friendNames.join(", ") + (moreCount > 0 ? ` +${moreCount} more` : "");
          return (
            <div
              key={rec.rec_key}
              data-testid={`rec-card-${rec.rec_key}`}
              className="relative bg-white border border-[#E8E6E1] rounded-xl p-3 hover:shadow-sm transition group"
            >
              <button
                onClick={() => dismiss(rec)}
                disabled={busyKey === rec.rec_key}
                data-testid={`rec-dismiss-${rec.rec_key}`}
                title="Hide this rec"
                className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-[#FBE9E5] opacity-60 group-hover:opacity-100"
              >
                {busyKey === rec.rec_key ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3 text-[#B43F26]" />}
              </button>
              <p className="font-serif text-sm text-[#2C2C2C] truncate pr-5">{rec.title}</p>
              <p className="text-[11px] text-[#6B705C] truncate">{rec.author}{rec.fandom ? ` · ${rec.fandom}` : ""}</p>
              <p className="text-[10px] text-[#6B46C1] mt-2 flex items-center gap-1">
                <Users className="w-3 h-3" /> {byline}
                {rec.finished_count > 0 && <span className="text-[#1F4D2A] ml-1">· {rec.finished_count} finished</span>}
              </p>
              {rec.source_url && (
                <a
                  href={rec.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`rec-open-${rec.rec_key}`}
                  className="mt-2 inline-block text-[11px] text-[#6B46C1] hover:underline"
                >
                  Open source ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
