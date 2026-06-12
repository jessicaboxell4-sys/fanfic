import React from "react";
import { Palette, Check } from "lucide-react";
import { usePalette } from "../context/PaletteContext";

// Theme palette picker — one swatch per preset. Click swaps the four
// CSS variables driving the accent colour site-wide (both light and dark
// modes). Persisted to localStorage; no backend round-trip. Reuses the
// existing CSS bridge in index.css, so no JSX colour edits are needed.
export default function PalettePickerCard() {
  const { palette, paletteId, setPaletteId, palettes } = usePalette();

  return (
    <section className="shelf-card p-6 mb-6" data-testid="palette-picker-card">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#3A5A40] flex items-center justify-center flex-shrink-0">
          <Palette className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Theme palette</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">
            Pick the accent colour that runs through every button, link, and badge. Saved to this browser. Both light and dark modes update together.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4" data-testid="palette-grid">
        {palettes.map((p) => {
          const selected = p.id === paletteId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPaletteId(p.id)}
              data-testid={`palette-option-${p.id}`}
              aria-pressed={selected}
              className={`relative text-left rounded-xl border p-3 transition-all ${
                selected
                  ? "border-[#3A5A40] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#3A5A40]/40"
              }`}
            >
              {selected && (
                <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#3A5A40] text-white flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-6 h-6 rounded-full border border-black/10"
                  style={{ background: `linear-gradient(135deg, ${p.light.primary} 0%, ${p.light.primaryHover} 100%)` }}
                  aria-hidden
                />
                <span
                  className="w-6 h-6 rounded-full border border-black/10"
                  style={{ background: `linear-gradient(135deg, ${p.light.pale1} 0%, ${p.light.pale2} 100%)` }}
                  aria-hidden
                />
                <p className="font-semibold text-sm text-[#2C2C2C]">{p.name}</p>
              </div>
              <p className="text-xs text-[#6B705C] leading-snug pr-6">{p.description}</p>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[#6B705C] mt-4">
        Currently using <strong className="text-[#2C2C2C]">{palette.name}</strong>.
        To add or tweak palettes, edit{" "}
        <code className="bg-[#FBFAF6] border border-[#E5DDC5] px-1.5 py-0.5 rounded text-[10px]">
          /app/frontend/src/lib/palettes.js
        </code>
        .
      </p>
    </section>
  );
}
