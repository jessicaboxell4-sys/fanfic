import React, { useState } from "react";
import { Link2, Twitter, MessageCircle, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Compact share buttons for a public cover or profile.  Hits the
 * `/api/share/...` server-rendered HTML page so Twitter / Bluesky /
 * Discord previews carry proper OG meta tags + a per-cover OG image.
 *
 * Provided `shareUrl` should be the `/api/share/...` URL so social
 * media scrapers hit the OG-tagged HTML, not the SPA route.
 *
 * Props:
 *   shareUrl  - canonical absolute URL to share
 *   title     - tweet / message body text
 */
export const ShareButtons = ({ shareUrl, title }) => {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  const t = encodeURIComponent(title);
  const u = encodeURIComponent(shareUrl);
  const twitter = `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
  const bluesky = `https://bsky.app/intent/compose?text=${t}%20${u}`;

  return (
    <div className="inline-flex items-center gap-2" data-testid="share-buttons">
      <a
        href={twitter}
        target="_blank"
        rel="noreferrer"
        className="tap-min inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E8E6E1] text-[#2C2C2C] hover:border-[#1DA1F2] hover:text-[#1DA1F2] transition-colors bg-white"
        data-testid="share-twitter"
      >
        <Twitter className="w-3 h-3" /> X
      </a>
      <a
        href={bluesky}
        target="_blank"
        rel="noreferrer"
        className="tap-min inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E8E6E1] text-[#2C2C2C] hover:border-[#0085FF] hover:text-[#0085FF] transition-colors bg-white"
        data-testid="share-bluesky"
      >
        <MessageCircle className="w-3 h-3" /> Bluesky
      </a>
      <button
        type="button"
        onClick={onCopy}
        className="tap-min inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E8E6E1] text-[#2C2C2C] hover:border-[#6B46C1] hover:text-[#6B46C1] transition-colors bg-white"
        data-testid="share-copy"
        aria-pressed={copied}
      >
        {copied ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
};
