import React from "react";
import { Check, X as XIcon } from "lucide-react";

/**
 * Reader appearance presets — Kindle-style.
 *
 * Each preset paints the iframe body via epubjs's themes API.  Kept
 * deliberately small (six skins, four fonts) so the panel stays a
 * one-glance UI.  All values are passed straight to epubjs's
 * ``rendition.themes.register(name, css)`` — keys are CSS selectors,
 * values are CSS declarations.
 *
 * Day side (light bgs):
 *   paper   — original cream (Shelfsort default)
 *   white   — pure white, like a fresh page
 *   sage    — soft teal-mint, easy on tired eyes
 * Night side (dark bgs):
 *   midnight    — near-black + warm off-white text
 *   sepia-night — warm brown + cream text (matches our library aesthetic)
 *   oled        — true black + dim text (OLED battery saver)
 */
export const READER_THEMES = {
  paper: {
    label: "Cream",
    side: "day",
    swatch: "#FDFBF7",
    swatchText: "#2C2C2C",
    css: {
      body: { color: "#2C2C2C", background: "#FDFBF7" },
      "h1, h2, h3, h4": { color: "#2C2C2C" },
      a: { color: "#E07A5F" },
    },
    wrapBg: "#FDFBF7",
    wrapText: "#2C2C2C",
  },
  white: {
    label: "White",
    side: "day",
    swatch: "#FFFFFF",
    swatchText: "#1A1A1A",
    css: {
      body: { color: "#1A1A1A", background: "#FFFFFF" },
      "h1, h2, h3, h4": { color: "#1A1A1A" },
      a: { color: "#0F62FE" },
    },
    wrapBg: "#FFFFFF",
    wrapText: "#1A1A1A",
  },
  sage: {
    label: "Sage",
    side: "day",
    swatch: "#E4EDE6",
    swatchText: "#1F3A2E",
    css: {
      body: { color: "#1F3A2E", background: "#E4EDE6" },
      "h1, h2, h3, h4": { color: "#1F3A2E" },
      a: { color: "#2F855A" },
    },
    wrapBg: "#E4EDE6",
    wrapText: "#1F3A2E",
  },
  midnight: {
    label: "Midnight",
    side: "night",
    swatch: "#1A1A1A",
    swatchText: "#E8E4D6",
    css: {
      body: { color: "#E8E4D6", background: "#1A1A1A" },
      "h1, h2, h3, h4": { color: "#F5F1E3" },
      a: { color: "#F8B373" },
    },
    wrapBg: "#1A1A1A",
    wrapText: "#E8E4D6",
  },
  "sepia-night": {
    label: "Sepia Night",
    side: "night",
    swatch: "#2B1F1A",
    swatchText: "#F2E8D5",
    css: {
      body: { color: "#F2E8D5", background: "#2B1F1A" },
      "h1, h2, h3, h4": { color: "#F8EFD8" },
      a: { color: "#E07A5F" },
    },
    wrapBg: "#2B1F1A",
    wrapText: "#F2E8D5",
  },
  oled: {
    label: "OLED Black",
    side: "night",
    swatch: "#000000",
    swatchText: "#BFBFBF",
    css: {
      body: { color: "#BFBFBF", background: "#000000" },
      "h1, h2, h3, h4": { color: "#D8D8D8" },
      a: { color: "#7AA7FF" },
    },
    wrapBg: "#000000",
    wrapText: "#BFBFBF",
  },
};

/**
 * Font presets — names map to webfonts already loaded in index.html.
 * ``family`` is injected verbatim into the iframe CSS, so include
 * fallbacks.
 */
export const READER_FONTS = {
  manrope: {
    label: "Sans",
    sample: "Aa",
    family: "'Manrope', system-ui, sans-serif",
  },
  lora: {
    label: "Serif",
    sample: "Aa",
    family: "'Lora', 'Georgia', serif",
  },
  cormorant: {
    label: "Classic",
    sample: "Aa",
    family: "'Cormorant Garamond', 'Georgia', serif",
  },
  atkinson: {
    label: "Readable",
    sample: "Aa",
    family: "'Atkinson Hyperlegible', system-ui, sans-serif",
  },
};

export const DEFAULT_THEME = "paper";
export const DEFAULT_FONT = "manrope";

export default function ReaderThemePanel({ open, onClose, themeId, fontId, onThemeChange, onFontChange }) {
  if (!open) return null;
  const themes = Object.entries(READER_THEMES);
  const fonts = Object.entries(READER_FONTS);

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-80 bg-[#FDFBF7] border-l border-[#E8E6E1] shadow-xl z-40 overflow-y-auto"
      data-testid="reader-theme-panel"
    >
      <div className="sticky top-0 bg-[#FDFBF7] border-b border-[#E8E6E1] p-4 flex items-center justify-between">
        <h3 className="font-serif text-lg text-[#2C2C2C]">Appearance</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-[#5B5F4D] hover:text-[#2C2C2C]"
          data-testid="reader-theme-panel-close"
          aria-label="Close appearance panel"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Day side */}
        <section>
          <p className="text-xs uppercase tracking-wider text-[#5B5F4D] font-semibold mb-2">Light</p>
          <div className="grid grid-cols-3 gap-2">
            {themes.filter(([, t]) => t.side === "day").map(([id, t]) => (
              <ThemeSwatch key={id} id={id} theme={t} active={themeId === id} onClick={() => onThemeChange(id)} />
            ))}
          </div>
        </section>

        {/* Night side */}
        <section>
          <p className="text-xs uppercase tracking-wider text-[#5B5F4D] font-semibold mb-2">Dark</p>
          <div className="grid grid-cols-3 gap-2">
            {themes.filter(([, t]) => t.side === "night").map(([id, t]) => (
              <ThemeSwatch key={id} id={id} theme={t} active={themeId === id} onClick={() => onThemeChange(id)} />
            ))}
          </div>
        </section>

        {/* Font picker */}
        <section>
          <p className="text-xs uppercase tracking-wider text-[#5B5F4D] font-semibold mb-2">Font</p>
          <div className="grid grid-cols-2 gap-2">
            {fonts.map(([id, f]) => (
              <button
                key={id}
                type="button"
                data-testid={`reader-font-${id}`}
                onClick={() => onFontChange(id)}
                className={`flex flex-col items-center justify-center py-3 rounded-lg border transition-all ${
                  fontId === id
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-[#E8E6E1] bg-white hover:border-[#9B9B8C]"
                }`}
              >
                <span style={{ fontFamily: f.family }} className="text-2xl text-[#2C2C2C] leading-none mb-1">
                  {f.sample}
                </span>
                <span className="text-[11px] text-[#5B5F4D]">{f.label}</span>
              </button>
            ))}
          </div>
        </section>

        <p className="text-[11px] text-[#9B9B8C] italic pt-2">
          Your choice is remembered across every book you read.
        </p>
      </div>
    </div>
  );
}

function ThemeSwatch({ id, theme, active, onClick }) {
  return (
    <button
      type="button"
      data-testid={`reader-theme-${id}`}
      onClick={onClick}
      title={theme.label}
      aria-pressed={active}
      className={`relative flex flex-col items-center justify-center aspect-[5/6] rounded-lg border-2 transition-all overflow-hidden ${
        active ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/30" : "border-[#E8E6E1] hover:border-[#9B9B8C]"
      }`}
      style={{ background: theme.swatch }}
    >
      <span
        style={{ color: theme.swatchText, fontFamily: "'Cormorant Garamond', serif" }}
        className="text-2xl leading-none"
      >
        Aa
      </span>
      <span style={{ color: theme.swatchText }} className="text-[10px] mt-1 opacity-80">
        {theme.label}
      </span>
      {active && (
        <span className="absolute top-1 right-1 bg-[var(--primary)] text-white rounded-full w-4 h-4 flex items-center justify-center">
          <Check className="w-2.5 h-2.5" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
