import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Link as LinkIcon, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Dashboard URL-paste card.
 *
 * A spotlighted, always-visible textarea so the user can drop a list of
 * fanfic URLs straight from the landing screen — no extra click required.
 * On submit we stash the text in ``sessionStorage`` under
 * ``urlFilterPrefill`` and navigate to the full filter page, which reads
 * + clears the prefill on mount and seeds its own textarea.
 *
 * The card is deliberately taller than the old one-line "Have a list of
 * fanfic URLs?" link and shows a live "N fanfic URL(s) detected" counter
 * so the user can confirm their paste was recognized before submitting.
 */

const FANFIC_PATTERNS = [
  /https?:\/\/(?:www\.|m\.|insecure\.)?archiveofourown\.(?:org|com|net|gay)\/(?:collections\/[^/?#]+\/)?works\/\d+/i,
  /https?:\/\/(?:www\.|m\.)?ao3\.org\/works\/\d+/i,
  /https?:\/\/archive\.transformativeworks\.org\/works\/\d+/i,
  /https?:\/\/(?:www\.)?fanfiction\.net\/s\/\d+/i,
  /https?:\/\/(?:www\.)?fictionpress\.com\/s\/\d+/i,
  /https?:\/\/(?:www\.)?royalroad\.com\/fiction\/\d+/i,
  /https?:\/\/(?:forums?\.|www\.)?spacebattles\.com\/threads\/[\w-]+\.\d+/i,
  /https?:\/\/(?:forums?\.|www\.)?sufficientvelocity\.com\/threads\/[\w-]+\.\d+/i,
  /https?:\/\/(?:forums?\.|www\.)?questionablequesting\.com\/threads\/[\w-]+\.\d+/i,
];

function countFanficUrls(text) {
  if (!text) return 0;
  const urlRe = /https?:\/\/[^\s,;<>"']+/g;
  let n = 0;
  let m;
  const seen = new Set();
  while ((m = urlRe.exec(text)) !== null) {
    const u = m[0].replace(/[.,);\]>]+$/, "");
    if (seen.has(u)) continue;
    seen.add(u);
    if (FANFIC_PATTERNS.some((re) => re.test(u))) n++;
  }
  return n;
}

export default function UrlPasteCard() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detected = useMemo(() => countFanficUrls(text), [text]);

  const handleSubmit = () => {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      toast.message("Paste some URLs first.");
      return;
    }
    setSubmitting(true);
    try {
      // Hand off to the full filter page via sessionStorage so the
      // textarea on the destination is pre-populated. Cleared by the
      // destination on first read.
      sessionStorage.setItem("urlFilterPrefill", trimmed);
      navigate("/library/filter-urls");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid="url-paste-card"
      className="shelf-card p-6 md:p-8 bg-[#EDE7FB] border border-[#6B46C1]/20 rounded-2xl"
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="w-11 h-11 rounded-xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <LinkIcon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] leading-tight">
            Have a list of fanfic URLs?
          </h2>
          <p className="text-sm text-[#6B705C] mt-1.5">
            Paste them below — we’ll <strong>filter out the ones you already own</strong>, flag duplicates inside your list, and hand you back a clean Excel + .txt of just the new ones to fetch.
          </p>
        </div>
      </div>

      <textarea
        data-testid="url-paste-card-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"https://archiveofourown.org/works/12345\nhttps://www.fanfiction.net/s/67890/\nhttps://www.royalroad.com/fiction/111\n…"}
        className="w-full px-4 py-3 rounded-xl border border-[#E8E6E1] bg-white/80 backdrop-blur-sm text-sm text-[#2C2C2C] font-mono leading-relaxed placeholder:text-[#6B705C]/60 placeholder:font-mono focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 focus:border-[#6B46C1] resize-y min-h-[120px]"  /* dark-ok — bg-white/80 is remapped in index.css */
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <p
          className="text-xs text-[#6B705C]"
          data-testid="url-paste-card-detected"
        >
          {detected === 0
            ? <>Recognized fanfic links will appear here as you paste — AO3, FFnet, RoyalRoad, SpaceBattles, SV, QQ, FictionPress.</>
            : <><span className="font-bold text-[#6B46C1] text-sm">{detected}</span> fanfic URL{detected === 1 ? "" : "s"} detected</>}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          data-testid="url-paste-card-submit"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? "Opening…" : "Filter my list"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
