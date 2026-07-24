# Shelfsort — Product Requirements & State

Live: https://shelfsort.com · Preview: https://drift-check-live.preview.emergentagent.com

---

## 🚨 CRITICAL DEPLOY CHECKLIST — READ EVERY TIME BEFORE DEPLOYING 🚨

**The user CANNOT deploy safely without Saving to GitHub first.**
Without a GitHub save, a rollback in the platform strands work in a
detached state where preview code and prod bundle diverge, and the
only way back is manual rebuild from turn history (see the iter 89-95
rebuild incident on 2026-07-19 — cost hours to recover 100 testids).

Before EVERY deploy the assistant MUST:
1. **REMIND the user to "Save to Github" first.** Do not say "ready to deploy" without this reminder.
2. **Review Help pages** — every user-facing feature shipped since the last deploy needs matching copy in `Help.jsx` (or `AdminHelp.jsx` for admin-only). The auto-generated "What's New" strip reads from CHANGELOG.md; static how-to sections do NOT auto-update.
3. Confirm `python3 /app/scripts/deploy_drift_check.py` reports **0 drift**. *(Note: as of 2026-08-27, Emergent Support confirmed that `.env` entries in `.gitignore` are **intentional and safe** — Save-to-Github writes them to prevent secrets leaking. The old `env_gitignore_sentinel.py` has been neutralized; ignore any older docs that claim `.env` in `.gitignore` is a bug.)*
4. Confirm `bash /app/scripts/run_all_lints.sh --quiet` reports all 5 lints green (dark-mode coverage, tiny-font, gitignore health, bg-white/N in-card, text-contrast).  This is the actual gate the local pre-commit hook enforces — failing any of these is what breaks "Save to Github".
5. Confirm `python3 /app/scripts/route_sentinel.py` PASSES.
6. Confirm `python3 -m pytest backend/tests/test_route_sentinel.py backend/tests/test_env_gitignore_sentinel.py -q` passes.
7. Confirm webpack `compiled` (no `Failed`).
8. Only after all of the above: prompt the user to hit **Save to Github**, then **Deploy**.

If the user says "deploy" without saving to GitHub, PAUSE and remind them.

---

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

### 🛑 Parked — user directive (2026-07-20)
**Anything community-facing is saved for later.** Do not surface as a Next Action Item, don't propose in ask_human plans, and don't build proactively. Reasoning from user: "We are getting ahead of ourselves." Focus stays on core library UX, admin plumbing, and deploy stability.
Parked items include (non-exhaustive):
- Comment Notifications (ping preset authors when someone comments on their preset)
- Preset Star Ratings on marketplace cards
- Ambient "Recently active" signal on public /community page
- Any new social / discovery / sharing / feed / follow / notification feature

**Parked reading-status follow-ups (2026-07-20)** — user said "remind of all later":
- Reading Status Filter Chip (Unread/Reading/Finished toolbar chips)
- Bulk Set Status action in SelectionBar
- Reader Auto-Reading (heartbeat auto-flips Unread → Reading)

**Parked admin-hardening follow-ups (2026-07-20)** — user said "remind later":
- Wire step-9 no-undef gate into save-to-github flow (currently only in pre_deploy.sh)
- Admin card health dashboard ("N cards failed to render, last 24h" pill reading from client_errors scope:"admin-card")

**Parked startup-observability follow-ups (2026-07-21)** — user said "remind of all later":
- Deep-check button in the StartupTimingCard (inline `/api/health?deep=1` phase drill-down)
- Boot-id → deploy log link (click a sparkline dot to jump to that boot's K8s pod log)

**Parked refactoring items (2026-07-22)** — user said "Later":
- Split `renderRow` out of `UsersCards.jsx` into its own module (file is 975 lines; extraction requires threading `busyId`/`toggleAdmin`/`fmtTime`/`fmtAgo`/`isUserOnline` closures)

Only revive when the user explicitly asks for it.

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


## 2026-08-14 — Library list-view UX pack (this session)

Shipped three interconnected list-view enhancements on `/library/all` for
users scrolling hundred+/thousand-book libraries.

- **Row Numbers** — leftmost `#` column, always visible on md+ screens.
  Renumbers 1..N in the current sort/filter order, and threads
  continuously across fanfic/original sections in mixed mode. Testids:
  `list-header-row-number`, `book-row-number-<id>`.
- **Column Layout Presets** — three named preset chips at the top of the
  columns menu: **Reading queue** (Time·Words + Status + Added),
  **Fandom deep-dive** (Fandom + Pairings + Status), **Storage audit**
  (Size + Time·Words + Added). Each writes both column visibility and
  column order to localStorage in one click. Testids:
  `list-cols-preset-{reading-queue,fandom-deep,storage-audit}`.
- **"Just the essentials" toggle** — one-click density preset in the same
  menu that hides Pairings + Time·Words for a compact laptop view;
  re-click flips ALL six columns back on. Testid:
  `list-cols-essentials-toggle`.

Verified end-to-end by testing agent (iteration_94.json — 9/9 features
passed, 0 issues). Preview drift check clean (0/2319). Ready for
"Save to GitHub → Deploy" per the top-of-file checklist.


## 2026-08-15 — R2 sweep + Jump-to-row + Preset personalisation

- **Real R2 boto3 sweep** in `/api/admin/storage/*` — replaced the
  iter-89 rollback stub. `/report` now paginates `list_objects_v2`
  under `shelfsort/users/`, sums real bytes, groups top users (up to
  10), computes est_monthly_cost at Cloudflare's $0.015/GB rate.
  Cached in-memory for 60s (12.2s cold → 17ms warm — ~718× faster).
  `/orphans/scan` finds R2 keys whose `book_id` is not in Mongo and
  writes them to `storage_orphan_scans:'latest'`. `/orphans/purge`
  batches `DeleteObjects` (1000/req) against ONLY that snapshot, then
  clears both the snapshot and the report cache so the dashboard
  shows freed bytes immediately. Cover files (`.cover`, `.cover-v-*`)
  collapse to the same book_id so they follow their parent book.
  Sweep hard-capped at 25k keys per call.
- **Jump To Row** on `/library/all` list view — small "→ #" pill in
  the list header opens a numeric input; Enter scrolls the matching
  row into view and flashes a purple ring for 1.5s. Also opens via
  `g` keyboard shortcut anywhere on the page (list view only,
  ignored when an input is focused). Testids: `jump-to-row-btn`,
  `jump-to-row-input`.
- **Preset Rename Inline** — right-click any layout preset chip
  (Reading queue / Fandom deep-dive / Storage audit) to open a fixed-
  position editor with rename input + "Overwrite with my current
  layout" + "Reset to default". Persists to localStorage key
  `shelfsort_list_col_preset_overrides`.
- **Navbar dropdown expansion** — added "Old versions", "Updated
  versions", "Unclassified" under YOUR BOOKS and a new "NEEDS
  ATTENTION" section with "Missing links" + "Won't open".
  `/library/all` now honours `?category=` query param for deep-links.

Verified end-to-end by testing agent (iteration_95.json — 7/7 backend
+ 12/12 frontend passed, 0 issues). Preview drift check clean
(0/2,324). Ready for "Save to GitHub → Deploy".

## 2026-08-16 — Custom preset chips + Purge confirmation

- **Custom preset chips** on `/library/all` list view — new "+ New"
  button (dashed border) in the columns menu preset row. Opens the
  same editor popover in `data-mode="create"` — type a name, Enter,
  and the current visible columns + order are captured as a new chip
  with a purple dot indicator. Right-click a custom chip to rename,
  overwrite with the current layout, or delete (custom chips get
  "Delete" instead of "Reset to default"). Persists to localStorage
  key `shelfsort_list_col_custom_presets`. Testids:
  `list-cols-preset-add`, `list-cols-preset-delete`, plus
  `data-custom="true"` attribute on custom chips.
- **Purge confirmation** for the R2 storage card in AdminConsole —
  the destructive "Purge N" button no longer fires immediately.
  Instead a fixed-inset modal (`admin-r2-purge-confirm`) shows the
  orphan count, byte total, top bucket users (up to 5 for context),
  sample keys to be deleted (up to 5), and a sweep-capped warning if
  applicable. The red confirm button is disabled until the admin
  types "PURGE" exactly into the confirmation input; Cancel or
  backdrop-click aborts without firing.
- **R2 storage card loading skeleton** — animated 3-column pulse
  placeholder shown during the ~12s initial R2 sweep so the card
  is no longer blank on first mount.

Verified end-to-end by testing agent (iteration_96.json — 20/20
preset assertions + 20/20 purge modal assertions passed, 0 issues).
Drift check clean (0/2,324). Ready for "Save to GitHub → Deploy".


## 2026-08-17 — Preset sharing + Orphan details + AdminConsole extract

- **Preset Export/Import** — right-click editor now includes "Copy
  JSON to share" (writes `{"shelfsort_preset_v1":{label,visible,
  order}}` to clipboard + sonner toast). A new dashed "Paste" button
  next to "+ New" opens a modal to paste the blob back on another
  device; import validates JSON shape + strips unknown column keys,
  then creates a fresh custom chip. Testids: `list-cols-preset-copy`,
  `list-cols-preset-paste`, `list-cols-preset-paste-modal`,
  `list-cols-preset-paste-input`, `list-cols-preset-paste-error`,
  `list-cols-preset-paste-cancel`, `list-cols-preset-paste-import`.
- **Orphan details report** — `POST /api/admin/storage/orphans/scan`
  now returns `top_affected_users`: top 10 users (by orphan bytes)
  whose R2 files are about to be purged. The R2 purge confirm modal
  swaps its old "Bucket top users (for context)" section for
  "Users losing files in THIS purge" (red-tinted, shows
  `user_id · <bytes> · N files`, with "…and N more." tail when the
  list exceeds 5). Only the response is grouped — the stored
  snapshot doc keeps its slim shape.
- **AdminConsole refactor Phase 6C-B** — extracted 5 self-contained
  cards (DriftStatusCard, DedupRetryCard, UploadFailureInsightsCard,
  UploadSkipDigestCard, R2StorageCard) into new file
  `/app/frontend/src/pages/adminConsole/RecentCards.jsx` (917 LOC).
  `AdminConsole.jsx` dropped from 9,240 → 8,362 lines (~9.5% smaller).
  Each extracted card uses the shared `Card` + `fmtBytes` helpers
  from `./shared.jsx`. Backlog: continue extraction to hit the
  <1,000-line-per-file guideline (testing agent flagged this).

Verified end-to-end by testing agent (iteration_97.json — 100%
backend + 100% frontend, 0 defects). New backend test at
`/app/backend/tests/test_orphan_scan.py`. Drift check clean
(0/2,324). Ready for "Save to GitHub → Deploy".


## 2026-08-18 — Age filter + Marketplace + Phase 6C-C extraction

- **Orphan Age Filter** — `POST /admin/storage/orphans/scan` now
  computes `age_days` from LastModified per orphan and returns an
  `age_buckets` histogram (`{ "0": …, "7": …, "30": …, "90": …,
  "365": … }`, cumulative-from-above). `POST /orphans/purge` accepts
  `min_age_days` (0..3650). R2 purge confirm modal has 5 age chips
  (data-testid `admin-r2-purge-age-{0,7,30,90,365}`) that update the
  visible count/bytes without a re-scan; the red confirm button is
  disabled when the filtered count is 0.
- **Preset Marketplace** — new page `/library/presets` (nav entry
  under Insights with Layers3 icon) lists upvote-sorted community
  presets. Cards support upvote, one-click "Install as chip" (writes
  to localStorage — no server roundtrip), and author-only delete.
  Publish flow lives inside the preset editor popover on
  `/library/all` ("Publish to marketplace…" button). Backend:
  new file `/app/backend/routes/preset_marketplace.py` with 4
  endpoints (publish/list/upvote/delete). Collection:
  `db.shared_presets`.
- **AdminConsole Phase 6C-C** — extracted 10 more cards into 3 new
  category files plus 1 shared-widgets file:
    * `adminConsole/UsersCards.jsx` — PendingUsersCard, UsersCard,
      ViewConsentsCard (also exports ALERT_HEALTH_DISMISS_KEY,
      SUPPRESSION_REASON_LABEL, SUPPRESSION_FIX_HINT constants).
    * `adminConsole/ModerationCards.jsx` — FeedbackInboxCard,
      HelpFeedbackCard, SignupRulesCard.
    * `adminConsole/HealthCards.jsx` — AntivirusCard,
      LibraryDiagnosticsCard, StuckUploadsCard, ClientErrorPulseCard.
    * `adminConsole/widgets.jsx` — ImageIconAlias,
      InviteLinksWidget, CampaignStatsWidget, StatList (shared
      helpers used by ModerationCards).
    * `adminConsole/shared.jsx` — now also exports `fmtAgo`.
  `AdminConsole.jsx` dropped from **8,362 → 5,428 lines** (~35%
  reduction in this batch). Total reduction across 6C-A + 6C-B +
  6C-C: 9,240 → 5,428 (~41% smaller).

Verified end-to-end by testing agent (iteration_98.json backend 8/8 +
iteration_99.json frontend 100%). Backend test at
`/app/backend/tests/test_iter98_marketplace_and_orphans.py`. Drift
check clean (0/2,324). Ready for "Save to GitHub → Deploy".


## 2026-08-19 — Marketplace polish + Phase 6C-D extraction

- **Marketplace search + sort** — `GET /api/presets/marketplace`
  now accepts `q` (case-insensitive substring on
  name/description/author_name) and
  `sort=upvotes|newest|mine`. Response items include
  `comment_count`. Frontend `/library/presets` adds a debounced
  (250ms) search box and 3 sort chips. Empty-state copy adapts to
  the active filter/sort. Testids: `preset-marketplace-search`,
  `preset-marketplace-sort`, `preset-marketplace-sort-{upvotes,
  newest,mine}`.
- **Marketplace comments** — new endpoints
  `POST /presets/marketplace/{id}/comments`,
  `GET  /presets/marketplace/{id}/comments`,
  `DELETE /presets/marketplace/{id}/comments/{comment_id}`.
  Preset-delete cascades to comments. Each card in the grid has a
  message-bubble button showing `comment_count`; clicking expands an
  inline thread with a textarea + Post button (Cmd/Ctrl+Enter
  shortcut) and a delete-X on the viewer's own comments.
  Collection: `db.preset_comments`.
- **AdminConsole Phase 6C-D** — extracted 18 more cards + the
  QuotaGauges/Gauge helpers into 5 new files:
    * `EmailCards.jsx` — EmailDiagnosticCard, AdminEmailModeCard,
      EmailStatsCard, EmailSystemCard, EmailVolumeForecastCard,
      plus QuotaGauges + Gauge inline helpers.
    * `AnalyticsCards.jsx` — FulltextBackfillCard,
      LlmKeyHealthCard, CanaryCard, ChangelogCard.
    * `ContentCards.jsx` — UnknownFandomsCard (with UnknownFandomRow
      inline), CrossoverSuggestionsCard.
    * `CommunityCards.jsx` — ChatRoomsCard, WatchingBookclubsCard.
    * `SystemCards.jsx` — HiddenFeaturesCard,
      AdminPendingAlertsCard, ReExtractLinksCard,
      MaintenanceBannerCard.
  `AdminConsole.jsx` dropped from **5,428 → 2,485 lines** (-54% in
  this batch). Cumulative Phase 6C total: 9,240 → 2,485 (**73%
  smaller** than before Phase 6C started).

Verified end-to-end by testing agent (iteration_100.json — 13/13
backend passed, marketplace frontend passed). Backend test at
`/app/backend/tests/test_iter100_marketplace_search_and_comments.py`.
EmailStatsCard rewritten with AbortController-style cleanup to
prevent StrictMode double-mount race conditions. Drift check clean
(0/2,324). Ready for "Save to GitHub → Deploy".



### 2026-08-22 — Android Chrome "Request Desktop Site" logout bug (P0 → fixed)

**Bug report**: "When on Shelfsort.com, on the phone and wanting to use
desktop mode, it completely logs you out."

**Root cause**: NOT User-Agent fingerprinting (handoff hypothesis was
wrong — grep confirmed zero UA-based auth gates; sessions are
pure `session_token` → Mongo). Real cause: Android Chrome's
"Request Desktop Site" triggers a hard reload with a new UA. The
boot-time `GET /api/auth/me` from `AuthProvider.checkAuth` was
racing the fresh cookie context and returning 401 for the first
request. A single 401 immediately blanked `user` state, which
looked like a logout.

**Fix** (`/app/frontend/src/context/AuthContext.jsx`):
- Hydrate `user` from `sessionStorage["shelfsort.auth.last_user"]`
  on mount so the UI doesn't flash logged-out during reload.
- On boot, if we have a cached user, retry `/auth/me` up to 3× with
  400/900/1600 ms backoff on 401. Anonymous visitors (no cached
  user) skip retries entirely so the "Sign in" button appears
  in ~1s instead of ~3s.
- 403 (pending/rejected) short-circuits retry immediately (server
  authoritative). Non-401 non-403 errors keep the cached user.
- Every successful `/auth/me` refreshes the cache; `logout()`
  clears it.

**Verification** (`/app/test_reports/iteration_108.json`, 100% pass):
- Anon landing loads in ~1s with Sign in visible.
- Login → sessionStorage cache present, /library reached.
- **PRIMARY**: simulated first-`/auth/me`-401-then-pass race via
  `page.route()` — user stayed signed in, cache preserved.
- 403 clears cache immediately without retrying.
- Logout wipes cookie + cache; refresh does not restore ghost.

No backend changes were needed. Cookie config unchanged
(httponly + secure + samesite=none, same-origin).


### 2026-08-22 — Active Sessions ("Signed in elsewhere") + calibre_convert.py extraction

**Phase A — Active devices panel** (Account settings).

Users can now see every session issued for their account and revoke
individual devices or every-other-device in one tap. Enriched
`user_sessions` documents with `user_agent` (truncated to 400 chars)
and `last_active_at`; the latter is throttled-touched from
`_resolve_session_user` so a chatty client doesn't spam the DB.

New endpoints (in `/app/backend/routes/auth.py`):
- `GET /api/auth/sessions` — returns `{sessions:[{id, browser, platform, user_agent, created_at, last_active_at, expires_at, is_current}], count}`. Current session pinned first. Uses a 12-char suffix of the raw token as opaque id (never leaks the full token).
- `DELETE /api/auth/sessions/{id}` — revoke a single session. Rejects self-revoke with a 400 pointing to `/auth/logout`.
- `POST /api/auth/sessions/revoke-others` — bulk-delete every session except the caller's.

Frontend: new `/app/frontend/src/components/ActiveSessionsCard.jsx`;
mounted right after `PrivacyMessagingCard` in Account.jsx with a new
SettingsToC entry (`active-sessions-card`, category "Privacy").

**Phase B — books.py Phase 6C first slice** (calibre extraction).

Moved 170 lines of Calibre conversion pipeline (`NEEDS_CONVERSION_EXTS`,
`NEEDS_CONVERSION_SHELF`, `CONVERSION_VISIBILITY_HOURS`,
`_CALIBRE_FRIENDLY_ERRORS`, `_friendly_calibre_error`,
`_convert_to_epub_sync`, `_get_calibre_semaphore`, `convert_to_epub`,
`_ensure_conversion_index`, `_conversion_start`, `_conversion_end`) to
a new `/app/backend/utils/calibre_convert.py`, then re-exported them
from `routes/books.py` so all existing importers and tests keep
working with zero changes. `books.py` dropped from 3,430 → 3,290 lines.

**Verification** — iteration_109.json, 100% pass on both:
- 10/10 backend pytests including cross-user isolation, Bearer flow,
  `last_active_at` bumping, and calibre re-export identity check.
- Full frontend flow: card renders, current chip present, revoke
  reduces list, revoke-others keeps caller signed in, SettingsToC
  search surfaces the new anchor.

**Known follow-ups** (deferred):
- Continue Phase 6C on books.py: extract duplicates (~330 LOC) → `utils/duplicates.py`; extract fanfic (~500 LOC) → `utils/fanfic.py`. Both need to keep re-exports on `routes.books`.
- Split `renderRow` from `UsersCards.jsx` still open.

### 2026-08-22 (later) — Phase 6C completion + UserRow.jsx split

**Backend Phase 6C — full slice** (two remaining extractions).

Continued the books.py breakdown. Extracted two more modules and
kept the ``routes.books`` surface identical via re-exports:

- **`/app/backend/utils/duplicates.py`** (new, ~330 LOC): dedup helpers.
  Contains `_clean_author_string`, `_normalize_title_for_match`,
  `_normalize_author_for_match`, `_updated_shelf_name`,
  `find_duplicate_candidates`, `_apply_duplicate_policy`.
- **`/app/backend/utils/fanfic.py`** (new, ~500 LOC): FanFicFare +
  FicHub + refresh pipeline. Contains `FANFICFARE_USER_AGENT`,
  `FanficNotFoundError`, `find_source_url`, `extract_fanfic_urls`,
  `fanfic_fetch_epub`, `fetch_fanfic_with_fallback`, `apply_refresh`.
  Uses **lazy imports** for `STORAGE_DIR`, `_write_local_and_mirror_to_r2`,
  and `_templated_filename` inside `apply_refresh` to break the
  circular dep with `routes.books`.
- **`/app/backend/utils/constants.py`**: added canonical
  `OLD_STORIES_SHELF` constant (was living inside books.py; both
  new modules need it).

Two existing tests had to update their monkeypatch targets:
- `tests/test_calibre_concurrency_cap.py` now patches
  `utils.calibre_convert._convert_to_epub_sync` (was
  `books_mod._convert_to_epub_sync`).
- `tests/test_new_features.py` patches
  `utils.fanfic.fanfic_fetch_epub` in the FicHub-fallback tests.
Both required because Python's monkeypatch only rebinds the module
namespace it targets; the extracted functions call each other via
their own module, not through the `routes.books` re-export.

**Result**: `routes/books.py` shrank **3,291 → 2,597 lines** (a
21% reduction). All 11+ tests + 80+ importers keep working
unchanged via re-exports.

**Frontend — UserRow extraction**.

`renderRow` (~185 lines) was pulled out of
`/app/frontend/src/pages/adminConsole/UsersCards.jsx` into a new
`UserRow.jsx` component. Props: `u, busyId, toggleAdmin, toggleMod,
openTimeline, isUserOnline, fmtActive, isTestUser`. Every testid,
class name, and interaction handler preserved byte-for-byte.
`UsersCards.jsx` shrank **975 → 787 lines** (—188 LOC). While in
the file we also cleaned up a small pre-existing lint error
(unescaped double-quotes around `{c.reason}`).

**Verification** — `/app/test_reports/iteration_110.json`, 100% on
both:
- 106/106 backend pytests across 8 suites, including a new
  `tests/test_refactor_reexports.py` identity test that guards
  every extracted symbol.
- Admin console Users & admins card renders identically to
  iteration_109 with 81 real user rows and every expected testid;
  mod-toggle still round-trips through the API.
- REGRESSION checks: P0 Android Chrome Desktop-mode logout fix
  still holds; Active Sessions card on `/account` still renders +
  revokes cleanly.

**Known follow-ups**:
- Books.py still ~2,600 LOC. Next natural extraction is
  `utils/url_lists.py` (~200 LOC of fanfic URL text-file parsing)
  and `utils/book_files.py` (`_write_local_and_mirror_to_r2`,
  `_safe_folder`, `_templated_filename` — ~150 LOC).
- Testing agent noted for future runs: `admin-users-card` has a
  `admin-users-card-toggle` expand handle + parent sidebar entry
  needs opening first.


### 2026-08-22 (evening) — Phase 6C slice 4 + testing ergonomics

**Backend — books.py Phase 6C slice 4** (filesystem + filename
helpers).

- **`/app/backend/utils/book_files.py`** (new, 123 LOC): extracted
  `_write_local_and_mirror_to_r2` (durable local+R2 mirror write
  helper), `_safe_folder`, `_safe_filename`, `_templated_filename`.
  All still re-exported from `routes.books` — 6 downstream importers
  (`books_links`, `books_versions`, `covers`, `user_prefs`,
  `utils.fanfic.apply_refresh`, and the pytest suite) resolve
  unchanged.
- `routes/books.py`: **2,597 → 2,544 LOC**.
- Note: `utils/url_lists.py` extraction from my previous finish was
  already accomplished — the actual URL-list parsing lives in
  `routes/url_lists.py` (a proper router, not a utils module).
  `books.py` only kept a 4-line lazy-import bridge helper for the
  upload flow, which stays.

**Frontend — testing ergonomics** (kills recurring Playwright pain).

- **MemorialModal.jsx**: added a `URLSearchParams` bypass at mount —
  `?test=1` (or `?nomemorial=1`) suppresses the modal for that
  visit. localStorage / cross-device persistence flow untouched;
  real users never hit the path.
- **`admin-<card>-toggle` / `admin-<card>-body` convention**
  confirmed and documented — every card rendered through
  `/app/frontend/src/pages/adminConsole/shared.jsx::Card` already
  auto-emits both testids. No new frontend testid work was needed;
  testing agent's future runs will use this pattern directly.

**Verification** — `/app/test_reports/iteration_111.json`, 100%
pass on both:
- 104+ backend pytests across 9 suites — including the expanded
  `test_refactor_reexports.py` (3 tests: identity guard for all 15
  re-exported symbols + `_templated_filename` shape + `_safe_folder`/
  `_safe_filename` boundaries).
- End-to-end: upload EPUB → GET /api/books/{id}/download returns
  `Content-Disposition: filename="SmokeTitle_Iter111_by_Smoke_Author-4393dff1.epub"`
  matching the historical template.
- Frontend: `?test=1` bypass verified; admin-users-card-toggle
  click reveals `admin-users-card-body` with 81 real user rows;
  non-test users still see the modal.

**Pre-existing dev warnings** (NOT caused by this iteration —
present in iter_110 too, documented for tracking):
- `<span>` cannot be child of `<option>` in AdminConsole mobile
  category select (AdminConsole.jsx:2054).
- setState-in-render warning inside adminConsole/shared.jsx::Card.

**Known follow-ups**:
- Books.py is now ~2,544 LOC (from 3,291 at start of session — a
  22% reduction). Route handlers themselves are the next hot spot;
  a fully clean split would move the 11 `@api_router` handlers
  into per-concern modules (e.g. `routes/books_upload.py`,
  `routes/books_download.py`).
- Trust score chip on the Admin Users card (deferred — pending
  data-model design).


### 2026-08-22 (late) — Two React dev-warning cleanups

Small hygiene pass — cleared both dev-mode warnings surfaced by
iteration_111's tester.

**`<span>` inside `<option>` on AdminConsole.jsx:2054**.
The visual-editor runtime wraps `{cat.label}` in a `<span
data-ve-dynamic>` so it's clickable in the design editor. That
span is invalid inside `<option>`, which produces a React
hydration warning. Fix: collapse the `{cat.label} ({count})`
JSX children into a single template-literal string child, so
ve-dynamic doesn't need to wrap anything.

**setState-in-render on `adminConsole/shared.jsx::Card`**.
`pushRecent(testid)` was called inside the `setOpen((v) => ...)`
updater, which meant a cross-component setState fired during
React's state-reducer phase (warning: "Cannot update a component
(AdminConsole) while rendering a different component (Card)").
Fix: split the two calls — compute `next = !open` synchronously,
`setOpen(next)`, then call `pushRecent(testid)` if opening. Both
land in the same event-handler batch anyway.

While in AdminConsole.jsx I also fixed one pre-existing
unescaped-quote lint error (`"{rawQuery}"` → `&ldquo;{rawQuery}&rdquo;`).

**Verification**: reloaded /admin as admin-smoke-test with a
console-warning capture in place — 0 warnings caught for either
issue. Users & admins card expanded correctly and pushed itself
into the RECENT sidebar (pushRecent still working after the
split). No new lint errors.

**Reminded (parked to Future/Backlog)**:
- Split the 11 remaining `@api_router` handlers in
  `routes/books.py` into per-concern modules
  (`routes/books_upload.py`, `routes/books_download.py`, etc.).
- Trust-score chip on Admin Users card
- Sessions overview card in Admin Console
- Comment notifications for preset authors
- Ctrl/Cmd+A in Select mode
- Bulk reading-status filters + reader auto-reading


### 2026-08-22 — Parked for later (reminders)

- **Books.py handler split** (P2): route `routes/books.py` still has 11 `@api_router` handlers — split into `routes/books_upload.py`, `routes/books_download.py`, etc. when we next thin the module.
- **Dev-only React warning toaster** (P3): add a `window.__shelfsort_warning_capture__` interceptor that surfaces every React warning (hydration, setState-in-render, missing key, etc.) as a small dismissable in-page toast in dev builds. Turns silent dev regressions into visible ones so we spot them during normal use instead of only via testing-agent runs. User opted to remind later.


### 2026-08-22 (late 2) — Account settings ToC restyle → AdminConsole sidebar pattern

User asked to restyle the /account ToC to match the /admin sidebar
(picture 2 in the request). Full rewrite of `SettingsToC` in
`/app/frontend/src/pages/Account.jsx`; **backend untouched**.

**What changed**:
- Layout on lg+: `max-w-2xl mx-auto` → `max-w-6xl mx-auto lg:grid
  lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8`. Sidebar sits sticky
  on the left, cards render on the right (`max-w-2xl` reading
  measure preserved). Below lg the sidebar renders inline above
  the cards — no responsive break.
- ToC shape: search bar on top, optional "Recent" block (last 3
  jumps, persisted via localStorage `account.settings_toc_recent`),
  "Sections" heading, categories as pill-shaped rows each with an
  expand chevron + item count on the right. Active category rendered
  in purple (`bg-[#6B46C1]`), driven by `IntersectionObserver`
  scroll-spy. Expand state persisted via
  `account.settings_toc_expanded_categories`. Nested items indented
  under each expanded category and force-shown on search.
- New testids: `settings-toc-toggle-{Category}`,
  `settings-toc-cat-{Category}`, `settings-toc-recent-sticky`,
  `settings-toc-recent-{anchor}`. Existing testids preserved:
  `settings-toc`, `settings-toc-search`, `settings-toc-clear`,
  `settings-toc-empty`, `settings-toc-link-{anchor}`.

**Verification** — `/app/test_reports/iteration_112.json`, 100% of
PRIMARY acceptance criteria:
- Desktop grid layout at 1600x1000: 240px sticky sidebar + cards.
- Mobile 375x812: single-column with sidebar inline.
- All 7 categories with correct counts (Profile 3, Privacy 2,
  Library 7, Maintenance 4, Backups 2, Notifications 2, Recovery 1).
- Chevron expand/collapse + localStorage persistence verified.
- Scroll-spy sets `settings-toc-cat-Library[data-active=true]` when
  the AI classifier card is in view.
- Search 'session' auto-expands Privacy and reveals the
  active-devices link; 'zzznomatch' shows settings-toc-empty.
- All previous account testids intact (account-title,
  active-sessions-card, profile-completeness-card, library-mode-card).

**Minor automation-only artifacts** (not user-facing):
- Playwright captured only 1 recent entry when firing 3 clicks in
  <500ms because the sidebar re-flows after the first pushRecent
  and subsequent clicks land on shifted targets. Real users don't
  hit this — a manual click sequence records all 3.
- `.settings-toc-flash` class is added/removed inside a single
  React commit tick, making it hard for automation to observe.


### 2026-08-22 (very late) — Right-column section-title headers

Follow-up to the sidebar restyle. User asked for section-title
headers in the right column matching the "OVERVIEW" / "USERS &
SIGN-UPS" pattern the AdminConsole grew.

**Reality check first**: cards in `Account.jsx` are NOT grouped by
category in the DOM — they've grown organically across ~40
iterations. Full grouping would require moving ~2500 lines of JSX
(high risk). Instead, added ONE header above each category's FIRST
DOM appearance. Later cards of the same category flow naturally
beneath. This gives the right column visible entry-points that
mirror the sidebar without a risky JSX reorganization.

**Implementation**:
- New `<SettingsSectionHeader label="..." />` component: small
  uppercase purple label + a hairline divider. Same aesthetic as the
  AdminConsole section labels.
- 7 headers inserted (in DOM order): PROFILE, LIBRARY, BACKUPS,
  RECOVERY, NOTIFICATIONS, PRIVACY, MAINTENANCE.
- New testids: `settings-section-header-{label-lowercase}`.

**Verification**: smoke-screenshotted at 1600x1000 — all 7 headers
render, PROFILE label sits above "Boost your discoverability"
(first Profile card), LIBRARY above "AI classifier", etc. Zero
React warnings. Sidebar still shows active category correctly.


### 2026-08-22 (very very late) — Sticky section-title headers

Small polish on the previous item. Added `sticky top-16 z-10 bg-paper`
to `SettingsSectionHeader` so each label pins to the top of the
viewport while its cards are still on-screen — "browser tab" style
anchors so users always know which section they're reading.

**Details**:
- `top-16` (64px) clears the Navbar (`sticky top-0`, ~56px tall + border) so the label sits comfortably below it, not behind.
- `z-10` keeps it above scrolling cards but below the Navbar
  (`z-40`) and toasts.
- `bg-paper` provides a solid backdrop so the label stays readable
  when cards scroll behind it. Proper dark-mode support already
  exists on `bg-paper` (see index.css:591).

**Verification**: Playwright confirms after scrolling to y=900 the
LIBRARY header pins at exactly y=64px (Navbar bottom), with the
next section header (BACKUPS) still in normal flow just below the
viewport. Sidebar active-category highlight still tracks correctly.


### 2026-08-22 (mobile) — Mobile ToC → AdminConsole "Jump to section" pattern

User compared /account (Picture 1) and /admin (Picture 2) at ~420px
and asked for /account to use the SAME mobile pattern — a compact
`<select>` jump dropdown instead of the full inline sidebar list.

**Implementation** (`/app/frontend/src/pages/Account.jsx`):
- Desktop sidebar: added `hidden lg:block` to the
  `<aside data-testid='settings-toc'>` so it only renders at ≥1024px.
- New `<SettingsMobileJump>` component (`lg:hidden`) mounted at the
  top of the right column. `sticky top-16 z-10` so it stays visible
  while scrolling, matching the AdminConsole mobile jump exactly.
- Categories interpolated as single-string `<option>` children
  (`{`${cat} (${count})`}`) so the visual-editor runtime doesn't
  inject a `<span>` inside `<option>` (React hydration warning fix
  pattern from iter_111).
- New testids: `settings-mobile-jump-wrap`, `settings-mobile-jump`.

**Verification** (`/app/test_reports/iteration_113.json`, 100%):
- **Mobile 420px**: settings-toc `display: none`,
  settings-mobile-jump-wrap `display: block, position: sticky, top: 64px`,
  select has EXACT 8 options (placeholder + Profile 3 / Privacy 2 /
  Library 7 / Maintenance 4 / Backups 2 / Notifications 2 /
  Recovery 1). Zero hydration warnings.
- **Desktop 1400px**: settings-toc `display: block`,
  mobile-jump `display: none`. 7 section headers still present.
- All 6 category jumps smooth-scroll to their first card. Sticky
  section headers still pin at top:64px on both viewports.


### 2026-08-22 (final) — Sidebar categories ↔ card locations aligned via CSS `order`

User asked for the menu labels and the actual card locations on the
Account page to line up. Problem: cards have grown across ~40
iterations and are scattered through the JSX in no particular order
(e.g., admin-access-card at line 447, profile-completeness-card at
line 2405, both are Profile). A JSX reshuffle would move ~800 lines
and carry high regression risk.

**Solution — CSS `order` reorder trick**:
- Container `<div className="min-w-0 max-w-2xl">` → `<div className="min-w-0 max-w-2xl flex flex-col">`.
- Every top-level card gets `style={{order: N}}` in a per-category
  bucket-decade: **100s Profile · 200s Privacy · 300s Library ·
  400s Maintenance · 500s Backups · 600s Notifications · 700s
  Recovery · 800s Danger zone**. Increments of 10 leave room for
  future insertions.
- `SettingsSectionHeader` accepts an `order` prop and applies it
  inline; each header lands at the top of its decade.
- Components without an outer element that accepts `style` (e.g.
  `<PushHandoffToggle />`) are wrapped in a `<div style={{order}}>`.
- Total change: ~20 targeted search_replaces. Zero JSX moved.

**Verification** — Playwright bounding-box y-positions on desktop:
```
  PROFILE          y=321
  PRIVACY          y=1767
  LIBRARY          y=4648
  MAINTENANCE      y=7124
  BACKUPS          y=7945
  NOTIFICATIONS    y=8795
  RECOVERY         y=10011
```
All 8 ordering-check assertions PASS (section headers precede their
own cards, then next-category header comes after). Sidebar +
mobile-jump categories now visually match the card sequence in the
right column.

**Also gave 3 previously-anonymous sections proper testids** so the
manifest can be extended later if desired:
- `profile-info-card` (name + bio)
- `password-card`
- (danger-zone-card & delete-account-card already had testids)


### 2026-08-22 (final polish) — Mobile select scroll-spy + softer sidebar highlight

Two small follow-ups on the alignment work:

- **Mobile `<select>` now tracks scroll position**. Added a
  matching `IntersectionObserver` inside `SettingsMobileJump` that
  updates `activeCategory` → drives the `<select value={...}>` in
  real time. The dropdown always shows the section you're currently
  reading, matching the sidebar's purple pill on desktop. Removed
  the "Pick a category…" placeholder since we now always have a
  concrete active category.
- **Softer sidebar highlight**. Added `duration-300 ease-out` +
  `shadow-sm shadow-[#6B46C1]/30` to the active-category pill so
  the transition between categories feels intentional instead of
  instantaneous.

**Order sanity check** (menu labels vs card visual positions,
Playwright y-coordinates):
```
Sidebar order → Profile, Privacy, Library, Maintenance, Backups, Notifications, Recovery
Card decades  → 100s,    200s,    300s,    400s,        500s,    600s,          700s
Card Y-pos    → 321,     1767,    4648,    7124,        7945,    8795,          10011
```
Perfect alignment confirmed.

**Scroll-spy verification** at 4 scroll positions:
- y=0    → mobile='Profile',    sidebar='Profile'
- y=4700 → mobile='Library',    sidebar='Library'
- y=7200 → mobile='Maintenance',sidebar='Maintenance'
- y=8000 → mobile='Backups',    sidebar='Backups'


### 2026-08-22 (jumpy-fix) — Consistent card spacing on /account

User reported the account page felt "jumpy" after the reorder. Root
cause: the wrapper `<div style={{order:N}}>` divs I introduced
around components (BackupCard, ActiveSessionsCard, etc.) had NO
bottom margin, while inline `<section>` cards carried `mb-6`. Result:
some cards touched (0px gap) while others had 24px gaps —
irregular spacing that felt visually jumpy.

**Fix**:
- Added `className="mb-6 empty:hidden"` to every wrapper div. The
  `empty:hidden` bit collapses the wrapper completely when its
  child renders null (e.g. AdminAccessCard when there's no request,
  DuplicateDismissalsCard when the user has none), so its `mb-6`
  no longer contributes a phantom gap between neighbours.
- Added the missing `mb-6` to `password-card`.
- Removed the stray `mt-8` on the AI card so it matches the 24px
  card-to-card rhythm.
- Tightened `SettingsSectionHeader` spacing from `mt-10 mb-3` to
  `mt-6 mb-4` so the transition-into-header gap is 48px (2×24) —
  a clean 2-unit multiple of the base 24px card rhythm.

**Verification** — Playwright gap measurement across all 33
transitions between visible children:

| Kind                          | Gap  | Count |
|-------------------------------|------|-------|
| Header → first card           | 16px | 7  |
| Card → card (same category)   | 24px | 16 |
| Last card → next section head | 48px | 7  |

Screenshot confirms clean, predictable rhythm. Sidebar/scroll-spy
still tracks correctly.


### 2026-08-22 (emails) — /account/emails restyled to match /account + /admin

Applied the same sticky-sidebar + mobile-jump-select + section-header
+ CSS-order grouping pattern to `/account/emails` (EmailPreferences.jsx).

**New locally-scoped components** (mirror the /account ones):
- `EmailPrefsToC` — sticky sidebar with search, expand/collapse per
  category, scroll-spy → purple active-category highlight
  (`duration-300 ease-out` + `shadow-[#6B46C1]/30`). `hidden lg:block`.
- `EmailPrefsMobileJump` — `lg:hidden` compact `<select>` with its own
  IntersectionObserver so its value tracks the reading section.
- `EmailPrefsSectionHeader` — sticky `top-16`, `bg-[#FBF7EE]` (page bg).

**Manifest** — `EMAIL_PREFS_MANIFEST` with 5 categories:
- **Digests** (3): weekly-summary, weekly-digest, year-recap
- **Alerts** (1): fic-updates
- **Social** (2): from-friends, bookclub-digest
- **Admin** (1): operator-digest (admin only)
- **Account** (2): account-updates, in-app-mute-card

**CSS order decades** (`flex flex-col` on the right column): sender
info 5 → Digests 100s → Alerts 200s → Social 300s → Admin 400s →
Account 500s → warning-pill 990. All 9 cards + 5 headers cluster in
the correct visual order regardless of JSX write order.

**Testids** (new): `emails-toc`, `emails-toc-search`, `emails-toc-clear`,
`emails-toc-empty`, `emails-toc-toggle-{Category}`, `emails-toc-cat-{Category}`,
`emails-toc-link-{anchor}`, `emails-mobile-jump-wrap`, `emails-mobile-jump`,
`emails-section-header-{lowercase}`, and a new `in-app-mute-card` wrapper.

**Verification** — Playwright at 1400x900:
- Sidebar visible (`display: block`), mobile-jump hidden (`display: none`).
- 5 section headers rendered in Y-order matching the decade scheme:
  412 (Digests) → 1415 (Alerts) → 1785 (Social) → 2592 (Admin) → Account.
- Sidebar shows: Digests 3 (active/expanded), Alerts 1, Social 2, Admin 1, Account 2.
- Screenshot confirms clean design matching /account and /admin.

**Two-column grid** on `lg:` (`max-w-6xl` + `lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8`); right column stays `max-w-3xl` for reading measure.

**Zero lint issues** on EmailPreferences.jsx after the rewrite.

