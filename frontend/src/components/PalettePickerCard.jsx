import React from "react";
import { Palette, Check, Sliders } from "lucide-react";
import { usePalette } from "../context/PaletteContext";
import { CUSTOM_PALETTE_ID } from "../lib/palettes";

const SLOT_LABELS = {
  primary:      { name: "Primary",       hint: "Buttons, links, the NEW pill" },
  primaryHover: { name: "Primary hover", hint: "Pressed/hover state — slightly darker" },
  pale1:        { name: "Pale tint 1",   hint: "Gradient start, soft card backgrounds" },
  pale2:        { name: "Pale tint 2",   hint: "Gradient end, second card layer" },
};

// Theme palette picker — one swatch per preset plus a "Custom" option
// that opens 4 color inputs. Click swaps the four CSS variables driving
// the accent colour site-wide (both light and dark modes). Persisted to
// localStorage; no backend round-trip. Reuses the existing CSS bridge
// in index.css, so no JSX colour edits are needed.
export default function PalettePickerCard() {
  const { palette, paletteId, setPaletteId, palettes, customLight, setCustomLight } = usePalette();
  const isCustomActive = paletteId === CUSTOM_PALETTE_ID;

  const updateSlot = (slot, hex) => {
    const next = { ...customLight, [slot]: hex };
    setCustomLight(next);
    if (!isCustomActive) setPaletteId(CUSTOM_PALETTE_ID);
  };

  return (
    <section className="shelf-card p-6 mb-6" data-testid="palette-picker-card">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <Palette className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Theme palette</h2>
          <p className="text-sm text-[#5B5F4D] mt-0.5">
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
                  ? "border-[#6B46C1] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
              }`}
            >
              {selected && (
                <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#6B46C1] text-white flex items-center justify-center">
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
              <p className="text-xs text-[#5B5F4D] leading-snug pr-6">{p.description}</p>
            </button>
          );
        })}

        {/* Custom — 7th option. Click selects it; the 4 colour inputs
            below let the user dial in any palette they like. */}
        <button
          type="button"
          onClick={() => setPaletteId(CUSTOM_PALETTE_ID)}
          data-testid={`palette-option-${CUSTOM_PALETTE_ID}`}
          aria-pressed={isCustomActive}
          className={`relative text-left rounded-xl border p-3 transition-all ${
            isCustomActive
              ? "border-[#6B46C1] bg-[#FBFAF6] shadow-sm"
              : "border-[#E5DDC5] border-dashed bg-white hover:border-[#6B46C1]/40"
          }`}
        >
          {isCustomActive && (
            <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#6B46C1] text-white flex items-center justify-center">
              <Check className="w-3 h-3" />
            </span>
          )}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-6 h-6 rounded-full border border-black/10"
              style={{ background: `linear-gradient(135deg, ${customLight.primary} 0%, ${customLight.primaryHover} 100%)` }}
              aria-hidden
            />
            <span
              className="w-6 h-6 rounded-full border border-black/10"
              style={{ background: `linear-gradient(135deg, ${customLight.pale1} 0%, ${customLight.pale2} 100%)` }}
              aria-hidden
            />
            <p className="font-semibold text-sm text-[#2C2C2C] inline-flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5" /> Custom
            </p>
          </div>
          <p className="text-xs text-[#5B5F4D] leading-snug pr-6">Your own palette. Click below to pick each colour — dark-mode variants are auto-derived.</p>
        </button>
      </div>

      {/* Colour pickers — visible whenever Custom is selected. */}
      {isCustomActive && (
        <div className="mt-5 p-4 rounded-xl border border-[#E5DDC5] bg-[#FBFAF6]" data-testid="palette-custom-pickers">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-3">Light-mode colours · dark variants are auto-derived</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(SLOT_LABELS).map(([slot, meta]) => (
              <label
                key={slot}
                className="flex items-center gap-3 p-2 rounded-lg bg-white border border-[#E5DDC5]"
                data-testid={`palette-custom-slot-${slot}`}
              >
                <input
                  type="color"
                  value={customLight[slot]}
                  onChange={(e) => updateSlot(slot, e.target.value)}
                  data-testid={`palette-custom-input-${slot}`}
                  className="w-10 h-10 rounded cursor-pointer border-none bg-transparent p-0"
                  aria-label={`Pick ${meta.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C]">{meta.name}</p>
                  <p className="text-xs text-[#5B5F4D] truncate">{meta.hint}</p>
                </div>
                <code className="text-[10px] text-[#5B5F4D] tabular-nums">{customLight[slot].toUpperCase()}</code>
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-[#5B5F4D] mt-4">
        Currently using <strong className="text-[#2C2C2C]">{palette.name}</strong>.
        To add or tweak presets, edit{" "}
        <code className="bg-[#FBFAF6] border border-[#E5DDC5] px-1.5 py-0.5 rounded text-[10px]">
          /app/frontend/src/lib/palettes.js
        </code>
        .
      </p>
    </section>
  );
}
