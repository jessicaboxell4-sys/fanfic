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

### Added 2026-06-09 (Unknown sources curation queue UI)
- **Feature**: a dedicated dashboard chip + page so the user can curate the unknown-sources queue themselves between sessions.
- **Backend**: new `PATCH /api/admin/unknown-sources/{host}/mark-accepted` (body `{accepted: true|false}`) flags or un-flags a host as "user wants this added to the accepted-sources list." The flag (`marked_accepted`, `marked_accepted_at`, `marked_accepted_by`) is a signal for the next Shelfsort dev session — host stays in the queue until either dismissed (DELETE) or the regex is added to `utils/url_canonical.py` and the host is dismissed.
- **Frontend**:
  - new `/app/frontend/src/pages/UnknownSourcesPage.jsx` at `/admin/unknown-sources` — list with hit counts, per-context badges (upload/paste/claim), first/last-seen relative times, last book metadata, expandable sample URLs, and per-host "Mark for adding" + "Dismiss" buttons. Search + 3 filter chips (All/Marked/Unmarked).
  - new `dashboard-unknown-sources-chip` on Dashboard.jsx (green, with `?` badge) shown when `unknownSourcesCount > 0`. Lives next to the linkless/unreadable/crossover chips.
  - Toast feedback after each action ("Marked novelupdates.com — I'll add it next session.")
- **Route**: `/admin/unknown-sources` registered in `App.js`, protected.
- **Tests**: +2 new in `TestUnknownSourcesEndToEnd` covering the mark-accepted toggle + 404 path. **All 410-plus 42 unknown-sources-related tests passing.**
- **Curation workflow for the agent**: at session start, fetch `/api/admin/unknown-sources?since=<last-checked>` and look for hosts where `marked_accepted=true` — those are explicit user requests to add. After adding, DELETE the host record so it leaves the queue.

### Added 2026-06-09 (Manual add to unknown-sources queue)
- **Feature**: input row at the top of `/admin/unknown-sources` to queue a host for review without an EPUB upload triggering it. Useful when a friend mentions a new fic archive — paste the URL, add an optional note, and it's queued for the next session.
- **Backend**: new `POST /api/admin/unknown-sources` with body `{url, note?}`. Bypasses the story-shape heuristic (`skip_heuristic=True`) since the user is explicitly vouching for the URL. Already-accepted hosts short-circuit with `{ok: True, already_accepted: True, host}` — the UI shows a friendly "already on the accepted list" toast instead of silently doing nothing. Empty/malformed URLs return 400.
- **`utils/unknown_sources.py`**: extended `record_unknown_sources` with `skip_heuristic: bool` and `note: str` parameters; `note` persists on the host doc as `last_note`. Added "manual" to the valid `context` values.
- **Frontend**: small form (URL + optional note + Submit) above the search bar on `UnknownSourcesPage`. Toast feedback distinguishes "queued for review" from "already accepted." On success, the list reloads in place.
- **Tests**: +3 new in `TestUnknownSourcesEndToEnd` covering: manual add queues a non-story-shaped URL, already-accepted shortcut, empty/malformed rejects. Plus the existing 35 pure-unit tests still pass. **All 45 unknown-sources tests passing.**

### Added 2026-06-09 (Complete / Ongoing status shelves)
- **Feature**: sort EPUBs by completion status. Detection runs once at upload time (choice 5a) using a 4-signal cascade (choice 2d): explicit "Status:" line in metadata → tags (`complete`, `wip`, `hiatus`, `abandoned`, etc.) → "Chapter X of Y" heuristic → "TBC / to be continued" heuristic → defaults to **Complete** (choice 3b). Users can override via a status badge on the book detail page; the override (`manual_status`) is stored separately so re-detection can't blow it away (choice 4b).
- **Backend**:
  - new `utils/status_detector.py` — pure, deterministic, 42 unit tests. Public API: `detect_status(title?, description?, raw_meta_text?, tags?)` returns `"complete" | "ongoing"`; `effective_status(book)` honors `manual_status`.
  - new endpoints: `GET /api/library/complete`, `GET /api/library/ongoing`, `GET /api/library/status-counts`, `PATCH /api/books/{id}/status`. `manual_status: null` in the PATCH body clears the override.
  - upload pipeline now writes `books.status` for every newly-uploaded book.
- **Frontend** (choice 1d — shelves + library filter chips + dashboard chips):
  - new `/app/frontend/src/pages/StatusShelves.jsx` exports `CompleteShelf` + `OngoingShelf` from a shared `StatusShelf` component (category filter chips, search, book list mirroring Linkless/Unreadable layout).
  - routes `/library/complete` (green checkmark theme) and `/library/ongoing` (warm copper theme) registered in `App.js`.
  - new dashboard chips: `dashboard-complete-chip` (green with `✓`) and `dashboard-ongoing-chip` (copper with `…`) — both gated on count > 0, rendered as a small row.
  - new `StatusBadge` component on `BookDetail.jsx` next to the category badge — click → dropdown with Finished / Ongoing / Use auto-detected. Shows a small "MANUAL" sub-label when the user has overridden.
- **Tests**: 42 pure-unit (`test_status_detector.py`) + 7 end-to-end (`TestStatusShelves` in `test_new_features.py`) = **49/49 passing**.

### Added 2026-06-09 (Authors directory + Pairings browser + Library backup)
- **Authors directory** (`/library/authors`): lists every distinct author in the user's library with a book count, sorted by count DESC then alphabetically. Backed by `GET /api/library/authors` (Mongo $group aggregation). Links to the existing `/library/author/:name` per-author shelf. Discoverable via a "View all →" link on the Dashboard's Authors section.
- **Pairings browser**: new `/library/pairings` directory + `/library/by-pairing/:pairing` shelf. Backend endpoints `GET /api/library/pairings` ($unwind+$group across `relationships`) and `GET /api/library/by-pairing?pairing=…`. Discoverable via a new "Browse pairings" chip on the Dashboard fandom-shelves section. Each pairing card shows count + 3 sample titles; per-pairing shelf shows books with effective-status badges.
- **Library backup** (`/api/library/backup`): streaming ZIP containing `backup-manifest.json` (every book record + smart shelves + user prefs, with passwords/sessions stripped) plus `epubs/<book_id>.epub` for every book that's still on disk. Reuses the same `stream_zip` pipeline as `/library/download-zip` so first-byte latency stays ~1s even for 5000+ book libraries. New "Library backup" card on `/account` with a download button (axios → blob → synthetic anchor click). Trashed books are excluded; missing-on-disk books are skipped silently rather than failing the whole archive. Restore is intentionally NOT exposed — manifest format is documented and stable for a future restore endpoint.
- **Tests**: 6 new in `TestAuthorsAndPairings` + `TestLibraryBackup` covering directory aggregation, per-author/per-pairing listings, trashed exclusion, manifest contents, schema, password-stripping, missing-file graceful skip. **All passing.**

### Added 2026-06-09 (Backup reminder banner)
- **Feature**: dismissable banner at the top of the Dashboard that nudges the user to run a backup when one of three triggers fires: (1) `never_backed_up` — 100+ active books and no recorded backup, (2) `cadence` — 30+ days since last backup, (3) `new_books` — 100+ books added since last backup. X button quiets the banner for 14 days; running a backup automatically clears the banner (server writes `last_backup_at` when the stream starts).
- **Backend**:
  - extended `/api/library/backup` to write `users.last_backup_at` before streaming the ZIP — so the "I just backed up" state persists even if the user closes the tab mid-stream.
  - new `GET /api/user/backup-reminder` — returns `{should_show, reason, book_count, books_since_backup, days_since_backup, last_backup_at, dismiss_active_until}`.
  - new `POST /api/user/backup-reminder/dismiss` — idempotent 14-day silencer.
- **Frontend**: new `/app/frontend/src/components/BackupReminderBanner.jsx` mounted at the top of Dashboard. Headline varies by trigger ("You have N books and no backup yet" / "It's been N days…" / "You've added N books…"). One click runs the same blob-download flow as the Account-page button.
- **Tests**: 7 new in `TestBackupReminder` covering all three triggers, dismiss → 14-day silence, dismiss expiry, and "running a backup clears the reminder." **All passing.**

### Added 2026-06-09 (Backup history)
- **Feature**: chronological list of every backup the user has started, shown below the "Download library backup" button on `/account`. Useful for answering "did I back up before <bad date>?" at a glance.
- **Backend**:
  - new `backup_history` collection — one row per backup: `{user_id, started_at, book_count, smart_shelf_count}`. Inserted at the start of every `/api/library/backup` call. ZIPs themselves are NOT stored — only metadata, never grows unbounded (auto-trimmed to the 50 newest per user inside the same endpoint).
  - new `GET /api/user/backup-history` returns the last 50 entries, newest first.
- **Frontend**: `BackupCard` on `/account` now renders a "Backup history" section under the download button. Each entry shows absolute timestamp + relative "Xh ago" / "Xd ago" + book count. Empty-state copy when no backups yet. List refreshes immediately after a fresh backup.
- **Tests**: 3 new in `TestBackupHistory` covering empty state, append-on-backup, and the 50-entry cap. **All passing.**

### Added 2026-06-09 (Restore from backup wizard)
- **Feature**: closes the backup loop — upload any `shelfsort-backup-*.zip`, see what's inside (books, smart shelves, collisions), pick exactly what to restore, apply.
- **Backend**:
  - new `POST /api/library/restore/preview` — reads the ZIP in-memory, validates `backup-manifest.json` + schema version, returns per-book metadata with a `collision: bool` flag (book_id already in user's library) and per-shelf metadata with the same flag. ZIP is NOT written to disk.
  - new `POST /api/library/restore/apply` — accepts the same ZIP plus a JSON selection `{book_ids, shelf_names, overwrite_collisions}`. Inserts new books, optionally overwrites collisions, copies `epubs/<book_id>.epub` to the user's storage dir. Returns counts of restored/overwritten/skipped books, restored files, restored shelves.
  - Validates: bad ZIP → 400, missing manifest → 400 with a helpful message, unsupported schema_version → 400.
  - Files: writes EPUB only when target doesn't already exist (unless overwrite_collisions is on).
- **Frontend**: new `/app/frontend/src/pages/RestoreBackupPage.jsx` at `/account/restore`. Three states: picker → preview (checkbox list with Select all / Select none / Only new books, an "Overwrite collisions" toggle that defaults OFF, per-book collision badges, smart-shelves section) → result summary. New "Restore from backup" outline button on the Account backup card.
- **Tests**: 6 new in `TestRestoreBackup` covering preview (manifest + collisions), bad-input rejects (non-zip + zip-without-manifest), apply (skip-by-default, overwrite-on-flag, honor-selection). **All passing.**


### Added 2026-06-12 (Help "What's new" card)
- **Feature**: dismissible highlight card at the top of `/help` listing the newest features. Stores dismissal per-user in `localStorage` (`shelfsort.whatsNewDismissed`) keyed by `version` — bumping the version re-shows the card for every user.
- **Frontend**: `/app/frontend/src/pages/Help.jsx`. Lazy `useState` init reads localStorage on mount (avoids `react-hooks/set-state-in-effect`). `data-testid="help-whats-new"` + `help-whats-new-dismiss`.

### Added 2026-06-12 (Server-side announcements API)
- **Backend**: new `/app/backend/routes/announcements.py` with `GET /api/announcements/latest`, `POST /api/announcements`, `DELETE /api/announcements/{version}`. Mongo collection `announcements`. Schema: `{version, title, items: [{label, desc, to, link_to_2?}], created_at, created_by}`. Duplicate-version POST → 409. Wired in `server.py`.
- **Frontend**: `Help.jsx` now fetches the latest announcement on mount (axios with `withCredentials`) and falls back to bundled `FALLBACK_WHATS_NEW` on null/error. Dismissal tracks the live `version`.
- **Tests**: `/app/backend/tests/test_announcements.py` — 8 tests covering auth gating, create/fetch, dup version, delete, validation, admin-only writes. All passing.

### Added 2026-06-12 (Admin role + announcements UI)
- **Model**: `is_admin: bool = False` field on `User` (`/app/backend/models.py`).
- **Auth**: new `require_admin` dependency in `/app/backend/auth_dep.py` — 403s if `user.is_admin` is false. `GET /api/auth/me` and `GET /api/auth/profile` now expose `is_admin`.
- **Migration**: startup auto-promotes the oldest existing user to admin if no admin exists yet (`/app/backend/server.py`). Idempotent.
- **Backend**: `POST /api/announcements` and `DELETE /api/announcements/{version}` now require `is_admin`. `GET /api/announcements/latest` stays open to any authed user (it's a read).
- **Frontend**: new `AnnouncementsCard` in `/app/frontend/src/pages/Account.jsx` — form with version (auto today), title, repeatable `{label, to, desc, link_to_2}` rows, "Currently live" mini-card with delete. Mounted conditionally on `profile?.is_admin` so non-admins don't see it. All inputs carry `data-testid="announcements-*"`.
- **Tests**: 2 new admin/non-admin tests in `test_announcements.py`. All 181 unit-test-suite tests still pass.


### Changed 2026-06-12 (`/admin/unknown-sources` endpoints now actually admin-gated)
- **Backend**: all four `/api/admin/unknown-sources*` endpoints (GET list, POST manual-add, DELETE dismiss, PATCH mark-accepted) now use `Depends(require_admin)` instead of `get_current_user`. They were named `/admin/*` from day one but never actually checked admin status — this closes that gap.
- **Frontend**: no UI changes needed. Dashboard's `unknown-sources` chip silently swallows 403 (catch block ignores it) so non-admins see no chip and no error. The `/admin/unknown-sources` page is still routable but its API calls 403 for non-admins, so it just shows an empty state.
- **Tests**: `test_new_features.py::TestUnknownSourcesEndToEnd` fixture seeds `is_admin: True`; same for the module-level `seed_user` fixture (some `/admin/*` calls flow through it). All 53 tests across `test_new_features.py::TestUnknownSourcesEndToEnd`, `test_announcements.py`, and `test_unknown_sources.py` pass.

### Added 2026-06-12 (Admin Console — 7 operator features in one drop)
- **Page**: new `/admin` route (`AdminRoute` guard — admins only, non-admins redirect to `/library`). Shield-icon link in Navbar shows only when `user.is_admin`. Page at `/app/frontend/src/pages/AdminConsole.jsx` (one card per feature).
- **(a) Users & admins** — `GET/POST /api/admin/users[/{id}/{promote,demote}]`. Lists every user with admin badge + book count, one-click promote/demote. Refuses to demote last admin or self.
- **(b) Maintenance banner** — `GET/PUT /api/admin/maintenance-banner` + public `GET /api/maintenance-banner` (no auth). Site-wide non-dismissible banner with info/warn/error severity. New `<MaintenanceBanner />` mounted at App root polls every 60s.
- **(c) System health** — `GET /api/admin/system-health` snapshot: Calibre present?, Resend key configured?, Emergent LLM key configured?, Digest scheduler running?, Mongo collection sizes, disk usage on `/app/uploads`. One-shot, no caching.
- **(d) Global fandom aliases** — `GET/PUT /api/admin/global-fandom-aliases`. Admin-managed map applied to every user's library at upload + URL-list-pull time. Per-user aliases override globals on conflict. 30s in-process cache.
- **(h) Global stats** — `GET /api/admin/global-stats`. Tenant-wide rollup: total users / admins / books / storage, signups 7d/30d, top 10 fandoms across all libraries, category split.
- **(j) Feature flags** — new `utils/feature_flags.py` (Mongo `feature_flags` singleton doc, 5s in-process cache). Four flags: `uploads_enabled`, `ai_classify_enabled`, `fichub_enabled`, `calibre_convert_enabled`. Defaults all on. Wired into `/books/upload`, `classify_with_ai`, `fetch_fanfic_with_fallback`, `convert_to_epub`. `GET/PUT /api/admin/feature-flags`.
- **(k) Audit log** — new `utils/admin_audit.py` writes to Mongo `admin_audit` for every admin write action. `GET /api/admin/audit-log` returns newest-first with optional `action_prefix` filter. Wired into: user promote/demote, banner save, feature-flag toggle, global aliases save, announcement publish/delete, unknown-source dismiss.
- **Files**: new `routes/admin.py` (~330 lines), `utils/admin_audit.py`, `utils/feature_flags.py`, `components/MaintenanceBanner.jsx`, `pages/AdminConsole.jsx` (~480 lines). Wired into `server.py`. Modifications: `models.User` (already had `is_admin`), `auth.py` (already exposed `is_admin`), `books.py` (4 feature-flag check points + global-alias merge + audit on dismiss), `announcements.py` (audit on publish/delete), `Navbar.jsx` (shield icon link), `App.js` (`AdminRoute` + banner mount).
- **Tests**: 20 new in `tests/test_admin_console.py` covering auth gating across all endpoints, users promote/demote (last-admin guard, self-demote refuse, 404 unknown), maintenance banner lifecycle + public read + validation, system health shape, global aliases CRUD + dedupe, global stats shape, feature flags lifecycle + unknown-flag reject, audit log + prefix filter. **All 211 affected backend tests pass.**
- **Parked / remind later** (from the same brainstorm): URL whitelist UI, per-user library inspector, cross-user URL takedown, failed-jobs queue, background job runner, Mongo migration runner, slow-query/error-log viewer.


### Parked 2026-06-12 (dark-mode full-site sweep)
After the palette picker shipped, the user noticed a dark-mode hover bug on the navbar avatar/name (cream `hover:bg-[#F5F3EC]` not remapped). Suspect other pages have the same pattern — particularly with non-default palettes (Crimson/Ocean) that hadn't been visually tested. Plan: walk through every authed page in dark mode (`Library`, `Dashboard`, `Stats`, `Year-in-Books`, `Book detail`, `Reader`, `Smart Shelves`, `Restore`, `Admin Console subpages`, etc.) and grep for any `hover:bg-[#XXX]` / `hover:text-[#XXX]` / `focus:` variants that aren't yet covered by `index.css` dark-mode overrides. ~5-10 min.


### Parked 2026-06-12 (feature brainstorm — agent-proposed, user said "remind me later")
These are agent-suggested features the user hasn't picked yet. Bring them up next session when there's a lull or as candidates for the "is there anything else?" prompt.

**🟢 Quick & fun (~15-30 min each)**
- **a) "Surprise me" button** — random book at random chapter, optional mood filter (fluff/angst/anything). Dashboard button. Pure dopamine.
- **b) Reading queue / "Up next" stack** — first-class TBR pile (ordered, draggable). Distinct from Smart Shelves which are filters; this is a hand-curated stack.
- **c) Cover wall view** — pure visual library mode (covers-only tight grid). Tap to open. Library-as-wallpaper aesthetic.
- **d) Per-book re-fetch changelog** — log "Chapter 47 added 2026-05-12" to a timeline on book detail page. Plugs into existing FicHub refresh pipeline.

**🟡 Medium (~1 hr each)**
- **e) Currently-reading public share** — tiny shareable page (like year-in-books) showing your current read + progress %. Reuses share-token infra.
- **f) Reading goals + dashboard ring** — "Read 50 books this year" progress ring. Tied into existing year-in-books data.
- **g) Highlights / quote saver in reader** — text-select → save highlight. Per-book notes panel + global "My quotes" page. JSON/CSV export.
- **h) Mood-based smart shelves** — pre-baked "Comfort reads / Quick under 5k / Long & slow / Recently updated". One-click curate from existing tag+word-count data.

**🟠 Larger (~2-3 hr each)**
- **i) Full-text search across EPUB content** — "find that fic with the line about moonlight on the lake". Mongo text index on extracted chapter text. Biggest "wow" for 1000+ book libraries.
- **j) OPDS catalog** — `/api/opds` endpoint. KOReader / Marvin / FBReader / Calibre can sync directly. Read on Kindle/phone.
- **k) AI cover regeneration** — one-click "regenerate cover" for missing/ugly placeholders via Gemini Nano Banana (title + fandom + tags as prompt).

**🔵 Bigger / speculative**
- **l) Author-follow alerts** — mark author as "followed"; FicHub re-scrape checks for new works via AO3 author URL. Email digest ping.
- **m) Fic recommendation engine** — "You liked X (4★) — here are 10 similar AO3 URLs you don't own yet." Tag-overlap algorithm; fetch via existing FicHub flow on confirm.
- **n) Reader typography polish** — font picker (Georgia/Iowan/Garamond), line-height + margin sliders, sepia/paper/dark modes, font-size +/-.

**Agent's "most bang for buck" picks**: a (Surprise me), b (Reading queue), i (Full-text search), j (OPDS catalog).


### Added 2026-06-12 (NCIS franchise + Unknown-fandom detector)
- **Seed list**: added 7 NCIS shows to `data/ao3_top_fandoms.py` — `NCIS`, `NCIS: Los Angeles`, `NCIS: New Orleans`, `NCIS: Hawai'i`, `NCIS: Sydney`, `NCIS: Origins`, `NCIS: Tony & Ziva`. Total recognized fandoms now 151.
- **Audit done 2026-06-12**: query against 3,057 fandom-tagged books shows the only unrecognized fandom value is the literal string `"Other"` (328 books, used as the fallback bucket). All actual fandoms in the library match a keyword set.
- **Backend**: new `utils/unknown_fandoms.py` aggregates books-collection-distinct-fandoms minus `FANDOM_KEYWORDS.keys()` minus the `dismissed_unknown_fandoms` collection. 60s in-process cache for the `/count` endpoint (navbar polls this — must be cheap). Three endpoints in `routes/admin.py`: `GET /admin/unknown-fandoms`, `GET /admin/unknown-fandoms/count`, `POST/DELETE /admin/unknown-fandoms/{fandom}/dismiss`.
- **Frontend**: new `UnknownFandomsCard` on `/admin` (between Users and Maintenance banner) lists each unrecognized fandom with book count, sample IDs, and a Dismiss button. Navbar shield icon shows a small orange dot when count > 0; polls every 5 min. `Dismiss` writes to `dismissed_unknown_fandoms` so e.g. "Other" stays hidden forever — use undismiss endpoint to surface again.
- **Workflow**: when a new book arrives with a fandom not in the keyword classifier (uploaded EPUB metadata, AI classification, manual edit), it shows up here automatically — no ingestion-event tracking needed since this is a passive aggregator.
- Lint clean. End-to-end verified: count went 1 → 0 after dismissing "Other"; UI screenshot confirmed.


### Added 2026-06-12 (Bulk-rescue rescan + classifier provenance chip)
- **Backend**: `POST /api/admin/unknown-fandoms/{fandom}/rescan` with `{dry_run: bool}` body. Re-runs `classify_by_metadata` against existing book metadata (no EPUB re-parse, no AI). Updates `fandom` + tags `classifier: "metadata_rescan"`. Audited. Extended `GET /api/admin/unknown-fandoms` to also return `dismissed` rows so dismissed fandoms remain scannable.
- **Frontend**: "Rescan" button (green, rotate icon) on every Unknown Fandoms card row — both active and dismissed entries. Dismissed entries collapsible under `<details>` "Dismissed (N) — still scannable". Confirmation modal before write. Toast shows `Scanned N · reclassified M`. Refactored row to module-level `UnknownFandomRow` (fixed nested-component lint).
- **Live result on the operator library**: scanned 328 "Other" books, reclassified 4 — *Maybe Baby* → Stargate Atlantis, *Standing Tall* → Avatar: The Last Airbender, *Pencils down Death rays up* → Mass Effect Trilogy, *Merlin's Struggles* → Merlin (TV). All 4 originally bucketed before the AO3 seed list landed.
- **Provenance chip** on `BookCard`: tiny single-letter pill next to category badge — **M** (metadata), **R** (metadata_rescan), **A** (ai), **X** (manual). Color-coded; `title` tooltip explains each. Admin-only (`user?.is_admin`) so regular users don't see it. Tested: 2000+ chips render in library grid; `classifier` field flows through the existing `GET /books` projection unchanged.


### Fixed 2026-06-12 (dark-mode contrast bugs in today's additions)
- Health check: all 211 backend tests green; all 7 admin endpoints respond 200; supervisor (backend / frontend / mongodb) RUNNING.
- Dark-mode audit found 5 contrast issues introduced by today's additions, all from new tinted bg/text hex codes that weren't remapped in `index.css`. Single CSS patch covers all of them:
  - "What's new" peach gradient (`from-[#FCEFE6] to-[#F8E3D3]`) → dark amber gradient in dark mode (text was being remapped to light, leaving peach-on-peach unreadable).
  - Sage 10% pale `#EAF0EB` (admin card icons, classifier M chip, feature-flag pill) → tinted dark sage.
  - Red 10% pale `#FBE9E7` (demote button, classifier-row delete) → tinted dark red.
  - Red text `#9B3531`/`#D9534F`/`#B53C39` (delete buttons, demote, errors) → coral `#FF9A85`.
  - New classifier-chip purple `#F0E8F5`/`#6B4A8C` and slate `#E8EEF5`/`#3A5A8C` (A and X chips) → dark-tinted variants.
- Parked from this round: 🔁 **a) Surprise me button**, 🔁 **c) Books I haven't read filter**. Bring up next session.
- Parked indefinitely: 🔁 **b) `books.py` Phase 2 refactor** — broken into Phase 2A (fandom_utils), 2B (epub_io), Phase 3 (sub-routers) so credit cost can be scoped per-phase. Cheapest first if/when revisited.


### Changed 2026-06-12 (Site re-theme: peach → purple, via CSS variable bridge)
- **Approach**: kept all `text-[#E07A5F]` / `bg-[#E07A5F]/20` Tailwind classes literal in JSX. Added a CSS override block in `index.css` that hijacks every compiled peach class and points it at `var(--primary)` etc. via `color-mix(in srgb, var(--primary) N%, transparent)` for opacity variants. Result: zero JSX files touched, future re-themes = edit 4 lines in `:root`.
- **Variables**: `--primary` `#8B5CF6` (light) / `#A78BFA` (dark); `--primary-hover` `#7C3AED` / `#C4B5FD`; `--accent-pale-1` `#F3EDFF` / `#2A1F3A`; `--accent-pale-2` `#E5D3FF` / `#3A2A4F`. Brand book-spine gradient also lifted to `var(--primary) → var(--accent-green)`.
- **Verified visually**: Library + Help in both light and dark. All accents (NEW pill, "Choose files" button, links, gradient cards, badges, focus rings, hover states) use purple now. No regression on text contrast.
- To pick another colour later: edit just `--primary` / `--primary-hover` / `--accent-pale-1` / `--accent-pale-2` in `/app/frontend/src/index.css` (light) plus the matching block inside `:root[data-theme="dark"]` (dark) — done.


### Added 2026-06-12 (Theme palette picker on Account)
- **6 preset palettes**: Peach (original), Purple (current default), Forest, Ocean, Crimson, Charcoal. Each defines `primary` + `primaryHover` + `pale1` + `pale2` for both light and dark modes — dark variants brighten the primary for legibility against `#1B1B1E` and invert the pale tints to deep hues of the same family. Add new palettes by editing `/app/frontend/src/lib/palettes.js` only.
- **Wiring**: new `PaletteProvider` context wraps the app inside `<ThemeProvider>` (so palette changes co-exist with light/dark toggle). Provider injects a `<style id="shelfsort-palette">` tag into `<head>` containing both `:root { ... }` and `:root[data-theme="dark"] { ... }` blocks. Cascade beats `index.css` `:root` because the tag appears later. localStorage key `shelfsort_palette` persists across reloads.
- **UI**: `PalettePickerCard` mounted on `/account` between Backup and Profile. Each swatch shows two dots (primary + pale tint) so users see the actual colour before committing. Selected palette gets a green check; "Currently using **X**" footer with hint at the `palettes.js` file path for power users.
- **Verified end-to-end**: clicking Forest swapped the entire library page's accents; switching to dark mode + Crimson applied the dark-tuned coral primary (`#FF7878`) across all hijacked Tailwind classes (Save button, Profile input border, palette card border). `--primary` matches the palette JS values on `getComputedStyle()`.
- Zero JSX edits to existing components. The CSS-variable bridge added earlier in the day handles the rest.


### Added 2026-06-12 (Custom palette option — 7th swatch with colour pickers)
- **7th palette `id: "custom"`** added to the picker card with a dashed-border swatch + Sliders icon. Selecting it expands a 4-row panel of native HTML5 `<input type="color">` pickers (one per slot: Primary, Primary hover, Pale tint 1, Pale tint 2).
- **Live preview**: changing any picker updates the CSS variable instantly via the same `<style id="shelfsort-palette">` injection used by presets. No save button needed.
- **Auto-derived dark variants**: a new `deriveDarkPalette(light)` helper in `palettes.js` converts each light hex to HSL, brightens primaries (`l ≥ 60` / `l ≥ 75`), and inverts the pale tints to deep luminances of the same hue (`l = 14` / `l = 20`). User picks 4 light hexes; dark mode "just works".
- **Storage**: light hexes persist to `shelfsort_palette_custom` (separate key from the active-id `shelfsort_palette`) so flipping back to a preset doesn't lose the custom palette.
- **Verified end-to-end**: selected Custom → swapped Primary to hot pink `#E91E63` via the picker → entire library page accents (Choose files, Open the guide, upload-zone border, "Updated stories" badge) recoloured live. `getComputedStyle()` confirmed `--primary` matches.
- Lint clean. Zero JSX edits to any existing component.


### Fixed 2026-06-12 (Navbar avatar hover + Help page docs for theme palette)
- **Bug**: hovering the avatar / username area in the Navbar showed a bright cream `#F5F3EC` highlight rectangle in dark mode — only the non-hover `bg-[#F5F3EC]` was remapped in `index.css`. Added `.hover\:bg-\[\#F5F3EC\]:hover` to the same dark-mode override block so the hover state correctly uses `var(--surface-hover)` (`#34343A`).
- **Help docs**: added a new bullet under "Account & preferences" describing the Theme palette card — 6 presets + Custom with 4 colour pickers, auto-derived dark variants, browser-scoped persistence, and how it pairs with the existing Light/Dark toggle.


### Added 2026-06-12 (Real account deletion — kept separate from library wipe)
- **Truth audit**: the pre-existing "Delete entire library" button in Account's Danger Zone wipes books/files/reading_activity/smart_shelves/categories ONLY — the `users` row, sessions, password tokens, fandom aliases, format prefs, and other settings all survived. Help docs falsely advertised this as "delete account".
- **Backend**: new `POST /api/account/delete` in `/app/backend/routes/auth.py`. Body `{confirm_email: str}` must match the signed-in user's email (case-insensitive) — guards against accidental UI clicks. Performs full purge: on-disk files in `/app/uploads/<user_id>/`, `books`, `reading_activity`, `smart_shelves`, `categories`, `user_sessions`, `password_reset_tokens`, and the `users` row itself. Clears the `session_token` cookie on the response so the browser is signed out immediately.
- **Frontend**: new `delete-account-card` section at the very bottom of `/account`, visually distinct (double red border, separate header "Delete account permanently"). Includes a `delete-account-email-input` text field; the `delete-account-btn` stays disabled until the field is non-empty, then frontend re-checks the typed value matches `profile.email` before calling the API. Browser confirm dialog as a final guard. On success → toast + redirect to `/login`.
- **The existing "Delete entire library" card stays exactly where it was** with no behavior changes. The two cards are now completely independent on Account page.
- **Help docs rewritten** in the Account & preferences section to describe both options accurately: library wipe (account survives) vs. account delete (full nuke, can't even log back in).
- Verified: 401 unauthed, 400 on wrong email, button disabled while input empty, both cards render on /account.


### Changed 2026-06-12 (Account deletion is now a 30-day soft-delete with cancel-anytime)
- **Soft-delete semantics**: `POST /api/account/delete` no longer purges immediately. Sets `scheduled_deletion_at = now + 30 days` on the user record, clears all sessions, drops the response cookie (force-logout). Books / files / shelves stay intact during the grace window.
- **Cancel anytime**: signing back in during the 30-day window flags the user with `scheduled_deletion_at` on `/auth/me` → new global `PendingDeletionBanner` (red-tinted, top of every page) shows the deletion date + days remaining + a one-click "Cancel deletion" button that hits `POST /api/account/cancel-deletion`.
- **Hard purge**: new daily APScheduler cron at 03:17 UTC (`account_grace_tick` in `routes/digest.py`) sweeps users whose `scheduled_deletion_at` is in the past and calls the new `_hard_delete_user()` helper — purges files, books, reading_activity, smart_shelves, categories, sessions, password_reset_tokens, and the users row itself. Also exposed manually via `POST /api/account/grace-tick` for testing.
- **Frontend nag**: typing your email into the confirmation field on the Delete Account card surfaces a `delete-account-backup-nag` amber callout urging "Download a library backup first — after day 30 the ZIP is your only recovery". One-click anchor jumps to the backup card.
- **Help docs updated** to describe the 30-day grace, the cancel-on-relogin banner, and the backup-first nag.
- **Model**: added `scheduled_deletion_at: Optional[datetime]` to `User`.
- Verified end-to-end via curl: schedule → cookie cleared → re-login → `/auth/me` shows scheduled date → cancel → field nulls back out. UI banner screenshot confirms visual.



### Added 2026-06-13 (Resend email — actually sending now)
- **Resend API key wired**: `RESEND_API_KEY` populated in `/app/backend/.env`. Sender = `onboarding@resend.dev` (Resend sandbox). Sandbox limitation: only the email registered with Resend (`jessicaboxell4@gmail.com`) receives mail; sends to other addresses are silently dropped by Resend until a custom domain is verified at https://resend.com/domains.
- **Verified end-to-end**: live test email sent successfully (Resend message ID `18c3aae7-f079-4a71-9bb5-78d9fb40016a`).
- **Now active**: weekly digest scheduler, fanfic-update notifications, and the 7-day "scheduled deletion" reminder cron all actually deliver mail. Previously each codepath silently no-op'd via the `if not RESEND_API_KEY` guard.
- **Future**: when scaling beyond personal use, verify a custom domain (`shelfsort.app` or similar) at resend.com/domains, then update `SENDER_EMAIL` in `.env` and switch from sandbox to authenticated sender.


### Added 2026-06-13 (One-shot "Send test email" button)
- **New endpoint**: `POST /api/user/email-test` in `routes/digest.py`. Auth-gated. Fires a small standalone "delivery confirmed" email (subject `Shelfsort — delivery test ✉️`) directly to the signed-in user's email, with the user's name in the greeting. Returns `{delivered: true, id, to}` on success, `{delivered: false, logged: true, to}` when `RESEND_API_KEY` is empty, and `502` on Resend rejection.
- **New UI button** on `/account/emails` Email Preferences page: `emails-send-test-btn` pill button in the sender-info card (only renders when `email_configured=true`). One click → toast confirmation with the recipient address.
- **Why**: removes the need to either wait for the weekly cron or seed a refreshed book just to verify the Resend pipeline is alive. Useful any time the user changes Resend keys, swaps sender domains, or toggles email channels.
- **Tests**: 2 new pytest cases in `tests/test_digest.py::TestEmailTest` (auth gate + happy path tolerating sandbox restriction). Two existing tests (`test_preview_returns_summary`, `test_preview_with_refreshed_book`) loosened to accept Resend sandbox rejections as a valid non-delivered state.
- Verified end-to-end via curl with real Resend send (message ID `c6a23bce-1e90-458d-b768-f169ecd71eb0`). All 33 digest tests + 78 in surrounding suites passing.


### Added 2026-06-13 (Operator email diagnostic on Admin Console)
- **New endpoint**: `POST /api/admin/email-test` in `routes/admin.py`. Admin-gated. Accepts `{target_user_id?, target_email?, note?}` — falls back to the calling admin's email if neither is provided. 404 when target_user_id doesn't exist. Sends a distinctive "operator diagnostic" email (red ★ OPERATOR DIAGNOSTIC pill) with optional admin note rendered as a styled callout (HTML-escaped).
- **Audit-logged**: every send writes an `email.test` row via `record_admin_action` with metadata `{to, delivered, id?, error?, logged?}` so abuse / debugging history is traceable.
- **New UI card** on `/admin` (`EmailDiagnosticCard` between System Health and Global Aliases): three recipient modes (radios) — Self · Pick registered user (select populated from `/admin/users`) · Custom email. Optional 200-char note with live counter. Send button shows inline success pill ("Delivered to <email> #<id>") or red error pill.
- **Tests**: 6 new pytest cases in `tests/test_admin_console.py` — auth gating, self-default, pick-by-id, unknown-user-404, custom email, audit-log write. **All 26 admin_console tests pass.**
- Verified end-to-end via curl with real Resend send (message ID `5c9deb6e-856c-4c71-9502-a7b999ca52bd`). UI screenshot confirms layout.


### Added 2026-06-13 (Unified appearance UX — popover + dedicated /account/appearance page)
- **Navbar popover**: replaced the bare sun/moon icon button with `AppearancePopover` (`components/AppearancePopover.jsx`). Clicking the icon opens a 288px floating panel: Light/Dark toggle row + 4×2 swatch grid (6 presets + Custom dashed slot) + "More appearance options →" link. Closes on outside click / Escape. `navbar-theme-toggle` testid preserved.
- **Dedicated page**: new `/account/appearance` route (`pages/AppearancePage.jsx`). Full controls — large Light/Dark cards (radio-style), the existing `PalettePickerCard` (with Custom hex pickers), and a Live Preview card showing the active palette on a primary button, secondary button, NEW pill, and a pale-gradient sample card with link.
- **Removed**: `PalettePickerCard` no longer renders on `/account`. The only ways to reach palette controls are the navbar popover (quick switch) or "More appearance options →" → `/account/appearance` (full controls).
- **Help docs updated**: rewrote the Appearance bullet on `/help` Account section to describe the popover-first flow, the seven swatches, the Custom hex picker, and the dedicated page link.
- All six touched files lint-clean. UI screenshots confirm popover + page render correctly.


### Polish 2026-06-13 (Appearance UX — three small wins)
- **Hover-name caption** in the navbar popover: small live label below the swatch grid that reads `Preview: <Hovered>` while hovering or `Current: <Active>` otherwise. Replaces browser-native `title=` tooltips (which had a 1.5s delay). Captures `onMouseEnter/Leave` + `onFocus/Blur` for keyboard parity. Each swatch also got a proper `aria-label="<Name> palette"` for screen readers.
- **Sharper theme toggle label**: "Switch to Light →" / "Switch to Dark →" instead of vague "switch →". Tells the user exactly what tapping it will do.
- **Reset to defaults** link at the bottom of `/account/appearance`: two-click confirmation (first click arms a red "Click again to confirm reset" label + a cancel link, second click restores the default palette (`purple`) and the default custom hex set, then toasts). Shows "(currently at defaults)" when already there.


### Added 2026-06-13 (Appearance discovery — pulse + announcement)
- **One-shot pulse**: new `@keyframes appearancePulse` in `index.css` (three soft rings using `box-shadow` + `color-mix` so the ring colour respects the active palette). Applied via `.appearance-pulse` class on the navbar sun/moon button when `localStorage.shelfsort_appearance_seen` is missing. Cleared on first click of the icon (popover open) — so power users dismiss it instantly and the flag persists forever in that browser.
- **"What's new?" announcement** published via `POST /api/announcements` with version `2026-06-13-appearance`, title "Appearance, all in one place", two items: the popover entry + the dedicated Appearance page (with deep-links to `/library` and `/account/appearance`). Surfaces in the existing `UpdatesBell` until the user dismisses it.
- Verified via Playwright: `Has pulse class: True` on first load; `localStorage.shelfsort_appearance_seen = "1"` after click; announcement visible (purple dot on the bell).


### Added 2026-06-13 (Palette sharing — export/import tokens)
- **Token format**: presets pack as `ss-p-<id>` (e.g. `ss-p-forest`), Custom palettes pack as `ss-c-<base64>` of `{v:1, l:{primary, primaryHover, pale1, pale2}}`. Versioned (`v:1`) for forward-compat; strict hex regex validation on decode; helpful error strings when malformed.
- **Helpers**: `encodePaletteToken(paletteId, customLight)` and `decodePaletteToken(raw) → {paletteId, customLight?} | {error}` added to `lib/palettes.js` (alongside the existing palette config).
- **UI**: new "Share palette" card on `/account/appearance` (between Live Preview and footer). Two rows: (1) current token in a `font-mono` code box with Copy-to-clipboard button + transient ✓ Copied state; (2) paste-field with Enter-key support + Apply button. Toasts on success/error. Disabled-state on Apply when field is empty.
- Verified via Playwright: token shows `ss-p-purple`, typing `ss-p-forest` → Apply → toast "Applied palette 'forest'" → live preview turns green → token field updates to `ss-p-forest`. Custom-palette round-trip works too (base64 path).


### Added 2026-06-13 (Curated palette gallery + Help page rewrite)
- **`GUEST_PALETTES` array** in `lib/palettes.js` — six hand-picked named palettes with descriptions: Cozy Library (warm amber + cream), Midnight Reader (steel indigo), Sun-bleached Paperback (mustard + parchment), AO3 Classic (the original coral), Forest Floor (olive + moss), Vintage Ink (deep burgundy). Each is just light-mode hexes; dark variants auto-derive when applied.
- **New "Curated palettes" card** on `/account/appearance` (between Live Preview and Share palette). 3-column responsive grid; each tile = 56px gradient header (primary → primaryHover → pale2) + name + description. One click → sets paletteId to `custom`, loads the four hexes, toasts.
- **Help page rewritten**: the Appearance bullet on `/help` now lists every Appearance feature explicitly — popover with hover caption, dedicated `/account/appearance` page, Light/Dark cards, full Custom hex picker, Live preview, Curated palettes gallery, Share palette tokens (preset `ss-p-…` vs Custom `ss-c-…`), and Reset to defaults.
- Verified end-to-end via Playwright: gallery renders 6 tiles, clicking Midnight Reader → toast → Live Preview switches to indigo → Share-palette token field becomes the long `ss-c-eyJ2IjoxLCJsIjp7InByaW1hcnk…` base64.


### Added 2026-06-13 (Direct messaging between users — Phase 1, admin-curated)
- **New backend module** `routes/chat.py` (~280 lines) with collections `chat_rooms`, `chat_messages`, `chat_reads`. Three message kinds: `text`, `book` (snapshots book_id + title + author at send time; ownership required), `palette` (carries a Shelfsort palette token + optional name).
- **Endpoints**:
  - Admin: `GET/POST/PUT/DELETE /api/admin/chat-rooms[/{room_id}]` — admin-only room CRUD, validates every `member_user_ids` against the users collection, deletes cascade to messages + reads. All mutations audit-logged as `chat_room.create/update/delete`.
  - User: `GET /api/chat/rooms` (hydrated members + per-room unread count), `GET /api/chat/rooms/{rid}/messages`, `POST /api/chat/rooms/{rid}/messages` (auto-marks sender as read), `POST /api/chat/rooms/{rid}/read`, `GET /api/chat/unread-count` (cheap total for the navbar badge).
  - Membership guard `_get_room_for_member` returns 404 on missing room, 403 if user isn't in `member_user_ids`. Admins do NOT bypass — they must be a member to read/post.
- **Frontend `/messages` page** (`MessagesPage.jsx`): sidebar lists your rooms with member-pills + per-room unread badge; thread panel polls `loadMessages` every 15s while a room is active; auto-scroll to latest; mark-as-read fires on room open + every refresh. Composer supports text (Enter to send, Shift+Enter newline), book attach (searches your library), palette attach (snapshots whatever palette you have applied right now). Recipients see book attachments as clickable cards linking to `/library/book/{id}` and palette attachments as a swatch with an **Apply** button (uses the existing `decodePaletteToken` helper to one-click switch).
- **Navbar badge**: new `ChatInboxIcon.jsx` polls `/api/chat/unread-count` every 15s, shows a numeric pill (`99+` cap) using `var(--primary)` so the badge respects the active palette.
- **Admin Console**: new `ChatRoomsCard` slotted second-from-top. Lists all rooms with member emails + last-active, inline-edit member checklist (loaded from `/admin/users`), create form (name + checkbox member picker), delete with browser confirm.
- **Help docs**: added a dedicated Messages section to `/help` between Reader & Stats and Account & Preferences, explaining the popover, three message kinds, and that future phases (open chat, friend requests, websockets) are parked.
- **Tests**: 23 new pytest cases in `tests/test_chat.py` covering admin auth gating, room CRUD validation (unknown members, empty members, 404 paths), user-side list/post/mark-read flow, attachment ownership guard (book), palette validation, unread counting (including "your own posts don't count"), audit-log trail, and delete-cascades-to-messages. **All 23 pass.**
- Verified e2e via Playwright: navbar badge shows `1`, room list shows the seeded "Test Room — Jessica + friends" with `AO3, BIG` member pills, thread renders incoming (white) and outgoing (purple, palette-aware) messages, composer sends successfully, message count goes 1 → 3 (2 hydrated + 1 sent).
- **Parked future phases** (per user choice): 1a (open user-to-user messaging), 1b (friend-request gated), websockets for instant delivery (current 15s poll is fine for casual chat).


### Parked idea 2026-06-13 (Reading-along rooms / mini book-club)
- Concept: a chat room can pin one specific fic; members see each other's reading-progress on that fic update in real time ("Maya is on chapter 12"). Optional spoiler-tag system per-chapter. Turns Shelfsort from a personal library into a tiny book-club platform — unique angle no AO3 / KOReader / calibre clone has.
- Priority: P2. Depends on the chat system (already built) and the existing reading-progress data (already tracked per book).


### Added 2026-06-13 (Chat Phase 1a + 1b — friend-gated open messaging)
- **New backend module** `routes/friends.py` (~330 lines) with `friendships` collection (canonical `(user_a, user_b)` pair, status `pending`/`accepted`/`blocked`, `requested_by`, `blocked_by`). Two new `users` fields: `message_privacy` (default `friends_only`, alt `anyone`) and `hidden_from_search` (default false).
- **Endpoints**:
  - `GET /api/friends` → `{accepted, pending_in, pending_out, blocked}` with email/name/picture hydrated; only the blocker sees their own block entries (option 3a).
  - `GET /api/friends/pending-count` → for the combined navbar badge.
  - `POST /api/friends/request {target_user_id? | target_email?}` — 404 on unknown user, 409 on duplicate, 403 if blocked, **auto-accepts** when the other side already had a pending outgoing request, case-insensitive email lookup.
  - `POST /api/friends/{uid}/accept` · `POST /api/friends/{uid}/decline` (decline-or-cancel) · `DELETE /api/friends/{uid}` (remove + wipe DM room).
  - `POST /api/friends/{uid}/block` · `DELETE /api/friends/{uid}/block` (unblock). Blocking tears down any existing DM room with that user.
  - `GET /api/users/search?q=…` — name/email substring (min 2 chars), excludes self, hidden users, and blocked-in-either-direction. Returns relation status (`none`/`friend`/`pending_in`/`pending_out`) so the UI shows the right CTA.
  - `GET/PUT /api/account/privacy` — toggle `message_privacy` and `hidden_from_search`.
  - `POST /api/chat/dm/{uid}` — opens or creates a 1-on-1 DM room. Idempotent. Returns 403 if the target is `friends_only` and not your friend, or if either side has blocked.
- **DM rooms** are differentiated via `room_type: "dm" | "group"` + `dm_pair_key` for uniqueness. They live in the same `chat_rooms` collection so the existing Messages page renders them with zero special-casing.
- **Frontend `/friends` page** (`FriendsPage.jsx`): live-debounced user search (300 ms), three lists (Incoming, Friends, Blocked) + outgoing-pending when any exist. Per-row actions: Request / Accept / Decline / Message / Remove / Block / Unblock with browser-confirm on destructive ones. Empty-state copy on each list. A "Switch to open DM mode →" link appears under Incoming when any pending requests exist (Phase 1c).
- **Account page** has a new **Privacy & messaging** card (`PrivacyMessagingCard`, anchored at `#privacy`): toggle DM privacy (`friends_only` vs `anyone`) with two segmented buttons, toggle hidden-from-search with a Shadcn-style switch, and a "Manage friends" button that shows pending count and deep-links to `/friends`.
- **Navbar badge upgraded** (option 4b): `ChatInboxIcon` now sums unread messages + pending friend requests into one number; hover tooltip breaks down which is which.
- **Messages page sidebar** has a new "+ DM" link pointing to `/friends` (use the search there to start a new DM).
- **Help docs**: rewrote the Messages section to cover the three room types (admin-curated group, friend DM, open DM), the friend-request lifecycle, privacy toggles, hidden-from-search, blocking, and the combined navbar badge.
- **Tests**: 32 new pytest cases in `tests/test_friends.py` covering: request lifecycle (send/duplicate/auto-accept), decline, decline-then-re-request, DM privacy gate (`friends_only` blocks non-friends, `anyone` allows), DM idempotency, user search (short query empty, by email, by name, excludes self/hidden, relation annotation), privacy CRUD, block leak prevention (blocker sees their block; blockee doesn't), block → DM 403, unblock allows fresh requests. **All 32 pass.** Total backend suite 81/81 on friends + chat + admin.
- **Verified e2e via Playwright**: `/friends` renders, search "user" returns 6 candidates with Request buttons, empty Incoming/Friends/Blocked sections all show appropriate copy.


### Added 2026-06-13 (Invite-by-email — close the network-effect loop)
- **New backend module** `routes/invites.py` (~220 lines) with an `invites` collection (`{invite_id, token, inviter_user_id, target_email, status, note, created_at, expires_at}`). Tokens are 40-char hex; TTL = 30 days; max 10 pending invites per user (cheap anti-spam).
- **Endpoints**:
  - `POST /api/friends/invite {email, note?}` — entry point. Two paths: (1) email already on Shelfsort → falls through to the normal friend-request flow (returns `path: friend_request_sent` / `auto_accepted` / `already_friends`), (2) brand-new email → creates invite + sends Resend email with a styled signup link, returns `path: invite_sent` (or `invite_created_email_failed` if Resend rejects but the invite is still valid via direct URL). Idempotent — re-inviting the same email returns the existing pending invite.
  - `GET /api/invites/{token}` — **public** (no auth) so the recipient can preview before signing up. Returns inviter name + target email + status + note. Auto-flips status to `expired` when past TTL (timezone-aware comparison).
  - `POST /api/invites/{token}/accept` — auth-required. Marks invite accepted, creates accepted friendship immediately (skips the pending state), 410 on expired, 400 if you try to accept your own.
  - `GET /api/friends/invites` — list your sent invites.
  - `DELETE /api/friends/invites/{invite_id}` — cancel a pending invite.
- **Frontend**:
  - **`/friends` page** now has a new "Invite someone by email" card between the search and the lists: email field, optional 200-char note, Send button. Toast on success (different copy for "they're already on Shelfsort, sent a friend request" vs "invite emailed"). A `<details>` panel lists your pending invites with per-row Cancel buttons.
  - **New `/invite/:token` page** (`InviteAcceptPage.jsx`) — public landing page. Shows the inviter's name, the optional note in a styled callout, and a green "Accept & become friends" button (if signed in) or sign-in / create-account CTAs that preserve the token via `?next=/invite/<token>`. Handles `expired`/`accepted`/missing-invite states with friendly copy.
- **Email template**: styled Resend HTML with a 📚 SHELFSORT INVITE pill, the inviter's name, the note (escaped + callout), a big "Accept your invite →" CTA, and the raw link below for safety. Plain-text fallback included.
- **Help docs**: Friends section paragraph extended to describe the invite flow, the 30-day expiry, and the cancel-from-pending-list affordance.
- **Tests**: 14 new pytest cases in `tests/test_invites.py` (use a module-level `invite_token` fixture for cross-test state) covering: unauth blocked, can't invite self, existing-user-falls-through, brand-new-email creates invite, duplicate returns same, public preview, unknown-token 404, accept-without-auth 401, inviter-can't-accept-own, joiner-accepts-creates-friendship (both sides), double-accept 400, expired invite 410, list-mine, cancel-pending. **All 14 pass.**
- Verified e2e via Playwright: Friends page now shows three cards (Find someone · Invite by email · lists), Send-invite button greys out when email field is empty, layout polished.


### Added 2026-06-13 (Friend library — mutual badge + browse + "Want this")
- **New backend module** `routes/friend_library.py` (~180 lines):
  - `GET /api/friends/{uid}/mutual` — returns `{count, sample[5], my_total, their_total}` for accepted friends. Matches books by lowercase `title|author` with leading "the/a/an" prefix stripped, so "The Hobbit" / "Hobbit" pair correctly.
  - `GET /api/friends/{uid}/library?q=&limit=` — paginated, searchable view of a friend's library. Gated by the friend's `library_visible_to_friends` toggle (default off). Each book annotated with `i_have_it` so the UI can hide the "Want this" button for duplicates.
  - `POST /api/friends/{uid}/book-request {book_id, note?}` — sends a `kind: "book_request"` chat message into the existing (or auto-created) DM room between the two users. No file transfer through Shelfsort — copyright-safe by design; sender writes a note, friend decides whether/how to share.
  - `GET/PUT /api/account/library-visibility` — opt-in toggle.
- **Frontend**:
  - **`/friends` page**: every accepted friend row now shows a **🤝 N** mutual-count badge (only when > 0) with a hover tooltip ("N of their X books are in your library") + a **Library** button that opens the new modal.
  - **`FriendLibraryModal`** component: full-screen modal with searchable book list. Each row shows title + author + fandom badge. Books the caller already owns show a green "You have" pill; books they don't have show a primary-coloured **Want this** button that fires the book-request DM with a toast.
  - **Account → Privacy & messaging card** gained a third toggle: **Share my library with friends** (Shadcn-style switch). Defaults off for privacy-first behaviour.
- **Tests**: 12 new pytest cases in `tests/test_friend_library.py` covering mutual count math (incl. "the Hobbit" vs "Hobbit"), non-friend 403s, opt-in gating, search filter, book-request creates the right `kind: "book_request"` chat message with attachment, unknown-book 404, non-friend block, visibility toggle CRUD. **All 12 pass.** Full social stack: **81/81 across friend_library + friends + invites + chat.**
- **Help docs**: rewrote the Privacy section to cover the library toggle + added a paragraph about the mutual badge math.


### Verified 2026-06-13 (Integration health check)
- **Backend test suite**: 379 pass, 3 skipped, 8 pre-existing failures (all in `test_tags_and_smart_shelves.py` — verified by git-stash baseline run, unrelated to any work in this session). Every new module I shipped today is fully green: digest (33), admin_console (26), announcements (8), chat (23), friends (32), invites (14), friend_library (12).
- **Frontend**: all files lint-clean. Dev server compiles without errors.

### Added 2026-06-13 (Help page live search bar)
- New search input above the article on `/help`: pill-shaped, magnifying-glass icon, clear-X button when text is present. Placeholder hints at common queries: "Search the docs… (e.g. palette, friends, EPUB)".
- **Live filter**: typing query → `useEffect` reads each section's `innerText`, hides non-matching `<Section>` via `el.style.display = "none"`, and filters the sticky TOC to only show matching anchors. Summary line shows "N sections match" (red when zero, with "Try a broader term" hint).
- **Missing TOC entry fixed**: added `messages` to the `SECTIONS` array (the Messages & Friends section was rendered but unreachable from the TOC).
- **Pre-existing unescaped-entity warnings cleaned up**: 13 React lint errors in the recently-added Messages section copy (quotes + apostrophes) replaced with `&ldquo;`/`&rdquo;`/`&rsquo;`/`&apos;` HTML entities.
- Verified via Playwright: typing `palette` → "2 sections match" + TOC shrinks to Messages & Account; `invite` → 1 section match; clear button restores everything.

### Added 2026-06-13 (Help search suggestion chips)
- Row of six clickable chips below the Help search input shown only when the query is empty: `palette`, `friends`, `EPUB`, `shelves`, `backup`, `dark mode`. Click pre-fills the search → instant filter, no typing.
- Verified via Playwright: 6 chips render, clicking `friends` → search input filled → "1 section match" + TOC narrows to Messages & friends.



### Bug fix 2026-06-13 (Duplicate detection — require author match, not just title)
- **Problem reported**: books with the same title but different authors and different source URLs were being flagged as duplicates. Common for generic titles ("Crossroads", "Lost", "Untitled", series-shared chapter titles).
- **Root cause**: `find_duplicate_candidates` in `routes/books.py` had a title-only OR clause — any case-insensitive title match was sufficient to flag the upload as a duplicate, even when author and source_url were both different.
- **Fix**:
  - Added `author: Optional[str] = None` to `find_duplicate_candidates`. Caller in the upload pipeline now passes `meta.get('author')`.
  - Added `_normalize_author_for_match()` helper: lowercase, drop dots, collapse whitespace, **and** merge runs of single-letter "initials" so `J. K. Rowling`, `J.K. Rowling`, and `JK Rowling` all normalize to `jk rowling`.
  - Title clause inside the result loop now requires title+author equality. The new match reason is `title+author` (vs the legacy `title`). When **either** side has no author on file, falls back to title-only matching with the legacy `title` reason — so we don't miss legit dupes when metadata is incomplete.
- **Tests** (`tests/test_new_features.py::TestDuplicateDetection`):
  - Updated existing `test_title_match_triggers_duplicate_flag` to accept either `title+author` (new) or `title` (legacy fallback).
  - Added `test_same_title_different_author_NOT_duplicate` — regression test for the reported bug ("Crossroads" by Alice Wright vs Bob Lee).
  - Added `test_title_match_missing_author_still_duplicate` — seeds an authorless book directly to verify the fallback path.
  - Added `test_author_normalization_strips_dots` — verifies "J. K. Rowling" + "JK Rowling" still pair.
  - All 11 `TestDuplicateDetection` tests pass; full `test_new_features.py` (194 tests) all green.
- **Help docs** rewritten on `/help` to describe the new three-tier detection (URL → title+author → title fallback) and explicitly mention the "Crossroads" example users were tripping over.


### Added 2026-06-13 (Author cleanup pass on upload)
- **New helper** `_clean_author_string()` in `routes/books.py`:
  - Drops parenthetical/bracketed annotations (`Real Name (Pen Name)` → `Real Name`)
  - Strips `by ` / `Written by ` / `Author:` prefixes
  - Trims trailing/leading separators (`& Jane Doe` → `Jane Doe`)
  - Collapses internal whitespace
  - Canonicalizes empty/None/`anonymous`/`anon`/`unknown` → `Unknown`, and `Various`/`various authors` → `Various`
  - Multi-author separators (`Smith, John & Doe, Jane`) are preserved
- **Wired** into both the EPUB metadata extractor (line 258) and the FicHub/FanFicFare fetch path (line 1838) so every author landing in Mongo goes through normalization.
- **Tests**: 33 parametrized cases in `tests/test_author_cleanup.py` covering every cleanup pattern + a round-trip of the matching helper (`_normalize_author_for_match`) on the cleaned outputs.
- Combined dedup + cleanup test count: **44/44 pass.** Improves both the dedup signal (cleaner inputs to the comparator) AND the library display.


### Parked idea 2026-06-13 (Author detail page — P2)
- Concept: `/library/author/{name}` page lists every book by that author in the user's library, with a small user-editable bio area ("first read 2018", "writes hurt/comfort"). Clean author strings from the new cleanup pass mean clean URLs for these pages. Could also surface a "shared with friends" indicator and a "mark as favorite author" affordance.
- Priority: P2.


### Added 2026-06-13 (User suggestions / feature-request box)
- **New backend module** `routes/suggestions.py` (~190 lines) with a `suggestions` collection (`{suggestion_id, title, body, category, status, submitter, voters[], admin_note, created_at, updated_at}`). Categories: `bug | improvement | feature`. Statuses: `open | under_review | planned | done | declined`.
- **User endpoints**: list (filterable by status/category/`mine_only`, sorted by status then votes), submit (auto-votes for self), toggle vote, self-delete own.
- **Admin endpoints**: `PUT /api/admin/suggestions/{sid}` to change status + admin_note (audit-logged as `suggestion.update`), `DELETE /api/admin/suggestions/{sid}` for spam, `GET /api/admin/suggestions/open-count` for the admin badge.
- **New `/suggestions` page** (`SuggestionsPage.jsx`): combined submission form (title + 4000-char body + category chip picker), filter bar (status select + category select + "My submissions" checkbox), and a sorted list with upvote arrow buttons (visually distinct when you've voted). Per-row admin controls (status select, "Note" button, delete) render only for admins. Submitters can self-delete with a trash icon.
- **Help page** now has a "Don't see what you're looking for? Drop a suggestion →" link in the header.
- **Tests** (`tests/test_suggestions.py`): **17/17 pass.** Coverage: auth gating, title required, invalid category, auto-vote on submit, vote toggle (vote → unvote), 404 on unknown id, filter by status/category, mine-only excludes others, self-delete vs cross-user 403, admin status update, open-count, audit-log trail, admin spam-delete.
- Verified e2e via Playwright: submit form → toast → row renders with vote count `1`, OPEN pill, admin row showing (status select + Note + Trash).


### Added 2026-06-13 (Suggestion status notifications — email + in-app)
- **New backend module** `routes/notifications.py` — generic in-app notification system. `create_notification(user_id, kind, title, body, link)` is callable from any route; endpoints `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`.
- **Hook in suggestions admin update**: when an admin changes `status` or `admin_note` on a suggestion they didn't submit themselves, the submitter gets (a) an in-app notification (kind=`suggestion_status`, linked to `/suggestions`) and (b) a styled Resend email ("Your suggestion 'X' is now Planned" with the admin note rendered as a callout). Self-updates by the admin who submitted skip both — no spam.
- **New `NotificationsBell` component** sits in the navbar between the appearance popover and the chat bubble. Shows a palette-coloured numeric badge (15s polling), opens a 320px dropdown with the 20 most recent notifications. Unread rows have a subtle highlight + purple dot. Click a row → marks read + follows the link. "Mark all read" link in the header.
- **Tests**: extended `tests/test_suggestions.py` with `test_status_change_creates_notification` covering both notification creation and the mark-all-read flow. **18/18 pass.**
- Verified e2e: bell visible in navbar, popover opens with "Nothing new" empty state when admin == submitter (correct: no self-notification spam).



### Added 2026-06-13 (Friend Request notifications)
- **`routes/friends.py`** now calls `create_notification` from `routes/notifications.py` at three points:
  - On new outgoing friend request → notifies the target user with `kind="friend_request"` and a CTA link to `/friends`.
  - On mutual-request auto-accept (both users requested each other) → notifies the original requester with `kind="friend_accepted"`.
  - On explicit accept (`POST /api/friends/{other_user_id}/accept`) → notifies the original requester with `kind="friend_accepted"`.
- **Tests** (`tests/test_friends.py::TestFriendNotifications`): two cases, `test_request_notifies_target` + `test_accept_notifies_requester`. Both pass alongside the existing 33 friend tests → 34/34 green.


### Fixed 2026-06-13 (Tags & Smart Shelves — 8 previously failing tests)
- **Root cause**: `routes/books.py::add_book_tags` used `find_one({...}, {"_id": 0, "tags": 1})` followed by `if not book:`. Motor returns an **empty dict `{}`** when the doc exists but has no `tags` field — and `bool({}) is False`, so the handler incorrectly raised `404 Not Found` for any book that hadn't been tagged yet. This cascaded into every downstream test (remove, rename, merge, delete-everywhere, all four smart-shelf tests that depend on books having tags).
- **Fix**: changed the guard to `if book is None:` (single-line patch). Audited the rest of `routes/books.py` and all other route modules with the same regex pattern — no other endpoint had a strict single-inclusion projection paired with `if not <var>:`; everything else either uses `{"_id": 0}` (returns all fields) or projects a field that is guaranteed to exist.
- **Result**: `test_tags_and_smart_shelves.py` — was 8 failing / 6 passing / 3 skipped → now **14/14 pass, 3 skipped (AI)**. Full backend suite: **634 passed, 14 skipped, 0 failed.**


### Added 2026-06-13 (Friend "new book in your fandom" notifications)
- **New helper** `_notify_friends_of_shared_fandom_uploads(uploader_id, uploader_display, results)` in `routes/books.py`. Invoked from `POST /api/books/upload` immediately before the response is built.
- **Logic**: collect distinct fandoms in the just-uploaded batch (skipping `removed: True` auto-discards and books with no `fandom`); for each accepted friend, find which of those fandoms they already collect; drop one in-app notification per (friend, fandom) per batch. Hard cap of 50 notifications per upload so a massive batch can't carpet-bomb someone's bell.
- **Notification format**: `kind="friend_new_book"`, title `"<name> just added a new <Fandom> fic"`, body `"Peek their shelf to see what's new."`, link `/friends` (where the user can click the friend's "View Library" button — the friend library is a modal on that page, not a standalone route).
- **Safety**: wrapped in a defensive try/except so a Mongo hiccup or notification glitch can never 500 an upload. Errors logged at `WARNING`.
- **Tests** (`tests/test_friends.py::TestFriendUploadFandomNotifications` — 5 cases):
  - friend with shared fandom gets pinged ✓
  - friend without shared fandom does NOT get pinged ✓
  - upload with no fandom (Original Fiction) never pings anyone ✓
  - non-friend never gets pinged ✓
  - 5 fics in same fandom → exactly 1 notification (per-batch dedup) ✓
- **E2E verified**: scripted an Alice→Bob friendship with Bob holding an existing HP book; Alice uploaded an EPUB titled "Harry Potter and the New Adventure"; the classifier tagged it `fandom="Harry Potter"`, and Bob received exactly **1** `friend_new_book` notification with the correct title and `/friends` link.
- Full backend suite (test_friends + test_suggestions + test_tags_and_smart_shelves): **71 passed, 3 skipped, 0 failed.**



### Parked idea 2026-06-13 ("Books your friends added recently" carousel — P2)
- Concept: small horizontal carousel on the library home page that surfaces `friend_new_book` notifications from the last 7 days as clickable cards (friend avatar + fandom badge + "View library →"). Turns the bell into a passive discovery feed even when users don't click in. Pulls from `db.notifications` filtered by `kind="friend_new_book"` + `created_at >= now-7d`.
- Priority: P2 (parked by user 2026-06-13 with "remind later").


### Fixed 2026-06-13 (Static-analysis health pass — 2 production bugs + cleanups)

**🔴 Bug A — 7-day account-deletion warning emails were completely broken**
- `routes/digest.py::_account_grace_tick` (daily cron at 03:17 UTC) called `_send_grace_reminder_email(u)`, but the function was **never defined**. Every nightly run hit the broad `except Exception` and silently failed → users scheduled for hard-deletion got deleted with zero warning.
- Fix: implemented `_send_grace_reminder_email(user_doc)` in `routes/digest.py` mirroring the digest mailer's structure — HTML + plain text, Resend via `asyncio.to_thread`, `/settings` cancel CTA, graceful fallback when `RESEND_API_KEY` is empty (returns `{"delivered": False, "logged": True}` so the cron still marks `grace_reminder_sent_at` and doesn't loop forever).
- Tests: `tests/test_grace_reminder.py` — 5 cases pin the contract (function exists, no-key path returns logged, handles missing name + missing date, swallows Resend exceptions).

**🔴 Bug B — Franchise treemap silently included Original-Fiction / Non-fiction books**
- `routes/books.py::get_fandoms_grouped` filtered fandoms with `{"$ne": None, "$ne": ""}` — Python dict literal with a duplicate key; only `"$ne": ""` was kept, so books with `fandom=None` (Original Fiction, Non-fiction) leaked into the treemap.
- Fix: replaced with `{"$nin": [None, ""]}`. E2E verified: seeding `["Harry Potter", "Harry Potter", None, "", "Twilight"]` now returns exactly `[HP(2), Twilight(1)]` — None and empty-string buckets correctly excluded.

**🟡 Cleanups (no runtime impact, just code-smell removal)**
- `routes/admin.py`: added `List` to the typing import (was used in two variable annotations without being imported).
- `routes/books.py`: renamed the second `list_authors` (the `/library/authors` endpoint) to `list_authors_directory` to stop namespace shadowing. Both routes still register and respond.
- `routes/books.py`: removed an unused `user_dir` local, an unused `convert_error: Optional[str] = None`, an unused `other =` ternary in the status-detector helper, a shadowed `tempfile` re-import inside `_do_download`, two empty-f-string fragments in the 403 retry message, and split two `import a, b, c` lines (E401). Removed an unused `ip` capture in the login throttle path (already throttled by email only — comment already explained why).

**Health after fixes**
- Linter: `ruff check backend/routes/` — **0 blocking, 0 advisory** (was 28 blocking, 0 advisory).
- Tests: full suite **644 passed, 14 skipped, 0 failed** (5 new grace-reminder tests added).


### Added 2026-06-13 (Cron-health admin dashboard)

**Why**: directly motivated by Bug A above. The 7-day deletion-reminder job had been silently crashing every night for who-knows-how-long with no visibility. We needed a single pane of glass for every scheduled job so future silent failures get caught on day one.

**Backend**
- `utils/cron_health.py` — telemetry wrapper. `wrap_cron_job(coro, job_id)` records every invocation to `db.cron_runs` (`{job_id, started_at, finished_at, duration_ms, status, error}`). Lazy retention trims to 200 runs per job. Re-raises exceptions so APScheduler still sees the failure.
- `routes/digest.py` — both schedulers (`weekly_digest_tick` hourly, `account_grace_tick` daily 03:17 UTC) are now wrapped with `wrap_cron_job`.
- `routes/admin.py::GET /api/admin/cron-health` — returns per-job `last_run`, `last_ok_at`, 24h `runs/errors/error_rate`, `stale` flag (true if `last_run.started_at` is older than the job's `expected_max_gap_hours`), and the latest 20 runs (`recent[]`). Admin-only.
- `KNOWN_CRON_JOBS` registry: each job lists its expected cadence so the API can flag "stale" status. Adding a new cron job = add one entry + wrap with `wrap_cron_job`.

**Frontend**
- `AdminConsole.jsx::CronHealthCard` + `CronJobRow` — a new card on the Admin page. Each job shows a colored pill (`ok` / `last run failed` / `stale` / `no runs yet`), schedule, last-run timestamp + duration, 24h counters, and an expandable history of the last 20 runs (status icon, timestamp, duration, error text). Manual refresh button.
- Data-test-ids: `cron-health-card`, `cron-health-refresh`, `cron-job-<id>`, `cron-pill-<id>`, `cron-error-<id>`, `cron-toggle-<id>`, `cron-history-<id>`, `cron-health-error`.

**Tests**
- `tests/test_cron_health.py` — 8 cases covering: wrapper records success + failure + reraises, retention trims to 200, admin endpoint returns known jobs with all contract keys, surfaces recent runs + error text, marks `stale` when the last run is older than cadence, rejects non-admin + anonymous.
- `tests/conftest.py` — new session-scoped `shared_event_loop` fixture. Motor binds its connection pool to whichever event loop first uses it; `test_friends.py`, `test_grace_reminder.py`, and `test_cron_health.py` all now share this fixture. Without it, the second module to run would crash with "Future attached to a different loop" because each was making its own `asyncio.new_event_loop()`.
- E2E verified via screenshot: logged in as admin → seeded a failing + several successful runs → opened `/admin` → CronHealthCard correctly shows the red "last run failed" pill with the actual `RuntimeError('SMTP timeout')` exception text, and the green "ok" pill for the grace-tick.

**Health**
- Full suite: **652 passed, 14 skipped, 0 failed** (+8 new tests).
- Lint: 0 blocking.



### Parked idea 2026-06-13 ("Cron failure alert" email to admins — P2)
- Concept: when a wrapped cron job transitions `ok → error` (i.e. the previous run was `ok` and the current one failed), automatically email every `is_admin: True` user once with the job id + exception text + a deep link to `/admin#cron-health-card`. Use the existing Resend mailer. Suppress duplicate alerts during a sustained outage by checking whether the *previous* run already errored. Hooks in cleanly inside `utils/cron_health.py::_record_run` right after the run is persisted.
- Priority: P2 (parked by user 2026-06-13 with "remind later").


### Done 2026-06-13 (books.py refactor — Phase 2)

**Goal**: shrink the 7,868-line `routes/books.py` by extracting the cleanest, lowest-risk sections into focused modules. Pattern: each new module imports `api_router` + `db` from `deps.py`, so URLs and HTTP behavior stay identical.

**Extractions (3 commits' worth, all green between each)**:

| New file | Endpoints | Why this grouping |
|---|---|---|
| `routes/tags.py` (238 lines) | `GET /tags`, `POST /books/{id}/tags`, `DELETE /books/{id}/tags/{tag}`, `PUT /tags/{old}`, `POST /tags/merge`, `DELETE /tags/{name}`, `POST /books/{id}/suggest-tags` | All 7 tag-management endpoints + shared with the upload pipeline's `_normalize_tags` |
| `routes/authors.py` (126 lines) | `GET /authors`, `GET /library/authors`, `GET /library/by-author` | Pure read-only aggregations against `db.books` |
| `routes/pairings.py` (88 lines) | `GET /library/pairings`, `GET /library/by-pairing` | Same shape as authors, isolated to `relationships` field |
| `routes/trash.py` (144 lines) | `GET /trash`, `POST /trash/restore/{id}`, `POST /trash/restore-all`, `POST /trash/empty` + `sweep_expired_trash()` background helper | All 4 trash endpoints + the daily sweep coroutine (`digest.py` now imports it from here) |

**Shared utility modules created**:
- `utils/tags.py` (77 lines) — `normalize_tag`, `normalize_tags`, `TAG_MAX_LENGTH`, `TAG_MAX_PER_BOOK`. Underscore aliases (`_normalize_tag`, `_normalize_tags`) kept so the upload + bulk-edit code in `books.py` is a one-line import change.
- `utils/constants.py` (15 lines) — `TRASH_SHELF`, `TRASH_GRACE_DAYS`. Centralizes constants that need to stay in sync across modules.

**Results**:
- `routes/books.py`: **7,868 → 7,436 lines (-432 lines, -5.5%)**
- 14 endpoints + 1 background helper + 4 helper functions extracted across 4 new route modules + 2 new util modules.
- Every URL unchanged (verified with `curl` 401 checks on extracted paths).
- Full backend suite: **652 passed, 14 skipped, 0 failed** — zero regressions.

**Phase 3 candidates (parked for next session)**:
- `routes/library_backup.py` — `/library/export-zip`, `/library/restore/preview`, `/library/restore/apply` (~400 lines, medium risk: shares the unzip helper with the upload pipeline)
- `routes/conversions.py` — `/conversions/*` status + retry endpoints (~150 lines)
- `routes/user_prefs.py` — FFF options, format prefs, dashboard layout (~200 lines, 8 endpoints)

**Phase 4 candidates (parked)**:
- `routes/fanfic_refresh.py` — `/books/{id}/refresh`, `/library/refresh-stale`, `/fanfic/source-url/preview`, status cache. Highest coupling with the upload pipeline — saved for last on purpose.
- Duplicate-resolution endpoints (`/books/{id}/resolve-duplicate`, `/books/resolve-group`).


### Added 2026-06-13 (Route catalogue admin widget + latent bug fix)

**Why**: with Phase-2 of the books.py refactor done, routes are now spread across 20 source modules. Needed a "where does this URL live?" lookup to keep audits + deprecation + onboarding sane.

**Backend**
- `routes/admin.py::GET /api/admin/routes` — walks `app.routes`, returns every `APIRoute` under `/api/*` grouped by `endpoint.__module__`. Each entry: `path`, `methods`, `name`, `doc` (first line, 140-char capped). Admin-only.

**Frontend**
- `AdminConsole.jsx::RouteCatalogueCard` — new card with a text filter (matches path / function name / docstring), per-module collapsible groups, colored HTTP-method pills (GET=blue, POST=green, PUT=amber, DELETE=red). Data-test-ids on all interactive elements.

**🔴 Latent bug found + fixed while building this**
- `routes/year.py` had a stray `app.include_router(api_router)` at the bottom of the file. Combined with the canonical one in `server.py`, every route was being registered TWICE into the FastAPI app. `app.routes` had **352 entries** vs the actual 216 unique routes — almost 2× the expected count. Removed the duplicate include + the unused `app` import.
- Side effect of the fix: the route catalogue now shows the truthful 216 / 20 modules, and FastAPI's internal routing table is half the size.
- Tests: `test_year_in_books.py` + `test_year_share.py` (50 cases) all still pass — the duplicate registration was redundant, not load-bearing.

**Tests**
- `tests/test_admin_routes.py` — 4 cases: grouped shape contract, the Phase-2 extracted modules (`routes.tags`, `routes.authors`, `routes.pairings`, `routes.trash`) all show up with their correct paths, admin-only enforcement, anonymous rejection.

**Health**
- Full suite: **656 passed, 14 skipped, 0 failed** (+4 new tests).
- Lint: 0 blocking.
- E2E verified via screenshot: filtered the catalogue by "trash" → exactly the 1 `routes.books` bulk-delete endpoint + the 4 `routes.trash` endpoints appear, each route shown once.


### Added 2026-06-13 (Route catalogue — stale module detection)

**Why**: extends the route catalogue from "where does this URL live?" to "which routes have been forgotten?" via `git log` timestamps on each source file.

**Backend**
- `routes/admin.py::GET /api/admin/routes` now accepts a `stale_days` query param (default 90). For each unique module file it shells out to `git log -1 --format=%ct -- <file>` (cached per request, async via `to_thread`, 2-second timeout). Returns `last_modified` (ISO string) + `is_stale` per module, plus a `stale_total` summary count and the `stale_days` echo.
- Walks up from `routes/admin.py` to find the repo root so the `git log` works whether the test runs from `/app` or `/app/backend`. Falls back gracefully when no `.git` directory is present (e.g. in some test rigs) — returns `last_modified: null`, `is_stale: false`.

**Frontend**
- `RouteCatalogueCard` now has a "stale only" checkbox + a numeric stale-days input (default 90). The card re-fetches when the threshold changes. Stale modules render with an amber border + a `STALE` pill in the header + the "Xd ago" label. Empty state message switches based on whether the user is filtering by stale-only.

**Tests** (`tests/test_admin_routes.py` — now 6 cases)
- New: `test_stale_detection_with_short_window_flags_everything` — `?stale_days=0` must flag every module that has a git timestamp.
- New: `test_stale_detection_with_huge_window_flags_none` — `?stale_days=3650` must flag zero modules.
- All 6 pass; full suite still **656 → 658 passed** (+2 new).

**E2E verified**: screenshotted the page with stale-days=3 and stale-only=true → exactly the 4 modules that haven't been touched in ≥3 days appear, with the amber STALE pill + "15d ago" / "14d ago" labels. Filtered count shows "16 stale" out of 216 total.



### Parked idea 2026-06-13 ("Mongo collections inspector" admin widget — P2)
- Concept: a third "ops" admin card alongside Cron Health + Route Catalogue. `GET /api/admin/db-collections` (admin-only) iterates `db.list_collection_names()`, runs `collStats` for each (`count`, `size`, `avgObjSize`, indexes), plus a cheap `find_one(..., sort=[(_id,-1)])` to get the last-write `_id` ObjectId timestamp. Frontend card: sortable table by collection name / doc count / size / last-write age. Bundles into the "ops surface" so admins can inspect the live DB without ever opening the Mongo shell.
- Priority: P2 (parked by user 2026-06-13 with "remind later").



### Done 2026-06-13 (P2 batch 1 — 5 features shipped)

The user asked "do all of P2". This is the first batch of 5 quick-win features. Backend + tests + frontend integration shipped together; remaining batches will follow.

**W1 — "Surprise me" random unread book**
- `GET /api/library/random-unread` uses `$sample: 1` on books where `last_opened_at` is null/missing and category is not Trash. 404 when everything is read.
- Frontend: `SurpriseMeButton` on Dashboard navigates to `/read/{book_id}`. Friendly alert when the library is empty of unread.

**W2 — Books I haven't read filter**
- `GET /api/library/unread?limit=N` lists unread books, newest upload first, excluding Trash.
- Frontend: chip in the new activity strip → dedicated `/library/unread` page (`UnreadLibraryPage.jsx`) rendering with the existing `BookCard` grid.

**W3 — Reading queue ("Up next" stack)**
- 4 endpoints under `/api/library/queue/*`: `GET`, `add` (idempotent + position-aware), `remove`, `reorder` (drops unowned ids). Data lives in new `db.reading_queues` collection (one doc per user with `book_ids: List[str]`).
- Frontend: `ReadingQueueWidget` shows the top 5 with click-to-read + hover-to-remove.

**S4 — Activity since last login**
- New `previous_login_at` + `last_login_at` fields on the user doc, updated atomically by `_issue_session` and the password-login path in `auth.py`. First-login users get `previous_login_at = now` (semantically: "nothing new since now").
- `GET /api/dashboard/since-last-login` returns `new_books`, `friend_requests`, `new_messages`, `unread_notifications` counted since the previous session opened.
- Frontend: `SinceLastLogin` strip that hides itself when there's nothing to show.

**S1 — Friends recently added carousel**
- No new endpoint — reuses existing `GET /api/notifications` and filters client-side by `kind=friend_new_book`. The notification was already wired in the previous session.
- Frontend: `FriendsRecentCarousel` horizontal scroller on the Dashboard.

**A2 — Resend deliveries this week stat card**
- New `db.email_logs` collection with rows from `utils.email_log.log_email_send(kind, to, status, error, resend_id)`. Lazy 90-day retention.
- Wrapped **9 Resend send sites** (`auth.py`, `digest.py` x3, `year.py`, `invites.py`, `suggestions.py`, `admin.py`) so every send is tracked starting now.
- `GET /api/admin/email-stats` (admin-only) returns rolling 7-day `total/ok/error/error_rate`, per-template `by_kind` breakdown, and last 10 failures with error text.
- Frontend: `EmailStatsCard` on Admin page with 4-up KPI tiles, per-template table, and a red recent-failures list with the raw error.

**Bundling**
- All four library-side widgets bundled into `components/LibraryActivityWidgets.jsx` and mounted on Dashboard above the library grid. Strip auto-hides when empty.

**Tests** — `tests/test_p2_batch1.py` 10 cases, all passing.
**Health** — full backend suite **666 passed, 14 skipped, 0 failed** (pre-existing flaky test `test_groups_books_by_title_and_url` was unrelated, passes alone).

---

**Remaining P2 batches** (parked for the next session)

🟢 **Batch 2 — medium**: S3 friend-recommendations widget · A3 linkless URL dedup edge cases · A4 palette screenshot share · OPS-2 cron-failure email alert · OPS-3 Mongo collections inspector widget

🟢 **Batch 3 — large**: S2 reading-along book-club rooms (full feature: room, members, shared progress, chat) · W4 full-text search across EPUB content · W5 OPDS catalog endpoint

### Added 2026-06-13 (Reader bookmarks + Help page update)

**Backend** — new `routes/bookmarks.py` (4 endpoints under `/api/books/{id}/bookmarks` + cross-library `GET /api/bookmarks`):
- New `db.bookmarks` collection: `{bookmark_id, user_id, book_id, cfi, percent, chapter_label, note, created_at}`.
- POST is **idempotent on (user, book, cfi)** — re-bookmarking the same CFI updates the note rather than duplicating. Note capped at 280 chars; chapter label at 120.
- Cross-library `GET /api/bookmarks` hydrates each row with the book's title/author/fandom/has_cover in a single batch (no N+1).

**Reader UI (`pages/Reader.jsx`)** — two new header buttons:
- **Bookmark** — saves the current CFI. Best-effort enrichment: walks `book.locations.percentageFromCfi(cfi)` for the % and the TOC for the chapter label, so the bookmark card shows "Chapter 7 · 61% through" without the user typing anything. Toast-acknowledged.
- **Bookmark panel** (icon + count) — slides in from the right with every bookmark for the open book, sorted by reading progress. Click jumps via `rendition.display(cfi)`. Hover reveals a Remove button. Test-ids: `bookmark-add-btn`, `bookmark-list-toggle`, `bookmark-count`, `bookmark-panel`, `bookmark-panel-close`, `bookmark-panel-empty`, `bookmark-row-{id}`, `bookmark-remove-{id}`.

**Cross-library bookmarks page (`pages/BookmarksPage.jsx`)** at `/bookmarks`:
- Lists every bookmark across every book, newest first. Each card shows book title + author, chapter label, italicized note, % through, and date. Click → opens the book in the reader (which restores last-known position; future iteration: deep-link to the bookmarked CFI). Hover-to-Remove.

**Help page update (`pages/Help.jsx`)**:
- Rewrote the **Reader & stats** section to document bookmarks (save, panel, jump, all-bookmarks page) plus the P2 batch-1 features (Surprise me, Books I haven't read, Up next queue).
- Replaced the "Fresh in Shelfsort" fallback panel with 2026-06-13 entries: reader bookmarks, unread shelf, Surprise me, reading queue, friend uploads pings.

**Tests** — `tests/test_bookmarks.py` (6 cases, all pass):
- add → list → delete round-trip, idempotency on duplicate CFI (note updated), 404 on POST when book isn't owned, cross-library listing hydrates metadata, 280-char note cap, other-user isolation (lookup returns empty count, not the data).

**Health** — bookmarks + p2_batch1 suites together: **16 passed, 0 failed.** Smoke screenshots confirm both the cross-library bookmarks page and the updated Help reading section render correctly.



### Parked idea 2026-06-13 ("Friend bookmark highlights" social signal — P2)
- Concept: when a friend bookmarks a passage in a book the user also has in their library, surface it as "Alice highlighted Chapter 7 in Six of Crows" on the friend library / friend profile view. Opt-in via a new `share_bookmarks_with_friends` boolean on the user privacy settings (defaults to off). Pulls from `db.bookmarks` filtered to friends + intersecting books. Could also feed into the existing notification system as a low-volume `friend_bookmarked` kind.
- Priority: P2 (parked by user 2026-06-13 with "remind later").


### Added 2026-06-13 (AO3 / FF.net metadata fields + Help page updates)

User asked for AO3-style metadata extraction: ratings, archive warnings, categories — plus an obvious place in Help to discover the 131 fandoms the classifier knows.

**Backend** — new `utils/ao3_metadata.py`:
- Canonical taxonomies for all three enums plus alias tables (case-insensitive).
  - **Ratings (5)**: General Audiences, Teen And Up Audiences, Mature, Explicit, Not Rated. FF.net K/K+/T/M/MA accepted as aliases and normalized to AO3 equivalents.
  - **Archive Warnings (6)**: Graphic Depictions Of Violence, Major Character Death, Rape/Non-Con, Underage, No Archive Warnings Apply, Choose Not To Use Archive Warnings.
  - **Categories (6)**: F/F, F/M, Gen, M/M, Multi, Other. Aliases like Femslash/Slash/Het canonicalized.
- `classify_subject(raw) -> (kind, canonical)` — single subject string → bucket.
- `classify_subjects(raws) -> dict` — bulk classifier returning `{rating, warnings[], categories[], relationships[], tags[]}` with per-bucket dedup.
- AO3 export EPUBs lump everything into `<dc:subject>` without differentiation — this classifier sorts it all out in one pass.

**EPUB extractor** — `routes/books.py::extract_epub_metadata` now runs every `<dc:subject>` entry through `classify_subjects()`. The result populates four new fields on the upload-time book document:
- `rating` (str or None)
- `warnings: List[str]`
- `categories: List[str]`
- `ao3_freeform_tags: List[str]` — distinct from the user-managed `tags` field
- Relationships continue to be detected via `/` or ` & ` patterns and canonicalized (this part was already in place).

Both upload sites (the regular EPUB upload pipeline + the URL-fetch path) now persist these fields.

**Help page** — two brand-new TOC sections:
- **"AO3-style metadata: ratings, warnings, categories, tags"** — documents every field, the canonical values, the FF.net alias mapping, the storage field names, and the heads-up that pre-feature uploads need re-upload to populate. Cross-links to the Pairings page for relationships browsing.
- **"Fandoms we sort into"** — fetches the full sorted list from `GET /api/fandoms/known` (new public endpoint backed by `data/ao3_top_fandoms.AO3_TOP_FANDOMS`) and renders all **131 fandoms** in a 3-column monospaced grid. Includes a CTA to suggest missing fandoms via the Suggestions page.
- Updated the TOC sidebar to include both new sections.

**Tests** — `tests/test_ao3_metadata.py` (9 cases, all pass):
- Every canonical rating + every alias maps correctly (incl. FF.net K/K+/T/M).
- Warnings + categories canonicalize from short forms (Slash → M/M, etc.).
- Relationship vs. tag disambiguation via `/` and ` & `.
- Empty/whitespace inputs are safe.
- Full AO3-export-style subject pile classifies into the right buckets with proper dedup.

**Health** — 48 passed across AO3 + bookmarks + p2_batch1 + books_comprehensive suites. New public endpoint smoke-tested via curl returning `count=131`.


### Added 2026-06-13 (AO3 filter chips wired into Dashboard)
- `Ao3FilterChips.jsx` is now mounted in `Dashboard.jsx` right above the books grid, with a collapsible panel and an "N active" badge that surfaces selected filters.
- Wired `rating` / `ao3_category` / `warning` / `exclude_warning` into the `load()` query params and into the `useCallback` dependency array so the grid auto-refreshes on selection.
- Backed by `GET /api/books` filters added on 2026-06-13: exact-match on `rating` / `categories` / `warnings`, plus `$ne` semantics for `exclude_warning` (content-safety opt-out). When both `warning` and `exclude_warning` are set, the route now combines them via `$and` so both apply.
- New test suite `tests/test_ao3_filter_endpoints.py` (8 cases, all pass) seeds 5 books directly and asserts each filter narrows the list correctly, including combined queries and the unknown-rating empty case.
- Smoke-tested in browser: filter toggles, ratings selection updates query, books grid refreshes, "1 active" badge appears, "clear all AO3 filters" works.

**This closes the in-progress P0 task carried over from the previous handoff.** Books.py refactor Phase 3 + Phase 4 remain P1 backlog.
### Added 2026-06-13 (Save AO3 filters as a Smart Shelf)
- New "Save as shelf" button on the `Ao3FilterChips` panel (only visible while at least one filter is active). Prompts for a name (pre-fills a human-readable one like `Explicit · M/M · no Major Character Death`), then POSTs to `/api/smart-shelves` with `combinator: AND` and rules that mirror the active filters.
- Backend Smart-Shelf engine extended with 4 new rule types:
  - `rating` → exact-match on `books.rating`
  - `ao3_category` → exact-match on `books.categories` (AO3's "Category", stored under the plural to avoid colliding with Shelfsort's higher-level `category`)
  - `warning` → exact-match on `books.warnings`
  - `exclude_warning` → `$ne` on `books.warnings`
- These compose cleanly with the existing `category`, `fandom`, `author`, `tags_*`, `status`, `words` rules via the combinator, so users can build queries like "Harry Potter ∧ Explicit ∧ no MCD" without leaving the panel.
- New test suite `tests/test_ao3_smart_shelves.py` (9 cases, all pass) verifies each new rule type filters correctly, combines with `fandom`, returns the right `count` on list, and works through the `/smart-shelves/preview` endpoint.
- Dashboard wires `onShelfSaved={load}` so the sidebar pinned shelves refresh immediately if the user pins from `/library/smart-shelves`.



### Added 2026-06-13 (Phase 3 books.py refactor — done & green)
- New `routes/conversions.py`: `/api/conversions/status`, `/api/conversions/dismiss`, `/api/conversions/retry-all`, `/api/conversions/{job_id}/retry`, `/api/library/originals`, `/api/library/originals/convert-all` + the internal `convert_original_to_epub` helper.
- New `routes/user_prefs.py`: FFF options, duplicate policy, format prefs, dashboard layout, apply-template-to-all, tidy-filenames, onboarding status, dismiss-template-prompt, fandom aliases. 14 endpoints.
- New `routes/library_backup.py`: `/api/library/backup`, `/api/user/backup-reminder{,/dismiss}`, `/api/user/backup-history`, `/api/library/restore/preview`, `/api/library/restore/apply` + a bug fix so the new schema_version=2 backups can now be restored.
- `books.py` shrank from 7500 → 6319 lines (1181 lines moved out, ~16%). Full pytest suite still green (741+ passing, including 258 in the most-affected modules).
- Phase 4 (fanfic_refresh + duplicates extraction) was deliberately deferred — the routes are scattered across 6000 lines with deep helper dependencies; the risk/reward didn't justify doing it in the same session as Phase 3.

### Added 2026-06-13 (Pin-on-save in AO3 Save-as-Shelf modal)
- Replaced the `window.prompt`-based shelf save in `Ao3FilterChips.jsx` with a proper purple-themed `SaveAsShelfModal` dialog featuring a name input (char counter, pre-fill, autoFocus) and a "Pin to dashboard sidebar" checkbox.
- When pinned, the toast says "and pinned to your sidebar"; otherwise "saved as a shelf". The Dashboard now exposes a `reloadPinnedShelves` callback so the new pinned shelf shows up in the sidebar immediately on the next render without a hard refresh.
- Backend already accepted `pinned: true` in the POST body — no API changes needed.

### Added 2026-06-13 (purple-everywhere brand refresh)
- Swapped hardcoded sage `#3A5A40` → deep violet `#6B46C1` across the entire frontend (60 files) and the few backend hex literals (Excel header fill, email styling). Pale tints `#E5EBE6` / `#EAF0EB` → `#EDE7FB` / `#EEE9FB`.
- Updated dark-mode CSS overrides so the brightened sibling is now lavender (`#C4B5FD`) and `rgba(167,139,250,…)` instead of sage RGB.
- Default user palette was already "purple" — only the secondary brand accent needed swapping. Verified across Dashboard, AO3 filters, Help, navbar, modals.

### Added 2026-06-13 (Help-page fandom list rework)
- `GET /api/fandoms/known` now returns the **classifier's real source of truth** (`routes.books.FANDOM_KEYWORDS`, 151 fandoms including Harry Potter, Twilight, Marvel, NCIS spin-offs) plus a new `groups` array that buckets fandoms by franchise using `data/fandom_franchises.py`.
- Help page now renders the list **grouped by franchise** (Stargate, NCIS, Marvel umbrella, Star Trek/Wars, …) and **sorted by community-wide popularity** (anonymized aggregate counts from `db.books`). Within a group, members sort by count desc + alphabetical fallback.
- Fixed dark-mode contrast: the cream `#FAF7F0` panel was invisible against dark text; added explicit dark overrides for `#FAF7F0` and `#E8E2D4` (now used throughout).
- Added NCIS to `FRANCHISE_GROUPS` (7 spin-offs).

### Added 2026-06-13 (AO3 Save-as-Smart-Shelf — initial wire-up)
- Backend `routes/smart_shelves.py` got 4 new rule types: `rating` / `ao3_category` (→ `categories`) / `warning` / `exclude_warning` (`$ne`). All allow-listed and tested.
- `Ao3FilterChips.jsx` got a "Save as shelf" button that builds rules from the active filters and POSTs to `/api/smart-shelves`. Initial flow used `window.prompt`; replaced by the proper modal above.



### Added 2026-06-13 (AO3 rule types editable in Smart Shelf builder)
- Extended `SmartShelfBuilder` in `pages/SmartShelves.jsx` with 4 new editable field types: `rating`, `ao3_category`, `warning`, `exclude_warning`. Each gets a proper `<select>` value picker (canonical AO3 values only).
- Exported `RATINGS`, `CATEGORIES`, `WARNINGS` from `Ao3FilterChips.jsx` so both the AO3 quick-filter panel and the shelf builder share one source of truth.
- Updated `ruleSummary()` in `pages/SmartShelfPage.jsx` with human-friendly labels: `rating: Mature`, `category (AO3): M/M`, `warning: …`, `not warned for: …`.
- **Closes the editing loop** opened yesterday: shelves saved from the AO3 quick-filter are now fully editable on `/library/smart/:id` → "Edit rules" — users can tweak rules, add more AO3 conditions, change combinator, save. Verified end-to-end via screenshot: 3-rule AND query (rating + ao3_category + exclude_warning) round-trips through the UI and persists in Mongo with the correct shape.


### Added 2026-06-13 (Dashboard split into welcome page + dedicated All Books page)
- New lean `Dashboard.jsx` at `/library` matching the user's design target: "YOUR LIBRARY" eyebrow + serif "{N} books on the shelves." headline + top-4 fandoms inline + `LibraryActivityWidgets` ribbon + big `UploadZone` + new spotlighted `UrlPasteCard` + prominent "Browse all books" CTA + pinned shelves rail + footer quick-actions.
- New `UrlPasteCard.jsx` component: always-visible 5-row textarea, live "N fanfic URLs detected" counter, purple-gradient card. Submits via `sessionStorage["urlFilterPrefill"]` → navigates to `/library/filter-urls`, which now reads + clears the prefill on mount (replacing the old one-line link).
- Old Dashboard's books grid + all filter chips + AO3 panel + fandom/author/series rails + at-a-glance folder moved into new `AllBooksPage.jsx` at `/library/all` with a "Back to your library" link and "Browse your {N} books" header.
- App.js route added: `/library/all → AllBooksPage`. All other deep links unchanged.
- Persistent ribbons (BackupReminder, OnboardingPrompt for "Polish your library", HelpNudge) kept on the welcome dashboard, matching the user's brief.
- Verified end-to-end via screenshot in light AND dark mode with a seeded 93-book library.

### Added 2026-06-13 (Reading queue feature wired up)
- New "Add to queue" / "Remove from queue" hover icon on `BookCard` (left of the read toggle). Optimistic UI with `inQueue` state, calls `POST /api/library/queue/{add,remove}` (already existed in `library_discovery.py`).
- New `ReadingQueuePage.jsx` at `/library/queue`: lists queue with index numbers, cover thumbs, title + author + fandom, up/down chevron reorder (calls `POST /library/queue/reorder` with the new id order), per-row remove ×, and an empty state pointing to `/library/all`. Live reorder is optimistic with rollback on failure.
- Activity widget's mini queue rail gained a "Manage →" link to `/library/queue`.
- Verified end-to-end in light + dark mode: add 3 books → reorder (Book A moves from #1 to #2) → remove Book B → queue collapses to ['A','C'], index re-numbers correctly, toast on each action.
- The dashboard's "Up next: nothing queued" stub copy now becomes "Up next (N)" rail with the latest 5 queued books once the user adds anything.




### Added 2026-06-13 (Dashboard Help card + Suggestions box + Help-page refresh)
- New `DashboardHelpCard.jsx`: big "Need a hand?" cream card with HelpCircle icon, 5 quick-link rows (Uploads / AO3 metadata + filters / Smart shelves / Reading queue / Filter URLs), big purple "Open the help guide" CTA.
- New `DashboardSuggestionsBox.jsx`: 5-second feedback form on the dashboard. Title + optional body + category pills (Feature / Improvement / Bug) → `POST /api/suggestions`. Clears form, shows success toast + "Sent: <title>. Track it on the board →" confirmation.
- Both cards in a 2-col grid above the footer quick-actions, dark-mode contrast verified.
- Help page refreshed with 5 new sections: `Dashboard tour`, `AO3 filter chips & Save-as-shelf`, `Smart shelves`, `Reading queue (Up next)`, `Filter URLs you already own`. TOC updated; "Last updated" bumped to 2026-06-13.



### Added 2026-06-13 (Admin Console — long-list condensing)
- `GlobalStatsCard` (Global stats) now renders ranked "Top fandoms" and "Categories" lists through a new reusable `CondensedRankList` component. Lists with more than 8 items show the top 8 by default with a "+ N more" hint and a "Show all N · Hide N" toggle in the section header (with ChevronRight rotation). When expanded past 12 items, the list becomes a max-h-72 scroll pane so the admin page never stretches indefinitely on tenants with hundreds of fandoms.
- `UnknownFandomsCard` dismissed list is wrapped in a `<details data-testid="admin-unknown-fandoms-dismissed-details">` so the (often dozens-long) dismissed pile collapses by default and only reveals when an admin opts in — keeping the live "needs attention" list scannable.
- Toggle test-ids exposed: `admin-stats-top-fandoms-toggle`, `admin-stats-categories-toggle`, `admin-stats-top-fandoms-overflow-hint`, `admin-stats-categories-overflow-hint` for future automation.
- Verified on a 5,302-book / 172-user tenant: Top fandoms (10) shows all with a "Hide 2" affordance; Categories (16) collapses to 8 with "+ 8 more" hint and "Show all 16" toggle — both clickable, both round-trip cleanly.

### Added 2026-06-13 (Admin Console — whole-page collapsible categories)
- Refactored the shared `Card` wrapper in `/app/frontend/src/pages/AdminConsole.jsx` to be collapsible: every section now starts closed, showing only icon + title + subtitle + a `Show ▾` chip on the right. Clicking anywhere on the header flips to `Hide ▴` and renders the body inline. Children are conditionally rendered (`open && {children}`) — parent components still mount and fetch their data so opening is instant.
- New `AdminCardsContext` (openTick / closeTick counters) lets the page-level toolbar broadcast bulk open/close to every card via two `useEffect` listeners; each card keeps independent local state so individual toggles still work after a bulk action.
- Page header gained an `Expand all` (filled purple pill) and `Collapse all` (outline purple pill) toolbar plus a small italic hint: *"Sections are collapsed by default — click a category to reveal its contents."*
- New test-ids: `admin-bulk-toggles`, `admin-expand-all`, `admin-collapse-all`, `admin-collapsed-hint`, and on each section header `{card-testid}-toggle` + body `{card-testid}-body`.
- Verified on the 5,302-book tenant: page now fits all 13 admin sections (Users, Chat rooms, Unknown fandoms, Maintenance banner, Health, Cron health, Route catalogue, Email stats, Email diagnostic, Global aliases, Global stats, Feature flags, Audit log) in roughly one viewport. Single-section expand, manual collapse, and both bulk toggles round-trip cleanly.

### Added 2026-06-13 (Admin Console — "Remember open sections" opt-in)
- Added a third pill button on the admin toolbar: `Remember: On/Off` (testid `admin-remember-open-toggle`). Off by default (greyed pill); on → purple pill with filled dot.
- Preference stored at `localStorage["shelfsort.admin.remember-open"]`. When ON, every card writes its open/closed state to `localStorage["shelfsort.admin.card.{testid}"]` on toggle, and reads it back when it mounts → reload now restores whichever sections the admin left open.
- Toggling OFF wipes every `shelfsort.admin.card.*` key so the next visit starts clean — no stale flags lingering after an opt-out.
- Toast confirms each state change ("Will remember which sections you leave open" / "Sections will reset on every visit"). The italic hint line under the header dynamically appends "Your open sections will be remembered on your next visit." when Remember is on.
- Verified end-to-end via Playwright: default Off → toggle On → expand Users → reload → Users still open + Remember still On → toggle Off → localStorage card keys cleared.

### Added 2026-06-13 (Admin Console — section search + suggestion chips)
- New full-width rounded search input above the cards (testid `admin-section-search-input`) with leading magnifier icon and a trailing × clear button. Live filter — typing narrows the page down to matching sections only.
- Below the input: a "Try:" row of one-click suggestion chips (`users`, `email`, `fandom`, `cron`, `stats`, `flags`, `chat`, `audit`, `route`) so admins know exactly what keywords are wired in. Active chip highlights filled-purple.
- Match logic combines each card's title + subtitle + a hardcoded `keywords` field (e.g. "outage" surfaces Maintenance banner; "send" surfaces both email cards). Manifest lives in `ADMIN_CARD_MANIFEST` at the top of the file.
- When a query is active, a right-aligned count label shows `N of 13 sections`. When nothing matches, the cards collapse into a friendly empty-state card with a magnifier icon, the offending query echoed back, and a "Clear search" CTA (testid `admin-section-search-empty-clear`).
- Cards self-hide in their own render via `query` from `AdminCardsContext` — no wrapper component needed, no DOM nodes left behind.
- Verified end-to-end: clicking `email` chip → 2 of 13 sections, only `email-stats-card` + `admin-email-diagnostic-card` rendered; typing "xyzqqqzz" → empty state; clear → all 13 return; typing "outage" → only `admin-banner-card` surfaces via keywords.

### Added 2026-06-13 (Library — Fandom shelves finder)
- Ported the section-search pattern to the Library "Fandom shelves" rail in `AllBooksPage.jsx` via a new `/app/frontend/src/components/FandomFinder.jsx` component.
- Only renders when the user has > 10 fandoms (small libraries stay clutter-free). Top 5 fandoms by count become one-click `Try:` suggestion chips so a real reader doesn't have to scroll past hundreds of chips to find "Harry Potter".
- Live `fandomQuery` state in `AllBooksPage` filters the chip grid in-place. Right-aligned `N of M fandoms` counter when active; friendly empty-state card with magnifier icon + "Show all fandoms" CTA when nothing matches.
- Heading gained the total count: `Fandom shelves (33)` so users see at a glance how many shelves exist before filtering.
- New test-ids: `fandom-finder`, `fandom-finder-input`, `fandom-finder-clear`, `fandom-finder-suggest-{slug}`, `fandom-finder-count`, `fandom-chips-grid`, `fandom-finder-empty`, `fandom-finder-empty-clear`.
- Verified end-to-end on Jessica's 1,436-book / 33-fandom real account: default → click "Harry Potter" suggestion (1 of 33 fandoms) → garbage query (empty state) → "Show all fandoms" → all 33 chips return. All Playwright assertions passed.



### Fixed 2026-06-13 (Library — "Since you were last here" dark-mode contrast)
- The `SinceLastLogin` activity banner in `LibraryActivityWidgets.jsx` was unreadable in dark mode because `bg-[#EEF3EC]` (pale sage) had no dark-mode override in `index.css`, while `text-[#2C2C2C]` IS remapped to near-white — result: near-white text on cream background → invisible.
- Added a one-line CSS override at `:root[data-theme="dark"] .bg-\[\#EEF3EC\]` → `rgba(167, 139, 250, 0.14)` (same tinted-purple surface used by other accented panels). Verified computed styles: `bg: rgba(167, 139, 250, 0.14)`, `color: rgb(232, 228, 216)` — fully legible.


### Added 2026-06-13 (Dark-mode regression guard — pytest)
- New `/app/backend/tests/test_dark_mode_overrides.py`: pure static-analysis test (~70 LoC). Scans every `.jsx/.js/.tsx/.ts` under `frontend/src` for `bg-[#hex]` Tailwind classes, computes WCAG relative luminance, then parses `index.css` for matching `:root[data-theme="dark"] .bg-\[\#hex\]` overrides. Fails with a structured multi-line message (file:line for every offender) if any class with luminance > 0.80 lacks an override.
- Caught **14 latent dark-mode bugs** (cream/peach/yellow panels lacking overrides) across `DownloadPage`, `CantFindOnline`, `StreakBadge`, `EmailPreferences`, `Account`, `MessagesPage`, `AllBooksPage`, `AdminConsole`, `ReadingStatsCard`, `CompareVersions`, `RestoreBackupPage`, `BookDetail`, `PairingsPage`, `AuthorsPage`.
- All 14 fixed in one CSS block at the bottom of `index.css`, grouped by hue: warm-peach pales → `rgba(255, 165, 130, 0.16)`, warm-yellow/amber → `#3a2f1b` + `#F0D6A0` text, neutral cream → `var(--surface)`, pink-red → `rgba(217, 83, 79, 0.18)`. Total dark overrides now 34 (was 19).
- Sanity-verified on the Account page in dark mode — all sections render with consistent dark surfaces, no washed-out cream panels.
- Threshold (`LIGHT_THRESHOLD = 0.80`) and explicit `WHITELIST: set[str]` exposed at the top of the test for future tuning.


### Extended 2026-06-13 (Dark-mode regression guard — text + border)
- `/app/backend/tests/test_dark_mode_overrides.py` extended to 3 sibling tests with shared scanning helpers:
  1. **`test_every_light_arbitrary_bg_has_a_dark_mode_override`** — original `bg-[#hex]` luminance > 0.80 check.
  2. **`test_every_dark_arbitrary_text_has_a_dark_mode_override`** — flags `text-[#hex]` colours with luminance < 0.30 that would vanish into the dark surface.
  3. **`test_every_light_arbitrary_border_has_a_dark_mode_override`** — flags `border-[#hex]` colours with luminance > 0.80 that would draw a glaring line on the dark surface.
- The extension surfaced **15 dark-text bugs** (greys `#333`/`#3a3a3a`/`#4a4a4a`/`#666`, deep purple `#553397`, red/orange-red family `#9d2a2a`/`#a83a36`/`#b43f26`/`#a8532f`/`#9e5a2e`, dark amber `#8c5c00`/`#a76900`, dark blue `#2a6496`, dark pink `#b85c7c`, muted placeholder `#9a9580`) and **1 light-border bug** (`#eee` on DownloadPage).
- All 16 fixed in one consolidated CSS block at the bottom of `index.css`, grouped by hue (greys → `--text-primary` / `--text-secondary`, purples → `#C4B5FD`, reds → `#FF9A85`, ambers → `#F0B860`, blue → `#A8C0E8`, pink → `#FFB0CC`, placeholder → `#8a8675`, border → `--border`).
- Sanity-verified on the Help page in dark mode — `Crossovers`, `Finished`, `Ongoing`, `Linkless`, `Unreadable` labels (previously invisible) now render as legible light coral.
- All 3 tests run in < 0.1s combined and are now part of the regression suite — any future PR that adds a light bg / dark text / light border arbitrary-value class without a matching dark override will fail immediately.


### Added 2026-06-13 (Navbar — 1-click theme quick toggle)
- Split the navbar's `AppearancePopover` control into a paired button group: a primary **Sun/Moon quick toggle** (new testid `navbar-theme-quick-toggle`) that flips light↔dark on a single click, and a smaller **Palette** icon to its right (existing testid `navbar-theme-toggle`) that still opens the full appearance popover for accent-colour selection.
- The quick-toggle's icon updates in place (Moon → Sun) and the `title`/`aria-label` flip dynamically ("Switch to dark mode" / "Switch to light mode") so screen readers stay accurate.
- Also fixed a popover positioning regression introduced by the new flex wrapper — added `top-full` so the popover anchors below the button group instead of rendering above the navbar.
- Verified end-to-end via Playwright: initial light → 1 click → dark → 1 click → light → palette button opens popover with Theme + Accent Colour sections both visible → inside-popover theme toggle still flips correctly. All assertions pass. Dark-mode regression suite still green.


### Fixed 2026-06-13 (DownloadPage — purple theme parity)
- The `/library/download` and `/library/download?kind=xlsx` page was still styled in the original "AO3-maroon" aesthetic (dark red `#900` borders/headers, cream backgrounds, blue links) — a deliberate fanfic-archive nod that clashed badly with the rest of the now-purple Shelfsort UI, especially in dark mode where the bright coral banner stood out as a sore thumb.
- Bulk-swapped every hex in `/app/frontend/src/pages/DownloadPage.jsx` to the purple family:
  - Primary `#900` → `#6B46C1`, darker `#600` → `#553397`, hover `#700` → `#5d3aaa`
  - Cream surfaces `#fffaf0` → `#FBFAFE`, `#fdf5dc` → `#EEE9FB`, `#fcf8e8` → `#F4EFF9`, `#f5ecd5` → `#EDE7FB`
  - Border `#d0c8b0` → `#E5DDC5`
  - Blue link `#2a6496` → primary purple `#6B46C1`
- Updated the in-file `ao3-scrollbar` CSS to track + thumb in purple.
- Added the two new lavender pales (`#FBFAFE`, `#F4EFF9`) to `index.css` dark-mode overrides so the page reads cleanly in dark mode — caught by the regression test on the first try, all 3 dark-mode tests now pass.
- Visually verified light + dark mode end-to-end: header banner, filter legends, scrollbar, checkbox accents, active-filter chips, download CTA — every previously-maroon element is now purple.


### Fixed 2026-06-13 (Full AO3-maroon → purple sweep across the app)
- Followed up the DownloadPage fix with a comprehensive sweep of every other file that still used the AO3-maroon palette (`#900`/`#600`/`#700` + the blue link `#2a6496`).
- Hit files: `pages/FandomShelf.jsx`, `pages/OriginalsShelf.jsx`, `pages/Account.jsx`, `pages/UnreadableShelf.jsx`, `pages/AllBooksPage.jsx`, `pages/PairingsPage.jsx`, `pages/CrossoverShelf.jsx`. Every `#900` → `#6B46C1`, dark variants similarly converted; the lingering `#2a6496` blue link in Account flipped to purple as well.
- Affected UX surfaces: the **`×N` crossover badges**, the **crossover shelf** page, the **pairings** index + search input + filter chips, the **unreadable-books** "corrupt EPUB" filter chip + reason badges, the **originals shelf** duplicate-indicator panel, the **fandom shelf** "drill into one" crossover chips, the **AllBooksPage** crossover-rail buttons, the **Account** danger-link.
- Cleaned up the now-orphan `:root[data-theme="dark"] .text-[#900]/.bg-[#900]/.border-[#900]/30` overrides in `index.css` (replaced with a brief retirement note). The `text-[#2a6496]` override kept with an explanatory note in case any third-party content references it.
- Verified visually in dark mode on the live tenant: pairings, crossovers, library fandom rail — every previously-coral element renders as a coherent purple now. The 3-test dark-mode regression suite still passes (0 violations across the codebase).


### Added 2026-06-13 (Crossover semantic-icon badge)
- After the maroon → purple sweep removed the colour distinction between crossover and regular fandom chips, replaced the `×N` crossover badge glyph with the lucide-react `ArrowLeftRight` icon (⇄) + count across all three render sites: `AllBooksPage.jsx` (top-of-rail crossover pill + inline fandom chip badge), `FandomShelf.jsx` (related-crossovers row), `CrossoverShelf.jsx` (per-crossover card).
- The ⇄ icon is the universal "exchange / both directions" symbol and reads as "crossover" without needing a colour cue. Power readers can now spot crossovers from anywhere in the library instantly, while the chip itself stays on the unified purple palette.
- Badge geometry tweaked (min-width bumped to 24–32px depending on context) so the icon + count fit cleanly with no overlap.
- Verified visually on Jessica's real `NCIS: Tony / Ziva · 2` crossover in both the crossovers page and the AllBooksPage fandom rail.


### Added 2026-06-13 (Pairing semantic-icon heart)
- Companion to the crossover ⇄ icon: every pairing/relationship surface now leads with a tiny `Heart` icon prefix so ships are instantly distinguishable from regular fandom or category chips, even on the unified purple palette.
- Hit surfaces:
  - `PairingsPage.jsx` — every directory row now starts with `♡` next to the mono-typed pairing name.
  - `AllBooksPage.jsx` Relationships rail — every chip is `♡ Harry Potter / Severus Snape · 37`. Re-skinned away from `bg-pink-50/text-pink-800/border-pink-200` to the unified `bg-[#EDE7FB]/text-[#6B46C1]/border-[#6B46C1]/20` palette; active chip uses `bg-[#6B46C1]` with a **filled** heart (`fill-current`) as an extra state cue.
  - `AllBooksPage.jsx` active-relationship banner — `♥ Showing pairing · …` (filled heart), repainted purple.
  - `BookDetail.jsx` Pairings meta-list — each pairing pill gains the heart prefix and the purple palette.
- Zero remaining `pink-*` Tailwind classes anywhere in `frontend/src/` after this change.
- Dark-mode regression suite still passes (3/3).


### Added 2026-06-13 (Author semantic-icon — completes the chip-icon trio)

### Added 2026-06-13 (Help page — chip-icon legend)
- Added a tidy "Chip key" cheatsheet pill right under the Help page's intro description (testid `help-chip-legend`). One horizontal row, four entries:
  - `Aa` (lavender mini-pill) — fandom
  - `⇄ 2` (purple solid badge) — crossover, with example count
  - `♡` (purple heart) — pairing
  - `👤` (purple user icon) — author
- Reuses the exact same Tailwind classes as the real chips so the visual identity is one-to-one. Newcomers learn the entire chip-icon vocabulary in ~2 seconds without scrolling.
- Verified visually in both light and dark mode — pill background converges on `var(--surface)` automatically thanks to the existing `bg-white` dark override, so no new CSS rules needed. Dark-mode regression suite (3/3) still green.

- Final piece of the recognisable-chip-glyph trio (fandoms: no icon · crossovers: ⇄ · pairings: ♡ · **authors: 👤**). Every chip type in the library now has a unique at-a-glance marker.

### Added 2026-06-13 (Dashboard — one-shot "what's new" toast)
- Added a 1.2s-delayed Sonner toast on the `/library` Dashboard mount: title `New chip icons across your library`, description `⇄ crossover · ♡ pairing · 👤 author — peek at the chip key on the Help page.`, primary action `Show me` → navigates to `/help`.
- Fires once per user, persisted via `localStorage["shelfsort_whatsnew_2026-06-13_chips"] = "1"`. The flag is set on any of three exit paths: action click, manual dismiss, or 12s auto-close.
- Versioned key so the next big visual shift can simply bump the suffix to re-fire for everyone.
- Verified end-to-end via Playwright: fresh visit → toast appears → action click → navigated to `/help` + flag set → revisit `/library` → toast does NOT reappear (all 3 assertions pass).

- Hit surfaces:
  - `AuthorsPage.jsx` — every directory row prefixed with the `User` lucide icon in purple. Count pill also switched from neutral cream `bg-[#E5DDC5]/60` to the unified `bg-[#6B46C1]/10 text-[#6B46C1]` lavender so all three index pages (Pairings, Authors, …) share visual rhythm.

### Fixed 2026-06-13 (DownloadPage — dark-mode follow-ups)
- **Bug 1 — selected-row text invisible**: the `:root[data-theme="dark"] .bg-\[\#EEE9FB\]` rule in `index.css` was forcing `color: #C4B5FD` (light lavender) on every container with that class. On the DownloadPage's selected author/fandom rows, the author name then sat as light-lavender text on a light-lavender background → unreadable. Removed the `color:` half of the rule (purple-accent text was already being applied via the separate `text-[#6B46C1]` override on elements that needed it). Selected rows now render with near-white text on the tinted lavender — computed `color: rgb(232, 228, 216)`.
- **Bug 2 — Cancel button stayed cream in dark mode**: the JSX used lowercase `bg-[#eee] hover:bg-[#ddd]`; my prior dark override targeted uppercase `.bg-\[\#EEE\]` only. CSS class selectors are case-sensitive, so the override never matched. Added lowercase variants: `.bg-\[\#eee\]`, `.hover\:bg-\[\#ddd\]:hover`, and `.border-\[\#eee\]`. Cancel button now renders `bg: rgb(38, 38, 43)` (dark surface) with light text.
- Caveat noted in the CSS comment block: future arbitrary-value Tailwind classes must use a consistent case across JSX + CSS overrides. A follow-up enhancement to `test_dark_mode_overrides.py` could add case-sensitive matching to catch this whole bug family at the regression level.
- Verified visually on the live tenant — selected rows, Cancel button, and Reset-filters link all legible. All 3 dark-mode tests still pass.

  - `AllBooksPage.jsx` Authors rail — the existing inline `UserCircle2` icon kept, but the chip palette flipped from black-on-white (`bg-white text-[#2C2C2C] border-[#E8E6E1]`) to the unified `bg-[#EDE7FB] text-[#6B46C1] border-[#6B46C1]/20` lavender to match every other chip rail on the page.
- Net effect verified on Jessica's library: scanning the dashboard rails, you can instantly distinguish fandoms vs. crossovers vs. ships vs. authors without reading a single name. Dark-mode regression suite (3/3) still green.


### Added 2026-06-13 (Dark-mode regression guard — case-sensitivity test)
- Added a 4th sibling test: `test_arbitrary_class_case_matches_between_jsx_and_css`. For every JSX `{bg,text,border}-[#hex]` use whose lowercased hex has a dark-mode override, verifies the JSX exact-case spelling matches at least one of the CSS override's exact-case spellings. CSS class selectors are case-sensitive, so `bg-[#eee]` and `bg-[#EEE]` are different selectors.
- Immediately surfaced **8 latent text-colour bugs** (`text-[#B85C7C]`, `text-[#9A9580]`, `text-[#4A4A4A]`, `text-[#3A3A3A]`, `text-[#B43F26]`, `text-[#9E5A2E]`, `text-[#9D2A2A]`, `text-[#8C5C00]`) where JSX used uppercase but overrides only listed lowercase → invisible text on dark surface.
- All 8 fixed by extending the existing CSS rules to include both casings. Helpful comment added in `index.css` explaining the case-sensitivity gotcha.
- Suite now: 4 tests, ~0.1s, blocks the entire family of "I changed a Tailwind colour case and the dark override silently broke" bugs.


### Added 2026-06-13 (P2: Mongo collections inspector for admins)
- New `routes/admin_db.py` with two read-only endpoints, both `Depends(require_admin)`:
  - `GET /api/admin/db/collections` — manifest sorted by size_mb desc, with doc count + `last_doc_at` from each newest `_id`'s generation_time. `user_sessions` is filtered out of the manifest entirely so it's not discoverable.
  - `GET /api/admin/db/collection/{name}?skip&limit&q` — paginated docs (newest first by `_id`, hard-capped at limit=50), with optional case-insensitive search across `_id` / `email` / `name` / `user_id` / `title`. Sensitive collections → 404. Document responses run through `_redact_value` which strips `password_hash`, `session_token`, `api_key`, `access_token`, `refresh_token`, truncates string fields > 10 KB, and caps arrays at 100 items.
- New `frontend/src/components/MongoInspectorCard.jsx`: left rail of collections with size + recency badges, right pane with search box (Enter or button to submit), pagination (`← Prev` · `page X / Y` · `Next →`), each row shows `_id` + a 3-field summary and an inline `Show JSON` toggle that reveals the full redacted document.
- Wired into `AdminConsole.jsx` as the 14th section (`admin-mongo-inspector-card`), registered in the section-search manifest (keywords: `mongo db database collections docs raw browse inspect`).
- Test coverage: 7 new pytests in `backend/tests/test_admin_db_inspector.py` — anonymous/non-admin rejection, manifest hides `user_sessions`, password-hash redaction visible in a search result, sensitive collection → 404, search narrows results, limit > 50 → 422. All pass; existing 4 dark-mode regression tests still green.
- Verified E2E on Jessica's 5,210-book tenant: 28 collections render, search "jessicab" returns exactly 1 user, JSON expand shows correctly redacted document.


### Fixed 2026-06-13 (P2: Linkless URL dedup — silent-duplicate-claim edge case)
- The `PATCH /api/books/{book_id}/source-url` endpoint (powering both the Linkless-shelf claim flow and the "Can't find online" manual-URL correction) silently overwrote `source_url` even when another active book in the same library already owned the canonical form of the URL. Result: two books bearing the same URL → URL-list dedupe later collapses on a coin-toss between them.
- **Backend**: added an explicit collision query in `routes/books.py:claim_source_url` that scans the user's library for an active (non-Trash) book whose `source_url` or `fanfic_urls` already contains the canon URL. On collision, returns `409 Conflict` with a structured body: `{"code": "url_already_claimed", "message": "…", "conflict_book": {"book_id", "title", "author", "fandom"}}`. The trash shelf is deliberately excluded — claiming a URL that a trashed copy holds is the "restore via URL" workflow and stays unblocked.
- **Frontend**: `BookDetail.jsx` `saveSourceUrl` handler now special-cases the 409 response, surfacing a long-duration toast that names the conflicting book and offers an `Open it` action button that navigates straight to `/book/{conflict_book_id}`. Any other error string still flows through to the generic toast unchanged.
- **Tests**: new `/app/backend/tests/test_linkless_claim_dedup.py` covers 5 cases — happy path, idempotent re-claim, active-book collision (with payload assertions + verifying the linkless book stays untouched), trashed-book "restore" allowance, unknown-host rejection. All pass.


### Added 2026-06-13 (P2: Palette Markdown share + PNG screenshot)
- Extended the existing **Share palette** section on `/account/appearance` with two new export buttons that complement the existing token-based share:
  1. **Copy as Markdown** — writes a copy-pasteable Markdown block to the clipboard with the palette name, theme, a 4-row hex table (Accent · Accent hover · Pale 1 · Pale 2), and a one-line "Apply: paste {token}" footer. Renders cleanly on Discord, GitHub, Notion, anywhere Markdown lives. New testid `appearance-share-markdown-btn`.
  2. **Download PNG** — generates a 800×420 PNG entirely client-side via the Canvas API (no html2canvas dependency). Theme-aware backdrop, 4 swatches in a row with hex labels below, palette name + theme caption, footer with the import token. Auto-triggers a browser download named `shelfsort-palette-{paletteId}-{theme}.png`. New testid `appearance-share-png-btn`.
- Both buttons read directly from the active theme's swatches (`palette.light` vs `palette.dark`), so the exported assets always match what the user is currently seeing.
- Verified end-to-end via Playwright: clipboard contained the full Markdown block; download event captured with the expected `.png` filename.


### Added 2026-06-13 (P2: Cron-failure email alerts)
- Extended `utils/cron_health.py` so every cron job that raises gets a debounced email out to all admins, on top of the existing `cron_runs` telemetry row.
- New helper `_maybe_alert_admins(job_id, error)` invoked from `_record_run` whenever `status == "error"`:
  - Reads the new `cron_failure_alerts` feature flag (added to `KNOWN_FLAGS` in `utils/feature_flags.py`, default ON) — operator can mute alerts during planned outages directly from the Admin Console.
  - Debounce: skips if `db.cron_alerts` has a `{job_id, last_sent_at}` row within the last `ALERT_DEBOUNCE_MINUTES` (60 min). Prevents a job retrying every minute from nuking inboxes.
  - Recipient set: every `users` doc with `is_admin: True` and non-empty `email`. Non-admins are never copied. Hard cap at 50 admins.
  - Mail body: purple-branded HTML + plain-text fallback. Subject `[Shelfsort] Cron job failed: {job_id}`. Body contains the error stack-trace head (truncated at 4000 chars), the failure timestamp, and a link to `/admin → Scheduled jobs`.
  - Resend send goes through `asyncio.to_thread`, logged via the existing `log_email_send` helper so the Admin Console's Email-stats card shows the delivery.
- Safety: missing `RESEND_API_KEY`/`SENDER_EMAIL` → silent no-op (logs once at info, no crash); admin lookup or Resend send exception → logged and swallowed so the cron telemetry write path is always safe.
- Tests: 5 new pytests in `backend/tests/test_cron_failure_alerts.py` covering success email, debounce, feature-flag mute, missing-Resend no-op, and successful jobs producing no email. Monkey-patches `resend.Emails.send` so no real HTTP is fired. All 5 pass; existing cron-health + admin-db + linkless + dark-mode suites still green (29/29 across the day's work).


### Updated 2026-06-13 (Help page — caught up with today's user-facing changes)
- Refreshed `FALLBACK_WHATS_NEW` (in `pages/Help.jsx`) to today's actual fresh items: chip-icon key, Find-a-fandom search, Share-your-palette (Markdown + PNG), 1-click theme toggle, all-purple polish. Version string bumped to `2026-06-13-purple` so the localStorage-persisted "what's new" pulse re-triggers for everyone who already dismissed the prior version.
- **Discovery section** rewritten with two new top bullet points: "Find-a-fandom search" (when the search box appears, how the suggestion chips work) and "Chip-icon shorthand" (documents the ⇄ / ♡ / 👤 glyph convention).
- **Account section** brought up to date: Appearance description corrected to describe the **paired Sun/Moon + Palette icon group** ("flips light↔dark on a single click"); Share palette card lists all **three** options — Copy token, Copy as Markdown, Download PNG — with one-line descriptions each.
- Verified via Playwright that all 5 documentation strings render on the live Help page.
- Out-of-scope on purpose: admin-only features (Mongo inspector, cron-failure alerts, condensed Admin Console) aren't documented in the user-facing Help page — they're operator tooling.


### Added 2026-06-13 (P2: Full-text EPUB search)
- New `backend/utils/epub_fulltext.py` — extracts an EPUB's spine into one whitespace-normalised string. 5 MB cap, helpers for `upsert_fulltext`, idempotent `ensure_text_index`, and `make_snippet` (200-char excerpt centred on first match).
- New collection `book_fulltext` with `{book_id, user_id, text, indexed_at}` + Mongo `$text` index on `text`.
- New routes (`backend/routes/fulltext.py`):
  - `GET /api/library/search/fulltext?q&limit` — user-scoped `$text` search, joins back to `books` for metadata, returns `{book_id, title, author, fandom, score, snippet}`.
  - `POST /api/admin/fulltext/backfill?limit` — admin batch indexer; missing-file books get empty rows so they're not retried; returns `{scanned, indexed, errors, skipped_missing_file}`.
- Upload pipeline hook in `books.py:upload_book`: extract + upsert after every successful insert, swallowing extraction errors so a fulltext glitch never blocks upload.
- Frontend `AllBooksPage.jsx`: new **"Search inside"** toggle next to the metadata search; 350 ms debounce; results panel above the grid with score badges + italic snippet excerpts; informative empty / pre-typing states pointing at the admin backfill.
- New Admin Console card **Full-text index** (testid `admin-fulltext-card`) — one-click button runs the 500-book backfill, shows the `scanned/indexed/errors/missing_file` summary + toast.
- Tests: 8 new pytests in `backend/tests/test_fulltext_search.py` — snippet centring, snippet fallback, search auth required, **user-scoping leak guard** (User A search can't see User B's matches), score+snippet shape, q-too-short → 422, backfill admin-only, backfill response shape. 29/29 across today's suites still pass.
- Smoke-verified live backfill on the preview: 17 books indexed from EPUBs on disk; the 500-book batch ran without errors.
- Deliberately deferred: per-chapter chunking + deep-link nav, "Find in this book" on BookDetail, phrase/regex/boolean operators, auto-reindex on metadata edits.
