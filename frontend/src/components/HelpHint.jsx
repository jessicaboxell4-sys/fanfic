import React from "react";
import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";

// Small "?" link that deep-links into the Help guide at a specific section.
// Use it on pages where new users might get stuck.
//
//   <HelpHint section="url-list" label="How does this work?" />
//
// Defaults to the top of the guide if no section is passed.
export default function HelpHint({ section, label = "Help", testId = "help-hint" }) {
  const to = section ? `/help#${section}` : "/help";
  return (
    <Link
      to={to}
      data-testid={testId}
      title={`Open Shelfsort help${section ? ` · ${section}` : ""}`}
      className="inline-flex items-center gap-1 text-xs text-[#6B705C] hover:text-[#E07A5F] underline-offset-2 hover:underline"
    >
      <HelpCircle className="w-3.5 h-3.5" />
      <span>{label}</span>
    </Link>
  );
}
