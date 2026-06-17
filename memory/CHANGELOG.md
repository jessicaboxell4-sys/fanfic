# Shelfsort — Changelog

Append-only log of dated work entries. Newest at the top.

For static product context see [PRD.md](./PRD.md).
For the prioritized backlog see [ROADMAP.md](./ROADMAP.md).
The pre-split verbose history (with every "Added 2026-05-29" line) is preserved verbatim in `PRD.md.bak`.

---

## 2026-06-17 — Moderators role ✅

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
