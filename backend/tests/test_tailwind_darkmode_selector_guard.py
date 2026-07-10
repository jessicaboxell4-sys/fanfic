"""Tailwind dark-mode selector guard (2026-06-20).

`ThemeContext.jsx` sets ``<html data-theme="dark">`` to switch themes
(not the Tailwind-default ``.dark`` class).  If ``tailwind.config.js``
reverts to the default ``darkMode: ["class"]``, every ``dark:*``
variant across the codebase silently stops firing and dark-mode pages
quietly regress — the exact bug that left the admin "Antivirus" card
unreadable on a pale-mint background.

This static-analysis guard fails CI loudly if the selector contract
ever breaks again.
"""
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent.parent / "frontend" / "tailwind.config.js"


def test_tailwind_darkmode_uses_data_theme_selector():
    text = CONFIG.read_text(encoding="utf-8")
    # Accept either single or double quotes around the attribute selector,
    # and either array-form ``['selector', '[data-theme="dark"]']`` or the
    # legacy variant Tailwind 3.4 also documents.
    needle_double = '[data-theme="dark"]'
    needle_single = "[data-theme='dark']"
    assert (needle_double in text) or (needle_single in text), (
        "tailwind.config.js must use the [data-theme=\"dark\"] selector "
        "to match the runtime convention set by ThemeContext.jsx. "
        "Reverting to darkMode: 'class' silently breaks every dark:* "
        "Tailwind variant in the codebase — see /admin Antivirus card "
        "bug 2026-06-20 for an example of what that looks like."
    )
    # Belt-and-braces: make sure we didn't accidentally leave the
    # plain ``"class"`` form in the file.
    assert "darkMode: [\"class\"]" not in text, (
        "Plain darkMode: ['class'] form found — this regressed the "
        "data-theme selector fix from 2026-06-20."
    )
