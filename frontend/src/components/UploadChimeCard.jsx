import React, { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { isUploadChimeEnabled, setUploadChimeEnabled, playUploadChime } from "../lib/uploadChime";

// Account section: toggle a tiny chime when the last in-flight upload
// finishes.  Off by default.  Settings live in localStorage (per
// device), no backend round-trip needed.  Includes a "Preview" button
// so users hear what they'll be opting in to before saving.
export default function UploadChimeCard() {
  const [enabled, setEnabled] = useState(() => isUploadChimeEnabled());

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setUploadChimeEnabled(next);
    if (next) {
      // Fire one immediately so the user hears it on enable —
      // doubles as auto-confirmation that the toggle worked.
      // (playUploadChime checks the flag, which is now true.)
      playUploadChime();
      toast.success("Chime on — you'll hear it when uploads finish.");
    } else {
      toast("Chime off.");
    }
  };

  const preview = () => {
    // Force-play once for preview, irrespective of toggle state.
    const wasOn = isUploadChimeEnabled();
    if (!wasOn) setUploadChimeEnabled(true);
    playUploadChime();
    if (!wasOn) setUploadChimeEnabled(false);
  };

  return (
    <section className="shelf-card p-6 mb-6" data-testid="upload-chime-card">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
          {enabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Upload chime</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">
            Play a soft two-note tone when your last in-flight upload finishes — handy if you tab away while a big batch is sorting.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#2C2C2C]">
            {enabled ? "Chime is on" : "Chime is off"}
          </p>
          <p className="text-xs text-[#6B705C]">
            Settings live on this device only — turn it on once per browser.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={preview}
            data-testid="upload-chime-preview-btn"
            className="text-xs px-3 py-1.5 rounded border border-[#E5DDC5] text-[#6B705C] hover:bg-white"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={toggle}
            data-testid="upload-chime-toggle"
            aria-pressed={enabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
