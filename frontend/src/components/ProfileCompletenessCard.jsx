import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Check, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  computeCompletenessScore,
  missingDimensions,
  COMPLETENESS_DIMS,
  COMPLETENESS_EVENT,
} from "../lib/profileCompleteness";

// Profile-completeness meter — sits at the top of /account.
// Reads {username, bio, library_visible_to_public} from /api/auth/me,
// renders 3 progress dots + a label + per-missing-dimension CTAs.
//
// Refreshes whenever any save handler dispatches the
// shelfsort:profile-completeness-changed event (Account.jsx +
// PrivacyMessagingCard wire this), so the meter always reflects the
// truth without us lifting state into the parent.  When the user
// hits 3/3, the card shows a "Profile complete" celebration state
// and stays visible (no auto-hide — the celebration IS the reward).
//
// "Almost there!" toast lives here (single-source-of-truth): on
// every refetch we diff the old vs new score and toast ONLY on an
// increase, so clearing a bio or opting back out of public doesn't
// nag the user.  Initial mount sets the baseline silently.
export default function ProfileCompletenessCard() {
  const [me, setMe] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Tracks the LAST score we observed.  null on first paint so the
  // initial fetch doesn't fire a toast (no "Welcome to your existing
  // 2/3" greeting — only celebrate forward progress).
  const lastScoreRef = useRef(null);

  const fetchMe = useCallback(async (opts = {}) => {
    try {
      const { data } = await api.get("/auth/me");
      const newScore = computeCompletenessScore(data);
      const prev = lastScoreRef.current;
      if (prev !== null && newScore > prev && opts.maybeToast !== false) {
        if (newScore === 3) {
          toast.success("Profile complete!", {
            description: "Handle, bio, public library — you're all set. Other readers will find you.",
            duration: 6000,
          });
        } else if (newScore === 2) {
          toast.success("Almost there — 2 of 3 done.", {
            description: "One more step to unlock the full discoverability boost.",
            duration: 5000,
          });
        } else if (newScore === 1) {
          toast.success("Nice — 1 of 3 done.", {
            description: "Keep going — two more to make your profile feel real to other readers.",
            duration: 5000,
          });
        }
      }
      lastScoreRef.current = newScore;
      setMe(data);
    } catch { /* silent — card just hides */ }
    finally { setLoaded(true); }
  }, []);

  // Initial mount: silent baseline (no toast).
  useEffect(() => { fetchMe({ maybeToast: false }); }, [fetchMe]);

  // Subsequent dispatches from save handlers: may toast.
  useEffect(() => {
    const handler = () => fetchMe({ maybeToast: true });
    window.addEventListener(COMPLETENESS_EVENT, handler);
    return () => window.removeEventListener(COMPLETENESS_EVENT, handler);
  }, [fetchMe]);

  if (!loaded || !me) return null;

  const score = computeCompletenessScore(me);
  const missing = missingDimensions(me);
  const isComplete = score === 3;

  return (
    <section
      data-testid="profile-completeness-card"
      data-completeness-score={score}
      className={`shelf-card p-6 mb-6 border-2 ${
        isComplete
          ? "border-[#C5E1A5] bg-[#F1F8E9]"
          : "border-[#E8D89A] bg-[#FFF8E1]"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            isComplete ? "bg-[#558B2F] text-white" : "bg-[#B7791F] text-white"
          }`}
        >
          {isComplete ? <Check className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-serif text-2xl text-[#2C2C2C]">
              {isComplete ? "Profile complete" : "Boost your discoverability"}
            </h2>
            <span
              className="text-sm font-mono text-[#5B5F4D]"
              data-testid="profile-completeness-score"
            >
              {score} / 3
            </span>
          </div>
          <p className="text-sm text-[#5B5F4D] mt-1">
            {isComplete
              ? "You've got the works — handle, bio, and a public library. Other readers will find you."
              : "Three quick steps make your profile feel real to other readers."}
          </p>

          {/* 3-dot meter — visible at a glance.  Filled dots = done. */}
          <div className="flex items-center gap-2 mt-4" data-testid="profile-completeness-dots">
            {COMPLETENESS_DIMS.map((dim) => {
              const done = !missing.find((m) => m.key === dim.key);
              return (
                <span
                  key={dim.key}
                  data-testid={`profile-completeness-dot-${dim.key}`}
                  data-state={done ? "done" : "pending"}
                  title={`${done ? "✓ " : ""}${dim.label}`}
                  className={`inline-block w-3 h-3 rounded-full ${
                    done
                      ? "bg-[#558B2F]"
                      : "bg-white border-2 border-[#E8D89A]"
                  }`}
                />
              );
            })}
          </div>

          {!isComplete && missing.length > 0 && (
            <ul className="mt-4 space-y-1.5" data-testid="profile-completeness-missing-list">
              {missing.map((dim) => (
                <li key={dim.key} className="flex items-center gap-2">
                  <Link
                    to={dim.cta}
                    data-testid={`profile-completeness-cta-${dim.key}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6B46C1] hover:text-[#553397]"
                  >
                    {dim.label}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
