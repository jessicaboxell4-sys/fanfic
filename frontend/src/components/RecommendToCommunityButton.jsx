import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// "Recommend to community" toggle.  Lives on BookDetail because
// that page already loads the book; we just need a way for the
// owner to surface that book on /community.
//
// States:
//   - User isn't eligible (score < 2) → small "Boost your profile to
//     recommend" prompt with a link to /account.
//   - Eligible + book not recommended → "Recommend to community"
//     button that opens a tiny note input + submit.
//   - Eligible + book already recommended → "Recommended" pill with
//     an X to retract.
//
// All state is fetched from /api/community/my-recommendations on
// mount, then mutated locally (with a refetch on action).
export default function RecommendToCommunityButton({ bookId, bookTitle }) {
  const { user } = useAuth();
  const [eligible, setEligible] = useState(null);  // null = loading
  const [reasonWhyNot, setReasonWhyNot] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [rateLimit, setRateLimit] = useState({ used: 0, max: 20 });
  const [busy, setBusy] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  const refresh = async () => {
    try {
      const me = await api.get("/auth/me");
      const u = me?.data || {};
      const hasHandle = !!(u.username || "").trim();
      const hasBio = !!(u.bio || "").trim();
      const isPublic = !!u.library_visible_to_public;
      const okScore = hasHandle && hasBio && isPublic;
      setEligible(okScore);
      if (!okScore) {
        if (!hasHandle) setReasonWhyNot("claim a @handle");
        else if (!hasBio) setReasonWhyNot("add a bio");
        else setReasonWhyNot("share your library publicly");
        return;
      }
      const my = await api.get("/community/my-recommendations");
      const ids = my?.data?.book_ids || [];
      setRecommended(ids.includes(bookId));
      setRateLimit({ used: my?.data?.rec_count || 0, max: my?.data?.rate_limit || 20 });
    } catch {
      setEligible(false);
      setReasonWhyNot("an error checking eligibility");
    }
  };

  useEffect(() => { if (user) refresh(); }, [bookId, user]);

  const submitRecommend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/community/recommend", { book_id: bookId, note: note.slice(0, 200) });
      toast.success("Recommended to the community", {
        description: `"${bookTitle}" will appear in /community right away.`,
      });
      setRecommended(true);
      setShowNote(false);
      setNote("");
      refresh();
    } catch (err) {
      const detail = err?.response?.data?.detail || "Couldn't recommend";
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  };

  const retract = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const my = await api.get("/community/my-recommendations");
      const recIdMap = my?.data?.rec_ids || {};
      const rid = recIdMap[bookId];
      if (!rid) {
        setRecommended(false);
        return;
      }
      await api.delete(`/community/recommend/${rid}`);
      toast.success("Recommendation removed");
      setRecommended(false);
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't remove");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  if (eligible === null) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-[#A09A8B]" data-testid="recommend-loading">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
      </div>
    );
  }

  if (!eligible) {
    return (
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FFF8E1] text-[#7C5F1F] border border-[#E8D89A]"
        data-testid="recommend-ineligible"
        title={`To recommend books to the community, ${reasonWhyNot}.`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>To recommend: {reasonWhyNot}.</span>
        <Link to="/account" className="underline hover:no-underline" data-testid="recommend-ineligible-link">
          Set up
        </Link>
      </div>
    );
  }

  if (recommended) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#E6F2E6] text-[#3D6B3D] border border-[#C8E1C8]"
        data-testid="recommend-recommended-pill"
      >
        <Check className="w-3.5 h-3.5" /> Recommended to community
        <button
          type="button"
          onClick={retract}
          disabled={busy}
          data-testid="recommend-retract-btn"
          aria-label="Retract recommendation"
          className="ml-1 text-[#3D6B3D] hover:text-[#1F4A1F]"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (showNote) {
    return (
      <div className="inline-flex flex-col gap-2 p-3 rounded-xl bg-[#FFF8E1] border border-[#E8D89A]" data-testid="recommend-form">
        <label className="text-xs font-semibold text-[#7C5F1F]">
          Why should others read it? (optional, max 200 chars)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          rows={2}
          placeholder="One line of context — what's it about, why you loved it…"
          data-testid="recommend-note-input"
          className="w-full text-sm bg-white border border-[#E8D89A] rounded-md px-2 py-1 text-[#2C2C2C] resize-none focus:outline-none focus:ring-1 focus:ring-[#6B46C1]"
          maxLength={200}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#7C5F1F]">
            {note.length}/200 · {rateLimit.used}/{rateLimit.max} used today
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setShowNote(false); setNote(""); }}
              data-testid="recommend-cancel-btn"
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-[#7C5F1F] border border-[#E8D89A]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitRecommend}
              disabled={busy}
              data-testid="recommend-submit-btn"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Recommend
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowNote(true)}
      disabled={busy}
      data-testid="recommend-open-btn"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FFF8E1] text-[#7C5F1F] border border-[#E8D89A] hover:bg-[#FFF3D6] disabled:opacity-60"
      title="Recommend this book to the Shelfsort community"
    >
      <Sparkles className="w-3.5 h-3.5" /> Recommend to community
    </button>
  );
}
