import React, { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DownloadCloud, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

// Mirror of the backend's fanfic-permalink set — used for client-side
// "this looks like a fanfic URL, the button is enabled" validation.
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

function isFanficUrl(s) {
  if (!s) return false;
  const u = s.trim();
  return FANFIC_PATTERNS.some((re) => re.test(u));
}

/**
 * Always-visible URL slot in the Navbar. Paste a fanfic URL → press
 * Enter (or click the green button) and Shelfsort fetches the EPUB into
 * your library. The action calls the same serial `/books/url-list/pull`
 * endpoint as the global paste detector, so behavior is consistent across
 * the three entry points (paste anywhere, paste here, FilterUrlList page).
 *
 * On screens narrower than `md`, the input is hidden — the global paste
 * detector still works on mobile, so no functionality is lost.
 */
export default function NavbarQuickAdd() {
  const [value, setValue] = useState("");
  const [pulling, setPulling] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const valid = useMemo(() => isFanficUrl(value), [value]);

  const submit = async () => {
    if (!valid || pulling) return;
    const url = value.trim();
    setPulling(true);
    const inFlight = toast.loading("Fetching the EPUB…");
    try {
      const resp = await api.post(
        "/books/url-list/pull",
        { urls: [url] },
        { timeout: 0 },
      );
      const added = resp.data.added?.length || 0;
      const owned = resp.data.already_owned?.length || 0;
      const failed = resp.data.failed?.length || 0;
      toast.dismiss(inFlight);
      if (added > 0) {
        const book = resp.data.added[0];
        toast.success(
          `Added “${book.title}”${book.fandom ? ` · ${book.fandom}` : ""} to your library.`,
          {
            duration: 8000,
            action: { label: "Open library", onClick: () => navigate("/library") },
          },
        );
        setValue("");
      } else if (owned > 0 && added === 0 && failed === 0) {
        toast("Already in your library — nothing to add.");
        setValue("");
      } else if (failed > 0) {
        const err = resp.data.failed[0]?.error || "Couldn't fetch that URL.";
        toast.error(`Fetch failed — ${err}`);
      }
    } catch (e) {
      toast.dismiss(inFlight);
      toast.error("Fetch failed — " + (e.response?.data?.detail || e.message || "unknown error"));
    } finally {
      setPulling(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="hidden md:flex items-center gap-1 px-2 py-1 rounded-lg border border-[#E5DDC5] bg-white focus-within:border-[#E07A5F]/60 transition-colors"
      data-testid="navbar-quick-add"
    >
      <Sparkles
        className={`w-3.5 h-3.5 flex-shrink-0 ${valid ? "text-[#6B46C1]" : "text-[#5B5F4D]"}`}
      />
      <input
        ref={inputRef}
        data-testid="navbar-quick-add-input"
        type="url"
        placeholder="Paste a fanfic URL to add it…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        disabled={pulling}
        className="bg-transparent outline-none text-sm w-48 lg:w-64 placeholder:text-[#5B5F4D]/70 text-[#2C2C2C]"
        aria-label="Quick-add fanfic URL"
      />
      <button
        data-testid="navbar-quick-add-submit"
        onClick={submit}
        disabled={!valid || pulling}
        className="p-1 rounded text-[#6B46C1] hover:bg-[#6B46C1]/10 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0"
        title={valid ? "Fetch this fic as an EPUB" : "Paste an AO3 / FFnet / RoyalRoad URL"}
        aria-label="Fetch URL as EPUB"
      >
        {pulling
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <DownloadCloud className="w-4 h-4" />}
      </button>
    </div>
  );
}
