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
