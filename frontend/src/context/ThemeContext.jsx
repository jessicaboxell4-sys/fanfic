import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

// Two themes for Tier 1: AO3-cream light (default) and Reversi-style dark
// (deep warm slate, not pure black — easier on the eyes for long reading
// sessions). The choice is persisted to localStorage so it survives reloads.
const ThemeContext = createContext(null);

const STORAGE_KEY = "shelfsort_theme";

function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch (e) { /* localStorage unavailable — fall through */ }
  return "light";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStoredTheme());

  // Mirror the choice onto <html data-theme="..."> so the CSS overrides in
  // index.css can target it with a single attribute selector. Doing it on
  // <html> (rather than <body>) lets early CSS evaluate before paint.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
