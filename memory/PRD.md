# Shelfsort — Product Requirements & State

Live: https://shelfsort.com · Preview: https://drift-check-live.preview.emergentagent.com

## Original problem statement
Build "Shelfsort", an application to upload, auto-categorize (using AI)
EPUB files into categories, tags, and custom shelves.  Product
requirements: fast and reliable bulk book uploads, intelligent
classification, secure AV scanning, public-friendly reader experience,
and personalization for users based on their preferred library focus.

## Users
- **Fanfic archivists** — bulk-import large downloads folders and want
  them sorted by fandom + tags.
- **Casual readers** — sign in with Google, drop a handful of EPUBs,
  read them in the browser.
- **Admin (platform owner)** — moderation, presence tracking, health
  monitoring via the Admin Console.

## Core requirements
- ✅ EPUB metadata extraction + AI classification (Claude via Emergent LLM key)
- ✅ Bulk-friendly upload UX (drag-and-drop, staging, background AV scan)
- ✅ Multiple auth paths (Google OAuth + JWT email/password)
- ✅ Cloud storage backing (Cloudflare R2)
- ✅ Public-friendly reader experience (`/library`, no login for browse)
- ✅ Admin Console with real user vs test-account separation
- ✅ Live admin presence tracking (5-min window, 30s poll)

## Session log (this session — 2026-07-05 / 06)

### 🟢 Shipped to prod
- **Deploy 59** — Presence tracking, admin shield cluster, Navbar
  dropdown groups, deep test-vs-real user separation, live activity
  labels.  Shipped clean.
- **Deploy 60** — Fulltext orphan detection + auto-continue backfill.
  **Reverted via rollback** — the deploy shipped a regressed pod state
  that had lost the presence work.  See `memory/DEPLOY_BLOCKER.md`
  (now resolved).

### 🟢 Rebuild recovery (2026-07-05, in-preview)
- `backend/routes/admin.py` — new `GET /admin/presence/online` endpoint,
  test-account-excluded, 5-min window, returns `{count, users}`
- `frontend/src/components/NavbarOnlineChip.jsx` — restored (30s poll,
  animated count-change flash, dropdown with user list)
- `frontend/src/components/AdminShortcutButton.jsx` — restored (shield +
  chevron combo with last-3 admin cards dropdown)
- `frontend/src/components/Navbar.jsx` — cluster wired
- `backend/tests/test_presence_and_separation.py` — 7 tests (6 pass,
  1 skips because smoke admin is intentionally filtered from
  `/admin/users`)
- `backend/tests/test_navbar_frontend_regression.py` — 4 Playwright
  tests, skip in-pod behind `RUN_FRONTEND_PLAYWRIGHT=1`
- `memory/DEPLOY_SOP.md` — regenerated with the **new prod-vs-source
  drift check** as step §8 so this exact regression can't slip through
  again

### 🟡 Ready to ship on next deploy (in preview, unshipped)
- Fulltext orphan detection — walker flags `storage_missing_at`,
  excludes flagged books from `total_active`, adds `orphaned` count
  field to `/admin/fulltext/stats`
- FulltextBackfillCard — restored "Continue automatically until done"
  auto-continue checkbox + orphan pill + per-batch counter reset

## Data models (delta this session)
- `books.storage_missing_at` — ISO string, set by the fulltext walker
  when `ensure_local_cached` returns falsy.  Read by
  `/admin/fulltext/stats` and orphan-audit endpoints.
- `crossover_suggestions.source_url` — enriched at read time via title/author
  join against `books` (see `routes/admin.py:3389`).

## Third-party integrations
- Cloudflare R2 (Object Storage) — requires user API key
- Resend (Emails) — requires user API key
- Emergent LLM Key — Claude Text Gen, Nano-Banana Image Gen
- Google OAuth (Login) — via Emergent's Google auth

## Prioritized backlog (P0 → P3)

### P0 — Blocker for next deploy: ✅ RESOLVED (2026-07-09)
- Rebuild presence + admin cluster (done)
- **Reconstruct 17 missing testids (Quarantine + Duplicate-Dismissals)** —
  done 2026-07-09.  Drift check now reports 0.  Deploy is safe.
  See `memory/CHANGELOG.md` (2026-07-09 entry) for full inventory.

### P1 — Requested but parked (from previous fork's handoff)
- Split `AdminConsole.jsx` (~8300 LOC) into per-tab files
  (`AdminUsers.jsx`, `AdminFeedback.jsx`, `AdminPresence.jsx`,
  `AdminCrossovers.jsx`, etc.) to stop regressions from recurring
- Fix legacy pytest timeouts in `test_friends.py` / `test_moderators.py`
  (mock external HTTP)

### P2 — Enhancements
- **X-Client-Path activity tracking** — axios interceptor writes
  `current_activity_path` to `users.last_seen_at` sibling field so the
  admin presence list shows what each online user is doing ("reading a
  book", "editing shelf", etc.).  Not a regression fix — was in the
  handoff summary but not in the rolled-back prod bundle either.
- Saved-draft restore-rate stat
- Re-engagement email preview / send-now admin tool
- Break down `books.py` (~4400 LOC) — ✅ **Partially done 2026-07-12 (Phase 6C-A)**: 5 clusters extracted (polish, relationships, unknown_sources, versions, links) → 3,429 LOC. Follow-up Phase 6C-B: extract upload + classifier clusters.
- Break down `AdminConsole.jsx` (~9,600 LOC) — ✅ **Started 2026-07-12**: Card wrapper + shared helpers + Storage cluster extracted → 8,490 LOC. Follow-up: Email cluster (~700 LOC), System cluster, Data cluster.

### P3 — Nice to have
- Admin `.gitignore` regression counter
- Split fresh vs retried queue jobs on the admin queue dashboard
- Pair-aware text-contrast lint v2
- Real-stage labels on queue-summary strip ("AI classifying", "Cover gen")
- Wire text-sentinel script into hourly cron — ✅ **Done 2026-07-12**: `text_sentinel_monitor.py` + `GET /api/admin/text-sentinel-status` + companion pill inside `DriftStatusCard`. Ticks at :23 past each hour.

## 2026-07-10 — Library diagnostics card (this session)
Added `/api/admin/my-library-diagnostics` + `LibraryDiagnosticsCard`
in Admin → Data & Diagnostics so operators can reconcile expected vs
actual book counts (totals, by-category, cadence, dupes) without a
Mongo shell. Testid: `admin-library-diagnostics-card`. Context: user
completed a 2,000-book recovery upload and reported "extras" — this
card is the debugging path.
