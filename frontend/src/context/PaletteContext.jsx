import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import {
  PALETTES, DEFAULT_PALETTE_ID, PALETTE_STORAGE_KEY, buildPaletteCss,
  CUSTOM_PALETTE_ID, CUSTOM_PALETTE_KEY, DEFAULT_CUSTOM_LIGHT, deriveDarkPalette,
} from "../lib/palettes";

// Manages the active palette. On mount + every change, injects a
// <style id="shelfsort-palette"> tag into <head> that overrides the
// `--primary`-family CSS variables for both light and dark themes. The
// CSS bridge in /app/frontend/src/index.css consumes those variables
// site-wide, so flipping palette recolours every accent instantly.
//
// The "custom" pseudo-palette stores its 4 light-mode hexes in a
// separate localStorage key (CUSTOM_PALETTE_KEY); dark variants are
// auto-derived via HSL math in `deriveDarkPalette`.
const PaletteContext = createContext({
  palette: PALETTES[0],
  paletteId: PALETTES[0].id,
  setPaletteId: () => {},
  palettes: PALETTES,
  customLight: DEFAULT_CUSTOM_LIGHT,
  setCustomLight: () => {},
});

const STYLE_TAG_ID = "shelfsort-palette";

function readStoredPaletteId() {
  try {
    const id = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (id === CUSTOM_PALETTE_ID) return id;
    if (id && PALETTES.some((p) => p.id === id)) return id;
  } catch { /* ignore */ }
  return DEFAULT_PALETTE_ID;
}

function readStoredCustom() {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_KEY);
    if (!raw) return DEFAULT_CUSTOM_LIGHT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CUSTOM_LIGHT, ...parsed };
  } catch { return DEFAULT_CUSTOM_LIGHT; }
}

function resolvePalette(paletteId, customLight) {
  if (paletteId === CUSTOM_PALETTE_ID) {
    return {
      id: CUSTOM_PALETTE_ID,
      name: "Custom",
      description: "Your hand-picked palette.",
      light: customLight,
      dark: deriveDarkPalette(customLight),
    };
  }
  return PALETTES.find((p) => p.id === paletteId) || PALETTES[0];
}

export function PaletteProvider({ children }) {
  const [paletteId, setPaletteIdState] = useState(readStoredPaletteId);
  const [customLight, setCustomLightState] = useState(readStoredCustom);

  // Apply palette on mount + every change. Single <style> tag is kept
  // up to date; cascade beats :root in index.css because both selectors
  // have the same specificity and ours appears later in document order.
  useEffect(() => {
    const palette = resolvePalette(paletteId, customLight);
    let tag = document.getElementById(STYLE_TAG_ID);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = STYLE_TAG_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = buildPaletteCss(palette);
  }, [paletteId, customLight]);

  const setPaletteId = (id) => {
    setPaletteIdState(id);
    try { localStorage.setItem(PALETTE_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const setCustomLight = (next) => {
    setCustomLightState(next);
    try { localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const value = useMemo(() => ({
    palette: resolvePalette(paletteId, customLight),
    paletteId,
    setPaletteId,
    palettes: PALETTES,
    customLight,
    setCustomLight,
  }), [paletteId, customLight]);

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette() {
  return useContext(PaletteContext);
}
