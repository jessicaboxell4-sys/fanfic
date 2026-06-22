"""Hidden-features inventory (2026-06-22).

The codebase has a couple of features that are *built but invisible*
behind feature flags:

* **FicHub / FanFicFare URL→EPUB fetching** — hidden via the
  client-side ``FETCHING_UI_ENABLED`` constant + the runtime
  ``fichub_enabled`` flag.
* **Send-to-Kindle** — hidden via ``SEND_TO_KINDLE_UI_ENABLED``
  (frontend) + ``send_to_kindle_enabled`` (backend).

Without a central inventory it's easy to forget these exist and
either rebuild them by accident or never turn them back on when the
underlying constraint (Resend quota, source-site rate limits, etc.)
goes away.  This module returns a flat list each admin card on
/admin renders.

We intentionally hard-code the *client-side* constant state here
because Mongo only knows about server flags.  The frontend constant
flips need a redeploy regardless, so the truth-source is the source
file path + the literal constant value — read at import time.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

from utils.feature_flags import get_flags


# Where the client-side hide-out constants live.
_FRONTEND_FLAGS_FILE = Path("/app/frontend/src/lib/featureFlags.js")
_CLIENT_CONST_RE = re.compile(
    r"export\s+const\s+([A-Z][A-Z0-9_]+)\s*=\s*(true|false)",
)


def _read_client_constants() -> Dict[str, bool]:
    """Parse ``frontend/src/lib/featureFlags.js`` for every
    ``export const FOO_ENABLED = true|false`` line.  Tiny regex —
    if someone adds a new constant in another shape (template
    string, env-derived) it just won't show up here, which is the
    safer default than crashing the admin endpoint.
    """
    out: Dict[str, bool] = {}
    try:
        text = _FRONTEND_FLAGS_FILE.read_text()
    except OSError:
        return out
    for match in _CLIENT_CONST_RE.finditer(text):
        out[match.group(1)] = (match.group(2) == "true")
    return out


# Static registry — each hidden feature is described by (a) the
# frontend constant that gates its UI, (b) the backend flag that
# gates its endpoint (optional), (c) a short why-it's-hidden note,
# and (d) the code paths an operator can grep for if they want to
# bring it back.
_REGISTRY: List[Dict[str, Any]] = [
    {
        "id":          "url_fetching",
        "name":        "URL → EPUB fetching (FicHub / FanFicFare)",
        "client_flag": "FETCHING_UI_ENABLED",
        "server_flag": "fichub_enabled",
        "reason":      "FicHub paywall + rate limits on AO3 made the public UI flaky; kept the code so a future paid integration can flip it back on.",
        "surfaces": [
            "Navbar Quick-add URL slot",
            "Global paste-to-fetch toast detector",
            "FilterUrlList \"Pull N URLs into library\" button",
            "Account → FanFicFare options card",
            "Dashboard \"Refresh all from source\" banner",
            "BookDetail \"Refresh from source\" button",
            "Navbar UpdatesBell",
        ],
        "rehydrate": [
            "Set ``FETCHING_UI_ENABLED = true`` in /app/frontend/src/lib/featureFlags.js then redeploy.",
            "Toggle ``fichub_enabled`` to ON from /admin → Feature flags (no rebuild).",
        ],
    },
    {
        "id":          "send_to_kindle",
        "name":        "Send to Kindle",
        "client_flag": "SEND_TO_KINDLE_UI_ENABLED",
        "server_flag": "send_to_kindle_enabled",
        "reason":      "Every send burns 1 Resend daily-quota slot. Hidden while we're on the 100/day free tier to avoid a cliff.",
        "surfaces": [
            "BookDetail orange \"Send to Kindle\" button",
            "Account → Send to Kindle card (Kindle email setting + sender reminder)",
            "Help → Send to Kindle section + TOC entry",
        ],
        "rehydrate": [
            "Set ``SEND_TO_KINDLE_UI_ENABLED = true`` in /app/frontend/src/lib/featureFlags.js then redeploy.",
            "Toggle ``send_to_kindle_enabled`` to ON from /admin → Feature flags (no rebuild).",
            "Optional: also build the parked \"Bulk Send-to-Kindle from Library\" P2 feature (see /app/memory/ROADMAP.md).",
        ],
    },
]


async def hidden_features() -> Dict[str, Any]:
    """Payload for ``/api/admin/hidden-features`` — current state of
    every flag-hidden feature in the codebase."""
    client_state = _read_client_constants()
    server_state = await get_flags()
    rows: List[Dict[str, Any]] = []
    for entry in _REGISTRY:
        cf = entry["client_flag"]
        sf = entry.get("server_flag")
        client_on = bool(client_state.get(cf, False))
        server_on = bool(server_state.get(sf, False)) if sf else None
        # A feature is "fully hidden" only when BOTH gates are off.
        # If either side is on, the feature is at least partially
        # visible (e.g. a curl user could still hit the endpoint).
        if server_on is None:
            effective = "visible" if client_on else "hidden"
        else:
            if client_on and server_on:
                effective = "visible"
            elif (not client_on) and (not server_on):
                effective = "hidden"
            else:
                effective = "partial"
        rows.append({
            "id":           entry["id"],
            "name":         entry["name"],
            "client_flag":  cf,
            "client_on":    client_on,
            "server_flag":  sf,
            "server_on":    server_on,
            "effective":    effective,
            "reason":       entry["reason"],
            "surfaces":     entry["surfaces"],
            "rehydrate":    entry["rehydrate"],
        })
    return {
        "features":     rows,
        "client_file":  str(_FRONTEND_FLAGS_FILE),
        "hidden_count": sum(1 for r in rows if r["effective"] == "hidden"),
        "partial_count": sum(1 for r in rows if r["effective"] == "partial"),
        "visible_count": sum(1 for r in rows if r["effective"] == "visible"),
    }
