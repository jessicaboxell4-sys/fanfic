# Shelfsort — Roadmap

> Active backlog. Items move to [CHANGELOG.md](./CHANGELOG.md) when shipped.


## 💡 Reminder — "Listed!" confirmation toast on @handle save

After a user picks/saves their `@handle` on Account → Profile, fire a
tiny success toast: "Listed! You'll now appear in the public reader
directory."  Closes the visual loop after the "Welcome to the
directory → Pick a handle" CTA, answering the implicit "did that
actually do anything?" question.  Tiny scope — hook into the existing
profile-save success path in `pages/Account.jsx`.

## 💡 Reminder — "Welcome to the directory" onboarding toast — DONE 2026-06-25 ✅

Shipped — see CHANGELOG `2026-06-25 (afternoon)` extension entry.

## ✅ Just shipped (2026-06-24/25)

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
