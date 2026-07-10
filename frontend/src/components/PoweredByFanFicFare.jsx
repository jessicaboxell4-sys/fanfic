import React from "react";
import { Wrench } from "lucide-react";

/**
 * Polite credit + trust signal: the fic-pulling pipeline is the same library
 * Calibre users have used for years.
 */
export default function PoweredByFanFicFare({ className = "" }) {
  return (
    <a
      href="https://github.com/JimmXinu/FanFicFare"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FBFAF6] border border-[#E8E6E1] text-xs text-[#5B5F4D] hover:border-[#6B46C1]/40 hover:text-[#6B46C1] transition-colors ${className}`}
      data-testid="powered-by-fanficfare"
      title="Fanfic downloads are powered by FanFicFare — the proven library trusted by Calibre users."
    >
      <Wrench className="h-3 w-3" />
      Powered by{" "}
      <span className="font-mono font-semibold tracking-tight">FanFicFare</span>
    </a>
  );
}
