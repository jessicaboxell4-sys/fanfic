import React from "react";
import { Sparkles, Shield } from "lucide-react";

/**
 * AiClassifierCard (iter 89 rebuild from screenshot).
 *
 * Sits inside Account / Settings and lets the user choose whether
 * Shelfsort's ambiguous-file classifier is allowed to send a short
 * snippet to an LLM for a one-shot categorization.  Two tiles:
 * "AI on (default)" and "AI off".  Persists via
 * PATCH /api/user/ai-classification-opt.
 */
export default function AiClassifierCard({ value = "on", onChange }) {
  const set = (next) => {
    if (onChange) onChange(next);
  };
  return (
    <section
      className="rounded-2xl border border-[#3E3323] bg-[#1F1810] p-6 text-[#EDE3D0]"
      data-testid="ai-classify-card"
      aria-labelledby="ai-classify-heading"
    >
      <div className="flex items-start gap-3 mb-3">
        <Shield className="w-6 h-6 text-[#B78AE0] shrink-0" aria-hidden="true" />
        <div>
          <h3 id="ai-classify-heading" className="font-serif text-2xl text-white leading-tight">AI classifier</h3>
        </div>
      </div>
      <p className="text-sm text-[#D6C6AE] leading-relaxed mb-4">
        By default, Shelfsort sorts most books using metadata alone (title, author, tags). When metadata is
        ambiguous, it sends a small snippet to an AI for a one-shot classification — never for training,
        never shared outside your library. If you&apos;d rather no AI touch your files at all (common for
        readers with locked AO3 works, or anyone who just prefers manual filing), turn it off here.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => set("on")}
          data-testid="ai-classify-on"
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            value === "on"
              ? "border-[#B78AE0] bg-[#B78AE0]/15 text-white"
              : "border-[#3E3323] bg-transparent text-[#EDE3D0] hover:bg-white/5"
          }`}
        >
          <p className="font-semibold flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-[#B78AE0]" aria-hidden="true" /> AI on (default)
          </p>
          <p className="text-xs text-[#D6C6AE]">
            Metadata-first; AI helps with the ambiguous 20%. Best for large libraries with messy metadata.
          </p>
        </button>
        <button
          type="button"
          onClick={() => set("off")}
          data-testid="ai-classify-off"
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            value === "off"
              ? "border-[#B78AE0] bg-[#B78AE0]/15 text-white"
              : "border-[#3E3323] bg-transparent text-[#EDE3D0] hover:bg-white/5"
          }`}
        >
          <p className="font-semibold mb-1">AI off</p>
          <p className="text-xs text-[#D6C6AE]">
            Metadata only. Ambiguous files land on the Unclassified shelf for you to sort by hand.
          </p>
        </button>
      </div>
    </section>
  );
}
