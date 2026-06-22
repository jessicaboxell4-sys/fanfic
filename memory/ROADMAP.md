# Shelfsort — Roadmap

> Active backlog. Items move to [CHANGELOG.md](./CHANGELOG.md) when shipped.

## ⏰ Parked reminders — bring up next session

(Updated 2026-06-22 evening — Big shipping day: Changelog admin
card, LLM Key Health card, Smart welcome email, Tour-bypass
`?notour=1`, Admin help docs all shipped.  ClamAV + Calibre infra
fix landed in production via Emergent Senior Support.  Three
user-action items + a small handful of P1 candidates remain.)

### 🟡 Two user-action items (no code, just operator touch)

- **Paste your Universal Key balance into `/admin → LLM key health`**
  to activate the runway calculator.  Today's instrumentation is
  already collecting per-call data on every live Claude classify
  and Nano-Banana cover-gen, but the days-of-runway readout
  needs a starting balance to do its math.  Copy from Profile →
  Universal Key.  While you're there, enable auto top-up so you
  don't have to keep coming back.

- **Verify a real PDF upload auto-converts on production**.  The
  ClamAV + Calibre infra fix landed and `/api/admin/antivirus/status`
  returns UP — but the only end-to-end proof is uploading one
  small PDF on shelfsort.com and watching it land in the library
  as an EPUB.  Takes about 30 seconds; high confidence; closes
  the last loop on today's deploy.

### 🟢 Launch-prep items still pending (after Privacy + Terms shipped)

- **Pick a US state of residence** for Terms section 10 (currently
  reads "the operator's state of residence" generically).  Once
  picked, one-line edit + redeploy.  Required before any monetization
  via Stripe — they ask for jurisdiction at onboarding.
- **Add `robots.txt` + `sitemap.xml`** to `/app/frontend/public/`.
  Allows search engines to index without ambiguity; sitemap.xml
  improves crawl coverage for the public pages
  (Landing, Privacy, Terms, Help, Rules, ExploreCovers).  Tiny.
- **Footer-wire Login + Help pages** so the Privacy + Terms links
  are reachable from logged-out states beyond Landing.  Two
  `<SiteFooter />` insertions, ~30 sec.
- **Public launch announcement** — LAUNCH_TWEET.md now has the
  correct shelfsort.com domain in all 4 places; ready to post
  when you're ready.  Three platform variants drafted
  (Twitter/Bluesky/Mastodon).

- **Bulk Send-to-Kindle from Library** — parked 2026-06-22 by user.
  *Currently DEFERRED — the parent Send-to-Kindle feature was hidden
  the same morning (mirrors the FicHub hide-out) to preserve Resend
  free-tier quota.  Both will come back when the operator graduates
  off the 100 emails/day Resend plan.  Implementation sketch below
  is still valid for when that happens.*  Multi-select books on
  /library → "Send selected to Kindle" → backend queues with 30-sec
  spacing between sends to avoid Amazon's rate-limiting + Shelfsort's
  existing per-book 30-min guard.  Should reuse
  ``utils.send_to_kindle.send_book_to_kindle`` + add a thin
  orchestrator that drains a per-user ``kindle_bulk_queue``
  collection.  UI: checkbox column on library cards (already exists
  for bulk delete) + "Send N to Kindle" button in the bulk-action
  bar.  ~45 min implementation + 3-5 tests.

- **`/admin/llm-key-health` card** — parked 2026-06-22 by user.
  Show the Universal LLM Key's API balance + per-day burn rate +
  remaining-cap headroom, so the operator sees a budget cliff
  before AI features (Claude classification, Gemini Nano Banana
  covers) silently fail. Source: backend can call the Emergent
  Universal Key billing endpoint (or read the LiteLLM proxy
  cost-tracking response) — exact path TBD via integration
  playbook. Pairs naturally with the email-volume forecast card
  shipped earlier.  ~30-45 min implementation + 1 test.

- **Resend daily-quota incident (2026-06-22)** — user hit 200% of
  the 100/day free-tier quota on the `jessicaboxell4` Resend team.
  Most likely cause: cron-failure alert fan-out while prod ClamAV
  / Calibre is missing. Suggested next steps when revisited:
    1. Audit `email_logs` collection grouped by `kind` for the
       last 24h to identify the worst offender.
    2. Either pause noisy crons (`cron_failure_alerts` feature
       flag, `stuck_books_reengagement_tick`) until prod deps
       come back, or upgrade Resend plan.
    3. Add a `/admin/email-usage` card so the operator sees
       per-kind volume + day-over-day trend before it spikes.

(Updated 2026-06-20 — MIME-family badge + Reader DNA share-card
shipped today.)

- **Open `/admin`, expand R2 migration card, click "Pause Emergent
  fallback"** — manual user action, no agent work needed.  The toggle
  is pausable, persists across pod restarts, audit-logged. Surface
  this nudge again next time the user opens /admin.
- **Rotate the Emergent API key** — final cutover step.  Recommended
  after ~1 week of clean reads with the fallback paused.  The key
  lives in backend/.env as `EMERGENT_LLM_KEY` (used by both Object
  Storage and the AI services).  Two phases: (1) confirm no fallback
  reads in storage logs for the past 7 days, (2) rotate the key in
  Emergent's dashboard and update `backend/.env`.
- **Reader DNA share-as-PNG card** — *DONE 2026-06-20.  Deterministic
  Pillow render, not nano-banana.  Lives on /stats with a "Share"
  button.  When you're ready to add a Year-In-Books combo share
  flow, the same renderer pattern applies.*

- **Per-post ref-code A/B testing for invite campaigns** — parked
  2026-06-20.  Now that `?ref=...` fast-tracks signup AND attributes
  to a campaign, granular codes (`?ref=hpfb_post1`, `?ref=hpfb_post2`,
  `?ref=hpfb_carousel`, etc.) cost zero engineering — the existing
  `/admin/onboarding-stats` card already groups by `ref` tag.  Use
  this when the user wants to A/B test post style / wording / time-
  of-day for the same FB group or different groups.

- **"Send to Kindle" button on BookDetail** — parked 2026-06-20.
  Stock Kindle (Paperwhite/Oasis/Voyage) doesn&apos;t speak OPDS, so
  we documented the email-to-kindle workaround in `CatalogSyncCard`.
  The real fix: a per-user `@kindle.com` address in Settings →
  click "Send to Kindle" on any book → backend uses Resend (already
  integrated) to email the EPUB to that address. Amazon ingests it
  within ~5 min.
  Implementation sketch (~1-2 hours):
    1. Add `kindle_email` field to `User` model + `/api/account/kindle`
       PUT endpoint
    2. New backend route `POST /api/books/{book_id}/send-to-kindle`
       — pulls bytes from R2, attaches to a Resend email to user's
       kindle address, logs the send in `email_logs`
    3. Frontend: "Send to Kindle" button on `BookDetail.jsx`
       (disabled when `kindle_email` is not set, with a link to
       /account#kindle to set it)
    4. Account settings card: input + "Verify by sending a test"
       button
  Note: needs `kindle@shelfsort.com` (or our verified sender) added
  to user's Amazon "Approved Personal Document Email list" — surface
  this in the Settings card so users know.


- **"Top devices reporting bugs this week" admin card** — parked
  2026-06-20.  Now that every suggestion is tagged with a `device`,
  one Mongo aggregate on `db.suggestions` (status=open OR last 7d,
  category=bug, group by `device`) + one card on `/admin` between
  the Pending sign-ups inbox and the Suggestions inbox surfaces
  platform-specific regression patterns before they spiral.
  Estimated ~30 min: aggregate endpoint + admin card + 1 pytest.


## P2 — parked, ready to ship anytime

- **"You finished this on your iPhone — want a similar one?"
  suggestion strip** ✅ (shipped 2026-06-20 — `CrossDeviceFinishStrip`
  3-card compact rail on `/book/:id`, gated on `progress_fraction ≥ 0.9`
  AND cross-device cursor within 14 days; dismissible.  See CHANGELOG.)

## P1 — high value, ready to pull
- **Moderators role** ✅ (shipped 2026-06-17 — see CHANGELOG).  Default
  scope shipped: approve/reject sign-ups + lock/unlock bookclub rooms.
  Future expansions parked for later sessions:
    * Mods banning users (currently admin-only)
    * Mods deleting abusive EPUB uploads (currently flag-for-admin-only)
    * Mods locking entire chapters within a room (vs whole-room lock)
    * Hide/delete individual messages (vs lock all writes)
    * Self-nominate-to-mod flow (currently admin-promotes only)

- **Unified `/api/events/stream` SSE channel** — extend the goal-hit SSE
  endpoint shipped 2026-06-17 into a single multiplexed stream that
  broadcasts every transient user event:
    * `goal-hit` (already shipped) — keep as-is
    * `friend-started-reading` — when a sharing friend opens a book that
      matches the user's top-fandom list
    * `bookclub-message` — replace the per-message bell-ping polling
    * `bookclub-finished` — when a room-mate finishes the shared book
    * `friend-finished` — when a sharing friend marks anything finished
    * `notification` — generic catch-all so new notification kinds don't
      need a new endpoint
  Migration plan: ship the new endpoint alongside the existing
  `/api/goals/stream` (it stays as a thin alias), retire the various
  60-90s polling loops in `MessagesDropdown.jsx`, `FriendsPage.jsx`,
  `ActiveRoomPanel.jsx`, `NotificationsBell.jsx` one at a time, then
  eventually delete `/api/goals/stream` once all clients have moved.
  Single SSE connection per tab = lower DB load, instant updates,
  simpler client code.


- **Reader prefs cross-device sync** ✅ (shipped 2026-06-19 — see CHANGELOG)

- **Tighten DMARC** (reminder: tighten on or after **2026-07-03**) —
  on 2026-06-19 we set the DMARC TXT at IONOS to `p=none;` which only
  *monitors* delivery without enforcing.  After 1-2 weeks of clean
  Resend analytics (no spoofing reports, no spam complaints), tighten
  to `p=quarantine;` to actively reject non-Shelfsort senders trying
  to forge `@shelfsort.com`.  Steps:
    1. Open https://login.ionos.com → Domains & SSL → shelfsort.com → DNS
    2. Find the `TXT _dmarc` row → edit
    3. Change value from `v=DMARC1; p=none;` to `v=DMARC1; p=quarantine; rua=mailto:jessica@shelfsort.com;`
    4. Save.  No app changes — Resend doesn't track DMARC anyway.
  Optional further hardening once a month in `p=quarantine` looks clean:
  bump to `p=reject;` (the strictest setting, used by banks).
  from the API on mount (with localStorage as fast-path fallback) and
  PATCH on each change with a 600ms debounce.  ~30 min of work,
  turns Shelfsort into a stickier multi-device read-from-anywhere
  story than Kindle.

## P2 — polish

- **Admin card-view tracking** (parked 2026-06-18) — wire each
  AdminConsole card's expand toggle to fire a `?card=<id>` event
  against `/api/help/popular` (same endpoint the Help page already
  uses for section-click tracking).  After a week of admin use,
  surface the most-visited cards at the top of `/admin` automatically.
  Two lines of code per card, no UX cost.

- **Shared library for delisted/orphaned works** (parked 2026-06-18) —
  the fanfic community's "author pulled their fic" problem.  Real
  pain point but legally murky.  Five viable shapes mapped during
  the conversation, ranked by legal exposure:
    1. (safest) Index-only "I have this" registry — no file transfer;
       Shelfsort plays matchmaker, users DM 1:1 outside the app.
    2. (fully legal) Public-domain-only shared shelf — pre-1929 works,
       Standard Ebooks / Project Gutenberg imports.
    3. (low risk) Friends-only file sharing — extend the existing
       friend-library view with "request a copy" → owner approves →
       1:1 transfer.  Stays inside friendships.
    4. (cleanest for fanfic) Author-opt-in orphan archive — original
       authors register a preservation request before deleting; only
       opted-in works survive.  Author-driven, not fan-driven.
    5. (no exposure) Personal rescue shelf — works the user
       personally pulled from elsewhere, never shared.  Just a tag.
  My recommendation when we revisit: option (3) for the social
  use case + (5) for personal vault.  Options (1), (2), (4) are
  bigger product moves and warrant their own discussion.

- **Smart welcome email** (parked 2026-06-18) — use the new onboarding
  answers (referral · favorite_fandom · reader_type · is_13_plus) to
  send a personalized 3-line welcome email via Resend.  E.g. "Harry
  Potter + mostly fanfic" routes to a tour of HP-tagged shelves +
  the EPUB-from-URL importer; "mostly original + just organizing"
  routes to a tour of the duplicate-detector + Smart Shelves.
  Requires: route in `routes/auth.py` register success path to
  dispatch a templated email; templates live alongside the existing
  digest emails.  Easy win — uses existing infra.

- **Per-page "Report friction" CTA** (parked 2026-06-18) — small
  link on every page that opens the SuggestionBox with the `source`
  field auto-prefilled to the user's current route.  Turns the
  admin's per-page aggregation from "feedback I wrote ON /help"
  into "feedback I wrote ABOUT /library while I was looking at it."

- **Cover ecosystem — Tier 3 & 4** (Tiers 1 + 2 shipped 2026-06-17 —
  community pool + style packs).  Future expansions parked:
    * **Tier 2 remainder**
        - "Apply this style to my whole library" — single-click bulk
          regen of every book (including ones with covers) in a chosen
          style.  Currently achievable via PolishCoversPage picker +
          Generate-all on the cover-less subset.
    * **Tier 3 — Discovery & social**
        - Cover voting / 🤍 like
        - Featured covers of the week (homepage spotlight)
        - Style remix (start from someone else's cover as a seed)
        - Style trending feed ("dark academia is having a moment")
        - Public profile gallery ("covers by @username")
        - Cover challenges (themed monthly contests)
    * **Tier 4 — Pro / advanced**
        - Reference image upload ("make it look like THIS painting")
        - Series consistency (auto-coordinated covers per series)
        - Cover history timeline (visual evolution of your library)
        - A/B test in public (voters pick which variant becomes active)

 & infrastructure
- OG/Twitter card meta tags for `/share/yib/:token` ✅ (shipped 2026-06-16, see CHANGELOG)
- Cover regeneration via AI when EPUB has no cover image ✅ (shipped 2026-06-17 — nano-banana)
- Move from local FS to object storage when scaling — Phase A
  shipped 2026-06-18 (Emergent Object Storage backend with 10-min
  mirror tick + read-fallback restore).  Phase B (Cloudflare R2)
  is a drop-in swap of `utils/storage_cloud.py` when the user
  provides R2 credentials.

## P3 — nice-to-have
- **Launch tweet drafts** ✅ (shipped 2026-06-18 — three angle variants
  drafted in `/app/memory/LAUNCH_TWEET.md` with posting checklist).
- **Weekly Operator Digest email** ✅ (shipped 2026-06-18 — Sunday
  19:00 UTC rollup of explore views, cover views, signups, top covers,
  and referrer mix.  Admin-only toggle on Account → Email preferences;
  preview via `POST /api/admin/operator-digest/preview`.  Idempotent
  per ISO week via `operator_digest.last_sent_at`).
- **Twitter-style vanity URL** *(dropped 2026-06-18 after testing-
  agent sweep)* — the `/@:username` route was removed because the
  Kubernetes ingress / SPA fallback eats the `@` character and
  redirects to the marketing landing page.  If you ever want this
  back, route it via the backend instead (e.g.,
  `GET /api/share/at/:username` → 302 to `/u/:username`) so the
  ingress never sees the `@`.
- **Heatmap extensions deferred from the analytics+heatmap batch**:
  * **Books-most-likely-finished leaderboard** ✅ (shipped 2026-06-18
    — `GET /api/books/most-finished-leaderboard`; cohort-gated at 10
    opted-in readers; respects `reading_data_shared`.  Surfaces
    canonical (title, author) pairs sorted by completion rate.)
  * Re-reading detection *(parked — needs per-session cursor history
    table to detect multiple backward jumps).*
  * Pace percentile *(parked — needs per-cursor-tick deltas tracked
    over time).*
  * Personal-vs-aggregate cursor on the book detail page (the Reader
    pill ships this, the detail page surface is still TBD).
- **"You started this on iPhone — pick up?" passive banner on BookCard**
  ✅ (shipped 2026-06-18 — yellow "Resume" pill on the library grid
  for any unfinished book with a fresh cloud cursor from a different
  device.  Powered by `GET /api/reading-sync/hints` + the existing
  `shelfsort-device-id` localStorage stamp.  SSE-driven live refresh
  added 2026-06-18: `push_reading_cursor` now publishes a
  `reading_cursor` event and `AllBooksPage` re-fetches hints
  whenever another device saves a cursor.)

### Parked / remind-later
- **Cover rails empty-state CTA** (parked 2026-06-18) — when a
  trending rail (Top of the week / Trending now / Fresh today) has
  fewer than N entries, swap the empty slots for a "Be the first
  to share a cover for this rail" tile linking to the cover
  generator.  Turns sparse-data UX into an organic call-to-action.
  ~20 LOC inside `ExploreCoversPage.jsx`.
- **Top help searches admin widget** (parked 2026-06-18) — extend
  the help-click analytics with a ping on Help-page search-with-
  results queries.  Surface the most-searched terms in the Admin
  Console as a "users keep searching for X" signal — better
  feature-clarity heuristic than raw TOC clicks because searches
  are the *failed-to-find* moments.  ~15 LOC: 1 extra endpoint +
  1 widget.
- **Backup history page** (parked 2026-06-18) — turn the "X files
  safe in cloud storage" count in the AccountDropdown popover into
  a link to `/account/backups` showing the last 10 backup runs
  with timestamps + counts.  Useful for trust ("yes, this has
  been running for weeks") and debugging ("why did the count
  drop?").  ~60 LOC: new `backup_history` collection + 1 endpoint
  + 1 page.
- **Phase 6 — continued `books.py` splits** (now ~5 391 lines after
  the 2026-06-18 metadata + classifier extractions).  Remaining
  candidates:
  * Upload pipeline (`upload_books`, `_convert_to_epub_sync`,
    `_templated_filename`, `apply_template_to_epub`) → `utils/upload.py`
  * Fanfic refresh (`fetch_fanfic_with_fallback`,
    `normalize_fanfic_url`, `_source_for`, `FanficNotFoundError`) →
    already half-extracted to `utils/url_canonical`; finish the move
    into `utils/fanfic_refresh.py`
  * Bulk-edit pipelines (move/delete/edit by tag/fandom) → split
    into a dedicated `routes/books_bulk.py` sub-module via FastAPI
    `APIRouter.include_router`
  * Conversion-visibility + indexes (`_ensure_conversion_index`,
    `CONVERSION_VISIBILITY_HOURS`) → `utils/conversion_index.py`
  Each follows the same `from utils.X import …` shim pattern proven
  three times now (chapters, metadata, classifier).
- **Homepage "social proof" strip** (remind-later, parked 2026-06-18)
  — surface today's top community cover + total signups this week
  using `/api/cover/leaderboard` + the new analytics aggregations.
  <100 LOC.
- ✅ ~~Cover ecosystem visitor analytics~~ — superseded by the
  `AdminAnalyticsCard` widget shipped in the
  visitor-analytics+heatmap batch on 2026-06-18.
- **Reader heatmap** *(parked 2026-06-18)* — aggregate `reading_cursors`
  across all readers to show "most readers paused at chapter 3" on
  the book detail page.  Privacy-sensitive (consent required) so
  needs its own design pass.
- **Pages/minute pace tracking** *(parked 2026-06-18)* — replace
  minute-only `reading_activity` heartbeats with a pages-per-session
  metric derived from cursor deltas.  Schema migration in the
  reading_activity collection + frontend refresh of stats card.
- **Time-of-day reading pattern + daily-reminder push**
  *(parked 2026-06-18)* — bucket activity by hour, surface "you read
  mostly 9-11pm" insight + opt-in daily push at the peak hour.
  Needs Web Push infrastructure (VAPID keys) we don't currently have.
- **Bookclub buddy-pacing** ✅ (shipped 2026-06-18 — when both members
  of a 2-person room cross into a new chapter, the room auto-posts a
  system message "Both of you have reached Chapter N. Ready to talk
  about it?" and pings both readers via in-app notifications.
  Idempotent per (room, chapter); larger rooms skipped to avoid
  spam.)
- Keyboard shortcuts (J/K next/prev) for ReadOriginal viewer ✅ (shipped 2026-06-17)
- Engagement-gate hint UI in bookclub digest settings ✅ (shipped 2026-06-17)
- `?` keyboard-cheatsheet overlay for ReadOriginal viewer ✅ (shipped 2026-06-17)
- SSE-based goal-hit confetti (replace 30s polling) ✅ (shipped 2026-06-17)
- Landing page dynamic stats ✅ (shipped 2026-06-17)
- Phase 6 refactor of `books.py` (~5300 lines)
- EPUB metadata in-place editing ✅ (shipped 2026-06-16)
- "Polish my library" bulk metadata cleanup ✅ (shipped 2026-06-16)
- Recommendations based on top fandoms/authors

## Deferred / Declined
- Google Drive import — declined by user (2026-02-28). Local upload remains the only ingest path.
