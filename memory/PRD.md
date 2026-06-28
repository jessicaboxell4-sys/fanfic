# Shelfsort — PRD

> **Note**: For dated work-log entries see [CHANGELOG.md](./CHANGELOG.md).
> For prioritized future tasks see [ROADMAP.md](./ROADMAP.md).
> Pre-2026-06-16 history is preserved verbatim in `PRD.md.bak`.

## User preferences — apply across sessions

- **New-feature announcements — always ship a `OneTimeTip`.**  Whenever
  a new user-facing feature ships (or a major change to an existing
  one), drop a `OneTimeTip` (`frontend/src/components/OneTimeTip.jsx`)
  next to the surface it affects so existing users discover it the
  next time they visit that page.  Full convention + naming rules in
  `/app/memory/CONVENTIONS.md`.  Do not surface major changes only in
  CHANGELOG or release notes — always wire an in-context tip too.
- **Bug checks → always run the deep-dive automatically.**  Whenever
  the user asks "any bugs?", "is anything wrong?", "do a check",
  "deep dive", or any equivalent, run the full sweep without asking
  first:
    1. Backend lint — `mcp_lint_python` on `/app/backend/`
    2. Frontend lint — `mcp_lint_javascript` on `/app/frontend/src/`
    3. Full pytest suite — every `tests/test_*.py`
    4. Backend log scan — last 200 lines of
       `/var/log/supervisor/backend.err.log`, filtered for
       `error/traceback/exception/NameError/ImportError`
    5. Production-critical import smoke test for any modules ruff
       flagged
    6. **Production canary status** — read
       `/app/memory/canary_status.json`.  If `status == "fail"`,
       surface it as a HIGH-severity finding with the
       `upstream_run_url` and `retry_run_url` links so the user can
       jump straight to the failing run.  The retry workflow
       (`.github/workflows/prod-smoke-canary-retry.yml`) commits
       this file back to the repo after each 15-min retry, so it
       reflects the latest confirmed prod state.
    7. **Dark-mode coverage** — run
       `python3 scripts/check_dark_mode_coverage.py`.  Any light
       hex `bg-[#XXXXXX]` background without a matching
       `:root[data-theme="dark"]` rule in `frontend/src/index.css`
       is flagged.  Fix by adding the dark-mode mapping (group by
       accent family at the bottom of `index.css`) OR appending
       `// dark-ok` to the JSX line if the bright background is
       intentional in both modes (e.g. overlay on a dark gradient).
       Also run this script **after any frontend change that
       introduces a new `bg-[#…]` class** — don't wait for the
       user to screenshot the bug.
    8. **Tiny-font accessibility** — run
       `python3 scripts/check_tiny_fonts.py`.  Flags any
       `text-[Npx]` where N ≤ 9 (sub-readable).  Auto-exempts the
       standard `uppercase tracking-wider` badge pattern.  Fix by
       bumping to `text-[10px]` minimum OR append
       `// fontsize-ok` to the JSX line if the tiny size is
       genuinely needed (single-char chips, count bubbles inside
       16×16 px squares, intentional cover-overlay text).  Also
       run this script after any frontend change that introduces
       a new `text-[Npx]` class.
  Report findings ranked by severity (HIGH = runtime crash path,
  MED = potential 500, LOW = code smell).  Don't truncate the lint
  output — the worst bugs hide in the long tail.
- **Reminders** — when the user says "remind later" / "ask later" /
  "hold for later", append the item to `/app/memory/ROADMAP.md`
  under "Parked reminders" (newest at top).

## Original Problem Statement
> Go through epubs and sort them by fanfiction, Harry Potter, twilight, etc

## Architecture
- **Backend**: FastAPI + Motor (MongoDB), `ebooklib` for EPUB parsing, BeautifulSoup for HTML strip, `emergentintegrations` for Claude classification
- **Frontend**: React 19 + react-router-dom 7 + Tailwind + Sonner toasts + Lucide icons
- **Auth**: Two methods, both issuing the same `session_token` cookie — Emergent-managed Google OAuth **and** email/password (bcrypt, 5-attempt lockout)
- **Storage**: Local filesystem cache `/app/uploads/{user_id}/{book_id}.epub` mirrored to **Cloudflare R2** (primary) with Emergent Object Storage as a lazy fallback for un-migrated rows.  See `utils/storage_cloud.py`.
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
- `GET  /api/books/most-finished-leaderboard` (cohort ≥10, opted-in only)
- `GET  /api/year-in-books/{year}` · `POST /api/year-in-books/{year}/share|email`
- `GET  /api/public/year/{token}` · `GET /api/og/yib/{token}` (OG preview HTML + image)
- `GET  /api/admin/users/pending` · `POST /api/admin/users/{user_id}/approve`
- `POST /api/admin/view-consents/request` · `POST /api/account/admin-access/grant`
- `GET  /api/events/stream` (unified SSE channel — chat, notifications, friend activity)
- `GET  /api/reading-sync/hints` (cross-device "Resume" passive hint set)
- `POST /api/reading-sync/cursor` · `POST /api/push/subscribe` (Web Push)
- `GET|PUT /api/admin/operator-digest` · `POST /api/admin/operator-digest/preview`
- `GET  /api/analytics/summary` (admin visitor analytics + funnel)
- `POST /api/feedback` (Help-page short-form feedback + optional 5MB photo upload)
- `GET  /api/admin/feedback` · `GET /api/admin/feedback/by-page` (admin triage + per-page friction aggregation)
- `GET  /api/signup/config` · `GET /api/rules` (public — drives register form + /rules page)
- `GET  /api/admin/signup-config` · `PUT /api/admin/signup-config` · `GET /api/admin/onboarding-stats` (admin sign-up controls)
- `GET  /api/health` (public — Mongo · scheduler · object storage · antivirus liveness for monitors)
- `GET  /api/admin/antivirus/status` · `GET /api/admin/antivirus/quarantine` (ClamAV health + flagged-file audit)
- `GET  /api/admin/orphan-audit` · `POST /api/admin/orphan-audit/delete-bulk` (find + remove DB rows whose files are missing from storage)
- `GET  /api/admin/storage-migration-progress` · `POST /api/admin/storage-migration-backfill` (R2 cutover progress + backfill chunks)
- `POST /api/admin/storage-fallback-pause` (pausable Emergent fallback runtime toggle, persists to ``storage_config`` singleton)
- `GET  /api/recommendations/similar/{book_id}` (library-local "Finished on device. Want a similar one?" suggestions)
- `GET  /api/insights/reader-dna` (Reader DNA + trending re-reads — Stats page)
- `GET|POST|DELETE /api/admin/fandom-overlay` (admin character-keyword overlay — Session 1)
- `GET  /api/admin/crossover-suggestions?status=...` · `POST /api/admin/crossover-suggestions/{dedup_key}/accept|reject` · `GET /api/admin/crossover-suggestions/count` (Phase-6 AI feedback loop — Session 2 + navbar badge)
- `POST /api/canary/report` (gated by `CANARY_REPORT_SECRET`) · `GET /api/admin/canary-runs?days=N` · `GET /api/admin/canary-runs/{run_id}` (Production canary widget)
- `POST /api/admin/re-extract-links` (Backfill EPUB link extractor + Storyid URL reconstruction across existing library)
- `GET /api/changelog` (public, no auth — community shipped feed + parsed CHANGELOG.md, forward-only from 2026-06-25)

## 3rd-Party Integrations
- **Emergent LLM Key** — Claude Sonnet 4.6 for classification + tag suggestions
- **Resend** (RESEND_API_KEY) — Year-in-books email recap + weekly digest.
  ✅ `shelfsort.com` domain verified at Resend since 2026-06-19
  (us-east-1). Sender = `Shelfsort <hello@shelfsort.com>`.  Real-inbox
  delivery works end-to-end.  Future agents: do NOT re-flag domain
  verification as a blocker — that was historical handoff cruft.
- **Emergent-managed Google OAuth** — Login

## Testing
- Backend: `pytest /app/backend/tests` (100% green at last full run, 2026-06-15)
- Test credentials: see `/app/memory/test_credentials.md`
- Tester user `shelfsort-tester@example.com` has 4 seeded books + 17 reading_activity rows so `/library/year/2025` returns `has_data: true` without manual uploads
