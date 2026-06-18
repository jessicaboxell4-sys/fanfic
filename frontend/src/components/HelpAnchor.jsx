import React from "react";
import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { api } from "../lib/api";

/**
 * Tiny "?" icon that deep-links into the Help page at the right
 * section anchor.  Drop next to any feature so users can fetch
 * docs in-context without leaving their workflow.
 *
 *   <HelpAnchor section="cloud-backup" label="About cloud backup" />
 *
 * Use the same `section` id that the matching <Section id="..."> in
 * Help.jsx exposes — the link becomes `/help#<section>`.
 *
 * Each click anonymously pings `POST /api/help/track` so the Help
 * page can sort its TOC by genuine user engagement instead of the
 * hand-curated order.
 */
export default function HelpAnchor({ section, label, className = "" }) {
  if (!section) return null;
  const handleClick = () => {
    try { api.post("/help/track", { section }); } catch { /* fire-and-forget */ }
  };
  return (
    <Link
      to={`/help#${section}`}
      onClick={handleClick}
      title={label || "Open the help article for this feature"}
      aria-label={label || `Help — ${section}`}
      data-testid={`help-anchor-${section}`}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[#6B705C] hover:text-[#6B46C1] transition-colors ${className}`}
    >
      <HelpCircle className="w-3.5 h-3.5" />
    </Link>
  );
}
