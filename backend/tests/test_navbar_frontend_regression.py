"""Frontend regression suite for the Navbar admin cluster.

Skips cleanly in-pod (Playwright can't reach the pod's own preview URL
from inside the pod).  Run locally with:

    RUN_FRONTEND_PLAYWRIGHT=1 pytest backend/tests/test_navbar_frontend_regression.py -v

These assertions codify what got wiped during the 2026-07-05 pod reset
(see `memory/DEPLOY_BLOCKER.md`) so a future deploy that loses these
components again is caught before shipping.
"""
from __future__ import annotations

import os
import pytest

RUN = os.environ.get("RUN_FRONTEND_PLAYWRIGHT") == "1"

pytestmark = pytest.mark.skipif(
    not RUN,
    reason="Set RUN_FRONTEND_PLAYWRIGHT=1 to enable; skips in-pod because egress to self is blocked.",
)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://drift-check-live.preview.emergentagent.com")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin-smoke-test@example.com")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "AdminSmoke123!")


def _login_and_get_page(browser):
    """Common setup: sign the admin in and land on `/library` with
    session cookies set.  Returns a Playwright page."""
    ctx = browser.new_context(viewport={"width": 1600, "height": 900})
    page = ctx.new_page()
    page.goto(f"{FRONTEND_URL}/library", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector('input[type="email"]', timeout=15000)
    page.fill('input[type="email"]', ADMIN_EMAIL)
    page.fill('input[type="password"]', ADMIN_PASS)
    page.click('button:has-text("Sign in")')
    page.wait_for_timeout(3500)
    # Try to skip the onboarding tour if it appears.
    try:
        page.click('[data-testid="tour-overlay"] button:has-text("Skip")', timeout=1500)
    except Exception:
        pass
    return page


def test_navbar_admin_cluster_renders_all_three_pieces(playwright_browser):
    """Signed-in admin viewing `/library` sees the admin cluster with
    the online chip + shield + chevron.  Regression from the 2026-07-05
    pod reset that wiped these components from source."""
    page = _login_and_get_page(playwright_browser)
    page.wait_for_selector('[data-testid="navbar-admin-cluster"]', timeout=15000)
    assert page.query_selector('[data-testid="navbar-online-chip"]') is not None, "online chip missing"
    assert page.query_selector('[data-testid="navbar-online-count"]') is not None, "online count missing"
    assert page.query_selector('[data-testid="navbar-admin"]') is not None, "admin shield missing"
    assert page.query_selector('[data-testid="navbar-admin-recent-toggle"]') is not None, "admin chevron missing"


def test_online_chip_menu_opens(playwright_browser):
    """Clicking the online chip opens the dropdown with either an empty
    state or a `<ul>` of `navbar-online-user-*` rows."""
    page = _login_and_get_page(playwright_browser)
    page.wait_for_selector('[data-testid="navbar-online-chip"]', timeout=15000)
    page.click('[data-testid="navbar-online-chip"]')
    page.wait_for_selector('[data-testid="navbar-online-chip-menu"]', timeout=5000)
    assert page.query_selector('[data-testid="navbar-online-chip-view-all"]') is not None


def test_admin_recent_menu_opens(playwright_browser):
    """Clicking the admin cluster's chevron opens the recent-cards menu."""
    page = _login_and_get_page(playwright_browser)
    page.wait_for_selector('[data-testid="navbar-admin-recent-toggle"]', timeout=15000)
    page.click('[data-testid="navbar-admin-recent-toggle"]')
    page.wait_for_selector('[data-testid="navbar-admin-menu"]', timeout=5000)
    assert page.query_selector('[data-testid="navbar-admin-open-full"]') is not None


def test_no_page_errors_on_library(playwright_browser):
    """The `/library` page as an admin renders without any JS
    `pageerror` events — the whole rebuild is JSX-heavy so we want
    a smoke against uncaught render-time exceptions."""
    errors: list[str] = []
    ctx = playwright_browser.new_context(viewport={"width": 1600, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{FRONTEND_URL}/library", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector('input[type="email"]', timeout=15000)
    page.fill('input[type="email"]', ADMIN_EMAIL)
    page.fill('input[type="password"]', ADMIN_PASS)
    page.click('button:has-text("Sign in")')
    page.wait_for_timeout(4500)
    assert errors == [], f"unexpected pageerrors: {errors}"


@pytest.fixture
def playwright_browser():
    """Lazy Playwright fixture — only imports when the test actually
    runs.  Keeps the pytest collection fast in the pod (where these
    tests all skip anyway)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()
