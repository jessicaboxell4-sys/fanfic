import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

// Mirror of the backend's fanfic-permalink set. Kept narrow on purpose so the
// global toast only fires for URLs we can actually fetch — pasting some
// unrelated link into a form field should NOT trigger the offer.
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

function extractFanficUrls(text) {
  if (!text || typeof text !== "string") return [];
  const urlRe = /https?:\/\/[^\s,;<>"']+/g;
  const out = [];
  const seen = new Set();
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const url = match[0].replace(/[.,);\]>]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    if (FANFIC_PATTERNS.some((re) => re.test(url))) out.push(url);
  }
  return out;
}

// Pages that already have their own paste-aware UX — don't double-prompt
// when the user is there.
const SUPPRESS_ROUTES = ["/library/filter-urls"];

/**
 * Global, mounted-once paste listener. When a user pastes a recognized
 * fanfic URL anywhere on the site (except pages that already handle URL
 * paste themselves), a Sonner toast appears offering to fetch it as an
 * EPUB. The toast auto-dismisses in 8 seconds if ignored, so it never
 * gets in the way.
 *
 * Why a `paste` listener (not a clipboard poll): paste fires synchronously
 * with the user's intent and gives us access to the actual pasted text via
 * `event.clipboardData.getData('text')` — no permissions, no polling, and
 * no race with what the user is typing into the active input.
 */
export default function UrlPasteDetector() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Suppress the same canonical URL from prompting twice in quick succession
  // (e.g. user undo-redoing a paste, or two paste events from a single drop).
  const recentRef = useRef(new Map());

  useEffect(() => {
    if (!user) return;
    if (SUPPRESS_ROUTES.some((r) => location.pathname.startsWith(r))) return;

    const handler = (e) => {
      // Don't second-guess paste into form fields — they have their own UX.
      // The navbar QuickAdd input, the FilterUrlList textarea, search boxes,
      // etc. all funnel paste content into something the user is actively
      // typing into; the global toast would just compete with that.
      const tag = (e?.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e?.target?.isContentEditable) return;

      const txt = e?.clipboardData?.getData?.("text") || "";
      const urls = extractFanficUrls(txt);
      if (urls.length === 0 || urls.length > 3) return;

      // Dedupe across short timespans
      const now = Date.now();
      const key = urls.join("|");
      const last = recentRef.current.get(key);
      if (last && (now - last) < 4000) return;
      recentRef.current.set(key, now);
      // Clean old entries
      for (const [k, t] of recentRef.current.entries()) {
        if (now - t > 60000) recentRef.current.delete(k);
      }

      const isSingle = urls.length === 1;
      const summary = isSingle
        ? "Just pasted a fanfic URL — fetch it as an EPUB?"
        : `Just pasted ${urls.length} fanfic URLs — fetch them as EPUBs?`;

      toast(summary, {
        id: `paste-prompt-${key}`,
        description: isSingle
          ? "We'll fetch it via FanFicFare and drop the EPUB onto your shelves."
          : `We'll fetch them one at a time and drop the EPUBs onto your shelves.`,
        duration: 8000,
        action: {
          label: isSingle ? "Fetch it" : "Fetch all",
          onClick: async () => {
            const inFlight = toast.loading(
              isSingle ? "Fetching the EPUB…" : `Fetching ${urls.length} EPUBs one at a time…`,
            );
            try {
              const resp = await api.post(
                "/books/url-list/pull",
                { urls },
                { timeout: 0 },
              );
              const added = resp.data.added?.length || 0;
              const owned = resp.data.already_owned?.length || 0;
              const failed = resp.data.failed?.length || 0;
              toast.dismiss(inFlight);
              if (added > 0) {
                toast.success(
                  `Pulled ${added} new ${added === 1 ? "book" : "books"} into your library${failed ? ` (${failed} failed)` : ""}.`,
                  {
                    duration: 8000,
                    action: { label: "Open library", onClick: () => navigate("/library") },
                  },
                );
              } else if (owned > 0 && added === 0 && failed === 0) {
                toast("Already in your library — nothing to add.");
              } else if (failed > 0) {
                toast.error(`Couldn't fetch ${isSingle ? "the URL" : `${failed} of the URLs`}.`);
              }
            } catch (err) {
              toast.dismiss(inFlight);
              toast.error("Fetch failed — " + (err.response?.data?.detail || err.message || "unknown error"));
            }
          },
        },
      });
    };

    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [user, location.pathname, navigate]);

  return null;
}
