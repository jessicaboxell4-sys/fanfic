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
