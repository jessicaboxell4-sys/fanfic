# Shelfsort — Changelog

Append-only log of dated work entries. Newest at the top.

For static product context see [PRD.md](./PRD.md).
For the prioritized backlog see [ROADMAP.md](./ROADMAP.md).
The pre-split verbose history (with every "Added 2026-05-29" line) is preserved verbatim in `PRD.md.bak`.

---
## 2026-06-20 (invite-funnel-clicks + pending-ref-badge) — top-of-funnel tracking ✅

Closed two gaps on the launch-readiness sprint for the HP-fanfic FB invite:

**Top-of-funnel click tracking**
- `Landing.jsx` now fires a fire-and-forget `POST /analytics/view` with
  `{page_type: "ref_click", slug: <tag>}` whenever a visitor lands on
  `/?ref=<tag>`. `sessionStorage` markers dedupe per session so a reload
  inside the same tab doesn't double-count; the backend's existing 30-min
  `ip_hash` dedupe handles cross-session and bot traffic.
- `GET /admin/campaign-stats` (existing endpoint) now also aggregates
  `clicks` from `page_views` and emits a new `clicks` field per row.
  Campaigns with clicks but **zero signups** now surface too, so day-1
  of a fresh post is visible immediately instead of after the first
  signup.

**Pending sign-ups card · per-row referral badge**
- `PendingUsersCard` on `/admin` shows a small `via {ref}` violet pill
  on every pending user row that came through a tracked invite link.
  Lets the admin see at a glance which campaign drove each pending
  signup before approving.

**Frontend** — `Landing.jsx` (click ping useEffect), `AdminConsole.jsx`
(`Clicks` column in `CampaignStatsWidget`, `via {ref}` badge in
`PendingUsersCard`).

**Backend** — `routes/admin.py::get_campaign_stats` extended with the
`clicks` aggregation + the click-only campaign surfacing.

**Tests** — `tests/test_campaign_stats.py::test_campaign_stats_includes_clicks`
locks in: (1) the new `clicks` field is populated from `page_views` rows
with `page_type="ref_click"`, and (2) click-only campaigns surface in the
funnel even with 0 signups. All 4 campaign-stats tests pass.

**Verification** — end-to-end: posted 3 simulated ref clicks for `hpfb`
and `tiktok`, confirmed via UI screenshot that the new "CLICKS" column
shows `2 (50%)` for hpfb (2 clicks → 1 signup) and `1 (0%)` for the
click-only `tiktok` row, and the violet `VIA HPFB` badge renders on the
pending sign-ups card. Tester admin flag reverted post-test.


## 2026-06-20 (admin-help-email-system) — AdminHelp adds Email-system kill-switch section ✅

Closed a documentation gap: `AdminHelp.jsx` previously had no permanent
section explaining the new `EmailSystemCard` kill switch (the
`outbound_emails_enabled` feature flag), even though `EmailPreferences.jsx`
and user-facing `Help.jsx` were updated last session.

**Frontend** — `/app/frontend/src/pages/AdminHelp.jsx`:
- New `email-system` Section between `notifications` and `email-logs`.
- Sidebar TOC entry: **"Email system kill switch"** (icon: Pause).
- Covers: when to flip OFF (quota burn / QA noise), what happens while
  paused (queues to in-app notifications), always-on kinds (password
  reset bypasses), per-user opt-out independence, test-domain
  suppression via `utils/email_suppression.py`, and the
  `PUT /admin/feature-flags` backend endpoint.

**Verification**: Logged in as the seeded tester promoted temporarily to
`is_admin=true`, captured `/admin/help` screenshot showing the rendered
section with all six bullets. Admin flag reverted to `false` post-test.



## 2026-06-20 (email-system-card) — Admin master switch card ✅

Promotes the buried `outbound_emails_enabled` feature flag into a
dedicated, prominent admin card so the admin can find and flip it
in under 5 seconds during a quota emergency.

**Frontend** — new `EmailSystemCard` in `AdminConsole.jsx`:
- Indexed under the "email" filter chip with keywords:
  ``email outbound resend pause stop disable quota system master
  kill switch``.  Search "email" → card appears immediately under
  Pending sign-ups.
- Visual state: large green/emerald pill **"ON — sending real
  emails"** or rose pill **"PAUSED — in-app only"**.
- Single big toggle button: ``🛑 Pause email system`` ↔
  ``✅ Resume email system``.
- Inline explainer that adapts to state (what happens when on vs
  paused, including the note that per-user opt-outs + security
  emails always behave correctly even when paused).

**Backend** — no changes.  Uses the existing
``PUT /admin/feature-flags`` endpoint with
``{flag: "outbound_emails_enabled", enabled: bool}``.  The
suppression layer at ``utils/email_suppression.py`` already reads
this flag on every send.

**Why a dedicated card instead of just the Feature flags row?**
The Feature flags card holds 6+ flags and the email kill switch
is the one an admin reaches for during a fire (Resend quota burn,
unexpected mail volume, etc.).  Dedicated card + obvious copy +
keyword-rich search index = "I need to stop the emails" → flipped
in ~5 seconds.

15/15 design-system + suppression tests green.

---



## 2026-06-20 (per-user-email-opt-out) — Users choose which emails they want ✅

Third gate added to the email suppression layer + a user-facing
"Account updates" card on `/account/emails`.

**Backend**:
- `utils/email_suppression.py`: new ``USER_OPTABLE_KINDS`` set
  (``approval_approved``, ``approval_rejected``, ``suggestion_status``,
  ``year_in_books``, ``bookclub_invite``, ``recommendation_weekly``,
  ``fandom_overlap``). A new ``_user_opted_out()`` gate checks
  ``users.email_prefs[kind]`` — explicit False suppresses + queues
  an in-app notification. Non-optable kinds (e.g.
  ``password_reset``) bypass this gate so security-critical mail
  always sends.
- New ``GET/PUT /api/account/email-prefs`` endpoints in
  ``routes/user_prefs.py``. PUT supports per-key patching so each
  toggle flip is a tiny, atomic request.
- ``routes/admin.py`` approval-email params now include
  ``_kind: "approval_approved" | "approval_rejected"`` so the
  suppression layer can identify it.

**Frontend** — ``pages/EmailPreferences.jsx``:
- New "Account updates" card mounted right above the existing
  "In-app notifications" mute matrix. 7 rows, one per optable
  kind, with concise descriptions ("You're approved! — Sent when
  an admin lets you in. Off = banner on next login instead.").
- Optimistic toggles: state flips instantly, PUT fires, reverts
  on failure with an error toast. Success toast reads "Email
  turned on" / "We'll send this as an in-app notification instead".
- ``data-testid`` on every row + toggle so the testing-agent guard
  stays green.

**Tests** — ``tests/test_email_kind_optout.py`` (+4 cases):
- Default prefs all True (every optable kind opt-in by default)
- PUT patches single kind without disturbing others
- Opted-out kind suppressed AND queues notifications row for the
  user
- Non-optable kind (``password_reset``) passes through even when
  user has another kind opted-out

**Suppression layer now has 3 stacking gates** (any one suppresses):
  1. Test-recipient match → skip
  2. Admin ``outbound_emails_enabled=False`` → skip + in-app fallback
  3. User ``email_prefs[kind]=False`` → skip + in-app fallback

**Sample impact**: today the user hit Resend's 100/day quota with
122 ``approval_approved`` emails to bulk-approved test users. With
the test-recipient gate alone, those would have been zero quota
burn. With user opt-out, any real user who turns off
``approval_approved`` shifts that email to free in-app
notifications.

57/57 tests green across today's full session.

---



## 2026-06-20 (email-suppression) — Test-recipient skip + emergency outbound brake ✅

Direct response to hitting the Resend 100/day quota: protect real
quota from test traffic AND give the admin a one-click emergency
brake that keeps users informed via in-app notifications.

**Single monkey-patch at startup** — `utils/email_suppression.py`
wraps ``resend.Emails.send`` with two gates:

  1. **Test-recipient gate** — if the recipient matches the existing
     ``is_test_account()`` patterns (``@example.*``, ``@ft.local``,
     ``@bulkfx.*``, ``test_*@*``, etc.), the email is short-circuited.
     A row is still written to ``email_logs`` with
     ``status="suppressed", suppress_reason="test_recipient"`` so the
     admin email-logs page shows what would-have-been-sent.
     Stops every pytest run + bulk-fixture script from eating real
     Resend quota again.

  2. **Outbound-pause gate** — when the centralised feature flag
     ``outbound_emails_enabled`` is set to False, every real-domain
     email is suppressed too AND a matching ``notifications`` row
     is inserted for the user (when we can resolve them by email).
     Toast-style in-app fallback: title = original email subject,
     body = "Heads-up: an email we'd normally send was paused…".
     Activate the brake from `/admin` → Feature flags → toggle
     ``outbound_emails_enabled`` to **Disabled**.

**Why a monkey-patch instead of refactoring 10+ call sites**: every
Resend send in this codebase already goes through ``resend.Emails.send``
inside ``asyncio.to_thread(...)``. Patching once at startup means the
two gates apply universally without touching the call sites that
matter (auth, digest, suggestion-status, year-in-books, admin-test,
cron-failure-alerts).

**Implementation notes**:
- Uses a dedicated synchronous ``pymongo.MongoClient`` (max pool 4)
  because the patched function runs in a worker thread.  Tiny indexed
  lookups; no event-loop juggling.
- Imports ``deps`` defensively so `load_dotenv()` fires before the
  first sync Mongo call (needed when pytest imports the suppression
  module directly).
- Feature flag added to ``utils/feature_flags.KNOWN_FLAGS`` so the
  existing Feature flags admin card surfaces a toggle automatically —
  zero new admin UI needed.

**Tests** — `tests/test_email_suppression.py` (+5 cases):
- Test recipient (``@example.com``) → suppressed + log row + no
  Resend call
- Test local-part (``test_xxx@real-domain``) → also suppressed
- Real recipient with flag ON → original ``_ORIGINAL_SEND`` is called
- Flag OFF + real user → suppressed + ``notifications`` row inserted
  for that user
- Flag OFF + unknown email → suppressed + no notification (silent
  no-op, defensive)
All 5 passing.  53/53 tests green across today's full suite.

**Screenshot verified**: `/admin` → "flags" filter → Feature flags
card now shows ``outbound_emails_enabled — Send real emails via
Resend (turn OFF to suppress all outbound and queue in-app
notifications instead — Resend quota brake) — Enabled``.

---



## 2026-06-20 (deploy-comms) — Auto-detect deploys, notify users ✅

Three complementary pieces so users always know when a deploy is
happening AND when it just finished.

**Backend** — `routes/health.py`:
- Module-level `BOOT_ID` (12-hex UUID) + `BOOT_TIME` generated when
  the module imports. Every container boot = new ID.
- New `GET /api/version` endpoint (unauthenticated, cheap). Returns
  `{version, boot_id, build_time}`. Also surfaced inside the
  existing `/api/health` response.

**Frontend** — `components/NewVersionBanner.jsx` (~120 LOC):
- Polls `/api/version` every 60s. On first response, locks in the
  baseline `boot_id`. When a subsequent poll sees a different
  `boot_id`, a calm lavender banner slides in at the top of every
  page: "Shelfsort just updated. Refresh to pick up the latest
  version — your reading position is already saved."
- Two actions: `Refresh now` (hard reload) and `Later` (dismisses
  for the rest of the session via `sessionStorage`).
- Mounted in `App.js` right below the existing `MaintenanceBanner`.

**Admin** — `AdminConsole.jsx` Maintenance Banner card:
- New "Deploy presets" row at the bottom of the card with two
  one-click buttons:
  - 🛠️ **Deploy starting** → publishes a warn-severity banner
    ("Shelfsort is updating — you may see brief blips for ~2 min")
    site-wide.
  - ✅ **Deploy complete** → clears the maintenance banner. The
    per-tab `NewVersionBanner` already auto-detects the new
    `boot_id` and surfaces a refresh prompt, so we deliberately
    don't double-stack a site-wide "deployed!" message.

**Tests** — `tests/test_version_endpoint.py` (+4 cases):
- Unauthenticated GET works
- `boot_id` matches the 12-hex format
- Multiple calls within a process return the same `boot_id` (no
  flapping the refresh prompt)
- `build_time` is a parseable ISO timestamp

**End-to-end verified**: baseline boot captured, backend restarted,
new boot_id observed by the polling component within ~16s, banner
appeared on the live `/library` page with both action buttons.

**For the redeploy workflow**:
1. Click "🛠️ Deploy starting" on `/admin` before pushing
2. Save to GitHub → redeploy
3. After deploy lands: `NewVersionBanner` notifies users
   automatically (each tab sees the change on its next 60s poll)
4. Click "✅ Deploy complete" to clear the heads-up banner

---



## 2026-06-20 (invite-fast-track) — `?ref=...` skips onboarding questions ✅

When a visitor arrives via a tracked invite link (Facebook group
post, partner site, etc.) they've already self-selected — making
them answer "what's your favorite fandom" is unnecessary friction.
This change skips the onboarding panel entirely on fast-track signups.

**Frontend** — `Login.jsx`:
- New `inviteFastTrack = mode === "register" && !!referral` flag.
- Step 1 → Step 2 transition is skipped when `inviteFastTrack` is
  true; the form submits directly from email/password.
- Submit-button label flips from "Continue" → "Create account" when
  fast-track is active so the user knows they're done.
- Consent microcopy ("Welcome from your invite link! By creating an
  account you agree to the community rules and confirm you're 13 or
  older.") renders below the button with a link to `/rules`.
- `accepted_rules` is set implicitly to true; ``onboarding={referral}``
  is sent so the campaign tag survives.

**Backend** — no changes needed!  `auth.py:322` already accepts
``onboarding.referral`` alone as a valid "answer" to the
"at least one" rule, and `is_13_plus=null` (omitted) passes the
``if is_13_plus is False`` age gate.  The fast-track is just a
lighter frontend payload that the existing contract already permits.

**Tests** — `tests/test_invite_fast_track.py` (+5 cases):
- Fast-track with only referral+accepted_rules succeeds (returns
  pending if approval-gate on)
- No-referral + empty onboarding → 400 (confirms gate still works)
- Missing `accepted_rules` even with referral → 400
- Explicit `is_13_plus=False` still blocks (the gate is age-aware,
  not consent-blind)
- `is_13_plus` omitted on fast-track → passes (the whole point)
All 5 passing.

**Screenshot verified**: `/login?ref=hpfb` auto-flips to register,
shows "Create account" button + consent line, no step-2 panel.
`/login` (no ref) keeps "Continue" + step-2 panel.

**For the HP Facebook post**: use URL
``https://shelfsort.com?ref=hpfb``.  Existing
``/admin/onboarding-stats`` card will attribute every sign-up that
came in via that link to the ``hpfb`` campaign.

---



## 2026-06-20 (device-picker) — Required device on every suggestion ✅

Triage upgrade: "the reader is laggy" → "the reader is laggy on
Amazon Fire" without the back-and-forth.

**Backend** — three changes in `routes/suggestions.py`:
1. `BUILT_IN_DEVICES` constant (10 entries, alphabetical): Amazon
   Fire, Android phone, Android tablet, Chromebook, iPad, iPhone,
   Kindle e-reader, Linux, Mac, Windows PC.
2. New `GET /api/suggestions/devices` — returns built-ins + any
   custom devices a user has previously typed in the "Other" box,
   deduped case-insensitively and sorted alphabetically.
3. `POST /api/suggestions` now requires `device` as a Form field.
   `_resolve_device()` matches the input against built-ins and the
   `custom_devices` Mongo collection (case-insensitive). A genuine
   new device gets normalized, length-capped at 40, and persisted —
   so the next user sees it in the picker.

**Startup migration** — backfills `device="Unknown"` on any
pre-existing suggestion row that lacks the field (idempotent
`update_many`). Stamped 3 legacy rows on first boot. Creates a
unique index on `custom_devices.name_lc` so concurrent inserts of
the same novel device never duplicate.

**Frontend** — new `<DevicePicker>` component (~180 LOC), used on
both `SuggestionsPage` and `DashboardSuggestionsBox`:
- Auto-detects from `navigator.userAgent` on first mount (iPad
  before iPhone before Android, mobile vs tablet split via the
  "Mobile" UA token, Amazon Fire via `Silk`/`KFTT` codes, etc.)
- Remembers the last successful pick in `localStorage` so repeat
  submitters skip the dropdown next time.
- "Other (type in)…" sentinel reveals an inline text input — the
  typed value is sent as-is and the backend persists+canonicalizes
  it.
- Submit button stays disabled until a device is chosen.
- Per-card chip with smartphone icon shows the device on every row
  of the public board (hidden when device is `Unknown` so the 3
  legacy rows don't get visual noise).

**Tests** — `tests/test_suggestions_device.py` (+9 cases):
- Auth-gated `/devices` endpoint, contains all 10 built-ins,
  alphabetical
- POST without `device` → 422; with built-in (any casing) →
  canonical name returned
- New custom device persists + appears in subsequent `/devices`
  responses; case-mismatched re-submission reuses the canonical
  casing (no duplicates)
- `list_suggestions` exposes `device` field on every row
- Length cap (>40 chars) → 422 from FastAPI Form validator

Also updated 4 existing `tests/test_suggestions.py` POSTs to
include `device`. **33/33 tests green** including the 6 design-
system guards.

**Screenshot verified**: picker auto-detected Linux from Playwright
UA, dropdown shows 12 options (10 built-ins + 1 prior custom + Other),
switching to "Other" reveals input and keeps Submit enabled.

---



## 2026-06-20 (ds-contracts) — data-testid + API instance guards ✅

Two more "design-system contract" pytest tests in the same vein as
the dark-mode gradient guard from earlier today.  Both use the
baseline-allowlist pattern so existing tech debt is documented but
new violations fail the build immediately.

**`tests/test_data_testid_guard.py` (~150 LOC, 2 cases)**
- Scans `frontend/src/{components,pages}/*.jsx` for `<button>`,
  `<Button>`, `<input>`, `<Input>`, `<select>`, `<Select>`,
  `<textarea>`, `<Textarea>` opening tags.
- Walks forward through JSX expression braces to the matching `>`
  and checks for `data-testid=`.
- Fails if a NEW file outside the 42-file baseline allowlist
  introduces an untestid'd interactive element.
- Baseline snapshot: 42 files / 74 missing testids at 2026-06-20,
  frozen in `BASELINE_ALLOWLIST` with a regen recipe in a comment.

**`tests/test_api_instance_guard.py` (~115 LOC, 2 cases)**
- Scans `frontend/src/**/*.{js,jsx}` for direct
  `axios.{get|post|put|delete|patch|request|head|options}(` calls
  and for `fetch("/api/...")` / template-literal fetch URLs
  containing `/api/`.
- Intentionally does NOT flag `${REACT_APP_BACKEND_URL}/api/...`
  template literals (those are overwhelmingly legitimate
  `<img src>`, `<a href>`, `EventSource`, `window.open` — the
  browser handles them directly).
- Baseline: 2 files (`pages/Help.jsx` for announcements + fandoms,
  `pages/PublicYearInBooks.jsx` for the unauth public-year route).
- New files must `import { api } from "@/lib/api"` and use
  `api.get/post/etc.` — keeps `withCredentials: true` and base-URL
  config consistent across the whole app.

**Self-verified** both detectors with synthetic strings (8 cases
across the API guard, 2 JSX fixtures for the testid guard) — all
expected hits/misses confirmed before commit.

The pattern now covers three recurring footguns in this codebase:
* light-cream gradients in dark mode
* untestid'd buttons breaking automated tests
* direct axios/fetch calls bypassing `withCredentials`

---



## 2026-06-20 (gradient-guard) — Dark-mode gradient regression test ✅

Locks in the "Tailwind gradient color-stops bypass dark-mode CSS"
footgun discovered today (WhatsNewFeed + CrossDeviceFinishStrip
rendered invisible-on-invisible in dark mode because `from-[#FBFAF6]`
on a `bg-gradient-to-br` isn't covered by the same attribute-selector
remap that handles solid `bg-[#FBFAF6]`).

**Test** — `tests/test_dark_mode_gradient_guard.py` (~140 LOC, 2
cases):
- Scans `frontend/src/{components,pages}/*.jsx` for any line that
  combines `bg-gradient-to-<dir>` with a light-cream color-stop
  (`from-[#FBFAF6]`, `to-white`, 15+ known light tokens including
  the `/60` opacity variants).
- Fails when a NEW file lands in the offenders list that isn't on
  `BASELINE_ALLOWLIST` (4 existing files documented by hand:
  UrlPasteCard, StatsPage YIB banner, Help top banner, AllBooksPage
  3 banners).
- Companion test fails if a baselined file drops its gradient — keeps
  the allowlist honest as the codebase evolves.

**Self-verified** the detector with synthetic strings: catches three
common patterns (`from-[#FBFAF6] to-white`, `from-[#EDE7FB] to-white`,
3-stop `via-white`), ignores solid backgrounds and dark-safe gradients
(`from-purple-500 to-pink-500`).

Next time someone adds a "pretty cream gradient" in a new card, the
pytest suite will tell them to either use the solid `bg-[#FBFAF6]`
(already dark-mode-mapped) or extend `index.css` with an explicit
gradient stop override.

---



## 2026-06-20 (cdf-strip) — "Finished on your iPhone?" suggestion strip ✅

The parked completion-moment cross-device discovery rail from the
2026-06-19 backlog, shipped.

**Component** — new `CrossDeviceFinishStrip` mounted on
`/book/:id` immediately below the existing cross-device hint pill.
Visibility predicate (all four must be true):
  1. `book.progress_fraction >= 0.9`
  2. `book.last_device_id && book.last_device_label` are set
  3. `localStorage.shelfsort-device-id !== book.last_device_id`
  4. `(now - book.last_cursor_updated_at) <= 14 days`

If the predicate matches, fetches up to 3 books from the user's
library via the existing `/api/recommendations/similar/{book_id}?limit=3`
endpoint.  Hides silently when the recs array is empty so single-
fandom libraries never see an awkward empty state.

**Layout** — compact 3-column grid (40×56px cover + 2-line title +
1-line author + `SAME FANDOM` / `SAME AUTHOR` reason pill).
Differs from the existing bottom-of-page `SimilarBooksStrip` which
is a 6-card browsable grid.  Both can render together — the top
one captures the moment, the bottom one is for browsing later.

**Copy** —
  - `progress >= 0.95` (truly finished): "FINISHED ON YOUR IPHONE — Want a similar one to read next?"
  - `0.9 <= progress < 0.95` (nearly done): "READING ON YOUR IPHONE — Want a similar one to read next?"
Device icon switches based on label (iPhone/Android → Smartphone,
iPad → Tablet, Mac/Windows → Laptop, else generic).

**Dismiss** — small `Hide` link in the strip header that sets
component-local `skip=true`.  Suggestion comes back the next time
the page is opened (intentional — no DB persistence; the moment is
ephemeral).

**Tests** — `tests/test_cross_device_finish_similar.py` (+3 cases):
limit=3 returns at most 3 with `match_reason`, limit=0 falls back
to default (existing behavior, not a regression), unknown seed →
404.  All 3 passing.  27 total green between this, the new
admin-whats-new suite, and the suggestion regression tests.

---



## 2026-06-20 (whats-new) — Admin "What's new in Shelfsort" feed ✅

Surface the CHANGELOG inside the app so the operator has a passive
"what shipped this week" check-in without leaving /admin/help.

**Backend** — new `GET /api/admin/whats-new?limit=N`
(`routes/admin_whats_new.py`, ~160 LOC):
- Parses `/app/memory/CHANGELOG.md` on demand, splits on `---`
  separators, extracts date/suffix/title/status-emoji/body for each
  `## YYYY-MM-DD` heading.
- In-memory cache, 5-min TTL, invalidated automatically when the
  file's mtime changes.
- Limit clamped to `[1, 50]`.  Admin-gated (`require_admin`).
- Returns: `entries[]`, `total`, `cached_at`, `source_mtime`.

**Frontend** — new `<WhatsNewFeed>` component
(`components/WhatsNewFeed.jsx`, ~270 LOC) injected at the top of
`/admin/help`, above the existing 14 doc sections:
- Initial load: 5 most-recent entries with body_preview (first 6
  non-empty lines).
- "Show last 20 entries" expander loads up to 20 via re-fetch.
- Per-entry "Copy link" button writes `/admin/help#<slug>` to the
  clipboard (toast confirmation).
- Per-entry "Show full entry / Show less" toggle swaps preview ↔
  full body.
- Tiny in-component markdown renderer (no react-markdown dep):
  handles `**bold**`, `` `code` ``, `- bullets`, paragraph breaks.
- Refresh button re-hits the endpoint (server returns from cache
  unless mtime ticked).
- On mount, if URL has `#YYYY-MM-DD-slug`, auto-expand the matching
  entry and `scrollIntoView`.

**Tests**: `tests/test_admin_whats_new.py` (+6 cases):
- 401 unauth, 403 non-admin, response shape & date format
- limit bounds (`limit=0` → 422, `limit=999` → 422, `limit=1` works)
- Real CHANGELOG: confirms the `(later)` suffix entry parses with
  `status_emoji=✅`
- Unit test of `_parse_changelog()` against synthetic markdown with
  both kinds of `—`/`-` dash and a `(part 2)` suffix
All 6 passing.

**Why parse on each request instead of pre-rendering?** The
CHANGELOG IS the data; one source-of-truth, zero drift.  Parser
runs <2 ms on 60 entries, cached for 5 min — operator-friendly.

---



## 2026-06-20 (later) — AdminHelp lint fix + test repair ✅

**Resume after fork: AdminHelp build blocker cleared**
- Fixed all 26 ESLint `no-unescaped-entities` errors in
  `/app/frontend/src/pages/AdminHelp.jsx` (escaped `"` → `&quot;`,
  `'` → `&apos;` throughout JSX text nodes).
- Verified `/admin/help` renders end-to-end: h1 "Admin console —
  what does what", 14-section sticky TOC, all sections present
  (Users, Pending, Test-account quarantine, Campaign, R2 migration,
  Orphan audit, Pause Emergent fallback, Savings, Antivirus,
  Feedback, Operator digest, Email logs, Bookclubs, Unknown sources).
- Note: TourOverlay auto-bounces fresh sessions on /admin/help if
  `shelfsort_tour_seen` localStorage flag isn't set; harmless for
  real admins who've already onboarded.

**Suggestions tests updated for image-only Form contract**
- `tests/test_suggestions.py`: switched all POST `/api/suggestions`
  calls from `json=` → `data=` (multipart/form-encoded) to match
  the new `Form(...)` parameters introduced by the image-only
  uploads change. 18/18 tests now pass.

**Deep-dive sweep results**
- Frontend lint: AdminHelp clean. 91 pre-existing
  `no-unescaped-entities` warnings remain across other pages
  (Account, Login, Reader, etc.) — not blockers, tracked as P3.
- Backend lint (ruff): 40 pre-existing style issues in
  `tests/` and `utils/ao3_metadata.py` — cosmetic only.
- Backend log: no errors.
- Pytest: 1 pre-existing failure in
  `test_admin_console.test_users_list_includes_admin_badge_and_book_count`
  (count=2, expected ≥3) — caused by `@example.com` seed addresses
  now matching the wider `_TEST_DOMAINS` filter. Not a regression
  from this session.

---


## 2026-06-20 — MIME-family badges + Reader DNA share-card ✅

Two parked features knocked out together.

**MIME-family attachment badges** (admin Feedback inbox)
- Replaced the generic "📎 file" pill with a color-coded family-aware
  label: 📎 image (emerald), 📎 pdf (rose), 📎 log (amber), 📎 zip
  (slate), 📎 file (purple fallback).  Switch is on
  ``it.attachment_mime``.  Title attribute exposes raw MIME for
  inspection.  ``data-mime-family`` attribute added for testing.

**Reader DNA → 1080×1080 share-card**
- New deterministic Pillow renderer ``utils/reader_dna_card.py``:
  draws the user's DNA payload as an Instagram-story-ready 1080×1080
  PNG.  Brand colors (parchment, coral, purple), DejaVu Serif/Sans
  fonts, footer CTA "GET YOURS AT SHELFSORT.COM".  ~150 LOC, no LLM
  cost, ~200 ms render time, fully reproducible.
- New endpoint ``GET /api/insights/reader-dna/share-card.png`` reuses
  the existing ``reader_dna()`` computation and streams the PNG with
  60s per-user in-memory cache so repeated share→cancel→share
  doesn't re-render.
- "Share" button on the Reader DNA card on ``/stats``:
  - Mobile (Web Share API): native sheet → Instagram/Twitter/iMessage
  - Desktop fallback: downloads ``reader-dna.png`` directly
- Tests: ``test_reader_dna_card.py`` (+3 cases): auth gate, PNG shape
  + 1080×1080 dimensions, in-memory cache idempotency.  All passing.

Why deterministic render, not nano-banana?  Free, reproducible, brand-
consistent.  Nano-banana would have been ~$0.04/render and the same
DNA might produce different-looking images each call.

---

## 2026-06-20 — R2 "$ saved this month" line on migration banner ✅

Companion to the migration-complete banner: now that R2 is the
primary backend, surface the ROI in dollars.

**Backend** — new `GET /api/admin/storage-cost-savings` aggregates
total bytes from non-trash books, applies configurable per-GB rates
(via env: `EMERGENT_STORAGE_GB_RATE`, `EMERGENT_EGRESS_GB_RATE`,
`R2_STORAGE_GB_RATE`, `R2_EGRESS_GB_RATE`, `STORAGE_EGRESS_MULTIPLIER`),
and returns:
  - Inputs: `total_gb`, `monthly_egress_gb`, `rates`
  - Per-backend estimates: `emergent_estimated.{storage,egress,total}_usd`
  - Per-backend estimates: `r2_estimated.{storage,egress,total}_usd`
  - Bottom line: `savings_usd`, `savings_pct`

Defaults reflect posted public rates:
  - Emergent: $0.20/GB/mo storage + $0.09/GB egress (S3-class)
  - R2: $0.015/GB/mo storage + $0 egress (R2's killer feature)
  - Egress multiplier: 2.0 (typical active library reads each byte
    ~2× per month — override with real billing data when you have it)

**Frontend** — `SavingsLine` component injected at the bottom of
the `r2-migration-complete-banner`.  Renders only when both the
gauge AND the savings endpoint have loaded. Auto-formats:
  - `$10` for ≥ $100
  - `$10.45` for ≥ $0.01
  - `$0.0003` for sub-cent
Hovering the line reveals a tooltip with the full math (storage +
egress for each backend, total + delta).

**Tests**: `test_storage_cost_savings.py` (+2 cases) — admin-gate +
shape/math/sanity check (R2 always ≤ Emergent for non-zero
libraries; savings_pct ∈ [0, 100]; storage × rate is internally
consistent).  Both passing.

---

## 2026-06-20 — Deep-dive bug sweep ✅

Comprehensive audit after the deploy: full backend + frontend lint,
122-test pytest run, log scan.  Surfaced **three real bugs**:

**🐞 Bug 1 — `BookReadingInsights.jsx` runtime crash (HIGH)**
- Component referenced `<HelpAnchor>` in JSX but never imported it.
- Every BookDetail page with reading data would throw
  ``ReferenceError: HelpAnchor is not defined`` and unmount the
  whole right column.  Latent since the component was added —
  somehow the import got dropped during a previous refactor.
- Fix: re-added the `import HelpAnchor from "./HelpAnchor"` line.

**🐞 Bug 2 — `routes/url_lists.py` NameError on pull (HIGH)**
- ``pull_url_list`` referenced `detect_series_from_title` and
  ``_canonicalize_fandom`` but neither was imported in the module.
- Any user invoking the bulk URL pull feature would hit a
  ``NameError`` 500 the moment the classifier needed to pick a
  series + fandom.
- Fix: added the missing import from `utils.epub_metadata`.

**🐞 Bug 3 — `routes/books.py` shadowed import (LOW)**
- ``classify_ao3_non_work`` was imported at the top of the module
  AND re-imported in a function body (via ``utils.unknown_sources``)
  — same underlying function, but ruff flagged the redefinition.
- Fix: removed the redundant inner import.

**Test-suite hygiene** — the test_account_filter expansion broke
a handful of older tests that used ``user_<hex>@example.com`` as
"real user" fixtures.  Updated to use non-matching prefixes/
domains.  Also updated 2 Year-In-Books tests whose assumptions
(``RESEND_API_KEY empty``) are no longer true now that the Resend
domain is verified.

**Result**: 121 passed, 0 failed, 1 skipped (bootstrap-only test).
Production-critical imports verified clean.  Frontend lint only
shows cosmetic warnings (unescaped apostrophes in strings, empty
catches in reader.jsx that are intentional design).

---

## 2026-06-20 — Attachment preview chips on /suggestions + admin board ✅

Companion to the attachment-on-every-form work earlier today: now that suggestions can carry files, the board UI and admin triage view surface them.

**`/suggestions` (public board)** — every row that has an attachment renders an inline `SuggestionAttachmentChip` (📎 filename · size). Click toggles a preview pane in-place:
  - Image MIME → 240px-max thumbnail
  - PDF MIME   → 480px embedded mini-viewer
  - Anything else → Download link
  Bytes are fetched lazily on first open (so a 9 MB attachment doesn't slow a 100-row board scroll).

**`/admin` → Feedback inbox** — `FeedbackInboxCard` rows with an attachment now show:
  - A small purple "📎 file" badge in the header for quick scanning of which rows have evidence
  - A clickable chip with filename + size when the row is expanded, opening in a new tab (same-origin so the session cookie carries auth)

**Backend** — already serialised `has_attachment`, `attachment_name`, `attachment_mime`, `attachment_size` in `_serialize()`; new `GET /suggestions/{sid}/attachment` route streams the bytes (submitter or admin only, 403 otherwise).

---

## 2026-06-20 — Attachments on every suggestion surface ✅

User reported the suggestion forms didn't show a way to attach a screenshot or file. Audit showed only the Help-page SuggestionBox supported attachments (images only, 5 MB) — the long-form `/suggestions` board and the Dashboard inline form were JSON-only.

**Backend**:
- `routes/suggestions.py::submit_suggestion` switched from JSON to multipart. Optional `attachment: UploadFile` accepted up to 10 MB, ANY file type. ClamAV-scanned before base64-encoded into the doc (same policy as `/feedback`).
- New `GET /suggestions/{sid}/attachment` endpoint streams the file back to the submitter or any admin (with proper Content-Disposition inline header).
- `routes/suggestions_box.py::submit_suggestion` (the Help-page `/feedback` endpoint): size cap bumped 5 MB → 10 MB and the image-only MIME check removed. Same AV pipeline.

**Frontend** — three surfaces updated with a unified Paperclip picker + filename chip + remove button + "Max 10 MB · any file" hint:
- `pages/SuggestionsPage.jsx` (used by footer "Suggestions" link AND navbar "Suggestions & feedback" item)
- `components/DashboardSuggestionsBox.jsx` (Dashboard inline form)
- `components/SuggestionBox.jsx` (Help page; image preview retained when an image is picked, filename chip for everything else)

**Verified**: PDF upload → store → re-download identical bytes via curl. Too-large file returns HTTP 413 + `attachment_too_large` toast. Live on preview — `/suggestions` page shows the new "Attach screenshot or file" label.

---

## 2026-06-20 — Approval-status flip for legacy test fixtures ✅

User reported 21 test-fixture emails still rendering with a
"Pending" badge on the `/admin/test-accounts` quarantine page even
after the `is_test_account` backfill.  Root cause: legacy fixtures
registered before the auto-accept logic existed, so their
`approval_status` was still `"pending"` even though they were
flagged as test.  The regex filter correctly excluded them from
`/admin/pending-users` (which returned count=0), but the quarantine
page surfaced the stale status badge.

Extended the startup backfill in `server.py` with a second pass:
flip `approval_status="approved"` on every doc where
`is_test_account=True AND approval_status != "approved"`.
Idempotent — only writes when the status doesn't already match.
First run flipped **173 fixtures**.

After this run: 0 users in pending status, 188 test fixtures
approved + isolated, 2 real users (both Jessica).

---

## 2026-06-20 — Test-account filter expansion + auto-backfill ✅

User flagged ~190 leftover agent fixtures still showing as "real" users.
Expanded `utils/test_account_filter.py` to catch every pattern in the
provided screenshot, then added a startup hook that backfills the
`is_test_account=True` flag on every matching legacy user.

**New domain patterns**: `@test.com`, `@test.example`, `@x.com`,
`@e.com`, `@t.com`, `@ft.local`, `@ft.loca` (truncated agent seed).

**New local-part prefixes**: `reg_`, `check_`, `open_user_`, `user_`
(catches `user_a_*`, `user_dk_*`, `user_ft_*`, `user_pull_*`,
`user_test_*`, `user_ui_*`), `iter` (`iter17_`, etc.), `admin-smoke`,
`admin_smoke`.

**Malformed-email catch**: emails without an `@` are now treated as
test (only ever produced by agent seeds where the email field got
set to a raw user_id like `user_ft_a_518edb`).

**Startup backfill**: `server.py` now runs `update_many` at boot to
stamp the flag on every legacy user matching the current patterns.
Idempotent — only touches rows where `is_test_account != True`.
First run wrote 179 + 2 rows; subsequent boots write 0.

**Test fixed**: `test_account_filter.py::test_mongo_filter_has_or_clauses`
updated to accept both positive (`$regex`) and negative
(`$not.$regex`) clauses since malformed emails use the latter.

After the update: 188 fixtures isolated, 2 real users remain
(both Jessica). `/admin/users` shows 2 rows; `/admin/test-accounts`
shows 188.  Global-stats, today-pulse, and landing/stats counters
all correctly reflect real users only.

---

## 2026-06-20 — Migration-complete banner + P2/P3 feature bundle ✅

Nine features shipped together after the orphan-audit work:

**Enhancement — Migration-complete banner + pausable R2-only toggle**
- `utils/storage_cloud.py`: new sync `is_emergent_fallback_paused()` /
  `set_emergent_fallback_paused()` short-circuit Emergent probes in
  both `restore_to_disk` and `remote_exists` when paused.
- `server.py` startup hook hydrates the flag from `db.storage_config`
  (singleton doc) so the setting survives a pod restart.
- New admin endpoint `POST /admin/storage-fallback-pause` (pausable,
  audit-logged). `storage-migration-progress` now returns
  `emergent_fallback_paused`.
- AdminConsole `R2MigrationProgressCard`: celebratory ribbon at 100%
  with "Pause/Resume Emergent fallback" button + status badge.

**P2 — "Finished on device. Want a similar one?" strip**
- New `GET /api/recommendations/similar/{book_id}` — library-local
  matches scored on (fandom × 3) + (author × 2) + unfinished + recency.
- `SimilarBooksStrip.jsx` only renders when `progress_fraction >= 0.95`
  or `finished_at` is set.  3–6 cards with cover, title, match reason.

**P3 batch (5 features)**
- **Reader DNA card** on `/stats`: top 3 fandoms + fanfic-vs-original
  split bar + average word count + "Comfort reads" list of finished
  books re-opened in last 30 days.  One round-trip
  (`GET /api/insights/reader-dna`).
- **Theme shortcut**: `Cmd/Ctrl + Shift + D` toggles light ↔ dark
  globally via `ThemeKeyboardShortcut` mounted in `AppRouter`.
  Skips input/textarea/contenteditable so it doesn't clobber
  paste operations.  Verified flipping `data-theme` attribute.
- **AV rescan nudge banner**: `AvRescanNudgeBanner.jsx` mounted at
  app-level shows when last AV rescan > 90 days OR there are
  unscanned books with no rescan ever. 1-day per-user dismissal
  cool-down via localStorage.
- **Homepage social proof strip**: new `SocialProofStrip` on
  Landing renders 3 large stat tiles (books · readers · fandoms)
  from `/landing/stats`.  Endpoint extended with `readers` count
  AND filtered to exclude test-account fixtures so the public
  counters are honest (3,806 books · 7 readers · 21 fandoms).
- **Deep-link past welcome tour**: `TourMount` detects
  `?from=share` / `?ref=share` query params OR a
  `/read/<book_id>` path and marks tour seen, bypassing the
  overlay for shared reader links.

**Tests**: `test_insights_and_toggles.py` (+6 cases). All 12 new
pytests passing alongside the orphan-audit batch (22 total).

Files touched: `storage_cloud.py`, `server.py`, `routes/admin.py`,
`routes/recommendations.py`, `routes/stats.py`, `App.js`, `Landing.jsx`,
`StatsPage.jsx`, `BookDetail.jsx`, `AdminConsole.jsx`, plus 4 new
components (`SimilarBooksStrip`, `ReaderDnaCard`, `AvRescanNudgeBanner`,
inline `SocialProofStrip` + `ThemeKeyboardShortcut`).

---

## 2026-06-20 — Orphan audit & auto-accept test accounts ✅

Two complementary admin tools shipped together:

**1. Orphan audit & cleanup**
- New `GET /api/admin/orphan-audit` — HEAD-checks every book with a
  stored filename against R2 *and* the Emergent fallback (concurrent,
  20-wide semaphore so the ~3800-book scan completes in ~2s).  Returns
  per-orphan metadata (title, owner, filename, size) so the admin can
  inspect before deleting.
- New `POST /api/admin/orphan-audit/delete-bulk` — re-checks each book
  against storage before removing (so a recovered file is never
  nuked), batches capped at 500, audit-logged.
- New `OrphanCleanupCard` on `/admin` slotted next to the R2 migration
  card — runs the audit, shows a sortable table with per-row
  checkboxes + a "Test" badge for fixture owners, "Delete N selected"
  action with confirm prompt + re-audit on success.
- First run confirmed the 20 orphans from the prior R2 migration —
  19 belong to test fixtures, 1 to a real user.  Cleanup unblocks the
  migration gauge from plateauing at 62%.

**2. Auto-accept agent test accounts**
- `routes/auth.py` (both `/auth/google` and `/auth/register`) now
  detect emails matching `utils.test_account_filter` patterns
  (`@test.local`, `@example.com`, `test_*` / `t_*` / `sync_*`
  prefixes, etc.) and:
  - Skip the approval gate (status set to `approved` immediately).
  - Skip onboarding-question requirements.
  - Stamp `is_test_account=True` + `auto_approved_test=True` on the
    user doc for stat isolation.
- `routes/admin.py` extended to **exclude test accounts** from:
  - `GET /admin/users` (main users list)
  - `GET /admin/global-stats` (user/book/signup/storage rollups)
  - `GET /admin/today-pulse` (24h signups KPI)
  - (Already excluded from `/admin/pending-users` and bulk-approve.)
- Real users still hit the approval gate normally — verified via the
  refreshed `test_approval_gate.py` (switched its fixture domain off
  `@example.com` so the test no longer trips the new fixture filter).
- New `utils/storage_cloud.py` helpers: `_emergent_head_exists()` +
  public `remote_exists(key)` dispatcher used by the orphan audit.

**Tests added: `test_orphan_audit.py` (6 cases)**
- auth gate, audit shape, bulk-delete validation (empty body,
  unknown IDs), test-account auto-approval flag, real-user pending
  preservation.  All passing.

**Tests touched:** `test_approval_gate.py` — switched the fixture
domain to `@real-domain-acme.shop` so the existing gate tests aren't
hijacked by the new auto-approve rule.

Total diff: ~210 LOC added to AdminConsole.jsx, ~250 LOC added to
admin.py, +1 manifest entry, +6 pytest cases.

---

## 2026-06-19 — Proactive R2 backfill + drain ✅

Added admin-triggered backfill endpoint + "Migrate next 25" button on
the R2 Migration Progress card.  Each click processes up to 50 books:
download from Emergent, upload to R2, record stats.  ~17s per chunk
for 25 books.  Idempotent — safe to spam.

**Drained the queue end-to-end this session:**
- Initial state: 0/53 on R2 (0%)
- After 3 backfill chunks: 33/53 on R2 (62%)
- Remaining 20 books: orphaned (Mongo records with no file in
  Emergent either — pre-existing data integrity issue, not
  recoverable via migration).

Migration is now *as complete as it can be*.  Card plateaus at 62%
because of the 20 orphans.  Could add a "show orphaned books" admin
view later, but those records can only be cleaned up by hand or
deleted — they predate today's work.

Backend response shape:
    {processed, migrated, already_on_r2, emergent_missing, failed,
     percent_after, remaining_estimate}

Audit-logged as ``storage.backfill_chunk`` per click so we have a
trail of when chunks ran and how many migrated.

---


## 2026-06-19 — R2 migration progress tile (admin) ✅

New "R2 migration progress" card on the AdminConsole shows a
sample-based gauge of how many books have made it from Emergent
into R2 since the cutover.  Operator's "is it safe to drop the
Emergent fallback?" decision tool.

- Backend: `GET /admin/storage-migration-progress?sample_size=100`
  picks N random books, HEAD-checks each in R2, extrapolates to the
  full collection.  Returns `{total, sampled, sample_hit,
  estimated_migrated, percent}`.  ~50ms per HEAD probe → ~5s for
  100-sample.
- Frontend: progress bar tinted purple → amber → emerald as it
  climbs.  At ≥99% shows a "safe to drop Emergent fallback" hint.
- Hidden when `STORAGE_BACKEND != "r2"` (the endpoint returns
  `enabled: false`).
- Searchable from the AdminConsole search box ("r2", "migration",
  "backfill").

Initial probe on launch: 0/30 hit (all existing 102 books still on
Emergent — lazy migration will tick this up as users access them).

Total this session: **24/24 backend pytest pass.**

---


## 2026-06-19 — Cloudflare R2 cutover ✅

Object storage migrated from Emergent Object Storage to Cloudflare R2.
`STORAGE_BACKEND=r2` flag is now live in `backend/.env`.

**Architecture:**
- `utils/storage_cloud.py` now dispatches by `STORAGE_BACKEND` env var
  - `r2` (current) — boto3 S3 client → Cloudflare R2 bucket `shelfsort`
  - `emergent` (legacy) — original integrations.emergentagent.com path
- All writes go to R2 only
- Reads try R2 first → fall back to Emergent on miss → silently
  re-upload to R2 (lazy migration of existing ~5000 files; users
  trigger the copy by accessing their old books)
- Both `_emergent_*` private functions retained for the fallback path
- Single `r2` client instance cached per-process (boto3 client init
  is ~150 ms)

**Verified:**
- Cred smoke test passed PUT/GET/LIST/DELETE
- Public dispatcher round-trip passed (`mirror_up` → `restore_to_disk`
  → `delete_remote` → confirmed miss after delete)
- 23/23 backend pytest pass (3 new for R2 dispatcher)
- `/api/health` reports `storage: ok` under R2 mode

**What's NOT done (parked):**
- No proactive backfill cron — relying on lazy migration as users
  access old books.  Can add an explicit chunked backfill later if
  we want to free up Emergent storage immediately.
- No live cost telemetry — R2 free tier is 10 GB/mo + 1M class-A ops,
  plenty of headroom for current scale.  Cost gauge in admin UI is
  parked.

To roll back: set `STORAGE_BACKEND=emergent` in `backend/.env` and
restart supervisor.  Files written to R2 since cutover would then
be unreachable until you flip back.

---


## 2026-06-19 — Cloudflare R2 credentials wired ⚙️ (migration pending)

User created a Cloudflare R2 bucket (`shelfsort`) and Account API
token scoped to that bucket only.  Credentials added to
`backend/.env`:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME=shelfsort`
- `R2_ENDPOINT_URL`

End-to-end smoke test passed: PUT + GET + LIST + DELETE all round-trip
cleanly via boto3 (S3 API).  `list_buckets` returns AccessDenied
which is correct — the token is bucket-scoped (least privilege).

**Not yet migrated** — still need:
- `R2StorageBackend` adapter in `utils/storage_cloud.py`
- `STORAGE_BACKEND` feature flag (`emergent | r2 | dual`)
- Background backfill cron to copy existing files Emergent → R2
- Cutover once backfill ≥ 99% done

Parked for next session — meaty enough to warrant a fresh context
window for careful implementation + testing.

User should rotate the secret key (currently exposed in this chat).

---


## 2026-06-19 — BookDetail cross-device hint ✅

Small purple lavender pill above the "Read now" button on
`/book/{id}`, showing:

  📱  Last read on your iPhone · 42% · 2h ago

Closes the cross-device awareness loop — readers now see their
furthest position **before** they tap Read (no more surprise jump
from the Reader's handoff ribbon).

- Backend: `GET /books/{id}` now also attaches `last_device_id`,
  `last_device_label`, `last_cursor_updated_at`, and an optional
  `last_cursor_percent` (only filled when `progress_fraction` is
  missing).  Same shape as `/books/recent` — one Mongo round trip
  to `reading_cursors`.
- Frontend: BookDetail.jsx renders the pill only when
  `last_device_id` differs from the local
  `shelfsort-device-id` AND the cursor is fresh (< 14 d).
  lucide-react glyph adapts (Smartphone / Tablet / Laptop /
  MonitorSmartphone).

Pytest in `test_cursor_fallback::test_get_book_includes_cross_device_fields`
locks the payload contract (15/15 backend tests pass).

---


## 2026-06-19 — Reader "Furthest read position" ribbon ✅

Persistent dismissible ribbon at the top-right of the Reader.  Shows
when the cloud cursor was last written on a different device than
the current one (within 14 days):

  📖  You were 42% through this on your iPhone · 2h ago
      Jump there →                                  ×

- Replaces the previous toast (which auto-vanished after 12s) with
  a persistent banner — feels more like Kindle's "Furthest read"
  indicator on the device-switch screen.
- Two actions: "Jump there →" (calls `rendition.display(cfi)` then
  dismisses) and "×" (dismisses without jumping).
- Dismissals are remembered per (book, cfi) in localStorage so
  reopening doesn't nag — but a *fresher* cursor (new cfi) on the
  cloud will re-show the ribbon, which is what you want.
- Data flow already wired by the cross-device caption work earlier
  today (`/books/{id}/cursor` already returns device_id +
  device_label + updated_at).

Pytest in `tests/test_cursor_fallback.py::test_books_recent_includes_cross_device_fields`
locks down the backend payload contract (14/14 backend tests pass).

---


## 2026-06-19 — Cross-device caption on Continue Reading rail ✅

Tiny "📱 Continued on your iPhone · 2h ago" line under each card on
the Continue Reading rail.  Only renders when the *latest* cursor for
that book came from a **different device** than the one currently
viewing the dashboard — so it's a surprise reveal, not constant
footer chrome.  Reuses the existing `device_id` / `device_label`
already tracked by `db.reading_cursors`.

- Backend: `/books/recent` now also side-fetches the latest cursor
  per book in a single Mongo round trip and attaches
  `last_device_id` + `last_device_label` + `last_cursor_updated_at`.
- Frontend: `ContinueReadingRail.jsx` reads `shelfsort-device-id`
  from localStorage, compares to each book's `last_device_id`,
  renders the caption + lucide-react glyph (iPhone/iPad/Android/Mac/
  Windows) when they differ.  Hidden if either ID is missing.
- Test ID: `continue-card-cross-device-{book_id}` for QA.

---


## 2026-06-19 — Cross-device last-read cursor hydration ✅

Reader.jsx now falls back to the **cloud cursor**
(`GET /books/{id}/cursor`) when localStorage is empty for that book.
Previously, opening a book on a fresh device (or after clearing cache)
started at chapter 1 even though the backend already knew the user's
last position — the only path to the cloud cursor was via the "Resume
there" toast, which itself was gated to a 6-hour freshness window.

Two changes:
- localStorage useEffect now (when `shelfsort-loc-{bookId}` is empty)
  awaits `GET /books/{id}/cursor` and uses its `cfi` as the initial
  position.  If the rendition has already painted chapter 1 by the
  time the cloud response arrives, we jump immediately — ~200-300 ms
  perceived "thinking" load.
- Cross-device toast freshness window bumped from 6 hours → 14 days
  so a user returning after a few days still sees the resume prompt.

Bookmarks themselves are already cloud-synced via
`POST /books/{id}/bookmarks` and reloaded from
`GET /books/{id}/bookmarks` on mount — no change needed there.

Pytest in `/app/backend/tests/test_cursor_fallback.py` verifies the
underlying contract: 404 → silent fallback, 200 + cfi → round-trip.

### Also confirmed (no shipped change):
- **Fixture auto-purge cron** triggered manually via Python — 93
  stale fixtures correctly purged, fresh ones (< 7d) preserved, real
  user with a 10d account preserved.  Production schedule (daily
  03:00 UTC) confirmed working.

### Reminder filed:
- **Tighten DMARC** on or after 2026-07-03 (added to ROADMAP.md
  with the exact 4-step IONOS walkthrough).  No app changes — just a
  DNS edit to bump `p=none;` → `p=quarantine;`.

---


## 2026-06-19 — Five-in-one hardening batch ✅

### 1. Bulk-approve rate-limit throttle
Resend free plan caps at 5 req/sec.  `asyncio.gather` was slamming
that limit and ~80 % of approval emails were coming back "Too many
requests" during the live bulk test.  Replaced with a sequential
loop + 250 ms sleep between sends → max 4 req/sec (safe margin).
A 20-user batch now returns in ~5 s instead of 1 s but every email
actually delivers.

### 2. Reader prefs cross-device sync
New `routes/reader_prefs.py` (`GET` + `PATCH` `/api/account/reader-prefs`)
mirrors the in-Reader theme + font picks to a `reader_prefs` sub-doc
on the user.  Reader.jsx hydrates from the API on mount (with
localStorage as the fast-path default), and PATCHes back on change
with a 600 ms debounce.  Whitelisted theme/font values reject junk
at the boundary.  Pytest coverage: 5/5 pass.

### 3. cursor_history TTL index
`db.cursor_history.create_index("created_at", expireAfterSeconds=180d)`
on startup.  Mongo auto-purges old reading-progress events so the
collection doesn't grow unboundedly.  Idempotent.

### 4. Fixture auto-purge cron
Daily 03:00 UTC: deletes every test-account fixture older than 7 d
(reuses `utils.test_account_filter`) along with their books and
sessions.  Operator no longer needs to click "Purge all" on
`/admin/test-accounts` manually.  Hooked into the existing
APScheduler instance via `digest._scheduler`.

### 5. "Clear pre-cutover failures" admin button
New `POST /api/admin/email-logs/clear-pre-cutover-failures` deletes
errored rows older than `RESEND_DOMAIN_VERIFIED_AT`
(`2026-06-19T14:30:00Z`).  Tidies the EmailStatsCard horror story
without losing real post-cutover telemetry.  Discoverable via a tiny
"Clear pre-cutover ↺" link inside the Recent Failures section.
Admin-only, audit-logged.  Already cleared **17 stale rows** on
first run.

Total backend pytest: 16/16 pass.

---


## 2026-06-19 — Resend plan-usage gauge on EmailStatsCard ✅

Added two-bar quota gauge inside the existing Admin "Resend
deliveries · this week" card:

  RESEND PLAN USAGE
  Today    [▌▌▌▌▌▌            ]   18 / 100   (18%)
  Month    [▌▌                ]  142 / 3,000  (5%)

- Backend: `/admin/email-stats` response now includes a `quota`
  block (`used_today`, `used_month`, `daily_limit`, `monthly_limit`,
  `daily_remaining`, `monthly_remaining`).  Limits are env-driven
  (`RESEND_DAILY_LIMIT` / `RESEND_MONTHLY_LIMIT`, defaults
  `100`/`3000` for Resend's free plan).
- "Used" counts `email_logs` rows with `status == "ok"` in the
  rolling 24h / 30d window (failed sends don't draw down Resend's
  real quota either).
- Bar tint flips amber at ≥ 75 %, red at ≥ 90 %, with an inline
  "Upgrade plan →" link appearing at red that opens
  `resend.com/settings/billing`.

---


## 2026-06-19 — Resend domain verified, real email cutover ✅

`shelfsort.com` is verified at Resend (DKIM + SPF + MX all green
in us-east-1).  Sender flipped from the sandbox
`onboarding@resend.dev` to **`Shelfsort <hello@shelfsort.com>`**.

DNS records live at IONOS:
- `MX send` → `feedback-smtp.us-east-1.amazonses.com` (pri 10)
- `TXT send` → `v=spf1 include:amazonses.com ~all`
- `TXT resend._domainkey` → DKIM public key
- `TXT _dmarc` → `v=DMARC1; p=none;` (optional, monitoring only)

`backend/.env` updated.  Test email accepted by Resend
(message id `59b71cf0-2b70-46b2-afcf-be2b519c7169`).

This unblocks:
- Per-user approval emails on real (non-owner) addresses
- Bulk approve / approve-bulk emails
- All future transactional email (password reset, welcome, etc.)

Existing IONOS mailbox `jessica@shelfsort.com` untouched — root MX
unchanged, so receiving still flows through IONOS Mail.

---


## 2026-06-19 — Click-to-approve from campaign funnel ✅

The Campaign Conversion table now has a new "Pending" column.
Whenever a row has ≥ 1 pending sign-up, the count renders as an
amber action pill `2 ›` instead of a static number.

Clicking the pill:
1. Fires a `shelfsort:bulk-approve-ref` `CustomEvent` on `window`.
2. The Pending Sign-ups card (in a *different* collapsible section)
   listens, scrolls itself into view, then calls `bulkApprove(ref)`
   exactly as if the operator had clicked the matching campaign chip.
3. Same confirm dialog, same approval emails, same audit-log entry.

So the post-launch flow is now:
   *post tracked link → check Campaign card → click `2 ›` → confirm → done*

Decoupled via CustomEvent so neither card has to import the other.

Backend: added a `pending` count to each `/admin/campaign-stats` row
(same aggregation pass — `$cond` on `approval_status == "pending"`).
Pytest assertion bumped to verify the new field (3/3 still pass).

---


## 2026-06-19 — Campaign conversion funnel ✅

New widget on the AdminConsole (right under Tracked Invite Links)
that turns "I posted on Reddit" into measurable signal.  For every
tracked `onboarding.referral` value, shows the full funnel:

  Channel        Signups    Approved     Uploaded     Active 7d
  Facebook       12         8 (66%)      5 (41%)      3 (25%)
  Reddit         4          4 (100%)     4 (100%)     2 (50%)
  Organic/direct 56         50 (89%)     28 (50%)     14 (25%)

- New `GET /api/admin/campaign-stats` does it in two Mongo round-trips:
  one aggregate-pipeline grouped by `onboarding.referral` with counters
  for signups/approved/active_7d, plus one `db.books.distinct("user_id")`
  to compute the uploader intersection.
- Excludes test-account fixtures (real users only).
- Sorted by signups desc, with the unlabeled "Organic / direct" row
  italicized as the baseline.
- "Active 7d" = `last_login_at >= now-7d` (already tracked by auth.py).
- Channel labels prettified: `hpfanfic` → `r/HPfanfiction`, etc.

Pytest coverage in `/app/backend/tests/test_campaign_stats.py` (3/3 pass —
funnel math, test-account exclusion, organic baseline).

---


## 2026-06-19 — Bulk-approve pending sign-ups (with campaign filter) ✅

Operator can now triage a launch-traffic surge in one click instead
of N approves.  Two new admin entrypoints on the Pending Sign-ups
card:

- **"Approve all (N)"** — green pill, primary action.  Approves
  every real pending user, fires their approval emails in parallel,
  and writes a single bulk-audit-log row (instead of N noisy ones).
- **Per-campaign chips** — auto-derived from
  `onboarding.referral`, only shown for channels with ≥ 2 pending
  sign-ups.  Click "Facebook (3)" to approve everyone who arrived
  via `?ref=facebook` (the tracked invite link from `InviteLinksWidget`).

Backend:
- `GET /api/admin/pending-users` now includes `onboarding` so the
  client can group by campaign.
- New `POST /api/admin/pending-users/approve-bulk` with optional
  `{"ref": "facebook"}` body.  Excludes test-account fixtures, is
  idempotent on re-runs (returns `approved: 0`), and runs approval
  emails through `asyncio.gather` so a 20-user batch still returns
  in well under 5s.

Frontend:
- Toolbar only renders when ≥ 2 pending users (so single-row inboxes
  don't get cluttered).
- Each chip shows a spinner during its own bulk call; other chips
  stay disabled until done.

Pytest coverage in `/app/backend/tests/test_bulk_approve.py` (3/3
pass — by-ref filter, no-ref filter, idempotency).

Live end-to-end smoke verified with seeded fixtures: 4 facebook + 2
reddit + 1 solo → "Facebook (3)" approved 4 → remaining 3 → "Approve
all" approved 3 → inbox empty.

---


## 2026-06-19 — Three small polishes ✅

**1. Username placeholder.** Signup form (`Login.jsx`) and Account
settings (`Account.jsx`) now suggest `bookworm42` instead of
`PageDragon` / `ImCrazy`.

**2. Dark-mode contrast on the "Polish your library?" banner.**
The cream `#FDF3E1` OnboardingPrompt card was illegible in dark
mode — body text rendered as nearly-invisible `#D9C49A` on a
near-black background.  Override in `index.css` was rewritten:
background opacity bumped (`rgba(255,200,145,0.14)`), body text
brightened from `#D9C49A` → `#F5E0AE`, title from `#F8E8C5` →
`#FBEACB`.  Verified on /library?theme=dark — banner is now crisp
and fully readable in both themes.

**3. Test-account quarantine.** Testing-agent fixtures (`@test.local`,
`@example.com`, prefixes `test_`/`sync_`/`linkless_`/`t_`/`qa_`)
were flooding the real `/admin` Pending sign-ups inbox (21 fake
rows for an admin staring at "(21)").  New
`backend/utils/test_account_filter.py` is the single source of
truth for the pattern.  Wired into:
- `GET /api/admin/pending-users` — excludes fixtures from main inbox
- `GET /api/admin/test-accounts` — new endpoint, returns ONLY fixtures
- `POST /api/admin/test-accounts/purge` — admin-only hard delete
  (users + their books + sessions, idempotent)
- `pending_count` aggregator (operator digest KPI) — matches the inbox

New admin page at `/admin/test-accounts` (admin-route gated) with a
"Purge all" red button + per-row status pill (pending/approved/rejected).
Discoverable via a "View test accounts →" link inside the Pending
sign-ups card on `/admin`.

Real-world impact: tester's admin inbox dropped from 21 → 0 pending
sign-ups instantly.  262 fixtures now live on the separate page.

Pytest coverage in `/app/backend/tests/test_account_filter.py`
(5/5 pass).

---


## 2026-06-19 — Antivirus shield badges + Kindle-style reader skins ✅

**🛡️ Antivirus visibility.** New `AntivirusBadge.jsx` component
renders in two variants:
- `variant="corner"` — small shield pip on every `BookCard` cover
  (green emerald = clean, red = infected). Idle opacity 70%, full on
  hover. Native `title` tooltip shows the scan date.
- `variant="row"` — full pill row inside the BookDetail metadata
  grid: "Scanned clean • Jun 19, 2026" or "Flagged: <signature>".

Backend now also stores `av_scanned_at` (ISO8601 with `timezone.utc`)
alongside every `av_status` mutation in `account_safety.py` and
`books.py` so the badge tooltip has a real timestamp.

**🌙 Reader appearance panel (Kindle-style).** New `ReaderThemePanel.jsx`
slide-in panel (right edge of reader). Six themes split across day/night:
- Light: Cream (default), White, Sage
- Dark: Midnight, Sepia Night, OLED Black

Four font families: Sans (Manrope), Serif (Lora), Classic (Cormorant
Garamond), Readable (Atkinson Hyperlegible).

Selection persists to `localStorage` (`shelfsort-reader-theme`,
`shelfsort-reader-font`) and applies via epubjs's `themes.register`
helper. The outer reader chrome (header + wrap background) recolours
to match the active skin so dark themes don't leak the cream chrome.
Lora and Atkinson Hyperlegible added to the Google Fonts import in
`public/index.html`.

Backend tests pass (5/5, `/app/backend/tests/test_av_fields.py`).
Frontend smoke-test: library grid shows green/red pips on 2/1 seeded
books, BookDetail rows render correctly.

---


## 2026-06-19 — Deploy unblock: removed `.env` ignore rules ✅

Deployer Agent flagged that `/app/.gitignore` lines 138-140 were
ignoring `.env`, `.env.*`, and `*.env`, contradicting the comment
at line 121 ("intentionally committed: Emergent overrides values
at deploy time"). Removed the three offending lines so
`backend/.env` and `frontend/.env` are tracked again.

Verified with `git check-ignore -v backend/.env frontend/.env`
(no matches) and re-ran `deployment_agent` → **PASS**.
`/api/health` confirms Mongo, Scheduler (7 jobs), Storage, and
Antivirus all green.

---


## 2026-06-18 — `?theme=dark` / `?theme=light` URL override ✅

Added a one-shot theme override in `ThemeContext.jsx`.  Any URL
with `?theme=dark` or `?theme=light` forces that theme for the
current page load only — closing the tab restores the saved
preference.  Useful for spot-checking pages in both modes without
flipping the OS appearance.

Works on every route: `/?theme=dark`, `/admin?theme=dark`,
`/account/safety?theme=dark`, `/help?theme=light`, etc.

---


## 2026-06-18 — Dark-mode text overrides for cream cards ✅

The "Polish your library?" OnboardingPrompt and any other `bg-[#FDF3E1]`
(cream) card was unreadable in dark mode — background remapped to
dark brown via the existing override (line 514), but the dark text
colors stayed dark → dark-on-dark.

Added two text overrides in index.css:
  - `text-[#2C2C2C]` / `text-[#3F4034]` inside cream cards → `#F8E8C5`
  - `text-[#6B705C]` inside cream cards → `#D9C49A`

Also added a dark-mode escape hatch to the earlier contrast-sweep
rule so the light-mode `#3F4034` override doesn't beat the new
per-card text colors in dark mode.

Affects: OnboardingPrompt ("Polish your library?"), any backup
reminder ribbon, suggestion-banner-style ribbons, anything using
the cream surface.

---


## 2026-06-18 — App-wide contrast sweep ✅

The faded body text the user spotted on the Sign-up rules card was
a symptom of a broader pattern: `text-[#6B705C]` (medium olive) on
pastel card backgrounds (`#EDE6FA`, `#E8F3EC`, `#FDF3E1`, `#FDECE6`,
`#FBE9E5`, `#F5F0E0`) only hits ~3.5:1 contrast — fails WCAG AA.

Rather than touching every JSX file, added a single CSS attribute-
selector rule in `index.css` that bumps any `text-[#6B705C]` text
nested inside a known colored card background to `#3F4034`
(luminance ~0.14 = 5.5:1 against `#EDE6FA`, passes WCAG AA).

Effect: every card across the app — new AccountSafety, Antivirus,
SignupRules, Help, AdminConsole, and any older pages I didn't
touch — now renders body text with proper contrast.

Also applied targeted text-color upgrades to the `SafetyStat`
component (`palette.muted: "#3F4034"`) so the percentage strip
under each big number is now readable on the colored stat tiles.

---


## 2026-06-18 — Chat KeyError + admin contrast fix ✅

**Bug 1 — Chat rooms 500 in production**:
`_serialize_room` crashed with `KeyError: 'name'` on a legacy seed
room that pre-dates the required-name validation, breaking the
`/chat/rooms` list for everyone.  Hardened the serializer to fall
back to `"(untitled room)"` instead of 500-ing.  Endpoint now
returns 200 with all 8 rooms.

**Bug 2 — Low-contrast text in admin signup card**:
Hard-coded `text-[#6B705C]` (medium gray) body copy on the pale
`bg-[#EDE6FA]` toggle backgrounds + `bg-[#FBFAF6]` stat panels was
too washed-out to read.  Bumped body text to `text-[#3F4034]`
(darker olive) and added `dark:` variants to every colored
background and text utility so the cards work in both light AND
dark mode going forward.

---


## 2026-06-18 — Tracked invite links + Facebook channel ✅

- **`?ref=<channel>` query param** on the landing/login URL now
  auto-flips the form into register mode and pre-fills the
  onboarding "How did you find Shelfsort?" answer.  Works on any
  arbitrary tag (e.g. `?ref=hpfanfic` for Reddit r/HPfanfiction);
  known channels (google, twitter, reddit, **facebook**, tiktok,
  friend) highlight the matching radio.
- **Facebook** added to the onboarding-questions radio list.
- **Backend** persists the referral even when onboarding questions
  are disabled — `?ref=facebook` still records attribution silently
  so admins can run launch campaigns without first flipping the
  questions toggle on.
- **AdminConsole "Tracked invite links" widget** in the Sign-up
  rules card.  9 ready-to-copy URLs (Facebook, Twitter/X, Reddit
  generic, r/HPfanfiction, r/FanFiction, TikTok, Bookstagram,
  Discord, Newsletter) each with its own COPY button + toast
  confirmation.  Admins can mint custom tags by editing the URL.

End-to-end verified:
- `POST /api/auth/register` with `{onboarding:{referral:"facebook"}}` → user created, attribution captured
- `POST /api/auth/register` with `{onboarding:{referral:"hpfanfic"}}` → custom tag persisted
- Both surface in `/api/admin/onboarding-stats` under their respective channel labels

---


## 2026-06-18 — Suppression reasons in alert-health banner ✅

Made the admin's "Cron failures going un-alerted" banner self-
explanatory.  Operators no longer need to dig through logs to find
out *why* alerts aren't going out.

- `GET /api/admin/alert-health` now returns `suppressed_reasons`:
  an array of `{reason, count}` aggregated from the new
  `suppressed=True` rows in `cron_alerts` (last 24h).
- Frontend banner gained a third state — "Cron alert pipeline
  suppressed" — that fires when there are zero failures but
  alerts are still being suppressed (Resend down, no admin
  emails, etc.).  Each reason is shown with a one-line fix hint
  matched to the reason code (`SUPPRESSION_FIX_HINT` map).
- Pre-existing two states ("alerts misfiring" / "going un-alerted")
  preserved; new strip stacks under them when both are present.
- E2E verified: inserting two suppressed rows correctly renders
  "Alerts suppressed: Resend not configured (1) · No admins with
  email (1) · Set RESEND_API_KEY and SENDER_EMAIL in backend/.env,
  then restart the backend."

---


## 2026-06-18 — Cron-alert silent-drop fix ✅

The admin banner "Cron failures going un-alerted" was correctly
flagging a real gap: when `_maybe_alert_admins` suppressed an alert
(feature flag off, no admin emails, Resend not configured, debounce),
no row was ever written to `cron_alerts`, so `/admin/alert-health`
kept reporting the same failure as "uncovered" forever.

Two fixes:

1. **`utils/cron_health.py`**: every suppression path now upserts a
   `cron_alerts` row with `suppressed=True` + a `reason` string
   (`feature_flag_off` · `no_admin_recipients` · `resend_not_configured`
   · `admin_lookup_failed`).  This means the banner correctly clears
   once the alerter has *acknowledged* the failure (even if no email
   went out).

2. **`routes/admin.py /admin/alert-health`**: now excludes pytest
   fixtures (`job_id` matching `^test_job_`) from the uncovered list.
   The `test_job_err_ee3c54` row that triggered the user's banner was
   left over by `test_cron_health.py` after a test run.

New regression test `tests/test_cron_alert_suppression.py` (3 cases,
all passing) pins:
- Suppression row written when there are no admin recipients
- Suppression row written when Resend env vars are blank
- Pytest fixtures filtered from the prod-facing endpoint

Existing `test_alert_health.py` (5 cases) still passes.
Live endpoint now returns `cron_failures_uncovered_24h: 0`.

---


## 2026-06-18 — Landing page polish + Help-page docs ✅

- **Hero copy** tightened with the "Downloads folder full of
  nameless EPUBs" hook so first-time visitors immediately see
  themselves in the problem.
- **Trust strip** added under the CTA — four icon + ~3-word
  claims (AI auto-sorts by fandom · Every upload virus-scanned ·
  Sync across devices · Free while we grow).  Each backed by a
  feature actually shipped this session.
- **Help page** now has two new sections — "Antivirus & library
  safety" and "Community rules" — plus an updated What's-New
  banner featuring the antivirus + rules launches.

---


## 2026-06-18 — Library safety report ✅

- New `GET /api/account/safety` returns user's own scan stats
  (clean / infected / unscanned counts + recent flagged list).
- New `POST /api/account/safety/rescan` re-runs ClamAV across the
  user's whole library (walks `db.books`, pulls from cloud storage
  if local cache is cold).  Capped at 500 files per call.
- New `/account/safety` page rendered with stat cards, AV-down
  banner, recent-flags list, and "Rescan now" CTA.  Linked from
  the Account page next to the backup buttons.
- Testing agent iter 30: **7/7 PASS** (+ fixed flagged UX gap
  where cloud-only files weren't rescanned).

---


## 2026-06-18 — `/api/health` + ClamAV antivirus integration ✅

### Health endpoint
- New public `GET /api/health` returns JSON with status of Mongo,
  scheduler (job IDs + count), Emergent Object Storage, and ClamAV.
  Always 200 OK; the `status` field is `ok` / `degraded` / `down` for
  uptime monitors to branch on.

### Antivirus
- **ClamAV in-pod** via `clamd` daemon (~10-50 ms per scan vs ~7s
  cold-start CLI).  3.6M+ signatures auto-downloaded by `freshclam`.
- **Self-heal**: backend startup hook installs ClamAV + downloads
  signatures + starts `clamd` if missing.  Idempotent — no-ops once
  healthy.  Mirrors the existing Calibre self-heal pattern.
- **Sync scan + reject** on:
  - `POST /api/books/upload` (single + bulk)
  - `POST /api/books/{book_id}/upload-new-version`
  - `POST /api/feedback` (photo attachments)
  - `POST /api/library/restore/preview` + `/library/restore/apply`
- **Lazy JIT scan** on `GET /api/books/{book_id}/download` (catches
  the "old file, new signature" case after a ClamAV sig DB update).
  Result cached on the book doc as `av_status: clean | infected`.
- **Quarantine log**: every flag persists to `av_quarantine` with
  user, signature, source, filename, timestamp, elapsed_ms.
- **Admin UI**: new `AntivirusCard` in AdminConsole with EICAR
  liveness banner, source filter, and quarantine list.
- **Admin endpoints**: `GET /api/admin/antivirus/status` (live EICAR
  probe + counters) and `GET /api/admin/antivirus/quarantine?source=…`.
- **Fail-open** policy: if ClamAV is unavailable, uploads succeed but
  the AdminConsole banner turns red so it's spot-fixable.

End-to-end verified:
- EICAR-as-EPUB → HTTP 400 with `"<file>" appears unsafe (Eicar-Test-Signature). Upload blocked.`
- EICAR-as-feedback-photo → HTTP 400 with `photo_unsafe`
- Both events landed in `av_quarantine` with correct metadata
- AdminConsole Antivirus card renders correctly with HEALTHY banner

---


## 2026-06-18 — Pre-deploy bug cleanup ✅

Three pre-existing minor issues fixed before deploy:

1. **`/api/suggestions` `KeyError: 'suggestion_id'`** — the legacy
   product-board endpoint now scopes its query to
   `{suggestion_id: {$exists: true}}` so the shared `suggestions`
   collection's newer Help-page feedback rows (different schema)
   don't crash the serializer. Endpoint returns 200 with 3 entries.

2. **Button-nested-in-button hydration warning** in `AccountDropdown.jsx`
   — the `<button data-testid="backup-fresh-badge">` lived inside
   the outer navbar-account button. Converted the inner to a
   `<span role="button" tabIndex={0}>` with onKeyDown handler so
   it stays keyboard-accessible without nesting interactive elements.
   Console verified zero button-in-button warnings post-fix.
   (Also fixed unrelated `HelpCircle` missing import in the same file.)

3. **APScheduler "Cannot use MongoClient after close"** — added
   `stop_digest_scheduler()` to `routes/digest.py` and wired it
   into `server.py`'s shutdown handler so the scheduler stops
   BEFORE the Mongo client closes. Two test restarts produced
   zero new MongoClient-after-close errors.

All deployment-readiness checks green.

---


## 2026-06-18 — Admin sign-up controls + community rules ✅

Three new admin-controllable knobs for new-user onboarding:

- **Approval gate toggle** (`approval_gate_enabled`): when OFF, new
  accounts skip the pending queue and land in the library
  immediately. When ON (default), existing behavior — admin reviews
  every sign-up.
- **Onboarding questions toggle** (`questions_enabled`): when ON,
  the register form gates on four questions (referral source,
  favorite fanfic fandom, reader type, 13+ confirmation) and a
  community-rules acceptance checkbox. Admin can turn this off at
  any time without affecting already-signed-up users' answers.
- **Editable community rules** (`rules_md`): markdown surfaced on a
  new public `/rules` page and linked from the register checkbox.
  Default rules drafted: no spam · no politics · no hate speech /
  bullying · no piracy promotion · respect IP · be kind.

Implementation:

- New backend file `/app/backend/routes/signup_config.py`:
  - `GET /api/signup/config` (public — drives the register form)
  - `GET /api/rules` (public — drives the /rules page)
  - `GET /api/admin/signup-config` · `PUT /api/admin/signup-config`
  - `GET /api/admin/onboarding-stats` (referral · reader_type ·
    favorite_fandoms top-15 · age_13_plus / under_13 counts)
- `/api/auth/register` now reads the config and:
  - Auto-approves new accounts when the gate is OFF.
  - Enforces accepted_rules + at least one onboarding answer when
    questions are ON. Under-13 sign-ups return 403.
- New `/app/frontend/src/pages/Rules.jsx` — public markdown
  renderer with a tiny inline parser (#, ##, paragraphs).
- New `<Route path="/rules">` in App.js.
- `Login.jsx` register flow is now multi-step when questions are
  enabled (email/pw → onboarding questions + rules accept).
- New `SignupRulesCard` in `AdminConsole.jsx` with both toggles,
  inline aggregated-answer stats, and a rules markdown editor.

Testing agent iter 29: **13/13 backend endpoint tests PASS**, public
`/rules` page + register multi-step flow verified end-to-end via
Playwright. Admin card visually confirmed via self-test screenshot.

---


## 2026-06-18 — Help-page feedback: admin aggregation widget ✅

Completed the user's last request from iter-26: the new Help-page
SuggestionBox (photo upload + free-text) now has a matching admin
console widget so per-page friction is visible at a glance.

- New `HelpFeedbackCard` in `/app/frontend/src/pages/AdminConsole.jsx`
  with per-page aggregation (`/admin/feedback/by-page`), status
  filter (open / all), drill-down list (`/admin/feedback?page=…`),
  inline photo thumbnails, and full data-testid coverage.
- Backend: `/api/feedback` now correctly returns HTTP 413 for
  `photo_too_large` and HTTP 400 for `not_an_image` (was previously
  200 + `{ok:false}` which the client treated as success).
- Backend: `/api/admin/feedback` + `/api/admin/feedback/by-page`
  scope queries to `{text: {$exists, $ne: null}}` so the shared
  `suggestions` collection's older `/api/suggestions` rows (with
  `title`/`body`/`category` schema) don't leak into the new widget
  and crash it on `r.text.length`.
- Frontend SuggestionBox now reads `err.response.data.detail` and
  surfaces reason-specific toasts ("Image is larger than 5 MB",
  "That file isn't an image").
- Help.jsx Lightbulb import was missing (added during testing-agent
  iter 27) — `/help` route no longer 500s on first render.
- Testing agent iter 28: ALL 5 verification items PASS.

---


## 2026-06-18 — Auto-backfill on backend startup ✅

The "did I remember to click backfill before deploying?" worry is
gone — every backend boot now triggers an initial backfill 15s
after startup (fire-and-forget so it doesn't block traffic).
Combined with the 10-min cron tick, the cloud mirror is now
fully self-driving.

- Empty-pod startups: instant no-op (nothing to mirror).
- Pods with existing files (preview, post-redeploy): drain at
  5 000 files/tick until everything is mirrored.
- APScheduler `coalesce` correctly skips overlapping ticks while a
  drain is in progress — no duplicate work.
- First validated run: 4,999/5,000 files uploaded cleanly on the
  preview pod's ~27k-file backlog.

---

## 2026-06-18 — Backup-fresh navbar badge + tap-to-act popover ✅

Avatar badge now opens a popover on click:
- "Backed up N min ago" timestamp
- "X files safe in cloud storage" count from saved stats
- "Back up again →" button that re-runs the per-user backfill and
  toasts the result
Reuses the existing endpoints — no backend changes.

---

## 2026-06-18 — "Back up my library" one-click for users ✅

Turns the invisible cloud-mirror into a visible trust signal.

- **`POST /api/account/backup-library`** — per-user backfill. Reuses
  `backfill_storage_dir(STORAGE_DIR, user_id_filter=user.user_id)`
  so a single click mirrors the caller's EPUBs + covers in one
  call.  Saves `last_run_at` + `stats` on the user doc so the UI
  can show "Last backup: 12 min ago".
- **`GET /api/account/backup-library`** — returns the saved state
  for the Account page card on every mount.
- **`CloudBackupCard`** on `/account` — green "Back up my library
  now" button + "Last backup: NN ago · X files checked · Y newly
  mirrored" status line.  Hides cleanly when object storage is
  disabled (no scary "not configured" warnings for users).
- Two new tests in `test_storage_cloud.py` lock the `user_id_filter`
  behaviour (8/8 storage tests green).

---

## 2026-06-18 — Object storage migration (Phase A: Emergent backend) ✅

Shelfsort EPUBs + covers are now mirrored to durable Emergent Object
Storage so they survive container redeploys.  No upload-flow changes
required — additive only.

- **`utils/storage_cloud.py`** — provider-agnostic adapter wrapping
  Emergent Object Storage.  Late-bound key read (works after
  `load_dotenv`), session-scoped storage key with auto-refresh on
  403, idempotent uploads (409 = "already mirrored" treated as
  success).
- **`routes/storage_admin.py`** — new admin endpoints:
  * `POST /api/admin/storage/backfill` — admin-triggered manual
    upload-everything (capped at 2 000 files per call, repeat to
    drain larger libraries).
  * `GET /api/admin/storage/status` — last backfill counters
    (scanned / uploaded / skipped / errors / ts).
- **10-min cron tick** (`storage_backfill_tick`) registered in
  `digest._setup_scheduler` — walks `STORAGE_DIR`, mirrors any
  unmirrored file.  New uploads become durable within 10 min
  without modifying the 20+ existing FS-write sites in `books.py`.
- **Read-fallback restore** wired into `GET /api/books/{id}/cover`
  and `GET /api/books/{id}/download` — when the local cache is
  missing (post-redeploy), the bytes are pulled back from the
  cloud and re-cached on the container disk.  Transparent to the
  client.
- **Validated against the live API** — backfill drained 200/200
  files cleanly, round-trip upload+restore preserves bytes, full
  test_storage_cloud.py suite (7 tests) green.

Phase B (Cloudflare R2) is now a single-file change — swap
`utils/storage_cloud.py` for an `S3`/`boto3` backend pointing at
R2.  Every caller (admin endpoints, cron tick, read fallback)
stays unchanged.  See ROADMAP.md for the trigger.

---

## 2026-06-18 — Classifier snapshot regression ✅

A 29-fixture snapshot test now guards every keyword-bank + classifier
edit against silent drift.

- **`tests/test_classifier_snapshot.py`** — runs every fixture
  through ``classify_by_metadata`` and diffs against
  ``tests/snapshots/classifier_snapshot.json``.  Covers each major
  fandom in ``FANDOM_KEYWORDS`` (HP, Twilight, Marvel, DC, Star
  Wars, LOTR, Sherlock + every Riordanverse sub-fandom +
  Shadowhunters sub-series), plus an HP×Marvel crossover, a
  generic AO3 fanfic, original-fiction novels, every non-fiction
  branch (memoir/cookbook/biography/history/self-help), and
  Unclassified edge cases.
- **Self-bootstrapping**: first run writes the snapshot and passes.
  Any later drift fails loudly with a per-fixture diff.  Run with
  `SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT=1` to intentionally
  refresh after a deliberate change (Claude prompt tweak, new
  fandom bucket, etc.).
- Catches the silent "I tweaked the prompt and now every Marvel
  fic is classified as DC" class of bug that would otherwise only
  surface in production via mis-shelved uploads.

---

## 2026-06-18 — Phase 6 continued: metadata + classifier extracted ✅

Two more shim-pattern splits, each reducing ``books.py`` without
breaking any caller:

- **`utils/epub_metadata.py`** (~430 LOC) — moved
  `extract_epub_metadata`, `update_epub_metadata`, `_canonicalize_relationship`,
  `_canonicalize_fandom`, `_suggest_fandom_merges`, `detect_series_from_title`,
  `extract_urls_from_epub`, `format_links_txt`, and `_clean_author_string`
  out of `routes/books.py`.  Plus the constants
  `NONFICTION_SIGNALS`, `SERIES_TITLE_PATTERNS`, `_FANDOM_SPLIT_RE`.
  Zero call-site changes — every consumer (tags route, fandoms route,
  exports, refresh helper, upload pipeline) reaches through the
  re-export shim in `routes/books.py`.
- **`utils/classifier.py`** (~135 LOC) — moved `classify_by_metadata`,
  `classify_with_ai`, and `classify_book`.  Uses a late-bound
  `_get_fandom_keywords()` accessor so the keyword bank can keep
  living in `routes/books.py` (where it's also referenced by the
  admin fandom-merge tooling) without an import cycle.

Footprint: `routes/books.py` 6,140 → 5,391 lines (749-line cut).
Six new shim tests in `test_p3_batch.py` lock the re-export
contract (27/27 in the file passing, 221/221 across the new-features
+ P3 suites combined).

---

## 2026-06-18 — Tiny insights wave: re-read nudge, projected hours, cohort progress bar ✅

The "tiny wins" picked from the post-P3 ideas menu — three ~30-LOC
additions that turn the existing reading-insights signal into
something the user actually notices in flight.

- **Re-read rabbit-hole notification** — `push_reading_cursor` now
  checks for a meaningful backward jump (prev ≥ 80 %, current < 30 %)
  and tallies the trailing 30 days of `cursor_history`.  When the
  user crosses 4 backward jumps on the same book, fires a one-shot
  `reread_rabbit_hole` notification: "You've kept coming back to
  *Title* — want to add it to a Cosy Comforts shelf?"  Deep-links
  to `/book/{id}`.  Idempotent per (user, book, 30-day window).
- **"~Nh to finish" pill** — `/api/books/{id}/pace-percentile` now
  returns a `projected_hours_to_finish` field whenever the user has
  a usable median pace, computed from their median %/hr × the
  remaining fraction of THIS book.  Best signal we have for books
  the user hasn't started.  Surfaces as a purple Hourglass pill on
  the BookDetail BookReadingInsights strip.
- **Cohort-aware progress bar** — new `BookCohortProgress` component
  replaces the text-only "Progress" cell on BookDetail with a slim
  bar showing the user's percent + a purple tick at the
  community-average percent (cohort-gated at 5 opted-in readers).
  Two pixels of CSS, big social-presence payoff.

All three covered by `test_p3_batch.py` (19 tests now green).
`TestRereadRabbitHoleNudge` exercises the cursor → notification
trip and the 30-day idempotency guard; `TestProjectedHoursToFinish`
asserts the new pace field is present and unit-correct.

---

## 2026-06-18 — P3 wave 2: Reading insights, SSE refresh, Phase-6 split ✅

Cleared the remaining P3 stack the user had on remind-later.  All
shipped behind a new 16-test regression in `test_p3_batch.py`
(green) plus testing-agent verification (iteration_25.json — 100%
PASS on 7 verification points).

- **`cursor_history` schema + write path** — every
  `/api/books/{id}/cursor` push now appends an
  `{user_id, book_id, percent, prev_pct, delta, device_id, ts}` row
  to the new `cursor_history` collection (jitter filter at
  0.2pp to keep the collection slim).  Powers re-read detection +
  pace percentile.  Append is best-effort and never blocks the
  cursor upsert.
- **`GET /api/books/{id}/reread-signal`** — counts backward jumps
  (current percent < 60% of running peak after we were near the
  peak) over a 90-day window.  ≥3 jumps ⇒ `is_reread: true`.
- **`GET /api/books/{id}/pace-percentile`** — user's recent
  %pts/hour rate (from cursor_history × reading_activity minutes)
  divided by their own median across other read books.  Returns a
  `relative` multiplier with graceful `not_enough_data` shape
  when there's no baseline.
- **`GET /api/books/{id}/aggregate-cursor`** — cohort-gated
  (≥5 opted-in readers) average completion percent for the same
  canonical (title, author) pair.  Surfaces "you: 45% · community:
  62%" pill on the book detail page.
- **`BookReadingInsights.jsx`** — new component on `/book/<id>`
  rendering up to three pills (re-read / pace / cohort).  Each
  pill independently short-circuits if its endpoint can't return
  useful data; the strip silently hides when none qualify.
- **SSE-driven Resume badge refresh** — `push_reading_cursor` now
  publishes a `reading_cursor` event on the unified SSE bus.  The
  library page (`AllBooksPage`) subscribes via `useEventStream`
  and re-fetches `/api/reading-sync/hints` whenever a different
  device saves a cursor.  Closes the "stale badge until next
  remount" loophole called out in iter23.
- **Phase-6 module split (first slice)** — extracted
  `_normalize_chapter_title`, `extract_chapters`, `diff_chapters`
  (plus the two compile-once regexes) from the 6 140-line
  `routes/books.py` into a new dependency-free
  `utils/epub_chapters.py`.  `routes/books.py` keeps the same
  public surface via a `from utils.epub_chapters import …`
  re-export so existing call sites (refresh helper, diff route,
  tags route, tests) work unchanged.  Knocks ~210 lines off
  `books.py` and establishes the template for future P3 splits.

---

## 2026-06-18 — P3 batch: Operator digest, Resume badge, Buddy-pacing, Leaderboard ✅

Cleared four P3 items in one batch — three product features and one
backlog-doc deliverable.  All shipped behind a new
`test_p3_batch.py` regression (9/9 green) plus testing-agent
verification (iteration_24.json — 100% PASS).

- **Weekly Operator Digest email** — new `routes/operator_digest.py`
  module. Sunday 19:00 UTC cron sends a rollup of explore views,
  cover-page views, signups, top 5 covers, and referrer mix to
  every admin who toggled
  `operator_digest.email_enabled = True`.  Toggle + "Send sample
  email" preview button live on `/account/emails` (admin-only
  card).  Idempotent per ISO week via
  `operator_digest.last_sent_at` on the user doc.  Reuses the
  existing Resend pipeline + `log_email_send` helper.
- **BookCard "Resume" passive hint** — new
  `GET /api/reading-sync/hints` endpoint surfaces every book with a
  fresh cloud cursor (last 48 h, percent < 99 %, from a device
  other than the caller's `shelfsort-device-id`).
  `AllBooksPage.jsx` fetches once per mount and passes per-book
  hints down; `BookCard.jsx` renders a yellow pill
  (`cross-device-hint-<book_id>` testid) with a Smartphone icon
  and the originating device label as a tooltip. Lets users
  discover cross-device sync without enabling push.
- **Bookclub buddy-pacing** — when both members of a 2-person room
  cross into a new chapter, `_maybe_post_buddy_pacing` inserts a
  system message ("Both of you have reached Chapter N. Ready to
  talk about it?") + pings both readers via in-app notifications.
  Idempotent per (room, chapter) via a `system_kind='buddy_pacing'`
  guard; larger rooms skipped to avoid spam.
- **Books-most-likely-finished leaderboard** — new
  `GET /api/books/most-finished-leaderboard` aggregates canonical
  (title, author) pairs by completion rate (≥99% progress fraction
  across opted-in cohort).  Same `_HEATMAP_MIN_READERS = 10`
  cohort gate as the per-book heatmap so single users can't be
  inferred.  Powers a future homepage / bookclub-picker strip; no
  frontend surface yet.
- **Launch tweet drafts** — three angle variants
  (cover-ecosystem, cross-device sync, privacy-community) committed
  to `memory/LAUNCH_TWEET.md` with a posting checklist + after-
  launch monitoring notes.

Fixes during the same window (testing-agent surfaced during the P3
sweep):

- **EmailPreferences `<select>` crash** — the Emergent VisualEditor
  wraps dynamic option text in a `<span>`, which React 19 refuses
  inside a native `<option>` (hydration error → app-level error
  boundary collapsing the route to `/`).  Migrated the
  weekly-digest day-of-week + UTC-hour controls to shadcn
  `<Select>` (Radix popper, no `<option>` DOM).  Page now mounts
  cleanly for all users; operator-digest card is reachable.
- **BookCard Resume badge JSX** — initial implementation
  destructured `crossDeviceHint` from props but the badge JSX got
  lost in a follow-up edit, shipping a no-op feature.  Re-added
  the badge block alongside the existing Read badge (with
  `!isRead && crossDeviceHint` guard so finished books never get
  the pill).

---

## 2026-06-18 — Polling-loop SSE migration (Messages + Friends) ✅

Closed the loop on the unified SSE channel by migrating the two
remaining live-data consumers off polling:

- **Backend** — `routes/chat.py` `send_message` now publishes a
  `chat-incoming` envelope to every OTHER room member's SSE bus.
  Sender is excluded so they don't see their own echo bump the
  badge.  Friend-request / friend-accepted events already flow via
  `notification` envelopes since `create_notification` was wired to
  the bus on 2026-06-18.
- **Frontend** — `MessagesDropdown` and `FriendsPage` now subscribe
  to `chat-incoming` + `notification` (filtered to friend-shaped
  kinds) via `useEventStream`.  Background polling cadence relaxed
  from 15-20 s to 60 s as a safety-net for dropped connections.
- **Test** — new `test_chat_incoming_publishes_to_bus_for_other_member`
  asserts the chat-incoming envelope reaches a subscribed receiver
  with the correct sender + preview.  All 4 event-bus tests pass.

Third polling loop (`ActiveRoomPanel` from the original roadmap)
doesn't exist in the codebase — replaced by the bookclub message
flow which is on a separate WebSocket-style channel and out of scope
for the SSE migration.  Removed from the action-items list.

## 2026-06-18 — Deployment readiness sweep + SSE iteration bug fix ✅

Ran the deployment-readiness check (PASS) and a parallel sanity pass.
Frontend `yarn build` succeeded.  Service worker `/sw.js` confirmed
200 on the production URL.  All services running.

**Bug surfaced + fixed**: `/api/goals/stream` (existing) and the new
`/api/events/stream` were logging `goal-hit SSE iteration failed`
every ~28 seconds.  Root cause: both endpoints cancelled the
`next_evt = sub.__anext__()` task on every heartbeat tick, which
killed the underlying async generator with `StopAsyncIteration` on
the next call.  Rewrote both loops to keep a single long-lived
`next_evt` task across heartbeats and race it with
`asyncio.wait_for(asyncio.shield(next_evt), timeout=25)` so the
heartbeat path doesn't disturb it.  Verified silent for 60s after
restart.

## 2026-06-18 — CI verification ✅

User asked for CI wiring; turned out the GitHub Actions workflow
(`.github/workflows/backend-tests.yml`) was already in place from a
prior session.  It runs `./scripts/run_coverage.sh --fail-under=75`
which executes `pytest tests/ -v --tb=short` against a coverage-
instrumented uvicorn — so the new test files from this session
(`test_event_bus`, `test_push`, `test_reading_sync`, `test_analytics`,
`test_timestamp_convention`) are picked up automatically.

Verified locally: `pytest tests/ --collect-only -q` collects
**1,018 tests** including every file added this session.  No CI
wiring change needed; the new tests will run on the next push to
the connected GitHub repo.

## 2026-06-18 — Timestamp convention locked in ✅

After the testing-agent sweep flagged the ISO-string `$gte` pattern as
fragile, locked the convention down with two thin pieces instead of a
multi-day BSON-Date migration:

- **`utils/timestamps.py`** — `utc_iso(dt=None)` + `now_iso()`
  helpers that always emit `+00:00`-offset ISO strings, no matter
  whether the caller passes a naïve / aware / `None` datetime.
  Module docstring explains the rationale (lexical-sort match,
  no API-layer parsing, pre-existing data already stringly-typed).
- **`tests/test_timestamp_convention.py`** — regression test that
  samples up to 50 docs from each of the 6 critical timestamp
  collections (`community_covers.shared_at`, `page_views.ts`,
  `page_views.hour_bucket`, `cover_archive.archived_at`,
  `reading_cursors.updated_at`, `push_subscriptions.created_at`)
  and asserts every value is a `str` or missing.  If any writer
  ever sneaks in a BSON `Date`, CI flips red immediately rather
  than letting silent-filter-mismatch bugs ship.

## 2026-06-18 — Testing-agent sweep fixes ✅

Ran the testing agent across the 10-feature batch.  Backend pytest
13/13 PASS; frontend 9/11 verified, 1 inconclusive (Reader needs
a real EPUB), 2 bugs found and fixed:

- **HIGH — `/@username` vanity URL dropped.**  The K8s ingress / SPA
  fallback was rewriting paths containing `@` to `/`, killing the
  route before React Router could see it.  Removed the route from
  `App.js`, deleted `VanityRedirect.jsx`, documented the failure
  mode in ROADMAP so any future vanity-URL attempt routes through
  the backend (`/api/share/at/:username` → 302).
- **MEDIUM — Anonymous vote toast.**  Original code only fired the
  sign-up toast when `signup_prompt: true` (i.e. the up-vote).
  Toggle-off case showed nothing, making the click feel silent.
  Fixed: always show a small "Vote saved" / "Vote removed"
  acknowledgement to unauth voters, with the bigger sign-up CTA
  still scoped to the high-intent first-vote moment.

The LOW-priority `/api/auth/me 401` noise on public pages was
intentionally not fixed — it's a documented behaviour of the
optional auth pattern and only visible in DevTools.

## 2026-06-18 — Visitor analytics + Reader heatmap + Privacy guardrails ✅

Two adjacent surfaces shipped in one batch.

**Visitor analytics** (new `routes/analytics.py`):
- `page_views` collection with hour-bucketed timestamps, ip_hash for
  dedupe (never raw IPs), ref_bucket coarse-grained (twitter,
  bluesky, discord, reddit, search, ao3, internal, other), country
  inferred from `cf-ipcountry` / `accept-language`.
- `POST /api/analytics/view` — SPA-driven view stamping (deduped
  within 30 min by ip_hash + page_type + slug).
- `_stamp_view()` hook fires server-side inside the
  `/api/share/cover/{id}` and `/api/share/u/{username}` HTML pages
  so crawler hits feed the same funnel.
- `GET /api/analytics/public-stats` (unauth) — total users, monthly
  signups, total covers.  Powers the landing-page social-proof
  counter ("9,402 readers signed up this month").
- `GET /api/analytics/summary` (admin-only) — funnel (explore →
  cover → signup with conversion %), by_ref distribution, by_country
  top-8, and the top 8 covers by views.

**Reader heatmap**:
- `GET /api/books/{id}/heatmap` — joins by canonical
  (title_key, author_key), aggregates everyone's
  `progress_fraction` into a 10-bucket completion curve, finds the
  biggest ≥20-pp drop as the DNF cliff, and returns the caller's
  own percent so the Reader UI can render a "you-vs-them" sparkline.
- Cohort gate: heatmap is suppressed unless ≥10 unique readers have
  the same canonical book.  Returns
  `{ready: False, reason: "cohort_too_small"}` below the gate.

**Privacy guardrails** (mandatory layer):
- `users.reading_data_shared` (default `True`) — gates whether the
  caller's books feed the cross-reader aggregate.
- `POST/GET /api/analytics/reading-data-sharing` — opt-out toggle.
- New `ReadingPrivacyToggle` card on the Account page.
- New `ConsentBanner` component shown on first visit to any public
  page (`/explore/covers`, `/cover/:id`, `/u/:user`) — accept /
  decline persisted to localStorage, decline blocks SPA `stampView`.

**Frontend integrations**:
- `Reader.jsx` fetches heatmap on mount and renders a header pill
  with cohort count, 10-bar mini sparkline (purple bars = sections
  the reader has reached, grey = ahead), and a red "⚠ N%" badge if a
  DNF cliff exists.
- `CommunityShowcase` (landing page) shows the public counter strip
  above the cover grid.
- `AdminAnalyticsCard` widget on AdminConsole — funnel cells with
  conversion %, top covers, by-referrer, by-country lists.  Window
  selector (24h / 7d / 30d / 90d).

**Tests** — new `tests/test_analytics.py` (7 tests, all passing):
public stats unauth, view stamp + dedupe, admin summary 403 for
non-admin, admin summary shape for admin, heatmap below cohort
gate, heatmap above cohort gate with chapter_curve + DNF cliff,
privacy toggle persistence.

## 2026-06-18 — Web Push cross-device handoff ✅

True Kindle-Sync-style reading handoff via Web Push.  When you close
a Shelfsort tab mid-book, your *other* devices get a push within
seconds: "Resume reading? You were on 'Twilight' (42%) on Mac."
Tap the push → opens the Reader at the cloud cursor.

**Backend** (new `routes/push.py`, ~200 lines):
- VAPID keypair generated and stored in `backend/.env`
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_PEM`, `VAPID_CONTACT_EMAIL`).
- `GET /api/push/vapid-public-key` — unauthenticated, browser
  fetches during PushManager.subscribe().
- `POST /api/push/subscribe` / `unsubscribe` — idempotent
  per-endpoint upsert in `push_subscriptions`.
- `POST /api/push/handoff` — fired by the Reader on visibilitychange
  via `navigator.sendBeacon`.  Sends a Web Push to every
  subscription belonging to the user EXCEPT the closing device.
- Uses `pywebpush` 2.3.0 + `py-vapid` 1.9.4 (new dependencies, frozen
  into `requirements.txt`).

**Frontend**:
- New service worker `public/sw.js` — handles `push` (shows
  notification) + `notificationclick` (focus/open the resume URL).
- New helper `lib/push.js` — `getPushStatus`, `enablePush`,
  `disablePush`, plus `armReadingHandoff(bookId, getPercent)` that
  the Reader mounts to fire the beacon on tab close.
- New component `PushHandoffToggle` on the Account page with a
  bell-icon button, status indicator ("subscribed" / "blocked by
  browser" / "not enabled").  Hides itself on browsers without
  Push support.
- `Reader.jsx` now arms the handoff beacon on mount with the
  current book id + percent.  Only fires once per tab close and
  only when progress > 5% so a quick peek doesn't ping every device.

**Tests** — new `tests/test_push.py`:
- VAPID public key endpoint accessible unauth.
- Subscribe is idempotent (second call doesn't duplicate row).
- Unsubscribe drops the row.
- Handoff 404s for unknown / cross-user book IDs.
All 3 pass.

## 2026-06-18 — Reading sync + stuck books + DNF + Resume hero ✅

Six tightly-coupled features that build the cross-device reading
state plus the re-engagement loop on top of it.

**Backend** — new `routes/reading_sync.py` + `utils/engagement.py`:
- `POST/GET /api/books/{id}/cursor` — per-(user, book) cursor upsert
  carrying CFI, percent, chapter label, device_id, device_label.
- `GET /api/books/{id}/active-devices` — recent-window query (10
  min) so a "Now reading on iPhone" indicator can render.
- `GET /api/books/stuck` — books opened >30d ago AND <30% read,
  sorted most-stuck first.  Powers the new Stuck-books smart shelf.
- `GET /api/books/{id}/pace` — projects days-to-finish using the
  last-14-days reading_activity minutes and a lifetime-pace
  approximation; returns `reason: "not_enough_data"` for cold
  books so the UI knows to suppress the forecast.
- `POST /api/books/{id}/dnf` — flag a book Did-Not-Finish.  The
  affinity-recommendations endpoint now excludes DNF authors so the
  rec engine stops nagging.
- `GET /api/books/{id}/friends-reading` — privacy-preserving count
  of accepted friends with a recent cursor on the same canonical
  book (only friends with `library_visible_to_friends == True`).
- New `reengagement_stuck` notification kind + Sunday 17:00 UTC
  `stuck_books_reengagement_tick` that fires one in-app ping per
  user listing their 3 worst stuck books (silent on clean weeks).

**Frontend**:
- `Reader.jsx` now POSTs cursor to the cloud on every debounced
  progress save AND fetches the latest cursor on mount.  If the
  cloud copy was written by a *different* device within the last
  6 h, a Sonner toast offers a one-tap jump to that spot
  ("Resume there").  Device ID is minted into localStorage on
  first read (`shelfsort-device-id`); a UA-derived label
  ("iPhone", "Mac", "Android") gives the prompt natural copy.
- New `ResumeReadingCard` hero on the dashboard — amber card with
  cover thumb, title, % progress, and progress bar.  Clicks straight
  into `/read/{book_id}`.  Auto-hides when nothing is in progress.
- New page `StuckBooksPage` at `/library/stuck` — lists stuck books
  with Resume + DNF action buttons.  Linked from the Sunday
  re-engagement notification's deep link.

**Tests** — new `tests/test_reading_sync.py` (5 tests, all passing):
cursor push/pull/overwrite, ownership 404, stuck-shelf filter,
DNF removing authors from affinity recs, and the Sunday tick
generating notifications only for users with stuck books.

## 2026-06-18 — Mobile reading + Unified SSE + Affinity recs ✅

Three roadmap items in one batch:

**1. Mobile reading mode** (`pages/Reader.jsx`):
- Fullscreen toggle button in the reader header (Maximize / Minimize
  icons; reflects ESC-driven state via `fullscreenchange` listener).
- Tap-edge page-flip zones — 12% wide invisible buttons on the left
  and right edges of the reader area that call `rendition.prev()` /
  `rendition.next()` in paginated flow.  Existing react-reader
  `swipeable` prop already handles touch swipes, so this adds the
  tap-to-page interaction common to Kindle / Apple Books.

**2. Unified SSE channel** — new `utils/event_bus.py` + new endpoint
`GET /api/events/stream`:
- Generic per-user pub/sub keyed on `(user_id, kind, data)`.
- `create_notification` now publishes to the bus so any open tab
  gets an instant bell-bump (no more 15-60s polling latency).
- `publish_goal_hit` also publishes to the bus so the unified
  endpoint can deliver goal-hit events without a second listener.
- New `useEventStream(handlers, enabled)` React hook holds a single
  `EventSource` per tab and dispatches typed events.
- `NotificationsBell` migrated as the first consumer — polling
  interval relaxed from 15 s → 60 s safety-poll while SSE handles
  the fast path.  Other clients (`MessagesDropdown`,
  `FriendsPage`, `ActiveRoomPanel`) can migrate incrementally.

**3. Affinity recommendations** — new `GET /api/recommendations/by-affinity`:
- Computes the caller's top-3 fandoms + top-3 authors from their
  own library, then surfaces community covers matching those
  affinities that the caller doesn't already own.
- Joins via the existing `title_key` / `author_key` / `fandom_key`
  normalised indexes on `community_covers`.
- Carries a `match_reason` per row so the UI can show "author:
  Tester" or "fandom: Harry Potter" under each card.
- New rail on `RecommendationsPage.jsx` between meta-strip and
  digest card; auto-hides when no matches.

**Tests** — new file `tests/test_event_bus.py` with 3 tests
exercising the bus, the `create_notification` → bus path, and the
HTTP endpoint opening with a real session.  All 6 cover-related +
event-bus tests pass.

## 2026-06-18 — Cover ecosystem Tier 5: public surfaces & discoverability ✅

Turned the cover ecosystem outward.  Anyone can now browse, vote, and
share community covers without an account; everything is indexable,
RSS-able, and carries proper OG/Twitter meta tags for social previews.

**New backend module** `routes/cover_public.py`:
- `GET /api/community-covers/{cover_id}`              — single cover JSON (public)
- `GET /api/community-covers/explore`                 — discovery feed with three rails (top of week, trending, recent)
- `POST /api/community-covers/{cover_id}/vote-anon`   — cookie-pinned anonymous vote with `signup_prompt` flag
- `GET /api/og/cover/{cover_id}.png`                  — raw cover image with PNG/JPEG content-type detection
- `GET /api/og/user/{username}.png`                   — pure-PIL profile card (1200×630) with handle, stats, and #1 cover thumbnail
- `GET /api/share/cover/{cover_id}`                   — HTML page with OG / Twitter meta + JS redirect to the SPA
- `GET /api/share/u/{username}`                       — same for profiles
- `GET /api/cover-archive` + `/cover-archive/{year}/{week}` — historic #1 winners
- `GET /api/sitemap.xml`                              — sitemap listing public profile + cover URLs
- `GET /api/feeds/covers/trending.rss`                — RSS feed of trending covers
- `GET /api/feeds/covers/user/{username}.rss`         — per-user RSS feed

**Auth helper** `auth_dep.get_current_user_or_none`:
- New dep returning the user if signed in, else `None`.  Used by the
  formerly-auth-gated profile / featured / lineage endpoints so they
  now serve unauth visitors but still personalise `voted_by_me` for
  signed-in callers.

**Cover archive write hook** in `cover_leaderboard_tick`:
- Daily leaderboard tick now upserts a row into `cover_archive` keyed
  on ISO `(year, week)` so past winners stay visible long after the
  7-day featured window has closed.

**New frontend pages + routes**:
- `/u/:username`              — `PublicCoverProfile` is now unauth and includes
                                JSON-LD ProfilePage + Person schema, share
                                buttons (X / Bluesky / Copy link), and an RSS
                                link.
- `/cover/:coverId`           — `PublicCoverDetail` with JSON-LD CreativeWork
                                schema, anonymous-vote flow, remix lineage
                                display, share buttons, and a sign-up CTA for
                                unauth viewers after they heart a cover.
- `/explore/covers`           — `ExploreCoversPage` (unauth) with three rails.
- `/cover-archive`            — `CoverArchivePage` showing every past week's
                                #1 cover.
- `/@username`                — Twitter-style vanity redirect to `/u/{username}`.

**Marketing landing page**:
- New `CommunityShowcase` strip surfaces the current top-of-week
  thumbnails on `/` as live social proof — auto-hides on quiet weeks.

**New tests** (`tests/test_cover_regen.py`) — 3 new:
- `test_public_cover_endpoints_no_auth` exercises every public surface
  (single cover, explore, OG image, share HTML, sitemap, RSS) with a
  brand-new unauth `requests.Session` to prove none of them require
  a session cookie.
- `test_anonymous_vote_pins_to_cookie_and_toggles` checks the
  `sscv` cookie is stamped on first vote, `signup_prompt: true` fires,
  and a second call toggles the vote back off.
- `test_cover_archive_index_and_week_lookup` validates the daily tick
  writes one row per ISO-week and the index / per-week lookups work.

Total: **17/17 tests passing.**

## 2026-06-18 — Cover ecosystem Tier 4: notifications, trophies, lineage ✅

Turned the cover ecosystem into a full social loop.  Sharers now get
pinged when their work resonates; viewers can browse any sharer's
public profile and remix tree.

**Notifications** (`utils/cover_notifications.py`, hooked into
`routes/books.py`):
- `cover_milestone_votes` — fires when someone else's vote crosses
  1 / 5 / 10 / 25 / 50 / 100 hearts on a shared cover.  Toggles are
  idempotent because the milestone only triggers on the "voted"
  action and at the exact threshold.
- `cover_milestone_imports` — fires when import_count crosses
  1 / 5 / 10 / 25 on a shared cover.
- `cover_top_of_week` — daily scheduler tick (12:00 UTC) detects the
  current top-of-week winner and pings the new sharer only when the
  winner *changes* from yesterday's recorded value in
  `system_state.cover_ecosystem_state`.
- `cover_weekly_recap` — Sunday 18:00 UTC tick aggregates each
  sharer's votes + imports over the past 7 days and sends a single
  in-app rollup.  Quiet weeks stay quiet.
- `friend_shared_cover` — single in-app ping to every accepted
  friend of the sharer when they publish a new community cover.
- All five kinds added to `NOTIFICATION_CATALOG` as user-mutable so
  the existing notification-mutes settings UI surfaces them
  automatically — no separate toggle page needed.

**Achievements / public profile** (`routes/books.py`):
- `GET /api/users/{username}/cover-profile` — returns the user's
  display name, lifetime totals (shared / votes / imports), trophies,
  and grid of their top covers.  Auth-gated, 404s for unknown
  usernames so existence isn't leaked.
- `cover_achievements` array on the user doc.  `top_of_week` trophy
  is granted idempotently inside the leaderboard tick (same cover
  winning twice doesn't double-stamp).
- New page `frontend/src/pages/PublicCoverProfile.jsx` at route
  `/u/:username`, reachable from the `@handle` link on every
  community cover card.

**Lineage / trending** (`routes/books.py`):
- `parent_cover_id` recorded on shared community-cover records
  whenever the source variant came from an import (the existing
  `source: "community:<id>"` tag is parsed).
- `GET /api/community-covers/{id}/lineage` — returns the parent
  (one level up) plus direct children, with `remix_count`.
- `/community-covers/featured` now returns a `trending: bool` flag
  per row (≥3 hearts AND shared within 48 h) so the homepage strip
  can show a red "🔥 Trending" pill alongside the gold "🏆 #1 this
  week" ribbon.

**Tests** — 6 new tests in `tests/test_cover_regen.py` covering vote
milestones, import milestones, leaderboard-tick idempotency, public
profile happy-path + 404, lineage parent/child round-trip, and
featured-endpoint trending detection.  All 14 tests pass.

## 2026-06-18 — "Covers of the week" homepage strip ✅

Wired the existing `/api/community-covers/featured?days=7` endpoint
into a `CoverOfTheWeekStrip` component on the welcome dashboard.
Horizontally-scrollable card list of the top-voted community covers
from the last 7 days — each card shows the AI-generated thumbnail,
title + author, the sharer's `@handle`, and a red Heart vote-toggle
backed by the same `POST /community-covers/{id}/vote` endpoint as the
regenerate-cover modal.  Voting is optimistic with a rollback on
failure.  Strip auto-hides on fresh installs / quiet weeks so the
lean dashboard stays lean.  Top-voted card carries a small amber
"🏆 #1 this week" ribbon (only when votes > 0 so a 0-vote week
doesn't crown an empty winner) to make the leaderboard feeling
visible and reinforce the upload→share→vote social loop.



## 2026-06-18 — Tier 3 vote endpoint bugfix ✅

`POST /community-covers/{cover_id}/vote` was returning 404 for every
brand-new community cover.  Root cause: the projection
`{"_id": 0, "voters": 1, "votes": 1}` returns an empty document `{}`
when the source doc has neither field yet — and the handler used the
truthy check `if not record:` which treats `{}` as "missing".  Switched
to explicit `if record is None:` so a freshly-shared cover with no
voters list is correctly recognised as existing.  Result: all 8
`test_cover_regen.py` tests pass, including the new
`test_community_cover_voting_and_featured` which exercises the
vote → /featured surface → re-vote toggle → 404-on-missing flow.



## 2026-06-17 — Cover style packs (Tier 2) ✅

Cover ecosystem Tier 2: styles as first-class objects.  Ten curated
built-in styles + user-defined custom styles.  Picker is on every
single-book regenerate modal AND on the bulk "Polish my covers" page,
so a user can re-skin one book or 50 in one shared visual language.

**Backend** (`utils/cover_styles.py`, `utils/cover_gen.py`,
`routes/books.py`):
- New `utils/cover_styles.py` — ten hand-tuned built-ins:
  *Shelfsort house* (default), *Minimalist line-art*,
  *Gothic candlelight*, *Watercolour botanical*, *Pulp paperback*,
  *Cyberpunk neon*, *Vintage 70s sci-fi*, *Dark academia*,
  *Cottagecore*, *Noir black & white*.  Each style is just a
  prompt-fragment that splices into the existing rule block.
- `cover_gen.generate_cover` learned a new `style_prompt=` kwarg.
  The style override is appended BEFORE the user nudge so the nudge
  always wins ties, but the style is the dominant aesthetic
  instruction otherwise.
- `POST /books/{id}/preview-cover` accepts `style_id` in the body.
  Built-in slugs resolve via `cover_styles.get_style_prompt`; custom
  ids (`"custom:{uuid}"`) resolve against `user_cover_styles`.
- New endpoints:
    * `GET  /cover-styles`               — list built-ins + caller's
      customs (with `kind: "built_in"` / `"custom"` discriminator).
    * `POST /cover-styles/custom`        — save a named user style
      (max 20 per user, max 1000-char prompt).  Returns
      `id: "custom:{uuid}"` ready to pass back into preview-cover.
    * `DELETE /cover-styles/custom/{id}` — drop a saved style.
      Doesn't touch covers already generated with it.

**Frontend** (`components/RegenerateCoverButton.jsx`,
`pages/PolishCoversPage.jsx`):
- Style picker `<select>` in the regenerate modal, above the nudge
  field.  Default option = "Shelfsort house"; built-ins come next;
  customs get a leading ★ marker.  Selected style's description
  shows in italic below the select.
- `PolishCoversPage` got the same picker in the actions strip — pick
  *Gothic candlelight*, click "Generate next 10", and ten cover-less
  books come back in the same visual register.  Useful for users who
  want a cohesive library look.

**Tests** (`tests/test_cover_regen.py`, +1 test, 7/7 pass):
- `test_cover_styles_catalog_and_custom_crud` — built-ins enumerated,
  custom create / list-includes / delete / second-delete-404 round
  trip, empty-name 400.

**Storage**: customs live in `user_cover_styles` Mongo collection,
capped at 20 per user.

**Still parked in ROADMAP**:
- Tier 3 — Voting, Featured-of-the-week, Style remix, Trending feed,
  Profile gallery, Cover challenges
- Tier 4 — Reference image upload, Series consistency, Cover history
  timeline, Public A/B vote
- "Apply this style to my whole library" as a single-button bulk
  action with confirmation modal (currently you achieve this via the
  PolishCoversPage style picker + Generate-all; future enhancement
  could one-click queue every book including ones that already have a
  cover).

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
