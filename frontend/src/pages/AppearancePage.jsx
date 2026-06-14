import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Sun, Moon, Palette, RotateCcw, Share2, Copy, Check, ArrowDownToLine, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import PalettePickerCard from "../components/PalettePickerCard";
import WpmCard from "../components/WpmCard";
import { useTheme } from "../context/ThemeContext";
import { usePalette } from "../context/PaletteContext";
import {
  DEFAULT_PALETTE_ID, DEFAULT_CUSTOM_LIGHT,
  encodePaletteToken, decodePaletteToken,
  GUEST_PALETTES, CUSTOM_PALETTE_ID,
} from "../lib/palettes";

// /account/appearance — full theme & colour controls.
// Reached from the Navbar appearance popover ("More appearance options →")
// or directly. Hosts the Light/Dark toggle, the full Palette Picker
// (formerly on /account), and a live preview.
export default function AppearancePage() {
  const { theme, mode, setMode, autoConfig, setAutoConfig, toggleTheme } = useTheme();
  const { palette, paletteId, setPaletteId, customLight, setCustomLight } = usePalette();
  const [confirmReset, setConfirmReset] = useState(false);
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);

  const resetDefaults = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setPaletteId(DEFAULT_PALETTE_ID);
    setCustomLight(DEFAULT_CUSTOM_LIGHT);
    setConfirmReset(false);
    toast.success("Appearance reset to defaults");
  };
  const isAtDefaults = paletteId === DEFAULT_PALETTE_ID;

  const currentToken = encodePaletteToken(paletteId, customLight);
  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(currentToken);
      setCopied(true);
      toast.success("Palette token copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't access the clipboard — copy the text manually");
    }
  };

  // The four hex codes that define the visible palette in the current
  // theme (light/dark) — used by both the Markdown and PNG exports.
  const swatches = (() => {
    const src = theme === "dark" ? palette.dark : palette.light;
    return [
      { label: "Accent",       hex: src.primary },
      { label: "Accent hover", hex: src.primaryHover },
      { label: "Pale 1",       hex: src.pale1 },
      { label: "Pale 2",       hex: src.pale2 },
    ];
  })();

  const copyAsMarkdown = async () => {
    // A copy-pasteable block that renders cleanly on Discord, GitHub,
    // Notion, anywhere. Token at the bottom so a friend can import it
    // in one tap from /account/appearance.
    const md = [
      `**${palette.name}** — Shelfsort palette (${theme} theme)`,
      "",
      "| Role | Hex |",
      "| --- | --- |",
      ...swatches.map((s) => `| ${s.label} | \`${s.hex}\` |`),
      "",
      `Apply: paste \`${currentToken}\` at /account/appearance`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Palette copied as Markdown");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  };

  const downloadPng = () => {
    // Generate the screenshot entirely client-side via Canvas API —
    // no html2canvas dependency, no network round-trip. 800×420 px so
    // the file looks crisp on social / Discord without being huge.
    const W = 800;
    const H = 420;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Canvas not supported in this browser");
      return;
    }
    // Backdrop — match the chosen theme's surface so the image reads
    // correctly when shared standalone.
    const bg = theme === "dark" ? "#1B1B1E" : "#FAF6EE";
    const ink = theme === "dark" ? "#E8E4D8" : "#2C2C2C";
    const muted = theme === "dark" ? "#A8A6A0" : "#6B705C";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Title
    ctx.fillStyle = ink;
    ctx.font = "bold 38px serif";
    ctx.fillText(palette.name, 48, 80);
    ctx.fillStyle = muted;
    ctx.font = "16px sans-serif";
    ctx.fillText(`Shelfsort palette · ${theme} theme`, 48, 110);
    // Swatches
    const swatchW = 160;
    const swatchH = 160;
    const gap = 20;
    const startX = 48;
    const startY = 150;
    swatches.forEach((s, i) => {
      const x = startX + i * (swatchW + gap);
      ctx.fillStyle = s.hex;
      ctx.fillRect(x, startY, swatchW, swatchH);
      // 1-px stroke so very light swatches don't disappear on bg
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, startY + 0.5, swatchW - 1, swatchH - 1);
      // Label + hex below
      ctx.fillStyle = ink;
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(s.label, x, startY + swatchH + 22);
      ctx.fillStyle = muted;
      ctx.font = "12px monospace";
      ctx.fillText(s.hex, x, startY + swatchH + 40);
    });
    // Footer token
    ctx.fillStyle = muted;
    ctx.font = "12px monospace";
    ctx.fillText(`Import: ${currentToken}`, 48, H - 24);
    // Trigger download
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error("Couldn't render the image");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shelfsort-palette-${paletteId}-${theme}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Palette PNG downloaded");
    }, "image/png");
  };

  const applyImport = () => {
    const result = decodePaletteToken(importText);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.customLight) setCustomLight(result.customLight);
    setPaletteId(result.paletteId);
    setImportText("");
    toast.success(`Applied palette '${result.paletteId}'`);
  };

  const applyGuest = (guest) => {
    setCustomLight(guest.light);
    setPaletteId(CUSTOM_PALETTE_ID);
    toast.success(`Applied '${guest.name}'`);
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12" data-testid="appearance-page">
        <Link
          to="/account"
          className="inline-flex items-center gap-2 text-sm text-[#6E6E6E] hover:text-[#2C2C2C] mb-6"
          data-testid="appearance-back-btn"
        >
          <ArrowLeft className="h-4 w-4" /> Back to account
        </Link>

        <header className="flex items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
            <Palette className="h-6 w-6 text-[#6B46C1]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight">
              Appearance
            </h1>
            <p className="text-sm text-[#6B705C]">
              Theme, accent colour, and how Shelfsort looks on this browser.
            </p>
          </div>
        </header>

        {/* Light / Dark theme card */}
        <section className="shelf-card p-6 mb-6" data-testid="appearance-theme-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
              {theme === "dark" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Theme</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Light is warm AO3 paper, dark is the same layout with a deep slate background. Saved to this browser.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3" data-testid="appearance-theme-options">
            <button
              type="button"
              onClick={() => setMode("light")}
              data-testid="appearance-theme-light-btn"
              aria-pressed={mode === "light"}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                mode === "light"
                  ? "border-[#6B46C1] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-5 h-5 text-[#B87A00]" />
                <p className="font-semibold text-[#2C2C2C]">Light</p>
              </div>
              <p className="text-xs text-[#6B705C]">Warm paper background, slate ink type.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("dark")}
              data-testid="appearance-theme-dark-btn"
              aria-pressed={mode === "dark"}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                mode === "dark"
                  ? "border-[#6B46C1] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Moon className="w-5 h-5 text-[#6B46C1]" />
                <p className="font-semibold text-[#2C2C2C]">Dark</p>
              </div>
              <p className="text-xs text-[#6B705C]">Deep slate, paper-bright type, accent-coloured highlights.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("auto")}
              data-testid="appearance-theme-auto-btn"
              aria-pressed={mode === "auto"}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                mode === "auto"
                  ? "border-[#6B46C1] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-5 h-5 text-[#B87A00]" />
                <Moon className="w-5 h-5 text-[#6B46C1] -ml-1.5" />
                <p className="font-semibold text-[#2C2C2C]">Auto</p>
              </div>
              <p className="text-xs text-[#6B705C]">Switch at your chosen hours or follow the system theme.</p>
            </button>
          </div>

          {mode === "auto" && (
            <div className="mt-4 p-4 rounded-xl bg-[#FBFAF6] border border-[#E5DDC5] space-y-3" data-testid="appearance-auto-config">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B705C]">Auto strategy</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAutoConfig({ kind: "time" })}
                  data-testid="appearance-auto-kind-time"
                  aria-pressed={autoConfig.kind === "time"}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    autoConfig.kind === "time"
                      ? "border-[#6B46C1] bg-white"
                      : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
                  }`}
                >
                  <p className="font-semibold text-[#2C2C2C]">Time of day</p>
                  <p className="text-xs text-[#6B705C]">Dark from a custom hour each evening.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoConfig({ kind: "system" })}
                  data-testid="appearance-auto-kind-system"
                  aria-pressed={autoConfig.kind === "system"}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    autoConfig.kind === "system"
                      ? "border-[#6B46C1] bg-white"
                      : "border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40"
                  }`}
                >
                  <p className="font-semibold text-[#2C2C2C]">Follow system</p>
                  <p className="text-xs text-[#6B705C]">Use your OS / browser appearance.</p>
                </button>
              </div>

              {autoConfig.kind === "time" && (
                <div className="grid grid-cols-2 gap-3" data-testid="appearance-auto-time-config">
                  <label className="block text-xs text-[#6B705C]">
                    Dark from
                    <input
                      type="time"
                      value={autoConfig.dark_start}
                      onChange={(e) => setAutoConfig({ dark_start: e.target.value })}
                      data-testid="appearance-auto-dark-start"
                      className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
                    />
                  </label>
                  <label className="block text-xs text-[#6B705C]">
                    Back to light at
                    <input
                      type="time"
                      value={autoConfig.dark_end}
                      onChange={(e) => setAutoConfig({ dark_end: e.target.value })}
                      data-testid="appearance-auto-dark-end"
                      className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
                    />
                  </label>
                </div>
              )}
              <p className="text-[11px] text-[#6B705C]" data-testid="appearance-auto-effective">
                Currently rendering: <strong className="text-[#2C2C2C]">{theme}</strong>
                {autoConfig.kind === "time" && (
                  <> · dark window <code className="bg-white px-1 rounded">{autoConfig.dark_start}</code> – <code className="bg-white px-1 rounded">{autoConfig.dark_end}</code> (local time)</>
                )}
              </p>
            </div>
          )}
        </section>

        {/* Palette picker (was on /account) */}
        <PalettePickerCard />

        {/* Reading-speed setting for word-count time estimates */}
        <WpmCard />

        {/* Live preview */}
        <section className="shelf-card p-6 mb-6" data-testid="appearance-preview-card">
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1">Live preview</h2>
          <p className="text-sm text-[#6B705C] mb-4">
            Sample components rendered with your current theme + palette.
          </p>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary text-sm" data-testid="appearance-preview-primary-btn">Primary button</button>
              <button type="button" className="btn-secondary text-sm" data-testid="appearance-preview-secondary-btn">Secondary</button>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--pale1)] border border-[var(--primary)]/30 text-xs font-semibold text-[var(--primary)]">
                NEW pill
              </span>
            </div>
            <div className="rounded-xl p-4 border border-[#E5DDC5]" style={{ background: "linear-gradient(135deg, var(--pale1) 0%, var(--pale2) 100%)" }}>
              <p className="font-serif text-xl text-[#2C2C2C] mb-1">Sample card heading</p>
              <p className="text-sm text-[#4A4A4A]">
                Body text on a pale-tint background.{" "}
                <a href="#preview-link" onClick={(e) => e.preventDefault()} className="text-[var(--primary)] font-semibold underline">
                  And a link
                </a>{" "}
                that uses the accent.
              </p>
            </div>
          </div>
        </section>

        {/* Guest palette gallery */}
        <section className="shelf-card p-6 mb-6" data-testid="appearance-gallery-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Curated palettes</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Hand-picked palettes beyond the six presets. One click applies; tweak from there in the Custom hex picker above.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="appearance-gallery-grid">
            {GUEST_PALETTES.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => applyGuest(g)}
                data-testid={`appearance-gallery-${g.id}`}
                className="group text-left rounded-xl border border-[#E5DDC5] bg-white hover:border-[#6B46C1]/40 hover:shadow-sm transition-all overflow-hidden"
              >
                <div
                  className="h-14 w-full"
                  style={{ background: `linear-gradient(135deg, ${g.light.primary} 0%, ${g.light.primaryHover} 50%, ${g.light.pale2} 100%)` }}
                  aria-hidden
                />
                <div className="p-3">
                  <p className="font-semibold text-sm text-[#2C2C2C] mb-0.5">{g.name}</p>
                  <p className="text-xs text-[#6B705C] leading-snug">{g.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Share palette */}
        <section className="shelf-card p-6 mb-6" data-testid="appearance-share-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Share palette</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Copy your current palette as a short token, or paste one from a friend to apply theirs instantly.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Export current */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
                Your current palette <span className="font-normal text-[#6B705C]/70">({palette.name})</span>
              </label>
              <div className="flex gap-2">
                <code
                  data-testid="appearance-share-token"
                  className="flex-1 text-xs font-mono bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2 truncate select-all"
                  title={currentToken}
                >
                  {currentToken}
                </code>
                <button
                  type="button"
                  onClick={copyToken}
                  data-testid="appearance-share-copy-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4632] transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyAsMarkdown}
                  data-testid="appearance-share-markdown-btn"
                  title="Copy a Markdown block with hex codes — paste into Discord/GitHub/Notion"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] bg-white border border-[#6B46C1] text-[#6B46C1] hover:bg-[#EEE9FB] transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" /> Copy as Markdown
                </button>
                <button
                  type="button"
                  onClick={downloadPng}
                  data-testid="appearance-share-png-btn"
                  title="Download a PNG screenshot of this palette"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] bg-white border border-[#6B46C1] text-[#6B46C1] hover:bg-[#EEE9FB] transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> Download PNG
                </button>
              </div>
            </div>

            {/* Import */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
                Paste a palette token
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyImport(); }}
                  placeholder="ss-p-forest  or  ss-c-eyJ2…"
                  data-testid="appearance-share-import-input"
                  className="flex-1 text-xs font-mono bg-white border border-[#E5DDC5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
                />
                <button
                  type="button"
                  onClick={applyImport}
                  disabled={!importText.trim()}
                  data-testid="appearance-share-import-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#6B46C1] text-[#6B46C1] text-sm font-semibold hover:bg-[#FBFAF6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                  Apply
                </button>
              </div>
              <p className="text-xs text-[#6B705C] mt-1.5">
                Presets export as a short string (e.g. <code className="bg-[#FBFAF6] px-1.5 py-0.5 rounded text-[10px]">ss-p-forest</code>). Custom palettes pack the four hexes into a longer token.
              </p>
            </div>
          </div>
        </section>

        <p className="text-xs text-[#6B705C] text-center">
          Both settings are stored in this browser only. Sign in on another device to set them there too.
        </p>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={resetDefaults}
            data-testid="appearance-reset-btn"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
              confirmReset
                ? "text-[#B43F26]"
                : "text-[#6B705C] hover:text-[#2C2C2C]"
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            {confirmReset ? "Click again to confirm reset" : "Reset to defaults"}
          </button>
          {confirmReset && (
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              data-testid="appearance-reset-cancel-btn"
              className="text-xs text-[#6B705C] hover:text-[#2C2C2C]"
            >
              cancel
            </button>
          )}
          {!confirmReset && isAtDefaults && (
            <span className="text-[10px] text-[#6B705C] italic">
              (currently at defaults)
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
