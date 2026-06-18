# Shelfsort — Roadmap

> Active backlog. Items move to [CHANGELOG.md](./CHANGELOG.md) when shipped.

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

## P2 — polish

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
- Move from local FS to object storage when scaling

## P3 — nice-to-have
- **Weekly Operator Digest email** *(remind-later, parked 2026-06-18)*
  — Sunday rollup email to admin users surfacing the funnel + top
  covers + referrer distribution from `/api/analytics/summary`.
  Uses the existing Resend integration + Sunday digest scheduler
  tick.  ~50 lines on top of the existing digest infrastructure.
- **Heatmap extensions deferred from the analytics+heatmap batch**
  *(parked 2026-06-18)*:
  * Re-reading detection (multiple backward jumps surfaced as a "must
    be good" badge — needs per-session cursor history table).
  * Pace percentile ("you're in the 80th-percentile speed for this
    book" — needs per-cursor-tick deltas tracked over time).
  * Books-most-likely-finished leaderboard (homepage + bookclub
    picker aid — needs aggregate completion rates indexed across
    every canonical book).
  * Personal-vs-aggregate cursor on the book detail page (the Reader
    pill ships this, the detail page surface is still TBD).
  * Bookclub picking aid using completion rates (UI in bookclub
    creation flow).
- **"You started this on iPhone — pick up?" passive banner on BookCard**
  *(remind-later, parked 2026-06-18)* — for books with a stale local
  cursor but a fresh cloud cursor, show a small badge on the card
  itself.  Doesn't need notification permission, helps users
  discover cross-device sync even before enabling push.  Small
  frontend-only change (~30 lines on BookCard.jsx).
- **Cover ecosystem visitor analytics** *(remind-later, parked 2026-06-18)*
  — anonymous traffic + heart + signup-conversion counter on
  /explore/covers, /u/:username and /cover/:cover_id pages, surfaced
  in the Admin Console so the operator can see whether the public
  gallery is actually driving sign-ups.  One MongoDB collection
  (`page_views` with `page_type`, `slug`, `is_anon`, `ts`) + a small
  admin widget that aggregates daily/weekly views and the
  conversion ratio.
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
- **Bookclub buddy-pacing** *(parked 2026-06-18)* — auto-trigger the
  next chapter discussion when both members of a 2-person room cross
  a chapter boundary.  Needs reading_cursors fan-out into the existing
  bookclub events stream + per-room pacing policy.
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
