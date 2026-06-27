import React from "react";
import OneTimeTip from "./OneTimeTip";

/**
 * AirdropInfoTip — the original tab-close-safe upload tip.
 *
 * Kept as a thin wrapper around the generic `OneTimeTip` so existing
 * mount points keep working unchanged.  The dismissal key
 * (`shelfsort.tip.airdrop-tab-close-dismissed`) is preserved exactly
 * so users who already dismissed the original component stay
 * dismissed after the refactor.
 */
export default function AirdropInfoTip({ compact = false }) {
  return (
    <OneTimeTip tipKey="airdrop-tab-close" compact={compact} accent="purple">
      once the upload bar finishes, you can close this tab.{" "}
      <span className="text-[#6B705C] dark:text-[#A99878]">
        Shelfsort keeps sorting on the server — books appear in your library as each one finishes processing. Big drops use airdrop mode automatically (20+ files).
      </span>
    </OneTimeTip>
  );
}
