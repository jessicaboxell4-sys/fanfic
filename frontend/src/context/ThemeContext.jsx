import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

// Three modes:
//   "light"  — always light
//   "dark"   — always dark
//   "auto"   — derives the active theme from `autoConfig.kind`:
//       "system" → follows the OS / browser prefers-color-scheme
//       "time"   → local-time based; dark between dark_start and dark_end (HH:MM, 24h)
//
// Persisted to localStorage as two keys so older clients (which only knew
// "light"/"dark" via the legacy single key) auto-migrate to mode=light/dark.

const ThemeContext = createContext(null);

const LEGACY_KEY = "shelfsort_theme";        // "light" | "dark"
const MODE_KEY = "shelfsort_theme_mode";     // "light" | "dark" | "auto"
const AUTO_CFG_KEY = "shelfsort_theme_auto"; // JSON of AutoConfig

const DEFAULT_AUTO_CONFIG = {
  kind: "time",        // "time" | "system"
  dark_start: "19:00", // HH:MM local — dark from here ...
  dark_end: "07:00",   // ... up to here
};

function readStoredMode() {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
    // Migrate the legacy single key.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch (e) { /* ignore */ }
  return "light";
}

function readStoredAutoConfig() {
  try {
    const raw = window.localStorage.getItem(AUTO_CFG_KEY);
    if (!raw) return DEFAULT_AUTO_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.kind === "time" || parsed.kind === "system")) {
      return {
        kind: parsed.kind,
        dark_start: parsed.dark_start || DEFAULT_AUTO_CONFIG.dark_start,
        dark_end: parsed.dark_end || DEFAULT_AUTO_CONFIG.dark_end,
      };
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_AUTO_CONFIG;
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Returns "dark" if the current local-time minute falls inside the
 * [dark_start, dark_end) window. Supports windows that span midnight
 * (e.g. 19:00 → 07:00 — dark from 7 PM through 7 AM the next morning).
 */
export function isWithinDarkWindow(now, darkStart, darkEnd) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = parseHHMM(darkStart);
  const end = parseHHMM(darkEnd);
  if (start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // Window wraps midnight.
  return cur >= start || cur < end;
}

function systemPrefersDark() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch (e) {
    return false;
  }
}

function deriveEffective(mode, autoConfig, now = new Date()) {
  if (mode === "light" || mode === "dark") return mode;
  // mode === "auto"
  if (autoConfig.kind === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return isWithinDarkWindow(now, autoConfig.dark_start, autoConfig.dark_end) ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => readStoredMode());
  const [autoConfig, setAutoConfigState] = useState(() => readStoredAutoConfig());
  const [tick, setTick] = useState(0); // re-evaluation trigger for time-based auto

  // Effective theme — derived, not stored. `tick` forces a recompute every
  // 60s so the time-based auto mode flips at the right minute without a
  // page reload.
  const theme = useMemo(
    () => deriveEffective(mode, autoConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, autoConfig, tick],
  );

  // Mirror the choice onto <html data-theme="..."> so the CSS overrides in
  // index.css can target it with a single attribute selector.
  // 2026-06-18 — ``?theme=dark`` / ``?theme=light`` URL override lets the
  // developer (or anyone) force a specific theme for spot-checking any page
  // without changing the OS appearance.  Override only sticks for the
  // current page load — closing the tab returns to the saved preference,
  // so users can't accidentally lock themselves into a mode.
  useEffect(() => {
    let effective = theme;
    try {
      const override = new URLSearchParams(window.location.search).get("theme");
      if (override === "dark" || override === "light") effective = override;
    } catch { /* SSR or sealed iframe — ignore */ }
    document.documentElement.setAttribute("data-theme", effective);
    document.documentElement.setAttribute("data-theme-mode", mode);
  }, [theme, mode]);

  // Re-tick every minute when we're in auto/time mode so the flip happens
  // automatically. Idle when in static modes.
  useEffect(() => {
    if (mode !== "auto" || autoConfig.kind !== "time") return undefined;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [mode, autoConfig.kind]);

  // Listen to system color-scheme changes when in auto/system mode.
  useEffect(() => {
    if (mode !== "auto" || autoConfig.kind !== "system") return undefined;
    let mql;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch (e) { return undefined; }
    const onChange = () => setTick((t) => t + 1);
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else if (mql.removeListener) mql.removeListener(onChange);
    };
  }, [mode, autoConfig.kind]);

  const setMode = useCallback((next) => {
    if (next !== "light" && next !== "dark" && next !== "auto") return;
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
      if (next === "light" || next === "dark") {
        window.localStorage.setItem(LEGACY_KEY, next);
      }
    } catch (e) { /* ignore */ }
  }, []);

  const setAutoConfig = useCallback((patch) => {
    setAutoConfigState((prev) => {
      const next = { ...prev, ...(patch || {}) };
      try { window.localStorage.setItem(AUTO_CFG_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  // Backwards-compatible setTheme(light|dark) — leaves auto config alone.
  const setTheme = useCallback((next) => {
    if (next !== "light" && next !== "dark") return;
    setMode(next);
  }, [setMode]);

  // Backwards-compatible toggleTheme — flips between light/dark only.
  // When in auto mode, toggle pins to the opposite of the currently
  // effective theme so the user gets the expected visible flip.
  const toggleTheme = useCallback(() => {
    setMode(theme === "dark" ? "light" : "dark");
  }, [theme, setMode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, toggleTheme, autoConfig, setAutoConfig }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
