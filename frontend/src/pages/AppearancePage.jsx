import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Sun, Moon, Palette } from "lucide-react";
import Navbar from "../components/Navbar";
import PalettePickerCard from "../components/PalettePickerCard";
import { useTheme } from "../context/ThemeContext";

// /account/appearance — full theme & colour controls.
// Reached from the Navbar appearance popover ("More appearance options →")
// or directly. Hosts the Light/Dark toggle, the full Palette Picker
// (formerly on /account), and a live preview.
export default function AppearancePage() {
  const { theme, toggleTheme } = useTheme();

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
            <Palette className="h-6 w-6 text-[#3A5A40]" />
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
            <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#3A5A40] flex items-center justify-center flex-shrink-0">
              {theme === "dark" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Theme</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Light is warm AO3 paper, dark is the same layout with a deep slate background. Saved to this browser.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3" data-testid="appearance-theme-options">
            <button
              type="button"
              onClick={() => { if (theme !== "light") toggleTheme(); }}
              data-testid="appearance-theme-light-btn"
              aria-pressed={theme === "light"}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                theme === "light"
                  ? "border-[#3A5A40] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#3A5A40]/40"
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
              onClick={() => { if (theme !== "dark") toggleTheme(); }}
              data-testid="appearance-theme-dark-btn"
              aria-pressed={theme === "dark"}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                theme === "dark"
                  ? "border-[#3A5A40] bg-[#FBFAF6] shadow-sm"
                  : "border-[#E5DDC5] bg-white hover:border-[#3A5A40]/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Moon className="w-5 h-5 text-[#3A5A40]" />
                <p className="font-semibold text-[#2C2C2C]">Dark</p>
              </div>
              <p className="text-xs text-[#6B705C]">Deep slate, paper-bright type, accent-coloured highlights.</p>
            </button>
          </div>
        </section>

        {/* Palette picker (was on /account) */}
        <PalettePickerCard />

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

        <p className="text-xs text-[#6B705C] text-center">
          Both settings are stored in this browser only. Sign in on another device to set them there too.
        </p>
      </main>
    </div>
  );
}
