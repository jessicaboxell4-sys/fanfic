# Shelfsort — Changelog

Append-only log of dated work entries. Newest at the top.

For static product context see [PRD.md](./PRD.md).
For the prioritized backlog see [ROADMAP.md](./ROADMAP.md).
The pre-split verbose history (with every "Added 2026-05-29" line) is preserved verbatim in `PRD.md.bak`.

---

## 2026-06-17 — Community covers + variant cap bumped to 20 ✅

### Variant cap raised

`_COVER_VARIANT_CAP` 5 → **20** so users have room to iterate +
adopt community covers without losing earlier work.  FIFO still
trims oldest-inactive when full.

### Community cover pool (Tier 1 of the cover-ecosystem roadmap)

Opt-in sharing.  A user publishes one of their variants to a public
pool keyed by normalized `(title, author, fandom)`; other users
importing the same fic can browse + adopt the shared cover with zero
LLM cost.

**Backend** (`routes/books.py`):
- New on-disk dir `/app/uploads/community_covers/` for shared cover
  bytes (decoupled from per-user storage so they survive user delete).
- New Mongo collection `community_covers`:
  `{cover_id, title_key, author_key, fandom_key, title, author, fandom,
   file, source_book_id, source_variant_id, shared_by_user_id,
   shared_by_username, shared_at, import_count}`.
- Endpoints:
    * `POST /books/{id}/cover-variants/{vid}/share` — publish a variant.
      Idempotent: re-share returns the existing community_cover_id with
      `deduped: true`.  Sharer's `username` (fallback: email local-part)
      is stamped for attribution.
    * `GET /community-covers?title=…&author=…&fandom=…` — browse by
      normalized title (required) + optional author / fandom refinement.
      Returns inline base64 PNGs sorted by `import_count` desc then
      `shared_at` desc (popularity-weighted).  Capped at 60.
    * `POST /books/{id}/import-community-cover/{cover_id}` — adopt a
      community cover as a new variant in the caller's library (no LLM
      call).  Sets `cover_source: "community_imported"`, increments
      `import_count` on the source record.
    * `DELETE /community-covers/{cover_id}` — unshare.  Only the
      original sharer, an admin, or a moderator can call it.  Doesn't
      touch any already-imported copies in other users' libraries.

**Frontend** (`components/RegenerateCoverButton.jsx`):
- Each variant thumbnail in the "Previous covers" drawer gets a small
  purple "Share2" button bottom-right that publishes it to the
  community pool (one click, idempotent, toast confirms).
- New "Browse community covers" section below the variants drawer.
  Lazy-loaded (only fetches when the user clicks the button) so the
  modal stays snappy.  Renders a 3-column grid of community covers
  with the sharer's @handle + import count overlaid, and a "Use this"
  CTA that imports the cover as a new variant.
- After share / import, the variants drawer reloads in-place so the
  user sees the result immediately.

**Tests** (`tests/test_cover_regen.py`, +2 new tests, 6/6 pass):
- `test_community_share_browse_and_import` — end-to-end: A shares,
  re-share is idempotent, B browses + imports, `import_count` goes to
  1, non-sharer unshare is 403, sharer unshare is 200, then the cover
  vanishes from the browse list.
- `test_community_browse_requires_title` — empty title 400s.

**Parked for later sessions** (the rest of the cover-ecosystem roadmap):
- Tier 2: Style packs / "generate in this style" / "apply style across
  library" / custom user styles
- Tier 3: Voting / featured / style trending / public profile gallery
  / cover challenges
- Tier 4: Reference image upload / series consistency / A/B vote pick
  / cover history timeline

---



## 2026-06-17 — AI cover regeneration (nano-banana) ✅

EPUBs without their own cover image used to render as a flat brand-
coloured "book spine" placeholder.  Users can now regenerate any
cover via AI — Gemini Nano Banana
(`gemini-3.1-flash-image-preview`) through the Emergent Universal
LLM key.

**Design constraints baked into the prompt** (locked in after user
sign-off):
- 2:3 vertical book-cover aspect (~600×900, model returns ~912 KB PNG)
- Sage / cream / warm palette matching the Shelfsort aesthetic
- Symbolic / atmospheric — *not* fan-art photorealism
- No human faces (sidesteps real-person ship issues + uncanny valley)
- No copyrighted character designs — fandoms evoked through props /
  symbols / atmosphere (lanterns, moths, runes, dusk gradients, …)
- Title + author rendered directly onto the cover in serif typography
- No watermarks / fictional publisher marks

**Backend** (`backend/utils/cover_gen.py`, `backend/routes/books.py`):
- `utils/cover_gen.py::generate_cover(book, nudge=None)` — single-call,
  single-image coroutine.  Composes a structured prompt from title /
  author / fandom / tags / description + optional free-text nudge.
  Returns `(png_bytes, prompt)` for the audit log.
- Two-phase endpoint flow so the user previews before committing:
    * `POST /api/books/{book_id}/preview-cover` → generates, caches
      bytes in memory under a one-shot `preview_id` (TTL 1 hour),
      returns base64 PNG.  DB untouched.
    * `POST /api/books/{book_id}/apply-cover` → persists the cached
      bytes to `{user_dir}/{book_id}.cover`, sets `has_cover: True`
      + `cover_source: "ai_generated"` + `cover_generated_at` on the
      book doc, pops the cache entry (one-shot).
- Original EPUB file is NEVER touched — cover lives alongside as a
  sibling `.cover` file.
- Preview cache enforces book_id + user_id ownership on apply.

**Frontend** (`components/RegenerateCoverButton.jsx`, integrated into
`components/BookCard.jsx`):
- Hover-revealed sparkles icon top-left of every book card.  Opens
  a modal with:
    * 2:3 aspect preview frame (always sized so loading doesn't jank).
    * Loading spinner ("Designing your cover…") while the model runs.
    * Free-text "Optional direction" nudge field
      (`e.g. "more moody" or "include a lantern motif"`, max 120 chars).
    * **Try again** button — regenerates with the current nudge.
    * **Use this cover** button — calls apply, toasts, closes,
      refetches the parent card.
- All testids prefixed `regen-cover-*` so the testing agent can drive
  the flow.

**Tests** (`tests/test_cover_regen.py` — 3 tests, ~30 s, includes 2 real
nano-banana calls):
- `test_preview_cover_returns_base64_and_preview_id` — endpoint smoke.
- `test_apply_cover_rejects_wrong_user` — user B can't apply A's
  preview_id (cross-user ownership check).
- `test_apply_cover_persists_and_flips_has_cover` — end-to-end: cover
  file lands on disk, `has_cover` flips, `cover_source` is recorded,
  second apply with the same preview_id is rejected (one-shot).

Verified live: 912 KB PNG generated in ~9 s for a Twilight-style sample
book.  Full regression suite still green.

### Bulk "Polish my covers" page

Same flow, applied to the whole library in batches.

**Backend** (`routes/books.py`):
- `GET /api/books/cover-less?limit=100` — returns books owned by the
  caller that don't yet have a cover (id + title + author + fandom +
  tags + category).  Capped at 200 because each cover generation is a
  paid LLM call.

**Frontend** (`pages/PolishCoversPage.jsx`, new route
`/library/polish-covers`):
- Status strip: how many books lack covers, how many previews are
  queued, how many were applied this session.
- Batch selector — 1 / 3 / 5 / 10 / 20 at a time.  "Generate next N"
  fires all in parallel via `Promise.all` (nano-banana handles
  concurrent calls fine).
- Per-tile state machine: idle → loading → preview (Keep / Try again
  / Skip) → applying → applied.  Each transition is testid'd so the
  testing agent can drive the full flow.
- "Apply all kept" — sequentially applies every previewed cover with
  one click.
- Empty-state celebrates the "every book has a cover" outcome.

**Discoverability**:
- `PolishLibraryPage` (the metadata-cleanup peer) gets a small
  "Looking to fix missing cover art? → Polish my covers" link in its
  header.

### Cover variants gallery

Don't throw away an old cover when the user generates a new one — keep
up to 5 per book so they can switch back without re-paying for
generation.

**Backend** (`routes/books.py`):
- `apply-cover` now stores the bytes under `{book_id}.cover-v-{nonce}`
  alongside the existing `{book_id}.cover` (which still acts as the
  served file).  Book doc grows a `cover_variants: [...]` array.  Cap
  at 5 variants per book — when full, the oldest inactive variant is
  FIFO-dropped from both disk and the array.
- `GET /api/books/{id}/cover-variants` — returns every variant inline
  as base64 PNG plus the `active_variant_id`.  Inline base64 means the
  modal can render the thumbnail strip with zero extra round-trips.
- `POST /api/books/{id}/cover-variants/{variant_id}/activate` —
  rewrites `{book_id}.cover` to point at the chosen variant.
- `DELETE /api/books/{id}/cover-variants/{variant_id}` — refuses to
  delete the currently active variant (would leave `has_cover: true`
  with no file).

**Frontend** (`components/RegenerateCoverButton.jsx`):
- "Previous covers (N)" drawer at the bottom of the existing modal.
  Renders only once we know there are variants (no flash of empty UI).
- Click any thumbnail to switch the active cover — purple ring marks
  active.  Click the X on an inactive thumbnail to delete it.
- After "Use this cover", the variants drawer refreshes in-place so
  the newly-applied cover appears immediately without closing the
  modal.

**Tests** (`tests/test_cover_regen.py`):
- `test_cover_variants_listed_activated_and_deleted` — applies two
  covers in a row, verifies the list has both with the second active,
  activates the first, verifies deleting the active one 400s and
  deleting the inactive one 200s.  Uses 2 real nano-banana calls.

Full suite: **4/4 cover tests pass**, ~42 s including 4 live nano-
banana generations.  Storage cost: ~1 MB × 5 variants × N books = ~30
MB per heavy user.  FIFO cap prevents runaway growth from
"Try-again-50-times" users.

---



## 2026-06-17 — Mobile site-wide fix ✅

Reported issue: site horizontally overflows on Android phones, making
the whole UI hard to use.  Fixed with a CSS safety net + a few key
grid responsive overrides — **0 / 8 audited pages overflow at 320px**
or 412px viewports after the change.

**`frontend/src/index.css` — Mobile safety net block (≤640px):**
- `html, body { overflow-x: hidden; max-width: 100vw; }` — belt-and-
  braces document-level cap so no rogue child can introduce a horizontal
  scrollbar.
- `[class*="min-w-\\["] { min-width: 0 !important; }` — relaxes every
  arbitrary Tailwind `min-w-[NNNpx]` (filter inputs, popovers,
  AllBooksPage search, SmartShelves selects, CrossoverShelf search,
  AdminConsole filters, etc.) to allow shrink on phones.  Desktop
  layouts unchanged.
- Long words / URLs / tag names break on `p/span/h*/li/td/code` via
  `overflow-wrap: anywhere; word-break: break-word;` so user-typed
  strings never push the container.
- `<table>` without an explicit scroll wrapper falls back to
  `display: block; overflow-x: auto;` so admin-tables scroll inside
  themselves rather than the page.
- `[role="dialog"]` + radix popper content forced to
  `max-width: calc(100vw - 1rem)` so the welcome tour, share dialogs,
  and friend-request modals don't punch outside the viewport on small
  Android screens.
- `-webkit-overflow-scrolling: touch;` on `.overflow-x-auto` /
  `.overflow-x-scroll` so existing horizontal scrollers feel native.

**Responsive grid fixes** — three 3-column-on-everything grids
upgraded to `grid-cols-2 sm:grid-cols-3`:
- `components/StatsCard.jsx`
- `components/LibraryReadingStatsCard.jsx`
- `pages/FindDuplicates.jsx`

**Verification (Playwright with `Emulation.setDeviceMetricsOverride`):**
- 412px viewport (typical Android, e.g. Pixel 7): `/library`,
  `/account/emails`, `/admin`, `/bookclubs`, `/all` — `overflows: false`.
- 320px viewport (smallest Android still in service): `/library`,
  `/admin`, `/bookclubs`, `/account/emails`, `/all`, `/find-duplicates`,
  `/stats`, `/find-fandoms` — all `overflows: false`.

No backend changes; full pytest suite (56 tests across moderators,
digest, dark-mode, goal events, landing stats) still green.

---

## 2026-06-17 — Mobile slim navbar (follow-up) ✅

Follow-up to the mobile overflow fix.  The navbar was rendering 7-8
icon buttons in a row (Appearance, Notifications, Messages, Streak,
Updates, Avatar, Menu) which got tap-blurry and visually noisy on
Android.

**`frontend/src/components/Navbar.jsx`**:
- Wrapped Appearance / Messages / Streak / Updates in a single
  `<div className="hidden sm:flex ...">` container, so they only
  render at ≥ 640px viewports.  Tablet & desktop unchanged.
- Notifications bell + Avatar + Menu hamburger stay visible on phones
  — the three most-tapped controls.
- Drawer (`SecondaryLinks` with `inDrawer`) grows a "Personal" section
  (mobile-only via `sm:hidden`) with:
    * "Appearance" → `/account/appearance`
    * "Reading streak & goals" → `/goals`
  so the hidden-on-mobile destinations remain reachable in one tap.
- Drawer already had "Messages" so no change needed there.

Phone navbar is now 4 elements wide (brand → Bell → Avatar → Menu).
Lint clean, webpack compiles, regression suite still green.

---

## 2026-06-17 — Mobile tap-target sizing ✅

Apple HIG specifies 44pt minimum tap targets; Material recommends 48dp.
Several inline icon-only buttons (toast close, pagination chevrons,
chapter-tab pills, ~32px `p-1.5`-padded icons) were below that floor,
making them hard to hit reliably on Android.

**`frontend/src/index.css`** (inside the existing mobile safety-net
block — `@media (max-width: 640px)`):
- `.tap-min` utility — explicit opt-in for buttons we want bumped to
  44×44 with centred icon content.
- **Global icon-only floor** — any `<button>` or `<a>` whose only child
  is an `<svg>` gets a 40×40 minimum via the CSS `:has()` selector
  (supported in every evergreen browser since 2024).  Catches every
  icon button we didn't manually update without bloating textual
  buttons.
- **Chapter-tab pills** (`[data-testid^="chapter-tab-"]`) — bumped to
  36px tall with extra horizontal padding so the row of chapter
  numbers in a bookclub room stops being a precision-tap exercise.

**Component edits**:
- `components/ui/toast.jsx` — added `tap-min` to the absolute-positioned
  close X (was `p-1`, ~24px).
- `components/ModerationLogCard.jsx` — added `tap-min` to the Prev /
  Next pagination buttons.

**Verification** (Playwright + CDP at 412px viewport):
- Audited all icon-only `<button>` / `<a>` elements on the post-login
  page.  Result: **0 elements below 40×40**.  3 icon buttons measured
  (tour close, tour back, tour next) — all exactly 40×40 thanks to the
  new floor.

Lint clean, webpack compiles, 56-test regression suite still green.

---

## 2026-06-17 — Mobile hotfix: vertical-letter heading bug ✅

User reported every page showing the title rendering ONE LETTER PER
LINE (e.g. "Library by the numbers" stacked vertically as L-i-b-r-a-
r-y-…).  Two compounding causes, both shipped earlier today:

1. **Too-aggressive overflow-wrap** — the mobile safety-net block had
   `overflow-wrap: anywhere; word-break: break-word;` on `p, span,
   h1, h2, h3, h4, li, td, code`.  `anywhere` lets the browser break
   between any two characters even mid-word, which is correct for
   60-char tags but catastrophic for a heading squeezed into a 30px
   flex column.
2. **Crushed flex column** — `LibraryStatsCard` had a 3-button period
   selector (Day / Week / Month) sharing a row with the heading, with
   the heading on `flex-1` (no `min-w-0`) and the buttons on
   `flex-shrink-0`.  At narrow widths the heading's column shrank to
   ~30px, so the buttons demanded all the space and the heading
   wrapped at every character.

**Fixes** (`frontend/src/index.css`, `components/LibraryStatsCard.jsx`):
- Replaced `overflow-wrap: anywhere; word-break: break-word;` with
  the milder `overflow-wrap: break-word;` — breaks only when a single
  word would overflow the container, never mid-word for normal prose.
  Also dropped the rule from `h1/h2/h3/h4/span` (headings rarely
  contain user-supplied runaway strings; let them be).
- Added `.break-anywhere` opt-in utility for places that DO need the
  aggressive break (long URLs, tag clouds).
- `LibraryStatsCard` header now uses `flex-wrap sm:flex-nowrap`,
  `flex-1 min-w-0` on the title column, and `w-full sm:w-auto` on the
  button group — so on phones the Day/Week/Month tabs wrap to a new
  line below the title with full breathing room.
- Title also shrinks from `text-2xl` → `text-xl` on phones.

Verified at 412px: heading renders normally, 364px wide × 72px tall
(2 lines), zero one-letter wrapping.  No backend changes; full regression
suite (16 dark-mode + moderator tests) still green.

**Follow-up: Account page Email preferences card** — same pattern
as LibraryStatsCard.  Title + subtitle squeezed by the right-aligned
"Manage" button.  Applied `flex-wrap sm:flex-nowrap` + `w-full sm:w-auto`
on the button + `text-xl sm:text-2xl` shrink on the heading so the
"Manage" CTA stacks below the description on phones.

**Note:** Browsers cache CSS aggressively.  Existing users may see
the old `overflow-wrap: anywhere` until their phone hard-refreshes
the stylesheet.

**Follow-up: Site-wide `.shelf-card` CTA wrap** — user reported the same
crushed-column issue on 5+ pages (Polish my library, Find duplicates,
Merge crossover fandoms, Privacy & messaging, Library by the numbers).
Single root cause: cards use a `.shelf-card` wrapper with a `flex
justify-between` header pairing title + CTA button, and the CTA
`flex-shrink-0` was crushing the title column at <640px.

Fixed in `frontend/src/index.css` with a universal CSS rule scoped to
`.shelf-card` (so other layouts are untouched):
- `.shelf-card .flex.justify-between` → `flex-wrap: wrap` on phones,
  so the CTA stacks below the title automatically.
- Trailing `<button>` / `<a class="btn-…">` inside that flex → full
  width on phones so the button looks intentional rather than orphaned.
- `.shelf-card h2` → `text-xl` (1.25rem) on phones instead of
  `text-2xl`, so titles like "Privacy & messaging" wrap to 2 lines
  max rather than ballooning to 3.

Also tightened `LibraryStatsCard` inner tiles
(`grid-cols-2 md:grid-cols-4` of stat cells):
- Icon shrinks `w-5 h-5 → w-4 h-4` on phones.
- Number font shrinks `text-2xl → text-xl` on phones.
- Label gets `truncate` with `title` attribute hover-tooltip so
  "CROSSOVERS" no longer wraps + gets clipped to "CROSSOV".
- Trend copy switches from "no change this week" / "+3 this week" to
  the short "no change" / "+3" on phones (full string still shown at
  ≥ sm via Tailwind responsive `<span>` pair), so the tile no longer
  wraps to 4-6 lines.

Verified: `/library`, `/account`, `/find-duplicates`, `/polish-library`
all `overflows: false` at 412px Android viewport.

**Follow-up v2 — broader `flex justify-between` rule:** User sent 5 more
screenshots showing the same pattern outside `.shelf-card` parents
(Reading goals header, FromFriends digest preview, Theme picker grid,
Reading statistics tiles, Appearance NEW announcement card).

Fixed in `frontend/src/index.css`:
- The `flex.justify-between` wrap rule is now **global** at ≤640px
  (not scoped to `.shelf-card`).  Trailing buttons / `btn-*` anchors
  stack full-width.  Opt-outs for `nav` / `header` / `footer` /
  `[data-testid^="navbar"]` keep the top navbar single-line.
- `.shelf-card h2, main h1` capped at `text-2xl` (1.5rem) on phones —
  prevents marquee-size titles like "Reading goals" or "From your
  friends" from crushing siblings.
- `[data-testid="appearance-theme-options"]` and `[data-testid=
  "theme-picker-grid"]` switched to `grid-template-columns: 1fr`
  on phones so Light / Dark / Auto stack vertically with full-width
  body copy instead of three crushed 80px columns.
- `LibraryStatsCard` inner-tile labels: removed `truncate` (showing
  "B…" / "PA…" was worse than a clean 2-line wrap) and replaced with
  `leading-tight`.  CSS reset rule
  `[data-testid="stats-card"] .truncate { white-space: normal; … }`
  protects against the same pattern in any other tile.

**JSX one-liner:** `AppearancePage` theme grid switched from
`grid-cols-3` → `grid-cols-1 sm:grid-cols-3`.

**Verified at 412px viewport (6 pages):** `/library`, `/account/appearance`,
`/goals`, `/stats`, `/recommendations`, `/friends` — all `overflows:
false`.  Landing hero "Open library" CTA now stacks below the brand
on phones (was crushing the brand into "Shelfsort" wrapping).

---



## 2026-06-17 — Moderators role ✅ + Moderation log

Third permission tier between regular users and full admins, plus an
append-only history surface so every mod action is auditable forever.

### Moderators role

Third permission tier between regular users and full admins.  Mods can
approve/reject pending sign-ups and lock/unlock bookclub rooms, but
**cannot** ban users, demote admins, set feature flags, delete EPUB
uploads, or run any destructive admin action.

**Backend** (`models.py`, `auth_dep.py`, `routes/admin.py`,
`routes/bookclubs.py`, `routes/auth.py`):
- `User.is_moderator: bool = False` — independent from `is_admin`.
- `auth_dep.require_moderator_or_admin` — new dependency, returns the
  user if EITHER flag is set, else 403.
- `POST /admin/users/{id}/promote-mod` + `/demote-mod` — admin-only,
  idempotent, audit-logged.
- `GET /admin/pending-users`, `POST /admin/users/{id}/approve`, and
  `POST /admin/users/{id}/reject` — relaxed from `require_admin` to
  `require_moderator_or_admin` so mods can triage the queue.
- `POST /bookclubs/{room_id}/lock` + `/unlock` — new mod/admin endpoints.
  Locking writes `is_locked: True` plus `locked_by`, `locked_by_name`,
  `locked_at` onto the bookclubs doc.  `post_message` now refuses with
  `423 Locked` when the room is frozen; reads remain open.
- `_serialize_room` exposes `is_locked` / `locked_by_name` / `locked_at`
  so the frontend can render the banner without an extra fetch.
- `_hydrate_users` + `_serialize_member` now return `is_moderator` /
  `is_admin` so chat bubbles can render the platform badge inline.
- `/auth/me`, `/auth/login`, `/auth/register`, `/profile` all echo
  `is_moderator` alongside `is_admin` so frontend role checks work
  immediately after login.

**Frontend** (`App.js`, `Navbar.jsx`, `AdminConsole.jsx`,
`pages/ModInbox.jsx`, `pages/bookclubs/ActiveRoomPanel.jsx`):
- New `ModeratorRoute` guard — admins or mods pass, everyone else
  bounces to `/library`.
- New `/admin/pending` page (`ModInbox.jsx`) — focused dashboard for
  mods who don't have full admin access.  Reuses the approve/reject
  flow from AdminConsole.
- `Navbar` shows a Mod-inbox shortcut for mods-who-aren't-admins (sea-
  green ShieldCheck).  Admins continue to see the purple Admin button.
- `AdminConsole > Users & admins` card grows a green "Mod" pill next to
  the existing "Admin" pill, plus a "Mod" / "Unmod" toggle button next
  to the existing "Promote" / "Demote".
- `ActiveRoomPanel`:
    * Lock/Unlock icon button in the room header for any user with
      `is_moderator` or `is_admin`.
    * `room-locked-banner` above the chapter tabs when locked, naming
      the mod who froze it (visible to everyone).
    * Message composer is hidden when the room is locked.
    * Per-member "Mod" / "Admin" pill rendered next to the username so
      moderation interventions look authoritative.

**Tests** (`tests/test_moderators.py`):
- `/auth/me` echoes `is_moderator`.
- Promote/demote-mod is admin-only and idempotent.
- Mods can approve pending sign-ups; regular users get 403.
- End-to-end lock test: mod locks → owner can't post (423) → mod
  unlocks → owner posts successfully.
- Regular users can't lock rooms (403).
- `/admin/users` carries the `is_moderator` field for the toggle column.

All 8 moderator tests + 4 dark-mode override tests + the full goals /
digest / bookclub regression suite pass.

### Moderation log

**Backend** (`routes/admin.py`, `routes/bookclubs.py`):
- `lock_bookclub` + `unlock_bookclub` now call `record_admin_action`
  (action slugs `bookclub.lock` / `bookclub.unlock`), so every freeze
  / thaw lands in the same `admin_audit` collection as user.approve
  / user.promote / etc.
- New `GET /admin/moderation-log` endpoint:
    * Open to mods AND admins (uses `require_moderator_or_admin`).
    * Query params: `limit` (1-200), `offset` (≥0), optional `actor_id`,
      optional `action` (must be one of the `MODERATION_ACTION_SLUGS`).
    * Append-only — entries live forever in `admin_audit`.  Pagination
      is server-side so the UI can scroll back to day-0 without us
      shipping megabytes per request.
    * Targets are hydrated (`target_display`) so the UI shows real names
      instead of opaque uuids; gracefully falls back to the raw id for
      since-deleted users / rooms.
    * Returns `{entries, count, limit, offset}` — `count` is the total
      across all pages so the pager can render "Page X of Y".

**Frontend** (`components/ModerationLogCard.jsx`, `AdminConsole.jsx`,
`ModInbox.jsx`):
- New `ModerationLogCard` component — accepts `pageSize`, `actorId`
  (scope to one mod), and `showFilter` props.  Filter pills for each
  action slug, Prev/Next pagination, action-tinted badges, and target
  hydration with reject-reason in-line for `user.reject` rows.
- AdminConsole gains a new "Moderation log" card surfacing the full
  platform history (all mods, all actions).
- Mod Inbox (`/admin/pending`) gains a "My moderation history" section
  scoped to the logged-in mod's own actions via `actorId={user.user_id}`,
  so they can verify their own paper trail without scanning everyone
  else's.

**Tests** (`tests/test_moderators.py` — 4 added):
- `test_moderation_log_records_every_action` — promote, approve, lock
  all land in the log with hydrated target_display.
- `test_moderation_log_pagination` — `limit`/`offset` slice correctly,
  total count stable across pages, newest-first ordering.
- `test_moderation_log_mod_can_access_own_history` — mods can read the
  log (scoped to themselves).
- `test_moderation_log_regular_user_blocked` — non-mod, non-admin gets
  403.

Total: **12 moderator tests passing**, all-time log retention confirmed
(no pruning logic — entries live as long as the collection does).

---



## 2026-06-17 — Reader cheatsheet, dynamic landing stats, SSE goal-hit stream + 2 regression fixes ✅

Polish sprint that knocked out 4 P2/P3 items + 2 P0 test regressions.

**Backend** (`routes/goals.py`, `routes/stats.py`, `utils/goal_events.py`):
- New `utils/goal_events.py` — in-memory async pub/sub keyed by user_id.
  Bounded queue per subscriber (max 16) so a stuck client can't OOM the
  worker. Fan-out via `publish_goal_hit(user_id, goal)`.
- `_maybe_mark_hit` in `routes/goals.py` now calls `publish_goal_hit`
  after stamping `hit_at` — every connected tab gets the celebration
  instantly without any polling.
- New `GET /api/goals/stream` SSE endpoint. 25s keepalive heartbeat,
  cleans up on disconnect, emits `event: goal-hit` frames with the
  goal payload as JSON.
- New `GET /api/landing/stats` (public, unauth) — returns
  `{books_sorted, fandoms_recognized, as_of}`. 5-minute in-memory cache
  so a viral landing-page moment can't hammer the books collection.

**Frontend** (`components/GlobalConfettiHost.jsx`, `pages/Landing.jsx`,
`pages/ReadOriginal.jsx`):
- `GlobalConfettiHost` replaces 90s polling with an `EventSource`
  connection. Still pulses `/goals` once on mount for cross-device
  catch-up + de-dupes against `shelfsort_goals_celebrated` localStorage
  so the same goal doesn't celebrate twice.
- Landing page `FandomTicker` fetches `/landing/stats` and renders the
  real numbers — "64+ fandoms · 6,607 books sorted · Harry Potter".
  Falls back to the static "150+ fandoms" copy if the fetch fails.
- ReadOriginal viewer gains a `?` keyboard cheatsheet overlay
  (also openable via a `<Keyboard>` icon button in the header).
  Lists J/K paging, Cmd/Ctrl+B bookmark, `?` toggle, Esc close. Modal
  with backdrop dismiss + Escape handling.

**Regression fixes**:
- `tests/test_dark_mode_overrides.py` — added missing overrides for
  `bg-[#FBE7DF]` (Landing inline-card peach tint) and `text-[#4C2A99]`
  (deep brand purple used by the fandom-ticker pill and PolishLibrary
  banner) in `frontend/src/index.css`.
- `tests/test_digest.py::TestRegression::test_auth_register_login_logout`
  — modernized to assert the post-approval-gate behavior:
  `register` returns `{"pending": true}` with no session cookie,
  `login` is blocked while pending.  Also added a `REACT_APP_BACKEND_URL`
  fallback so the test no longer crashes at collection time.

**New tests** (`tests/test_goal_events_and_landing.py`):
- Pub/sub: no-subscriber publish is silent, single receive, fan-out
  to multiple subs for the same user, isolation between users.
- HTTP: SSE endpoint 401s unauth, landing stats return correct shape +
  identical `as_of` on cache hit.

---

## 2026-06-17 — Reader J/K shortcuts + bookclub engagement-gate hint ✅

Two quick-win P3 polish items knocked out:

**Frontend** (`pages/ReadOriginal.jsx`):
- Added Vim-style `J` / `K` page-flip keyboard shortcuts to the scroll-based
  Originals viewer (TXT, DOCX). Skips when typing in a form field, ignores
  meta/ctrl/alt/shift combos, and scrolls by 85% of viewport height with
  smooth behaviour for context preservation across jumps.
- PDFs intentionally excluded — the iframe owns its own paging.
- Visible affordance via the scroll container's `title` attribute
  ("Press J / K to page forward and back") so it's discoverable without
  cluttering the UI.

**Frontend** (`pages/EmailPreferences.jsx`):
- Added an Engagement-gate hint card to the Book-club weekly digest section
  (`data-testid="bookclub-digest-engagement-hint"`). Explains the 28-day
  silent-pause rule enforced server-side by `_user_recently_engaged()` in
  `backend/routes/bookclubs.py`, so users no longer assume the toggle is
  broken when their inbox goes quiet.
- Pure copy + `<Info>` icon; no new dependency, no backend changes.

---



## 2026-06-16 — "Polish my library" bulk metadata cleanup ✅

Ride on the in-place EPUB writer we shipped earlier today: scan the user's
library for books whose title still looks like a filename or whose author is
"Unknown"/blank, suggest cleaned values inferred from the file or source URL,
and apply per-field with one click — writing into both the DB and the EPUB.

**Backend** (`utils/polish.py`, `routes/books.py`):
- New `utils/polish.py` — pure-function heuristics for `suggest_polish(book)`
  and `polishable_mongo_filter()`. Errs on the side of NOT suggesting a change
  to keep false-positives near zero.
- Title heuristics: empty / "Unknown" / "Untitled" / equal-to-book_id / ending
  in `.epub` / heavy underscores / all-caps-and-digits. Cleanup strips `.epub`,
  swaps underscores for spaces, smart-title-cases (keeps small words lowercase,
  preserves all-caps tokens like POV / AU).
- Author heuristics: empty / "Unknown" / "Unknown Author" / "anonymous".
  Inferred from `source_url` — AO3 (`/users/{handle}/...`) and FFNet
  (`/u/{id}/{handle}`) handles, with `_` → space normalization.
- New endpoints:
  - `GET /api/books/polish/preview?limit=N` — returns suggestions + a global
    candidate count.
  - `POST /api/books/polish/apply` — accepts `{items: [{book_id, apply_title,
    apply_author}]}`. Re-runs `suggest_polish` server-side on every item
    (defence in depth against tampered payloads). For each applied item,
    updates DB and calls `update_epub_metadata()` if the file exists.

**Frontend** (`pages/PolishLibraryPage.jsx`, `App.js`, `Account.jsx`):
- New route `/library/polish` with the cleanup UI:
  - Per-book card showing `old → new` diff for title and author, each with its
    own checkbox so users can accept one and reject the other
  - "Select all / none / Rescan" bulk controls
  - "Apply N changes" pill that updates live
  - Empty-state when library is already clean ("Your library looks great!")
- Account page gets a `Polish my library` shelf-card pointing at the new route
  (purple `Wand2` icon, slotted above Find Duplicates).

**Tests** — new `tests/test_polish.py` with 9 cases:
- Preview: clean library returns nothing
- Preview: messy title (`.epub` filename) gets clean suggestion
- Preview: Unknown author gets AO3 handle inferred from source_url
- Preview: book_id-as-title gets a cleanup
- Apply: writes DB
- Apply: respects per-field opt-in (title-only or author-only)
- Apply: skips books that are no-longer-polishable
- Apply: refuses to touch another user's books even if the id is known
- Apply: empty payload → no-op

**All 9 passing.** Smoke-tested e2e — seeded 3 messy books for the tester
account, opened `/library/polish`, confirmed 3 rows rendered with correct
suggestions, verified Select all / Select none toggles update the "Apply N"
count correctly. Cleanup ran post-test to restore tester library to its
seed state.

## 2026-06-16 — "Rooms I'm watching" admin card ✅

Companion to the oversight feature: the Admin Console now has a top-level
**"Rooms I'm watching"** card that lists every bookclub the platform owner
has been auto-added to (plus any club they own outright). Solves the "how do
I find a room I'm in without poking around" problem before it shows up.

**Backend** (`routes/admin.py`):
- New `GET /api/admin/bookclubs/watching` — returns rooms where the calling
  admin holds `role: oversight` or `role: owner`, with: room name, book
  title + author, owner display name + email, real member count
  (oversight-excluded), message count, last-message-at, my_role, created_at.
- Sort: most recent activity first; rooms with no messages fall back to
  creation date.
- Any admin can call it — but non-platform-owners will usually see an empty
  list (only platform-owner is auto-joined as oversight).

**Frontend** (`pages/AdminConsole.jsx`):
- New `WatchingBookclubsCard` (Eye icon, manifest entry with keywords
  "oversight clubs moderate watching"). Empty state explains where the data
  will come from. Each row shows the OWNER vs OVERSIGHT badge so it's clear
  which rooms you're moderating vs running.
- "Open" link goes straight to `/bookclubs/{room_id}` so you can read the
  thread without opening the regular bookclub list.
- Card slotted between Users & Admins and Chat rooms in the cards stack.

**Verified e2e** — temporarily flagged the tester as platform_owner, seeded
a demo bookclub with a message, hit `/api/admin/bookclubs/watching` (returned
the seeded room correctly), then opened `/admin` in a browser, expanded the
card, confirmed the room rendered with badge + member count + message count
+ last activity timestamp + working Open link. Restored production state
(platform_owner back on Jessica, demo room deleted).

## 2026-06-16 — Always-on Admin Oversight in bookclub rooms ✅

User decision: the single original platform owner should be in **every** bookclub
room automatically, no matter how many rooms exist. Privacy-respecting defaults
on every dimension (chose: bookclubs only / visible badge / single owner /
both backfill + going-forward / no notifications).

**Backend** (`routes/bookclubs.py`):
- New `is_platform_owner: true` flag on the users collection (set on the real
  primary admin row). Other `is_admin` rows are untouched.
- New `_get_platform_owner_id()` + `_ensure_oversight_member()` helpers
  (in-process cache, requires restart to pick up flag transfers).
- `create_bookclub` auto-adds the platform owner with `role: "oversight"` and
  `status: "active"`. Idempotent — re-create / re-grant safe.
- Guards added to `remove_member`, `change_role`, `transfer_ownership`,
  and `leave_bookclub` so the oversight row is sticky.
- Notification fan-outs (`bookclub_message`, `bookclub_finished` milestones)
  exclude `role: oversight` — the platform owner's inbox stays clean.
- "Member count" aggregation filters out oversight so room cards don't show
  inflated counts.
- Sort order: owner → moderators → members → oversight (pinned to bottom).

**Backfill**: ran a one-shot mongosh script to add oversight rows into every
existing bookclub. (0 rooms existed at time of rollout, but the script is
documented here for the next time it's needed.)

**Frontend** (`pages/bookclubs/ActiveRoomPanel.jsx`):
- Members panel now renders an **Admin (oversight)** pill (purple-tinted, Eye
  icon) next to the platform owner's name. Title-tooltip explains: "Platform
  admin with read access for safety + moderation. Never receives notifications."
- Oversight row gets a subtle `bg-[#EDE7FB]/40` highlight and no chapter-progress
  line (they aren't reading along).
- Promote / Demote / Transfer / Kick action buttons are hidden for the
  oversight row regardless of who's viewing — even the room owner can't act
  on it.
- "Members · N" header now uses `realActiveCount` (excludes oversight).

**Tests** — new `tests/test_oversight_membership.py` with 7 cases:
1. Oversight added on create
2. Visible in member list as role "oversight"
3. Member count excludes oversight
4. Kick attempt → 400
5. Promote attempt → 400
6. When platform-owner IS the creator, no duplicate row — they're "owner" not "oversight"
7. Platform-owner can't self-leave → 400

**All 7 passing.**

**Scope notes (do not regress)**:
- Friend **DMs are NOT affected** (`view_consents` flow still required).
- Only the single `is_platform_owner: true` user — not every admin.
- No email digests / push notifications fan out to the oversight role.

## 2026-06-16 — Landing hero: animated fandom ticker ✅

Tiny welcoming flourish below the hero subtitle: a pill that says
**"150+ fandoms · {cycling name}"** where the name fades through a curated
list of well-known fandoms (Harry Potter, ACOTAR, Marvel, Twilight, Star Wars,
Hunger Games, Percy Jackson, Bridgerton, Stranger Things, Doctor Who, Sherlock,
Good Omens, Lord of the Rings, House M.D., Friends, Avatar) every 2.4s with a
fade-in animation. Pulsing purple dot on the left for that "live" feel.

- Static list (no API call) so the unauthenticated Landing paints instantly
- Fixed `min-width` on the name slot prevents the surrounding line from jittering
  as short/long fandom names swap in
- Hover **pauses** the rotation so a visitor reading a specific name can finish
- Verified e2e: ticker advances ACOTAR → Marvel → Twilight on a 3s wait, and
  stays put for 3.5s while the cursor hovers

## 2026-06-16 — Landing page: recolored hero + welcoming feature reveal ✅

The unauthenticated `/` Landing page got a coat of paint:

**New hero illustration** — Gemini Nano Banana (`gemini-3.1-flash-image-preview`)
recolored the existing reading-nook image with the original as a reference,
keeping the EXACT same composition (window, armchair, throw, side table with
mug + glasses, framed art, book stacks). New palette:
- Armchair: deep sage / forest green
- Pillow: plum (#6B46C1, brand-tied)
- Throw: cream linen with plum stripes
- Wall: warm off-white, floor: walnut
- Books on the floor: mixed burgundy / plum / sage / cream spines

Image saved to `frontend/public/landing-hero.png` (1024×1024 PNG, 900 KB) so it
travels with the app's static assets — no external CDN dependency.

**New "More than a sorter" section** — sits between the 3-feature "How it works"
trio and the Sample Shelves preview. Six brand-tinted cards introduce visitors
to features that live behind the sign-in wall:
1. Year in Books, Wrapped — emphasizes PNG download / social share
2. A reader that respects your eyes — EPUB / PDF / TXT / DOCX, dark mode, zero ads
3. Goals & streaks (gently) — confetti language, anti-guilt framing
4. Friends who actually read — @handle, library overlap, opt-in shares
5. Book clubs, with chapters — auto-prompts, weekly digest emails
6. Fix messy metadata, in place — ties back to the just-shipped in-place EPUB editing

Plus a richer hero subtitle ("…a clean reader, a year-end recap, friends to talk
about them with, the works.") and a tighter bottom-CTA blurb that name-checks
Year in Books and book clubs explicitly.

**Light/dark mode** — Landing is theme-aware via the global `ThemeContext`
(default `mode: auto`, follows OS `prefers-color-scheme`). Both versions verified
via screenshot; the new image and all 6 cards render cleanly on cream and on
deep-slate backgrounds.

## 2026-06-16 — In-place EPUB metadata editing ✅ (P3)

The Edit button on a book detail page now lets users fix **title / author /
description** alongside category and fandom. Edits are written into the
EPUB file itself — so when the book is downloaded or shared, the corrections
travel with it.

**Backend** (`routes/books.py`):
- Extended `UpdateBookBody` with `title`, `author`, `description` (length-capped
  at 500/500/5000 chars to keep paste-bombs from blowing up docs).
- `PATCH /api/books/{book_id}` now updates DB first, then calls the new
  `update_epub_metadata(filepath, title=..., author=..., description=...)`
  helper if any user-visible metadata field changed AND the EPUB exists on
  disk. Response includes `epub_updated: True|False|None`.
- Helper works by surgically rewriting the OPF XML (lxml + zipfile) — not
  via ebooklib's flaky `write_epub`. Chapters, covers, NCX, and every other
  byte stay identical. Only `<dc:title>` / `<dc:creator>` / `<dc:description>`
  get replaced. Atomic .tmp → rename so a crash mid-write can't corrupt.
- Classification fields (category/fandom) are now optional — sending a payload
  with only `{title: "..."}` no longer flips `classifier: manual` falsely.

**Frontend** (`pages/BookDetail.jsx`):
- Edit panel grew Title / Author / Description fields (description is a 4-row
  textarea with `maxLength={5000}`).
- `saveEdit` is diff-aware: only sends fields the user actually changed, so a
  category-only edit doesn't trigger an EPUB rewrite.
- Toast surfaces the rare "EPUB file couldn't be re-saved" case so the user
  knows the DB is updated but the file wasn't.

**Tests** — new `tests/test_inplace_metadata.py`:
- Round-trip: PATCH → download EPUB → ebooklib reads back the new metadata
- Partial edit: only `title` changes, author/description preserved
- `{}` payload returns `noop: true`
- Category-only PATCH leaves `epub_updated: null` (file untouched)
- Length caps enforced at 500/500/5000 chars
- Unauthenticated PATCH → 401/403
- **6/6 passing.**

**Help page** — bumped What's-new (re-prompts users), added a paragraph in
"Detection & overrides" explaining the in-file rewrite and the chapter-safety
guarantee.

## 2026-06-16 — Help page refreshed for the session ✅

`pages/Help.jsx`:
- Bumped What's-new version to `2026-06-16-png-share` (re-prompts dismissed users)
- New What's-new items: "Download your Year in Books as a PNG", "Share links now unfurl rich previews", "Friends DM dots auto-refresh"
- Year-in-Books section now documents the Download-as-PNG + Copy-image buttons, the 1080×1350 portrait format, the browser-support fallback, and the rich-preview unfurl story (server-side 1200×630 OG card on Twitter / iMessage / Slack / Discord / LinkedIn)
- Messages section adds a line about the 20-second auto-refresh of unread dots

Verified e2e: navigated to `/help#year-in-books`, confirmed "Download as PNG",
"Copy image", and "unfurl" copy all rendered.

## 2026-06-16 — Friends DM polling for unread dots ✅ (P3)

The Friends page used to load DM unread counts once on mount, then never
refresh until the user manually navigated or opened/closed a DM drawer.
Switched-back-tab scenario meant the red dot never appeared on new DMs.

- New `useEffect` in `pages/FriendsPage.jsx`: polls `loadDmUnread()` every
  **20 seconds**, but only when:
  - the tab is visible (`document.hidden === false`)
  - no DM drawer is open (the user is already reading the messages)
- Also re-fetches **immediately on `visibilitychange`** so coming back from
  another tab updates the dots without waiting for the next tick.
- Cleans up the interval + listener on unmount and on auth-user change.

**Verified e2e** with screenshot tool + request-counter: 2 `/chat/rooms`
calls on initial mount, +1 call after a 25-second idle wait → polling fires.

## 2026-06-16 — Rate limiting on OG share endpoints ✅

Token enumeration defense for `/api/og/yib/{token}` and `/api/og/yib/{token}/image.png`.
Both are unauthenticated, so without a limit someone could brute-force the
128-bit token space. (Still hopeless, but it's free to make it impossible.)

- New `backend/utils/ratelimit.py` — zero-dep sliding-window limiter, threading.Lock
  guarded, plus a `client_ip()` helper that respects X-Forwarded-For / X-Real-IP.
- Both OG routes now call `_og_limiter.check(client_ip(request))` first.
- Limit: 30 requests per 60s per client IP. Crawlers (Twitter, Slack, Discord,
  Facebook) only ping a few times per unfurl, so this is invisible to real users.
  Excess requests return 429 + `Retry-After` header.
- Test coverage: new `TestOgRateLimit` case in `tests/test_og_share.py` uses a
  one-off X-Forwarded-For so it doesn't poison the limiter for other tests.

## 2026-06-16 — OG/Twitter card meta tags for `/share/yib/:token` ✅ (P2)

Public share links now unfurl with a rich preview in Twitter / iMessage /
Slack / Discord / LinkedIn instead of plain text.

- New backend route `GET /api/og/yib/{token}` returns a tiny HTML stub with
  full OG + Twitter `summary_large_image` meta tags **plus** a `<meta http-equiv="refresh">`
  + JS redirect to the real React route `/share/yib/{token}`. Crawlers ignore
  the redirect and parse the meta; browsers redirect transparently.
- New backend route `GET /api/og/yib/{token}/image.png` returns a 1200×630 PNG
  drawn server-side with Pillow (gradient bg, large serif year, "Your year in books."
  subtitle, "{N} books · {streak}-day streak · in {top_fandom}" tagline).
- `_share_public_url()` now points to `/api/og/yib/{token}` so newly-created
  share URLs are crawler-friendly out of the box. Direct visits to
  `/share/yib/{token}` still work for users who already copied old links.

## 2026-06-16 — PRD split → PRD + CHANGELOG + ROADMAP ✅ (P2)

Old 2820-line `PRD.md` reduced to ~70 lines of static product context, with
all dated work moved here. Full original preserved in `PRD.md.bak`.

## 2026-06-16 — AuthContext `refresh()` alias ✅ (P1)

One-liner: `AuthContext.Provider` value now also includes `refresh: checkAuth`.
Any component that wants to heal stale user state (e.g. after granting an
admin consent, after a manual approval, after an account flag flip) can now
`const { refresh } = useAuth(); await refresh();` without importing the
internal `checkAuth` name. No breaking change.

## 2026-06-16 — Copy-to-clipboard companion to PNG export ✅

Added a "Copy image" pill next to "Download as PNG" on the Wrapped outro,
using `html-to-image#toBlob` + `navigator.clipboard.write([ClipboardItem])`.
One-tap paste into Instagram / Threads / iMessage stories.

Capability-gated via a `canCopyImage` boolean (checks `window.ClipboardItem` +
`navigator.clipboard.write`) so the button is **never** rendered in Firefox or
older Safari that can't actually copy images. Failure path toasts a friendly
"try Download as PNG instead" hint instead of throwing.

**Verified e2e**: clicked Copy → success toast shown → `navigator.clipboard.read()`
inside the page confirmed `image/png` payload present.

## 2026-06-16 — PNG export of Year in Books (Wrapped) ✅

**Why**: Year in Books is the most shareable thing Shelfsort produces, but
sharing a 9-slide scroll-jacked recap on social is awkward. A single Instagram-
friendly portrait (1080×1350 @ 2× = 2160×2700) lets users post their year in
one tap — high-leverage organic growth surface.

**What shipped**
- New `frontend/src/components/YearInBooksShareCard.jsx` — purely-inline-styled
  forwardRef component, sized 1080×1350, designed for `html-to-image` capture
  (no Tailwind class deps that could fail to serialize, no images, system+
  Georgia fallback fonts so a Google-fonts CORS hiccup never produces an ugly
  fallback).
- `YearInBooksPage.jsx` now renders the card off-screen
  (`position:fixed; left:-99999px`), exposes a "Download as PNG" button on the
  outro slide (alongside Email / Share), and downloads via
  `html-to-image#toPng(..., { pixelRatio: 2, cacheBust: true })` →
  `shelfsort-wrapped-{year}.png`.
- Toast feedback ("Saved! Share it anywhere.") and disabled state during render.
- Public share surface (`/share/yib/:token`) intentionally **not** exposing the
  download — only the owner can grab their own card.

**Card content (single tasteful default, no multi-slide montage)**
- Header: "Shelfsort wrapped" + year
- Hero: huge serif `{year}` + "Your year in books." italic subtitle
- Stats row: Books · Pages · Streak
- Highlights: Top world (top fandom), Top voice (top author), Reading peak (best month)
- Footer: from shelfsort.app · SHELFSORT brandmark

**Verified e2e via screenshot tool**: button visible → click triggers download →
2160×2700 PNG (8.3 MB) saved with correct filename. Image-analyze pass confirmed
all elements rendered, no glitches, layout clean.

**Dependencies**: `html-to-image@1.11.13` added via yarn.

---

## Pre-2026-06-16 history

All sessions from 2026-02-28 through 2026-06-15 (Year-in-Books Wrapped redesign,
Admin Approval Gate, View-As-User consent flow, test-failure mop-up, 22 ghost
user purge, ACOTAR/Friends/House M.D. fandoms, etc.) are preserved verbatim in
`PRD.md.bak`. They were folded out of the live PRD on 2026-06-16 to keep this
document scannable.
