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
