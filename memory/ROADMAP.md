# Shelfsort — Roadmap

> Active backlog. Items move to [CHANGELOG.md](./CHANGELOG.md) when shipped.

---

## 🎯 Quick pick — next-up ranking

Auto-maintained ranking of open reminders by **effort × impact ×
dependencies**.  When the user asks "what's next" or "which one first",
default to this order unless they ask otherwise.  Re-rank whenever a
reminder is added, shipped, or its scope changes.

Heuristic (highest priority first):
1. **Free wins that close existing loops** — tiny scope, already-
   shipped work is incomplete without it
2. **Infrastructure investments that unblock other reminders** —
   smoke tests, scaffolding
3. **Visible user-facing features** — new value, bring users in
4. **Pure tech debt / refactors** — invisible, lowest user impact

### Current order

| # | Reminder | Effort | Impact | Why this rank |
|---|----------|--------|--------|---------------|
| 1 | Amplify "Shipped from the community" social proof | ✅ DONE 2026-06-27 — Public `/changelog` "Built from your ideas" section + celebration email. Schema: `shipped_at`, `shipped_credit_sent_at`. Endpoint `GET /api/changelog`. Forward-only from 2026-06-25; handle-only credits; hidden-from-search users excluded. |
| 2 | Profile discovery polish (scroll-to-row, completeness nudge) | ✅ DONE 2026-06-27 — scroll-to-row + handle-claim nudge (iter 51) + post-handle completeness nudge (iter 56). See CHANGELOG. |
| 3 | Canary test-account cleanup endpoint | ✅ DONE 2026-06-27 — `POST /api/admin/canary/cleanup` + hourly `:05` cron sweep canary throwaway accounts >60min old. See CHANGELOG. |
| 4 | Canary polish bundle (5 sub-items) | ~2-3 h all | Med | Webhook + multi-region + tiered frequency + public badge + metrics dashboard — pick & choose (note: in-app widget & uptime card already shipped 2026-06-26; public shields.io badge + "Last checked X ago" caption shipped 2026-06-25) |
| 5 | Tiered canary cadence — auto-retry 15 min after failure | ✅ DONE 2026-06-27 — `prod-smoke-canary-retry.yml` workflow + `canary_status.json` commit-back + PRD deep-dive sweep step 6. Transient blips no longer file issues or stick the public badge red. See CHANGELOG. |
| 6 | Phase 6C: upload pipeline extraction | ~30-45 min, HIGH risk | Low (tech debt) | **Bigger than initially scoped.** 635 LOC in a SINGLE monolithic function with heavy interdependencies on books.py private helpers + inline imports from routes.admin and routes.user_prefs. Smoke band will catch breakage but likely 2-3 fix iterations on imports. Recommend doing in a fresh session with full context budget. Alternative: split into 6C1 (extract function as-is) + 6C2 (decompose into smaller helpers) over two sessions |
| 7 | Phase 6D: search/list views extraction | ✅ DONE 2026-06-27 — `library_reads.py` shipped, books.py -441 LOC (~9.2% drop) |
| 8 | Suggestion-box discoverability chip | ~20-30 min | Med | **Inbound flywheel.** Now that shipping a community idea is one-click (Task 1 ✅), the limiting factor is suggestion inflow. Currently `/help → Suggestion box` is 3 clicks deep. Add a persistent "💡 Suggest a feature" chip in (a) the sidebar, (b) the library empty-state, or (c) under the footer of `/changelog` itself ("see something missing? Suggest it →"). Reminder added 2026-06-26. |
| 9 | Friend-request email deep-link to `/users?focus=` | ~10-15 min | Med | Now that `?focus=` works on the directory (Task 2 ✅), the friend-request notification email can deep-link recipients directly to the requester's row with the amber highlight pulse. Tiny email-template change, big UX bump for first-time recipients. Reminder added 2026-06-26. |
| 10 | Library login-gate conversion booster | ✅ DONE 2026-06-26 (iter 51) — preview owner + avatar + book count + top fandom + bio on the 401 gate. |
| 11 | Trending books strip on landing | ~20 min | Med | Now that hearts + `/api/books/trending` exist (iter 52), render the top 5-8 hearted books under Featured Readers on the landing page. Consumption-side surface — "Hunger Games · 4 hearts this week" makes readers want to find a library that has it. Same anon-friendly pattern as Featured Readers. Reminder added 2026-06-26 (very late). |
| 12 | Canary uptime sparkline on `/changelog` | ✅ DONE 2026-06-27 — `/api/canary/uptime?include_daily=true` + 30-cell mini bar chart inline with pill. See CHANGELOG. |
| 13 | Dev-only Help.jsx anchor-integrity assert | ✅ DONE 2026-06-27 — `useEffect` warns on SECTIONS ids with no matching DOM node, guards against the iter-53 dead-anchor bug class. See CHANGELOG iter 56. |
| 14 | Log rotation on production supervisor config | ~5 min (manual) | Med (ops hygiene) | The preview's `/etc/supervisor/conf.d/backend.conf` is READONLY so this can't be applied from the agent. On prod: SSH in, edit `/etc/supervisor/conf.d/backend.conf` (and `frontend.conf`), add `stdout_logfile_maxbytes=10MB` + `stdout_logfile_backups=5` (mirror for `stderr_*`) inside the `[program:backend]` block, then `sudo supervisorctl reread && sudo supervisorctl update`. Caps each log at 10MB × 5 rotations = 50MB max per stream. Reminder added 2026-06-27. |
| 15 | Profile-completeness meter + extensions | ✅ DONE 2026-06-27 (afternoon) — 3-dot meter on `/account`, `/users` directory sort by score, "Almost there!" toast on each save. Six remaining extensions (first-login wizard, Featured Readers eligibility floor, ✨ stamp at 3/3, email re-engagement ladder, admin histogram, conditional feature unlocks) deferred — see CHANGELOG iter 57. |
| 16 | Re-engagement email for incomplete profiles | ~45 min | Med | Now that completeness score + ★ Featured stamp exist (iter 57/58), add a weekly cron (admin-tunable) that sends ONE Resend email to users who: (a) registered >7 days ago, (b) `completeness_score < 3`, (c) haven't been emailed about this before. Body: "You're N steps away from being Featured on Shelfsort — [Add a bio] [Share your library]". One email per user EVER (not weekly nag), tracked via a new `completeness_nudge_sent_at` field on the users collection. Re-uses the existing Resend integration + email-suppression list + Resend quota. Activates the dormant tail of the user base. Reminder added 2026-06-27. |
| 17 | Community Library Phase 2 — "I have a copy" request board | ~1-2 hr | Med | Phase 2 of the community-library plan (Phase 1 shipped iter 59). New page `/community/requests` where signed-in users post "looking for [book title + author + fandom]". Anyone with that book in their library can click "I have a copy" → opens the existing friend-DM flow so the two parties handle the transfer off-platform. Shelfsort never touches a file. Legal posture matches Discord (a messaging surface, not a hosting one). Schema: `community_requests {req_id, requester_user_id, title, author, fandom_hint, status, created_at, fulfilled_by, fulfilled_at}`. Reuses friend-DM plumbing. Reminder added 2026-06-27. |
| 18 | Community Library Phase 3 — Actual file sharing (HIGH RISK — discuss first) | ~3-4 days | High risk | DO NOT BUILD WITHOUT EXPLICIT USER GO. Adds real DMCA / R2 cost / moderation exposure. Should be a separate opt-in "Library of Alexandria" mode with license attestation + admin moderation queue + hash-based dedupe + DMCA contact in footer + takedown queue. Must be gated on score=3 AND ≥30-day-old account. Agent must surface legal/cost trade-offs (commercial titles? PD only? fanfic only?) before any implementation. Reminder added 2026-06-27. |
| 19 | Community page trending-fandoms rail | ~25 min | Med | Now that `/community` (iter 59) is collecting recs with a denormalized `fandom` field per row, surface a horizontal-scroll "Most recommended this week" rail at the top of the page, grouped by fandom. New endpoint `GET /api/community/trending-fandoms?days=7&limit=8` aggregating `community_recommendations` group-by-fandom + count + max(hearts_count). New `TrendingFandomsRail` component on `CommunityPage.jsx` above the existing tile grid. Returning visitors see a fresh angle each visit; new visitors get instant taxonomy of the community. Pairs with the recommend-volume that'll start accruing. Reminder added 2026-06-27. |
| 20 | Pairing intersection in Pick-for-me weighting | ✅ DONE 2026-06-27 — `+ 2 × (pairings overlap)` added to the Pick-for-me weight formula in `AllBooksPage.jsx`. See CHANGELOG. |

### Convention for adding new reminders

When the user says "remind later", append a new `## 💡 Reminder` block
**below** this Quick pick section AND insert a row in the table above
with effort/impact/why. When the user asks for an expanded menu, add
the tiered Core/Edge/Follow-up/Nice-to-have sections inside the
reminder block. When shipped, mark "— DONE {date} ✅" on the heading
and shrink the body to a one-line CHANGELOG pointer.

### Convention for "Potential improvement" sections in finish summaries

When proposing potential improvements at the end of a feature ship,
**always include the agent's recommended pick** (with one-line
reasoning) right after the bulleted list.  The user asked for this
explicitly on 2026-06-25 — they don't want to have to follow up with
"which is best?" every time.  Format:

> ### Recommended pick
> **#N — {title}** — {one-line why}.  {Optional: runner-up pick if a
> close second is genuinely competitive.}

This applies to EVERY finish summary that includes potential
improvements, not just the explicit "which is best?" follow-ups.

---

## 💡 Reminder — Admin 1-click "Mark Shipped" button — PARKED 2026-06-27

Added by operator on 2026-06-27 after the community amplification
feature shipped.  Right now an admin has to either use the PUT
endpoint directly OR click into the suggestion detail page and
change the status dropdown to "done".  Add a 1-tap "Mark Shipped"
button on each row of the admin suggestion list that:

- Sends `PUT /api/admin/suggestions/{sid}` with `status: "done"`
- Optionally prompts for the changelog section it lands under
  (free-text or a dropdown of recent CHANGELOG.md entries)
- Optionally lets the admin add an admin_note inline
- Shows confirmation toast: "Shipped! @handle gets the email."

Effort: ~30 min.  Risk: trivial (UI wrapper on an existing endpoint).
Impact: streamlines the most-rewarding admin action.  Consider
pairing this with a smarter status transition that auto-stamps
the changelog entry into `suggestion.shipped_changelog_entry` for
explicit linking on the public /changelog (instead of just date-
proximity matching).

## 💡 Reminder — Community amplification + Mongo indexes — DONE 2026-06-27 ✅

Two-fer overnight: 5 compound Mongo indexes on `db.books` for the
library_reads.py routes (all verified using `explain()`), and the
flagship community amplification feature — public `/changelog`
"Built from your ideas" section with @handle credits + "your idea
shipped!" celebration email. Schema: `shipped_at` +
`shipped_credit_sent_at` idempotency. Forward-only from 2026-06-25;
handle-only credits; hidden-from-search users excluded. 30 regression
tests green.

## 💡 Reminder — Mongo indexes for library_reads.py — PARKED 2026-06-27

Added by operator on 2026-06-27 after Phase 6D extraction completed.
Now that the high-traffic GET routes live in their own clean module,
add compound Mongo indexes so they stay fast as the library grows:

- `db.books.create_index([("user_id", 1), ("category", 1)])` — powers
  `GET /api/books` (every category-filtered list)
- `db.books.create_index([("user_id", 1), ("last_opened_at", -1)])` —
  powers `GET /api/books/recent` (Continue Reading rail)
- `db.books.create_index([("user_id", 1), ("replaces", 1), ("update_seen", 1)])`
  — powers `GET /api/books/recent-updates` (bell badge)
- Possibly: `db.books.create_index([("user_id", 1), ("fandom", 1)])` —
  powers `GET /fandoms` and fandom-filtered list views

Effort: ~15 min. Risk: trivial — index creation is online + idempotent.
Impact: shaves 30-100 ms off page loads once a user passes ~10k books;
also reduces server CPU for everyone. Add to startup hook in
`deps.py` or as part of an existing migration script so prod picks
them up on next deploy.

## 💡 Reminder — Phase 6D library_reads.py extraction — DONE 2026-06-27 ✅

10 pure-read endpoints peeled out of books.py to routes/library_reads.py.
Books.py 4780 → 4339 lines (-441 LOC, ~9.2% drop). All 30 regression
tests green; 447 routes registered. Help page updated with new
features (crossover detection, Storyid recovery, users directory)
+ 2 new FAQ entries for SEO structured data.

## 💡 Reminder — Storyid reconstruction + backfill endpoint — DONE 2026-06-26 ✅

EPUB link extractor now reconstructs canonical URLs from bare
`Storyid: N` + host-name patterns (FanFiction.net, AO3, Royal Road,
Wattpad, FictionPress).  Lands automatically on new uploads;
`POST /api/admin/re-extract-links` backfills existing books with a
dry-run preview, only-missing-source guard, and a UI card in the
AdminConsole.  30 regression tests green.

## 💡 Reminder — All Quick-pick items parked 2026-06-26 ✅

User explicitly parked the entire Quick-pick queue after shipping the
crossover navbar badge + Production canary widget.  Nothing was
deprioritized — all 6 items below remain ready to pull whenever the
user surfaces them again.  Status as of 2026-06-26:

1. **Amplify "Shipped from community" social proof** (P2, ~1-2 h Core)
   — top-ranked, recommended next pick
2. **Profile discovery polish** (P2, ~30-45 min) — scroll-to-row +
   completeness nudge
3. **Canary test-account cleanup endpoint** (P3, ~20 min) — housekeeping
4. **Canary polish bundle leftovers** (P3, ~2-3 h all) — webhook +
   public status badge + multi-region + tiered freq (widget already
   shipped 2026-06-26)
5. **Phase 6C: upload pipeline extraction** (P3, HIGH risk, ~30-45 min)
   — recommend a fresh session with full context budget
6. **Phase 6D: search/list views extraction** (P3, Med risk, ~30 min)
   — cleaner than 6C, ~9% books.py drop

Re-rank only if a new reminder lands.  When the user says "what's
next", default to #1 unless they ask otherwise.

## 💡 Reminder — Crossover navbar badge + Production canary widget — DONE 2026-06-26 ✅

Shipped — see CHANGELOG entry of the same date.  Navbar polls both
unknown-fandoms + crossover counts every 5 min, dot lights up when
either is > 0.  CanaryCard renders a 7-day uptime sparkline from the
new `canary_runs` collection; workflow POSTs results via shared
`CANARY_REPORT_SECRET`.  27 regression tests green.

## 💡 Reminder — Crossover Detection Session 2 (AI feedback loop) — DONE 2026-06-26 ✅

Shipped — see CHANGELOG entry "Crossover Detection Session 2".  AI-vs-
heuristic gap detection in `utils/classifier.py`, three admin
endpoints, and a new Admin Console card with status tabs + per-gap
keyword inputs.  Regression smoke band is now 27 tests in ~5 s.

## 💡 Reminder — Extend regression smoke to upload pipeline — DONE 2026-06-25 ✅

Shipped — see CHANGELOG entry "Upload pipeline added to regression smoke".
Core (1-5) + a 404 sanity for unknown job_ids landed.  6 new tests in
`tests/test_regression_smoke.py`, total smoke band now 22 tests, ~7 s.

## 💡 Reminder — Extend regression smoke to upload pipeline

Current `tests/test_regression_smoke.py` covers covers/books/friends/
suggestions.  Add a thin smoke for the highest-risk surface in the
codebase: the async upload pipeline.

### 🎯 Core (~5 tests, ~3-4 s extra)
1. `POST /api/books/upload/async` with a tiny valid EPUB fixture →
   returns `{job_id, status}`
2. `GET /api/books/upload/jobs/{job_id}` polling → reaches `done`
   within a generous timeout
3. Posted-book `GET /api/books/{book_id}` returns 200 with shape
   `{book_id, title, has_cover, av_status, ...}`
4. New book appears in `GET /api/books/recent` and increments
   `GET /api/books/stats.total`
5. Job has `av_status` set to `clean`, `unscanned`, or `infected`
   (not missing, not None)

### 🟡 Edge cases (~3 tests, +2 s)
6. Invalid file (non-EPUB binary) → job ends in `failed` with a
   non-empty `error`
7. Duplicate upload of same EPUB → second job either dedupes or
   sets a `duplicate_of` field
8. `GET /api/books/upload/jobs` (list endpoint, used by
   BackgroundJobsBell) → shape matches bell expectations

### 🔵 Infrastructure-adjacent (~3 tests)
9. Friend-library AV gate: infected book → 409 on
   `POST /api/friends/{id}/library` (regression for last session's fix)
10. Conversion pipeline: `POST /api/library/originals/{id}/convert`
    smoke (skipped if Calibre isn't installed in CI)
11. URL paste endpoint exists and responds 200/400 (not 500) for
    valid/invalid input

### 🟣 Nice-to-have (frontend, not pytest)
12. Upload chime localStorage flag is honored — would need a
    frontend test suite addition

### Recommended scope to ship
Core (1-5) + #8 (BackgroundJobsBell payload shape) + #9 (AV gate).
~7 tests, ~4-5 s total.  Skips Calibre (CI doesn't have it) and
duplicate-of dedup (may flake on small fixtures).

Goal: refactoring the upload pipeline (Phase 6C, planned later)
becomes safe — `pytest -m regression_smoke` catches breakage in ~5 s.

## 💡 Reminder — Phase 6B: bulk-ops extraction

Continue the books.py refactor.  Extract the "destructive/mass-edit"
endpoint cluster into `routes/bulk_ops.py`:
- `POST /api/books/bulk/delete`
- `POST /api/books/bulk/move`
- `POST /api/books/bulk/metadata`
- `POST /api/books/reset-state`
- `POST /api/books/wipe-library`
- `POST /api/books/reclassify-all`

~300 LOC out of books.py (another 6% drop, ~4,957 → ~4,657).  These
form a coherent surface that will benefit from being grouped when
we later add audit logging or rate limiting to mass-edit operations.

### 🎯 Core (the move itself, ~30 min)
1. Create `routes/bulk_ops.py`; copy the 6 endpoint handlers verbatim
2. Move any module-private helpers they depend on (likely
   `_bulk_log_event`, status enums)
3. Register `bulk_ops` in `server.py`'s bulk routes import
4. Remove originals from `books.py`; update its header section map
5. Run regression smoke (`pytest -m regression_smoke`) — must pass

### 🟡 Edge cases (`tests/test_regression_smoke.py` additions, +3 tests)
6. `POST /api/books/bulk/delete` with empty `book_ids` → 400, not 500
7. `POST /api/books/bulk/move` to nonexistent shelf → 404
8. `POST /api/books/reset-state` requires confirmation flag (existing
   safety check still wired)

### 🔵 Follow-up improvements (after extraction, separate ticket)
9. **Audit logging** — every bulk op writes a row to `audit_log`
   collection with `{user_id, op, target_count, timestamp, summary}`.
   Admin console gets a "Mass-edit history" panel.
10. **Rate limiting** — cap `wipe-library` to once per 5 min, others
    to ~10/min per user.  Stops accidental double-clicks from
    nuking data twice.
11. **Confirmation token flow** — `wipe-library` returns a token
    that must be re-posted within 60 s.  Stops CSRF-style accidents.

### 🟣 Nice-to-have
12. **Undo window** — for `bulk/delete`, keep the rows in trash for
    24 h with a `bulk_op_id` tag so a single click can restore the
    entire batch.

### Recommended scope to ship
Core (1-5) + Edge tests (6-8).  Hold #9-#12 for a dedicated
"safety net" pass after the refactor lands.

## 💡 Reminder — Amplify "Shipped from the community" social proof

Two small ideas, either or both:
- (a) "Recently shipped from the community" card on the public
  `/changelog` page that pulls the latest 3 `status === "done"`
  suggestions with their credit ribbons.
- (b) When admins write a changelog entry, optionally link it to a
  suggestion_id so the entry auto-renders "Built from
  {submitter}'s suggestion" inline.
Goal: amplify the badge work we just shipped, give the board more
visibility, bring more contributors in.

### 🎯 Core (~2 endpoints + 2 frontend pieces)
1. Backend: `GET /api/changelog/community-credits` returns the
   latest N shipped suggestions with `{title, submitter_name,
   shipped_at, suggestion_id}` for public consumption (no auth)
2. Frontend: `/changelog` page renders a new "Built from your
   suggestions" card above the existing changelog list, showing
   3-5 most recent with the existing ShippedCredit ribbon
3. Each card row is clickable → deep-link to
   `/suggestions/{suggestion_id}` (or filter the board to that
   single row)
4. SEO: the card markup is server-rendered enough for crawlers
   (currently `/changelog` already does this for static entries)

### 🟡 Inline admin credits (idea b)
5. Add an optional `linked_suggestion_id` field to the
   `changelog_entries` collection (admin form gains a "Built from
   suggestion?" dropdown)
6. When set, the changelog entry renders an inline ribbon under the
   title: "Built from @{submitter}'s suggestion" linking back
7. On suggestion-board side, the suggestion row gains a "Shipped
   in: {changelog_link}" caption so the loop closes both ways

### 🔵 Discovery surfaces
8. **Dashboard "Your impact" card** — for users who've had ≥1
   suggestion shipped, surface a small card on their dashboard:
   "Your suggestion '{title}' is live — used by {import_count}
   readers."  Mirrors the cover-profile achievements pattern.
9. **Public profile** — `/u/{username}` page already exists for
   cover stats; add a "Shipped suggestions" tab showing this user's
   contributions to the changelog
10. **Social card / OG image** — when sharing a changelog entry on
    Twitter/Mastodon, the OG image includes "Built from a community
    suggestion ✨" so it stands out in feeds

### 🟣 Nice-to-have
11. **Email digest** — when a user's suggestion ships, fire an
    email: "Hey, your suggestion just shipped to Shelfsort.  Here's
    what changed."  Tiny conversion lever — keeps lapsed users
    engaged.
12. **Annual recap** — once a year, generate a "Top 10 community-
    shipped features" recap post.  Marketing gold + thanks the
    contributors.

### Recommended scope to ship
Core (1-4) — single endpoint + a card on `/changelog`.  Hold (b)
inline credits for the next pass since they need an admin-side
form change.

## 💡 Reminder — "Listed!" confirmation toast on @handle save — DONE 2026-06-25 ✅

Shipped — see CHANGELOG entry "Listed!" confirmation toast.
Core (1-3) + Edge (4-5) landed.  Follow-ups (7-9 below) preserved
as a separate reminder for the next "Profile discovery polish" pass.

## 💡 Reminder — Canary polish bundle

Follow-ups to the production smoke canary
(`.github/workflows/prod-smoke-canary.yml`).  Pick any subset —
they're independent.

### 🎯 Faster blast-radius signal
1. **Slack/Discord webhook on failure** — instant ping instead of
   waiting for someone to notice the auto-filed GitHub issue.  Add
   an optional `CANARY_WEBHOOK_URL` secret + a 5-line POST in the
   workflow's `if: failure()` branch.  Use Discord's webhook embed
   format so it formats nicely.
2. **Tiered frequency** — split canary into:
   - Hourly: just `GET /api/health` (no auth, no DB writes — costs
     nothing on prod)
   - Daily (existing): the full 22-test smoke band
   Catches outages with ~1 h MTTD instead of ~24 h without
   exploding the throwaway-account count.

### 🟡 Visibility
3. **Public status badge** — expose latest canary result as a
   shields.io-compatible JSON endpoint
   (`/api/status/canary` returns `{ status: "ok"|"fail",
   last_run: iso, passed: 22, total: 22 }`).  Marketing site +
   GitHub README can show "🟢 Production: 22/22 healthy" so users
   see live confidence.
4. **Multi-region canary** — duplicate the workflow with
   `runs-on: macos-latest` or `ubuntu-arm` so prod outages
   affecting only one network path get caught.  Catches Cloudflare
   POP regressions, IPv6-only failures, region-specific TLS issues.

### 🔵 Operator surfaces
5. **Canary metrics dashboard** (Admin Console) — push pass/fail
   timestamps to a tiny `canary_runs` Mongo collection.  Admin
   Console widget plots a 7-day uptime sparkline + the last 10
   failure tails.  Pairs with reminder #1 "Admin Console
   smoke-canary widget" — same data source, complementary views.

### Recommended scope to ship
#1 (webhook) + #3 (public badge) first — both are tiny and have
outsized visibility payoff.  #2 (tiered freq) only after we see
how noisy the daily one is.  #4-#5 hold for later.

## 💡 Reminder — Profile discovery polish (follow-up to Listed! toast)

Pairing UX + nice-to-haves left over from the Listed! toast work:

### 🔵 Pairing UX
1. **Mini empty-state on /users** — for the brand-new just-listed
   user, the first time they view /users *after* claiming a handle,
   scroll them to their own row (or pre-highlight it for 2 s) so
   they see the proof of listing
2. **Profile completeness nudge** — extend the Listed! toast (or
   add a follow-up toast) to mention other profile fields they
   could fill (bio, picture) to make their directory presence
   richer.  Optional second-stage CTA.

### 🟣 Nice-to-have
3. **Email confirmation** — fire a one-time "Welcome to the
   directory" email (if they have notifications on) so the
   visibility shift is documented.  May be overkill for a public
   handle change — gauge demand first.

## 💡 Reminder — "Welcome to the directory" onboarding toast — DONE 2026-06-25 ✅

Shipped — see CHANGELOG `2026-06-25 (afternoon)` extension entry.

## ✅ Just shipped (2026-06-24/25)

- **P3 Phase 6A — covers extracted** — `routes/covers.py` (~960 LOC,
  17 endpoints) split out of `routes/books.py` (5,855 → 4,957 LOC).
  Covers personal cover gen/variants, style catalog, community pool
  share/browse/import/vote/unshare/featured/lineage, public cover
  profile, and cover-less books list.  Behavior-preserving — only
  the test monkeypatch target changed (now `routes.covers`).
  `_write_local_and_mirror_to_r2` stays in `books.py` (shared with
  uploads); covers imports it.  Server.py + books.py header map
  updated.  All curl-verified live.
- **P2 "Built from your suggestion" badges** — `pages/SuggestionsPage.jsx`
  shipped suggestions now render a public credit ribbon ("Built from
  {submitter}'s suggestion" or "Built from your suggestion" for the
  originator) plus the StatusPill reads "Shipped" instead of "Done".
  When the originator visits the page after their suggestion ships,
  they see a one-shot celebration toast (localStorage-keyed per
  suggestion_id) thanking them.  Closes the user-feedback loop
  visibly — other readers see suggestions actually land in prod.
- **P1 Public reader directory** — `/users` lists every signed-in
  user's `@username` (no name/email/avatar/library leak).  Backend
  `GET /api/users/directory` returns paginated `{user_id, username}`
  rows, excludes self + blocked + hidden_from_search.  Frontend
  `UsersDirectory.jsx` adds filter, paging, "Add" CTA per row.
  Discovery via dashboard `DirectoryNudge` (shown once user has ≥5
  books) + mobile drawer + Privacy card link.  Opt-out reuses
  existing `hidden_from_search` flag with retitled UI copy.
- **P2 Recently Added shelf** — `/library/recently-added` is a
  cross-device persistent view (just reuses `GET /api/books`,
  filters by `created_at` window).  7d/14d/30d/90d pills.
- **P2 Opt-in upload chime** — `lib/uploadChime.js` WebAudio
  two-note tone fires when last in-flight upload job finishes.
  Off by default; toggle lives in Account → Upload chime card.
- **P0 Native PDF reader** — `components/PdfViewer.jsx` renders PDFs
  via `react-pdf`/`pdfjs-dist@4` worker (CDN-pinned to avoid version
  mismatch). Replaces the iframe in `ReadOriginal.jsx`. Page tracking
  via IntersectionObserver feeds back into `currentAnchor()` so
  bookmarks no longer prompt the user. Keyboard nav (PageUp/Down,
  J/K, Space, arrows), zoom ±10%, page-number jump input.
- **P0 Async upload pipeline** — `POST /api/books/upload/async` +
  `GET /api/books/upload/jobs/{job_id}` poll. The submit half now
  returns 202 + `{job_id}` in 1–2s. The actual work runs as
  `asyncio.create_task(_run_upload_job(...))` and the SPA polls
  every 1.5s for completion. Cloudflare 524s are structurally
  impossible — the LLM/R2 stalls now stall the poll, not the
  request. See `routes/upload_jobs.py` + `tests/test_upload_async_job.py`
  (5 green tests). Frontend `UploadZone.jsx::sendOne()` routes to
  the new endpoint and preserves the previous parallel-4 chunking.
- **Compact upload drop zone on /library/all** — `UploadZone` now
  takes a `compact` prop; `AllBooksPage` embeds it between the
  title block and search/filters.

## 💡 Reminder — Resume-after-refresh for async uploads — DONE 2026-06-24 ✅

Shipped — see CHANGELOG entry of 2026-06-24 night.
Persists `job_id`s in `localStorage`, mount-effect re-attaches and
polls each one, aggregates results into the normal `onUploaded`
flow.  3 new pytest tests, all green.

## ✅ DONE 2026-06-24 night (full sweep)

All four reminders shipped together in a single coherent batch.
See `CHANGELOG.md` "2026-06-24 night (full sweep)" for full detail.

- ✅ TTS read-aloud on PDFs — `components/PdfTtsControls.jsx`.
- ✅ Public `/changelog` page for SEO — `pages/Changelog.jsx` + new
  `GET /api/changelog/public` endpoint + sitemap entry + footer link.
- ✅ "Help us spread the word" share prompt — `<SharePrompt/>` in
  Help.jsx, gated on ≥30d + ≥20 books.
- ✅ Pulse matching bell row on completion — coral 3s fade keyframe
  + `justDoneIds` tracking in BackgroundJobsBell.


## ✅ Just shipped (2026-07-04 morning)

- **Partial-success upload (frontend + backend)** — Live launch-week bug:
  operator dropped 100 EPUBs, only ~15-20 landed before a single toast
  killed the rest. Root cause was two compounding bugs (frontend loop-wide
  try/catch + backend AV `raise HTTPException` + no per-file try/except).
  Now: per-batch retry, per-file isolation, sticky summary toast with
  "Retry N" action, AV-blocked files appear in `books[]` with
  `failed/av_infected` flags instead of 400-ing the whole batch.
  See `test_upload_partial_success.py` for the contract spec.


## ✅ DONE 2026-06-24 — Async-ify the upload endpoint

Shipped — see "Just shipped" block above and `CHANGELOG.md` entry of
the same date for full details. Original plan preserved here for
historical reference:

**Why**: At 8pm on launch day, the operator's "drop 10 books" failed because
each batch was hitting Cloudflare's 100s edge timeout — caused by a slow
upstream LLM classifier. We shipped an 8-second classifier timeout +
metadata-heuristic fallback as a hotfix (it works), but the *correct* fix
is to decouple the upload's HTTP-response time from its processing time.

**Concrete plan**:
1. **Backend**:
   - New `upload_tasks` MongoDB collection with TTL index (24h expiry):
     `{task_id, user_id, created_at, status, total, processed, results: [], failed: [], duplicates: []}`.
   - Modify `POST /api/books/upload` to:
     a. Read all uploaded files into memory (NOT lazily — UploadFile streams
        die after the response is sent, so we must drain them upfront).
     b. Insert a fresh `upload_tasks` doc with `status: "pending"`.
     c. Spawn a `FastAPI.BackgroundTasks` callback that runs the existing
        per-file loop with task-record updates after each file.
     d. Return `202 Accepted` with `{task_id, total_files, status: "pending"}`
        immediately (~1-2s total).
   - New endpoint `GET /api/books/upload-status/{task_id}` returns the
     task doc (with auth gate: user can only read their own tasks).
2. **Frontend (`UploadZone.jsx`)**:
   - Submit the multipart, get `task_id` back.
   - Start a 2-second polling loop on the status endpoint.
   - Update the existing progress UI from `task.processed / task.total`.
   - Stop polling when `status` is `completed` or `failed`.
   - Render the existing duplicates/actions/url_lists from the final task doc.
   - Preserve all existing UX (sticky retry toast, format-prefs prompts,
     unknown-source warnings, cross-format-dupes flow).
3. **Tests**:
   - Update `test_upload_partial_success.py` to follow the new contract.
   - Add a smoke test that proves a slow-classifier (mocked timeout)
     doesn't block the upload response.
4. **Smoke + deploy**.

**Risk profile**: HIGH on launch day, MEDIUM on a quiet morning. The
upload endpoint is the most-touched route in the app — any regression
hits every user. Best done when there's no other concurrent change
moving through.

**Reference files**:
- `backend/routes/books.py` — `upload_books` handler at line ~1843
- `frontend/src/components/UploadZone.jsx` — `handleFiles` callback
- `backend/tests/test_upload_partial_success.py` — contract spec to evolve


## 🔒 Gate file-sharing on AV scan status (proposed — P1, ~1 hour)

**Why**: We shipped `AV_SCAN_ON_UPLOAD=false` to speed uploads up. Books
now land as `av_status: "unscanned"` and only get scanned via the
post-upload toast prompt or admin rescan. Today this is OK because each
user's library is private — but the moment we ship any cross-user
sharing feature (friends, library exchange, Send-to-Kindle-to-someone,
public bookshelves), an unscanned file could propagate to other users
before anyone checks it.

**Concrete plan**:
1. **Backend** — Add a guard helper `ensure_av_clean_for_sharing(book_id, user_id)` that:
   - Returns `True` only if `av_status == "clean"`
   - Raises `HTTPException 412 Precondition Failed` with a friendly message otherwise
   - Used by: any future cross-user sharing endpoint
2. **Existing Send-to-Kindle** — already blocks `av_status == "infected"`. Tighten it to ALSO block `unscanned` (currently allows unscanned through).
3. **Future "share to friend"** — wires into the guard.
4. **UI** — On the book card, show a small lock icon with tooltip "Scan this book before sharing" if `av_status` is unscanned and the user tries to share.
5. **Friendly error** — "This book hasn't been scanned for viruses yet. Click 'Scan now' in Account → Safety, then try sharing again."

**Reference files**:
- `backend/utils/send_to_kindle.py` line 101 (existing AV check, tighten)
- `backend/routes/account_safety.py` (rescan endpoint)
- `frontend/src/components/BookCard.jsx` (add lock icon)


## 👥 User directory + friend requests (proposed — P1, ~3-4 hours)

**Why**: Users have asked for a way to discover other Shelfsort readers
and connect with them. Currently usernames exist (we shipped public
usernames a while back) but there's no discovery, no friend graph, and
no way to interact across accounts.

**Concrete plan (MVP)**:
1. **Backend models**:
   - `friend_requests` collection: `{from_user_id, to_user_id, status: "pending"|"accepted"|"rejected", created_at, responded_at}`
   - `friendships` collection: `{user_a, user_b, created_at}` (symmetric pair, lower-id first for query simplicity)
2. **Backend endpoints**:
   - `GET /api/users/directory?q=…&page=…` — list of users (paginated, search by username/display name), opt-in via `is_discoverable` profile field
   - `GET /api/users/{username}/public` — public profile view: avatar, username, public bookshelves count, joined date
   - `POST /api/friends/request/{user_id}` — send friend request
   - `POST /api/friends/respond/{request_id}` — accept/reject
   - `GET /api/friends/incoming` — list pending requests for me
   - `GET /api/friends/list` — my friends list
   - `DELETE /api/friends/{user_id}` — unfriend
3. **Privacy defaults**:
   - `is_discoverable: false` by default — opt-in via `/account/profile`
   - Users see "Allow other users to find you in the directory" toggle
   - Friend requests are dismissible/blockable
4. **Frontend**:
   - New page `/explore/people` — paginated user directory with search
   - Profile cards on hover/click — show avatar, username, public bookshelves
   - "Add friend" button → fires request
   - Inbox badge on the bell icon when there are pending requests
   - Notification toast when someone accepts a request

**Defer to v2**:
- Friend feed (what friends are reading)
- Book-recommendation between friends
- DM / messaging (would need a whole moderation layer)
- Public bookshelves cross-following

**Reference files** (for the next agent picking this up):
- `backend/routes/admin.py` — has user-listing patterns to mirror
- `backend/models/user.py` — user model to extend
- `frontend/src/pages/Profile.jsx` (or similar) — existing profile page

**Note**: We already have a `friendships` concept in `digest.py` for the
"reading streak" feature — check whether it's the same shape or whether
this is a parallel system. Don't double-create the model.



**Note for next agent**: the operator explicitly approved this as the
TOP priority for the next session (during 2026-07-04 late-night launch
debug). The hotfix shipped tonight (8s classifier timeout + no-retry-on-5xx)
is good defensive code that should STAY even after the async refactor —
it's belt-and-suspenders.



## ✨ "Built from your suggestion" badges (proposed — P2, ~1-2 hrs)

**Why**: Today (2026-07-04) we shipped two features within hours of FB-group
users requesting them (Kindle import guide, Read-Aloud TTS). That's a huge
trust signal but it's invisible in-app — users only know if they happen to
read the public changelog. A small visible badge on community-driven
features turns the responsiveness into a flywheel: users see "✨ Built from
@username's suggestion" → they post their own ideas → more loops.

**Scope (MVP)**:
1. Add an optional `community_origin` field to changelog entries
   (admin schema):
   - `requested_by`: free-text attribution string (e.g. "Alexandra C.",
     "an FB-group reader") — never email/PII unless the user explicitly
     consented.
   - `source_link`: optional URL to the public post (FB/Bluesky/Mastodon).
2. New `<CommunityOriginBadge />` mini-pill component — small, calm,
   uses the same purple accent. Renders only when `requested_by` is set.
3. Render the badge in two places:
   - Public changelog page (already exists?) next to the entry title.
   - Inline near the new feature itself when reasonable — e.g. tiny
     ✨ icon next to the "Listen" button on first-render, dismisses
     when clicked. Localstorage-flagged so it shows once per device.
4. Admin Changelog Card form: add the two optional fields with helper
   text "Public attribution? Use a first name or 'an FB reader' — never
   paste full names without permission."

**Non-goals (defer)**:
- Linking to a user's Shelfsort profile (overkill, requires per-user
  consent flow).
- Auto-detection of community origin from suggestion-board entries
  (manual-attribution is fine for v1).

**Risk**: P2, low. Changelog admin card is already shipped, this is purely
additive. No public surface area changes if `requested_by` is unset.

**Reference docs to load when picking this up**:
- `frontend/src/pages/AdminConsole.jsx` (search for "Changelog")
- `backend/routes/admin.py` (changelog CRUD endpoints)
- The two features already shipped today are perfect first candidates:
  Kindle Import (Alexandra) + TTS (the other commenter).



## 🆕 Persistent Upload Retry Queue (proposed — P1, ~2-3 hours)

**Why**: the new sticky "Retry N" summary toast (shipped 2026-07-04) gives
one chance to retry failed uploads. If the user dismisses the toast or
closes the tab mid-upload, they lose track of which files didn't land. For
power users importing 100+ books at once, this is a real "did I lose my
books?" anxiety moment. Eliminating it builds trust.

**Scope (MVP)**:
1. Persist `failedFiles[]` to IndexedDB (or localStorage with File-Handle
   refs where supported) keyed by `user_id + batch_started_at`.
2. New `<UploadRetryQueueCard />` on the Library page (above the upload
   zone): shows pending failed files with filename, error reason, and
   per-file retry/dismiss/dismiss-all actions.
3. Auto-show the card on Library mount when the queue has items.
4. Wire the existing `failedFiles` list in `UploadZone.jsx` to seed the
   queue alongside the toast.

**Non-goals (defer to v2)**:
- Background auto-retry after network restore (use Service Worker — out of
  scope for v1)
- Cross-device sync of the retry queue (would require backend storage and
  is overkill for transient failures)

**Implementation notes for next agent**:
- Browsers can't persist `File` objects across page reloads — only File
  refs from the FileSystem Access API (Chrome 86+) survive. For Safari/
  Firefox the queue should gracefully degrade to: show the filenames and
  errors, but prompt the user to re-select the files from disk to retry.
- Stale entries should auto-expire after 24h to prevent the queue from
  bloating with files the user has already manually re-uploaded.

**Test plan**:
- New `tests/test_upload_retry_queue.spec.jsx` (frontend) — mock 100-file
  upload with 20 failures, verify the queue persists after a page reload.
- Manual smoke test on shelfsort.com: drop 100 EPUBs, simulate a network
  drop on batch #5, verify the queue card appears and one-click retry
  recovers everything.



## ⏰ Parked reminders — bring up next session

### 🅿️ Parked 2026-06-27 — Composable `<TrustStrip />` component

The `/changelog` trust-signal stack (shields.io badge + state word
+ heartbeat caption + 30-day sparkline + incident counter) is dense
enough to be reusable.  Extract it into a single `<TrustStrip />`
component that other public surfaces can drop in with one import:
  • `/` (marketing homepage)
  • `/users` (directory)
  • the login gate / 401 wall
Same data fetcher (`/api/canary/status` + `/api/canary/uptime`
with shared 5-min in-process cache, so additional mount points
don't fan-out extra requests).  ~20 min refactor for compound
reliability-broadcast payoff across every public landing.
User asked to revisit later.


### 🅿️ Parked 2026-06-27 — "Days since last incident" counter on sparkline

Add a tiny `📅 12 days since last incident` counter next to the
30-day uptime pill on `/changelog`.  Resets to 0 on any red cell.
Quiet "we run a tight ship" trust signal that quietly counts up
between outages.  Compute from existing `info.daily[]`: find the
latest-indexed cell with `fail > 0`, then
`info.daily.length - 1 - lastRedIdx`.  Couple of lines in
`CanaryUptimePill`.  User asked to revisit later.


### 🅿️ Parked 2026-06-27 — Open Graph reliability unfurl for `/changelog`

Now that the public trust-signal stack is built (badge + state word
+ heartbeat + uptime %), add a server-rendered `<meta>` /
Open Graph card to `/changelog` that broadcasts the live healthy
status when the URL is pasted into Twitter/Discord/Slack — e.g.
*"Shelfsort changelog · 99.7% production uptime over 30 days · last
checked 2 min ago"*.  Larger scope (needs the heartbeat fetched
server-side at render time too).  User asked to revisit later.


### 🅿️ Parked 2026-06-27 — "Auto-share my Wrapped" follow-up

When the user clicks the post-big-import **See my Wrapped** CTA
(shipped 2026-06-27), pre-stage the share-token URL and copy it to
clipboard with a follow-up toast like *"Wrapped link copied — paste
it in your group chat to flex your library."*  Turns a private
milestone into organic word-of-mouth.  User asked to revisit later.


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

### 🟢 Launch-prep items still pending (after Privacy + Terms + robots/sitemap/footer-wire/Indiana shipped)

- **Redeploy to production** — Manage deployments → Redeploy.
  Pushes everything from today's session to shelfsort.com:
  Privacy, Terms, footer, robots.txt, sitemap.xml, Indiana
  governing-law clause, admin changelog card, LLM key health
  card, smart welcome email, tour bypass `?notour=1`, BSTK
  inline reminder, AdminHelp doc updates.  Until you click
  Redeploy, all of the above exist only in preview.
- **Public launch announcement** — `/app/memory/LAUNCH_TWEET.md`
  has 3 platform variants (Twitter/Bluesky/Mastodon) with the
  correct `shelfsort.com` domain.  Post when ready.  Recommend
  Bluesky first (warm audience for indie tools) → Twitter →
  Mastodon.  Reply to your own post with the static
  `landing-hero.png` from `/frontend/public/`.
- **`/help` footer bounce** — `/help` is wrapped in
  `<ProtectedRoute>` so unauthenticated visitors clicking the
  footer "Help & FAQ" link from `/privacy` or `/terms` will
  bounce to `/login`.  Acceptable for v1 launch; revisit later
  with one of: (a) make `/help` public, (b) split into a
  public marketing `/help` + an authenticated `/account/help`.
- **Optional: legal entity on Privacy &sect;1** — if you ever
  incorporate as an LLC, drop the legal entity name into
  Privacy.jsx section 1.

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
