// Palette presets — each defines the 4 CSS variables that drive the whole
// site's accent colour in both light and dark modes. Adding a new palette
// = drop a new entry here; PalettePickerCard renders one swatch per item.
//
// Variables consumed by the CSS bridge in /app/frontend/src/index.css:
//   --primary         solid accent
//   --primary-hover   pressed/hover variant
//   --accent-pale-1   gradient start + pale fills
//   --accent-pale-2   gradient end
//
// Light values target an off-white parchment bg (#FAF6EE) — pick saturated
// hues with enough contrast for body text. Dark values target #1B1B1E —
// brighten primaries (luminance ~70-75%) and invert pale tints to deep
// hues of the same family so gradient cards still pop.

export const PALETTES = [
  {
    id: "peach",
    name: "Peach",
    description: "The original. Warm, paper-like, AO3-cream.",
    light: { primary: "#E07A5F", primaryHover: "#D1684D", pale1: "#FCEFE6", pale2: "#F8E3D3" },
    dark:  { primary: "#F09A7F", primaryHover: "#FFB89F", pale1: "#3a2a1f", pale2: "#4a3326" },
  },
  {
    id: "purple",
    name: "Purple",
    description: "Rich violet. Modern, calm, a touch regal.",
    light: { primary: "#8B5CF6", primaryHover: "#7C3AED", pale1: "#F3EDFF", pale2: "#E5D3FF" },
    dark:  { primary: "#A78BFA", primaryHover: "#C4B5FD", pale1: "#2A1F3A", pale2: "#3A2A4F" },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep moss green. Library-quiet, very Shelfsort.",
    light: { primary: "#3A7D5F", primaryHover: "#2F6B4F", pale1: "#E5F4EC", pale2: "#CBE9D6" },
    dark:  { primary: "#7BC49E", primaryHover: "#A8D7B8", pale1: "#1F3024", pale2: "#28452F" },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cobalt blue. Crisp, focused, slightly nautical.",
    light: { primary: "#3B82F6", primaryHover: "#2563EB", pale1: "#E0EDFF", pale2: "#C7D8FF" },
    dark:  { primary: "#7FB6FF", primaryHover: "#A8CDFF", pale1: "#1A2A3F", pale2: "#243B57" },
  },
  {
    id: "crimson",
    name: "Crimson",
    description: "Bold ruby red. Dramatic and warm.",
    light: { primary: "#DC2626", primaryHover: "#B91C1C", pale1: "#FCE5E5", pale2: "#F9CCCC" },
    dark:  { primary: "#FF7878", primaryHover: "#FFB0B0", pale1: "#3A1F1F", pale2: "#4F2A2A" },
  },
  {
    id: "charcoal",
    name: "Charcoal",
    description: "Monochrome. Minimal, ink-on-paper.",
    light: { primary: "#525252", primaryHover: "#404040", pale1: "#F0F0EE", pale2: "#DBDBD8" },
    dark:  { primary: "#B0B0B0", primaryHover: "#D0D0D0", pale1: "#2A2A2D", pale2: "#3F3F44" },
  },
];

export const CUSTOM_PALETTE_ID = "custom";
export const CUSTOM_PALETTE_KEY = "shelfsort_palette_custom";

// Default custom palette starting point — same hexes as Purple so the
// picker opens on a known-good state instead of black/transparent.
export const DEFAULT_CUSTOM_LIGHT = {
  primary: "#8B5CF6", primaryHover: "#7C3AED", pale1: "#F3EDFF", pale2: "#E5D3FF",
};

// HSL helpers --------------------------------------------------------------
function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Derive dark-mode variants from a light-mode palette. Brightens the
// primaries (higher luminance, slight saturation lift) and replaces the
// pale tints with deep-luminance versions of the same hue so gradient
// cards stay on-brand in dark mode.
export function deriveDarkPalette(light) {
  const p = hexToHsl(light.primary);
  const ph = hexToHsl(light.primaryHover);
  const t1 = hexToHsl(light.pale1);
  const t2 = hexToHsl(light.pale2);
  return {
    primary:      hslToHex({ h: p.h,  s: Math.max(p.s,  60),  l: Math.max(p.l,  60) }),
    primaryHover: hslToHex({ h: ph.h, s: Math.max(ph.s, 50),  l: Math.max(ph.l, 75) }),
    pale1:        hslToHex({ h: t1.h, s: Math.max(t1.s, 25),  l: 14 }),
    pale2:        hslToHex({ h: t2.h, s: Math.max(t2.s, 25),  l: 20 }),
  };
}

export const DEFAULT_PALETTE_ID = "purple";
export const PALETTE_STORAGE_KEY = "shelfsort_palette";

// Builds a <style> tag content string that sets both light + dark vars
// for the chosen palette. Injected into <head> so it overrides :root in
// index.css naturally via cascade.
export function buildPaletteCss(palette) {
  const l = palette.light;
  const d = palette.dark;
  return `
:root {
  --primary: ${l.primary};
  --primary-hover: ${l.primaryHover};
  --accent-pale-1: ${l.pale1};
  --accent-pale-2: ${l.pale2};
}
:root[data-theme="dark"] {
  --primary: ${d.primary};
  --primary-hover: ${d.primaryHover};
  --accent-pale-1: ${d.pale1};
  --accent-pale-2: ${d.pale2};
}
`.trim();
}
