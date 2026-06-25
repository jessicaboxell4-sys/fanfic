"""Regression smoke — fast cross-cutting sweep of the endpoints we
care about most when refactoring.

This file is the "1-minute confidence" suite.  Every test is tagged
``@pytest.mark.regression_smoke`` (module-level pytestmark) so you can
run JUST these without paying for the rest of the integration suite:

    pytest -m regression_smoke              # ~5 s, no LLM calls
    ./scripts/run_regression_smoke.sh       # same, wrapped

History:
- 2026-06-25 — Born as iter37 regression for the Phase 6A cover
  extraction.  Renamed to ``test_regression_smoke.py`` and adopted as
  the permanent post-refactor guardrail.

Coverage scope:
  - Health endpoint (mongo + storage + scheduler)
  - routes/covers.py (Phase 6A extracted)
  - routes/books.py (after extraction)
  - routes/friends.py (directory + friend request)
  - routes/suggestions.py (status, is_mine, shipped exemplars)

Add to this file any time you do a refactor that touches multiple
route modules — the goal is a single ``pytest -m regression_smoke``
catches the obvious breakage.
"""
import os
import time
import uuid
import pytest
import requests

# Module-level mark — every test in this file is part of the
# regression smoke band.  Run with `pytest -m regression_smoke`.
pytestmark = pytest.mark.regression_smoke

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})

    # CI-safety: routes/auth.py bootstraps the very first user ever to
    # register as `is_admin=True` so a fresh install has a working admin.
    # In CI (empty Mongo), that means our test session's user would
    # become admin too, which breaks the "should reject non-admin"
    # smoke tests below.  Burn a sacrificial seed user first so the
    # REAL test session user is guaranteed to be user #2+ and
    # non-admin.  Best-effort: if the DB already has users (local dev),
    # this register is a no-op duplicate and we discard the response.
    seed_email = f"shelfsort-canary-seed-{int(time.time())}-{uuid.uuid4().hex[:6]}@example.com"
    try:
        requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": seed_email, "password": "hunter2pw", "name": "Seed"},
            timeout=30,
        )
    except Exception:
        pass  # network hiccup is fine — worst case the canary user is admin

    # Fresh registration — recognizable prefix so future cleanup
    # scripts can sweep canary-created accounts safely.  Production
    # canary uses this same fixture; per-run timestamp + uuid suffix
    # guarantees no collisions across parallel runs.
    email = f"shelfsort-canary-{int(time.time())}-{uuid.uuid4().hex[:6]}@example.com"
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw", "name": "Iter37 Tester"},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:300]}"
    return s


# -------------------------------------------------------------------- #
# Health                                                              #
# -------------------------------------------------------------------- #

def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    checks = data.get("checks", {})
    assert checks.get("mongo", {}).get("ok") is True, data
    assert checks.get("storage", {}).get("ok") is True, data
    assert checks.get("scheduler", {}).get("running") is True, data


# -------------------------------------------------------------------- #
# Refactor regression: routes/covers.py (extracted from books.py)     #
# -------------------------------------------------------------------- #

def test_cover_styles_returns_at_least_8(session):
    r = session.get(f"{BASE_URL}/api/cover-styles", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "styles" in data
    assert len(data["styles"]) >= 8, f"only {len(data['styles'])} styles"


def test_books_cover_less_shape(session):
    r = session.get(f"{BASE_URL}/api/books/cover-less", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "books" in data and "total" in data and "limit" in data


def test_community_covers_featured(session):
    r = session.get(f"{BASE_URL}/api/community-covers/featured?limit=3", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "covers" in data and "window_days" in data


def test_community_covers_browse_with_title(session):
    r = session.get(f"{BASE_URL}/api/community-covers?title=foo", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "covers" in data and "count" in data


def test_community_covers_requires_title(session):
    r = session.get(f"{BASE_URL}/api/community-covers", timeout=15)
    assert r.status_code in (400, 422), r.text[:300]


# -------------------------------------------------------------------- #
# Refactor regression: routes/books.py still wired                    #
# -------------------------------------------------------------------- #

@pytest.mark.parametrize("path", [
    "/api/books",
    "/api/books/recent",
    "/api/books/stats",
    "/api/fandoms",
    "/api/books/recent-updates",
])
def test_books_routes_still_200(session, path):
    r = session.get(f"{BASE_URL}{path}", timeout=20)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:300]}"


# -------------------------------------------------------------------- #
# Users directory (friends.py)                                        #
# -------------------------------------------------------------------- #

def test_users_directory_shape(session):
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=5", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    for k in ("users", "page", "limit", "total", "has_more"):
        assert k in data, f"missing {k}"
    assert isinstance(data["users"], list)
    # Each row: {user_id, username} — and crucially nothing else identifying.
    for u in data["users"]:
        assert "user_id" in u and "username" in u
        # No email / name / picture leak in the directory.
        assert "email" not in u
        assert "name" not in u
        assert "picture" not in u


def test_users_directory_excludes_requester(session):
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
    my_id = me.get("user_id")
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=100", timeout=15)
    assert r.status_code == 200
    ids = [u["user_id"] for u in r.json().get("users", [])]
    assert my_id not in ids, "requester should be excluded from /users/directory"


# -------------------------------------------------------------------- #
# Friend request idempotency                                          #
# -------------------------------------------------------------------- #

def test_friend_request_idempotent(session):
    # Pick an arbitrary target from the directory.
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=20", timeout=15)
    rows = r.json().get("users", [])
    target = next((u for u in rows if u.get("username")), None)
    if not target:
        pytest.skip("no users with username in directory to friend")
    payload = {"target_username": target["username"]}
    r1 = session.post(f"{BASE_URL}/api/friends/request", json=payload, timeout=15)
    assert r1.status_code in (200, 409), r1.text[:300]
    # Re-sending: server returns 409 'Request already pending' OR 200
    # 'accepted'.  Both are acceptable idempotent behaviour.
    r2 = session.post(f"{BASE_URL}/api/friends/request", json=payload, timeout=15)
    assert r2.status_code in (200, 409), r2.text[:300]


# -------------------------------------------------------------------- #
# Suggestions list shape (status + submitter_name + is_mine)          #
# -------------------------------------------------------------------- #

def test_suggestions_list_shape(session):
    r = session.get(f"{BASE_URL}/api/suggestions", timeout=20)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    rows = data.get("suggestions", [])
    if not rows:
        pytest.skip("no suggestions seeded")
    for s in rows[:5]:
        for k in ("suggestion_id", "status", "submitter_name", "is_mine"):
            assert k in s, f"missing {k} in suggestion {s.get('suggestion_id')}"
        assert s["status"] in ("open", "under_review", "planned", "done", "declined")


def test_shipped_suggestions_present(session):
    """The two known shipped suggestions mentioned in the spec should
    exist with status='done' so the frontend can render the ribbon.

    Skipped against an empty database (CI runners spin up a fresh
    Mongo with no seeded data) — production canary still validates
    the real data state.
    """
    r = session.get(f"{BASE_URL}/api/suggestions?status=done", timeout=20)
    assert r.status_code == 200
    rows = r.json().get("suggestions", [])
    if not rows:
        pytest.skip("empty suggestions DB (CI / fresh deploy) — nothing to assert against")
    titles = [s.get("title", "") for s in rows]
    found_dnd = any("drag-and-drop reorder" in t.lower() for t in titles)
    found_dark = any("dark mode reader skin" in t.lower() for t in titles)
    # At least one of the two shipped exemplars should be present.
    assert found_dnd or found_dark, f"no known shipped suggestions in done list: {titles[:10]}"


# -------------------------------------------------------------------- #
# Preview-cover sanity: must not 5xx-crash backend.  We DO NOT call   #
# the real LLM-billed path against a book; instead we hit it with a  #
# bogus book_id to confirm the endpoint exists + returns a structured#
# 404 (proves the route is wired post-extraction).                    #
# -------------------------------------------------------------------- #

def test_preview_cover_route_wired(session):
    r = session.post(
        f"{BASE_URL}/api/books/__nonexistent__/preview-cover",
        json={"nudge": None, "style_id": None},
        timeout=20,
    )
    # 404 ("Book not found") proves the route handler executed.  500
    # would mean the extraction broke something.
    assert r.status_code in (404, 422), f"got {r.status_code} {r.text[:300]}"


# -------------------------------------------------------------------- #
# Upload pipeline (async) — happy path through the highest-risk        #
# surface in the codebase.  Added 2026-06-25 so Phase 6B / 6C          #
# refactors of the upload code can lean on smoke detection.            #
#                                                                      #
# Fixture: Calibre's `quick_start/eng.epub` (≈150 KB) — guaranteed     #
# present on the dev/CI images, valid metadata, parses cleanly.        #
# -------------------------------------------------------------------- #

_CALIBRE_EPUB = "/usr/share/calibre/quick_start/eng.epub"


@pytest.fixture(scope="module")
def uploaded_book(session):
    """Submit a tiny EPUB through the async pipeline, poll until the
    job finishes, and yield the resulting book_id.  Module-scoped so
    all downstream assertions reuse the same upload (cheap)."""
    import os.path
    if not os.path.exists(_CALIBRE_EPUB):
        pytest.skip(f"Calibre fixture missing: {_CALIBRE_EPUB}")

    # 1. POST /api/books/upload/async with the EPUB.  Uses a bare
    # requests call (not session.headers["Content-Type"]) so the
    # multipart boundary is set correctly.
    with open(_CALIBRE_EPUB, "rb") as fh:
        # Pop the JSON content-type the fixture set, multipart needs
        # its own boundary.
        s = requests.Session()
        s.cookies = session.cookies
        r = s.post(
            f"{BASE_URL}/api/books/upload/async",
            files=[("files", ("smoke.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202, f"upload/async failed: {r.status_code} {r.text[:300]}"
    job = r.json()
    assert "job_id" in job and job.get("status") == "queued"
    assert job.get("total") == 1

    # 2. Poll /api/books/upload/jobs/{job_id} until status == done /
    # failed.  Generous 90 s ceiling so live-LLM environments don't
    # flake.  CI runs with SHELFSORT_TEST_AI_RESPONSE so it'll
    # complete in <2 s there.
    deadline = time.time() + 90
    final = None
    while time.time() < deadline:
        r = session.get(f"{BASE_URL}/api/books/upload/jobs/{job['job_id']}", timeout=20)
        assert r.status_code == 200, r.text[:300]
        final = r.json()
        if final.get("status") in ("done", "failed"):
            break
        time.sleep(1.0)
    assert final is not None, "no poll response"
    assert final.get("status") == "done", f"job did not finish: {final}"

    # 3. The response payload from /upload/async contains the book
    # rows once done.  Pull the first non-failed entry.
    resp = final.get("response") or {}
    books = [b for b in (resp.get("books") or []) if not b.get("failed")]
    assert books, f"no books in upload response: {resp}"
    return books[0]["book_id"]


def test_upload_async_book_detail(session, uploaded_book):
    """GET /api/books/{book_id} returns the uploaded book with the
    expected shape."""
    r = session.get(f"{BASE_URL}/api/books/{uploaded_book}", timeout=20)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    for k in ("book_id", "title", "av_status"):
        assert k in data, f"missing {k}; keys={list(data)[:20]}"
    assert data["book_id"] == uploaded_book


def test_upload_async_av_status_set(session, uploaded_book):
    """av_status must be one of the documented states — never missing
    or None.  Regression for AV pipeline integration."""
    r = session.get(f"{BASE_URL}/api/books/{uploaded_book}", timeout=20)
    assert r.status_code == 200
    av = r.json().get("av_status")
    assert av in ("clean", "unscanned", "infected", "pending"), (
        f"unexpected av_status: {av!r}"
    )


def test_upload_book_in_recent(session, uploaded_book):
    """Newly-uploaded book appears in GET /api/books (sorted by
    created_at desc).  Note: /api/books/recent is the *Continue
    Reading* rail keyed on last_opened_at, which an unopened upload
    won't hit — that's by design."""
    r = session.get(f"{BASE_URL}/api/books?limit=20", timeout=20)
    assert r.status_code == 200
    ids = [b.get("book_id") for b in r.json().get("books", [])]
    assert uploaded_book in ids, f"book not in /books list: {ids[:5]}"


def test_upload_book_increments_stats(session, uploaded_book):  # noqa: ARG001
    """After an upload, /api/books/stats.total is at least 1."""
    r = session.get(f"{BASE_URL}/api/books/stats", timeout=20)
    assert r.status_code == 200
    total = r.json().get("total", 0)
    assert total >= 1, f"stats.total didn't reflect upload: {r.json()}"


def test_upload_job_404_for_unknown_id(session):
    """Polling an unknown job_id returns a clean 404, not a 500."""
    r = session.get(f"{BASE_URL}/api/books/upload/jobs/__nonexistent__", timeout=15)
    assert r.status_code == 404, f"got {r.status_code} {r.text[:300]}"


# -------------------------------------------------------------------- #
# Dark-mode leak guard (2026-06-25)                                    #
#                                                                      #
# Background: Tailwind arbitrary variants like `[&_code]:bg-[#F0EBDC]` #
# compile to descendant selectors that the dark-mode remapper in       #
# `frontend/src/index.css` does NOT intercept (it only catches the    #
# literal class name `bg-[#F0EBDC]`, not the cascading `code` child).  #
# Result: cream chips on dark background — visually broken.            #
#                                                                      #
# This test scans the frontend source for the same pattern and fails   #
# if any hex literal is found inside a `[&_*]:utility-[#XXXXXX]`       #
# arbitrary variant.  Use `var(--surface-hover)`, `var(--primary)`,    #
# etc. instead — they auto-flip via :root[data-theme="dark"].          #
# -------------------------------------------------------------------- #

# Hexes that DO have light/dark twins in CSS vars or the remapper.
# These are the genuine leaks if found inside `[&_*]:`.  Listed
# explicitly so the test only flags real problems, not intentional
# brand accents (e.g. error-red `#D9534F` stays the same in both
# themes).
_LEAK_HEX_HINTS = {
    # Surface / background creams
    "#F0EBDC": "var(--surface-hover)",
    "#F1ECDB": "var(--surface-hover)",
    "#F5F3EC": "var(--surface-hover)",
    "#FBFAF6": "var(--surface)",
    "#FDFBF7": "var(--surface)",
    "#FAF7F0": "var(--bg)",
    "#FDF3E1": "var(--surface-hover)",
    # Text
    "#2C2C2C": "var(--text-primary)",
    "#6B705C": "var(--text-secondary)",
    # Primary purple
    "#6B46C1": "var(--primary)",
    "#8B5CF6": "var(--primary)",
    "#553397": "var(--primary-hover)",
    "#7C3AED": "var(--primary-hover)",
    "#A78BFA": "var(--primary)",
}


@pytest.mark.regression_smoke
def test_no_hex_leaks_in_tailwind_arbitrary_variants():
    """Fail-fast for the dark-mode leak class of bug.  If this test
    starts failing, replace the offending hex with the suggested
    `var(--…)` token from `_LEAK_HEX_HINTS` (or use a `dark:` variant
    inline) so the chip / link / marker auto-flips in dark mode.
    """
    import re
    import pathlib

    src = pathlib.Path("/app/frontend/src")
    # Match `[&_…]:utility-[#XXXXXX]`.  Captures the hex for the
    # allowlist check.  The leading `[&_` confirms we're inside an
    # arbitrary descendant variant — direct usages like
    # `text-[#2C2C2C]` are NOT flagged because those DO get remapped.
    pat = re.compile(r"\[&_[^\]]+\]:[a-zA-Z-]+-\[(#[0-9A-Fa-f]{3,8})\]")
    leaks = []
    for path in src.rglob("*"):
        if path.suffix not in (".jsx", ".js", ".tsx", ".ts"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in pat.finditer(line):
                hex_code = m.group(1).upper()
                if hex_code in {k.upper() for k in _LEAK_HEX_HINTS}:
                    suggestion = _LEAK_HEX_HINTS.get(
                        hex_code, _LEAK_HEX_HINTS.get(hex_code.lower(), "var(--…)")
                    )
                    leaks.append(
                        f"  {path.relative_to('/app')}:{line_no} → "
                        f"`{m.group(0)}` — replace `{hex_code}` with `{suggestion}`"
                    )
    if leaks:
        msg = (
            "\nFound hardcoded light-mode hex colors inside Tailwind\n"
            "arbitrary variants (`[&_…]:`).  These DO NOT flip in\n"
            "dark mode — the remapper in index.css only catches\n"
            "literal class names, not descendant cascades.\n\n"
            f"{len(leaks)} leak(s):\n" + "\n".join(leaks) + "\n\n"
            "Fix: replace the hex with the suggested `var(--…)`\n"
            "token — those auto-switch via :root[data-theme=\"dark\"]."
        )
        pytest.fail(msg)


# Files that legitimately embed brand-themed hex colors in inline
# styles — usually share cards / OG images / public marketing
# components that look the same in light vs dark by design.  Keep
# this list small and only add to it when the asset is GENUINELY
# theme-independent (e.g. a Spotify-Wrapped-style social share).
_INLINE_STYLE_HEX_ALLOWLIST = {
    "frontend/src/components/YearInBooksWrapped.jsx",
    "frontend/src/components/YearInBooksShareCard.jsx",
    "frontend/src/pages/YearInBooksPage.jsx",
    "frontend/src/pages/PublicYearInBooks.jsx",
}


@pytest.mark.regression_smoke
def test_no_hex_leaks_in_inline_style_props():
    """Sister test to the arbitrary-variant guard above.  Inline
    `style={{ color: '#XXXXXX' }}` (and background / backgroundColor /
    borderColor / fill / stroke) completely bypasses the className-
    based dark-mode remapper, so a literal hex in there NEVER flips.

    Allowlist: brand-themed share cards (Year in Books) where the
    color is genuinely theme-independent by design.
    """
    import re
    import pathlib

    src = pathlib.Path("/app/frontend/src")
    # color / background / backgroundColor / borderColor / fill / stroke
    # set to a literal hex inside an inline `style={{ … }}` prop.
    pat = re.compile(
        r"""style=\{\{[^}]*['"]?(?:color|background|backgroundColor|"""
        r"""borderColor|fill|stroke)['"]?\s*:\s*['"](#[0-9A-Fa-f]{3,8})['"]"""
    )
    leaks = []
    for path in src.rglob("*"):
        if path.suffix not in (".jsx", ".js", ".tsx", ".ts"):
            continue
        rel = str(path.relative_to("/app"))
        if rel in _INLINE_STYLE_HEX_ALLOWLIST:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in pat.finditer(line):
                leaks.append(
                    f"  {rel}:{line_no} → `{m.group(0)[:80]}…` "
                    f"(hex `{m.group(1)}`)"
                )
    if leaks:
        msg = (
            "\nFound hardcoded hex colors inside inline `style={{ … }}`\n"
            "props.  Inline styles completely bypass the className-\n"
            "based dark-mode remapper, so these stay frozen in one\n"
            "theme.\n\n"
            f"{len(leaks)} leak(s):\n" + "\n".join(leaks) + "\n\n"
            "Fix: use a className with a CSS-var-backed utility (e.g.\n"
            "`bg-[var(--primary)]`, or a semantic class like\n"
            "`btn-primary`).  If the color is intentionally brand-\n"
            "themed (share card / OG image), add the file to\n"
            "`_INLINE_STYLE_HEX_ALLOWLIST` in this test file with a\n"
            "comment explaining why."
        )
        pytest.fail(msg)


@pytest.mark.regression_smoke
def test_no_unpaired_dark_only_hex_utilities():
    """Third dark-mode guard — flags `dark:UTILITY-[#hex]` patterns
    that lack a paired light-mode sibling of the same utility on the
    same className.

    Why this matters: a className like `dark:bg-[#XXXXXX]` alone means
    light-mode gets whatever the container default is — usually a leak
    that the author forgot.  The healthy pattern is
    `bg-[#YYYY] dark:bg-[#XXXXXX]` (explicit both ways) or
    `bg-[var(--surface)]` (auto-flips, no dark: needed).

    Detection: for each `dark:ROOT-[#hex]`, check the same line for
    an unprefixed `ROOT-…` utility.  If present, the pair is healthy.
    If absent, flag as a likely dark-only leak.
    """
    import re
    import pathlib

    src = pathlib.Path("/app/frontend/src")
    # Capture the utility root (without `dark:` prefix and without the
    # `-[#hex]` value).  Roots we care about: any prefix that ends in
    # a colour-bearing utility.  Greedy on hyphens so `border-t-…` is
    # treated as a `border-t` root, not `border-t-…-`.
    pat = re.compile(r"\bdark:([a-z]+(?:-[a-z]+)*)-\[(#[0-9A-Fa-f]{3,8})[^\]]*\]")
    leaks = []
    for path in src.rglob("*"):
        if path.suffix not in (".jsx", ".js", ".tsx", ".ts"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in pat.finditer(line):
                root = m.group(1)        # e.g. "bg", "text", "border-t"
                # Healthy pair check: does the same line contain a
                # non-dark sibling `ROOT-…`?  Negative lookbehind
                # excludes the `dark:` we just matched.
                sibling_pat = re.compile(
                    rf"(?<!dark:){re.escape(root)}-(?!\w)|"
                    rf"(?<!:){re.escape(root)}-(?=\[|\w)"
                )
                # Strip out the matched dark: occurrence(s) so the
                # sibling search doesn't double-count.
                stripped = re.sub(
                    rf"dark:{re.escape(root)}-\[[^\]]+\]", "", line
                )
                if not sibling_pat.search(stripped):
                    leaks.append(
                        f"  {path.relative_to('/app')}:{line_no} → "
                        f"`dark:{root}-[{m.group(2)}]` is unpaired "
                        f"(no `{root}-…` sibling on the same line)"
                    )
    if leaks:
        msg = (
            "\nFound `dark:`-prefixed hex utilities with NO matching\n"
            "light-mode sibling on the same className.  These leave\n"
            "light mode falling back to the container default — usually\n"
            "an oversight.\n\n"
            f"{len(leaks)} unpaired hit(s):\n" + "\n".join(leaks) + "\n\n"
            "Fix options:\n"
            "  1. Add an explicit light-mode utility for the same\n"
            "     attribute (e.g. `bg-[#XXX] dark:bg-[#YYY]`).\n"
            "  2. Use a CSS var that auto-flips (`bg-[var(--surface)]`)\n"
            "     and drop the `dark:` variant entirely."
        )
        pytest.fail(msg)



# -------------------------------------------------------------------- #
# Crossover suggestions admin endpoints (Phase-6 feedback loop)        #
# -------------------------------------------------------------------- #
# These endpoints require admin auth — the smoke session above is a    #
# fresh non-admin user, so we only verify the auth gate works.  Full   #
# accept/reject behavior is covered by the gap-detection unit test     #
# already shipped (`utils/classifier._maybe_log_crossover_gap`).       #

def test_crossover_suggestions_requires_admin(session):
    """Non-admin session should get 403 (require_admin), not 404 or 500."""
    r = session.get(f"{BASE_URL}/api/admin/crossover-suggestions", timeout=15)
    assert r.status_code in (401, 403), (
        f"crossover-suggestions should reject non-admin (got {r.status_code}): {r.text[:200]}"
    )


def test_crossover_suggestion_reject_requires_admin(session):
    """POST /reject should also be gated — never reachable without admin."""
    r = session.post(
        f"{BASE_URL}/api/admin/crossover-suggestions/nonexistent/reject",
        timeout=15,
    )
    assert r.status_code in (401, 403), (
        f"reject should reject non-admin (got {r.status_code}): {r.text[:200]}"
    )



# -------------------------------------------------------------------- #
# Bare Storyid URL reconstruction (no network — pure regex)            #
# -------------------------------------------------------------------- #
# Guards the host-token table + the closest-host-wins logic so future  #
# refactors to extract_urls_from_epub don't silently lose URL          #
# reconstruction for EPUBs that lack a full href.                      #

def test_reconstruct_bare_storyid_ffnet():
    """`Storyid: N` + `FanFiction.net` cover page → canonical FF URL."""
    pytest.importorskip("ebooklib")  # canary skips this — backend-only util.
    from utils.epub_metadata import _reconstruct_bare_story_ids
    out = _reconstruct_bare_story_ids(
        "Storyid: 6032563\nFanFiction.net\nName: Absolute Promise\nAuthor: Bittersweet Alias"
    )
    assert len(out) == 1
    assert out[0]["url"] == "https://www.fanfiction.net/s/6032563"
    assert out[0]["anchor"] == "Absolute Promise"


def test_reconstruct_bare_storyid_compilation():
    """Compilation EPUB with two stories from different hosts → both
    reconstructed with the correct host each."""
    pytest.importorskip("ebooklib")
    from utils.epub_metadata import _reconstruct_bare_story_ids
    out = _reconstruct_bare_story_ids(
        "Storyid: 111\nFanFiction.net\nName: First Story\n"
        "Storyid: 222\nRoyal Road\nName: Second Story"
    )
    urls = [r["url"] for r in out]
    assert "https://www.fanfiction.net/s/111" in urls
    assert "https://www.royalroad.com/fiction/222" in urls


def test_reconstruct_bare_storyid_no_host_yields_nothing():
    """Storyid with no recognizable host → empty list, never a wrong URL."""
    pytest.importorskip("ebooklib")
    from utils.epub_metadata import _reconstruct_bare_story_ids
    assert _reconstruct_bare_story_ids("Storyid: 999\n(no host here)") == []
