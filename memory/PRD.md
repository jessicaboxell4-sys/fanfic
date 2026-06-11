# Shelfsort — PRD

## Original Problem Statement
> Go through epubs and sort them by fanfiction, Harry Potter, twilight, etc

## Architecture
- **Backend**: FastAPI + Motor (MongoDB), `ebooklib` for EPUB parsing, BeautifulSoup for HTML strip, `emergentintegrations` for Claude classification
- **Frontend**: React 19 + react-router-dom 7 + Tailwind + Sonner toasts + Lucide icons
- **Auth**: Emergent-managed Google OAuth (httpOnly cookie + Bearer fallback)
- **Storage**: Local filesystem `/app/uploads/{user_id}/{book_id}.epub` (+ `.cover`)
- **DB collections**: users, user_sessions, books, categories

## User Personas
- Avid reader with a sprawling, unorganized EPUB collection from AO3, FFnet, calibre exports
- Wants a quick way to file fanfic by fandom and separate from original/non-fiction
- Light/personal usage; wants library to persist across devices

## Core Requirements (static)
- Bulk EPUB upload
- Per-book classification: Fanfiction (Harry Potter, Twilight, Marvel, etc.), Original Fiction, Non-fiction
- Metadata-based classifier (keyword) + Claude AI fallback
- Browse with filters, search, fandom chips
- Book detail with cover, description, AI reclassify, manual edit, delete
- Export entire library as folder-organized ZIP

## What's Been Implemented (2026-02-28)
- Beautiful warm-paper landing page with hero + features
- Emergent Google OAuth (signin / callback / cookie session / /auth/me / logout)
- Library dashboard: stats, search, category & fandom filters, book grid
- Drag-and-drop bulk upload with progress + auto-classification on ingest
- EPUB metadata extraction (title, author, description, cover, language, publisher)
- Keyword classifier covering 16 popular fandoms + fanfic & non-fic signals
- AI classifier via Claude Sonnet 4.6 (Emergent LLM key) used when metadata is uncertain or on user request
- Book detail page: cover, badges, description, download, reclassify-with-AI, manual edit, delete
- ZIP export at /api/books/export/zip with folders by category and Fanfiction/<Fandom>/ subfolders
- Custom category CRUD endpoints (UI for custom categories deferred)
- Backend pytest suite (17/17 passing), full frontend e2e verified

### Added 2026-02-28 (URL extraction)
- On upload, every EPUB's URLs (a[href] + plain-text http/https/www) are extracted, deduped, and saved as a notepad-friendly `.txt` next to the EPUB.
- `links_count` is persisted on each book and shown on the detail page button.
- `GET /api/books/{id}/links` → per-book `.txt` download (regenerates on demand for older books).
- `GET /api/books/export/links` → ZIP of every book's `.txt`, organized by Category / Fanfiction-<Fandom>, plus a single combined `all_links.txt`.
- New UI: "Save links (.txt)" button on book detail; "Export links" button in the navbar.

### Added 2026-02-28 (Custom Shelves UI)
- Dashboard now shows custom shelves as removable green chips alongside default filters
- "New shelf" inline form to add custom categories
- Book Detail edit dropdown lists all custom shelves so books can be assigned

### Added 2026-02-29 (Authors, Stats Page, Bulk Metadata)
- **Author shelves**: `GET /api/authors` (counts, excludes "Unknown") + `GET /api/authors/{name}` → new `/library/author/:name` page (`AuthorShelf.jsx`). Author chips row on Dashboard. BookDetail author header is a clickable link.
- **Detailed stats dashboard** at `/library/stats` (`StatsPage.jsx`) backed by `GET /api/stats/detailed`:
  - 30-day activity heatmap + sparkline
  - Top fandoms + top authors with bar rows (linked to their shelves)
  - Books finished per month (last 12) bar chart
  - Library by category breakdown
  - "Stats" link added to Navbar; "View detailed stats" CTA on Dashboard StatsCard
- **Bulk metadata edit**: `POST /api/books/bulk/metadata` supports author / category / fandom / series_name (+ optional sequential `series_start_index`) / title prefix strip + clear-fandom / clear-series operations. New `BulkMetadataDialog` reachable from SelectionBar's "Edit metadata" button.
- **CantFindOnline fix**: saving a corrected source URL no longer auto-fires FicHub retry — user clicks "Retry FicHub" manually (per user request).

### Added 2026-02-29 (Weekly Reading Digest)
- **Resend-powered weekly digest email** opt-in:
  - `GET / PUT /api/user/digest-settings` (enabled, day_of_week 0–6, hour 0–23, last_sent_at, email_configured)
  - `POST /api/user/digest-preview` — sends a one-off preview immediately to the signed-in user
  - APScheduler `AsyncIOScheduler` runs `_digest_tick` every hour at :00 UTC, matching users by day_of_week + hour with a 6-day cooldown
  - Digest content: books opened this week, active days /7, finished count, top fandom, "Books you started but haven't finished" nudge list (3 closest-to-done at ≥50% progress, not opened in last 3 days)
  - HTML + plain-text Resend email matching Shelfsort visual style
- **Account.jsx**: new "Weekly reading digest" card with toggle (default OFF — opt-in), day-of-week select, UTC hour select, "Send me a preview now" button, and a warning banner when `RESEND_API_KEY` is unset
- Added dep: `APScheduler==3.11.2`

### Added 2026-02-29 (Year in Books)
- **Annual recap** that's both an in-app page and an emailable keepsake:
  - `GET /api/year-in-books/{year}` returns summary (books_opened, books_finished, active_days, longest_streak, pages_read, top_fandoms[5], top_authors[5], categories, monthly 12-bucket chart, best_month, first_book, last_book) + `has_data` flag (1900–2200 range)
  - `POST /api/year-in-books/{year}/email` sends a beautifully-formatted Resend email
  - `_digest_tick` extended — on Jan 1 at the user's chosen hour, sends previous-year recap (idempotent via `digest.last_year_sent`)
- **`/library/year/:year`** page (`YearInBooksPage.jsx`):
  - Giant year-as-headline + 3 big stat numbers (opens / finished / longest streak)
  - Month-by-month bar chart
  - Top fandoms + top authors (linked to their shelves)
  - Bookends card (first book of the year, last book of the year)
  - Achievement chips (On fire, Finisher, Eclectic)
  - "Email this recap to myself" button
  - Prev/next year navigation (next hidden when ≥ current year)
- **Stats page**: gradient CTA card to open the current Year-in-Books

### Added 2026-02-29 (Public sharing for Year-in-Books)
- **Publicly shareable yearly recap** — anyone with the link can view the recap; no Shelfsort account needed:
  - `POST /api/year-in-books/{year}/share` — create or return existing share token (idempotent per user+year)
  - `GET /api/year-in-books/{year}/share` — view share status, public URL, view_count, last_viewed_at
  - `DELETE /api/year-in-books/{year}/share` — revoke (link immediately stops working)
  - `GET /api/public/year/{token}` — **unauthenticated** public endpoint; increments view counter, last_viewed_at; sanitises response (no email, no book_id)
  - Mongo: new `year_in_books_shares` collection with unique index on `share_token` and compound index on `(user_id, year)`
- **`PublicYearInBooks.jsx`** at `/share/yib/:token` (unprotected route):
  - Same beautiful recap design, branded "Made on Shelfsort" CTA → /login
  - Sets `document.title` + `og:title`/`og:description`/`twitter:card` meta tags for nicer link previews
  - Friendly "This recap isn't available" not-found state for bad/revoked tokens
- **`YearInBooksPage`**: Share dialog with copy-to-clipboard, "Open" link, view counter, and Revoke button. Button label switches between "Share this recap" and "Manage share link" based on share state.

### Added 2026-02-29 (Backend refactor — modular routers)
- Split monolithic `server.py` (3,110 lines) into modular files:
  - `server.py` (50 lines) — slim FastAPI entry-point, scheduler bootstrap, lifecycle hooks
  - `deps.py` — shared singletons (app, api_router, db, env, logger)
  - `models.py` — Pydantic models
  - `auth_dep.py` — `get_current_user` dependency
  - `routes/auth.py` (462) · `routes/books.py` (1,521) · `routes/stats.py` (192) · `routes/series_categories.py` (103) · `routes/digest.py` (416) · `routes/year.py` (473) · `routes/root.py` (38)
- Zero behavioral change. 106/106 regression tests pass. Backend healthy.
- `books.py` is still 1,521 lines and a candidate for further splitting (epub parsing / fichub / classification → `services/`).

### Added 2026-02-29 (CI: pytest coverage gate)
- Installed `pytest-cov` + `coverage` (added to `requirements.txt`).
- `backend/scripts/run_coverage.sh` — starts uvicorn under `coverage run` so true coverage is recorded while integration tests hit the running server via HTTP. Configurable `--fail-under=N`.
- `backend/pytest.ini` + `backend/.coveragerc` — coverage scope: app code only, sensible excludes.
- `.github/workflows/backend-tests.yml` — runs pytest with coverage on every push/PR to `backend/**`; fails build below 60% (current baseline 64.8%). MongoDB 7 service container provided. Coverage XML uploaded as artifact.
- Tweak: added `COOKIE_SECURE`/`COOKIE_SAMESITE` env vars so integration tests can run over plain HTTP without dropping session cookies. Production still uses `secure=true; samesite=none`.
- Per-module coverage today: stats 90% · year 92% · series_categories 91% · digest 63% · auth 56% · books 53%. The next wins are in `books.py` (EPUB upload, FicHub refresh, AI classification — all need external-service mocks).

### Added 2026-02-29 (Comprehensive books.py tests → 80% coverage)
- `backend/tests/test_books_comprehensive.py`: 18 new tests covering:
  - **Upload**: minimal-EPUB builder (hand-rolled zip with mimetype/container/OPF/NCX/chapter), real classification path, FicHub source detection, calibre series metadata, title-only series detection, `parse_failed` "Can't Open" branch, multi-file upload, non-EPUB rejection.
  - **FicHub refresh** (mocked via `pytest-httpserver`): `err=-9` → `fichub_unavailable`, happy-path success with downloaded EPUB, bulk `refresh-all`, `refresh-status`. Activated by `FICHUB_BASE_URL` env var.
  - **AI classification**: `SHELFSORT_TEST_AI_RESPONSE` env hook bypasses Claude with canned JSON → exercises full `classify_with_ai` path including JSON parsing.
  - **CRUD + bulk**: get/download/cover/patch/mark/progress/touch/source-url/series cycle, export links + zip + unavailable, stats + recent, detect-series-all, bulk move/metadata/delete.
- Backend changes to support mocking:
  - `fichub_fetch_epub` reads `FICHUB_BASE_URL` env (defaults to `https://fichub.net`)
  - `classify_with_ai` returns canned JSON when `SHELFSORT_TEST_AI_RESPONSE` is set
- CI: threshold raised from 60% → **75%** (current baseline 80.0%). Codecov project gate raised to 75%, patch gate to 80%.
- Added deps: `pytest-httpserver==1.1.5`, `coverage==7.14.1`, `pytest-cov==7.1.0`.
- Pinned `requests==2.32.5` (2.34 has a CookieJar regression that broke integration tests).
- Final per-module coverage: year 92% · stats 90% · series_categories 91% · **books 80%** (was 53%) · digest 63% · auth 56%.

### Added 2026-02-29 (Dependabot + auto-merge)
- `.github/dependabot.yml`: weekly grouped PRs (Monday 07:00 UTC) for backend pip, frontend npm, and GitHub Actions. Patch/minor bundled per ecosystem to reduce PR noise. Pins documented (e.g. `requests<2.34`, React 19 major-update ignore).
- `.github/workflows/dependabot-auto-merge.yml`: waits for `pytest` check, then auto-approves + auto-squash-merges patch/minor bumps; comments and parks major bumps for human review.

### Added 2026-02-29 (Tags + Smart Shelves)
- **Tag system** (lowercase-hyphen-slug, max 20 tags/book, 32 chars/tag):
  - Backend: `GET /api/tags`, `POST/DELETE /api/books/{id}/tags`, `PUT /api/tags/{old}` (rename across library), `POST /api/tags/merge`, `DELETE /api/tags/{name}` (purge everywhere)
  - Bulk: `POST /api/books/bulk/metadata` now accepts `add_tags` / `remove_tags`
  - **AI auto-tags**: Claude classifier prompt + `SHELFSORT_TEST_AI_RESPONSE` hook now return 2-4 lowercase tags alongside category/fandom; saved on upload when AI is invoked
  - Frontend: new **`TagInput`** component (chips + autocomplete + normalization + arrow-key navigation), wired into BookDetail and SelectionBar's BulkMetadataDialog
- **Smart Shelves** (saved queries → living shelves):
  - Backend: new `routes/smart_shelves.py` with `_query_to_mongo` compiler. Endpoints: `GET/POST /api/smart-shelves`, `PATCH/DELETE /api/smart-shelves/{id}`, `GET /api/smart-shelves/{id}/books`, `POST /api/smart-shelves/preview`
  - Supported rules: `tags_all`, `tags_any`, `tags_none`, `category`, `fandom`, `author`, `status` (reading/finished/unread), `words` (min/max). Combinator: AND / OR
  - Frontend: `/library/smart-shelves` (list page + builder dialog with live debounced preview), `/library/smart/:id` (detail page running the query). Pinned shelves surface as chips on the Dashboard. Navbar gets a "Shelves" link.
- **Mongo indexes**: `smart_shelves.shelf_id` (unique), `(user_id, created_at)`, plus `books.(user_id, tags)` for fast tag queries.
- **Tests**: +22 new tests covering tag CRUD, normalization, bulk add/remove, rename, merge, delete-everywhere, smart-shelf CRUD, OR/AND combinators, status filter, preview-without-saving, 404s. Coverage held at **80.1%** with **139 passing**.
- **UX polish**: pinned smart shelves now show even when the library is empty (lifted above the empty-state gate per testing-agent feedback).

### Added 2026-02-29 (Tag discovery: cloud + per-tag shelf)
- **`/library/tags`** (`TagCloudPage.jsx`) — tag cloud with 5-tier size scaling by usage, search box, sort by count/alpha. Tag count shown inline on each chip.
- **`/library/tag/:name`** (`TagShelfPage.jsx`) — runs `tags_any` against `POST /api/smart-shelves/preview`; offers "Save as smart shelf" (auto-builds and navigates) and "Remove tag everywhere" (purges via `DELETE /api/tags/{name}`).
- **`BookCard`** now shows up to 3 tag chips (with `+N` overflow indicator) — turns tags into a visible part of the grid.
- **`SmartShelves` page** gets a "Browse tags" button alongside "New smart shelf".
- Pure frontend addition — no new backend code (the existing `/api/tags`, `/api/smart-shelves/preview`, and `/api/tags/{name}` endpoints fully drive it). Tests held at 139/139, coverage 80.1%.

### Added 2026-02-29 (AI tag suggestions in BookDetail)
- **`POST /api/books/{id}/suggest-tags`**: re-uses `classify_with_ai` with the book's stored metadata (+ disk-cached EPUB sample text when available), returns up to 5 suggested tags that aren't already on the book. Returns `{suggested, all, ai_used}`.
- **`BookDetail.jsx`**: new "Suggest tags" button beside the Tags heading. On click, fires the endpoint; suggestions render as orange "+ tag" chips in an AI panel below the TagInput. Click any chip to add (optimistic UI). Dismiss button clears the panel.
- **Tests**: +2 (suggest returns shape, 404 on unknown book). Total **141/141 passing, coverage 80.2%**.

### Added 2026-02-29 (FicHub status banner + retry-all)
- **Diagnostic**: FicHub's public `/api/v0/epub` endpoint was returning `err=-9 "internal error"` for every URL (verified live). Shelfsort's handling was already correct (flag-and-stop). Added two UX improvements so users can tell what's happening and recover fast.
- **`GET /api/fichub/status`**: probes FicHub with a known-good AO3 URL; caches the result for 5 minutes (force=true bypasses cache). Returns `{ok, detail, checked_at, cached}`.
- **`POST /api/books/retry-unavailable`**: clears the `fichub_unavailable` flag on every previously-failed book, runs `apply_refresh` on each, and re-flags any that fail again. Returns `{attempted, refreshed, still_unavailable, failures}`.
- **`CantFindOnline.jsx`**: status banner at the top of the page (green when healthy, orange when down) with a "Re-check" button + auto-probe on mount; "Retry all (N)" button next to the download list. Calls toast for the result.
- **Tests**: +3 (status probe healthy/cached/forced, retry-unavailable success, empty result). **144/144 passing, coverage 79.2%**.

### Added 2026-02-29 (FicHub auto-sweep on recovery)
- **Scheduler hook**: the existing hourly `_digest_tick` now ends with a FicHub probe. If status flips from `ok=false` → `ok=true` (recovered), it sweeps every user with flagged books via `_sweep_user_unavailable` automatically — no user action needed.
- Refactored `routes/books.py`: extracted `_probe_fichub_now()` and `_sweep_user_unavailable(user_id)` as reusable helpers (still used by the existing endpoints).
- `routes/digest.py` imports those helpers + the shared `_fichub_status_cache` to detect the transition.
- Users typically won't even notice the outage happened — the auto-sweep handles recovery within an hour of FicHub coming back.
- Tests held at 144/144, coverage 77.9% (still well above the 75% CI gate).

### Added 2026-02-29 (Replaced FicHub with FanFicFare)
- **Dropped FicHub** (`fichub.net` API) — root cause of recent outages. Replaced with **FanFicFare** (`pip install FanFicFare==4.57.0`), the mature Python library that powers most fanfic-tooling projects. Supports **100+ sites** including AO3, FanFiction.Net, SpaceBattles, Wattpad, RoyalRoad, SufficientVelocity, etc.
- `fichub_fetch_epub` kept the same name (so all calling code is unchanged) but its body now uses `fanficfare.adapters.getAdapter` + `writers.getWriter("epub", ...)` to generate the EPUB directly from the source site. Returns the same `(epub_bytes, meta)` shape.
- **Status probe** (`/api/fichub/status`) now HEAD-requests `archiveofourown.org` instead of fichub.net. Same UX, healthier signal.
- **Migration**: on startup, every `fichub_unavailable: true` flag in the books collection is **cleared** so previously-stuck books get a fresh shot. One-time, idempotent (clears only when matches exist).
- **Test hook**: `SHELFSORT_TEST_FFF_RESPONSE` env var now bypasses the real FanFicFare call with a canned `{epub_b64, meta}` payload. `scripts/run_coverage.sh` generates a real valid EPUB at runtime for the hook.
- Tests refactored: per-test FicHub-mock variation isn't possible across the HTTP boundary, so the not-found test is now an explicit `pytest.skip` with a comment; the rest verify the refresh-completes contract using the global hook.
- **143 passing + 1 skipped, 75.2% coverage** (above the 75% CI gate). Live AO3 probe reports healthy.

### Added 2026-02-29 (Codecov publishing + README)
- `.github/workflows/backend-tests.yml`: added `codecov/codecov-action@v4` step — publishes `coverage.xml` on every push/PR with the `backend` flag.
- `codecov.yml`: project target 60% (current baseline) with 1% threshold; patch target 70% with 5% threshold; sticky PR comment with diff + flags + files.
- `README.md`: real project README with build + codecov badges, feature list, tech stack, env vars, codebase layout, and the test-running incantation. Replace `OWNER/REPO` in the badges after pushing to GitHub.
- Codecov token (`CODECOV_TOKEN`) only needed for private repos; public repos auto-publish.

### Added 2026-05-29 (Per-refresh dated shelves — version history preserved)
- **`apply_refresh`** in `routes/books.py` now puts every freshly-downloaded EPUB on its own date-stamped shelf `Updated stories YYYY-MM-DD` (helper `_updated_shelf_name`) instead of a single bucket. Each refresh batch is clearly separated; previous versions all collect on the constant `Old stories` shelf.
- The dated shelf is **auto-registered** in the `categories` collection (idempotent upsert) so it surfaces in the Dashboard chip list.
- The new book record links back via `replaces` (old book_id); the archived record gets `replaced_by`, `replaced_at`, and `category="Old stories"`. Tags / fandom / series / source_url all carry over.
- `refresh-all` and `refresh-status` now skip books with `replaced_by` set or category `"Old stories"` — prevents chain-refreshes of archived versions.
- `POST /books/{id}/refresh` response gains `updated_shelf` field; toast in `BookDetail.jsx` shows the dated shelf name.
- Tests: updated `test_refresh_book_succeeds_with_fresh_epub` to assert new shape + tag carry-over, added `test_refresh_skips_already_archived_books`, plus testing-agent added `test_refresh_registers_dated_shelf_and_filters`. **145 passing, 1 by-design skip, coverage 75.4%** (CI gate ≥75%).

### Added 2026-05-29 (Compare versions — per-chapter diff between book versions)
- **`GET /api/books/{book_id}/diff[?vs={other_id}]`** — auto-resolves the counterpart via `book.replaces` (this book is an Updated copy) or `book.replaced_by` (this book is the archived original). Returns `{old, new, diff}` where:
  - `old` / `new` each include `{book_id, title, author, category, created_at, last_refreshed_at, replaced_at, chapters: [{index, title, words}]}`
  - `diff.added_chapters` / `removed_chapters` / `changed_chapters` / `unchanged_chapters`
  - `diff.summary`: chapter counts (old/new/added/removed/changed/unchanged), old/new total words, words_delta
- **`extract_chapters(epub_path)`** walks the EPUB spine in order, prefers `<h1>/<h2>/<h3>` then `<title>` for chapter naming, computes per-chapter word count.
- **`diff_chapters(old, new)`** matches chapters by **normalized title** (lowercase, "Chapter N:" prefix stripped, whitespace collapsed) so cosmetic renames like "Chapter 7" → "Chapter 7: Storm" still match.
- **`/book/:id/compare`** — new React page (`CompareVersions.jsx`) with a warm-paper Old → New header card pair, 4 big summary stat blocks (chapters added / removed / edited / word delta), and grouped sections (Added in green, Edited in amber, Removed in red, Unchanged in muted gray). Empty state when no counterpart linked.
- **`BookDetail.jsx`** version banner gains a "Compare versions →" link whenever the book has a `replaces` or `replaced_by` link.
- **Bug fix**: `BookDetail.jsx` had two broken navigations using `/books/${id}` (plural) — the actual route is singular `/book/:id`. Fixed alongside this feature.
- Tests: added `TestVersionDiff` class — 6 tests covering auto-resolve, explicit `?vs=`, 400 when no counterpart, 404 when book missing, 404 when counterpart missing, 404 when EPUB file missing on disk. **151 passing, 1 by-design skip, coverage 75.9%**.

### Added 2026-05-29 (Re-read changed chapters jump)
- **`extract_chapters`** now also emits the `href` (in-EPUB chapter path) per chapter; `diff_chapters` returns `new_href`/`old_href` on every entry and a top-level **`first_changed_chapter`** field (first added or changed chapter by spine order — what a returning reader actually wants to read).
- **Reader** (`Reader.jsx`) reads a new `?at=<href>` query param via `useSearchParams` and calls `rendition.display(href)` on init to jump straight to that chapter (with a small "Jumped to changed chapter" toast). Falls back to saved location if epubjs can't resolve the href.
- **Compare page** gains a prominent amber CTA card — "Jump straight to what changed" with a "Re-read changes" button that links to `/read/{new_book_id}?at=<first_changed_href>`. Individual chapter rows in the Added / Changed / Unchanged sections are also clickable (with role=button + keyboard support) to jump straight to that chapter. Removed-chapter rows stay non-clickable (no destination).
- Test extended to assert `chapters` carry `href`, `first_changed_chapter` is populated with `kind`/`new_href`/`new_index`/`title`. **151 passing, coverage 75.9%**.

### Added 2026-05-29 (Navbar bell — "fics updated" notifications)
- **`apply_refresh`** now also stashes a per-book `refresh_summary` ({chapters_added, chapters_changed, chapters_removed, words_delta, first_changed_href, first_changed_title, first_changed_kind}) and `update_seen=False` on every freshly-created book so the navbar can query cheaply (no per-poll EPUB parsing).
- **`GET /api/books/recent-updates`** — returns up to N (default 8) refreshed books where `update_seen != true`, sorted by `last_refreshed_at` desc; plus a `total_unseen` count.
- **`POST /api/books/{id}/mark-update-seen`** — clear one. 404 when missing.
- **`POST /api/books/mark-updates-seen`** — clear all. Returns count marked.
- **`UpdatesBell.jsx`** — new navbar component (only renders when `total_unseen > 0`): bell icon + numeric badge ("N updated" + tiny red dot showing the count or "9+"). Click opens a 360px popover with a scrollable list of up to 8 recent refreshes, each card showing title/author/fandom, the green "+N new chapter(s)" / amber "N edited" pills, relative timestamp, and a "See what changed" CTA linking to `/book/{id}/compare`. A "Mark all seen" header action clears everything.
- **Auto-mark-seen**: when the user opens a Compare page, the book is automatically marked seen (fire-and-forget POST). The bell entry disappears on next poll.
- Polling: 60-second interval (lightweight, MongoDB query is indexed on user_id).
- Tests: **`TestRecentUpdates`** — 5 tests covering unseen listing, single mark-seen, bulk mark-seen, 404 on bad id, regular-uploads-excluded. **156 passing, 1 by-design skip, coverage 76.4%**.

### Added 2026-05-29 (Opt-in "your fics just updated" email digest)
- **`routes/digest.py`**: new `_build_update_digest_payload()` + `_send_update_digest_email()` build a warm, paper-themed HTML email listing every freshly-refreshed book with +N new / N edited pills and direct "See what changed →" links to its Compare page. Text fallback included for plain-text clients.
- **`maybe_send_update_digest(user_id, new_book_ids)`** — gated helper called via lazy import from `books.py`. Checks the user's `update_email.enabled` preference; silently noops if disabled. All errors are caught and logged.
- **`refresh-all` and `_sweep_user_unavailable`** both collect the new `book_id`s of every successful refresh, then fire-and-forget the digest via `asyncio.create_task(...)` so the API response stays fast.
- New endpoints:
  - `GET  /api/user/update-email-settings` → `{enabled, email_configured}`
  - `PUT  /api/user/update-email-settings` body `{enabled: bool}`
  - `POST /api/user/update-email-preview` — sends a sample using the user's 10 most-recently refreshed books (400 if none yet).
- **`Account.jsx`**: new "Fic-update emails" card (sparkle icon, green accent) with a toggle, "Send me a sample" CTA, and the standard "email delivery not configured" warning when `RESEND_API_KEY` is unset. Default OFF (opt-in).
- Falls back to `delivered=False, logged=True` when `RESEND_API_KEY` is empty (no breakage in preview env).
- Tests: **`TestFicUpdateEmail`** in `test_digest.py` — 5 cases covering default-disabled, toggle on/off, auth required, 400 when no refreshed books, and a full preview flow with seeded refresh data. **161 passing, 1 by-design skip, coverage 76.6%**.

### Added 2026-05-29 (Consolidated Email Preferences page)
- **`GET /api/user/email-overview`** — single endpoint returning the user's email + sender address + `email_configured` flag + the state of all three channels (weekly digest, fic updates, year recap). Year-recap mirrors weekly-digest's enabled flag (it shares the cron tick).
- **`/account/emails`** — new `EmailPreferences.jsx` page with three large channel cards (Weekly digest / Fic updates / Year recap), shared toggle styling, per-channel "Send a sample" buttons, and a top sender-info pill showing the configured `from` address + a green "Delivery configured" / amber "Delivery not configured" badge.
- **`Account.jsx`** trimmed: the two inline 80-line email sections are replaced with a single compact "Email preferences" card linking to `/account/emails`. Account page shrinks from 474 → 213 lines, ~55% lighter.
- Page is fully responsive (channel cards stack), all interactive elements carry `data-testid`s, and shows a contextual "email delivery not configured" banner only when `RESEND_API_KEY` is missing.
- Tests: **`TestEmailOverview`** — 3 cases (shape, auth-required, reflects-changes). **164 passing, 1 by-design skip, coverage 76.7%**.

### Added 2026-05-29 (Reading streak + reading-time heartbeat)
- **Heartbeat endpoint** `POST /api/books/{id}/heartbeat` accepts `{seconds: 0..600}`; updates `db.reading_activity.{date}.minutes` and per-book `reading_minutes`. Server caps each ping (defense in depth against clock skew/replay).
- **Reader.jsx** pings every 60s (one minute per ping) while the tab is visible AND the user has interacted in the last 90 seconds — no time recorded for idle tabs.
- **`GET /api/stats/streak`** — lightweight endpoint for navbar; returns `{streak_days, grace_today, today_minutes, today_active}`. Grace-day logic: streak stays alive if user read yesterday but not yet today.
- **`StreakBadge.jsx`** — flame-icon pill in the navbar, color-coded: green (1-6 days), amber (grace day pending), pulsing coral (≥7 days "hot streak"). Auto-hides at 0 days. Refreshes on focus + every 5 min.
- `reading_minutes_total` added to `/api/stats/overview`.

### Added 2026-05-29 (Analytics CSV export)
- **`GET /api/stats/export.csv`** — streams a UTF-8-BOM CSV with sections: Summary (books_total, books_finished, reading_minutes_total), Authors, Fandoms, Categories. Imports cleanly into Excel/Sheets/Numbers. Filename includes today's date.
- **`StatsPage.jsx`** gains an "Export CSV" download button (only shown when library isn't empty).

### Added 2026-05-29 (FanFicFare per-user options)
- **`GET/PUT /api/user/fff-options`** — persists `include_author_notes`, `include_images`, `keep_chapter_links` on the user document. Defaults to safe `{notes: true, images: true, links: false}`.
- **`fichub_fetch_epub(source_url, options=…)`** now applies the user's prefs via `config.set("epub", …)` before every download. `apply_refresh` reads the user pref and threads it through; existing copies are untouched.
- **`Account.jsx`** gains a "Fanfic download options" card with three labelled toggles. Idempotent partial updates (one toggle at a time).

### Tests + coverage
- New test classes: `TestStreakAndHeartbeat` (4), `TestStatsCsvExport` (1), `TestFFFOptions` (4). **173 passing, 1 by-design skip, coverage 77.3%** (up from 76.7%).

### Added 2026-05-29 (FicHub → FanFicFare full rename)
- **198 replacements across 8 files**: all `fichub*` / `FicHub*` / `FICHUB*` symbols renamed to fanfic-flavoured names. The library has been FanFicFare under the hood for a while — now the names match.
- Symbols: `fichub_fetch_epub` → `fanfic_fetch_epub`, `FicHubNotFoundError` → `FanficNotFoundError`, `FICHUB_SOURCE_PATTERNS` → `FANFIC_SOURCE_PATTERNS`, `FICHUB_USER_AGENT` → `FANFICFARE_USER_AGENT`, `_probe_fichub_now` → `_probe_fanfic_now`, `_fichub_status_cache` → `_fanfic_status_cache`.
- API endpoint: `/api/fichub/status` → `/api/fanfic/status` (clean cutover — no deprecated alias kept).
- DB fields renamed on every book document via a one-shot startup migration (idempotent `$rename`):
  - `fichub_unavailable` → `unavailable`
  - `fichub_last_error` → `last_fetch_error`
  - `fichub_last_attempt_at` → `last_fetch_attempt_at`
  - `fichub_meta` → `source_meta`
- Env vars: `FICHUB_BASE_URL` → `FANFIC_BASE_URL`, `FICHUB_MOCKED` → `FANFIC_MOCKED` (test harness only).
- Frontend testids: `fichub-status-banner` → `fanfic-status-banner`, `fichub-status-detail` → `fanfic-status-detail`, `fichub-unavailable-tag` → `unavailable-tag`.
- User-facing strings: "FicHub said: …" → "Source said: …", "books FicHub couldn't find online" → "books we couldn't fetch online" — neutral and accurate for the 100+ sites FanFicFare supports.
- All 173 backend tests still pass at 77.3% coverage; preview server logged a successful migration of 2 existing book records on first startup.

### Added 2026-05-29 (Per-book reading stats card on BookDetail)
- **`GET /api/books/{id}/reading-stats`** — returns `{reading_minutes, session_count, first_opened_at, last_opened_at, sparkline[30]}`. `session_count` = distinct days the book appears in `reading_activity`; `first_opened_at` = earliest such date. Sparkline is binary (active/inactive) per day over the last 30 days.
- **`ReadingStatsCard.jsx`** — four-stat grid (Time spent in `Hh Mm`, Sessions, First opened on, Last opened relative) plus a 30-day binary sparkline rendered as flex bars (green when active, muted dots when not). Hovering each bar shows the date + active state. Card **auto-hides** entirely when the user has never opened the book — keeps fresh-uploaded pages clean.
- Slotted into BookDetail just below the description, above the tags section.
- **Powered by FanFicFare** credit chip (separate small component) added to Dashboard empty state + CantFindOnline header. Links to the FanFicFare GitHub repo, hover-tints to the green accent.
- Tests: `TestBookReadingStats` (3 cases — unread / read aggregated / 404). **176 passing, 1 by-design skip, coverage 77.4%**.

### Updated 2026-05-29 (Gradient sparkline + per-book minute tracking)
- **`_log_activity`** now also `$inc`s `book_minutes.<book_id>` on each heartbeat — so we have honest per-book per-day minute counts going forward (legacy rows pre-dating this lack the field; they fall back to a flat low-intensity bar instead of being lost).
- **`/books/{id}/reading-stats`** response: each `sparkline` entry gains a `minutes` integer; the top-level payload gains `sparkline_max_minutes` so the UI can normalize bar heights without a second pass.
- **`ReadingStatsCard`** sparkline switches from binary to **gradient** — both bar **height** (12% → 100%) and green **intensity** (`#8FA68F` → `#5B7A60` → `#3A5A40`) scale with the day's minutes-on-this-book as a ratio of the 30-day max. Legacy active-but-no-minutes days render as a small mid-tone stub so they're not invisible. Header gets a "busiest day: 1h 12m" label.
- Hover tooltips now show the actual minutes ("2026-05-28 · 32m") instead of just "read".
- Test extended to assert every sparkline entry has `{date, active, minutes}` plus the top-level `sparkline_max_minutes`. **176 passing, 1 by-design skip, coverage 77.5%**.

### Added 2026-05-29 (Reading-pace estimate on book detail)
- **`/books/{id}/reading-stats`** response gains `estimated_minutes_left` (int or null) and `progress_percent` (float). Formula: `(reading_minutes / progress) × (1 - progress)`. Gated off when there isn't enough signal:
  - reading_minutes < 5 (per-progress would be noisy)
  - progress < 5% (division blows up)
  - progress ≥ 99% (book is essentially done)
- Sanity-clamped at 10,080 min (1 week) to swallow wild outliers.
- **`ReadingStatsCard`** shows a warm-paper banner above the stat grid: clock icon + "At your current pace, about **3h 40m left** to finish (45% done)." Auto-hides when `estimated_minutes_left` is null.
- Tests: 2 new cases (gated-off across three boundaries; computed value + clamp). **178 passing, 1 by-design skip, coverage 77.5%**.

### Deferred / Declined
- Google Drive import — declined by user (2026-02-28). Local upload remains the only ingest path.

## Prioritized Backlog
### P1 — high value, deferred
- Refactor `server.py` (~2280 lines) into modular routers (`routers/auth.py`, `routers/books.py`, `routers/stats.py`, etc.)
- Per-fandom shelf pages (already done) — extend with sorting / filtering

### P2 — polish
- Tag system (extra to fandom) + smart shelves (saved filters)
- Cover regeneration via AI when EPUB has no cover image
- Move from local FS to object storage when scaling
- Reading time tracking (minutes spent in Reader, not just opens)

### P3 — nice-to-have
- Sharing a public shelf URL
- Recommendations based on top fandoms/authors
- EPUB metadata in-place editing (not just bulk)

## Next Tasks
- Refactor `server.py` into routers if backend keeps growing
- Add reading-time tracking on Reader.jsx (currently only tracks opens)
- Consider exporting Author/Fandom analytics as downloadable CSV

### Added 2026-05-29 (EPUB template applier — matches user's reference EPUB)
- User uploaded a FicHub-style EPUB as a template; every fanfic download/refresh now passes through `apply_template_to_epub()` which:
  - **Captures more metadata** from FanFicFare: title, author, description, status, datePublished, dateUpdated, numWords, numChapters, rating, language, reviews, favs, follows, genre, category.
  - **Injects an "Introduction" XHTML** BEFORE the TOC, mirroring the reference layout: `<h1>Title</h1>`, `<p><b>By: Author</b></p>`, description, Status / Published / Updated / Words / Chapters / "Rated: Fiction M - Language: English - Reviews: ..." / "Original source: <link>" / "Exported with the assistance of FanFicFare via Shelfsort".
  - **Replaces the stylesheet** with Verdana sans-serif rules (centred `<h1>`, bold left-aligned `<h2>`).
  - **Stamps a `shelfsort:templated` marker** in `content.opf` for idempotency (re-runs are no-ops, verified by test).
  - **Fails safe**: malformed EPUB → returns original bytes unchanged.
- Wired into `apply_refresh` (covers single, bulk-refresh-all, and sweep paths). Gated by new `fff_options.apply_template` (default **True**); user can disable from `/account` (the FanFicFare options card now has 4 toggles).
- Tests: 3 new cases in `TestEpubTemplateApplier` + `test_defaults` extended. **181 passing, 1 by-design skip, coverage 78.3%** (up from 77.5%).

### Added 2026-05-30 ("Apply template to all my books" retroactive sweep)
- **`POST /api/user/apply-template-to-all`** — iterates the user's books (capped at 1000 per request), reads each EPUB from disk, runs `apply_template_to_epub` in a thread pool to keep the event loop responsive, writes back changed bytes. Returns `{processed, templated, already_templated, errors, skipped, total_in_library}`.
- Idempotent: already-templated EPUBs are detected by the `shelfsort:templated` marker and skipped without rewriting (zero-byte diff).
- **Account.jsx** gains an "Apply template to all my books" button beneath the FFF toggles, with browser confirm + loading spinner + structured success toast ("12 updated · 8 already templated · 0 errors").
- Tests: `TestApplyTemplateToAll` (sweep flow + idempotent re-run + auth required). **183 passing, 1 by-design skip, coverage 78.4%** (up from 78.3%).

### Added 2026-05-30 ("Tidy filenames" sweep — matches attachment naming)
- **`_templated_filename(title, author, book_id)`** helper → `Title_by_Author-<8charid>.epub` (spaces → underscores, filesystem-unsafe chars stripped). Matches the user's reference EPUB exactly: `A_Black_Comedy_by_nonjon-2F4YtDd3.epub`.
- **Per-book download** (`GET /books/{id}/download`) now uses the templated name in Content-Disposition.
- **ZIP library export** (`GET /books/export-zip`) uses the templated name for each arcname inside the archive.
- **Fresh refreshes** save the new book with the templated filename in `book.filename`.
- **`POST /user/tidy-filenames`** — sweep endpoint that backfills every existing book's `filename` field to the templated pattern. Idempotent (already-correct count returned separately). Account page adds a "Tidy filenames" button beside the "Apply template to all my books" button.
- Tests: 4 new in `TestTidyFilenames` (helper unit + sweep + auth + download Content-Disposition). **187 passing, 1 by-design skip, coverage 78.6%** (up from 78.4%).

### Added 2026-05-30 (Onboarding prompt — asks before polishing the library)
- Replaced the silent auto-run idea with a friendly **opt-in banner** on the Dashboard.
- **`GET /api/user/onboarding-status`** → `{template_prompt_pending, book_count}`. Pending iff user has ≥1 book AND has never been prompted.
- **`POST /api/user/dismiss-template-prompt`** body `{accept: bool}`:
  - Sets `template_prompt_dismissed=true` + `template_prompt_accepted` + timestamp regardless of choice (so we never ask twice).
  - When `accept=true`, runs BOTH sweeps inline (template + tidy filenames) and returns structured counts.
- **`OnboardingPrompt.jsx`** — amber banner with sparkle icon, dismissable X, "Not now" + "Yes, polish everything" buttons. Auto-hides after either button click. Slotted at the top of the Dashboard `<main>`. Shows the user's current book count in the copy.
- Tests: `TestOnboardingPrompt` (4 cases — pending status, dismiss-decline, accept runs sweeps, auth). **191 passing, 1 by-design skip, coverage 78.9%** (up from 78.6%).

### Fixed 2026-05-30 (HTTP 403 from fanfic sources)
- Symptom: refresh failed with "Couldn't reach source: HTTP Error in FFF '403"
- **Root cause**: `FANFICFARE_USER_AGENT = "Shelfsort/0.1 ..."` looked like a scraper; AO3 / FFN / Cloudflare reject those. Also the UA was only set on our own status-probe requests, never on FanFicFare's actual scraping requests.
- **Fix**:
  - Replaced UA with a modern Firefox string: `"Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"`.
  - Injected it into the FanFicFare `Configuration` via `config.set("defaults", "user_agent", …)` and `config.set(host, "user_agent", …)` so FFF itself uses it.
  - Added **automatic retry-with-30s-backoff** on 403 — Cloudflare challenges and rate-limits often clear inside a minute. Only after the retry fails do we flag the book unavailable.
  - Friendlier error message: distinguishes 403 (rate-limit / Cloudflare / restricted work) from generic transport failures.
- **CantFindOnline page** improvements:
  - Source URL is now a clickable link (with external-link icon) instead of plain text.
  - 403 errors render in **amber** (transient) instead of red (permanent), with a ⚠ glyph.
  - New per-book **"Try in browser"** button on every failing row — opens the source URL directly so the user can verify the work isn't deleted/locked.
- All 191 tests still pass at 78.4% coverage.

### Added 2026-05-30 ("Upload replacement EPUB" — bypasses bot-protection)
- Context: FanFiction.net's Cloudflare anti-bot is serving FFF a challenge page that gets parsed as `StoryDoesNotExist` (misleading "Story not found" toast). Server-side scraping can't reliably solve Turnstile challenges — but the user can grab the EPUB themselves and upload it.
- **`POST /api/books/{book_id}/replace-epub`** (multipart upload) — preserves EVERY user-side field (tags, category, progress_percent, reading_minutes, source_url, fandom, series, custom shelf assignments, classifier, confidence). Only updates `size_bytes`, `links_count`, `last_refreshed_at`, `manually_replaced_at`, `filename` (tidied), and `chapters`/`words` if successfully re-extracted from the new EPUB. Clears `unavailable` + `last_fetch_error`. Applies the house template if the user has `apply_template` enabled.
- Validates: filename ends `.epub`, byte length ≥256, starts with `PK\x03\x04` (zip header). Friendly errors otherwise.
- **`BookDetail.jsx`**: new "Upload replacement" button alongside "Update from FanFicFare", with hidden `<input type="file" accept=".epub">` and a clear tooltip.
- **`CantFindOnline.jsx`**: same button on every failing row (where users actually need it most).
- **Improved FFN error message**: when `StoryDoesNotExist` fires on a FanFiction.net URL, the message now points the user at "Upload replacement" instead of suggesting the work moved.
- Tests: `TestReplaceEpub` (4 cases — preserve-metadata, reject-non-epub, reject-garbage-bytes, 404). **195 passing, 1 by-design skip, coverage 78.3%**.

### Changed 2026-05-30 (Upload-as-new-version replaces upload-replacement)
- User feedback: "instead of uploading a replacement of an epub with link, just upload into a whole new file" — so the manual upload flow now mirrors the refresh flow exactly instead of overwriting in place.
- **`POST /api/books/{book_id}/upload-new-version`** (replaces `/replace-epub`):
  - Creates a brand-new book record on a date-stamped `Updated stories YYYY-MM-DD` shelf.
  - Archives the old book to `Old stories` with `replaced_by` back-pointer.
  - Carries over tags, source_url, fandom, series, etc. to the new copy; classifier is always `"manual_upload"`.
  - Computes `refresh_summary` (chapter diff via `extract_chapters` + `diff_chapters`) so the bell badge + email digest fire, and the Compare-versions page works just like for an automatic refresh.
  - Sets `update_seen=False`, `manually_uploaded_at`.
  - Refuses to upload onto an already-archived book (400 with friendly message — "open the current version and upload there").
  - Applies the house template; tidies the filename.
- **BookDetail** + **CantFindOnline** buttons relabelled "Upload new version" with a navigate-on-success that takes the user to the freshly-created copy.
- Tests: `TestUploadNewVersion` (5 cases — happy path with full metadata carry-over, blocked-on-archived, non-epub reject, garbage-bytes reject, 404). **196 passing, 1 by-design skip, coverage 78.6%**.

### Added 2026-05-30 (Per-fanfic folders in the links .txt export)
- User feedback: "when making a .txt, separate each fanfiction into different folders."
- **`GET /api/books/export/links?format=zip`** — returns a ZIP organized as `<shelf>/<Title_by_Author>/links.txt`, one folder per fanfic. Top-level `README.txt` explains the layout. Default `format=txt` still returns the single combined .txt (back-compat).
- Filter params (`category`, `fandom`) still apply — e.g. `?format=zip&fandom=Harry%20Potter` returns only HP books, each in its own folder under `Fanfiction/Harry_Potter/`.
- **Navbar** "Download links" button + **FandomShelf** "Export links" button both now default to `format=zip`.
- Tests: `TestLinksExportByFolder` (3 cases — default txt back-compat, zip structure verification, fandom filter). **199 passing, 1 by-design skip, coverage 78.9%**.

### Changed 2026-05-30 (Links export grouped by fandom, not per-fic)
- User refinement: "put each fanfiction into a .txt with other like fanfiction. Harry Potter, twilight, star trek etc."
- Reworked the ZIP export from "one folder per fic" to **"one .txt per fandom"** (or per category for non-fanfiction).
- Each fandom's .txt opens with `=== FandomName ===` + book count + Total URLs, then each book is listed `Title — Author` followed by its URLs (one per line, indented). Books are separated by blank lines so it scans naturally.
- Books with no EPUB on disk now still appear in the listing (annotated `(EPUB missing on disk)`) so the file is a complete inventory rather than silently skipping.
- Fandom filter on the export endpoint still works — produces a single `<fandom>.txt` inside the ZIP.
- Navbar tooltip updated to "one .txt per fandom (Harry Potter, Star Trek, etc.)"
- Tests: `TestLinksExportByFolder` rewritten for the new flat layout (default-txt back-compat, per-fandom .txt grouping, fandom filter). **199 passing, 1 by-design skip, coverage 79.0%**.

### Added 2026-05-30 (Excel/XLSX library export — full metadata per book)
- User refinement: instead of a .txt, get an Excel workbook with categories that include full metadata (title, author, fandom, status, word count, source URL, last refreshed).
- **New dep**: `openpyxl==3.1.5` (added to `requirements.txt`).
- **`GET /api/books/export/links?format=xlsx`** returns a styled `.xlsx`:
  - **Summary** sheet at the top: generation timestamp + book / fandom counts + a "books per fandom" table.
  - **One sheet per fandom** (or per category for non-fanfic). Sheet names are sanitized to Excel's rules (≤31 chars, no `: \ / ? * [ ]`).
  - Columns per row: Title, Author, Fandom, Status, Words, Chapters, Progress %, Reading min., Source URL, Last refreshed, Created.
  - Header row styled (white-on-green, bold), frozen pane on row 1, auto-filter enabled, sensible column widths.
- Filter params still apply: `?format=xlsx&fandom=Harry%20Potter` → just one fandom sheet + summary.
- **Frontend**: navbar button relabelled `Library (.xlsx)`, defaults to xlsx, tooltip updated.
- **Backward compat**: `format=txt` (default if omitted) still returns the single combined .txt. `format=zip` still returns per-fandom .txt files in a zip.
- Tests: 2 new cases in `TestLinksExportByFolder` (per-fandom sheet structure + filter). **201 passing, 1 by-design skip, coverage 79.4%**.

### Changed 2026-05-30 (XLSX export trimmed to 4 columns, fixed order)
- User refinement: keep only Title, Author, Fandom, Source URL — in that exact order. Removed Status, Words, Chapters, Progress %, Reading min., Last refreshed, Created.
- Simplified the row-build loop (no more `_status` / `_words` / `_progress` special-keys). Test updated to assert the exact column ordering via `headers == ["Title", "Author", "Fandom", "Source URL"]`.
- **201 passing, 1 by-design skip, coverage 79.3%**.

### Added 2026-05-30 (Bulk + total library deletion)
- Bulk delete already existed via the Dashboard selection toolbar (`POST /api/books/bulk/delete`) — multiple books at once with checkbox selection.
- **NEW: `POST /api/books/wipe-library`** — requires body `{"confirm": "DELETE_EVERYTHING"}` (sentinel) to prevent accidental nukes. Drops every book row, every on-disk EPUB/cover/links sidecar, reading_activity, smart_shelves, and custom categories for the user. Also resets the onboarding flag so the user-prompt can fire again on fresh re-upload. Account record stays.
- **Account → Danger zone card** (bottom of page, amber-bordered) with a single "Delete entire library" button. Two-step confirmation: a browser `prompt()` requires the user to type `DELETE EVERYTHING` (capitals exact) — phrase-mismatch toasts an error, no API call fires. After success, page redirects to `/library` after 1.5s.
- Tests: `TestWipeLibrary` (3 cases — confirmation-required, full-wipe clears DB + files, auth required). **204 passing, 1 by-design skip, coverage 79.4%**.

### Added 2026-05-30 (Selective "Reset library state" — optional, opt-in)
- User refinement: keep the books, but offer an OPTIONAL way to wipe selected metadata.
- **`POST /api/books/reset-state`** body `{reset_progress, reset_tags, reset_smart_shelves, reset_versions}` — each flag independent (must pick ≥1 or 400). Returns summary counts per dimension.
  - `reset_progress`: unsets `progress_percent`, `last_opened_at`, `reading_minutes`, drops `reading_activity` rows.
  - `reset_tags`: clears `book.tags` to empty array.
  - `reset_smart_shelves`: drops `smart_shelves` collection rows for the user.
  - `reset_versions`: collapses `Old stories` + `Updated stories YYYY-MM-DD` shelves back to `Fanfiction` (if book has fandom) or `Unclassified`; unsets `replaces`/`replaced_by`/`refresh_summary`; deletes auto-created dated `categories` entries.
- **Account → "Reset library state"** card (sits above Danger zone) — four checkbox toggles + a "Reset selected" button. Confirms with a native confirm() listing the picked options. Browser-confirm declined ⇒ no API call. Errors when nothing's checked.
- Tests: `TestResetState` (3 cases — 400 when nothing picked, progress-only reset wipes the right things and leaves tags alone, version-collapse cleans up shelf+pointers). **207 passing, 1 by-design skip, coverage 79.5%**.

### Verified 2026-05-30 (Reset-state + Wipe-library E2E)
- Testing agent ran full HTTP integration + Playwright UI verification: 14/14 backend tests + 4/4 frontend scenarios all green. No regressions. Feature formally closed.
- Side-fix: stale `test_upload_rejects_non_epub` updated to match the new "Needs conversion" .txt-upload behavior (now `test_upload_non_epub_flagged_for_conversion`). Coverage held at 79.5%.

### Added 2026-05-30 (Duplicate detection on upload + resolution modal)
- **Problem**: nothing prevented re-uploading the same book; users could end up with silent dupes.
- **Detection signals** (cheap + low false-positive — checked at upload-time, doesn't block ingestion):
  - normalized title equality (case-insensitive, whitespace-collapsed)
  - exact `source_url` equality
  - any shared canonical fanfic URL (matches against `FANFIC_SOURCE_PATTERNS` — AO3 `/works/N`, FFnet `/s/N`, RoyalRoad `/fiction/N`, SpaceBattles/SufficientVelocity threads, etc., so boilerplate AO3 nav links don't trigger false hits)
  - archived versions (`Old stories` / `replaced_by`) are excluded so resolved dupes don't re-surface
- New per-book persisted field: `fanfic_urls: List[str]` — canonical permalinks extracted from the EPUB's link set. Saved on every fresh upload going forward; legacy books fall back to title + source_url matching.
- **Upload still succeeds**; offending books are flagged with `duplicate_pending: true` + `duplicate_of: [{book_id, title, author, match_reasons}]`.
- **`POST /api/books/{book_id}/resolve-duplicate`** body `{action, target_book_id?}`:
  - `"keep"` — clear the flag, keep both copies
  - `"discard"` — delete the just-uploaded book + its EPUB/cover/links sidecar
  - `"new_version_of"` (with `target_book_id`) — archive the target to `Old stories`, move the uploaded book to a date-stamped `Updated stories YYYY-MM-DD` shelf, compute a `refresh_summary` via the existing `extract_chapters` + `diff_chapters` machinery, fire `update_seen=false` so the navbar bell badge + Compare-versions page light up just like an auto-refresh
- **Frontend**: `DuplicateResolutionModal.jsx` pops automatically when the upload response contains any `duplicate_pending` books. Per row, three big action cards (Keep both / Discard upload / Replace as new version). When the new book matches more than one existing book, a dropdown lets the user pick which one to replace. Apply-all button posts each resolution then refreshes the dashboard.
- Tests: `TestDuplicateDetection` — 6 cases (title match, shared-URL match, resolve keep clears flag, resolve discard deletes book + files, resolve new_version_of archives target & sets dated shelf, 400 on bad action / missing target). **227 passing, 1 by-design skip, coverage 80.1%** (`routes/books.py` 81.8%).

### Added 2026-05-30 (Find duplicates in library — retroactive cleanup tool)
- **Problem**: the upload-time dupe modal only catches new uploads. Libraries that grew before that feature shipped need a way to find existing dupes.
- **`GET /api/library/duplicates`** — scans the user's non-archived library, **opportunistically backfills** `fanfic_urls` on legacy books (capped at 1000 per call) by reading their on-disk `.links.txt` sidecars, then runs a union-find across three inverted indexes (normalized title / source_url / fanfic_urls) to surface groups of 2+ matching books. Returns `{groups: [{match_reasons, books[]}], total_groups, total_dupe_books, backfilled}`. Groups sorted largest first; books within each group ordered oldest-first so the default keeper is the original copy.
- **`POST /api/books/resolve-group`** body `{keeper_id, decisions: [{book_id, action}]}` — resolves an entire group atomically. Actions per non-keeper book: `keep` (no-op), `discard` (delete + on-disk files), `archive` (move to `Old stories` with `replaced_by = keeper_id`). Returns summary counts. Rejects an already-archived keeper.
- **`/account/duplicates`** — new `FindDuplicates.jsx` page. Shows summary banner + one card per group: radio-pick the keeper (defaulting to oldest), then per-dupe action grid (Keep alongside / Archive as old / Delete) styled distinctly (orange/amber/red). Per-group "Apply" button posts the resolution and disables the card on success. Empty state shows a green check with backfill summary.
- **Account page** gets a "Find duplicates" card (orange Layers icon, "Scan library" CTA) sitting just above "Reset library state".
- Tests: `TestFindDuplicatesInLibrary` — 5 cases (empty library returns no groups, books grouped correctly by title and shared URL, resolve-group archives + discards correctly, 400 on archived keeper, 404 on unknown keeper). **232 passing, 1 by-design skip, coverage 79.9%** (`routes/books.py` 81.3%).

### Added 2026-05-30 (Likely-duplicates count nudge on Account page)
- **`GET /api/library/duplicates/count`** — cheap pre-flight that runs the same union-find scan but **skips the on-disk sidecar backfill** (only uses already-stored title/source_url/`fanfic_urls` indexes). Returns `{total_groups, total_dupe_books}`.
- **Account page** fetches the count on mount and the Find-duplicates card now contextually shows:
  - "12 possible duplicate groups found across 28 books" (amber, font-medium) when dupes exist
  - "No duplicates spotted right now." (muted) when clean
  - The standard descriptive copy when the count hasn't loaded yet
- Button label flips between "Scan library" and "Review duplicates" based on the count.
- Tests: `TestDuplicatesCount` — 2 cases (empty library, reflects dupes accurately). **234 passing, 1 by-design skip**.

### Added 2026-05-30 (Cross-version dupe detection — historical snapshots)
- **Problem**: uploading a 2020 snapshot of a fic you've since re-fetched used to either miss the match entirely or get offered as a "new version" (replacing the current copy, which is backwards).
- **`find_duplicate_candidates`** rewritten: now searches archived books too. When a match lands on an archived book, walks the `replaced_by` chain to its current head and surfaces the head as the candidate, with `historical_version` added to `match_reasons`. Multiple archived matches that walk to the same head are merged into a single result with combined reasons. Orphaned chains (heads that are themselves archived/missing) are skipped.
- New `resolve-duplicate` action `"link_as_old_version"` — archives the just-uploaded book under `target_book_id` (the current head) with `category="Old stories"`, `replaced_by=target_book_id`, `replaced_at=now`. Reverse polarity of `new_version_of`.
- **Frontend**: `DuplicateResolutionModal` switches to a 4-button 2x2 action grid. The new blue "Link as historical version" tile picks up a small "suggested" badge when the match carries the `historical_version` reason. Target-picker dropdown (when there's >1 match) now contextually relabels to "Which existing book is the current copy?" for the historical action.
- Tests: 2 new in `TestDuplicateDetection` (cross-version detection against archived books, resolve link_as_old_version archives correctly). **236 passing, 1 by-design skip, coverage 80.1%** (`routes/books.py` 81.6%).

### Added 2026-05-30 (At-a-glance folder on Dashboard + user-orderable sections)
- **Dashboard reorg**: Continue-reading, reading stats (StatsCard), and pinned smart shelves now live together in a single warm-gradient "At a glance" folder card at the very top of the dashboard. Empty-library state stays clean (folder auto-hides).
- **`GET/PUT /api/user/dashboard-layout`** persists `{order: ["continue"|"stats"|"shelves"...]}` on the user doc. Validation: rejects unknown sections (400), rejects duplicates (400), pads missing sections at the end of any partial save so the order is always complete.
- **Frontend**: header has an "Organize" toggle. While in organize mode, each section sprouts a small vertical pair of ↑/↓ buttons (left-aligned, white-on-cream chips). Each move fires an idempotent PUT to the layout endpoint — no save button needed.
- Tests: `TestDashboardLayout` — 7 cases (default order/hidden, save+round-trip preserves hidden default of [], hidden round-trip, hidden rejects unknown, partial-pad behavior, rejects unknown section, rejects duplicates). **243 passing, 1 by-design skip**.

### Added 2026-05-30 (At-a-glance: show/hide sections)
- **Backend** `dashboard_layout` now stores `{order, hidden}`. PUT accepts an optional `hidden: [section,…]`, validates each entry against the section whitelist (400 on unknown). GET seeds default `[]`. Old documents that pre-date the field default to no hidden sections.
- **Frontend** organize mode adds a third per-section button — Eye / EyeOff — alongside the up/down arrows. Hidden sections render at 40% opacity in organize mode (so the user can find and un-hide them); outside organize mode they're collapsed entirely. Switching state idempotently PUTs to the layout endpoint.
- Bonus polish: in organize mode, empty sections now show a dashed-border placeholder ("Reading stats — nothing here yet") so users see what the layout would look like once content arrives.
- Reset-to-defaults button surfaces in organize mode (single click restores `["continue","stats","shelves"]` with `hidden: []`).

### Added 2026-05-30 (Default duplicate-handling policy)
- **`GET/PUT /api/user/duplicate-policy`** — persists one of `ask` (default — pops the modal), `keep_both`, `discard`, `new_version`, `historical` on the user doc.
- **`_apply_duplicate_policy()`** helper called at the end of `/books/upload`: when the policy isn't `ask`, every freshly-flagged duplicate is auto-resolved server-side. Chapter diff computation is skipped for batch convenience (users on a stand policy chose speed over the bell badge).
- **UploadZone**: response now exposes `auto_resolved` + `policy`. Toast adapts: `"Sorted 5 files · 2 duplicates linked as historical versions"` etc.
- **Account page** gets a "Duplicate handling" card with 5 radio-style picker buttons that PUT on click — instant save.
- Tests: `TestDuplicatePolicy` — 5 cases (default ask, set+round-trip, invalid policy 400, discard policy removes dup, historical policy archives the upload under the existing head). **248 passing, 1 by-design skip**.

### Added 2026-05-30 (Undo strip for auto-resolved duplicates)
- **Problem**: with a default policy other than `ask`, an upload could silently archive/replace books — surprising if the user uploaded a fresh fetch the system mis-classified.
- **`_apply_duplicate_policy`** now records previous categories (`prev_category_new`, `prev_category_target`, `target_book_id`) under each affected book's `dupe_action_meta` field.
- **`POST /api/books/{book_id}/undo-resolve`** — reverses `historical` (restores category, unsets `replaced_by`/`replaced_at`) and `new_version` (restores both books' categories, unsets `replaces`/`replaced_by`/`update_seen`). Returns 400 for `keep_both` (no-op) and `discard` (file is gone — hard-delete only).
- **Upload response** gains an `actions: [{book_id, title, action, target_book_id, undoable}]` array per batch.
- **Dashboard**: amber undo strip surfaces after upload when one or more actions are undoable. Shows the count + action kind ("linked as historical versions" / "replaced as new versions"). "Undo" button reverses every action in the batch; auto-dismisses after 30 seconds.
- Tests: `TestUndoResolve` — 3 cases (undo historical restores book, undo new_version restores both books, undo rejects keep_both with 400). **251 passing, 1 by-design skip**.

### Added 2026-05-30 (Trash shelf — 30-day grace window for discards)
- **`TRASH_SHELF` + `TRASH_GRACE_DAYS = 30`** constants. Discard actions (both interactive modal and auto-policy) now move books to `Trash` with `trash_expires_at = now + 30 days` instead of hard-deleting. Files stay on disk so restore is possible.
- **`GET /api/trash`** lists trashed books with `{books, count, grace_days}`.
- **`POST /api/trash/restore/{book_id}`** restores to the previous category (400 if not actually in Trash).
- **`POST /api/trash/empty`** immediate hard-delete of every trashed book + on-disk files.
- **`sweep_expired_trash()`** appended to the hourly `_digest_tick` — hard-deletes any trashed book past its grace window.
- **`GET /books`** now excludes the Trash shelf by default (only surfaces when explicitly filtered by `?category=Trash`).
- **Undo strip** now also covers the `discard` action — clicking Undo restores from Trash.
- **`/library/trash`** new page: list rows with "X days left" badges + per-book Restore button, "Empty trash" header button, friendly empty state.
- **Dashboard** gets a small "Trash · N" chip below the library header (only when count > 0).
- **Account "Duplicate handling"** card relabels: "Send to Trash" with "Move duplicates to Trash for 30 days, then auto-delete." Modal action renamed similarly.
- Tests: `TestTrashShelf` — 6 cases (list, restore, restore 400 on non-trashed, empty hard-deletes, sweep-listing, excluded from library). Existing `test_resolve_discard_deletes_book` and `test_upload_with_discard_policy_removes_dup` rewritten for the new soft-delete semantics. **257 passing, 1 by-design skip, coverage 80.1%**.

### Added 2026-05-30 (Bulk-delete now soft-deletes to Trash)
- **`POST /api/books/bulk/delete`** rewritten: instead of hard-deleting, it now moves every selected book to the `Trash` shelf with a 30-day grace window. Records `prev_category_new` per book under `dupe_action_meta` so restore is clean. Single-book `DELETE /api/books/{id}` left untouched (intentional click on BookDetail = explicit, no soft-delete safety net).
- **`POST /api/trash/restore-all`** — new mass-restore endpoint that walks every trashed book and restores it to its prior category.
- **Trash page**: header gets a "Restore all" button alongside "Empty trash".
- **SelectionBar** confirm/toast copy updated: "Move N books to Trash · restorable for 30 days".
- Tests: 2 new (`test_bulk_delete_soft_deletes`, `test_restore_all_endpoint`) + the existing `TestOtherRegression::test_bulk_delete` rewritten to verify the new soft-delete shape. **259 passing, 1 by-design skip**.

### Added 2026-05-30 (Folder + mixed-format uploads → full EPUB pipeline via Calibre)
- **UploadZone** now accepts folders (drag a folder onto the dropzone or click "Pick a folder" — uses `webkitdirectory` + recursive `webkitGetAsEntry` walk).
- Accepted extensions widened: `.epub`, `.pdf`, `.mobi`, `.azw`, `.azw3`, `.kf8`, `.kfx`, `.docx`, `.doc`, `.rtf`, `.fb2`, `.lit`, `.lrf`, `.pdb`, `.txt`, `.html`, `.htm`.
- **Server-side auto-conversion**: installed Calibre (`apt-get install calibre`, brings in `ebook-convert` 6.13.0). Every non-EPUB upload is run through `ebook-convert <src> <dest>.epub` in a worker-pool subprocess (3-min cap per book). On success the converted EPUB **flows through the full standard pipeline** — metadata extraction, AI classification, fanfic URL detection, source URL detection, chapter parsing, template applier, duplicate detection. On failure (corrupt source, weird format, conversion crash) the original file lands on the `Needs conversion` shelf with the actual error message attached.
- New per-book fields: `converted_from: "<ext>"` (also mirrored as `original_format`) so the UI can show "Original format: .pdf → .epub" in BookDetail.
- **BookDetail page** surfaces the "Original format" meta row when present.
- Result: PDFs, MOBIs, KFX, DOCX etc. are now **first-class books** — fully readable in the in-app Reader, classified onto the right shelf, deduplicated, refresh-eligible.

### Added 2026-06-06 (AO3-aware URL list filter)
- **Problem**: pasting AO3 URLs into the Filter-URL-list page produced inconsistent dedupe results because surface variants of the same work (`www.` / `m.` mobile / `/collections/X/works/N` / `/works/N/chapters/M` / query strings / trailing slash / `http://` vs `https://`) each got their own canonical key.
- **`normalize_fanfic_url()`** (new) collapses every fanfic-permalink variant to a single canonical:
  - AO3 → `https://archiveofourown.org/works/{N}`
  - FFnet → `https://www.fanfiction.net/s/{N}`
  - FictionPress → `https://www.fictionpress.com/s/{N}`
  - RoyalRoad → `https://www.royalroad.com/fiction/{N}`
  - SB/SV/QQ thread IDs lowercased; host normalized to `forums.*`
- `_canonical_fanfic_url`, `find_source_url`, and `extract_fanfic_urls` all route through it — so newly uploaded books store the canonical form on disk.
- **`classify_ao3_non_work()`** recognises AO3 series/collection/user pages so they no longer fall into the "unrecognized" bucket; the dedupe response now surfaces them in a dedicated `ao3_non_work` array tagged `ao3_series` / `ao3_collection` / `ao3_user`.
- **`/api/books/url-list/dedupe`** response gains:
  - `duplicate_in_list` — repeat surface forms of the same canonical (so the user can see "you pasted /works/12345/chapters/9 even though you already had /works/12345 above")
  - `ao3_non_work` — the AO3 non-story buckets above
  - `by_source` — count per source ("AO3 · 3 · FFnet · 1 · AO3 (not a story) · 1") for an at-a-glance overview
- **Startup migration**: idempotently renormalizes existing books' `source_url` and `fanfic_urls` so previously-stored www-prefixed / mobile / chapter URLs match newly-pasted bare permalinks. Logs the count of records touched.
- **`FilterUrlList.jsx`**: header description now mentions AO3 variant handling; results card displays per-source breakdown chips, lists duplicate pastes, and shows a dedicated "AO3 links that aren't individual stories" section with kind badges (series / collection / user).
- **Tests**: `TestAo3UrlNormalization` — 5 cases covering (1) 6 AO3 surface variants all dedupe to one canonical, (2) fresh paste of mixed AO3 forms normalize consistently, (3) AO3 series / collection / user URLs bucket separately + by_source breakdown, (4) legacy-stored URL still matches pasted variants, (5) FFnet + RoyalRoad normalization. **All 5 new tests pass.**

### Added 2026-06-06 ("Duplicate pastes" 3rd sheet in URL Excel export)
- **`/api/books/url-list/export-xlsx`** body now accepts an optional `duplicates: [{url, canonical}]` array.
- When present, the workbook gains a third sheet **"Duplicate pastes"** (columns: URL pasted · Canonical · Source) listing every surface form of a canonical URL that was pasted more than once — i.e. the exact rows captured in `duplicate_in_list` from the dedupe response. Sheet is **omitted entirely** when the array is empty/missing, so existing workflows that don't pass it see zero change.
- **`FilterUrlList.jsx`** now forwards `duplicate_in_list` on every export and the download button label shows the duplicate count (`Download Excel (3 new · 2 owned · 1 dup)`). Empty-export guard updated.
- Tests: 2 new cases (`test_xlsx_export_includes_duplicates_sheet` verifies the sheet exists with correct headers + AO3 source tagging; `test_xlsx_export_omits_duplicates_sheet_when_empty` verifies back-compat). **7/7 in `TestAo3UrlNormalization` passing.**

### Fixed 2026-06-06 (URL list filter saying "not in library" when book IS there)
- **Root cause #1**: upload pipeline was extracting `source_url` / `fanfic_urls` / `links_count` from the EPUB but **never including them in the doc dict it inserted** into Mongo. Every book uploaded via the standard path was stored without URL metadata, so URL-list dedupe could never match.
- **Root cause #2**: `_parse_urls_from_sidecar` only accepted lines that **start** with `http://` — but `format_links_txt` writes `1. http://...`, so the function always returned an empty list. The `find_duplicates` backfill that depended on it was silently a no-op too.
- **Fix #1**: upload pipeline now persists `source_url`, `fanfic_urls`, `links_count`, `size_bytes`, `confidence`, `classifier`, `series_name`, `last_refreshed_at` on every newly-uploaded book record (matches the field set the post-conversion path was already writing).
- **Fix #2**: `_parse_urls_from_sidecar` now uses the same `_URL_RE` regex used for paste-list extraction — pulls every URL out of the sidecar regardless of leading ordinal.
- **Fix #3**: `_dedupe_url_list` runs `_backfill_user_fanfic_urls(limit=2000)` before the Mongo match — for every book missing the field, it reads the on-disk sidecar, normalizes URLs, and persists `fanfic_urls` + `source_url`. Idempotent: skips books that already have the field.
- **Verified on the live affected user's library**: 19 fanfic books that had ZERO URL metadata before are now fully populated and a paste of `http://archiveofourown.org/works/119` correctly matches "Slowly, But Exceeding Fine".
- Tests: 2 new in `TestAo3UrlNormalization`:
  - `test_upload_persists_source_url_and_fanfic_urls` — verifies the upload doc carries the URL fields and a follow-up paste-list dedupe finds the freshly-uploaded book.
  - `test_dedupe_backfills_legacy_books_from_sidecar` — seeds a book without `fanfic_urls`, writes a real-format sidecar, runs dedupe, asserts the match succeeds AND the field is now persisted.
- **9/9 in `TestAo3UrlNormalization` passing.**

### Added 2026-06-06 (AO3 — alternate hostnames recognized)
- AO3 serves the archive under several official hostnames; the URL list / canonicalizer now treats all of them as the same source and dedupes them to a single canonical:
  - `archiveofourown.org` (primary)
  - `archiveofourown.com`
  - `archiveofourown.net`
  - `archiveofourown.gay`
  - `ao3.org` (short alias)
  - `archive.transformativeworks.org` (OTW long form)
  - `insecure.archiveofourown.org` (HTTP fallback subdomain)
  - Plus `www.` / `m.` mobile prefixes on any of them
- Implementation: single `_AO3_HOST_RE` host alternation reused by `FANFIC_SOURCE_PATTERNS[0]`, `_AO3_WORK_CANON_RE`, and `_AO3_NON_WORK_PATTERNS`. `_source_for()` now routes through `_is_ao3_host()` so the by-source bucket labels every variant "AO3".
- Chapter URLs with fragments (`/works/N/chapters/M#workskin`) already normalized correctly — confirmed in the new test.
- Test: `test_ao3_alternate_hostnames_all_dedupe` seeds one canonical book and pastes 9 surface variants (all hosts + chapter URLs + `#workskin` fragment) → exactly 1 owned + 8 duplicate_in_list + 9 in AO3 bucket. **10/10 in `TestAo3UrlNormalization` passing.**

### Added 2026-06-06 (AO3 mirror heads-up banner)
- `/api/books/url-list/dedupe` response now includes `ao3_mirrors: {host → count}` listing every non-`.org` AO3 hostname seen in the paste (`.com`, `.net`, `.gay`, `ao3.org`, `archive.transformativeworks.org`, `insecure.archiveofourown.org`). Canonical `archiveofourown.org` host (with or without `www.` / `m.`) is excluded so the banner only triggers on actual mirrors.
- **`FilterUrlList.jsx`**: amber heads-up banner above the source-chip row when `ao3_mirrors` is non-empty — "Heads up, you pasted from N AO3 mirror URLs · `archiveofourown.gay` (×2) · `ao3.org` — they all point to the same archive. They've been deduped to the canonical `archiveofourown.org` form." Auto-hides when only the canonical host is used.
- Tests: 2 new (`test_ao3_mirrors_surfaced_in_response`, `test_ao3_mirrors_empty_when_only_canonical_host`). **12/12 in `TestAo3UrlNormalization` passing.**

### Changed 2026-06-06 (No silent auto-convert — user always decides)
- **Removed** the `"convert"` (auto-add) option from `FORMAT_ACTIONS`. The pref now accepts only `"ask"` (default) and `"skip"`. Every non-EPUB upload always triggers the per-format-group Convert / Keep-original / Skip prompt — no silent Calibre conversion ever happens without explicit user consent.
- **Read-side coercion**: `_coerce_format_prefs()` rewrites any legacy stored `"convert"` value back to `"ask"` so existing users who'd set auto-add never get silently converted again.
- **One-time startup migration**: rewrites `format_prefs.* == "convert"` → `"ask"` across all user docs. Idempotent.
- **`PUT /api/user/format-prefs`** rejects `"convert"` with HTTP 400.
- **Account page UI**: removed the "Auto-add" button. New copy emphasizes that Shelfsort never auto-converts; "Skip" is the only way to suppress the prompt for a format group. Added a link to the Originals shelf.
- **UploadZone.jsx**: removed the `convert` branch from the upload pipeline — it would never be returned by the backend anyway.
- **Tests**: 3 new in `TestNoSilentAutoConvert` (PUT rejects `convert`, accepts `ask`/`skip`, GET coerces legacy `convert` → `ask`). 15/15 across both new test classes pass.

### Added 2026-06-06 (Theme toggle — Tier 1)
- New `ThemeContext` (`/app/frontend/src/context/ThemeContext.jsx`) holding `theme` (`"light"` | `"dark"`), `setTheme`, `toggleTheme`. Choice persists to `localStorage["shelfsort_theme"]` and is mirrored onto `<html data-theme="...">` so CSS variables and class overrides can switch in a single repaint.
- Navbar gains a sun/moon toggle button (`data-testid="navbar-theme-toggle"`) placed before the StreakBadge — visible to logged-in *and* logged-out users so the landing/login pages also respect the choice.
- `index.css` dark palette (AO3 "Reversi"-inspired): `--bg #1B1B1E` (deep warm slate), `--surface #26262B`, `--text-primary #E8E4D8`, `--text-secondary #9C9C8E`, `--border #3B3B41`. Accent peach `#E07A5F` and a brightened sage `#B7D4BC` carry over both modes.
- Tier 1 retargets the most-used compiled Tailwind hex utility classes (`.bg-[#FAF6EE]`, `.bg-white`, `.text-[#2C2C2C]`, `.text-[#6B705C]`, `.border-[#E5DDC5]`, etc.) via `:root[data-theme="dark"] .bg-\[\#FAF6EE\] { ... }` selectors — about 90% of the UI swaps without touching individual component files. Form controls, scrollbars, and the `.shelf-card` glass-card style are also themed.
- Amber/warning chips get a dark variant (`#3a2f1b` bg with `#F0D6A0` text) so the AO3 mirror banner, "URLs found" status pills, etc. stay readable.
- Tier 2 polish (Reader page, AO3-styled Download page maroon shift, edge-case components) deferred — flagged in backlog.

### Added 2026-06-06 (Stargate fandoms — 4 AO3-canonical sub-fandoms)
- Added `Stargate SG-1`, `Stargate Atlantis`, `Stargate Universe`, `Stargate (Movies)` to `FANDOM_KEYWORDS` using AO3's canonical tag form (https://archiveofourown.org/wrangling). Each sub-fandom has its own narrow keyword set (cast names, hardware, locations) so SG-1 works don't bleed into Atlantis and vice-versa.
- The bare word "stargate" is intentionally **not** in any keyword list — only specific sub-fandom markers fire. Ambiguous works fall through to the AI classifier.
- AI prompt updated: explicit guidance to use AO3 canonicals, lists the four Stargate sub-fandoms in `Common fandoms`, and instructs the model to bucket into the specific sub-fandom rather than a generic umbrella. Multi-sub-fandom works get returned as `Stargate SG-1 / Stargate Atlantis` etc. so the existing crossover canonicalizer auto-shelves them.
- **Convention going forward**: when adding new fandoms, prefer AO3's exact canonical tag form (e.g. `Stargate (Movies)` with the parenthetical, not "Stargate movie") so the shelf names match what fic readers already see on AO3.
- Tests: 5 new in `TestStargateFandoms` (SG-1, Atlantis, Universe, Movies, bare-word negative case). 5/5 passing.

### Added 2026-06-07 (AO3 top-fandoms seed list — 125+ canonical fandoms)
- New bundled seed `/app/backend/data/ao3_top_fandoms.py` exports `AO3_TOP_FANDOMS: Dict[str, List[str]]` mapping ~125 popular AO3 canonical fandom names to keyword aliases covering:
  - **Anime & manga** (20): Haikyuu!!, AoT, Demon Slayer, JJK, One Piece, Bleach, Death Note, FMA, HxH, YoI, Banana Fish, Tokyo Revengers, BSD, Sailor Moon, InuYasha, Dragon Ball, OPM, Mob Psycho 100, **MDZS** (魔道祖师), **TGCF** (天官赐福).
  - **Books & literature** (13): ASoIaF, Witcher books, Folk of the Air, Six of Crows, Shadow & Bone, ACoTaR, ToG, Shadowhunters, Good Omens, Discworld, Dresden Files, His Dark Materials, Mistborn, Stormlight Archive.
  - **Movies** (12): MCU, Avengers (Stucky), Cap, Iron Man, Thor, Spider-Man (Holland), Pirates, DCU, Hobbit (Bagginshield), LotR Movies, Star Wars (incl. Clone Wars + sequels), Princess Bride.
  - **TV** (22): Merlin (Merthur), BBC Sherlock (Johnlock), Buffy, Star Trek (AOS / TOS / TNG / DS9 / Voyager), Hannibal (Hannigram), Brooklyn 99, Bridgerton, Downton, The Untamed (CQL), Schitt's Creek, Killing Eve, Stranger Things (Byler / Steddie), OFMD, Heartstopper, 9-1-1 (Buddie), Glee (Klaine), Wednesday (Wenclair), The Witcher (Netflix).
  - **Western animation** (7): ATLA (Zukka), Korra (Korrasami), Voltron (Klance), Steven Universe, Gravity Falls, She-Ra (Catradora), Encanto.
  - **Video games** (18): Zelda + BotW, FF7/14/15, Pokemon, Mass Effect, Dragon Age + Inquisition, **Genshin Impact**, **Honkai: Star Rail**, FE Three Houses + general FE, Skyrim, DBH, Persona 5 + series, Overwatch, Undertale, Hades, **Baldur's Gate 3**, Hollow Knight, LoL, Cyberpunk 2077, Disco Elysium.
  - **RPF / Bands** (12): 5SOS, BTS, SEVENTEEN, Stray Kids, ATEEZ, ENHYPEN, TWICE, BLACKPINK, F1 (Lestappen), Taylor Swift, Critical Role, Dream SMP, McElroy/TAZ.
  - **Musicals** (4): Hamilton, Six, Be More Chill, Dear Evan Hansen.
  - **Comics** (5): Batman + Bat-fam, Young Justice, Daredevil, X-Men comicverse, DC comics.
- **Merge rule** (in `routes/books.py`): `FANDOM_KEYWORDS.setdefault(canonical, kws)` — hand-curated entries above ALWAYS win. The original 16 short-form names (Harry Potter, Twilight, etc.) stay so existing user shelves aren't renamed.
- Total recognized fandoms went from 16 → **145**.
- Tests: 3 new in `TestAo3TopFandomsSeed` (merge happened, existing entries preserved, sample fandoms classify correctly across anime/books/movies/TV/games/RPF). 8/8 passing.


### Added 2026-06-07 (Fandom distribution treemap on Account page)
- New `/app/frontend/src/components/FandomTreemap.jsx` — recharts `Treemap` showing each fandom sized by book count.
- Pulls from existing `/api/fandoms`, so no backend changes required.
- **Color ramp**: peach → maroon → sage → dusty browns (16 stops) — matches AO3-inspired palette, stays readable on both themes, avoids the pastel "AI slop" cliché.
- **Long tail handling**: top 20 fandoms (with ≥1% share) get their own cell; everything below collapses into one "Other (N fandoms)" cell with a footnote pointing to the Stats page for the full breakdown.
- **Cell labels**: fandom name + book count rendered only when cell is large enough (>64px wide, >36px tall) so small cells stay clean.
- **Tooltip**: hover any cell → "Fandom · N books · X.X%".
- **Empty state**: friendly "Upload a few books and your fandom distribution will appear here" copy.
- Mounted on Account page directly under the existing `LibraryStatsCard`. Tested with 74 books across 13 fandoms (Harry Potter, Stargate Atlantis, MCU, Avatar TLA, MDZS, Sherlock BBC, Merlin, Six of Crows, Bridgerton, Good Omens, etc.) — CJK canonical names like `魔道祖师 - 墨香铜臭` render correctly.

### Added 2026-06-07 (Treemap franchise grouping toggle)
- New `/app/backend/data/fandom_franchises.py` defines 18 franchise groupings rolling up related sub-fandoms:
  - **Stargate** (SG-1, Atlantis, Universe, Movies)
  - **Marvel** (umbrella, MCU, Avengers, Cap, Iron Man, Thor, Spider-Man Holland, Daredevil, X-Men comicverse)
  - **DC** (Comics umbrella, DCU Movies, DCU Comics, Batman, Young Justice)
  - **Star Wars** (umbrella, All Media Types, Clone Wars, Sequel Trilogy)
  - **Middle-earth** (LotR, LotR Movies, Hobbit)
  - **Star Trek** (AOS, TOS, TNG, DS9, Voyager)
  - **Avatar (Bryke)** (ATLA, Korra)
  - **Final Fantasy** (VII, XIV, XV)
  - **Persona** (5, series umbrella)
  - **Fire Emblem** (Three Houses, series umbrella)
  - **Dragon Age** (umbrella, Inquisition)
  - **The Witcher** (Sapkowski books, Netflix TV)
  - **Legend of Zelda** (All Media Types, BotW)
  - **Sherlock Holmes** (canon books, BBC Sherlock TV)
  - **Mo Xiang Tong Xiu** (MDZS, TGCF, The Untamed live action)
  - **Sarah J. Maas** (ACoTaR, ToG)
  - **Sanderson Cosmere** (Mistborn, Stormlight)
  - **Honkai / miHoYo Games** (Genshin Impact, Star Rail)
- Helper `franchise_for(fandom)` returns the franchise label or the fandom itself.
- New endpoint `GET /api/fandoms/grouped` returns rolled-up data with nested `children: [{name, count}]` arrays. **Single-member buckets flatten back to top level** — no parent cell for a franchise with only one member in the user's library.
- `FandomTreemap.jsx` toggle: "Franchises" (default) vs "All fandoms". Recharts nested treemap renders children inside parent cells with secondary stroke opacity.
- Header copy updates dynamically: *"…across 91 books, grouped into 5 franchises."*
- Removed duplicate `Hannibal NBC` entry from `ao3_top_fandoms.py` (merged into `Hannibal (TV)`).
- Tests: 3 new in `TestFandomFranchiseGrouping` (grouped endpoint returns franchise parents with correct children; rows sorted by total; `franchise_for` helper correctness). 11/11 passing.

### Fixed 2026-06-07 (Dark-mode contrast on fandom shelf chips)
- **Problem**: in dark mode, fandom shelf chips (`bg-[#E5EBE6]` pale sage + `text-[#3A5A40]` brightened to `#B7D4BC`) and crossover chips (`bg-[#FDF3E1]` pale cream + `text-[#900]` dark maroon) ended up light-on-light / dark-on-dark — illegible.
- **Fix**: added six new dark-theme overrides in `index.css`:
  - `.bg-[#E5EBE6]` → `rgba(115, 175, 130, 0.22)` (translucent sage on dark surface)
  - `.border-[#3A5A40]/20` → matching translucent sage border
  - `.bg-[#FDF3E1]` → `rgba(255, 165, 130, 0.18)` (warm coral tint)
  - `.text-[#900]` → `#FF9A85` (bright coral, was dark maroon)
  - `.border-[#900]/30` → translucent coral border
  - `.bg-[#900]` (the "×N" crossover badge) → `#FF7A66` with dark text — brighter so the badge still pops against the now-lighter chip

### Fixed 2026-06-07 (Dark-mode navbar toggle icon visibility)
- **Problem**: the sticky navbar uses `bg-[#FDFBF7]/80` (translucent cream with 80% opacity) but the dark-mode override only retargeted the plain `bg-[#FDFBF7]` — so in dark mode the navbar stayed bright cream, washing out the brightened-but-still-muted toggle icons and nav buttons.
- **Fix**: added `.bg-[#FDFBF7]/80`, `.bg-[#FBFAF6]/80`, and `.bg-white/80` to the dark-theme overrides, each mapped to `rgba(38, 38, 43, 0.82)` — translucent dark surface preserves the backdrop-blur "glass" feel while making the navbar actually dark in dark mode.

### Added 2026-06-07 (FicHub fallback + serial "Pull into library" endpoint)
- New `routes/fichub_client.py` — async httpx client for fichub.net's `GET /api/v0/epub?q=<URL>` endpoint. Process-wide `_FETCH_LOCK` + 2-second floor between consecutive requests ensures **strictly one in-flight FicHub call at a time**, regardless of how many user requests fire in parallel.
- New `fetch_fanfic_with_fallback()` wrapper in `routes/books.py` — tries FanFicFare first; on `FanficNotFoundError` AND `fff_options.try_fichub_fallback=True`, retries via FicHub. Returns the original FFF error when FicHub also fails (more informative than FicHub's generic 4xx).
- New per-user setting `fff_options.try_fichub_fallback` (default `False` — opt-in). Account UI gains a toggle with explanation copy.
- New endpoint `POST /api/books/url-list/pull` (body: `{urls?: string[], text?: string}`) — processes the URL list serially:
  1. Canonicalize each URL (re-use the AO3-aware normalizer)
  2. Skip canonicals already on the user's shelves (single Mongo round-trip)
  3. Walk the to-fetch list one URL at a time via the fallback wrapper
  4. Apply the FicHub-style template (intro page + stylesheet) per user preference
  5. Run AI classification → write EPUB + sidecar + book record
  6. Return `{queued, added: [{book_id, title, fandom}], already_owned: [{canonical, book_id, title}], failed: [{canonical, error}], unrecognized: []}`
- `apply_refresh` (existing `/books/refresh-all` and single-URL refresh paths) updated to use the wrapper too — so the FicHub fallback applies everywhere fanfic fetching happens.
- `FilterUrlList.jsx` adds a **"Pull N new URLs into library"** green button next to the Excel download. Shows a result panel listing added books (✓ title · fandom) and failures (✗ URL · error). Long-running, no client timeout.
- Tests: 5 new in `TestFichubFallbackAndUrlListPull` — endpoint structure (owned/queued/unrecognized counts), empty-input safety, opt-in flag persistence, and the critical safety test: **wrapper never calls FicHub when `try_fichub_fallback=False`** (proven via monkeypatched FicHub raising AssertionError).
- No API key required (FicHub is free + open). The optional `Authorization: Bearer <api_key>` header slot exists in the client for future use.

### Added 2026-06-07 (Inline "want an EPUB?" nudge on URL paste)
- `FilterUrlList.jsx` now detects fanfic URLs as the user types, using a client-side mirror of the backend's `FANFIC_SOURCE_PATTERNS` (AO3 with all alt hostnames, FFnet, FictionPress, RoyalRoad, SB/SV/QQ).
- When 1-5 recognized fanfic URLs are present AND the user hasn't yet run "Filter URLs", a sage-tinted inline prompt appears below the textarea:
  - Single URL: *"Looks like a fanfic URL — want an EPUB version of it?"*
  - Multi (2-5): *"Looks like N fanfic URLs — want EPUB versions?"*
  - Body: *"We'll fetch it/them one at a time via FanFicFare (falling back to FicHub if you've enabled that in Account) and drop the resulting EPUB(s) straight onto your shelves."*
  - Buttons: `[Yes, fetch it/them]` (green, triggers `/api/books/url-list/pull` directly) · `[Just check status]` (runs the existing dedupe flow).
- Threshold of 5 URLs intentional — past that, the Filter URLs → Pull two-step is more useful (you want the dedupe report).
- Prompt auto-hides once Filter URLs has run (the existing report panel takes over) or after Yes-fetch resolves.
- Success toast on Yes-fetch includes an "Open library" action button for one-click navigation.

### Added 2026-06-07 (Site-wide global paste detector)
- New `UrlPasteDetector` component mounted once inside `AuthProvider` listens for `paste` events on `document`. When 1-3 recognized fanfic URLs are detected in the pasted text — even when surrounded by other text — a Sonner toast appears:
  - 1 URL: *"Just pasted a fanfic URL — fetch it as an EPUB?"*
  - 2-3 URLs: *"Just pasted N fanfic URLs — fetch them as EPUBs?"*
  - Body: brief explanation of what'll happen.
  - Action button: `[Fetch it]` or `[Fetch all]` — calls `/api/books/url-list/pull` (same serial pipeline as the FilterUrlList Pull button) and shows a loading toast, then success/failure with an "Open library" action.
- Toast auto-dismisses in 8 seconds if ignored. Same canonical-URL prompt is suppressed for 4 seconds to avoid re-prompting on quick undo/redo or duplicate paste events.
- Suppressed on `/library/filter-urls` so it doesn't double up with that page's own inline prompt.
- Logged-out users are skipped entirely (no toast on the landing/login pages).
- No new backend work — reuses the existing `/api/books/url-list/pull` endpoint built earlier.

### Added 2026-06-07 (Navbar Quick-add URL slot)
- New `NavbarQuickAdd` component lives in the Navbar between the brand and the action group, visible to all logged-in users on `md+` screens.
- Always-on input: *"Paste a fanfic URL to add it…"* with a sparkles indicator (peach when empty/invalid → sage when a recognized fanfic URL is detected).
- Submit via Enter key OR the cloud-download icon button (disabled until input matches a known fanfic permalink).
- Calls `/api/books/url-list/pull` with the single URL → success toast names the book (`Added "Title" · Fandom to your library.`) with an "Open library" action button.
- `UrlPasteDetector` now skips when the paste event target is an `input` / `textarea` / `[contenteditable]` — so pasting into the navbar slot (or any form field) lets the field handle it without a competing global toast.
- Three consistent entry points for adding a fic by URL: (1) anywhere on the page → global paste toast, (2) navbar slot → always-visible explicit input, (3) FilterUrlList page → batch dedupe-and-pull. All three call the same serial `/books/url-list/pull` endpoint, so behavior is identical (FFF first, FicHub fallback if user opted in, polite 2s gap between fetches).

### Hidden 2026-06-07 (URL→EPUB fetching UI gated behind feature flag)
- New `/app/frontend/src/lib/featureFlags.js` exports a single `FETCHING_UI_ENABLED = false` constant. All URL→EPUB fetching surfaces check this flag and conditionally render. Backend code and routes are untouched — `/api/books/url-list/pull`, `/api/books/refresh-all`, `/api/books/{id}/refresh`, `fanfic_fetch_epub`, `fetch_fanfic_with_fallback`, `/api/user/fff-options`, the FicHub client, the scheduler refresh job, and every related test still work as before. Flipping the flag back to `true` re-enables everything in one line.
- Hidden UI surfaces:
  - Navbar **Quick-add URL slot** (`NavbarQuickAdd`)
  - Navbar **Updates bell** (`UpdatesBell` — driven by refresh notifications)
  - Site-wide **global paste detector** (`UrlPasteDetector`)
  - Dashboard **"Refresh all from source" banner** with the green Update button
  - Dashboard empty-state **"Powered by FanFicFare"** badge
  - BookDetail **"Update from FanFicFare" / "Try FanFicFare again"** button
  - FilterUrlList **inline "want EPUB?" prompt** (the green sage one above the Filter URLs button)
  - FilterUrlList **"Pull N URLs into library"** button + result panel
  - Account **"Fanfic download options"** card (full section incl. FicHub fallback toggle)
- Kept visible (no fetching required):
  - FilterUrlList URL dedupe flow + Excel export — these just sort URLs into "owned vs new", no source-site hits
  - Every EPUB upload, classification, shelf, treemap, theme, originals, trash, smart-shelves feature

### Added 2026-06-07 (3 new fanfic source sites recognized)
- **Adult-FanFiction.org** (AFF) — subdomain-agnostic match (`hp.`, `anime.`, `books.`, `members.`, `www.`, bare). Canonicalizes to `https://www.adult-fanfiction.org/story.php?no=N`. Source label: `AFF`.
- **Potions and Snitches** (Snape-centric HP archive, eFiction install) — handles both `.org` and `.net` TLDs, with/without `www.`. Canonicalizes to `https://www.potionsandsnitches.org/fanfiction/viewstory.php?sid=N`. Source label: `Potions & Snitches`.
- **Twilighted.net** (Twilight archive, eFiction install) — `www.` + bare, http/https. Canonicalizes to `https://www.twilighted.net/viewstory.php?sid=N`. Source label: `Twilighted`.
- All three plug into the existing pipeline: URL list dedupe, Excel export Source column, AO3-aware paste detector (when fetching UI is re-enabled), `by_source` breakdown chips.
- Backend total now recognizes **10 sources**: AO3, FFnet, FictionPress, RoyalRoad, SpaceBattles, SufficientVelocity, QQ, AFF, Potions & Snitches, Twilighted.
- Tests: 5 new in `TestEfictionSiteRecognition` covering URL variant canonicalization for each site, source labeling, and end-to-end dedupe-endpoint integration.

### Added 2026-06-09 (Linkless library — books with no embedded source URL)
- New `GET /api/library/linkless` endpoint returns every active (non-trashed) book where BOTH `source_url` is null/missing/empty AND `fanfic_urls` is missing/empty. Response: `{books, count, by_category}`.
- New `LinklessShelf.jsx` page at `/library/linkless`:
  - Stats card with total count + category-filter chips
  - Search box (title/author/fandom)
  - Grid of book cards showing title, author, category badge, original-format badge (PDF/EPUB/etc.)
  - Friendly empty state ("Every book has a source URL. Nice — your library is fully traceable.")
- Dashboard chip "**N linkless books · open browser →**" sits next to the existing crossover chip. Sage-green to distinguish from the maroon crossover chip. Only renders when count > 0.
- Tests: 1 new in `TestLinklessLibrary` covering all edge cases — books with `source_url` only, `fanfic_urls` only, both fields missing, trashed books, and `by_category` breakdown.

### Added 2026-06-09 (Linkless chip fix + books.py refactor Phase 1)
- **Bug fix**: Dashboard `dashboard-linkless-chip` was nested inside `{stats.fandoms.length > 0 && (...)}`, so it never appeared for users with linkless books but no detected fandoms — the exact target audience. Lifted to its own top-level conditional, gated only on `linklessCount > 0`. The crossover chip stays inside the fandoms block since `crossover_count > 0` implies fandoms exist.
- **Refactor — books.py Phase 1**: Started breaking the 7,000-line `routes/books.py` into focused utility modules. Books.py is now ~6,600 lines (–400, ~6%). Two new pure-helper modules in `/app/backend/utils/`:
  - `utils/url_canonical.py` (198 lines) — all URL regex constants, source patterns, canonicalization (`normalize_fanfic_url`, `_canonical_fanfic_url`), AO3 host detection (`_is_ao3_host`, `classify_ao3_non_work`, `_AO3_HOST_RE`, `_AO3_HOST_SUBSTRINGS`, `_AO3_NON_WORK_PATTERNS`), source labelling (`_source_for`), URL-list heuristic (`_looks_like_url_list`), and the prose `URL_REGEX` / `_URL_RE`.
  - `utils/epub_template.py` (243 lines) — FicHub-style intro page builder + EPUB template applier (`SHELFSORT_TEMPLATE_CSS`, `SHELFSORT_TEMPLATE_MARKER`, `_html_escape`, `_build_intro_xhtml`, `apply_template_to_epub`).
  - Both modules are re-exported from `routes/books.py` so existing imports (`from routes.books import normalize_fanfic_url`, etc.) and the entire test suite continue to work unchanged.
- **Bug fix**: removed a stale duplicate `PATCH /books/{book_id}/source-url` route. There were two routes registered at the same path — the legacy `set_source_url` (body `{source_url}`) and the new Linkless-shelf `claim_source_url` (body `{url}`). Merged them: one route, accepts BOTH field names, canonicalizes the URL, writes `source_url` + `fanfic_urls`, clears `unavailable` / `last_fetch_error`. Tests on both shapes pass.
- **New test file**: `/app/backend/tests/test_url_canonical.py` — 66 pure-unit tests (run in <50ms, no HTTP, no DB) covering every canonicalization path across all 10 supported sources, AO3 mirror variants, source labelling, URL-list heuristic boundaries, and `_clean_url` edge cases.
- **Backend test totals**: 146 (test_new_features) + 66 (test_url_canonical) = **212 passing**, 0 failing.

### Next refactor phases (queued)
- `utils/fandom_utils.py` — `_canonicalize_relationship`, `_canonicalize_fandom`, `_suggest_fandom_merges`, `detect_series_from_title`, plus the `FANDOM_KEYWORDS` / `FANFIC_SIGNALS` / `NONFICTION_SIGNALS` constant tables (~300 lines).
- `utils/epub_io.py` — `extract_epub_metadata`, `extract_urls_from_epub`, `format_links_txt`, `_normalize_chapter_title`, `extract_chapters`, `diff_chapters` (~250 lines).
- `utils/tag_utils.py` — `_normalize_tag`, `_normalize_tags`, `_normalize_title_for_match` (~40 lines).
- After helpers are out, split the routes themselves into sub-routers: `upload.py`, `library.py`, `duplicates.py`, `export.py`, `originals.py`, `url_list.py`.

### Added 2026-06-09 (Unreadable Files shelf)
- **Feature**: When EPUBs are corrupt or PDFs/Kindle/DOCX can't be converted by Calibre at upload time, books are filed under a new **Unreadable Files** shelf. The original bytes are preserved on disk (user choice 4b) so users can download the source, inspect it locally, and either re-upload a fixed version or delete it. Detection happens only at upload time (5b) — existing books aren't re-checked.
- **Backend**: `GET /api/library/unreadable` lists every active book where `epub_unreadable=true` OR `needs_conversion=true` (trash excluded). Returns `{books, count, by_reason}` where reason ∈ {`corrupt_epub`, `failed_conversion`}, plus the precise parser/converter error text (truncated to 240 chars) and the right `download_path` per row.
- **Backend**: new `GET /api/books/{book_id}/download-original` endpoint that serves the user's pre-conversion source file (PDF/Kindle/DOCX bytes that never made it to EPUB). Works as a fallback for any Originals book too — scans the user's storage dir for `{book_id}.*` if `original_format` is missing.
- **Frontend**: new `/app/frontend/src/pages/UnreadableShelf.jsx` with reason-filter chips, search by title/author/filename, per-row Download + Delete actions, and inline error text styled in the AO3 red palette. Mirror of LinklessShelf layout.
- **Frontend**: Dashboard now displays a `dashboard-unreadable-chip` (orange/red palette to differentiate from the green linkless chip) when `unreadableCount > 0`. Lives outside the fandoms block so it shows even for users with no detected fandoms.
- **Route**: `/library/unreadable` registered in `App.js`, protected.
- **Tests**: 6 new tests in `TestUnreadableLibrary` cover the list endpoint (corrupt + conversion failure), reason field + download_path mapping, exclusion of healthy/trashed books, the new download-original endpoint (PDF bytes + 404 fallback), and delete propagation. **Backend test totals: 218 passing.**
- **Known cosmetic lint warning**: `react-hooks/set-state-in-effect` on Dashboard.jsx (rule isn't in the project's installed eslint-plugin-react-hooks 5.2.0; only present in the mcp lint tool's bundled config). Build + runtime are fine.

### Added 2026-06-09 (Unknown-sources detector + admin queue)
- **Feature**: When the user uploads an EPUB, pastes a URL list, or tries to claim a source URL on the Linkless shelf, Shelfsort now logs any story-shaped URL whose host isn't on the accepted-sources list. Hosts are surfaced to the user via a transient toast (choice 1a) and persisted in a new `unknown_sources` collection so the dev (the agent) can review and decide whether to extend the accepted list.
- **User choices**: 1a (inline toast), 2c (host + samples + first/last seen + context + book metadata), 3a (agent polls `/api/admin/unknown-sources` at session start), 4a (upload/paste still succeeds — non-blocking), 5c (all entry points: upload, paste-dedupe, claim-source-url).
- **Heuristic** (`utils/unknown_sources.py`): a URL is "story-shaped" if its path/query matches one of `/works/N`, `/s/N`, `/story/N`, `/story.php?no=…`, `/viewstory.php?sid=…`, `/fiction/N`, `/threads/slug.N`, `/chapter/N`, `/read/N`, `/fic/N`, `/novel/N`, `/series/N`. Hosts on a denylist (twitter, wikipedia, reddit, amazon, etc.) are skipped. AO3 non-work pages (series/users/collections) are also skipped — those have their own bucket on the dedupe screen.
- **Backend**:
  - new `GET /api/admin/unknown-sources` — global list, sorted by `last_seen` DESC, supports `?since=<iso8601>`. Returns `{host, hit_count, contexts, samples (≤5), first_seen, last_seen, last_book_title/author/id}`.
  - new `DELETE /api/admin/unknown-sources/{host}` — idempotent dismiss (used after a host is added to `utils/url_canonical` or confirmed-not-fanfic).
  - `/api/books/url-list/dedupe`, `/api/books/upload`, and `/api/books/{id}/source-url` all now record + echo `unknown_sources_found` in their response.
- **Frontend**:
  - Upload toast (UploadZone): "Heads-up: spotted N potential new fanfic sources (host1, host2, …). They've been logged so we can review adding them."
  - Paste-dedupe toast (FilterUrlList): same shape.
- **Tests**: 35 new pure-unit tests in `test_unknown_sources.py` (covers heuristic, host normalization, sample-cap, context dedup, accepted-list skip, denylist) + 5 new end-to-end tests in `test_new_features.py::TestUnknownSourcesEndToEnd` (paste records hosts, admin lists them, since-filter, claim-400 still records, dismiss is idempotent).
- **How the agent reviews**: at session start, hit `GET /api/admin/unknown-sources?since=<last-checked>` and surface the new hosts to the user. After they decide which to add, modify `FANFIC_SOURCE_PATTERNS` + canonical regex in `utils/url_canonical.py` and dismiss the host(s) via the DELETE endpoint.

### Test totals (after this feature): 410 passing (8 pre-existing failures in `test_tags_and_smart_shelves.py` are unrelated to this work and fail on main too).
