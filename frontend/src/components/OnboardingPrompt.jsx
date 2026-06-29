import React, { useEffect, useState } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * One-time banner on the Dashboard that asks the user whether they'd like
 * Shelfsort to retroactively apply its EPUB template + tidy filenames to
 * their existing library. Surfaces once they have ≥1 uploaded book and
 * stays dismissed forever after either button click.
 */
export default function OnboardingPrompt() {
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [bookCount, setBookCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/user/onboarding-status");
        if (!cancelled && data.template_prompt_pending) {
          setVisible(true);
          setBookCount(data.book_count || 0);
        }
      } catch (e) {
        /* silent — banner just doesn't show */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = async (accept) => {
    setWorking(true);
    const t = accept
      ? toast.loading("Polishing your library…")
      : null;
    try {
      const { data } = await api.post(
        "/user/dismiss-template-prompt",
        { accept },
        { timeout: 600000 },
      );
      if (accept) {
        const parts = [];
        if (data?.template?.templated > 0) parts.push(`${data.template.templated} templated`);
        if (data?.template?.already_templated > 0) parts.push(`${data.template.already_templated} already templated`);
        if (data?.filenames?.updated > 0) parts.push(`${data.filenames.updated} renamed`);
        toast.success(parts.join(" · ") || "All set", { id: t });
      } else {
        toast.success("No problem — you can change this any time in your account.");
      }
      setVisible(false);
    } catch (e) {
      if (t) toast.error("Couldn't run that — try again later", { id: t });
      else toast.error("Couldn't save that choice");
    } finally {
      setWorking(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="relative mb-8 p-5 sm:p-6 rounded-2xl bg-[#FDF3E1] border border-[#B87A00]/30 flex flex-col sm:flex-row sm:items-center gap-4"
      data-testid="onboarding-template-prompt"
    >
      <button
        type="button"
        onClick={() => dismiss(false)}
        disabled={working}
        aria-label="Dismiss"
        data-testid="onboarding-template-dismiss"
        className="absolute top-3 right-3 text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-white text-[#B87A00] flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-serif text-lg text-[#2C2C2C] mb-1">
            Polish your library?
          </p>
          <p className="text-sm text-[#5B5F4D]">
            We can give every one of your {bookCount} book{bookCount === 1 ? "" : "s"} a clean
            intro page (title, author, source link) and rename them to a tidy{" "}
            <span className="font-mono text-xs">Title_by_Author.epub</span> pattern.
            Already-templated books are skipped automatically. You can change this any time in your account.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => dismiss(false)}
          disabled={working}
          data-testid="onboarding-template-decline"
          className="px-4 py-2 rounded-xl border border-[#B87A00]/30 bg-white text-sm text-[#5B5F4D] hover:bg-[#FBF7EE] disabled:opacity-60"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={() => dismiss(true)}
          disabled={working}
          data-testid="onboarding-template-accept"
          className="px-5 py-2 rounded-xl bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4730] disabled:opacity-60 flex items-center gap-2"
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {working ? "Working…" : "Yes, polish everything"}
        </button>
      </div>
    </div>
  );
}
