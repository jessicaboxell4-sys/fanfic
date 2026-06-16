# Shelfsort — PRD

> **Note**: For dated work-log entries see [CHANGELOG.md](./CHANGELOG.md).
> For prioritized future tasks see [ROADMAP.md](./ROADMAP.md).
> Pre-2026-06-16 history is preserved verbatim in `PRD.md.bak`.

## Original Problem Statement
> Go through epubs and sort them by fanfiction, Harry Potter, twilight, etc

## Architecture
- **Backend**: FastAPI + Motor (MongoDB), `ebooklib` for EPUB parsing, BeautifulSoup for HTML strip, `emergentintegrations` for Claude classification
- **Frontend**: React 19 + react-router-dom 7 + Tailwind + Sonner toasts + Lucide icons
- **Auth**: Two methods, both issuing the same `session_token` cookie — Emergent-managed Google OAuth **and** email/password (bcrypt, 5-attempt lockout)
- **Storage**: Local filesystem `/app/uploads/{user_id}/{book_id}.epub` (+ `.cover`)
- **DB collections**: users, user_sessions, books, categories, reading_activity, year_in_books_shares, view_consents, plus many feature-specific (tags, smart_shelves, bookclubs, friends, dm_threads, etc.)

## User Personas
- Avid reader with a sprawling, unorganized EPUB collection from AO3, FFnet, Calibre exports
- Wants a quick way to file fanfic by fandom and separate from original/non-fiction
- Light/personal usage; library persists across devices
- A subset want to share progress with friends, run bookclubs, and post a Spotify-Wrapped-style recap at year end

## Core Requirements (static)
- Bulk EPUB upload + folder + mixed-format ingest via Calibre fallback
- Per-book classification: Fanfiction (Harry Potter, ACOTAR, Marvel, etc.), Original Fiction, Non-fiction
- Metadata-based classifier (keyword) + Claude AI fallback
- Browse with filters, search, fandom chips, tag cloud, smart shelves
- Book detail with cover, description, AI reclassify, manual edit, delete, in-app reader
- Export entire library as folder-organized ZIP / XLSX / link-only TXT
- Reading stats (streak, per-book minutes, time of day) + Year in Books recap
- Bookclubs, Friends DMs, Reading Goals
- Admin Console: approval gate, view-as-user (read-only with user consent), feedback inbox, storage trend
- Public sharing links (revocable, account-less viewing)

## Critical Architectural Decisions (do not regress)
- **Admin View-As is strictly read-only** via `/admin/view/{uid}` with explicit user consent (`view_consents` collection) and audit logging. Do NOT swap sessions.
- **AuthContext `loginSuccess(data)`** snaps user state immediately, then re-fetches `/auth/me` in the background to self-heal field drift (added after the email-login response dropped `is_admin` and silently hid the AdminConsole button).
- **AuthContext also exposes `refresh: checkAuth`** for any component that needs to heal stale state without importing the internal `checkAuth` name.
- **MongoDB**: all ObjectId fields stay strings via PyObjectId; `datetime.now(timezone.utc)` only, no `utcnow()`.
- **Backend routes**: every endpoint is prefixed `/api/`; the share preview HTML at `/api/og/yib/{token}` is the only route that returns text/html (everything else is JSON).
- **Frontend**: all API calls go through `lib/api.ts` and use `process.env.REACT_APP_BACKEND_URL`. Never hardcode URLs.

## Key API Endpoints (current)
- `POST /api/auth/register|login|logout|google` · `GET /api/auth/me`
- `POST /api/books/upload` · `GET /api/books` · `GET /api/books/{id}/cover|download`
- `POST /api/books/{id}/reclassify|refresh|touch|progress|mark`
- `POST /api/books/bulk/move|delete`
- `GET  /api/books/export/zip|xlsx|links`
- `GET  /api/year-in-books/{year}` · `POST /api/year-in-books/{year}/share|email`
- `GET  /api/public/year/{token}` · `GET /api/og/yib/{token}` (OG preview HTML + image)
- `GET  /api/admin/users/pending` · `POST /api/admin/users/{user_id}/approve`
- `POST /api/admin/view-consents/request` · `POST /api/account/admin-access/grant`

## 3rd-Party Integrations
- **Emergent LLM Key** — Claude Sonnet 4.6 for classification + tag suggestions
- **Resend** (RESEND_API_KEY) — Year-in-books email recap + weekly digest
- **Emergent-managed Google OAuth** — Login

## Testing
- Backend: `pytest /app/backend/tests` (100% green at last full run, 2026-06-15)
- Test credentials: see `/app/memory/test_credentials.md`
- Tester user `shelfsort-tester@example.com` has 4 seeded books + 17 reading_activity rows so `/library/year/2025` returns `has_data: true` without manual uploads
