import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { PALETTES, DEFAULT_PALETTE_ID, PALETTE_STORAGE_KEY, buildPaletteCss } from "../lib/palettes";

// Manages the active palette. On mount + every change, injects a
// <style id="shelfsort-palette"> tag into <head> that overrides the
// `--primary`-family CSS variables for both light and dark themes. The
// CSS bridge in /app/frontend/src/index.css consumes those variables
// site-wide, so flipping palette recolours every accent instantly.
const PaletteContext = createContext({
  palette: PALETTES[0],
  paletteId: PALETTES[0].id,
  setPaletteId: () => {},
  palettes: PALETTES,
});

const STYLE_TAG_ID = "shelfsort-palette";

function readStoredPaletteId() {
  try {
    const id = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (id && PALETTES.some((p) => p.id === id)) return id;
  } catch { /* ignore */ }
  return DEFAULT_PALETTE_ID;
}

export function PaletteProvider({ children }) {
  const [paletteId, setPaletteIdState] = useState(readStoredPaletteId);

  // Apply palette on mount + every change. Single <style> tag is kept
  // up to date; cascade beats :root in index.css because both selectors
  // have the same specificity and ours appears later in document order.
  useEffect(() => {
    const palette = PALETTES.find((p) => p.id === paletteId) || PALETTES[0];
    let tag = document.getElementById(STYLE_TAG_ID);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = STYLE_TAG_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = buildPaletteCss(palette);
  }, [paletteId]);

  const setPaletteId = (id) => {
    setPaletteIdState(id);
    try { localStorage.setItem(PALETTE_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const value = useMemo(() => ({
    palette: PALETTES.find((p) => p.id === paletteId) || PALETTES[0],
    paletteId,
    setPaletteId,
    palettes: PALETTES,
  }), [paletteId]);

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette() {
  return useContext(PaletteContext);
}
