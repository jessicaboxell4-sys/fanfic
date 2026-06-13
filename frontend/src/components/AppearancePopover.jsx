import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sun, Moon, Palette, Check, Sliders, ChevronRight } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { usePalette } from "../context/PaletteContext";
import { CUSTOM_PALETTE_ID } from "../lib/palettes";

// Navbar appearance popover — light/dark toggle + palette swatches +
// link to the full /account/appearance page. Closes on outside click or
// Escape. Replaces the bare theme-toggle icon button.
export default function AppearancePopover() {
  const { theme, toggleTheme } = useTheme();
  const { paletteId, setPaletteId, palettes, customLight } = usePalette();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isCustom = paletteId === CUSTOM_PALETTE_ID;

  return (
    <div className="relative" ref={rootRef}>
      <button
        data-testid="navbar-theme-toggle"
        onClick={() => setOpen((v) => !v)}
        className="p-2 hover:bg-[#F5F3EC] rounded-lg"
        title="Appearance — theme & colour"
        aria-label="Appearance"
        aria-expanded={open}
      >
        {theme === "dark"
          ? <Sun className="w-4 h-4 text-[#6B705C]" />
          : <Moon className="w-4 h-4 text-[#6B705C]" />}
      </button>

      {open && (
        <div
          data-testid="appearance-popover"
          role="dialog"
          aria-label="Appearance settings"
          className="absolute right-0 mt-2 w-72 rounded-xl border border-[#E8E6E1] bg-white shadow-lg z-50 overflow-hidden"
        >
          {/* Theme row */}
          <div className="p-3 border-b border-[#E8E6E1]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B705C] mb-2 px-1">
              Theme
            </p>
            <button
              type="button"
              onClick={toggleTheme}
              data-testid="appearance-popover-theme-toggle"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[#FBFAF6] text-left"
            >
              <span className="flex items-center gap-2 text-sm text-[#2C2C2C]">
                {theme === "dark"
                  ? <Moon className="w-4 h-4 text-[#6B705C]" />
                  : <Sun className="w-4 h-4 text-[#6B705C]" />}
                {theme === "dark" ? "Dark mode" : "Light mode"}
              </span>
              <span className="text-xs text-[#6B705C]">switch →</span>
            </button>
          </div>

          {/* Palette grid */}
          <div className="p-3 border-b border-[#E8E6E1]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B705C] mb-2 px-1 flex items-center gap-1.5">
              <Palette className="w-3 h-3" /> Accent colour
            </p>
            <div className="grid grid-cols-4 gap-2" data-testid="appearance-popover-palette-grid">
              {palettes.map((p) => {
                const selected = p.id === paletteId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPaletteId(p.id)}
                    data-testid={`appearance-popover-palette-${p.id}`}
                    aria-pressed={selected}
                    title={p.name}
                    className={`relative h-10 rounded-lg border transition-all ${
                      selected
                        ? "border-[#3A5A40] ring-2 ring-[#3A5A40]/30"
                        : "border-[#E5DDC5] hover:border-[#3A5A40]/40"
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${p.light.primary} 0%, ${p.light.primaryHover} 100%)`,
                    }}
                  >
                    {selected && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white drop-shadow" />
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Custom slot — 7th tile */}
              <button
                type="button"
                onClick={() => setPaletteId(CUSTOM_PALETTE_ID)}
                data-testid={`appearance-popover-palette-${CUSTOM_PALETTE_ID}`}
                aria-pressed={isCustom}
                title="Custom palette"
                className={`relative h-10 rounded-lg border-2 border-dashed transition-all flex items-center justify-center ${
                  isCustom
                    ? "border-[#3A5A40] ring-2 ring-[#3A5A40]/30"
                    : "border-[#E5DDC5] hover:border-[#3A5A40]/40"
                }`}
                style={
                  isCustom
                    ? { background: `linear-gradient(135deg, ${customLight.primary} 0%, ${customLight.primaryHover} 100%)` }
                    : undefined
                }
              >
                <Sliders className={`w-3.5 h-3.5 ${isCustom ? "text-white drop-shadow" : "text-[#6B705C]"}`} />
              </button>
            </div>
            <p className="text-[10px] text-[#6B705C] mt-2 px-1">
              Click a swatch to switch site-wide colour.
            </p>
          </div>

          {/* More options link */}
          <Link
            to="/account/appearance"
            onClick={() => setOpen(false)}
            data-testid="appearance-popover-more-link"
            className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-[#3A5A40] hover:bg-[#FBFAF6] font-semibold"
          >
            <span>More appearance options</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
