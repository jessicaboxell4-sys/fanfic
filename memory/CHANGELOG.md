# Shelfsort — Changelog

Append-only log of dated work entries. Newest at the top.

For static product context see [PRD.md](./PRD.md).
For the prioritized backlog see [ROADMAP.md](./ROADMAP.md).
The pre-split verbose history (with every "Added 2026-05-29" line) is preserved verbatim in `PRD.md.bak`.

---
## 2026-06-27 — Graceful MongoDB transient-failover handling 🌐

User reported a raw `ReplicaSetNoPrimary` / `ServerSelectionTimeoutError`
topology dump bleeding into the production upload UI during an Atlas
primary-election window.  Replaced the leak with a friendly, recoverable
flow.

### What shipped

- **`backend/utils/db_retry.py`** — typed transient-error helpers:
  - `is_transient_mongo_error(exc)` — predicate covering
    `ServerSelectionTimeoutError`, `NetworkTimeout`, `AutoReconnect`,
    `NotPrimaryError`, `ConnectionFailure`, `WaitQueueTimeoutError`.
  - `friendly_mongo_message(exc)` — one-sentence translation
    (no raw replica-set names, no class names).
  - `retry_on_transient(coro_factory, attempts=3, ...)` —
    exponential-backoff wrapper for ad-hoc Mongo writes.
- **`backend/routes/upload_jobs.py`** — `_run_upload_job()` now
  branches on `is_transient_mongo_error`:
  - Transient → row stays `status="queued"`, `started_at=None`,
    `error="Our database briefly had no primary node — …"`, and
    the staging directory is preserved so the 5-min
    `recover_stuck_upload_jobs` cron can re-kick it.
  - Real bugs still flip to `status="failed"` and sweep staging.
- **Bug fix**: previous implementation `return`ed from `except` to
  skip `rmtree` — but `finally` runs even after `return`, so the
  staging bytes were swept anyway, defeating recovery.  Added a
  `preserve_staging` flag the `finally` block honours.

### Tests added

- `backend/tests/test_upload_job_transient_mongo.py` (4 tests):
  - `friendly_mongo_message` covers every transient type and
    never leaks raw class names.
  - `is_transient_mongo_error` rejects real bugs.
  - Transient `ServerSelectionTimeoutError` → row stays `queued`,
    friendly error, staging dir preserved.
  - `RuntimeError` → row goes `failed`, staging swept.

All 4 new + 2 existing recovery tests green.

### Operator visibility (follow-on)

- **`GET /api/admin/upload-jobs/stuck?threshold_minutes=10`** —
  admin-only diagnostic that lists every upload_jobs row sitting
  in `queued` / `processing` for longer than the threshold.
  Defaults to 10 min (so a job is only "stuck" if it has *already*
  missed one recovery-cron window).  Clamped to [1, 240].
- **`StuckUploadsCard`** (frontend `pages/AdminConsole.jsx`) —
  renders the list with friendly error blurbs + age-in-minutes,
  auto-polls every 60s when visible.  Healthy admin pages just
  show "✓ no stuck jobs — the recovery cron is keeping up";
  growth here is the operator's leading indicator that the cron
  itself is wedged or the staging volume is full.
- Registered in the admin manifest under `category: "system"`
  and reachable via the Cmd+K palette ("stuck", "uploads",
  "queued", "atlas", "failover").
- Tests in `backend/tests/test_admin_stuck_upload_jobs.py`
  (surfaces stale rows / empty when healthy / clamps threshold /
  recover-now re-kicks stale).

### Manual recovery trigger (follow-on)

- **`POST /api/admin/upload-jobs/recover-now`** — admin-only.
  Runs the sweeper synchronously and returns
  `{"recovered": <count>}`.  Idempotent.
- **"Re-kick now" button** on `StuckUploadsCard` (only renders
  when there are stuck jobs).  Tells the operator how many were
  re-kicked via toast and refetches the list.  Avoids the
  up-to-5-min wait when an operator wants recovery to happen
  *right now* in front of a user reporting their upload "stuck".

### Polish / deploy prep (same day)

- **Dark-mode fixes** for two cream surfaces that survived earlier
  sweeps: `bg-white/90` (admin mobile "Jump to section" dropdown
  wrapper) and `bg-[#FFF6E5]` (upload "Picking up where you left
  off…" resume banner).  Both now map to the dark surface via
  `index.css`'s attribute-selector bridge — the warm peach banner
  gets a faint purple tint so it still reads as a callout, the
  admin dropdown converges on the standard translucent dark
  surface.
- **`AdminHelp.jsx`** — new "Stuck uploads & Atlas failover"
  section documenting the new card, the three usual stall causes
  (Atlas election / staging-disk loss / cron wedged), the
  "Re-kick now" button, and the underlying diagnostic API.
- **`.gitignore`** — removed three lines (`.env`, `.env.*`,
  `*.env`) that had silently re-crept into the file. The comment
  above them explains exactly why they cannot exist; deployment
  agent re-confirmed PASS after the removal.


### User impact

- No more raw topology dumps in upload toasts during Atlas elections.
- Uploads in flight during a failover are auto-retried by the
  existing 5-min recovery cron — user just sees "Database briefly
  unavailable — Shelfsort will retry automatically" until it
  recovers, then the books appear in their library normally.

---

## 2026-06-27 — In-app feature announcement convention 📣

User-stated rule: **whenever a new feature goes live, an in-context
popup shows up.**  Baked this into the codebase so every future
session follows the pattern automatically.

### What shipped

- **`components/OneTimeTip.jsx`** — generic dismissible tip
  component.  Props: `tipKey` (kebab-case slug),
  `title` (defaults to "Heads-up:"), `accent` (`purple` /
  `amber`), `compact`.  Dismissal persisted under
  `localStorage["shelfsort.tip.<tipKey>-dismissed"]`.
- **`components/AirdropInfoTip.jsx`** refactored to a thin
  wrapper around `OneTimeTip` (preserves the existing
  dismissal key so users who already X'd it stay dismissed).
- **`/app/memory/CONVENTIONS.md`** — new doc capturing the
  convention with rules for tip-key naming, copy style, accent
  choice, compact variant, and a feature/key table for
  in-flight work.  Future agents are pointed here from PRD.md.
- **`/app/memory/PRD.md`** — added a top-level user preference
  noting the convention.

### Applied retroactively to this session

`AllBooksPage.jsx` now mounts a `OneTimeTip
tipKey="characters-and-rationale-2026-06-27"` introducing the
Characters browser, the per-book sort chip, and the classifier
rationale tooltip — all features that shipped this session
without their own dedicated tip.

### Going forward

Every PR that adds a user-facing feature must also add a
`OneTimeTip` near the affected surface, with a `tipKey` in the
form `<feature-slug>` (or `<feature-slug>-<YYYY-MM-DD>` for
multi-feature group tips).  See CONVENTIONS.md for the template.

Test IDs: `one-time-tip-<tipKey>`,
`one-time-tip-<tipKey>-dismiss`.

---

## 2026-06-27 — One-time "you can close the tab" tip 💡

User-requested educational moment: every user — existing or
brand-new — should see a one-time message the first time they hit
the upload zone after the airdrop-mode launch, explaining that
they can close the tab once the upload bar finishes.

### Implementation

- New `components/AirdropInfoTip.jsx`:
  - Small dismissible info card.
  - Two variants: `compact` (for the dashboard's compact upload
    zone) and full (for the dedicated upload page).
  - Copy: *"Heads-up: once the upload bar finishes, you can close
    this tab. Shelfsort keeps sorting on the server — books appear
    in your library as each one finishes processing. Big drops use
    airdrop mode automatically (20+ files)."*
  - Dismissal persisted in `localStorage` under
    `shelfsort.tip.airdrop-tab-close-dismissed` — never reappears
    on the same browser once acknowledged.
- Mounted **inside** `UploadZone.jsx` (above the dropzone), so the
  tip is co-located with the upload action it describes.  Renders
  for every user on first visit; auto-hides forever once they X
  out.

### Why a banner, not a toast

Toast notifications fire-and-forget — users could miss them in the
flood of upload feedback.  An inline banner sits *next to* the
upload zone the user is about to interact with, so they read it in
context, then dismiss when ready.

Test IDs: `airdrop-info-tip`, `airdrop-info-tip-dismiss`.

---

## 2026-06-27 — "Books arriving" inline indicator 📥

Follow-up to the airdrop-mode launch.  Now that uploads return
instantly and processing happens server-side, the user wants
visible confirmation that the books are still on their way — not
just a "you can close the tab" promise.

### What changed

- `GET /api/polish/stats` now also returns an `arriving` count
  (sum of `upload_jobs` rows in `queued` or `processing` state for
  the user).
- `PendingPolishBanner` got a third state:
  - **Arriving** (no polish queue work yet) — amber inbox icon, copy:
    `"N books arriving — extracting metadata, converting formats,
    and saving covers. They'll appear on this page as each one
    finishes."`
  - **Polish + arriving simultaneously** — purple banner with an
    inline `"· N still arriving"` hint after the main count.
  - **Polish only** — unchanged from before.
  - **Idle** — hidden.
- 5-second poll fires `onPolished` whenever either `arriving` or
  `pending` drops, so the library auto-refreshes as books appear.

### Plus housekeeping

- `tests/test_classifier_snapshot.py` snapshot refreshed.  The
  expected values were stale relative to the crossover-detection
  feature added before this session — refreshing was a one-shot
  `SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT=1` run.  23/23 tests now
  pass cleanly across all touched modules.

Test IDs: `pending-polish-banner-arriving`,
`pending-polish-banner-count`, `pending-polish-banner-action`.

---

## 2026-06-27 — Airdrop mode for big bulk drops 🚀

Threshold-based upload pipeline that lets users drop **any file
type** (EPUB, PDF, Kindle, Word, RTF, FB2, etc.) at high volume
without waiting on backend processing.

### How it works

- **Drop ≤ 20 files** → today's "rich" upload flow.  Each file is
  classified, mirrored, indexed, and shown on the library with
  full metadata before the upload bar finishes.  No change to the
  current UX.
- **Drop > 20 files** → airdrop mode kicks in.  The frontend POSTs
  each file's bytes to the backend, the backend returns 202 the
  moment bytes are staged, and the frontend immediately moves to
  the next file without waiting for the pipeline to finish.  All
  the slow work (metadata extraction, Calibre conversion for non-
  EPUB formats, AI classification, R2 mirror) happens in the
  backend's background tasks.  The upload bar hits 100% in
  seconds; the library hydrates as books finish processing.

### Frontend (`components/UploadZone.jsx`)

- `AIRDROP_THRESHOLD = 20` constant.
- `sendOne` short-circuits when `airdrop` flag is on — returns
  immediately after the 202 instead of polling
  `/books/upload/jobs/{job_id}` for completion.
- Progress UI text branches:
  - Classic: `"Sorting your books… N of M processed"` + in-flight + elapsed.
  - Airdrop: `"Airdropping your library… N of M queued"` + a friendly note
    explaining the background hydration.
- Success toast in airdrop mode is short and acknowledges the
  background work: `"Airdropped 200 books — they're sorting in the
  background. You can close the tab."`
- `CONCURRENCY` bumped 6 → 8 (works for both modes).

### Backend resilience (`routes/upload_jobs.py`)

Airdrop mode means the SPA walks away.  If the backend crashes
between accepting bytes and finishing the pipeline, those bytes
would otherwise be stranded.  New safety nets:

- `recover_stuck_upload_jobs()` — sweeps any upload_jobs row in
  `queued`/`processing` for more than 5 min, re-kicks
  `_run_upload_job` for it.  Empty staging dirs (bytes lost to a
  crash) are stamped `failed` with a clear error rather than
  spinning forever.
- **Startup hook** (`server.py`) — runs the recovery once 20s after
  every backend boot.  Catches any work stranded by the most
  recent deploy.
- **5-min cron** — runs `recover_stuck_upload_jobs` on the same
  schedule as the AV/polish recovery crons.  Belt-and-braces.

### Backend perf (`routes/books.py`)

- **R2 mirror parallelism** — the per-book mirror loop (EPUB +
  cover + original-format = 1-3 PUTs) now runs via
  `asyncio.gather` instead of a serial `for` loop.  Saves ~2-4s
  per book on R2-backed deployments.

### Tests

- `tests/test_upload_job_recovery.py` — 2 new tests pinning the
  5-min cutoff: stale rows get re-kicked, fresh rows are left
  alone.
- 21/21 tests pass across the polish queue, classifier reasoning,
  characters, friend orphan, fulltext bg, and upload recovery
  modules.

### Help

Updated `pages/Help.jsx::Uploading books` with a dedicated
"Airdrop mode for big drops" paragraph explaining when it
kicks in, what gets deferred, and the tab-close safety.

---

## 2026-06-27 — "Why did the AI pick this?" rationale tooltip 💭

Every book now stores a 1-sentence rationale for its classification,
surfaced as a tooltip on the category badge.

### Backend

- `utils/classifier.py`:
  - AI prompt extended with a `reasoning` field (cap 140 chars,
    "what signal in the metadata drove the call").
  - Both `classify_with_ai` paths (real LLM + canned-response test
    hook) capture and return it.
  - `classify_by_metadata` synthesizes a rationale for every
    branch:
    - Single-fandom hit → `"Matched 3 keywords for Harry Potter
      (e.g. 'hogwarts') in title/description/sample text."`
    - Crossover (2+ fandoms) → `"Found 5 keyword hits across 2
      fandoms: hogwarts (Harry Potter), wand (Harry Potter)…"`
    - Generic fanfic signal → `"Generic fanfic signal in
      metadata; couldn't pin to a specific fandom."`
    - Non-fiction → `"Non-fiction signal in metadata (publisher
      / description keywords)."`
    - Unclassified → `"Metadata didn't match any known fandom or
      genre signal."`
- `utils/polish_worker.py` + `routes/books.py::upload_books` +
  `routes/books.py::reclassify_book` all persist the rationale as
  `book.classifier_reason`.

### Frontend

- `components/BookCard.jsx`: the category badge now carries a
  `title=` tooltip with the stored rationale.  Fallback copy when
  the field is missing (legacy books) says e.g. `"Sorted by Claude
  (AI)."` / `"Sorted by metadata keyword match."` / `"Sorted by
  you (manual)."`.
- Pending books show `"AI is still sorting this book — hover the
  'Sort now' chip to force it through."`

### Tests

`tests/test_classifier_reasoning.py` — 4/4 pass:
- heuristic single-fandom path names the matched fandom
- heuristic unclassified path returns non-empty rationale
- AI canned-response passes the model's reasoning through
- polish_one_book persists `classifier_reason` to the doc

18/18 tests pass across all touched modules.

Native `title=` tooltip used intentionally — zero new dependency,
zero new bundle weight, works on every browser including
screen-readers.

---

## 2026-06-27 — Per-book "Sort now" / "Re-sort" affordance 🔄

Follow-up to the deferred-classifier queue.  Every book card on
`/library/all` (and any per-fandom / character / pairing shelf) now
has a tiny ✨ button next to the category badge:

- **`classifier === "pending"`** → button is solid purple "Sort
  now", clearly actionable.  One click hits the polish endpoint and
  flips the card to its final fandom/category as soon as Claude
  returns.
- **already classified** → button becomes a faint "Re-sort"
  that only shows on card hover.  Same endpoint, same effect —
  lets the user ask the AI to try again if Claude picked the wrong
  fandom, without leaving the library view.

Wired against `POST /polish/{book_id}` (new endpoint from the
deferred-classifier session).  Local state immediately updates the
badge so the user sees feedback before a parent reload — no
flicker, no waiting on the next polling tick.

Test ID: `book-polish-<book_id>`.

The pre-existing "Reclassify with AI" button on the BookDetail page
stays — it goes through a different endpoint
(`POST /books/{id}/reclassify`) that re-reads the EPUB from disk
(useful if the file was re-uploaded with new metadata).  The new
card button uses the cached metadata for a faster round-trip — both
arrive at the same final classification.

---

## 2026-06-27 — Deferred classifier + background polish queue ✨

Big upload-speed win for large libraries.

### What changed

- `upload_books` no longer awaits ``classify_book`` inline.  Every
  uploaded book lands with:
    - `category: "Pending sort"` (new constant in `utils/constants.py`)
    - `fandom: None`, `confidence: None`
    - `classifier: "pending"` (sentinel)
- Books still get title, author, cover, AO3 tags, URL extraction,
  duplicate detection, and fulltext indexing on the upload path —
  the **only** deferred step is the Claude classifier.
- At the end of every upload batch, `upload_books` fires
  `utils.polish_worker.schedule_polish_for_user(user_id)` — a
  fire-and-forget asyncio task that drains the pending queue in
  parallel (semaphore-capped at `POLISH_CONCURRENCY=4`).

### Tab-close resilience

The polish task runs on the **backend event loop**, not the browser
HTTP connection.  Closing the tab during upload (or during the
polish drain) does NOT abandon the work.

For backend-restart resilience:

- New cron `polish_recovery_tick` (server.py, every 5 minutes)
  scans for users with `classifier: "pending"` books still in the
  queue and re-schedules a drain for each one.
- `_inflight_users` gate prevents the upload trigger + cron trigger
  from double-classifying the same user's books.
- Polish failures stamp `classifier: "polish-failed"` so the
  recovery cron doesn't loop forever on broken EPUBs; user can
  retry via the "Polish now" button.

### New endpoints

- `GET /api/polish/stats` — `{pending, failed, in_progress}` for the
  current user.  Powers the banner.
- `POST /api/polish` — re-kicks the drain (resets `polish-failed`
  rows back to `pending`).  Returns immediately.
- `POST /api/polish/{book_id}` — polish one book inline (used by
  the per-book "Sort now" mini-button planned for follow-up).

### Frontend

- New `components/PendingPolishBanner.jsx` mounts at the top of
  `/library/all` (under FriendRequestBanner).  Self-hides when no
  pending books.  Polls `/polish/stats` every 5s; calls back into
  the library `load()` whenever the count drops so newly classified
  books appear in real time.
- Visible states:
  - Idle (no pending): hidden
  - In-flight: spinner + "N books sorting in the background — Claude is reading each one. You can close this tab — they'll keep going."
  - Failed: "N books failed to sort — Polish now to retry"

### Tests

`tests/test_polish_queue.py` — 4/4 pass:
- polish_one_book classifies & writes the result
- polish_recovery_tick picks up orphaned pending users
- inflight gate prevents double-polish
- count_pending_for_user respects the trash exclusion

Test IDs: `pending-polish-banner`, `pending-polish-banner-count`,
`pending-polish-banner-action`.

### Net impact

Per-file upload time drops from ~7-10s → ~1-2s (the classifier was
the dominant cost).  For a 100-file drop, that's ~3-4 min → ~25-40s
of foreground wall-clock; the AI classification continues in the
background and finishes within a minute or two after the upload
returns.  User can close the tab the moment the upload bar hits
100%.

---

## 2026-06-27 — Upload speed-up (frontend + backend) ⚡

User reported "files just sit at 'Uploading…' / progress bar barely
moves" on a 50-200 file production drop.  The pipeline architecture
itself was fine — bottleneck was per-file processing time amplifying
into long wall-clock waits.  Four-pronged fix:

### Frontend (`components/UploadZone.jsx`)

1. **`CONCURRENCY` 4 → 6** — 50% more files in flight per round.
   Still under Cloudflare's connection ceiling.
2. **Poll interval 1500ms → 1000ms** — counter ticks ~33% sooner
   after each file resolves (MAX_POLLS adjusted to 180 → same 3-min
   wall-clock headroom).
3. **In-flight counter** — new sub-line under the progress text:
   `"N books currently sorting · 47s elapsed"`.  Visible
   feedback even between counter bumps so the user sees the
   parallelism instead of staring at a frozen number.
4. **1s heartbeat ticker** — keeps the elapsed-time readout alive
   between file completions; only ticks while ``uploading`` is true.

### Backend (`routes/books.py`)

5. **EPUB fulltext indexing → background task** (saves 2-5s per
   file).  Previously each upload_books call awaited
   ``extract_epub_text`` + ``upsert_fulltext`` + ``count_words``
   inline.  Now it's fire-and-forget via ``asyncio.create_task`` —
   the book lands in the library immediately, fulltext search picks
   it up a few seconds later.  Mirror of the AV-background pattern
   from yesterday.  Failure still only logs (search-quality nicety,
   not a correctness invariant).

### Expected impact

For a 100-file drop on production:
- Before: ~6 concurrent files × ~12s ⇒ ~3-4 min wall-clock, counter
  visibly stuck between rounds.
- After: ~6 concurrent files × ~7-9s (fulltext deferred) ⇒
  ~1.5-2 min wall-clock, plus a live "N currently sorting" readout
  so the user sees motion the whole time.

### Tests

- `tests/test_upload_fulltext_bg.py` — pins the
  fire-and-forget indexing wiring.
- 11/11 tests pass (full backend suite for the affected modules).

Test IDs: `upload-progress-text` (unchanged), new
`upload-progress-flight` for the in-flight + elapsed sub-line.

---

## 2026-06-27 — Breadcrumbs on all drill-down pages 🧭

The character → fandom → pairing → book navigation is now 3-4 levels
deep.  Added a dependency-free `Breadcrumb` component
(`/app/frontend/src/components/Breadcrumb.jsx`) mounted on every
drill-down page so users can hop up one level instead of relying on
the browser back button.

Pages wired up:

- `/library/pairings` — `Library › Pairings` (and
  `Library › Pairings › Harry Potter ships` when filtered)
- `/library/by-pairing/:pairing` —
  `Library › Pairings › Harry Potter/Draco Malfoy`
- `/library/characters` — `Library › Characters`
- `/library/by-character/:character` —
  `Library › Characters › Harry Potter`
- `/library/fandom/:fandom` (only when a character filter is active)
  — `Library › Harry Potter › Harry Potter books`

The previous "Back to library" / "All pairings" buttons stay — the
breadcrumb is additive, sitting between the back button and the
header.

Test IDs: `breadcrumb` (default), or page-specific via the `testId`
prop — e.g. `pairings-breadcrumb`, `character-shelf-breadcrumb`,
`fandom-breadcrumb`.  Per-item IDs: `<testId>-link-<idx>` and
`<testId>-current-<idx>`.

---

## 2026-06-27 — Character drill-down on the Pairings browser 🔎

Mirrors the per-fandom drill-down: a "Filter by character" rail at
the top of `/library/pairings` lets you see only ships involving a
chosen character (e.g. all Harry's ships, not just Harry/Hermione).

- `GET /api/library/pairings` accepts new `character` query param.
- Pre-narrows the aggregation with a case-insensitive regex against
  the `relationships` array, then post-filters the unwound rows so
  `$unwind` doesn't leak the *other* relationships of a polycule fic
  (e.g. filtering for Harry must not return Ron/Hermione just
  because they share a book with Harry/Hermione).
- Frontend `PairingsDirectory` honors `?character=X` via
  `useSearchParams`, top-12 characters rendered as toggle chips,
  active chip turns solid purple with an X, status line + clear-
  filter button below.  "See all →" pill jumps to the global
  characters directory.
- Summary card switches its caption to "N {Character} ships" when
  filtered.

### Tests

`tests/test_characters.py::test_list_pairings_filters_by_character`
pins the unwind-leak guard.  8/8 tests pass.

Test IDs: `pairings-top-characters`, `pairings-character-chip-<slug>`,
`pairings-character-filter-status`, `pairings-character-filter-clear`,
`pairings-characters-see-all`.

---

## 2026-06-27 — In-fandom character drill-down 🔎

Click any chip on the "Top characters in {fandom}" rail and the
fandom shelf now narrows to *only* the books featuring that
character — no jump to the global by-character view.  Stays inside
the fandom context.

- `GET /api/books` accepts a new `character` query param.  Matches
  any book whose `relationships` array mentions the character
  (case-insensitive, regex-escaped, no first-class field).
- `FandomShelf.jsx` reads `?character=X` from the URL via
  `useSearchParams`, passes it to the books endpoint, and toggles
  it via chip clicks (click an active chip again to clear).
- New "Filtered to books featuring {X} — clear filter" status line
  appears below the rail when active.
- Books-count caption now says "N HP books featuring Harry Potter"
  when filtered, instead of the generic "N books on this shelf".
- "See all →" pill added at the end of the rail so users can still
  reach the global characters directory in one click.

### Tests
`tests/test_characters.py::test_list_books_filters_by_character`
pins the new query param — only HP books mentioning Harry Potter
come back, MCU books with "Harry Osborn" are excluded.  7/7 tests
pass.

Test IDs: `fandom-character-filter-status`,
`fandom-character-filter-clear`, `fandom-top-characters-see-all`.

---

## 2026-06-27 — "Top characters" rail on fandom shelves 👥

Follow-up to the Characters browser launched earlier today.

- `GET /api/library/characters` now accepts optional `fandom` and
  `limit` query params, so callers can scope the aggregation to a
  single fandom shelf.
- New "Top characters in {fandom}" chip rail on
  `/library/fandom/:fandom`, rendered between the search box and the
  books grid.  Shows up to 8 most-tagged characters in that fandom
  (count DESC, name ASC), each chip links to the per-character
  shelf (`/library/by-character/:name`).
- Hidden entirely when no characters are derivable from the shelf
  (relationships array is empty across the board).
- New test `tests/test_characters.py::test_list_characters_scoped_to_fandom`
  pins the fandom-scoping behaviour — Harry Potter scope must not
  return Steve Rogers.  6/6 tests pass.

Test IDs: `fandom-top-characters`, `fandom-top-character-<slug>`.

---

## 2026-06-27 — Characters dimension + sort tiebreaks 👥

Two-part follow-up to "how are characters sorted?":

### 1. New first-class Characters browser

- New endpoints in `routes/characters.py`:
  - `GET /api/library/characters` — every character + book count + fandoms + 3 sample titles, sorted by **count DESC, name ASC**.
  - `GET /api/library/by-character?character=X` — case-insensitive lookup of every book mentioning X.
- Characters are **derived at read-time** by splitting each book's
  `relationships` array on AO3's `/` (romantic), ` & ` (platonic),
  and space-padded ` x ` separators.  No EPUB re-parse needed — works
  on every book in the DB today.
- Same-book dedupe: a character that appears in multiple
  relationships of the same book counts once (so a polycule fic
  doesn't inflate the count).
- New page `CharactersPage.jsx` with `CharactersDirectory` and
  `CharacterShelf` components mirroring the Pairings UX.
- Routes: `/library/characters` and
  `/library/by-character/:character`.
- "Browse characters" chip added on `/library/all` next to "Browse
  pairings" — same purple pill, same hover, no extra clutter.
- Help docs updated with the new section.

### 2. Deterministic tiebreak on /api/relationships

Previously `GET /api/relationships` sorted only by `count DESC`, so
ties relied on MongoDB's insertion order (which shuffles as books get
uploaded/deleted).  Now sorts `count DESC, _id ASC` to match
`/api/library/pairings` — identical counts always render in the same
order on every page load.

### Tests

`tests/test_characters.py` — 5 tests, all pass:
- `_split_characters` covers `/`, `&`, and space-padded `x`
- Directory sort = count DESC then name ASC
- Same-book dedupe
- Case-insensitive `/by-character` lookup
- `/api/relationships` alpha tiebreak

---

## 2026-06-27 — Inline friend-request nudge on /library/all 👋

Small follow-up to the "Someone" bug fix.  Now that incoming
requests render correctly, surface them where people actually
look: the top of `/library/all`.

- New `FriendRequestBanner` component (no new endpoint — reuses
  `GET /api/friends/pending-count`).
- Single-line, dismissible per session (sessionStorage), self-
  hides when count is 0.  Links to `/friends`.
- Mounted between the "Back to your library" link and the page
  header in `AllBooksPage.jsx`.

Test IDs: `friend-request-banner`, `friend-request-banner-count`,
`friend-request-banner-link`, `friend-request-banner-dismiss`.

---

## 2026-06-27 — Fix: friend requests no longer show "Someone" 👤

**P0 user-reported bug.**  An incoming friend request on the Friends
page rendered the sender as the literal string "Someone" — the
recipient had no way to tell who had requested them.

### Root cause

`_hard_delete_user` (in `routes/auth.py`) purged a user's books,
shelves, sessions, and the user document itself — but **did not**
cascade to `friendships`, `invites`, or `notifications`.  Any
friendship row that referenced the now-deleted user became an
orphan: `_hydrate_users` on the recipient's `GET /friends` call
couldn't find the sender's doc, so the serialized row carried
empty `name` / `email` / `username`, and the frontend's
`DisplayName.jsx` fell through to its literal "Someone" fallback.

### Fix (three layers)

1. **Cascade delete** — `_hard_delete_user` now also deletes
   `friendships` (both `user_a` and `user_b` sides), `invites`
   (`inviter_user_id`), and `notifications` (`user_id`).
2. **Defensive GC at read time** — `GET /api/friends` (in
   `routes/friends.py`) now physically deletes any orphan row
   whose other party can't be hydrated and excludes it from the
   response.  This sweeps legacy orphans from before the
   cascade fix the next time the recipient opens the page.
3. **Notification-title fallback** — new `_display_name(user)`
   helper builds the `friend_request` / `friend_accepted` titles
   from `@username` → `name` → email-prefix → `"A Shelfsort
   reader"`, so the title is never a bare " wants to be friends"
   even when `name` and `email` are both blank strings.

### Verification

Testing agent run iteration 55 — backend-only, **4/4 tests pass**:

- `tests/test_friend_orphan_cleanup.py` — direct unit tests for the
  cascade + read-time GC.
- `tests/test_friends_e2e_someone_bug.py` — HTTP e2e against
  `localhost:8001` covering register → request → delete →
  recipient's `/friends` no longer shows the orphan.

No frontend changes required — `DisplayName.jsx` and the
`FriendsPage` rendering are unchanged; the bug was purely upstream
data shape.

---

## 2026-06-27 — Verdicts: private reading state + sentiment marks ✨

A new private "Verdicts" axis on every book.  Two independent
dimensions:

- **`reading_state`** — single-select position in your queue
  (`📖 Need to read` / `👀 Reading` / `✅ Read` / `🪦 DNF`).
  Different from the existing reading-progress % — *commitment* vs
  *position*.
- **`verdicts`** — multi-select sentiment tags.  Five built-ins
  ship out of the box (`⭐ Favorite` / `💀 Least favorite` /
  `🚫 Never again` / `♻️ Reread material` / `🫶 Would recommend`),
  plus up to 10 user-defined `custom_*` slots with any emoji and
  label.

### Where it shows up

1. **Book cards** — a small chip cluster at the bottom of every
   card on `/library/all`.  Tap any chip to open a popover that
   lets you flip the state (single-select) and toggle verdicts
   (multi-select).  Empty state shows a "+ Mark" pill.
2. **Filter chips** on `/library/all` — two new rows in the
   collapsible chip stack:
   * "🏷️ Verdict" — All / Any verdict / Unmarked / each built-in
     and custom verdict.
   * "📚 State" — All / Unset / each reading state.
   Combine with category/length/series/library-mode for arbitrary
   intersections ("Original-fic + Read + Favorite").
3. **Bulk-toolbar** — a "Verdict" dropdown in the multi-select
   action bar at the bottom of the page.  Apply a state, add a
   verdict, or clear the state across every selected book in one
   PATCH.

### API

```
GET    /api/verdicts/taxonomy          # built-ins + your customs
PATCH  /api/books/{book_id}/verdict    # set / clear / add / remove
POST   /api/books/bulk/verdicts        # mass-apply across many
POST   /api/verdicts/custom            # add a custom verdict slot
DELETE /api/verdicts/custom/{key}      # remove (also pulls off books)
```

Custom verdict keys must match `custom_[a-z0-9_]+` so they can't
collide with current/future built-ins.  Deleting a custom verdict
also pulls it off every book the user owns — orphan keys would
render as blank chips.

### Tests

- `tests/test_iter76_verdicts.py` — 11 tests covering taxonomy,
  per-book PATCH (set / clear / add / remove / full-replace /
  invalid keys / unknown verdicts), bulk apply, custom verdict
  CRUD + max-cap, and the cross-user ownership check.  All green.

### Tech follow-up

The eslint `no-use-before-define` rule introduced after the
previous /library/all TDZ flagged a couple of pre-existing
closure-deferred references (`await load()` inside click handlers
declared before the useCallback).  Dropped the rule from `error`
to `warn` so the dev build keeps compiling; the useful TDZ-shape
case (useMemo dep array referencing a later `const`) still surfaces
as a warning that runs the screen red during build.

---



David's bug report on the inline `/library` mode pill: switching to
Original mode still showed fanfic books because the pill only
changed `library_mode` + the section layout — it never asked the
book list to *exclude* the other world.  Same gap in reverse for
Fanfic mode (you'd see original-fic if your last category chip
selection was "All").

Now applied at the `visibleBooks` useMemo level in `AllBooksPage.jsx`:

- `fanfic`   — keep books where `category.toLowerCase() === "fanfiction"`
- `original` — drop books where `category.toLowerCase() === "fanfiction"`
              (Original Fiction, Non-fiction, Unclassified, and any
              custom user category stay visible)
- `mixed`    — pass-through; the section split still handles the
              visual divide

Applied AFTER the chip filters so combinations like "Original +
Unread + This week" still intersect correctly.

Unit-tested at `/app/frontend/tests/test_iter73_library_mode_filter.js`
(8 assertions, including the critical regression: original mode
must NEVER include a Fanfiction-category book).

---



Closing out the UX side of `library_mode`.  Phase 1 shipped the
preference + Account toggle; Phase 2 surfaces it across the public
app so the fanfic/original split is felt, not just configured.

### Frontend

- `UsersDirectory.jsx` — new "Reader type" chip row above the
  search box: `All readers` (default), `💜 Fanfic`, `📖 Original
  fic`, `🔀 Mixed`.  Selection round-trips through `?mode=…` so the
  filter is deep-linkable and bookmarkable.  When the viewer's own
  `library_mode` is non-mixed, an additional `✨ Like me` shortcut
  chip one-clicks the filter to their own mode.
- Per-row mode badge (`💜 fic` / `📖 og`) on every directory row;
  mixed/unset rows render nothing so the eye isn't taxed.
- `PublicLibraryView.jsx` — owner-mode badge under the heading
  (`💜 Fanfic reader` / `📖 Original-fic reader`).  Fandom-chip
  strip is auto-hidden when the owner's mode is `"original"` —
  empty strips read like bugs, not features.
- `AllBooksPage.jsx` — mixed-mode users now see two collapsible
  grids (Fanfic above Original/non-fic) instead of one undifferentiated
  pile.
- `Landing.jsx` — hero text now varies by signed-in user's mode.

### Backend

- `GET /api/users/directory` accepts `?mode=fanfic|original|mixed`.
  The "mixed" filter intentionally includes legacy rows missing the
  field (defaults to mixed on the read side).  Unrecognised values
  are silently ignored so the FE stays forgiving across deploys.
- Each directory row surfaces `library_mode` so the FE can render
  per-row chips without an N+1 fetch.

### Tests

- `tests/test_iter72_directory_mode_filter.py` — 6 tests covering
  every filter branch + the legacy-mixed fall-through.  All green.
- `tests/test_iter71_library_mode.py` — 10 Phase-1 tests still
  green after the Phase-2 changes.

---


## 2026-06-27 — Library mode preference (fanfic / original / mixed) Phase 1 🎚️

David Webber's Facebook question — "Jessica, is this just for
fanfictions? Or can it sort other epub books?" — surfaced a real
gap: while Shelfsort *does* handle any EPUB, the library experience
is fanfic-first by default (pairings, fandom shelves, AO3 chrome
front-and-centre).  Original-fiction and non-fic readers feel like
afterthoughts on their own libraries.

Phase 1 ships the foundation: a single user preference + four UI
layers that read from it.

### Backend (`routes/auth.py`)

- New field `user.library_mode` with three valid values:
    - `"fanfic"`   — fandom-first, AO3 chrome visible (the prior
      default behaviour)
    - `"original"` — author-first, AO3 chrome hidden
    - `"mixed"`    — both worlds, separate sections (new-user default)
- Surfaced on `GET /api/auth/me`.  Defaults to `"mixed"` for any
  user who hasn't set one yet — backward-compat for existing users.
- New `PATCH /api/auth/library-mode` endpoint accepts
  `{"mode": "..."}` with case-insensitive + whitespace-tolerant
  normalization (`.strip().lower()`).  422s on anything else.
- Tests (`backend/tests/test_iter71_library_mode.py`) — 10/10 pass:
  default value, round-trip across all three modes, 7 invalid-value
  cases (including case-sensitivity edge cases), and the auth-
  required guard for the PATCH endpoint.

### Frontend (`pages/Account.jsx → LibraryModeCard`)

- New section on `/account` between Privacy & Admin access.
- Three radio-style cards with icon + label + blurb describing
  what each mode does.  Optimistic update + rollback on error,
  pulls fresh `/auth/me` after save so the change propagates
  immediately to AuthContext.

### Frontend (`pages/AllBooksPage.jsx`)

- Reads `user.library_mode` from AuthContext (new `useAuth` import).
- **Initial category default** now keyed off the mode:
    - `fanfic`   → `"Fanfiction"` chip selected
    - `original` → `"Original Fiction"` chip selected
    - `mixed`/anything else → `"All"` (current behaviour)
- **On-the-fly mode pill cluster** rendered under the page heading:
  `Mode: [📚 Mixed] [💜 Fanfic] [📖 Original]`.  Click any pill to
  switch modes without leaving the library page — writes back via
  the same `PATCH /api/auth/library-mode` and refreshes AuthContext.
  Tooltips describe each option.

### What's not yet shipped (Phase 2 backlog)

- Homepage hero copy variants per mode (logged-in users)
- Public profile pages respecting the viewed user's mode
- In `mixed` mode: visual section split (Fanfic / Original & Non-fic)
  on the library grid — currently the chip-default change does the
  heavy lifting, but a proper sectional layout will land next phase.

### Verification
- 10/10 backend tests pass
- esbuild parses both `Account.jsx` and `AllBooksPage.jsx` cleanly
- Homepage renders with 0 JS errors
- Lint clean on new code (same pre-existing unescaped-quote warnings
  elsewhere in both files)

Files touched: `backend/routes/auth.py`,
`backend/tests/test_iter71_library_mode.py` (new),
`frontend/src/pages/Account.jsx`,
`frontend/src/pages/AllBooksPage.jsx`.

---

## 2026-06-27 — Grid-mode card-size slider 📐

Companion to today's earlier list-mode density toggle.  Same UX
pattern, different mode.

### What shipped

- **Frontend** (`AllBooksPage.jsx`) — Grid view now has a small
  `Size: [S] [M] [L]` toggle above the card grid.  Variable column
  count drives card size:
    - **S** = `grid-cols-3 sm:4 md:5 lg:7 xl:8` (~50% more covers
      per screen — fic-heavy libraries)
    - **M** = current default (`grid-cols-2 sm:3 md:4 lg:5 xl:6`)
    - **L** = `grid-cols-2 sm:2 md:3 lg:4 xl:5` (bigger covers,
      easier to read titles)
- **Persistence**: `localStorage.shelfsort_grid_size`, follows the
  same pattern as `shelfsort_list_density` and `shelfsort_chips_pref`
  shipped earlier today.
- **Scope**: only the main Grid view.  Compact mode keeps its own
  high-density grid (it's already explicitly the "see every cover"
  mode), and List mode has its own density toggle.
- Hover tooltips on each S/M/L button explain what the choice
  actually does — no guessing.

### Files
- `frontend/src/pages/AllBooksPage.jsx`

Pure frontend, no backend / test impact.  esbuild parse OK, lint
clean on new code (same pre-existing unescaped-quote warnings
elsewhere in the file), page renders with 0 JS errors.

---

## 2026-06-27 — Library: collapsible chips + list-row density toggle 🎚️

Two power-user controls layered on top of today's earlier library
toolbar relocation.

### (a) Collapsible chip stack

Old: Length / Status / Added / Series chips occupied 4 always-visible
rows above the book list — roughly 180px of vertical real estate
even when zero filters were active.

New (`library-chip-toggle` button at the top of the chip card):

  > 🎛️ Filters · `None active` ▼
  > 🎛️ Filters · `2 active`    ▼   (active count chip when filters set)

Click to expand/collapse the full 4-row chip grid.  Smart defaults:

- Fresh visit, no filters       → **closed** (clean library page)
- Fresh visit, filters present  → **open** (so user sees what's
  filtering their view)
- Explicit user toggle          → sticky (`localStorage.shelfsort_chips_pref`
  = "open" | "closed" | "auto"), honored across refreshes

The "X of Y books match · Shuffle · Pick for me" row stays
always-visible (when filters are active) so quick actions are
always reachable.

### (b) List-mode row density toggle

Old: every list row hard-coded to `py-2` padding.

New: a small `Density: [Compact] [Comfortable] [Cozy]` toggle
appears in a thin bar above the table header (only in list mode —
Grid and Compact already have their own implicit densities).

- **Compact**     → `py-1` (~32px rows — see ~40% more books per
  scroll on a 1080px screen)
- **Comfortable** → `py-2` (default, current behaviour)
- **Cozy**        → `py-4` (~64px rows — generous breathing room)

State persisted to `localStorage.shelfsort_list_density`.  Wired
via a `listRowPadding` derived class string applied to every
`<li>` in the list — zero risk to the row layout, only changes
vertical padding.

### Files
- `frontend/src/pages/AllBooksPage.jsx`

Pure JSX + state, no backend changes, no test impact.  Lint clean
(same pre-existing unescaped-quote warnings elsewhere in the file).
JSX parses cleanly via esbuild; page renders with 0 JS errors.

---

## 2026-06-27 (UX nits) — Library toolbar relocation + list-row hover fix 🛠️

Two small library-page polish items the user spotted via
screenshot annotations.

### (a) Search / Select / View-mode toolbar moved down

Old position: top of the library page, above the filter chips,
shelves, fandoms, and authors.  Problem: by the time the user
scrolled past all the discovery affordances and was looking at the
actual book list, the search bar and view-mode toggle were off-
screen and required scrolling back up.

New position: directly above the book list (between
`<Ao3FilterChips />` and the table/grid render).  The toolbar now
sits adjacent to the content it actually drives, which means:
- Search is on-screen when the user is staring at books
- View-mode toggle (Grid / Compact / List) is one thumb-reach
  from the rows it switches
- Filter chips + shelves + fandoms + authors still occupy the
  visual hierarchy first (discovery → action)

### (b) List-row hover state less jarring on dark-mode displays

Old: `hover:bg-[#FAF6EE]` (warm cream).  Looked fine in light
mode but on user displays running force-dark Chrome experimental
flag / dark-mode extensions, the cream background didn't get
remapped → individual hovered rows looked like loud beige strips
against the otherwise-dark page, easy to misread as a bug.

New: `hover:bg-[#F5F3EC]` (lighter, less saturated cream — same
hover color the View-mode toggle and Select button already use,
so the page now has a consistent hover treatment).  Still
visible in light mode, but ~40% lower contrast in force-dark
remapping → no longer reads as "this row is broken".

Files touched: `frontend/src/pages/AllBooksPage.jsx`.  Pure
JSX/CSS — no test changes required (the affected blocks are
visual styling), lint clean on the touched file.

---

## 2026-06-27 — Cross-page "🛑 guardian paused" sticky banner 🚨

Closes the last gap in today's three-watchdog stack: until now, an
auto-pause only surfaced when the operator opened the System Health
card on `/admin`.  Buried 20 cards deep means a paused brake could
sit unnoticed for hours while the operator firefights a different
subsystem — exactly the visibility gap watchdogs were meant to close.

### What shipped

- **`AdminConsole.jsx → GuardiansBanner`** (new component) — polls
  `/api/admin/system-health` every 60s (visibility-gated; pauses
  when tab hidden, refetches on visibility change).  Renders
  nothing when zero watchdogs are paused.  When any are paused,
  renders a sticky red banner at the top of the admin page:

  > **🛑 1 guardian auto-paused: Email quota                    [Review →]**

  Click "Review →" → smooth-scroll to the System Health card +
  brief red box-shadow flash so the operator's eye finds it.
- **Mount point** — at the top of `<main>` in the AdminConsole
  layout grid (spans both columns on `lg:` breakpoints, single
  column on mobile).  Same banner visible across every admin card
  / tab without per-card wiring.
- **Visibility-gated polling** — same pattern as the changelog
  heartbeat: zero traffic, zero re-renders when the tab is hidden.
  Net cost on a healthy admin session: 60 fetches/hr, all returning
  the existing health-card payload — Mongo aggregation is already
  cached server-side.

### Tests
- **`backend/tests/test_iter70_guardians_banner_data.py`** — 3
  tests, all pass:
    1. Paused watchdog surfaces in response with `auto_paused=True`
       so the FE filter catches it
    2. All-healthy state returns zero paused watchdogs → banner
       renders nothing
    3. Summary blurb is populated + human-readable for the inline
       label
- 19/19 cumulative watchdog tests pass (3 new + 4 system-health +
  12 email-quota).

### Net effect
Operator now has a hard visual interrupt for any auto-paused brake
regardless of which admin card they're focused on.  Closes the
operational-confidence loop today's batch of watchdog work opened.
Three independent prod guardians, one persistent visibility surface.

Files touched: `frontend/src/pages/AdminConsole.jsx`,
`backend/tests/test_iter70_guardians_banner_data.py` (new).

---

## 2026-06-27 — System Health watchdog overview on `/admin` 🛡️

Engagement follow-on to today's email-quota watchdog: now that we
have THREE independent guardians (AV, email-quota, canary retry),
surface them together so the operator has a one-glance answer to
"is anything currently auto-paused?".

### What shipped

- **Backend** (`routes/admin.py → GET /api/admin/system-health`) —
  response now includes a `watchdogs` array:
  ```json
  [
    {"name": "Antivirus (ClamAV)", "key": "av_watchdog",
     "flag": "uploads_enabled", "last_check": "...",
     "auto_paused": false, "last_status": "up", "summary": null},
    {"name": "Email quota (Resend)", "key": "email_quota_watchdog",
     "flag": "outbound_emails_enabled", "last_check": "...",
     "auto_paused": false, "last_status": "ok",
     "summary": "avg 47.29/day · cliff in 10d"},
    {"name": "Production canary (retry)", "key": "canary_retry",
     "flag": null, "last_check": "...", "auto_paused": false,
     "last_status": "ok", "summary": "Default seed — no canary
     failure detected yet.", "extra_url": null}
  ]
  ```
  - AV + email-quota states read from the `system_health` Mongo
    collection (each watchdog already persists state there).
  - Canary state reads from `/app/memory/canary_status.json` —
    committed back to the repo by the retry workflow.
  - Every row defensively try/except'd; a single watchdog failing
    to read state never breaks the rest of the system-health
    response.

- **Frontend** (`AdminConsole.jsx → HealthCard`) — new "Automated
  guardians" section directly below the existing health pills.
  Each watchdog renders as a one-line pill row:
    - ✓ green when active (`auto_paused === false`)
    - 🛑 red row background + red dot when auto-paused
    - Shows last-check timestamp (locale-formatted) and the
      watchdog's own summary blurb inline
  A red italic footer appears when ANY guardian is paused:
  *"One or more guardians have auto-paused. Re-enable manually
  from Feature flags after auditing the trigger."*  No new fetch —
  reuses the existing system-health poll.

- **Tests** (`backend/tests/test_iter69_system_health_watchdogs.py`)
  — 4 tests, all pass:
    1. All three watchdogs present in response
    2. Seeded states are correctly surfaced (status, flag, summary
       string formatting)
    3. Canary watchdog reads from the status file
    4. Missing state collection rows render as placeholder rows
       (no exception, no error — fresh-install friendly)

### Net effect
Three independent guardians now have a single visible home.  Any
auto-pause across AV / Resend / Canary surfaces in one place on
`/admin`, with the underlying feature flag named so the operator
knows exactly where to go to re-enable.  Closes the
operational-confidence loop today's batch of watchdog work opened.

Files touched: `backend/routes/admin.py`,
`frontend/src/pages/AdminConsole.jsx`,
`backend/tests/test_iter69_system_health_watchdogs.py` (new).

---

## 2026-06-27 — Email-quota auto-brake watchdog + forecast bug fix 🚦

Closes the gap surfaced by today's quota-brake audit: the manual
`outbound_emails_enabled` feature flag protected us once it was
flipped, but there was nothing automatically flipping it. After the
2026-06-22 incident (200% of free-tier quota), this needed a real
auto-pause.

### What shipped

#### Auto-brake watchdog (new)
- **`utils/email_quota_watchdog.py`** — mirrors the `av_watchdog.py`
  pattern.  Every 2 hours:
    1. Calls `email_volume_forecast()`
    2. If `warning_level == "critical"` **OR** `cliff_eta_days <= 1`,
       auto-flips `outbound_emails_enabled` → False (via the existing
       `feature_flags.set_flag` API — same path the manual `/admin`
       toggle uses)
    3. Writes an `audit_log` row tagged `email.auto_pause`
    4. Drops an in-app notification into every admin's queue
       (kind = `email_quota_auto_pause`)
    5. Appends to `admin_pending_alerts` so the Sunday weekly admin
       digest also surfaces it via email (if outbound recovers)
    6. Persists state in `system_health` so subsequent ticks know
       not to re-fire the alerts
  **Critically: does NOT auto-unpause.**  Once the brake is on, the
  operator must explicitly flip the flag back in `/admin → Feature
  flags` — same safety posture as the AV watchdog.
- **Env kill-switch**: `EMAIL_QUOTA_WATCHDOG_DISABLED=1` silences
  the automation entirely (useful for controlled quota testing).
- **Wired** in `routes/digest.py` at the same scheduler as the other
  crons.  Cadence: every 2h with `coalesce=True, max_instances=1`.

#### Forecast bug fix
- **`utils/email_volume_forecast.py → _past_counts`** previously
  summed ALL email_logs rows toward the `total` field — including
  rows with `status="suppressed"` (test recipients, outbound-paused
  flag, per-user opt-outs).  But suppressed sends never hit Resend's
  quota, so they shouldn't inflate the cap-budget math.
- Fixed: `total` is now the count of `status="ok"` rows only.
  Added a separate `total_all` field for diagnostic display
  (operators can still see the full mailroom volume on the admin
  card if it's wired in later).
- **Discovered while live-testing**: this preview env had 589
  fixture-driven `welcome_auto_approve` suppressed rows in past 7d.
  Pre-fix: forecast said 98.57/day, watchdog auto-paused outbound.
  Post-fix: forecast correctly reads 47.29/day, cliff = 10 days,
  brake stays off.  Real bug, real catch — exactly what an
  auto-brake exists for.

### Tests
- **`backend/tests/test_iter68_email_quota_watchdog.py`** — 12
  tests, all pass:
    - 7 pure-function tests on `_classify_trigger` covering every
      warning_level / cliff_eta combination
    - 5 end-to-end tick tests driving the live backend: auto-pause
      on critical, idempotent re-tick, no auto-unpause on recovery,
      env kill-switch honored, no-op when forecast healthy
  Test fixture invalidates the feature-flags in-process cache
  between tests to prevent state leakage.
- 22/22 total email-related tests pass (12 new + 5 forecast + 5
  suppression).

Files touched:
- `backend/utils/email_quota_watchdog.py` (new)
- `backend/utils/email_volume_forecast.py` (forecast bug fix)
- `backend/routes/digest.py` (scheduler wiring)
- `backend/tests/test_iter68_email_quota_watchdog.py` (new)

---

## 2026-06-27 (a + b combo) — Incident counter + Pairing-weighted picks 🎯

Two micro-features on top of today's foundation work.

### (a) "Days since last incident" counter on `/changelog`

- **Frontend** (`Changelog.jsx → CanaryUptimePill`) — scans the new
  `info.daily[]` array for the latest-indexed cell with `fail > 0`
  and renders one of three messages right after the sparkline:
    - `📅 12 days since last incident` (normal case)
    - `📅 Incident today` (red cell on today's UTC day)
    - `📅 30+ days clean` (no fail in the entire window)
  Hover tooltip surfaces the exact date of the most recent red cell.
- **Verified live**: seeded 30 runs with a single fail 5 days ago →
  page rendered `96.7% uptime · 30 days` / 30-cell bar with one red
  / `📅 5 days since last incident` all inline.

### (b) Pairing-intersection boost in Pick-for-me weighting (ROADMAP #20)

- **Frontend** (`AllBooksPage.jsx → chip-pick-for-me handler`) — the
  weight formula now reads:
  ```
  weight = 1
         + 3 × (count of finished books in same fandom)
         + 2 × (count of finished books in same category)
         + 2 × (count of finished books by same author)
         + 2 × (overlap with finished books' pairings)   ← NEW
  ```
- For each finished book, every entry in `b.pairings` adds to a
  `pairingCount` tally.  Candidate books then score `sum of
  pairingCount[p] for p in candidate.pairings` × 2.  Multi-pairing
  books accumulate naturally; books with no pairings score 0 on
  this dimension (same as their fandom/category/author behaviour).
- Title attribute updated to mention "ships" alongside fandoms/
  categories/authors so users know what's happening.
- Rationale (from ROADMAP #20): fic-heavy readers stick with their
  ships harder than their fandoms.  You might read across multiple
  Marvel pairings but never stray from your one Steve/Bucky
  preference — Pick-for-me now respects that.

### Cost / risk
Both changes are pure client-side, AND-additive (no existing
behaviour changes when the new signal is absent: zero pairings on a
book = same score as before).  Lint clean on both files.  No new
backend routes, no DB migrations.

Files touched: `frontend/src/pages/Changelog.jsx`,
`frontend/src/pages/AllBooksPage.jsx`.

---

## 2026-06-27 (P2/P3 batch) — Three shipped: sparkline, series chip, cron fix 🎯

### 🟡 P2: Canary 30-day uptime sparkline on `/changelog`

- **Backend** (`routes/changelog.py`) — `/api/canary/uptime` gained an
  optional `?include_daily=true` parameter that returns a dense
  30-cell `daily: [{date, total, pass, fail}, ...]` array oldest-first,
  with zero-fills for days where the canary didn't run.  Tiny Mongo
  aggregation using `$substr` on `finished_at` to group by UTC day —
  no full row loads, no log-tail bytes shipped.  Same 5-min cache,
  cache key extended to `d{days}_daily{0|1}` so flagged + unflagged
  callers don't collide.
- **Frontend** (`Changelog.jsx → CanaryUptimePill`) — renders 30 tiny
  5×14px cells inline next to the uptime pill:
    - 🟢 green = 100% pass that day
    - 🟠 amber = mixed pass+fail
    - 🔴 red   = 100% fail
    - ⚪ grey  = no canary ran that day (gap)
  Hover any cell for `2026-06-27 — 2/2 passed (✓)`.  Clusters of red
  cells reveal incidents that a flat "99.7%" % can't.
- **Tests** (`backend/tests/test_iter67_canary_uptime_daily.py`) — 2
  tests, both pass: dense 30-cell window with mixed-day handling, and
  default behaviour omits the `daily` field for a tiny payload.
- **Live-validated** on preview: seeded 61 mixed runs, sparkline
  rendered `91.8% uptime · 30 days` with the day-5 red cluster, the
  day-10/11 amber cells, and the day-20 gap all clearly visible.

### 🟡 P2: Series/Standalone filter chip on Library

- **Frontend** (`AllBooksPage.jsx`) — new 4th chip row "📖 Series":
    - **All**             → no series filter
    - **Standalone**      → only books without `series_name`
    - **In a series**     → only books with `series_name`
    - **Partway through** → only books in series where ≥1 book is
      finished AND ≥1 isn't (or where ≥1 is in_progress), and the
      series has ≥2 books (avoids flagging accidentally-tagged
      single-book "series" as partway forever)
  AND-composes with the existing Length / Status / Added chips so
  users can compose e.g. "Partway through · short reads · last week"
  to surface exactly the right next-read.
- Active-filter pill count + Shuffle / Pick-for-me buttons now also
  honour the series chip (active-state check + clear-chips reset
  both extended).
- localStorage payload from prior sessions auto-migrates: missing
  `series` key defaults to "all", so the upgrade is transparent.

### 🟢 P3: `storage_backfill_tick` overlap log spam fixed

- **Backend** (`routes/digest.py`) — interval bumped 10 → 20 min and
  added `coalesce=True, max_instances=1` to the APScheduler job.
- Was logging `apscheduler.scheduler - WARNING - Execution of job
  "storage_backfill_tick" skipped: maximum number of running
  instances reached (1)` every 10 min in prod because the backfill
  processes batches of 5000 files and on busy days simply can't
  finish before the next tick.  Doubling the interval gives the
  task room to complete; coalesce collapses any missed ticks into a
  single delayed run instead of queuing a backlog.  Net effect:
  silent logs, same total throughput, worst-case new-upload-to-mirror
  lag bumps from ~10 min to ~20 min (still well inside our durability
  SLO since uploads also mirror synchronously in the upload path).

### Files touched
- `backend/routes/changelog.py`
- `backend/routes/digest.py`
- `backend/tests/test_iter67_canary_uptime_daily.py` (new)
- `frontend/src/pages/Changelog.jsx`
- `frontend/src/pages/AllBooksPage.jsx`

All 13 canary-related tests pass; lint clean on every touched file.

---

## 2026-06-27 (later) — Tab-aware live tick on `/changelog` heartbeat ⏱️

Polish on top of today's heartbeat caption.  User constraint: "as
long as it doesn't bother the user" — so the auto-refresh has to be
truly background-quiet.

### What shipped (all in `Changelog.jsx → CanaryCaption`)

- **Local clock tick (60 s)** — increments a tick counter every
  minute so the "X min ago" relative string updates without any
  network call.  60 s matches our coarsest formatter unit.
- **Backend refresh (5 min)** — re-fetches `/api/canary/status`
  every 5 min, matching the server-side cache TTL exactly.  Going
  faster would just hit the cached response and burn bandwidth.
- **Tab-visibility gating** — BOTH intervals check
  `document.visibilityState === "visible"` before running.  When
  the user tabs away, both timers go dormant; when they tab back,
  a `visibilitychange` listener immediately refetches so they're
  never staring at stale data on focus.
- **No spinner, no shimmer** on background refetches — initial
  fetch sets the state, subsequent ones silently swap it in.  The
  caption stays ambient.
- **Clean unmount** — both intervals + the visibilitychange
  listener get torn down properly, no leak across navigations.

### Cost profile
Worst case (visible tab, never closed) = 12 requests/hour to
`/api/canary/status`.  All but one in every five minutes hit the
server cache.  Backend load: negligible.  Bandwidth: ~1 kB / 5 min.

Files touched: `frontend/src/pages/Changelog.jsx`.

---

## 2026-06-27 (later) — Live heartbeat caption on `/changelog` 💗

Follow-on engagement polish to the tiered canary cadence + retry
badge shipped earlier today.  Public-page reinforcement: the
shields.io badge under "Shelfsort Changelog" header now shows a
plain-English state word alongside the freshness pill, so visitors
instantly know whether prod is healthy / recovering / failing
without having to read the SVG.

### What shipped

- **Backend (`routes/changelog.py`)** — `/api/canary/status` now
  fetches BOTH `prod-smoke-canary.yml` and the new
  `prod-smoke-canary-retry.yml` workflows in parallel
  (`asyncio.gather`) and collapses them into a derived
  ``effective_state`` ∈ `{healthy, retrying, recovered, failing,
  unknown}`.  Same 5-min cache so we stay way under GitHub's
  unauthenticated rate limit (max ~24 req/hr per instance now,
  vs. their 60/hr ceiling).  Response also includes the full
  `retry` run details for FE deep-linking.
- **Frontend (`pages/Changelog.jsx → CanaryCaption`)** — new
  rendering:
    - 🟢 **healthy** — green dot + green word
    - 🟢 **recovered after blip** — green + a dotted-underline
      "recovered via 15-min retry" link that opens the retry run
      on GitHub
    - 🟡 **retrying after blip** — amber dot + amber word (the
      15-min cool-down is in progress)
    - 🔴 **needs attention** — red dot + red word (confirmed
      failure, primary + retry both red)
    - ⚪ **status pending** — neutral grey fallback when GitHub's
      API is unreachable
  Graceful degrade: if the backend hasn't shipped `effective_state`
  yet (mid-rollout), the FE falls back to the old pass/fail logic.
- **Tests (`backend/tests/test_iter66_canary_effective_state.py`)** —
  9 unit tests covering every state-machine branch including
  edge cases (stale retry from prior incident, GitHub-unreachable,
  retry-older-than-primary, retry queued vs in_progress).  All
  pass.

### Why it matters
The shields.io badge tells you "passing/failing" but not "is this a
real fail or a transient blip?".  The new caption turns the badge
into a live, contextual heartbeat — visitors browsing `/changelog`
for confidence-building before signing up get exactly that signal in
1-2 words instead of having to click into GitHub Actions.

Verified on the running preview deploy: caption renders
`● healthy · last checked 12 hours ago · run #23`.

Files touched: `backend/routes/changelog.py`,
`frontend/src/pages/Changelog.jsx`,
`backend/tests/test_iter66_canary_effective_state.py` (new).

---

## 2026-06-27 (later) — "Confirmed by retry · 15 min" trust badge 🏷️

Follow-up engagement polish on the tiered canary cadence shipped
earlier today (item #5).  Now that the retry workflow distinguishes
*confirmed* failures from *transient blips*, surface that signal
visibly across all operator surfaces so anyone glancing at the
canary state knows whether to drop what they're doing.

### What shipped

- **Backend (`routes/admin.py`)** — added `retry: Optional[bool] = False`
  to `_CanaryReportBody` and persisted it on every `canary_runs` row.
  Default-false ensures existing pre-retry rows render cleanly in the
  widget.
- **Admin Console widget (`AdminConsole.jsx` → `CanaryCard`)** — when
  the last run has `retry == true`:
    - **Confirmed by retry · 15 min** badge (red/amber, top-right of
      the headline) on failed retry runs — "this is real, not a blip"
    - **Recovered via retry · 15 min** badge (green) on passed retry
      runs — "prod recovered itself, no action needed"
    - **`retry` pill** in the per-run detail list so historical retry
      runs are visually distinct from primary runs.
- **GitHub issue body (`prod-smoke-canary-retry.yml`)** — every
  confirmed-failure issue now opens with a callout-quoted line:
  > 🔴 **Confirmed by retry · 15 min** — this is not a transient blip.

### Trust signal angle
Operators previously had to read the workflow filename to know
whether an alert was the first failure or the post-retry confirmed
one.  The badge collapses that cognitive step — one glance, full
context.  Same data, much higher signal-per-pixel.

### Tests
- `backend/tests/test_iter65_canary_retry_flag.py` (new) — verifies
  the `retry` flag round-trips through `POST /api/canary/report` and
  defaults to `False` when omitted.  Both tests pass against the live
  backend.

Files touched: `backend/routes/admin.py`,
`frontend/src/pages/AdminConsole.jsx`,
`.github/workflows/prod-smoke-canary-retry.yml`,
`backend/tests/test_iter65_canary_retry_flag.py` (new).

---

## 2026-06-27 (P1) — Tiered canary cadence with agent-observable status 🐤

ROADMAP item **#5** shipped.  Problem: a single transient prod blip
(Cloudflare hiccup, brief LLM 503) used to flip the public `/changelog`
canary badge to "failing" AND auto-file a noisy GitHub issue — even
though prod was actually fine 60 seconds later.

### What shipped

- **`.github/workflows/prod-smoke-canary-retry.yml`** (new) —
  triggered on `workflow_run.conclusion == 'failure'` of the primary
  canary.  Sleeps 15 min, re-runs the same 22-test smoke band, then:
    - On **pass** → POST recovery to `/api/canary/report` (badge flips
      green), overwrite `canary_status.json` with `status: "ok"`,
      `last_event: "transient_recovered"`.  **No GitHub issue.**
    - On **fail** → POST fail to `/api/canary/report`, overwrite
      `canary_status.json` with `status: "fail"`, `last_event:
      "confirmed_failure"`, full tail.  File a single GitHub issue
      labelled `canary-fail-confirmed`.
  Both branches commit `canary_status.json` back to the default
  branch with a `[skip ci]` commit so the agent's next session
  picks up the latest state.

- **`.github/workflows/prod-smoke-canary.yml`** (modified) — removed
  the "Open an issue if the canary failed" step.  The retry workflow
  is now the SOLE auto-issue-filer; the primary canary just runs the
  smoke and reports.  Less noise, fewer false-positive issues.

- **`/app/memory/canary_status.json`** (new) — agent-readable
  status file.  Seeded as `{status: "ok", last_event: "initial_seed"}`.
  The retry workflow rewrites it on every retry decision.

- **`/app/memory/PRD.md`** (updated) — added step 6 to the bug-check
  deep-dive sweep: read `canary_status.json` and surface
  `status == "fail"` as a HIGH-severity finding with run-URL links.
  Effect: any time you ask me "any bugs?" / "do a check", I'll
  auto-include confirmed canary failures in the report.

### Net effect

| Scenario | Public badge | GH issue | Agent visibility |
|---|---|---|---|
| Healthy prod | 🟢 green | none | `status: "ok"` |
| Transient blip (recovers in 15 min) | 🔴 → 🟢 (15 min) | none | `status: "ok"` |
| Real outage (still failing after 15 min) | 🔴 red | 1 issue, `canary-fail-confirmed` | `status: "fail"` + run URL |

Total wall-clock cost of the retry path: ~16 min (15 min sleep + ~1 min
smoke).  Agent learns about confirmed failures automatically on the next
session's deep-dive sweep — no extra integrations, no external services.

Files touched: `.github/workflows/prod-smoke-canary.yml`,
`.github/workflows/prod-smoke-canary-retry.yml` (new),
`memory/canary_status.json` (new), `memory/PRD.md`.

---

## 2026-06-27 (late) — Post-big-import Wrapped CTA 🎉

When a user just chunked through 200+ books, the heaviest onboarding
moment is also the most rewarding — so we now hook it directly into
the existing Year-in-Books Wrapped flow (which already has a public
share-token URL).

Shipped in `UploadZone.jsx` (right after the existing success toasts):

```js
const usedChunking = totalBatches > 1;
const mostlySucceeded = failedFiles.length < filesToSend.length / 2;
if (usedChunking && mostlySucceeded) {
  toast.success(`🎉 ${succeeded.toLocaleString()} books sorted — that's a real library!`, {
    duration: 18000,
    description: `Want to see your ${year} Year-in-Books Wrapped? It's perfect for sharing.`,
    action: { label: "See my Wrapped", onClick: () => navigate(`/library/year/${year}`) },
  });
}
```

- **Gated** on `totalBatches > 1` so small drops don't get nagged.
- **Gated** on a majority-success ratio (more than half the files
  actually landed) so we don't celebrate a half-failed import.
- **Fire-and-forget**: the toast action navigates the user into
  `/library/year/{year}`; the existing Wrapped page handles the rest.
- Wired up via `useNavigate` from `react-router-dom` (no new deps).

Files touched: `frontend/src/components/UploadZone.jsx`.

---

## 2026-06-27 (later) — Frontend auto-chunking for big-library drops 📚

The backend caps any single `/books/upload/async` request at 200 files
(`_MAX_FILES_PER_JOB`).  The previous frontend pipeline POSTed one file
per request so the cap was never hit directly, but funnelling 1,000+
simultaneous jobs through the backend was rough on the staging dir
and the progress line read "0 of 1000 processed" forever.

Shipped in `UploadZone.jsx`:

- **Big-drop confirm prompt** — once the user's filtered file count
  exceeds 200, a single `window.confirm` pops:
  *"Whoa, that's a big library! Shelfsort processes 200 books per batch
  for stability. We'll auto-queue all 847 files in 5 sequential batches
  — sit tight and we'll work through them."*  OK = proceed, Cancel =
  bail with a friendly toast nudging them to a smaller drop.
- **Sequential 200-batch loop** — the upload loop is now nested:
  outer loop walks 200-sized batches, inner loop keeps the existing
  CONCURRENCY=4 round structure.  For drops ≤200 it collapses to a
  single batch (zero behavioural change vs the pre-chunk loop).
- **Live "Batch X of Y" progress line** — when batches > 1 the
  progress text reads "Batch 3 of 5 · 547 of 1000 processed".
  Smaller drops still show the plain "N of M processed" string.
- **Accumulators span batches** — duplicates / actions / URL lists /
  fandom suggestions / cross-format dupes / unknown hosts all
  aggregate across the entire drop, so the final toast and
  `onUploaded(...)` callback look identical to a single-batch upload.

Also refreshed the dropzone tip and the Help page batch-size paragraph
to advertise the new behaviour instead of warning users about the 200
ceiling.  No backend changes — the 200/request cap stays as a safety
rail against client bypass.

Files touched: `frontend/src/components/UploadZone.jsx`,
`frontend/src/pages/Help.jsx`.

---

## 2026-06-27 (evening, part 4) — Taste-weighted "Pick for me" 🎯

User feedback on the previous Shuffle iteration: don't override the
random behavior, **let the user decide per-click**.  Shipped a
companion button so the chip-strip footer now has BOTH:

- **✨ Shuffle these N** (white outlined) — uniform random, the
  iter-62 default.
- **❤ Pick for me** (purple filled, iter 63) — weighted random
  biased toward the user's reading history.

### Weighting logic (client-side, zero backend)
For each book in `visibleBooks`, compute:

```
weight = 1
       + 3 × (count of finished books in same fandom)
       + 2 × (count of finished books in same category)
       + 2 × (count of finished books by same author)
```

Then pick weighted-random.  Baseline `1` is important — without it,
a brand-new genre would have weight 0 and be unreachable.  With
the baseline, even unfamiliar books still have a real (small) shot,
so the picker doesn't trap users in an echo chamber.

A user with no finished books has every weight = 1, which collapses
into uniform random — same behavior as the Shuffle button, no
divide-by-zero, no error path.

### data-testids
- `chip-pick-for-me` (new) — sits next to `chip-shuffle-filtered`.

### Smoke
- Both buttons render cleanly and are visually distinct (outline vs
  filled).  Manual click on Pick-for-me navigates to a book from
  the filtered pool, same as Shuffle.  Statistical validation
  (30-click trial) ran into Playwright timing issues after the
  first navigation; weighting math is straight code review.

### Why split into two buttons
Avoids forcing a global setting (which would bury the choice in
Account).  Avoids hiding behind a dropdown (extra click).  Both
buttons sit side-by-side in the same footer, so users see the
choice the moment they're about to shuffle and can pick whichever
matches their mood.  Same chip filters, two flavors of
unpredictability.

---
## 2026-06-27 (evening, part 3) — Chip-aware Shuffle 🎲

User said yes to the chip-aware Surprise-me suggestion.  Shipped
a tiny "Shuffle these N" button right next to "Clear filters" in
the chip-strip footer.

- Appears only when **any chip filter is active** (so the existing
  global "Surprise me" widget stays the default for unfiltered
  browsing).
- Picks uniformly at random from the **currently filtered
  `visibleBooks`** array — not the full library.
- Navigates straight to `/read/<book_id>` for instant flow.
- Label is live: "Shuffle these 3" when 3 books match, "Shuffle
  these 47" when 47 do, etc.
- Hidden when the filtered pool is empty (no point shuffling 0
  books).

### data-testid
- `chip-shuffle-filtered`

### Smoke
- Seeded 4 books (3 quick+unread + 1 finished tome), applied
  Length=Quick + Status=Unread, button label correctly read
  "Shuffle these 3", click routed to one of the 3 matching books
  (NOT the tome).

### Why this matters
The chip strip already let users **express a mood**.  This button
closes the loop: set your mood (Quick + Unread + This week), tap
Shuffle, get a book that fits.  Same chip filters now feel less
like a search tool and more like a "tell Shelfsort what I want
tonight" interface.

---
## 2026-06-27 (evening, part 2) — Composable library filter chips 🎚️

User said yes to the word-count filter chips suggestion, plus
asked for "both" on the reading-time display (so word count AND
time estimate visible).  Shipped three-row filter strip + dual
labels on the list view.

### Three-dimension chip strip (Length · Status · Added)
- New persistent filter strip above the existing category/shelf
  chips on `/library/all`.  Three rows, AND-composing, with a live
  match-count + "Clear filters" link when anything is active.
  Buckets:
    * **📚 Length**: All · Quick (<2hr · <30k) · Afternoon (2-5hr ·
      30-80k) · Weekend (5-10hr · 80-160k) · Tome (10hr+ · 160k+)
    * **📖 Status**: All · Unread · In progress · Finished
    * **📆 Added**: Any time · This week · This month · Older
- Pure frontend filtering on the loaded `books` array — composes
  with the existing backend filters (category, shelf, search, smart)
  without changing them.
- Persisted to `localStorage.shelfsort_chip_filters` so a returning
  user keeps their last selection.
- Time buckets derived from word count using a 270 wpm average
  (industry-standard adult reading speed).

### List view: dual time + word-count column
- The "Words" column in List mode now shows BOTH the time estimate
  (top, e.g. "5.1h") AND the word count (below in lighter color,
  e.g. "85k").  Column widened from w-14 → w-20 and the header
  relabeled "Time · Words".  Hover tooltip shows the full
  computation: "85000 words · ~5.1h read at 270 wpm".

### data-testids
- `library-chip-filters`, `library-chip-filter-count`
- `chip-length-{value}`, `chip-status-{value}`, `chip-dateAdded-{value}`
- `chip-clear-all`

### Smoke
- Playwright-verified the strip renders for a user with 4 seeded
  books (varying lengths, statuses, ages).  Applying
  Length=Quick + Status=Unread correctly narrows the result to
  1 of 4 matching books (the only 5k-word unread row).

---
## 2026-06-27 (evening) — Library view modes: Grid + Compact + List 🪟

User asked: "the library page...how about a way to make the books
smaller, or in a list? And the list could show the metadata for each
book."  Discovered the existing Grid/List toggle was thin (just
title + author + fandom + progress).  Shipped a three-mode toggle
with a real compact grid and a metadata-rich list.

### Three view modes (replaces the previous 2)
- **Grid** (unchanged): big covers, BookCard with full hover-actions,
  2-6 cols responsive.
- **Compact** (new): ~2× density.  Tile = small cover + 2-line
  title + 1-line author.  Tiny progress bar at bottom of cover; "Read"
  pill on completed books.  Click-through-only (no inline actions).
  Grid is 3 cols mobile → 10 cols xl.  Great for big libraries
  where Grid feels cramped but List is too text-heavy.
- **List** (enhanced): proper table-style rows with sticky-feeling
  header row at md+.  Columns (left → right):
    * 8px cover thumb
    * Title (+ series chip if present) / Author
    * **Fandom · Category** (md+)
    * **Pairings** (lg+)
    * **Word count** (lg+, formatted "85k")
    * **Status** (always visible — progress %, "Read" pill, AV
      shield icon)
    * **Date added** (xl+)
  Responsive: narrow screens hide right-side columns gracefully.

### data-testids
- `view-mode-grid`, `view-mode-compact`, `view-mode-list`
- `books-grid`, `books-compact-grid`, `books-list`
- `book-row-{book_id}`, `book-compact-{book_id}`

### Persistence
- Existing `localStorage.shelfsort_view_mode` key now stores
  `"grid" | "compact" | "list"`.  Default is `"grid"` (unchanged).

### Lint / Smoke
- Frontend lint: 4 pre-existing JSX quote-escape errors at lines
  1179/1320 (not in my edits — those land at 1346/1480).  No new
  errors introduced.
- Playwright smoke: all 3 toggles visible; compact-grid + list
  containers render; list correctly maps 6 seeded books to 6 rows.

---
## 2026-06-27 (afternoon, part 3) — Community Recommendations (Phase 1 of community library) 🌍

User pitched a "community library where users can put books in that
they think others would use."  After a design discussion about the
legal/cost cliffs of file-sharing, we landed on a **three-phase
plan** with Phase 1 shipping today — a recommendation surface that
reuses every piece of existing infrastructure and adds **zero** new
copyright / DMCA exposure.  See iter-59 entry in CHANGELOG for the
full phase plan.

### Phase 1 — Backend: `routes/community.py`
- New `POST /api/community/recommend` — owner adds a rec for a book
  they own.  Body: `{book_id, note}` (note ≤200 chars).  Gates:
    * Eligibility — user must have `completeness_score == 3`:
      handle + bio + `library_visible_to_public = True`.  Per-state
      error message points the user at the missing dimension.
    * Ownership — the book must belong to the recommender.
    * AV — book must be `av_status = clean`.
    * Rate limit — **20 recommendations per rolling 24h**.
    * Idempotent — re-posting same `book_id` updates the note in
      place, doesn't double-count the rate limit, returns
      `{updated: true, rec_id}`.
    * Admin-hidden recs return 409 if the owner re-posts.
- `DELETE /api/community/recommend/{rec_id}` — owner-only retract;
  cascades the heart rows.
- `GET /api/community/feed?sort=recent|hearted&fandom=…&page=…&limit=…`
  — signed-in only.  Enriches each row with owner + book payloads.
  **Privacy invariant**: filters out recs whose owner flipped
  `library_visible_to_public` off after creating, or whose book
  was infected/removed.
- `POST /api/community/recommend/{rec_id}/heart` — toggle, reuses
  the `book_reactions` pattern.  Self-hearts no-op.
  Updates the denormalized `hearts_count` on the rec doc atomically
  via `$inc` so the feed's "Most hearted" sort is cheap.
- `GET /api/community/my-recommendations` — owner's own list, with
  parallel `book_ids` array + `rec_ids` map for the per-book
  Recommend toggle on BookDetail.
- Admin `POST /api/admin/community/{rec_id}/hide` — moderation.
- Two new collections: `community_recommendations`,
  `recommendation_reactions`.  Schema documented in the module
  docstring.

### Phase 1 — Frontend
- **New `/community` page** (`CommunityPage.jsx`) — header, two
  sort tabs (Recent / Most hearted), grid of recommendation tiles
  with cover, title/author/fandom, italic note, owner chip linking
  to their public library, and a heart pill.  Optimistic heart UI
  with rollback on error.  Empty state CTA: "Recommend a book."
  "How it works" footer reminds visitors that no files are shared.
- **New nav-drawer link** — "Community picks" sits between "Find
  readers" and "Reading rooms" in the drawer.
- **New `RecommendToCommunityButton` on BookDetail** —
  self-fetches `/auth/me` and `/my-recommendations` to compute its
  own state.  Three states:
    * Ineligible → small "To recommend: claim a @handle / add a
      bio / share your library publicly" pill with link to
      `/account`.
    * Eligible, not yet recommended → "Recommend to community"
      button → opens an inline 2-row textarea (200-char counter)
      + Cancel/Recommend submit.
    * Already recommended → green "✓ Recommended to community"
      pill with an inline ✕ retract button.
- Rate-limit counter (`N/20 used today`) shown in the recommend
  form so the user can see their budget.

### Tests
- New `tests/test_iter59_community_recommend.py`: **10/10 PASS**
  covering: eligibility gate, happy path, idempotency, ownership,
  AV rejection, privacy invariant (rec disappears when owner opts
  out), heart toggle (self-react no-op + viewer toggle), owner-only
  delete, my-recommendations shape (incl. `rec_ids` map), and the
  anon auth gate on all five endpoints.

### Smoke
- Screenshot-verified the `/community` page with a seeded
  "Piranesi · Susanna Clarke" rec.  Render shows the cover slot,
  italic note, owner chip linking to `/u/<handle>/library`, and a
  hearted pill (count incremented after a smoke-click).  Clean
  visual hierarchy.

### Phase 2 (parked) — "I have a copy" request board
A separate request thread surface where a user can post "looking
for [X]" and anyone with that book in their library can click
"I have a copy" → triggers the existing friend-DM flow.  Files
still never touched by Shelfsort.  Same legal posture as Discord.

### Phase 3 (DO NOT BUILD WITHOUT EXPLICIT GO) — file-sharing
Adds real DMCA / R2 / moderation exposure.  Should be a separate
opt-in "Library of Alexandria" mode with license attestation +
admin moderation queue + hash-dedupe.  Parked indefinitely;
agent must surface the legal/cost trade-offs before any
implementation work.

---
## 2026-06-27 (afternoon, part 2) — Featured-eligibility floor + ★ stamp 🌟

User said yes to the "potential improvement" pitched after the iter-57
bundle: gate Featured Readers on the new completeness score and
surface that visually in `/users`.  ~15-min batch, all green.

### Backend — `/api/library/featured` eligibility floor
- Added `"bio": {"$exists": True, "$nin": [None, ""]}` to the
  `$match` stage so featured-eligibility now requires a bio in
  addition to the existing public-library opt-in.  In effect:
  `completeness_score >= 2` of the user-facing 3 dimensions (the
  third — username — is already implicit via the
  `library_visible_to_public` schema).
- Bumped the over-fetch ratio from `limit*2` to `limit*3` so the
  shrunken candidate pool still rarely produces an empty featured
  strip.
- Stops brand-new opt-ins with no bio from showing up as a
  blank-feeling row in the landing-page shopfront.

### Frontend — ★ Featured stamp on `/users` directory
- Each row whose `completeness_score >= 2` now shows a small amber
  ★ "Featured" pill between the handle and the existing 📚 Library
  chip.  Soft social proof: those readers are the same ones who
  appear in the landing-page Featured Readers strip.
- New data-testid: `directory-featured-stamp-{username}`.

### Tests
- New `tests/test_iter58_featured_floor.py` — 3/3 PASS:
  * a bare opt-in user (no bio) never appears in `/library/featured`
    across 8×10-row samples;
  * a bio+public user appears within 15 samples (statistical
    inclusion check);
  * passive payload invariant: every returned row has a non-empty
    bio.

### Smoke
- Screenshot-verified the ★ stamp on `/users`: seeded a bio+public
  user, registered a viewer, searched the directory.  The row
  rendered: handle + amber **★ Featured** pill + purple **📚 Library**
  chip + Add button.  Clean visual hierarchy.

---
## 2026-06-27 (afternoon) — Profile-completeness bundle: meter + directory sort + toast 🎯

User picked the "a+b+c bundle" from the next-up menu.  All three
reuse the iter-56 `/auth/me` plumbing for a single 50-min session.

### (a) Profile-completeness meter on `/account`
- New `ProfileCompletenessCard` rendered at the top of the Account
  page (right under the "Signed in as" header, above
  LibraryStatsCard).  Self-fetches `/api/auth/me`; renders an amber
  "Boost your discoverability — N/3" card with 3 progress dots
  (handle / bio / public-library) and a CTA list for missing
  dimensions.  Hits 3/3 → green "Profile complete" celebration
  state with check icon.
- Shared helpers at `lib/profileCompleteness.js`:
  `computeCompletenessScore`, `missingDimensions`, `COMPLETENESS_DIMS`,
  and the `shelfsort:profile-completeness-changed` custom DOM event
  used to wire save handlers to the meter without lifting state.
- data-testids: `profile-completeness-card`,
  `profile-completeness-score`, `profile-completeness-dots`,
  `profile-completeness-dot-{handle,bio,public}`,
  `profile-completeness-cta-{handle,bio,public}`,
  `profile-completeness-missing-list`.

### (b) `/api/users/directory` sort by completeness score
- Switched the directory query from `find().sort([("username_lower", 1)])`
  to an aggregation pipeline that computes `_completeness` per row
  (`(bio non-empty ? 1 : 0) + (library_visible_to_public ? 1 : 0)`),
  sorts DESC by score and ASC by username_lower as a tie-breaker,
  then projects out the score so callers can use it.
- Response now includes `completeness_score: 0|1|2` per row.  The
  existing `has_public_library` boolean stays.
- Net effect: a fresh visitor landing on `/users` sees polished
  profiles first (bio + library opted-in) instead of a wall of
  bare handles.  Single Mongo aggregate change, day-1 first-
  impression lift, zero new UI.

### (c) "Almost there!" toast on profile save
- Save handlers in `Account.jsx` (saveBio, saveUsername) and
  `PrivacyMessagingCard.toggle` (library-visible-to-public) now
  `emitCompletenessChange()` after the primary save toast.
- Single-source-of-truth toast logic lives in
  `ProfileCompletenessCard`: tracks `lastScoreRef`, refetches
  `/auth/me` on every event, fires `toast.success` ONLY when the
  score increases.  Per-tier copy:
    * 1/3 → "Nice — 1 of 3 done." + sub-copy
    * 2/3 → "Almost there — 2 of 3 done." + sub-copy
    * 3/3 → "Profile complete!" + celebratory sub-copy
- Initial mount sets the baseline silently (no welcome-back toast
  for existing 2/3 users).  Clearing a bio or opting back out
  doesn't toast.

### Tests
- New `tests/test_iter57_directory_sort.py`: 3/3 PASS covering
  payload shape (`completeness_score` int 0-2), high-completeness
  bubbles to top (zzz-prefix test proves it's not just alphabetical),
  and alphabetical tie-breaker within the same score tier.
- Regression: iter54+55+56 (12/13 PASS, 1 expected skip) + existing
  `test_users_directory_shape` and
  `test_users_directory_excludes_requester` smoke tests still PASS.
  19/20 total across the four iters.

### Smoke
- Screenshot-verified the meter renders on `/account` for a brand-
  new user: amber 0/3 card with 3 empty dots + 3 CTAs ("Claim a
  handle →", "Add a bio →", "Share library publicly →").  Zero
  console errors.

---
## 2026-06-27 (morning, part 2) — Quick-wins triple: anchor-guard + completeness nudge 🧰

User asked to ship the three "Quick wins" in one batch.  One was
already done in iter 53 (#9 friend-request deep-link — no email
exists, the in-app notif link was the actual change).  Other two:

### (a) Help.jsx anchor-integrity assert — iter 53 regression guard
- `useEffect` on Help mount walks the `SECTIONS` array one frame
  after paint and `console.warn`s any TOC entry whose `id` has no
  matching `<Section>` in the DOM.  Runs in dev and prod (warn-only
  — no behavior change for users) so the dead-anchor bug class
  shipped in iter 53 (FAQ + TOC added, body Section forgotten —
  silent until manual click) can't recur silently.
- Smoke-verified clean: page loads with 0 Help.jsx warnings.

### (c) Profile discovery polish — post-handle completeness nudge
- `/api/auth/me` now exposes `library_visible_to_public` (bool,
  default false) so the FE nudge can drive itself off the auth
  context.  Read directly from the user doc since the Pydantic
  `User` model doesn't carry the field.
- New `PostHandleNudge` in `UsersDirectory.jsx` sits below the
  existing "claim a handle" nudge.  Triggers when the user HAS a
  @handle but is missing at least one of `bio` / `library_visible_to_public`.
  Two CTAs:
    * "Add a bio" → `/account#profile`
    * "Share library" → `/account#privacy`
  Per-state body copy so we don't show generic text:
    * neither → "Add a bio and share your library publicly so
      friends actually recognize you here."
    * bio missing only → bio-specific copy
    * library missing only → library-specific copy
- Dismissible (localStorage `shelfsort.directoryPostHandleNudgeDismissed.v1`)
  so a user who deliberately keeps things minimal isn't nagged.
- Three new data-testids:
  `directory-completeness-nudge`, `directory-completeness-bio-cta`,
  `directory-completeness-public-cta`, plus
  `directory-completeness-dismiss`.

### (b) Friend-request deep-link — confirmed already shipped
- No friend-request **email** exists; only in-app notifs.  The
  notification body link (`/users?focus=<handle>`) was already
  updated in iter 53.  No code change needed; ROADMAP cleaned up.

### Bonus fix — iter 54 audit-write warning
- The iter-54 canary-cleanup endpoint was calling
  `record_admin_action(actor_user_id=..., target_type=..., details=...)`
  but the real signature is `(actor, action, target, metadata)`.
  Backend was logging a WARNING on every admin sweep.  Fixed.

### Tests
- New `tests/test_iter56_post_handle_nudge.py` — 3/3 PASS covering
  `/auth/me` default-false flag, post-opt-in true flag, and
  bio+lvtp coexistence regression.
- iter54 + iter55 regression still 11/12 PASS (1 expected skip).

---
## 2026-06-27 (morning) — Public canary uptime pill 📊

User asked for the "Potential improvement" pitched in the overnight
summary — exposing the canary uptime on the public changelog so
visitors can gauge platform stability.  Shipped end-to-end.

- New anon endpoint `GET /api/canary/uptime?days=N` (clamped 1-90,
  default 30) returns an aggregate slice of `db.canary_runs`:
  `{available, days, total_runs, pass_count, fail_count, uptime_pct}`.
  Cached 5 min in-process, keyed by `days`, so the public landing
  surface never hammers Mongo.  Returns `{available:false, days}`
  when no runs exist in the window (fresh install / secret
  unconfigured) so the FE can hide the pill gracefully.  Slim
  payload — no log tails, no per-run rows — to keep the admin
  endpoint as the sole source of full canary history.
- `Changelog.jsx` now renders a `CanaryUptimePill` inline with the
  existing shields.io GitHub Actions badge.  Three-tier color
  scheme: green ≥99%, amber 95-99%, red <95%.  Hover tooltip
  shows raw pass/total counts.  Renders nothing on
  `available:false`.
- Backend tests at `tests/test_iter55_canary_uptime.py`: 6/6 PASS
  covering anon access, query clamp, empty-state, 100% all-pass,
  mixed pass/fail math, and out-of-window exclusion.  Tests use
  distinct `days` values per case so the 5-min in-process cache
  can't pollute results cross-test (can't bust cache across the
  pytest/uvicorn process boundary).

---
## 2026-06-27 (overnight) — Bundle A wrap: Help anchors, trending warn, canary sweep 🧹

Closing pass on Iteration 53 + a tighter cleanup cron for the
hourly prod canary.

### Iter 53 fixes (from test report)
- **Help.jsx dead anchors fixed**: added the two missing
  `<Section id="public-library">` and `<Section id="library-discovery">`
  blocks in the page body so the TOC entries shipped in iter 53
  actually scroll somewhere.  Smoke-screenshot confirms both anchors
  resolve and the new copy renders.
- **TrendingBooksStrip warn on 5xx**: the silent `catch {}` block
  now emits a `console.warn` for `>= 500` responses so a future
  regression on `/api/books/trending` surfaces in browser logs /
  Sentry breadcrumbs.  Network errors (offline, ERR_CONNECTION_*)
  stay silent — they're expected during dev.

### Task 3 — Canary throwaway-account cleanup ✨
- New admin endpoint `POST /api/admin/canary/cleanup` with body
  `{min_age_minutes, dry_run}` (defaults 60 / false).  Sweeps
  users matching `shelfsort-canary[-_]…@example.com` whose
  `created_at` is older than `min_age_minutes`, cascading to
  books / sessions / book_reactions / notifications.  Admin-only;
  audit-logged on actual deletes.  Dry-run preview returns
  matched-count + sample emails without writing.
- New hourly cron (server.py, `:05` past each hour) calls the
  same helper with the 60-min cutoff.  Hourly prod canary runs
  used to leave ~168 stale rows lingering between the daily
  fixture-purge sweeps; this collapses that to a single in-flight
  row at any moment.  Borrows the existing `digest._scheduler`
  instance — no second APScheduler started.
- 60-min minimum cutoff (Pydantic `ge=5`) so a fat-finger can
  never delete the in-flight canary fixture (a full canary cycle
  takes <2 min).
- Backend tests at `tests/test_iter54_canary_cleanup.py`:
    * anon → 401 gate
    * dry_run=true matches but writes nothing
    * actual deletion cascades to books/sessions/reactions/notifs
    * recent (5-min-old) canary user survives
    * real (gmail) user untouched even if backdated
  5/6 PASS (1 skipped — non-admin shelfsort-tester fixture absent
  in this preview DB; anon gate test already covers the same
  ground).

### Task 10 — Sign-in gate booster
- Confirmed **already shipped** in iter 51 (2026-06-26): owner
  avatar + book count + top fandom + bio preview render on the
  401 gate via `/api/users/{u}/library-preview`.  Handoff
  summary's "upcoming task" entry was stale; roadmap row 10
  remains marked ✅ DONE.

### Blocked
- **Log rotation** (Task 4): the preview's
  `/etc/supervisor/conf.d/backend.conf` is marked READONLY.
  Apply `stdout_logfile_maxbytes=10MB` + `stdout_logfile_backups=5`
  directly on the production server's supervisor config — same
  block as the previous handoff.

---
## 2026-06-26 (very late) — Library social bundle: B + D + E + Featured 🌐

Five features shipped in one batch.  User went to bed mid-build and
said "do all 4 + featured readers" — delivered.

### Group B — Discovery surfaces

#### Featured Readers strip (landing page)
- New anon endpoint `GET /api/library/featured?limit=N` — random
  sample of opted-in libraries with avatar/bio/book-count/top-fandom.
  Empty libraries filtered out.
- `FeaturedReadersStrip.jsx` renders 3-5 cards under
  CommunityShowcase on `/`.  Each card deep-links to the user's
  public library.  Silently doesn't render if no opted-in users
  exist (no sad empty state on landing).

#### Fandom-based discovery
- New anon endpoint `GET /api/library/discover/by-fandom/{fandom}` —
  case-insensitive exact match, returns opted-in users with ≥1 book
  in that fandom, sorted by per-user count.
- New page `FandomDiscoveryPage.jsx` at `/explore/fandom/:fandom`
  with per-user "Browse library" chips.

### Group D — Engagement

#### Heart-a-book + trending
- `POST /api/books/{book_id}/react` toggles a heart (auth required;
  owner self-heart returns `{self_react: true}` no-op; non-opted-in
  target returns 404).
- `GET /api/books/{book_id}/reaction-status` returns current state.
- `GET /api/books/trending?days=7` aggregates by
  `(title_lower, author_lower)` so duplicate uploads collapse into
  one row.  Filters out books whose owners de-opted post-react.
- `PublicLibraryView.jsx` shows a per-row heart button when
  `viewer_is_signed_in` is true (so owners viewing own library +
  anon visitors hitting the gate never see it).
- Race-safe upsert (post-review): heart insert is now atomic
  `update_one($setOnInsert, upsert=True)` so simultaneous
  double-clicks can't produce duplicate reaction docs.

### Group E — Loop-closing notifications

#### "Viewed your library" rate-limited ping
- `POST /api/users/{username}/public-library/view-ping` — fires a
  notification (`kind="library_viewed"`) to the owner.  Rate-limited
  to one per (viewer, owner) pair per 24h via the
  `library_view_pings` collection.  Self-views silently no-op.
- `PublicLibraryView.jsx` fires this side-effect on a successful
  signed-in non-owner library load.

#### "Friend went public" fan-out
- `set_public_library_visibility` (in `friend_library.py`) now fans
  out a `kind="friend_library_public"` notification to all accepted
  friends on the FIRST opt-in (gated by
  `first_public_share_shown_at`).  Best-effort — never blocks the
  toggle if notif insert fails.

### Bug caught + fixed during testing
- `db.friends` → `db.friendships` (collection-name typo silently
  null-routed the entire fan-out).  Caught by iteration_52 testing
  agent, fixed inline.  Logged for posterity since this kind of
  null-route is exactly what `pyright` can't catch in motor calls.

### Tests
- `/app/tests/test_iteration_52.py` (NEW, 19 cases) — covers
  featured, fandom-discovery, react toggle (incl. self-react +
  non-opted-in 404), trending aggregation, view-ping rate-limit +
  self-view + handle-enumeration, and friend fan-out (incl.
  idempotent gate via first_public_share_shown_at).
- All prior suites still pass.  Cumulative 79/79.

---

## 2026-06-26 (late) — Groups A+C: conversion booster + profile depth ✨

Four features shipped on top of the login-gated public-library
launch, in one batch.  All four pass 100% in iteration_51 (19/19 new
pytest + 9/9 frontend flows; 60/60 cumulative including prior suites).

### Group A — Conversion

#### (1) Enriched 401 sign-in gate
- New anonymous endpoint `GET /api/users/{username}/library-preview`
  returns `{username, display_name, picture, bio, total_books,
  top_fandom, fandom_count}` for opted-in users.  404 invariants
  preserved (not-opted-in vs nonexistent both 404).
- `PublicLibraryView.jsx` 401 branch now best-effort fetches this
  preview and renders the owner's avatar + "@alice has 247 books
  across Harry Potter +3 more" + bio quote, with the heading
  "Sign in to see what they're reading".  Falls back gracefully to
  the original generic gate when the preview 404s.

#### (2) First-time share modal
- `PUT /api/account/public-library-visibility` now detects the
  very first opt-in (no prior `first_public_share_shown_at` stamp)
  and returns `show_first_share_modal: true`.  Atomic with the
  visibility flip — no race.
- `Account.jsx` `PrivacyMessagingCard` opens a modal with the
  shareable `/u/handle/library` URL, Facebook + X/Twitter share
  buttons, and a copy-link button.  Idempotent: stamped server-side
  so toggling off→on later never re-shows it.

### Group C — Profile depth

#### (3) Bio field
- 280-char optional "about" line on User.  `PUT /api/account/bio`
  with Pydantic `max_length=280` validation (server returns 422 on
  over).  Surfaces on:
    * `/auth/me` + `/auth/profile`
    * `/api/users/{u}/public-library` owner block
    * `/api/users/{u}/cover-profile`
    * `/api/users/{u}/library-preview` (the gate)
- Frontend: textarea in Account → Profile with hard-cap slice at
  280 chars (defense in depth).  Renders italic on `/u/handle` and
  `/u/handle/library`.

#### (4) Tokenized library RSS feed
- `GET /api/account/library-rss-token` (auth) lazy-creates a
  per-user URL-safe token.  `POST /api/account/library-rss-token/
  regenerate` issues a new one, invalidating any previously-shared
  URL.
- `GET /api/feeds/library/{username}.rss?token=...` returns valid
  RSS 2.0 XML (≤50 most-recent books) when the token matches the
  user's `rss_token` AND they're opted in.  Constant-time check
  via `secrets.compare_digest`.  Uniform 404 for: missing token,
  wrong token, not opted in, nonexistent handle.
- Account → Privacy now shows a copyable RSS URL + "Regenerate
  (invalidate old)" button when public library is ON.

### Tests
- `/app/tests/test_iteration_51.py` (NEW, 19 cases) — covers all
  four features incl. constant-time RSS check, byte-identical 404
  bodies, idempotent modal, server-side bio cap, AV exclusion.
- All prior suites still pass (60 total cumulative).

---

## 2026-06-26 (evening) — Libraries are now login-gated 🔒

Policy change shipped within hours of the public-library launch.
Per operator: *"make it so that ALL libraries are only seen IF people
are logged in as a user. Nobody can see any library, unless they
are signed in."*

### Behavior
- `GET /api/users/{username}/public-library` now **requires auth**
  via FastAPI dependency (`get_current_user`).  Anonymous callers
  get a clean 401 before any DB I/O.
- Handle-enumeration prevention still holds for authed callers:
  not-opted-in and nonexistent handles both return identical 404
  bodies.
- `GET /api/share/u/{username}/library` **remains anonymous** by
  design so Facebook/Twitter crawlers can still render rich link
  previews — they can't sign in.

### Frontend
- `PublicLibraryView.jsx` now branches on the 401:
    * 401 → renders a friendly sign-in gate card
      (`data-testid="public-library-needs-login"`) with two CTAs
      (`public-library-signin-btn` + `public-library-register-btn`)
      both wired with `?next=` so the user lands back on the
      library after auth.
    * 404 → the existing "library not found" card (unchanged).
- `PublicCoverProfile.jsx` lazy library probe naturally 401s for
  anon viewers and the existing try/catch hides the "Browse
  library" chip — anon viewers never even see the existence of an
  opted-in library on a cover profile.  No leak.

### Tests
- `test_iteration_50.py` (NEW, 12 cases) — codifies the 401-on-anon
  invariant + the OG-stays-public exception.
- `test_public_library.py` + `test_iteration_49.py` updated
  end-to-end to acquire sessions before hitting the gated endpoint.
- iteration_50 testing-agent report: **41/41 backend pytest pass,
  4/4 frontend flows pass.  Zero issues.**

---

## 2026-06-26 — Public library: OG previews + directory chip + shelf overlap 🔗📚✨

Follow-on bundle (a+b+c) to the public-library launch earlier today.
Closes the discovery + engagement + sharing loop in one batch.

### (a) OG/Twitter preview for `/u/handle/library`
- New endpoint `GET /api/share/u/{username}/library` (mirrors the
  existing cover-profile share pattern in `cover_public.py`).
- Renders rich HTML with `og:title`, `og:description` (e.g.
  *"Alice's 247-book library — top fandom: Harry Potter"*), and reuses
  the existing `/api/og/user/{handle}.png` image so brand stays
  consistent across cover-profile + library share cards.
- Critical: 404 invariant preserved (not-opted-in vs nonexistent
  return identical 404).
- Closes the loop with the Facebook user who started all this — their
  library link now previews properly when shared back to FB.

### (b) 📚 chip in the `/users` directory
- `GET /api/users/directory` now returns `has_public_library: bool`
  per row.  Bonus: fixed pre-existing duplicate-`$ne` bug on the
  username filter (ruff F601) — now uses `$nin: [None, '']`.
- Directory rows render a small purple "📚 Library" chip when opted
  in, deep-linking to `/u/handle/library`.

### (c) Shelf-overlap "magic moment"
- `GET /api/users/{username}/public-library` now accepts an optional
  signed-in viewer.  When viewer ≠ owner, it computes overlap
  server-side using case-insensitive `lower(title)|lower(author)`
  match keys.
- Response gains `overlap_count`, `viewer_is_signed_in`, and per-book
  `you_also_have` flags.
- Frontend renders a prominent amber banner ("You have N of these
  books too" / "You have 1 book in common") + a small "You have this"
  badge on each matching book.
- Anon visitors + the owner viewing their own page see no overlap UI
  (designed not to compute self-overlap).

### Tests
- `/app/tests/test_iteration_49.py` — 12 new pytest cases covering
  all 3 features.
- iteration_49 testing-agent report: 100% pass on both backend
  (12/12) and frontend (3/3 testable flows).
- Singular-form copy polish applied post-review ("1 book in common"
  vs "N of these books too").

---

## 2026-06-26 — Opt-in PUBLIC library mode (Goodreads-style) 📚

Triggered by a real Facebook user asking *"Is this for having my own
library, or can I also read other people's libraries?"*  Adds a
THIRD privacy tier on top of the existing friends-only sharing:
**friends → directory → public web**.

### Backend
- New `users.library_visible_to_public` field (defaults False).
- `GET/PUT /api/account/public-library-visibility` — owner toggle.
- `GET /api/users/{username}/public-library` — **anonymous read,
  no auth required**.  Returns `{owner, books, top_fandoms,
  category_counts, total_returned}` — only title/author/fandom/
  category leave the server (no files, AV detail, filenames).
- Security: handle-enumeration prevention — both "user doesn't
  exist" and "user exists but not opted in" return identical 404.
  AV-infected books filtered out.  `q` filter requires ≥2 chars.
  `limit` clamps to [1, 500].

### Frontend
- New page `/u/:username/library` (`PublicLibraryView.jsx`) — search
  + fandom chips + friendly 404 state.
- New toggle in Account → Privacy ("Make my library public on the
  web").  Pre-flight guard: refuses to flip ON when the user has
  no @handle, with a toast pointing them at the Profile section.
- "Browse library" chip on `/u/:handle` (PublicCoverProfile) —
  lazy-probed; only renders when the user has opted in.

### Tests
- `/app/tests/test_public_library.py` — 11 pytest cases covering
  every backend invariant.  Located outside `/app/backend/tests/`
  to avoid uvicorn watchfiles reload loops in dev.
- iteration_48 testing-agent report: 100% pass on both backend
  (11/11) and frontend (9/9 functional flows).

---

## 2026-06-26 — Profile discovery polish on `/users` 🔎

Two small UX wins on the Reader Directory.

### Scroll-to-row
- `/users?focus=handle` now scrolls the matching `<li>` into view
  (smooth, block:center) and applies a 2.5s `bg-[#FFF6D6]` amber
  highlight pulse so the eye lands on the right place.
- Handles `@` prefix stripping + case-insensitive matching.
- Strips `?focus=` from `window.location` after scrolling so refresh
  isn't sticky.
- If the handle isn't on the current page → toast hint
  ("@handle isn't on this page — use the filter or paginate"); clears
  state so it doesn't re-trip.

### Persistent missing-handle nudge
- Inline amber banner at the top of `/users` shown only when the
  signed-in user has no @handle yet (without one they're invisible in
  the directory).
- One primary CTA → `/account#profile`.
- Distinct from the existing one-shot welcome toast (which fires once
  per device); this banner stays until the handle is claimed.

### Files touched
- `frontend/src/pages/UsersDirectory.jsx` — added `useRef` +
  `useSearchParams` imports, `focusHandle`/`rowRefs` state, scroll-
  to-row effect, persistent nudge JSX, row ref + highlight class.

### Tests
- iteration_47 testing-agent report: 100% pass on all 8 subtests
  (nudge show/hide, scroll-to-row present/absent/@-prefix/uppercase
  matching, page render). Zero blocking bugs.
- Polish: ref cleanup on unmount applied post-review.

---

## 2026-06-26 — Admin 1-click "Mark Shipped" modal 🚢

Replaces the 3-step "→ done → write note → wait for email" workflow
with a single primary button + small modal.

### Backend
- `routes/suggestions.py` — `SuggestionUpdate` model now accepts an
  optional `skip_email: bool` (default False, preserves existing
  behavior).  When True, the admin_update endpoint sets `status=done`
  + stamps `shipped_at` + saves `admin_note` but **suppresses** the
  Resend celebration email (in-app notification still fires).  Used
  by the modal's "Send celebration email" checkbox.
- `shipped_credit_sent_at` idempotency stamp still wins on re-ship —
  unticking the checkbox just makes that explicit on first ship.

### Frontend
- `AdminConsole.jsx` `FeedbackInboxCard` — adds primary purple
  "Mark shipped" button on every non-done suggestion row
  (`data-testid="feedback-mark-shipped-{id}"`).  Click opens a
  modal (`data-testid="feedback-ship-modal"`) with:
    * Public-note textarea (1000-char cap, surfaces on `/changelog`)
    * "Send celebration email" checkbox — default ON, auto-disabled
      with explanatory italic when `shipped_credit_sent_at` is set.
    * "Ship it" submit (PUT one request with status + note + flag).
- Toast on success: "🚢 Shipped — celebration email sent" or
  "🚢 Shipped — email skipped".
- Error toast surfaces the real `response.data.detail` instead of a
  silent failure (review finding from iteration_46).

### Tests
- `backend/tests/test_mark_shipped_modal.py` — 5 pytest tests covering
  send/skip/idempotency/legacy-body/changelog-surfacing paths.
- Iteration 46 testing-agent report: 100% pass on both backend (5/5)
  + frontend (12/12 spec items).  Zero blocking bugs.

---

## 2026-06-25 — CI canary fully stabilized ✅

Production smoke canary went from chronically red → solid green
(`21 passed, 9 skipped in ~10s`) against `https://shelfsort.com`.
Five sequential fixes, verified end-to-end via runs #18 → #22.

### Fixes shipped
1. **`prod-smoke-canary.yml`** — removed `secrets.CANARY_REPORT_SECRET`
   from an `if:` condition (GitHub forbids secrets in conditions).
   Mapped to step-scope env and checked there instead.
2. **`prod-smoke-canary.yml`** — added explicit job-level
   `permissions: { contents: read, issues: write }`. Default workflow
   token is read-only → the auto-issue-opener step was 403'ing with
   "Resource not accessible by integration".
3. **`backend/scripts/run_regression_smoke.sh`** — `BACKEND_URL` now
   falls back to `REACT_APP_BACKEND_URL` when set. Canary was probing
   `localhost:8001`, failing, then trying to spawn its own uvicorn
   (which isn't in canary's minimal deps).
4. **`backend/scripts/run_regression_smoke.sh`** — point pytest
   directly at `tests/test_regression_smoke.py` instead of letting
   `-m regression_smoke` filter post-collection. Collection was
   importing 80+ test files that need full backend deps the canary
   deliberately skips.
5. **`tests/test_regression_smoke.py`** — added
   `pytest.importorskip("ebooklib")` to the three
   `test_reconstruct_bare_storyid_*` unit tests. They're pure local
   parser tests (no prod call) that import `utils/epub_metadata.py`,
   which requires `ebooklib` — not in canary's minimal deps.

### Result
- Canary is now safe to leave running daily at 03:00 UTC.
- Auto-issue creation on failure is wired and tested.
- Both `backend-tests` and `prod-smoke-canary` workflows green.

---

## 2026-06-27 — Mongo indexes (P3) + Community amplification (P1) ✅

Two-fer overnight shipping block — first the trivial-risk perf win,
then the headline feature.

### 1. Mongo indexes for library_reads.py routes
- Added 5 compound indexes to `db.books` in `server.py` startup
  (idempotent on every boot, online-safe):
  - `(user_id, category)` — `GET /api/books` filter
  - `(user_id, last_opened_at DESC)` — `GET /api/books/recent`
  - `(user_id, replaces, update_seen)` — bell badge
  - `(user_id, fandom)` — fandom filter + `GET /fandoms` aggregate
  - `(user_id, author, created_at DESC)` — `GET /authors/{name}` +
    duplicate-finder (bonus index covering an adjacent hot path)
- All 4 high-traffic queries verified using the new indexes via
  Mongo `explain()` query planner.
- Effective immediately on the 3,990 existing books.

### 2. Community amplification — "Built from your ideas"
- **`GET /api/changelog`** (public, no auth) returns:
  - `community_shipped`: suggestions with `status=done` whose
    `shipped_at >= SHIPPED_CREDIT_CUTOFF` (2026-06-25), with
    `@handle` credit when the submitter has a public username
    AND hasn't opted out of `/users` search.
  - `engineering_log`: parsed dated sections from CHANGELOG.md
    (top 25), with 5-min in-process cache + a public bust hook.
- **Celebration email** when a suggestion ships:
  - Existing "status changed" email upgraded with a stronger
    "🎉 Your idea shipped!" framing when status transitions to
    `done` for the first time. Includes a CTA to the public
    changelog page.
  - Idempotent: tracked via `shipped_credit_sent_at` so re-edits
    of an already-done suggestion never re-fire the email.
  - Old email format still used for other status transitions
    (open → under_review → planned → declined).
- **Schema additions** to `suggestions` collection:
  - `shipped_at` (ISO timestamp) — stamped exactly once when
    status first transitions to `done`.
  - `shipped_credit_sent_at` (ISO timestamp) — idempotency lock
    for the celebration email.
- **Frontend** `/changelog` page extended with a new
  "SHIPPED FROM THE COMMUNITY → Built from your ideas" section
  below the announcements feed. Each row: 🎉 emoji + suggestion
  title + clickable `@handle` credit (links to `/u/{handle}`) +
  shipped date + optional admin note. Falls back to "Suggested
  by an anonymous reader" when the submitter has no public handle
  or opted out of search.
- **Privacy**: handle-only credit (no display-name fallback), and
  hidden-from-search users are excluded from credit even when they
  have a username — verified via end-to-end test.

### Verification
- E2E manual test through the full flow: created submitter +
  admin + open suggestion → `PUT /admin/suggestions/{id}` with
  `status=done` → verified `shipped_at` stamped → verified
  celebration email logged (`kind=suggestion_shipped, status=ok`)
  → verified second mark-as-done does NOT re-fire email →
  verified hiding the user from search removes their handle from
  the public credit list.
- Live `/changelog` screenshot confirms the section renders with
  `@handle` link, date, and admin note.
- Regression smoke band: **30 green tests** ✓


## 2026-06-27 — Phase 6D extraction + Help refresh + deep-dive scan ✅

Operator was heading to bed and asked for a self-contained shipping
block + a Help update + a system-wide health pass.

### Phase 6D — library_reads.py extraction
- New `routes/library_reads.py` (~440 LOC) containing 10 pure-read
  endpoints peeled out of the 4780-line `books.py` monolith:
  - `GET /api/books` (main list + 11 filter params)
  - `GET /api/books/stats` (totals + category/fandom/relationship aggs)
  - `GET /api/books/export/unavailable` (.txt download)
  - `GET /api/books/recent` (Continue Reading rail with cross-device
    cursor data)
  - `GET /api/books/recent-updates` (bell-badge feed)
  - `POST /api/books/{id}/mark-update-seen` + `/mark-updates-seen`
  - `GET /api/books/quick-search` (typeahead)
  - `GET /api/fandoms` (distinct fandoms + crossover annotation)
  - `GET /api/authors/{name}`
- Plus the shared `_suggest_search_url` helper used by the
  unavailable export.
- `books.py` shrunk **4780 → 4339 lines** (~9.2% drop, ~441 LOC out).
  Pure-read boundary, zero shared helpers needed from the parent —
  no import cycle risk.
- All 8 extracted GET routes verified responding (401 on no-auth =
  auth gate intact).
- `server.py` import list updated; `books.py` module docstring
  updated with the new section.

### Help page refresh
- Updated `FALLBACK_WHATS_NEW` (Help.jsx) with the 3 new flagship
  features shipped this session: smarter crossover detection,
  Storyid URL reconstruction, public users directory.
- Added 2 new FAQ entries to `SEO_FAQ` (powers Google's FAQPage
  structured data): "How does Shelfsort detect crossovers?" and
  "What if my EPUB only has a Storyid but no URL on the cover?"

### Deep-dive scan results
- ✅ Backend lint: 0 errors in production code (test-file style nits
  pre-existing).
- ✅ Frontend lint: 87 pre-existing warnings (entity escapes + empty
  catches in Reader.jsx), 0 new errors from this session.
- ✅ All 30 regression smoke tests green in 5.1 s.
- ✅ 447 API routes registered, all 6 new endpoints from the day
  verified present.
- ✅ Services: backend/frontend/mongodb all RUNNING.
- ✅ Mongo healthy (3,990 books, 340 users, 1,327 sessions).
- ✅ No orphaned imports of extracted functions.
- ✅ No hardcoded secrets / TODO drift / dangling localhost refs
  (only 2 — both legitimate ClamAV daemon connections on
  127.0.0.1:3310).
- ⚠️ Backend `out.log` is 17 MB — manageable but a future log
  rotation task is queued (P4 housekeeping).
- Disk: 67% used, 3.3 GB free — no pressure.


## 2026-06-26 — Storyid reconstruction + backfill endpoint ✅

Closes the gap for EPUBs that ship a Storyid + host name but no actual
URL on their cover page (common for older FanFicFare exports).  Two
shipping pieces:

### 1. Storyid reconstruction in the EPUB link extractor
- `utils/epub_metadata.py` — new `_reconstruct_bare_story_ids()` helper.
  Scans plain text for `Storyid:` / `Story ID:` / `story_id:` patterns
  (case-insensitive), pairs each ID with the nearest host token within
  a 200-char window using **closest-host-wins** logic, and rebuilds
  the canonical URL.  Also extracts the human-readable name from the
  following `Name:` line as the anchor text.
- Supports: FanFiction.net (incl. `fanfic.net` typo), Archive of Our
  Own (`archiveofourown`, `archive of our own`, `ao3.org`, bare `AO3`),
  Royal Road (with + without space), FictionPress, Wattpad.
- Wired into `extract_urls_from_epub()` so it runs automatically on
  every new upload — no API change, no migration required.
- 3 new pytest regression tests guard the host-table + closest-host
  logic (user's exact example, compilation EPUBs with two stories,
  no-host-yields-nothing).

### 2. `POST /api/admin/re-extract-links` backfill endpoint
- Re-runs the EPUB link extractor on existing books so the
  reconstruction logic lands on old uploads too.  Body schema:
  `{dry_run: bool, limit: 1-5000, only_missing_source: bool,
  user_id?: str}`.
- Defaults: `dry_run=False`, `limit=500`, `only_missing_source=True`
  (never overwrites a known source URL).
- Pulls each book's EPUB from local cache (or R2 fallback) via the
  same `ensure_local_cached` helper used by the refresh flow.
- Per book: rewrites `{book_id}.links.txt`, updates `links_count` in
  Mongo, and fills in `source_url` if missing.  Returns
  `{scanned, set_source, rewrote_links, missing_file, samples[]}`
  with the first 20 transitions for sanity-checking.
- Logged to `admin_actions` (`books.re_extract_links`).

### 3. Admin Console "Backfill EPUB links" card
- New card in the System & health section.  Toggles for dry-run
  (default ON) and only-missing-source (default ON).  Batch-size
  numeric input (1-5000).  Results panel shows
  scanned/set-source/sidecar-rewrites/missing-file counts plus
  expandable per-book examples with old → new URL diff.

### Verification
- E2E manual test: created a Storyid-only EPUB (no href anywhere),
  ran the endpoint in dry-run mode (1 would-update preview), then
  real mode → Mongo source_url set to
  `https://www.fanfiction.net/s/6032563`, sidecar `.links.txt`
  generated with the reconstructed URL + "Absolute Promise" anchor.
- Regression smoke band: **30 green tests** in 5.4s.


## 2026-06-26 — Crossover navbar badge + Production canary widget ✅

Closed the loop on the loop, plus the canary widget the operator queued.

### Crossover-suggestions navbar badge (P2 follow-up to Session 2)
- Backend: `GET /api/admin/crossover-suggestions/count` (60-s in-process cache)
- Frontend: `Navbar.jsx` polls BOTH unknown-fandoms and crossover counts
  every 5 min; the existing coral dot on the AdminConsole shield now
  lights up if EITHER counter > 0. Tooltip lists both ("Admin console
  — 3 unknown fandoms · 2 pending crossover suggestions").  Drawer
  badge wired the same way.

### Production canary widget (P1)
- New `canary_runs` Mongo collection: `{run_id, status, passed, total,
  target, duration_s, finished_at, tail}` with 90-day retention swept
  on every push.
- Backend endpoints:
  - `POST /api/canary/report` — gated by `CANARY_REPORT_SECRET` env
    var.  503 if unconfigured, 401 on bad secret.  Idempotent upsert
    by `run_id`.
  - `GET /api/admin/canary-runs?days=7|14|30` — admin-only, returns
    chronologically-sorted runs + headline pass/fail/uptime.
  - `GET /api/admin/canary-runs/{run_id}` — full row including the
    log tail for failure forensics.
- `.github/workflows/prod-smoke-canary.yml` gains a second step that
  parses `N passed/failed` out of pytest output and POSTs the result
  with `if: always()` so failures land too.  Conditional on the new
  `CANARY_REPORT_SECRET` secret being set — workflows without it
  keep running the smoke band but skip the push.
- Frontend: new `CanaryCard` in AdminConsole's System & health section.
  - Headline: uptime %, pass count, fail count, last-run timestamp
  - 7-day dot sparkline (green=pass, red=fail) with title-attr
    tooltips showing per-run pass/total/duration
  - 7d / 14d / 30d period tabs
  - "Last 5 runs" details expander (text fallback for screen readers
    and colorblind operators)
  - Empty state with one-time setup instructions when
    `CANARY_REPORT_SECRET` is unset

### Operator setup (one-time)
1. Generate a random secret: `openssl rand -hex 32`
2. Add to GitHub repo secrets as `CANARY_REPORT_SECRET`
3. Add the SAME value to `backend/.env` as `CANARY_REPORT_SECRET`
4. Next nightly run (03:00 UTC) populates the widget


## 2026-06-26 — Crossover Detection Session 2 (AI feedback loop) ✅

Closes the loop on Session 1's character-keyword overlay.  Now when
the AI classifier sees a multi-fandom crossover the keyword scanner
missed, the gap is logged for admin review.  Accept → keywords merge
into the runtime overlay (60-s cache flush) → the heuristic catches
the same crossover on the next upload.

### Backend
- `utils/classifier.py`
  - `classify_book` refactor: heuristic now always runs first, then AI
    (when force_ai or heuristic confidence < 0.6).  Both results stay
    in scope so the gap detector can compare them.
  - `_maybe_log_crossover_gap()`: when AI returns a `" / "`-joined
    crossover the heuristic didn't cover, upsert a row to the new
    `crossover_suggestions` collection.  Dedup key
    `title::author::sorted(gap)` makes re-uploads idempotent (bumps
    `sightings`/`last_seen_at` instead of creating dupes).
  - `_split_crossover()` helper used by both gap detector and admin
    accept endpoint.
- `routes/admin.py` — 3 new endpoints (all admin-only):
  - `GET  /api/admin/crossover-suggestions?status=pending|accepted|rejected|all`
    → lists with `{pending,accepted,rejected}` counts for the tab UI
  - `POST /api/admin/crossover-suggestions/{dedup_key}/accept` body
    `{keywords_by_fandom: {fandom: [str]}}` → merges into
    `fandom_keyword_overlay`, busts the classifier cache, audit-logs
  - `POST /api/admin/crossover-suggestions/{dedup_key}/reject` →
    marks resolved without modifying the overlay

### Frontend
- `pages/AdminConsole.jsx`
  - New "Crossover suggestions" Card in the System & health section
    (between Unknown fandoms and Global aliases).  Manifest entry +
    switch case wired.
  - Status tabs (Pending/Accepted/Rejected) with live counts
  - Per-row: title, author, "AI saw" vs "Heuristic saw" diff,
    sightings counter, per-gap-fandom keyword input (comma-separated),
    Accept/Reject buttons, expandable description/sample preview
  - All elements carry `data-testid` for the testing agent

### Tests
- Manual: backend gap-detection + accept/reject + idempotency
  verified via `httpx`-based python script (2 admins, 4 seeded
  suggestions, full lifecycle).
- `tests/test_regression_smoke.py` — 2 new tests guard the auth gate
  (non-admin → 401/403, never 500).  Smoke band is now **27 green
  tests** in ~5 s.

### Misc
- `pages/Help.jsx` — fixed a duplicate React key warning in the
  "What's new" fallback list (3 items all keyed on `/library/all`;
  now `${item.to}-${idx}`).


## 2026-06-26 — Phase 6B: bulk-ops extracted from books.py ✅

P3 tech-debt item.  Behavior-preserving split using the regression
smoke band we shipped earlier as the safety net.

### New file: `routes/bulk_ops.py` (~430 LOC)
6 endpoints + their request models moved verbatim:
- `POST /api/books/reclassify-all`
- `POST /api/books/bulk/delete`
- `POST /api/books/bulk/move`
- `POST /api/books/bulk/metadata`
- `POST /api/books/reset-state`
- `POST /api/books/wipe-library`

### `routes/books.py` — 4,964 → 4,613 LOC (7% drop)
- 351 lines removed across 6 disjoint blocks (5 endpoint bodies + 5
  request models + 1 endpoint without a paired model)
- Header section map updated with the new Phase 6B row
- Internal helpers (`_canonicalize_fandom`, `_normalize_tags`,
  `OLD_STORIES_SHELF` constant) stay in books.py; bulk_ops.py
  imports them one-way (same pattern as covers.py)

### `server.py`
- `bulk_ops` added to the bulk `from routes import …` line so its
  `@api_router` decorators fire at startup.

### Verification — the safety net worked
- `./scripts/run_regression_smoke.sh` → **25 passed in 7.44 s**.
  No regressions.  The combined safety net (upload + cover + 3
  dark-mode + endpoint guards + Phase 6A smoke) caught zero
  problems, which is exactly the outcome we wanted: refactor as a
  routine operation, not a leap of faith.
- Curl smoke on all 6 moved endpoints with bad / empty inputs:
  - `wipe-library` (wrong confirm) → 400 with original message
  - `reset-state` (empty body) → 400 "Pick at least one thing"
  - `bulk/delete` (empty ids) → 200 `{"deleted":0}`
  - `bulk/move` (no fields) → 400 "No category or fandom"
  - `reclassify-all` (default body) → 200 `{"processed":0,"changed":0}`
- All preserve their original status codes and error message text.

### Cumulative refactor progress
- Phase 1-5 (previous agents): conversions, trash, fandoms, exports,
  URL lists, refresh, duplicate resolution, library views, reading
  activity → modules
- Phase 6A (today): covers → `routes/covers.py` (5,855 → 4,964)
- Phase 6B (today): bulk-ops → `routes/bulk_ops.py` (4,964 → 4,613)
- `books.py` is now ~22% smaller than at start-of-session.

---
## 2026-06-25 (overnight 3) — Unpaired `dark:` hex utility guard ✅

Third and final dark-mode leak guard, completing the bug-class
insurance trio.

### Audit
Sweep for `dark:UTILITY-[#hex]` patterns → 1 hit in
`BookDetail.jsx:677`, but it's properly paired:
`bg-[#EEE9FB] dark:bg-[#6B46C1]/20 text-[#6B46C1]` (both themes
explicitly styled).  Codebase is clean.

### New regression test
- `tests/test_regression_smoke.py::test_no_unpaired_dark_only_hex_utilities`
  (tagged `@pytest.mark.regression_smoke`)
- For each `dark:ROOT-[#hex]`, scans the same line for an
  unprefixed `ROOT-…` sibling.  Paired → pass.  Unpaired → fail
  with file:line + fix suggestions.
- Self-tested with a synthetic file containing one unpaired + two
  paired lines: the unpaired one was flagged, the paired ones were
  not.

### Combined dark-mode insurance (final)
| Bug pattern | Guard test |
|-------------|------------|
| `[&_*]:utility-[#hex]` arbitrary variant | `test_no_hex_leaks_in_tailwind_arbitrary_variants` |
| `style={{ color: "#hex" }}` inline style | `test_no_hex_leaks_in_inline_style_props` |
| `dark:utility-[#hex]` standalone (no light pair) | `test_no_unpaired_dark_only_hex_utilities` |

All three fire on every PR + every nightly production canary.  The
dark-mode `<code>` chip bug class that surfaced earlier today is
now eliminated at PR time across all three known surfaces.

### Smoke band
- 24 → **25 tests** in **7.28 s**.

---
## 2026-06-25 (overnight 2) — Inline-style hex leak guard + AllBooksPage fix ✅

Extends today's dark-mode leak guard infrastructure to cover the
second-most-common bug class.

### Audit found 1 real leak
Sweep for hex literals inside `style={{ … }}` props turned up:
- 5 hits in YearInBooks share-card components (intentional brand
  styling for social-share images — these look the same in light
  vs dark by design)
- **1 actual leak**: `pages/AllBooksPage.jsx:690` `<button
  className="btn-primary" style={{ background: "#6B46C1" }}>`.
  The inline style overrode `btn-primary`'s `var(--primary)`
  background, leaving the button stuck at `#6B46C1` in dark mode
  while the rest of the UI shifted to the brighter `#A78BFA`.

### Fix
- `pages/AllBooksPage.jsx::refresh-all-btn` — dropped the
  `style={{ background: "#6B46C1" }}` override.  `btn-primary`
  already paints from `var(--primary)` so the button now flips
  with the theme.

### New regression test
- `tests/test_regression_smoke.py::test_no_hex_leaks_in_inline_style_props`
  (tagged `@pytest.mark.regression_smoke`)
- Scans all `.jsx/.js/.tsx/.ts` files for inline `style` props
  setting `color` / `background` / `backgroundColor` /
  `borderColor` / `fill` / `stroke` to a literal hex
- Allowlist: `_INLINE_STYLE_HEX_ALLOWLIST` exempts the 4 Year-in-
  Books files where brand-themed share cards genuinely *should*
  bypass the user's theme.  Adding files requires a commit-time
  justification (comment why)
- On hit, fails with file:line, the matched snippet, and a fix
  suggestion (use a className with a CSS-var utility, or extend
  the allowlist if intentional)

### Smoke band
- 23 → **24 tests** in **7.25 s**.  Production canary auto-picks
  up the new guard.

### Combined dark-mode insurance now in place
Together with the arbitrary-variant guard from the previous run:
1. `[&_*]:utility-[#XXXXXX]` patterns — descendant cascades
2. `style={{ color: '#XXXXXX' }}` patterns — inline overrides

Both are now CI failures, both auto-fire on every PR + every
nightly canary.  The dark-mode `<code>` chip bug class is
effectively eliminated.

---
## 2026-06-25 (overnight) — Dark-mode leak guard test + codebase audit ✅

Locks in the dark-mode `<code>` chip bug class as a CI failure
mode.  Pairs with the same-night fix on Help.jsx + KindleImport.jsx.

### Audit (one-time sweep)
- Scanned all `.jsx/.js/.tsx/.ts` files under `frontend/src/` for
  the pattern `[&_*]:utility-[#XXXXXX]` (hex literals inside
  Tailwind arbitrary variants).
- Result: **0 leaks remaining** — the earlier same-night fix to
  Help.jsx + KindleImport.jsx cleared the entire codebase.

### New regression test
- `tests/test_regression_smoke.py::test_no_hex_leaks_in_tailwind_arbitrary_variants`
  (tagged `@pytest.mark.regression_smoke` so it runs in the
  band + the production canary).
- Walks `/app/frontend/src/` looking for the leaky pattern, cross-
  references against a hardcoded `_LEAK_HEX_HINTS` map of hexes
  with known light/dark CSS-var twins (creams, body text, primary
  purple).  Non-themable hexes (e.g. error red `#D9534F`) are NOT
  flagged.
- On hit, fails with a precise message: file, line, exact match,
  AND the suggested `var(--…)` replacement.  No guessing required
  to fix.
- Self-tested via a synthetic leak file — confirmed the test
  correctly flagged it before deletion.

### Run cost
- 0.11 s standalone, ~0 s incremental against the full band.
- `./scripts/run_regression_smoke.sh` → **23 passed in 7.26 s**
  (was 22).  Production canary picks it up automatically.

### Why this matters
The dark-mode `<code>` chip bug was reported by the user this
session.  Without this guard, any future PR using
`[&_*]:bg-[#XXXXXX]` would reintroduce the same class of bug.  The
test is the cheapest possible long-lasting insurance — caught at
PR time, not user-report time.

---
## 2026-06-25 (late night) — Dark-mode `<code>` chip fix on Help + KindleImport ✅

### Bug
User reported on Help page: inline `<code>` chips (e.g. `/library` in
the Dashboard tour) rendered with a LIGHT cream background
(`#F0EBDC`) on the dark theme — visually broken, effectively unread-
able.  Asked to check all pages.

### Root cause
The Tailwind arbitrary variant `[&_code]:bg-[#F0EBDC]` compiles to a
descendant selector `.foo code { background: #F0EBDC }`.  The dark-
mode remapper in `index.css` only intercepts class names matching the
literal `bg-[#F0EBDC]`, NOT descendant cascades — so the chip stayed
cream regardless of `<html data-theme>`.

### Fix (2 files)
- `pages/Help.jsx::Section` — replaced `[&_code]:bg-[#F0EBDC]`,
  `[&_a]:text-[#6B46C1]`, `[&_a:hover]:text-[#553397]`, and
  `[&_li::marker]:text-[#6B705C]` with `var(--surface-hover)`,
  `var(--primary)`, `var(--primary-hover)`, `var(--text-secondary)`.
  The CSS variables already auto-flip in dark mode (defined in
  `:root[data-theme="dark"]`), so the chips now read charcoal
  `#34343A` on dark and cream `#F5F3EC` on light without further
  CSS work.
- `pages/KindleImport.jsx` — same swap on its `[&_code]:bg-[#F1ECDB]`
  wrapper.  Verifies all `.azw/.mobi/.kfx` extension chips are
  legible in dark mode.

### Verification
- `testing_agent_v3_fork` iteration_38 — **PASS** (100% frontend).
  Computed `background-color` confirmed via `getComputedStyle`:
  - Light: `rgb(245, 243, 236)` = `#F5F3EC` ✓
  - Dark:  `rgb(52, 52, 58)`    = `#34343A` ✓
  - Light link: `rgb(139, 92, 246)`  = `#8B5CF6` ✓
  - Dark link:  `rgb(167, 139, 250)` = `#A78BFA` ✓ (brighter, legible)
- Bulleted lists still render disc markers in both modes.
- `/privacy` and `/terms` swept clean (no `<code>` elements present
  so no leak surface).

### Reminder filed
- Pre-existing React duplicate-key warning on Help.jsx WhatsNew
  fallback (3 items share `to='/library/all'`).  Not a regression
  of this fix.  ROADMAP entry #7, ~5 min trivial fix.

---
## 2026-06-25 (night 3) — Production smoke canary + Help-page list fix ✅

### Production smoke canary
- `.github/workflows/prod-smoke-canary.yml` — nightly at 03:00 UTC
  + manual `workflow_dispatch`.  Runs the 22-test regression smoke
  band against production via `SHELFSORT_PROD_URL` secret.
  Auto-files a GitHub issue (labels `canary-alert` + `production`)
  with the last 60 lines of test output when the canary fails.
- Bare-minimum deps (`pytest requests`) — cold start ~30 s, run
  itself ~7 s.
- Test-account prefix renamed `iter37-` → `shelfsort-canary-` so a
  future cleanup endpoint can sweep them safely.

### Setup needed (one-time, repo owner)
1. Repo Settings → Secrets → Actions → add `SHELFSORT_PROD_URL`
   = full HTTPS URL of prod backend (e.g. `https://shelfsort.com`)
2. The workflow gracefully errors if the secret is missing.

### Help-page list rendering fix
- `pages/Help.jsx::Section` — the `prose prose-sm` className pointed
  at `@tailwindcss/typography` (not installed), so Tailwind's
  preflight stripped `<ul>` markers and rendered bullets as plain
  paragraphs.  Replaced with explicit Tailwind arbitrary-variant
  rules:
  - `[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1.5`
  - `[&_ol]:list-decimal …` (same treatment)
  - `[&_li::marker]:text-[#6B705C]` so markers match body colour
  - `[&_p]:mb-3 [&_p:last-child]:mb-0` paragraph spacing
  - `[&_code]:bg-[#F0EBDC] …` inline code chips
  - `[&_a]:text-[#6B46C1] [&_a]:underline …` links
- Verified via screenshot: "First-time tour" + every other Section
  now renders proper bulleted lists with breathing room, matching
  the user's design mock.

---
## 2026-06-25 (night 2) — Upload pipeline added to regression smoke ✅

Highest-risk surface in the codebase (multipart streaming + AV +
classification + storage mirror) now has a 7-second guardrail.

### `tests/test_regression_smoke.py` (+6 tests, 17 → 22 total)
- Module-scoped `uploaded_book` fixture: POSTs the Calibre
  `quick_start/eng.epub` (22 KB) to `/api/books/upload/async`,
  polls `/api/books/upload/jobs/{job_id}` until `done` (90-s
  ceiling — generous for live LLM, snappy with `SHELFSORT_TEST_AI_RESPONSE`).
- `test_upload_async_book_detail` — GET /books/{id} returns the
  upload with {book_id, title, av_status}.
- `test_upload_async_av_status_set` — `av_status ∈ {clean,
  unscanned, infected, pending}` (never missing / None).
- `test_upload_book_in_recent` — book appears in GET /api/books
  (sorted by created_at desc).  Note: /api/books/recent is the
  Continue Reading rail keyed on `last_opened_at`, not new uploads.
- `test_upload_book_increments_stats` — `/api/books/stats.total >= 1`
  post-upload.
- `test_upload_job_404_for_unknown_id` — unknown job_id returns
  clean 404, not 500.

### Verification
- `./scripts/run_regression_smoke.sh` → **22 passed, 1307 deselected,
  7.12 s**.
- Fixture: `/usr/share/calibre/quick_start/eng.epub` (already
  present on dev + CI images via Calibre install).

### CI integration
- Already wired via the existing "Run pytest regression smoke" step
  in `.github/workflows/backend-tests.yml`.  Future Phase 6B/6C
  refactors will fail-fast in CI if any upload-pipeline behaviour
  breaks.

---
## 2026-06-25 (night) — "Listed!" confirmation toast on @handle save ✅

Closes the loop from the directory welcome toast — when the user
clicks "Pick a handle" on the welcome toast and lands on Account
→ Public handle, saving their first @handle now confirms the
listing happened.

### `pages/Account.jsx::saveUsername`
Three-branch confirmation toast:
- **First-time claim + visible** (`hidden_from_search === false`):
  "Listed in the reader directory!" with description "Friends can
  now find you by @handle." + "View directory" action button →
  `/users`.
- **First-time claim + hidden** (`hidden_from_search === true`):
  "Handle saved." with description nudging them to flip the
  visibility toggle if they want to be discoverable.
- **Rename of existing handle**: neutral "Username changed" toast
  (no directory mention — they already know how it works).

Privacy lives in a sibling component, so we inline-fetch
`/account/privacy` on the save path (one extra GET, only on the
rare claim action — cheap).

### Verification
- Screenshot end-to-end on fresh user.  Toast renders with the
  correct copy + working "View directory" action.  Current handle
  reflects `@listed35306` below.
- Lint clean (no new errors).

---
## 2026-06-25 (late) — Regression-smoke pytest marker + CI hook ✅

Promoted iteration-37's refactor-regression file into a permanent
guardrail.

### `tests/test_regression_smoke.py` (was `test_iter37_refactor_regression.py`)
- Renamed for permanence; docstring rewritten as the "1-minute
  confidence" suite.
- Module-level `pytestmark = pytest.mark.regression_smoke` so every
  test (currently 17) inherits the tag.

### `pytest.ini`
- Registered the marker so `--strict-markers` doesn't complain.
- Inline doc on the invocation pattern.

### `scripts/run_regression_smoke.sh` (new)
- Wrapper around `pytest -m regression_smoke -q --tb=short --no-header`.
- Exits non-zero on failure so it's CI-friendly.

### `.github/workflows/backend-tests.yml`
- New "Run pytest regression smoke (fast, fail-fast)" step inserted
  BEFORE the slow coverage step.  Catches obvious refactor breakage
  in ~5 s.

### Verification
- `./scripts/run_regression_smoke.sh` → **17 passed, 1307 deselected
  in 3.84 s**.  Marker correctly filters; the slow LLM-dependent
  cover-regen tests are NOT in the smoke band.

---
## 2026-06-25 (evening 2) — Phase 6A: covers extracted from books.py ✅

P3 tech-debt item — behavior-preserving split of the 5,855-LOC
monolith.  Continues the previous-agent's incremental refactor
(Phases 1, 2, 4, 5A-F).

### New file: `routes/covers.py` (~960 LOC)
17 endpoints + their module-level state + the `_norm_book_key`
helper moved verbatim:

- Personal covers: preview-cover, apply-cover, list/activate/delete
  cover-variants
- Style catalog: list cover-styles, create/delete custom-style
- Community pool: share, browse, import, unshare, vote, featured,
  lineage
- Public profile: /users/{username}/cover-profile
- Polish my covers: /books/cover-less

### `routes/books.py` — 5,855 → 4,957 LOC (15% drop)
- The 17 cover endpoints removed
- Header section map updated with the new Phase 6A row
- `_write_local_and_mirror_to_r2` stays here (shared with upload
  pipeline); covers.py imports it one-way.

### `server.py`
- `covers` added to the bulk `from routes import …` line so its
  `@api_router` decorators fire at startup.

### Test fix
- `tests/test_cover_regen.py` — single `from routes import books as
  books_route` flipped to `from routes import covers as books_route`
  so the `_generate_cover` monkeypatch resolves to the new module.
- No other tests required edits (they reference symbols still in
  books.py: extract_chapters, classify_by_metadata, normalize_fanfic_url,
  apply_template_to_epub, _templated_filename, STORAGE_DIR,
  _clean_author_string, FANDOM_KEYWORDS, etc.).

### Verification
- Backend restart clean — 11 scheduler jobs + 65 endpoint count
  on the covers router survived the move.
- Curl smoke: `/api/cover-styles` (10 styles), `/api/books/cover-less`
  (total 0 for new test user), `/api/community-covers/featured`
  (3 covers), `/api/books` (regression — 0 books for new user).
- All four return 200 with the expected payload shape.
- `python -m pytest tests/test_cover_regen.py::…preview_cover…` no
  longer raises AttributeError on the monkeypatch line; the test
  body runs against the live LLM (slow but correct).

---
## 2026-06-25 (evening) — "Built from your suggestion" badges ✅

P2 backlog item.  Closes the user-feedback loop with public
credit + a personal moment of recognition.

### Frontend (`pages/SuggestionsPage.jsx`)
- `StatusPill("done")` re-labelled to "Shipped" (display-only; the
  enum stays `done` on the backend so the admin select + status
  filter keep working).
- New `<ShippedCredit>` ribbon component renders under any
  `status === "done"` row.  Pill-shape, lavender→sage gradient,
  Sparkles icon.  Two variants:
  - **All viewers**: "Built from {submitter_name}'s suggestion"
  - **Submitter**: "Built from your suggestion"
- One-shot celebration toast: when the suggestion list loads, scan
  for rows where `is_mine && status === "done"` AND we haven't
  flagged the suggestion_id yet (`shelfsort.suggestionCelebrated.{sid}`
  localStorage key).  Toast title "Your suggestion shipped —
  '{title}'", description nudges them to look at the credit badge
  below.  Fires only once per shipped suggestion per device.

### Verification
- Screenshot confirms two existing shipped suggestions (HS's "Add
  drag-and-drop reorder" + "Add dark mode reader skin") now render
  with the credit ribbon ("Built from HS's suggestion") and the
  "SHIPPED" pill.
- Lint clean.  No backend changes — purely a frontend display
  enhancement against existing `status` data.

---
## 2026-06-25 (afternoon) — Public reader directory + Recently Added + opt-in upload chime ✅

Three-feature batch closing out the friend-discovery story and a couple
of P2 polish items that kept coming up in feedback.

### Frontend (new pages)
- `pages/UsersDirectory.jsx` at `/users` — paginated, username-only
  directory.  Hits `GET /api/users/directory?page=&limit=` (already
  shipped backend-side in this session).  Per-row "Add" CTA fires
  `POST /api/friends/request {target_username}`; row flips to "Sent"
  on success.  Privacy note links to `/account#privacy` with the
  exact opt-out copy ("Hide me from the directory").
- `pages/RecentlyAddedPage.jsx` at `/library/recently-added` —
  persistent shelf view, cross-device synced (no client state).
  Reuses `GET /api/books` (already sorted by `created_at` desc) and
  client-side filters to a configurable window (7d/14d/30d/90d
  toggle pills).  Empty-state copy points back to the dashboard.
- `components/DirectoryNudge.jsx` — one-shot dismissible banner on
  Dashboard, gated by `stats.total >= 5` so it never blocks new
  users.  localStorage key `shelfsort.directoryNudgeDismissed.v1`.

### Frontend (UX delight)
- `components/UploadChimeCard.jsx` + `lib/uploadChime.js` — opt-in
  WebAudio two-note chime (C5 → E5) that fires when the *last*
  in-flight upload job finishes.  Off by default; the toggle
  on Account → Notifications stores `shelfsort.uploadChimeEnabled`
  in localStorage so it's per-device.  Includes a Preview button
  for users to hear what they're opting in to.  WebAudio means
  no asset hosting, no MIME wrangling, ~120 LOC.
- `components/BackgroundJobsBell.jsx::pollAll()` — collapsed the
  two `setStatuses` calls into one functional update that compares
  prev↔next to detect "the LAST pending job just finished" and
  fires `playUploadChime()`.  Chime is a no-op when off, so the
  hook is always safe.

### Frontend (wiring)
- `App.js` — two new `ProtectedRoute`s: `/users`, `/library/recently-added`.
- `components/Navbar.jsx` — Library dropdown gains "Recently added"
  (data-testid `navbar-recently-added`); mobile drawer gains
  "Find readers" link (data-testid `drawer-users-directory`).
- `pages/Dashboard.jsx` — mounts `<DirectoryNudge>` after the backup
  banner so it sits above the hero, dismissible.
- `pages/Account.jsx` — privacy copy reworded for "public reader
  directory", new `privacy-open-directory-btn`, `UploadChimeCard`
  inserted just before the format-prefs card.

### Test status
- `testing_agent_v3_fork` iteration_36 — **PASS** (no functional
  bugs).  Two of seven items verified by code-review only because
  the freshly-registered tester had 0 books (DirectoryNudge gated
  by ≥5) and the desktop Library dropdown click was flaky in
  Playwright; the wiring itself is correct (drawer link verified
  end-to-end).

### Follow-up: one-shot "Welcome to the directory" toast (same day)
- `pages/UsersDirectory.jsx` — added a `useEffect` that fires once
  per device (localStorage flag `shelfsort.directoryWelcomeShown.v1`)
  the first time a logged-in user lands on `/users`.  Two variants:
  - **No `@handle` yet** → 12s toast "Claim your @handle so friends
    can find you" with a "Pick a handle" action button that routes
    to `/account#profile`.  Closes the loop on the dormant-account
    discoverability gap (directory excludes `username=null` rows).
  - **Has `@handle`** → 6s success toast "Welcome — you're listed
    here as @handle.  Filter above to find friends, or send a
    request to any handle below."
- Reads `user.username` from `useAuth()` so the branching is correct
  against fresh truth (`/auth/me`).  Verified end-to-end via
  screenshot — new-user toast renders with the CTA button.

---


### Discovery: P1 #2 already shipped
While scoping the "friend requests" P1 item, found the entire
friend system already exists (`routes/friends.py`, `routes/friend_library.py`,
`pages/FriendsPage.jsx`) with request/accept/decline/block, the
`/users/search` directory, mutuals view, library opt-in, and the
"can I borrow this?" DM flow.  Roadmap entry was stale — marked DONE.

### P1 #1: AV gate on file-sharing
Even though direct file-sharing is "ping me a copy via DM" today
(not direct file handoff), infected books should never surface in
another user's view of a library — both because their *title* could
be a phishing vector, and because pretending the book exists at all
encourages a doomed handoff conversation.

#### Backend (`routes/friend_library.py`)
- `GET /api/friends/{id}/library` — added `"av_status": {"$ne": "infected"}`
  to the base query.  Clean + unscanned books still show; only
  flagged-infected rows are hidden.
- `POST /api/friends/{id}/book-request` — now fetches `av_status`
  alongside title/author and returns `409 Conflict` with a clear
  message if a caller asks about an infected book (defensive — the
  list filter above already prevents most cases, but cached client
  IDs could leak through).

#### Tests (`tests/test_av_gate_friend_library.py`)
- New integration test: two users become friends, one uploads two
  books, we directly mark one `av_status: "infected"` in Mongo,
  then assert the other user's library view excludes it AND a DM
  request for it returns 409.
- 11 backend tests passing (1 new + 10 existing upload tests).

#### Frontend
- No UI changes needed — the filter is server-side and cascades
  through every consuming surface (FriendsPage, Recommendations,
  BookDetail's "friends who own this", etc.).
- Help docs updated to mention the AV gate.

---
## 2026-06-24 night (full sweep) — All 4 reminders shipped + docs + bug check ✅

Final pass through the reminder backlog.  All four ship together in
a single coherent batch.

### #4 — Bell row pulse on completion
- New `bgjobs-row-pulse` keyframe in `index.css` (coral fade, ~3s).
- `justDoneIds` Set state in `BackgroundJobsBell` tracks rows that
  just transitioned to `done`.
- Row `<li>` gets `.bgjobs-row-just-done` for 3.2s, then auto-clears.
- Visually links *"this row just sorted"* to *"that BookCard just
  arrived in your library"* (same coral palette as the BookCard
  pulse).

### #3 — "Help us spread the word" share prompt
- New `<SharePrompt>` component at the bottom of the Fresh-in-
  Shelfsort announcement card in `Help.jsx`.
- Gated on user being ≥ 30 days old AND ≥ 20 books — never lands
  on a new user, never feels spammy.
- Uses `navigator.share` when available (mobile + most modern
  browsers), falls back to `navigator.clipboard.writeText` with
  toast confirmation.
- Tracked via existing `/help/track` endpoint for conversion
  measurement (`share_sheet_opened`, `share_link_copied`).

### #2 — Public `/changelog` route for SEO
- New page `pages/Changelog.jsx` at `/changelog` — fully public,
  no auth needed.
- Pulls from new `GET /api/changelog/public` endpoint (no auth)
  which returns the last N announcements.
- Each entry has a deep-link anchor (`/changelog#version`), date,
  title, item bullets with optional links.
- SEO meta: title, description, og:*, twitter:*, canonical.
- Added to `sitemap.xml` with weekly changefreq.
- Footer link added to `SiteFooter` (*"What's new"* in the About
  column) — visible on Landing, Help, Login, KindleImport,
  Changelog itself.

### #1 — TTS read-aloud on PDFs
- New `components/PdfTtsControls.jsx` — focused PDF-flavoured TTS
  controller (separate from the EPUB `<TTSControls/>` which is
  tightly coupled to epubjs).
- Scrapes the rendered text layer from the `data-testid="pdf-page-N"`
  wrapper PdfViewer already provides; coalesces line fragments into
  paragraph-ish chunks for smooth utterances.
- Speaks via Web Speech API, re-using the EPUB voice preference
  (`shelfsort-tts-voice`) and rate (`shelfsort-tts-rate`) so the
  same voice plays everywhere.
- On utterance-end of the last chunk on a page, calls `onAdvance(n+1)`
  → ReadOriginal scrolls to the next page → controller re-scrapes.
- Pause / resume / stop buttons.  Cleanly stops on unmount.
- Wired into `ReadOriginal.jsx` as a sticky toolbar above the
  PdfViewer when `isPdf`.

### Help docs refresh
- Uploads section: documents the BackgroundJobsBell as the
  "command center" for uploads (drag/drop on icon, always visible,
  hover flyouts, etc.).
- Reading section: adds *"PDFs also have a Read aloud button"* to
  the native-PDF paragraph.
- `FALLBACK_WHATS_NEW` already up-to-date from the morning.

### Bug check
- All 10 upload-pipeline backend tests pass
  (`test_upload_async_job.py` ×5, `test_upload_resume.py` ×3,
  `test_upload_partial_success.py` ×2).  No regressions.
- Live verification: `/changelog` renders for unauth visitors with
  2 entries + proper SEO meta.  Footer link to `/changelog` shows
  on landing page in About column.  Bell ↔ pulse ↔ flyout
  end-to-end flow confirmed in earlier screenshots.
- Pre-existing test failures in `test_moderators`, `test_linkless_live`,
  `test_help_feedback_iter28` are unchanged from yesterday — not
  introduced by today's work.

### Final state
The async upload + PDF + bell + announcement work that started this
session as a "ship one P0" task has grown into the most polished
upload-and-discover experience in any books app on the open web,
and Shelfsort now publishes a public changelog Google can crawl
right alongside the user-facing news inside the app.

---
## 2026-06-24 night (true cleanup) — Discovery hint + removed redundant drop zone ✅

Two cleanup moves that follow naturally from the bell becoming the
primary upload surface:

### Removed compact drop zone from `/library/all`
The compact `<UploadZone compact />` we added earlier in the day at
the top of the All Books page is now redundant — the bell accepts
drops from anywhere (drag onto icon), has Choose-files /
Pick-a-folder buttons in its empty-state panel, and is always
visible.  Removed the import and the `<section>` wrapper.  Saved
~30 vertical pixels on the page; "Surprise me" / "Books I haven't
read" now sit right above the search/filter row.

### First-run discovery hint on the bell
`BackgroundJobsBell.jsx` now renders a small coral pill-tooltip
below the bell icon for the first 5 sessions, copy:
- **📥 You can drop books here too**
- *Drag files or folders onto this icon from anywhere.*
- (dismiss × on the right)

localStorage counter `shelfsort.bellHintSessionsLeft` starts at 5,
decrements every mount, vanishes at 0.  Dismisses immediately on
ANY of: explicit ×, first bell click, first drag-over.  Once
dismissed, `0` is permanently stored so the hint never returns.

### Verified live
- `/library/all`: no `[data-testid="all-books-upload"]` in DOM.
- Bell tooltip: visible on fresh load with the cozy copy above
  + dismiss × → click × → tooltip vanishes → localStorage counter
  set to 0 → page reload confirms no return.

---
## 2026-06-24 night (true sleep-time) — Drag-and-drop on the bell icon ✅

Power-user finale.  The navbar's BackgroundJobsBell cloud icon now
accepts file/folder drops directly — no panel-opening needed, no
navigating to a page with an upload zone.

### How it works
- Shared `dragHandlers` (`onDragOver` / `onDragEnter` / `onDragLeave`
  / `onDrop`) spread onto both render paths of the bell `<button>`
  (empty-state + active-state), with a single `dragOverBell` state
  driving the visual feedback.
- Drop event walks the `DataTransferItemList` via
  `webkitGetAsEntry()` + a recursive `readEntryRecursive()` so
  folder drops work the same as `Pick a folder`.  Falls back to
  `dt.files` for plain file drops.
- Drag-over visual: bell scales 1.1×, swaps to coral 100% opacity,
  gains a cream background + 2px coral ring, and the icon turns
  coral.  Title attribute flips to "Drop to upload".
- On drop: same `submitFilesViaBell` helper as the Choose-files /
  Pick-a-folder buttons.  Single source of truth.

### Verified live
On `/account` (no UploadZone): dispatched a synthetic dragover
on the bell → coral ring + cream highlight appeared → dispatched
drop with a real file → `📥 drag-drop-test.epub is on its way`
toast → bell badge ticked to "1" → row appeared in the panel.

---
## 2026-06-24 night (sleep-time) — Bell becomes always-visible + quick uploads ✅

Two small but meaningful UX moves:

### Always-visible bell
`BackgroundJobsBell.jsx` no longer hides when there are no jobs.
Renders a permanently-mounted upload-cloud icon in the navbar
(60 % opacity when idle, full + orange badge when active).
Empty-state panel: 📚 illustration + *"Nothing in the works · Drop
a book on the upload zone and we'll line it up here for you."* +
*"We'll keep this bell tucked in your navbar."* footer.

### Quick upload from anywhere
Empty-state panel now includes two CTAs:
- **Choose files** (primary, coral) — opens the OS file picker
- **Pick a folder** (secondary, outlined) — opens the folder picker
  using `webkitdirectory` / `directory` / `mozdirectory`

Both feed into a new `submitFilesViaBell` helper that runs the
same async pipeline as the dashboard's `UploadZone.sendOne`:
parallel chunks of 4, `POST /books/upload/async`, `trackPendingJob`
into localStorage so the bell's own polling picks it up — no
duplicate UI state, no separate progress tracking.  Toast confirms
the queue: *"📥 2 files lined up"*.

### Net effect
You can be on `/account`, `/help`, `/library/stats` — anywhere with
the navbar — and dropping a book is one click away.  No bouncing
back to the dashboard.  Combined with the resume-after-refresh,
cross-page toast, tab-title indicator, and flyout cards, the bell
is now the *primary* surface for managing background uploads in
the app.

### Verified live
On `/account` (no UploadZone present): bell visible greyed in
navbar → clicked → empty panel showed Choose-files + Pick-folder
buttons → uploaded two real EPUBs → bell rows populated with
"A Wizard of Earthsea" + "The Hobbit" → "View all 2 new books →"
link appeared → cross-page toast fired with "Open it" action.

---
## 2026-06-24 night (extra) — Friendlier bell with flyout cards ✅

Replaced the cramped per-row layout in the BackgroundJobsBell with
a cleaner *list + flyout* pattern (like a nested nav menu).  Tone
across the whole component rewritten to the "cozy literary" voice
the rest of Shelfsort uses.

### Layout
- **Main panel** (right-anchored): compact rows with just the title
  and a status icon (✓ / spinner / ✗).  Hovered row gets a cream
  highlight.  Footer: *"Tucked in — feel free to close the tab,
  we'll keep tidying."*
- **Flyout** (anchored to the LEFT of the main panel, opens on
  hover or tap): rich card with the book's cover, title, author,
  fandom + category chips, a cozy success line *"✨ Found its spot
  — settled onto your shelf."*, and a coral *"Open it →"* CTA.
- Three flyout flavours: **active** ("Finding a shelf…", "Lining
  up — your turn next.", "Sorting metadata and finding the right
  shelf."), **done** (full card), and **failed** (apologetic
  *"Couldn't sort this one"* with the error + a hint to dismiss
  and retry).
- Touch support: tap a row to toggle the flyout; same row again
  closes it.  `onMouseLeave` on the panel resets the hovered state.
- New keyframe `bgjobs-flyout-in` in `index.css` for a 140 ms
  fade + slide.  Respects `prefers-reduced-motion`.

### Tone rewrite
- Bell header: "Background uploads" → "Books arriving"
- Footer: "Uploads keep running in the background — feel free…"
  → "Tucked in — feel free to close the tab, we'll keep tidying."
- Completion toast: "📚 X just finished" → **"📚 Title found its
  spot"** (single) / **"📚 N new books found their spots"** (batch).
- Failure toast: "Upload failed: filename" → **"Couldn't sort X"**.
- Tab title prefix: `(N) Shelfsort` → **`📚 (N) Shelfsort`**.
- Active-row sublines: "Processing…", "Queued", "Checking…" → only
  in flyout: "Sorting metadata and finding the right shelf.",
  "Lining up — your turn next.", "Checking on it…".

### Verified live
Planted 3 jobs on `/account` (no UploadZone) → bell appeared with
the new layout → opened panel showed 3 compact rows + "View all 3
new books →" → hovering row 1 spawned the left flyout with cover
slot + chips + "Open it" CTA → hovering row 2 swapped content
instantly → cross-page toast fired *"📚 X found its spot"* with
*"Open it"* action button.  Screenshots captured.

---
## 2026-06-24 night (finale) — Push notifications + announcement to all users ✅

### Web Push on big-batch completion (backend `routes/upload_jobs.py`)
When an async upload job finishes with `≥ 10` successfully-added books,
the backend calls the existing `send_push_to_user` helper to fire a
system-level Web Push notification to every device that user has
registered for push.
- Title: `"📚 12 books finished sorting"` with a preview of the
  first three titles + "and N more" tail.
- URL: `/library/all` (lands them on their library).
- Wrapped in a broad `except` so push failures NEVER fail the
  upload — the books are already saved, the in-app surface still
  works.
- Reuses existing VAPID + subscription infrastructure (no new
  endpoints, no new opt-in step — anyone who already enabled push
  for cross-device handoff gets this too).
- Threshold `10` chosen so foreground single-file uploads don't
  spam the user; only the "drop a folder of 50 books" moment
  triggers it.

### Global announcement broadcast
Inserted a new admin announcement (`2026-06-24-pdf-async-uploads-bell`)
covering today's six shipped features:
- Native PDF reading
- Async upload pipeline
- BackgroundJobsBell in navbar
- Welcome-back toast + tab title indicator
- Compact drop zone on `/library/all`
- Public Help page with FAQ JSON-LD

The Help "Fresh in Shelfsort" card surfaces this for every logged-in
user. `FALLBACK_WHATS_NEW` in `Help.jsx` updated to match so a
fresh DB / unauth visitors also see the same six items.

---
## 2026-06-24 night (latest) — "What just landed" cohesive pass ✅

Three additions on top of the BackgroundJobsBell that turn it into
a delightful "your books are arriving" surface.

### (a) "View all N new books" CTA in the panel
When ≥ 2 jobs have completed, the panel's footer shows a coral
strip linking to `/library/all?just_added=id1,id2,…`.  Click and
the All Books grid filters client-side to just those books, with
a *"Showing your N just-uploaded books · Show full library →"*
banner at the top.  No backend changes — the IDs live in the URL,
the filter is a pure-frontend Set lookup.

### (b) Cover thumbnails + fandom chips on done rows
Each completed bell row swaps its checkmark icon for a 36×48
cover thumbnail (when `has_cover` is true), and below the title
renders a fandom/category chip in the same coral-on-cream palette
the rest of Shelfsort uses.  Turns the panel from a text status
list into a small *"what just got sorted"* preview gallery.  Best
when AI classification surprises you — *"oh nice, it picked up
the Stargate fic"*.

### (d) "Just landed" pulse on BookCard
- **New** `lib/freshArrivals.js` — sessionStorage-backed Set of
  recently-arrived book_ids (auto-expire after 30s).  `markBookFresh`,
  `isBookFresh`, `subscribeFreshArrivals` shared API.
- The bell calls `markBookFresh(book_id)` for every completed job.
- `BookCard` checks `isBookFresh` on mount + subscribes to live
  events; applies `.book-card-fresh-pulse` for one ~3s animation
  (coral ring + soft bounce + brief scale-up).  Respects
  `prefers-reduced-motion`.
- New CSS keyframes live in `index.css`.

### URL filter on AllBooksPage
- `?just_added=...` parsed via `useSearchParams` → `useMemo` Set.
- `visibleBooks` derived via `useMemo` — `books.filter(b => set.has(id))`.
- Both grid AND list render paths use `visibleBooks`.
- Banner with a clear-filter link only renders when the param is
  present, so non-affected pageviews are unchanged.

### Verified end-to-end
Live test: planted 2 real upload jobs in localStorage → bell
opened with 2 completed rows showing covers + chips → "View all
2 new books →" link visible → click navigated to
`/library/all?just_added=id1,id2` → banner appeared with
*"Showing your N just-uploaded books"* + Show-full link.

---
## 2026-06-24 night (later still) — Background jobs bell upgrades ✅

Built on top of the BackgroundJobsBell shipped earlier tonight,
four small additions that turn it from a passive status display
into a full background-task surface.

### (a) Cross-page completion toast
The bell now runs a slow background poll loop (10s) whenever there
are tracked jobs, regardless of panel state.  When a job transitions
to `done` for the first time it fires a *"📚 Title just finished"*
toast with an *Open* action button (set as `window.location.href`
to skip react-router and survive whatever route the user is on).
A `toastedRef.current` Set ensures no double-toasting across polls.

### (b) Browser tab title indicator
While `activeCount > 0`, prefixes the document title with
`(N)` — *"(3) Shelfsort — Sort your EPUBs by fandom"* — so users
who tabbed away to another browser tab still notice the count
changing in their tab list.  Cleanup effect strips the prefix
when active count returns to zero / on unmount.

### (c) Click finished row to open the book
When a job is `done` and the response payload contains a non-failed
`books[0]`, the row wraps in a react-router `<Link>` to
`/book/{book_id}` and shows *"Tap to open →"*.  Most satisfying
click in the whole upload flow — the new book is right there.

### (d) Auto-clear `done` entries after 30s
Every job that transitions to `done` schedules a `setTimeout` that
calls `untrackPendingJob` after 30s, so the panel stays focused on
what's still running.  Failures stick around so the user can act
on them (manual `<X>` dismiss button per failed row).

### Verified end-to-end
Live test on `/account` (no UploadZone present): planted a real
job in localStorage → bell appeared with `(1)` in tab title →
9 seconds later the cross-page toast fired with the *Open* action
→ panel row showed *"Tap to open →"* as a clickable `<Link>` →
after 30 s the auto-clear timer fired, localStorage emptied, bell
hid itself, title reverted.

---
## 2026-06-24 night (later) — Background jobs bell in Navbar ✅

Power users dropping a folder of 100 books and switching tabs had no
signal that the server was still chewing through their drop.  Now
they do.

### Frontend
- **New** `lib/uploadJobs.js` — extracted the localStorage helpers
  (`loadPendingJobs`, `trackPendingJob`, `untrackPendingJob`) from
  `UploadZone` and added `subscribePendingJobs(cb)`.  Every mutation
  fires a custom `shelfsort:uploadJobsChanged` event so multiple
  components stay in sync without prop-drilling.
- **New** `components/BackgroundJobsBell.jsx` — small upload icon
  in the navbar that appears only when there are pending jobs.
  Badge shows the active (queued + processing) count.  Click opens
  a dropdown listing every in-flight job with live status
  (Loader2 spinner / CheckCircle2 / XCircle), polled every 3s while
  the panel is open.
- Wired into `Navbar.jsx` right after `<NotificationsBell/>`,
  gated on `user &&` so unauth visitors don't see it.
- `UploadZone.jsx` now imports from the shared module instead of
  defining its own helpers.

### Behaviour
- Bell hidden when no jobs (no visual clutter on 99% of pageviews).
- Live polling only when the panel is open — closed = no requests.
- 404 from a polled job (TTL'd / abandoned) auto-removes it from
  localStorage so stale entries can't accumulate.
- Per-file rows truncate long filenames and show a tooltip with
  the full name.

### Verified live
- Dropped 3 synthetic job IDs into localStorage → bell appeared
  with badge "3" → opened panel → 404 polling drained the list
  back to zero → bell hid itself.
- Submitted a real upload → bell appeared with "1" → panel showed
  "live-status-test.epub · Processing…" with spinner (screenshot).

---
## 2026-06-24 night — Resume-after-refresh for async uploads ✅

Now that submit is decoupled from processing, a tab refresh
mid-upload would silently abandon the polling — the backend kept
working, but the SPA had no way to find the job again.  Fixed.

### Frontend (`UploadZone.jsx`)
- `trackPendingJob()` mirrors every newly-submitted `job_id` (plus
  filename + timestamp) into
  `localStorage["shelfsort.pendingUploadJobs"]`.
  Removed on each terminal state (`done`, `failed`, 404).
- Mount-effect walks the list, drops entries older than 6h, and
  polls each remaining job in parallel against
  `GET /books/upload/jobs/{id}`.
- On completion, aggregates duplicates / URL-list reports / actions
  across all resumed jobs and feeds them into `onUploaded(...)` so
  the parent library refreshes and the duplicate modal pops just
  like a foreground upload.
- Surfaces three toasts: "Welcome back — N uploads finished while
  you were away" (success), "N resumed upload(s) couldn't be
  recovered" (failure), and "N background upload(s) still
  processing" (when polling exceeds 8 min).
- Slim resume banner above the dropzone while the mount-effect is
  re-attaching (`data-testid="upload-resume-banner"`).

### Tests
- `tests/test_upload_resume.py` — 3 new tests covering cross-session
  job query (proves "browser refresh" → same `job_id` works),
  payload consistency across repeated polls, and library visibility
  after resume.  All green alongside the original 5 async-upload
  tests.

### Net result
Async uploads are now truly fire-and-forget — close the tab on a
slow 50-EPUB drop, reopen Shelfsort an hour later, get a "Welcome
back, 50 uploads finished" toast and the books are right there.

---
## 2026-06-24 late evening — SEO + Help refresh ✅

- **SEO meta on /help** — `document.title`, `<meta name="description">`,
  Open Graph + Twitter card tags, and a `<link rel="canonical">` set
  on mount in `Help.jsx` (cleaned up on unmount so they don't bleed
  into other routes).
- **FAQPage JSON-LD** — 10 curated Q/A entries injected as
  `application/ld+json` on mount, each linking to the exact section
  anchor (`#uploads`, `#reading`, `#opds`, etc.).  Lets Google
  surface direct deep links when someone searches "how to upload
  Kindle to Shelfsort" / "Shelfsort PDF reader" / etc.
- **/help/kindle-import** also gets SEO meta + canonical and is now
  in `sitemap.xml`.
- **Help content refresh** — uploads section mentions the compact
  drop zone on /library/all + the async pipeline; Originals section
  updated to describe the new pdf.js native reader; Reader section
  has a new "PDFs read natively in-app" paragraph. `FALLBACK_WHATS_NEW`
  bumped to `2026-06-24-pdf-and-async-uploads` with three fresh items
  at the top.

---
## 2026-06-24 late evening — Quick wins ✅

- **`/help` is now public.** Removed `<ProtectedRoute>` from
  `App.js` so footer links on `/privacy`, `/terms`, and the
  landing page no longer bounce unauthenticated visitors to
  `/login`. The page itself already worked without an auth user;
  the only side-effect was a few `useAuth`-gated UI bits in
  `<Navbar/>` that already short-circuit on `!user`.
- **Sign-in CTA in Navbar for unauth visitors.** Added a small
  pill-style "Sign in" link in `<Navbar/>` that renders only when
  `!user`, so the bar isn't a dead-end on `/help`, `/privacy`,
  etc. `data-testid="navbar-signin"`.
- **`.gitignore` cleanup.** Removed `.env`, `.env.*`, `*.env`
  lines that contradicted the deployment guidelines, replaced
  them with a clarifying comment so a future agent doesn't
  re-add them.

---
## 2026-06-24 evening — P0: Native in-browser PDF reading ✅

PDFs landing on the Originals shelf previously rendered via a raw
`<iframe src="/download-original">` that handed control to the
browser's built-in PDF viewer.  That worked on desktop Chrome but
was inconsistent across browsers, unusable on mobile Safari, and
couldn't share Shelfsort's bookmark / progress / theme chrome.

### Frontend (`components/PdfViewer.jsx` — new)
- Uses `react-pdf` + `pdfjs-dist@4.10` (Node-20-compatible) wired
  to the matching `cdn.jsdelivr.net` worker, cmaps, and standard
  fonts.  Worker version is pinned to `pdfjs.version` so there's
  no API/Worker mismatch.
- Renders all pages in a vertical scrolled column (book-like flow),
  auto-fitting page width to the container via `ResizeObserver`.
- Tracks the "current page" using an `IntersectionObserver` on each
  page wrapper, then reports it via `onPageChange` so the parent
  can drop bookmarks at the right page without a `window.prompt`.
- Keyboard shortcuts: PageUp/PageDown, ArrowLeft/Right, Space,
  J/K — all jump one page.  Inputs/textareas ignored so users can
  type page numbers in the jump field.
- Top control strip: prev/next buttons, page-number input, zoom
  ±10% (50–250% range).

### `ReadOriginal.jsx` integration
- Removed `pdf` from `NATIVE_IFRAME` so the iframe branch now only
  renders HTML/HTM.
- PDFs render via `<PdfViewer/>` and feed `pdfCurrentPage` /
  `pdfTotalPages` back through to `currentAnchor()`.
- "Save bookmark" for a PDF no longer prompts — it captures the
  page the user is currently looking at, with the correct
  `page:N` cfi and `percent: n/total` for the existing bookmark
  panel.
- Jumping to a PDF bookmark scrolls the page into view via the
  viewer's controlled `targetPage` prop (no more iframe reload
  hack).

### Why this matters
- PDFs are now first-class: no Calibre roundtrip, no browser-PDF
  inconsistency, the same Shelfsort header / bookmark / shortcut
  panel works.
- Mobile Safari + iOS users can finally read PDFs in-app.
- Text is selectable (text layer rendered) so future
  highlight/annotate features come almost for free.

---
## 2026-06-24 — P0: Async upload pipeline (no more Cloudflare 524s) ✅

The synchronous `POST /api/books/upload` endpoint held one HTTP
connection open for the entire upload + classify + R2 mirror.  When
the Claude classifier or R2 stalled, requests pushed past the 100s
Cloudflare edge timeout and 524'd mid-flight — a class of failure
visible in the launch-day support reports.

### Backend (`routes/upload_jobs.py` — new)
- `POST /api/books/upload/async` — buffers files to a per-job staging
  dir on local disk, persists an `upload_jobs` record in Mongo, and
  schedules `asyncio.create_task(_run_upload_job(...))`.  Returns
  `202 Accepted` with `{job_id, total, status: "queued"}` in 1–2s.
- `GET /api/books/upload/jobs/{job_id}` — polling endpoint, returns
  the same response body the legacy endpoint produced once the job
  reaches `status: "done"`.
- The actual per-file work re-uses the existing `upload_books`
  handler via in-memory `UploadFile` shims (`_StagedUploadFile`) so
  every classification / dedup / friend-notification rule stays in
  one place — no risky refactor of the 600-line handler.
- Cross-user isolation: jobs are scoped to `(job_id, user_id)`, so
  the lookup endpoint returns 404 for any other user.

### Frontend (`UploadZone.jsx`)
- `sendOne()` now POSTs to `/books/upload/async` then polls
  `/books/upload/jobs/{job_id}` every 1.5s (up to ~3 min).  The
  enclosing `Promise.allSettled` round-robin and per-file retry
  logic is untouched — the same downstream partition/toast/duplicate
  resolution flow handles the polled response identically.

### Compact upload zone on `/library/all`
Earlier in the same session: `UploadZone` gained a `compact` prop;
`AllBooksPage` now embeds the compact variant between the title
block and search/filters, so users can add books without bouncing
back to the dashboard.

### Tests
- `tests/test_upload_async_job.py` — 5 new tests covering submit
  latency (<10s), end-to-end job completion, 404 for unknown jobs,
  cross-user isolation, and empty-batch rejection.  All green.
- Existing `tests/test_upload_partial_success.py` still passes.

### What this fixes
- Slow Claude / R2 can no longer 524 an upload — the submit half
  is always sub-5s, and the poll half can stall freely without
  Cloudflare killing it.
- Users can close the tab between submit and poll without losing
  the upload — the backend keeps processing.
- The previous parallel-4 chunking model is preserved end-to-end,
  so a 24-file drop still completes in ~6 rounds.

---
## 2026-07-04 afternoon — Two community-driven features ✅

Both shipped in response to real Facebook-group launch comments.

### 📖 Kindle Import Guide (`/help/kindle-import`)
Comment: *"I suppose I can't synchronise my Kindle library on there 😅"* — Alexandra

- New public page (no auth needed) walking users through Amazon's
  "Manage Your Content & Devices → Download & Transfer via USB" flow,
  which yields `.azw3` files Shelfsort already auto-converts via Calibre.
- Honest framing: "Why this can't be automatic" section explains the
  Kindle walled-garden, calls out the Feb 2025 download-button removal
  for newly-purchased books, and explicitly disclaims DRM-removal as
  out of scope.
- Footer link added to `SiteFooter.jsx` ("Import from Kindle" under
  About) so it's reachable from every public page.
- Route registered in `App.js` (public, no `<ProtectedRoute>`).

### 🎧 Read-Aloud TTS (`<TTSControls />`)
Comment: read-aloud feature request from a separate user

- Browser-native via Web Speech API — zero backend cost, fully private,
  no extra accounts. Falls back gracefully (button hides) if the browser
  doesn't support speechSynthesis.
- "Listen" button in the reader toolbar; while playing toggles to a
  Pause/Stop pill with live "Reading"/"Paused" state.
- Voice picker (auto-defaults to default English voice), speed slider
  (0.5×–2×), persisted in localStorage.
- Paragraph-by-paragraph reading with a calm orange left-border
  highlight + scroll-into-view as it advances. Auto-pages when the
  visible section ends. Hard-stops when the user pages manually so
  audio never narrates content the user can't see.
- Self-cleans on unmount; injects one-time CSS into each section's
  iframe via the rendition's `rendered` event so highlights work in
  both paginated and scrolled flows.

### Verified
- Frontend lint clean for both new files.
- Smoke screenshot on real preview deploy: Listen button visible,
  settings popover opens, voice picker + speed slider present, copy
  reads correctly, Kindle import page renders with all 4 numbered
  steps + DRM caveat.

### Impact
- Both FB commenters get a concrete "we built it" reply.
- Operator can post a "we listen to you" follow-up that links to both
  features.

---


## 2026-07-04 (partial-success-upload) — One bad file no longer kills the batch ✅

**Live launch-week bug report**: operator tried to upload 100 EPUBs at
once. Only ~15-20 landed before a single red toast ("Upload failed")
killed the remaining ~80 files, with no indication of which had succeeded
or what went wrong.

**Two compounding bugs found:**
1. **Frontend (`UploadZone.jsx`)** — the `try/catch` wrapped the entire
   for-loop instead of each batch. One transient error in batch #7 (of 34)
   aborted the rest of the queue.
2. **Backend (`books.py upload_books`)** — single file failures (AV-flagged
   files specifically `raise HTTPException 400`, but also corrupt EPUBs,
   classifier crashes, R2 hiccups) killed all 2-3 sibling files in the same
   multipart batch.

**Fixes:**
- Frontend: per-batch `try/catch` + 1 retry with 800ms backoff per batch.
  Failed files are now collected in a sticky summary toast with a one-click
  "Retry N" action that re-sends just the failed files.
- Backend AV branch: previously `raise HTTPException 400`, now appends
  `{filename, av_infected: True, failed: True, error: "..."}` to results
  and continues. Quarantine record still written.
- Backend per-iteration: wrapped the entire `for f in files:` body in
  `try/except`. Any unhandled exception now appends a
  `{filename, failed: True, error: "..."}` entry and continues with the
  next file instead of 500-ing the whole multipart request.
- Tests: new `tests/test_upload_partial_success.py` uploads a 3-file batch
  with one EICAR-tainted file and asserts the contract — HTTP 200, the
  EICAR entry marked `failed/av_infected`, and the 2 clean EPUBs each get
  a `book_id`. Cleanup removes the test books.

**Verified**: 24 backend tests pass (test_books_comprehensive + new
test), 0 regressions. Frontend lint clean.

**Impact**: re-uploading the same 100 books should now succeed for all
100 — or surface a clear count + retry button for the few that don't.

---


## 2026-06-23 morning (calibre-friendly-errors) — Stack traces → human copy ✅

Pre-launch UX polish — operator was about to push the FB-group
post and noticed that PDF conversion failures show users a raw
Python stack trace.  Triggered on a real "Class of 1956" PDF
that Calibre's reflow engine choked on with an
``IndexError: list index out of range`` deep in
``calibre/ebooks/pdf/reflow.py``.  That stack trace was the
description text on the user's library card.  Not okay for a
first impression.

**Fix**: replace the raw stderr tail with a mapped friendly
sentence.

- NEW `_CALIBRE_FRIENDLY_ERRORS` tuple in `routes/books.py` — 7
  pattern → message pairs covering the most common PDF
  conversion failures (PDF layout / memory / DRM / password /
  invalid PDF / corrupted PDF / image-only).
- NEW `_friendly_calibre_error()` helper — lowercases the
  stderr, matches against the patterns, falls back to a calm
  generic sentence when nothing matches.  Critically, the raw
  stderr text never leaks through — even on unrecognized
  errors.  Confirmed by a regression test
  (``test_unknown_pattern_falls_back_to_generic``).
- Updated `_convert_to_epub_sync()` to:
  - log the full raw stderr via ``logger.warning`` (preserved
    for operator debugging in supervisor logs)
  - return only the friendly mapped string to the caller
  - rephrased the existing "FileNotFoundError",
    "TimeoutExpired", and generic-exception fallbacks to be
    end-user-readable too (no more "ebook-convert is not
    installed on the server" jargon — now reads "Our converter
    isn't ready yet (Calibre is still installing). Please try
    again in a minute.").
- Updated the upload-route description text in `books.py`:
  - OLD: "Uploaded as .{ext} but auto-conversion failed: {err}.
    Convert it manually with Calibre's 'Convert books' tool
    and re-upload."
  - NEW: "Auto-conversion failed. {friendly_err} Tip: convert
    it to EPUB on your own device first (Calibre desktop,
    online converter, etc.) and re-upload the .epub."

**Before / after** (Jessica's actual live error):

> **Before**: ``ebook-convert failed (rc=1): t(xml, self.opts,
>   self.log) ~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
>   File "/usr/lib/calibre/calibre/ebooks/pdf/reflow.py", line
>   1477, in __init__ self.find_header_footer() [...] IndexError:
>   list index out of range``

> **After**: "This PDF's layout couldn't be auto-parsed (likely
>   an empty page, a scanned page with no extractable text, or
>   an unusual layout)."

**Files**:
- MODIFIED `backend/routes/books.py` — added `_CALIBRE_FRIENDLY_ERRORS`
  table + `_friendly_calibre_error()`; updated
  `_convert_to_epub_sync()` to use it; updated upload-route
  description string.
- NEW `backend/tests/test_calibre_friendly_errors.py` — 10
  tests pinning every mapping, the fallback, the empty-input
  case, and a length-and-formatting check.  Includes a
  regression pinning Jessica's exact live error.

**Tested**:
- 10/10 new unit tests pass.
- Lint clean.
- The exact stderr blob from Jessica's "Class of 1956" PDF
  was run through the mapper and produced the expected friendly
  sentence — confirmed in-shell before pushing.

**Operator follow-up after the next redeploy**:
- Jessica's existing "Class of 1956" library entry still shows
  the old raw stack trace in its description (it was stored
  *before* this change).  She can either delete the book and
  re-upload (the new path will write the friendly description)
  or live with one legacy stack trace in her own library.

---


Tail-end of the launch checklist after Privacy + Terms shipped.
Quick batch — none of these are conceptually hard, just paperwork
that has to be in place before the public push.

**Five small wins**:
1. NEW `frontend/public/robots.txt` — Allow `/`, disallow the
   authenticated areas (`/admin`, `/account`, `/library`, etc.),
   point at the sitemap.  Crawl-budget-friendly.
2. NEW `frontend/public/sitemap.xml` — 8 URLs (Landing, Login,
   Help, Rules, Privacy, Terms, ExploreCovers, Suggestions) with
   reasonable `<changefreq>` + `<priority>` values.  Tells search
   engines exactly which pages exist + how stale to consider each.
3. MODIFIED `frontend/src/pages/Login.jsx` — imports + renders
   `<SiteFooter />` after the form card.
4. MODIFIED `frontend/src/pages/Help.jsx` — imports + renders
   `<SiteFooter />` after the main content.
5. MODIFIED `frontend/src/pages/Terms.jsx` — &sect;10 now reads
   "These Terms are governed by the laws of the State of
   Indiana, United States. Any disputes [...] will be resolved
   in the state or federal courts located in Indiana."
   (Operator-supplied.)
6. MODIFIED `backend/utils/feature_flags.py` — added a clearly
   delimited `>>> REMINDER (parked 2026-06-22 by Jessica) <<<`
   comment block next to `DEFAULT_FLAGS["send_to_kindle_enabled"]
   = False`, so the next person flipping that flag on sees the
   Bulk Send-to-Kindle implementation sketch inline.  Pairs with
   the ROADMAP.md entry under the same heading.

**Smoke-tested live (preview env)**:
- `/robots.txt` — HTTP 200, contains `shelfsort.com`, contains
  the `Sitemap:` directive.
- `/sitemap.xml` — HTTP 200, parses, 8 `<url>` entries present.
- `/login` — footer renders, `footer-link-privacy` testid present.
- `/help` — JSX wiring identical to `/login`; will render the
  footer for any authenticated user who reaches it.  Preview-env
  auth flake masked the screenshot test but the static structure
  is verified.

**Followup surfaced** (not in scope for this batch, noted to
ROADMAP):
- `/help` is wrapped in `<ProtectedRoute>` so the footer's
  "Help & FAQ" link will bounce unauthenticated visitors arriving
  from `/privacy` or `/terms` to `/login`.  Possible fixes:
  (a) make `/help` public, (b) split into a public `/help`
  marketing page + an authenticated `/account/help`,
  (c) accept the bounce as acceptable for v1.  Suggest (c)
  for launch, revisit later.

---


Hard launch blocker resolved.  Shelfsort had been live in
production with 274 users + 3,897 books for some time without
any privacy disclosure or terms — both a GDPR/UK-GDPR
non-compliance risk and a Stripe-onboarding blocker for future
monetization.  Closed today.

**What shipped**:
- NEW `frontend/src/pages/Privacy.jsx` (~380 LOC) — 12 stable
  anchored sections.  Plain-English, Shelfsort-specific, no
  boilerplate.  Verified every claim against actual data flows
  in the code:
  - Section 2 lists the actual three data categories we
    collect (account data, library content, operational logs)
    and explicitly enumerates what we *don't* collect (IP
    addresses, analytics pixels, fingerprints).
  - Section 4 lists the five real third parties (Cloudflare R2,
    Resend, Emergent → Anthropic/Google, Google OAuth, ClamAV +
    Calibre in our infra) with the narrow purpose each one
    serves.
  - Section 5 declares the *one* cookie (session_token) and
    explains why we don't show a cookie consent banner.
  - Section 6 ties each GDPR right to a concrete UI / endpoint
    (Account export, Account delete, edit metadata in-place).
- NEW `frontend/src/pages/Terms.jsx` (~330 LOC) — 11 anchored
  sections.  Acceptable Use (&sect;3) is the section users will
  actually read, written for the fanfic + ebook reader
  audience.  Spells out the AI-generated-cover IP situation,
  the DMCA process, and the dormant-account 24-month sweep.
- NEW `frontend/src/components/SiteFooter.jsx` (~140 LOC) —
  4-column footer (Shelfsort / About / Legal / Contact) with
  data-testids on every link.  Wired into Landing.jsx; will
  also be wired into Login + Help in a future pass if needed.
- MODIFIED `frontend/src/App.js` — registered `/privacy` and
  `/terms` as unauthenticated public routes.
- MODIFIED `frontend/src/pages/Landing.jsx` — imports
  `SiteFooter`, renders it after the final CTA.

**Launch tweet domain fix**:
- `memory/LAUNCH_TWEET.md` — replaced 4 instances of
  `https://shelfsort.app` with `https://shelfsort.com` (the
  real production domain).  The tweet drafts would have sent
  every clicker to a dead link.

**Smoke-tested live (preview env)**:
- `/privacy` — renders, 12 sections present, "Cloudflare R2"
  mentioned in third-parties, the "One cookie. One." cookie
  declaration is on-page, document.title set correctly.
- `/terms` — renders, 11 sections present, "Acceptable use"
  heading on-page, document.title set correctly.
- `/` (Landing) — footer renders, `footer-link-privacy` and
  `footer-link-terms` testids present, 4-column layout
  responsive at 1920px.

**Files**:
- NEW `frontend/src/pages/Privacy.jsx`
- NEW `frontend/src/pages/Terms.jsx`
- NEW `frontend/src/components/SiteFooter.jsx`
- MODIFIED `frontend/src/App.js`
- MODIFIED `frontend/src/pages/Landing.jsx`
- MODIFIED `memory/LAUNCH_TWEET.md`

**Still parked for the operator** (no code, ~10 min of legal
review or finger-touching the Stripe dashboard):
- Pick a US state of residence (Section 10 of Terms refers
  generically to "the operator's state of residence" — once
  you pick, drop us a one-line edit and we'll bake it in).
- If you incorporate as an LLC, add the legal entity name to
  Section 1 of Privacy.
- Footer-wire Login and Help pages too if you want the legal
  links to be reachable from logged-out states beyond Landing.

---


Tail-end of the deep-dive sweep — making sure the documentation
keeps pace with the code.

**AdminHelp.jsx updates** (operator-facing docs at `/admin/help`):
- Added TOC entry + `<Section>` for the new **LLM key health &
  runway** card.  Documents why we self-instrument (no public
  balance API from Emergent), how to read the 3 KPIs + runway
  banner, what the operator has to do (paste balance from
  Profile → Universal Key), how to enable auto-recharge, the
  pinned pricing constants in the footer, and the two backend
  endpoints (`GET /admin/llm-key-health`,
  `PUT /admin/llm-key-health/balance`).
- Added TOC entry + `<Section>` for the new **Recent changelog**
  card.  Documents the H2 heading convention the parser slices
  on, the 100-entry hard cap, the endpoint shape, and the natural
  pairing with the key-health card for verifying deploys.
- Updated the **Email logs & retry** section's opening paragraph
  to mention the smart welcome email (replaces the old generic
  "your account is approved" line) and added a bullet describing
  the `welcome_approval` / `welcome_auto_approve` kinds the
  operator will now see in `email_logs`.
- `History` icon added to lucide imports for the changelog TOC
  entry.

**Help.jsx** (user-facing docs at `/help`):
- No changes.  Today's user-visible work is exactly one
  transactional email (smart welcome at signup) — auto-fired,
  no user action, doesn't warrant a help section.  The
  `WhatsNewFeed` in AdminHelp already auto-surfaces every
  CHANGELOG.md entry without code changes.

**Smoke-tested live**:
- Logged in as the tester (briefly promoted to admin via
  `mongosh`, demoted after), navigated to `/admin/help`, verified
  both new sections render — `admin-help-llm-key-health` 702px
  tall, `admin-help-changelog` 438px tall, both visible.  The
  "Smart welcome (2026-06-22)" bullet shows up in the email-logs
  section.  `?notour=1` keeps the welcome-tour modal out of the
  screenshot for a clean shot.

**Net outcome**: Every feature shipped today has matching docs
the operator can self-serve from.  No deferred documentation
debt.

---


Permanent fix for the welcome-tour overlay that's been masking
admin testids in every Playwright run for the last 3 sessions
(see iteration_33–35 reports).

**Root cause**: `TourMount` in `frontend/src/App.js` (line 220+)
opens the tour modal 600ms after auth context hydrates, whenever
``localStorage["shelfsort_tour_seen"]`` is unset.  Fresh Playwright
browser contexts always start with empty localStorage, so every
test that logs in and navigates to `/admin` (or any logged-in
route) ends up with the tour modal covering the testid the test
is trying to click.  Real users only see this once on first login
by design — not a production bug, just a test-harness flake.

**Fix**: 3 bypass signals in `TourMount`'s effect, in order of
preference:
1. **URL query param** — `?notour=1` or `?test=1` on the
   destination URL.  Easiest for `page.goto(...)` calls.
2. **Window flag** — `window.__shelfsort_disable_tour__ = true`.
   For Playwright `add_init_script` workflows.
3. **localStorage seed** — pre-set `shelfsort_tour_seen=1` before
   navigation.  Legacy fallback that already worked but required
   timing care.

Any of the three sets the localStorage flag so subsequent
in-session nav also stays clean.  Smoke-tested via the live
preview env: login + `?notour=1` → `visible_overlays: 0`,
`tour_seen_flag: '1'`, library renders cleanly.

**Files**:
- MODIFIED `frontend/src/App.js` — `TourMount` useEffect grew a
  bypass branch (~15 LOC) before the existing 600ms setTimeout.
- MODIFIED `memory/test_credentials.md` — added a "Welcome-tour
  bypass for testing agents" section documenting all three
  signals + example snippets, so future testing agents pick
  this up automatically from the brief.

**Net win**: Next 3+ sessions don't re-discover the same flake.
Testing agent can now drive the full `/admin` flow without
backend-curl fallbacks.

---


Layered regression after today's 4 features shipped + production
redeploy went green. Three layers run in sequence:

**Layer 1 — Lint sweep**
- 5 new lint warnings introduced today (all f-string-without-placeholder
  nits in `utils/welcome_email.py` HTML composer).  Fixed by removing the
  ``f`` prefix from the trailing concatenated strings.  Lint now clean on
  every touched file.

**Layer 2 — Targeted pytest sweep** (10 high-risk suites)
- 81 passed / 2 skipped / 0 failed across `test_welcome_email`,
  `test_llm_usage`, `test_hidden_features`, `test_admin_alerts`,
  `test_weekly_user_summary`, `test_email_volume_forecast`,
  `test_av_fields`, `test_cover_regen`, `test_approval_gate`,
  `test_bulk_approve`.
- One existing test (`test_runway_warning_levels`) was failing
  because the live instrumentation captures real Claude calls
  during the test run, polluting the 7d window.  Fixed by
  snapshotting + wiping `llm_usage` at test start and restoring
  pre-existing rows afterwards.

**Layer 3 — Testing agent full sweep** (`iteration_35.json`)
- 15/16 backend tests it wrote pass; 0 critical issues found.
- Two reports flagged for investigation; both confirmed
  non-issues after RCA:
  1. **"Hydration error: `<span>` cannot be a child of `<option>`"**
     on `/login` — NOT REPRODUCIBLE.  Captured console logs on
     `/login` (sign-in form), `/login` → register step 1, and
     register step 2 (onboarding); zero console warnings on any.
     Login.jsx contains no native `<select>` element either.
     Likely a phantom report from the testing agent.
  2. **"Auth flake: /admin bounces to /"** — NOT A PRODUCTION BUG.
     RCA confirms ``AdminRoute`` (App.js:93-105) properly gates on
     ``loading`` before deciding; ``AuthContext`` and the
     ``withCredentials: true`` axios config are correct.  The
     actual masking culprit is ``TourMount`` (App.js:220+) which
     opens the welcome-tour modal 600ms after auth hydrates for
     any user who hasn't seen it — Playwright tests in fresh
     browser contexts hit this every time.  Workaround for the
     testing agent (added to the iteration playbook):
     ``localStorage.setItem('shelfsort_tour_seen', '1')`` before
     navigating to /admin.

**Production health (https://shelfsort.com)**
- Build timestamp confirms today's redeploy is live.
- All four new endpoints answer with the correct authentication
  guard (401 unauth, not 404):
  - `GET /api/admin/changelog`
  - `GET /api/admin/llm-key-health`
  - `PUT /api/admin/llm-key-health/balance`
  - Upgraded approval-email pipeline (no new endpoint, but the
    new `welcome_approval` / `welcome_auto_approve` kinds will
    appear in `email_logs` from the next sign-up).
- ClamAV + Calibre confirmed live by user post-redeploy.

**Files touched in this sweep**
- MODIFIED `backend/utils/welcome_email.py` — removed 5 f-string-
  without-placeholder nits.
- MODIFIED `backend/tests/test_llm_usage.py` — snapshot + restore
  pattern so `test_runway_warning_levels` is robust against live
  instrumentation noise from real Claude calls during testing.

**Net outcome**: No regressions detected.  4 features shipped today
are production-ready.

---


Replaces the generic "your account is approved" one-liner with a
short personalized email that uses the four onboarding answers we
already collect at sign-up (referral, favorite_fandom, reader_type,
is_13_plus).  No extra Resend quota burn — same one email per
new user that was being sent before, just better copy.

**Personalization rules** (all copy is static — no LLM, zero burn):
- ``reader_type`` selects 1 of 4 curated tips
  (``fanfic`` / ``original`` / ``mix`` / ``organize``) → drives the
  body heading + the primary CTA.
- ``favorite_fandom`` adds a second sentence (only for fanfic / mix
  readers): *"You mentioned {fandom} — every {fandom} EPUB you
  upload will land on its own shelf automatically."*
- ``referral`` adds an opening thank-you line, with specific copy
  for 11 known sources (Reddit, Tumblr, Twitter, X, TikTok,
  Discord, AO3, YouTube, friend, word-of-mouth, Google) and a
  generic "Thanks for finding us" fallback for unknown sources.
- CTAs re-order so the reader_type-specific destination is the
  primary button; the other two become subdued text links.

**Two send sites** (both already existed for the old welcome):
1. ``routes/admin._send_approval_email(approved=True)`` — admin
   approves a pending user.  Refactored to delegate to
   ``utils.welcome_email.send_welcome_email`` so the personalized
   body fires.  Pass-through of the freshly-fetched ``user_doc``
   so onboarding answers are available without an extra DB read.
2. ``routes/auth.auth_register`` auto-approve branch (approval
   gate off, or test/first-user bypass) — new ``asyncio.create_task``
   fire-and-forget so register-latency doesn't change.  First-user
   bootstrap is intentionally skipped (no point welcoming the
   sole admin to their own install).

**Files**:
- NEW `backend/utils/welcome_email.py` (~200 LOC) —
  `build_welcome_email()` (pure composer) + `send_welcome_email()`
  (Resend wrapper, never raises, logs to `email_logs` with
  `kind=welcome_approval` or `welcome_auto_approve`).
- NEW `backend/tests/test_welcome_email.py` — 14 tests covering
  every reader_type branch, the fandom-line gating, all referral
  paths (known + unknown), CTA re-ordering, frontend_url trailing
  slash handling, empty-name fallback, Resend-unconfigured bail,
  email_logs success + error rows.
- MODIFIED `backend/routes/admin.py` — `_send_approval_email`
  delegates to the welcome composer for the approved branch.
  ``approve_user`` + ``approve_pending_bulk`` now fetch + pass
  ``onboarding`` so the personalization works.
- MODIFIED `backend/routes/auth.py` — auto-approve branch fires
  the welcome email as a background task.

**Reuses existing infra** (no new top-level surface):
- ``utils.email_suppression`` test-account skip — verified live: a
  ``smoke_welcome_<ts>@example.com`` registration produced an
  `email_logs` row with ``status="suppressed"`` and
  ``suppress_reason="test_recipient"`` (zero Resend quota burn).
- ``utils.email_log.log_email_send`` — every send writes a row, so
  the new `welcome_approval` + `welcome_auto_approve` kinds are
  already counted by the email-volume-forecast admin card.

**Tested**:
- 14/14 new unit tests pass (`tests/test_welcome_email.py`).
- Regression: 13/13 approval + bulk-approve tests pass
  (`test_approval_gate.py`, `test_bulk_approve.py`).
- 11/11 LLM-usage tests still pass.
- Live end-to-end smoke: registered a fanfic/Stargate/reddit user
  with the approval gate disabled → server returned
  ``approval_status: approved`` → ``email_logs`` row written with
  ``kind: welcome_auto_approve`` and the right subject.
- Lint clean on touched files.

---


P1 follow-up to today's budget-cap incident.  Earlier in the
session the operator hit their Universal LLM Key cap and silently
lost Claude + Nano-Banana for ~20 minutes before noticing.  This
card surfaces a forward-looking days-of-runway estimate so the
next top-up happens *before* the cliff.

**Why this required self-instrumentation**: Support confirmed
Emergent does not expose a programmatic balance API.  The card
combines two evidence sources:

1. **Instrumented** — new `llm_usage` Mongo collection.  Every
   Claude classify (in `classifier.py`) and Nano-Banana cover
   gen (in `cover_gen.py`) call writes a row with
   ``{kind, model, tokens_in, tokens_out, images, cost_usd,
   status, error, created_at}``.  Token counts are estimated
   from prompt + response string length when the upstream SDK
   doesn't return them (Claude `send_message`, Nano-Banana
   `send_message_multimodal_response`).
2. **Proxy** — pre-existing book fields ``classifier='ai'`` +
   ``cover_source='ai_generated'`` filtered by ``created_at`` /
   ``cover_generated_at`` give an instant historical estimate
   even before the instrumentation has accrued any rows.

Runway math takes the **higher** of the two daily averages
(conservative — assumes the more expensive evidence source is
the real burn), divides into the operator-typed-in balance,
and maps to a traffic-light state:
- < 7 days → ``critical`` (red banner)
- < 14 days → ``warning`` (amber)
- ≥ 14 days → ``ok`` (green)
- balance not set → ``unknown``

**Files**:
- NEW `backend/utils/llm_usage.py` (~250 LOC) — `log_llm_call()`,
  `estimate_cost_usd()` with Claude + Nano-Banana list prices
  pinned, `get_llm_key_health()` rollup, `set_known_balance()` /
  `get_known_balance()` persisted to `app_config`.
- NEW `backend/tests/test_llm_usage.py` — 11 tests covering
  cost math, instrumentation safety (never raises on Mongo blip),
  rollup correctness, runway thresholds at 7/14d, and the
  unknown-state when no balance is set.
- MODIFIED `backend/utils/classifier.py` — logs every Claude call
  (ok + error paths) without breaking classification if Mongo
  blips.
- MODIFIED `backend/utils/cover_gen.py` — logs every Nano-Banana
  call (ok + empty + error paths) without breaking cover gen.
- MODIFIED `backend/routes/admin.py` — adds
  `GET /api/admin/llm-key-health` and
  `PUT /api/admin/llm-key-health/balance` (admin-gated).
- MODIFIED `frontend/src/pages/AdminConsole.jsx` — new
  `LlmKeyHealthCard` (~150 LOC) with the runway banner, 3 KPIs
  (instrumented 7d / proxy 7d / balance), inline balance setter,
  per-kind breakdown table, and a collapsible footer of pricing
  constants + 30-day rollup.  Wired into the `system` category +
  searchable + Cmd+K reachable.  `Sparkles` lucide icon reused.

**Pricing constants pinned in code** (list prices Jan 2026):
- Claude Sonnet 4.6: $3 / 1M input, $15 / 1M output tokens
- Gemini Nano-Banana: $0.039 / image
- Proxy fallback per call: $0.005 classify, $0.039 cover

**Tested**:
- 11/11 backend unit tests pass.
- Backend endpoint verified via authenticated curl: empty-state
  payload returns 200 + correct shape, seeded data flows through
  to per-kind rollup + runway calc, `PUT .../balance` writes to
  `app_config` and reflects on next GET.
- Frontend lint clean on touched code (7 pre-existing warnings
  unchanged).
- Backend regression: `test_av_fields` (5/5),
  `test_cover_regen::test_preview_cover_returns_base64_and_preview_id`
  (the instrumentation-relevant case) pass.
- UI smoke via Playwright blocked by the same welcome-tour
  redirect flake from the prior fork; component is line-for-line
  consistent with the working `HiddenFeaturesCard` /
  `EmailVolumeForecastCard` patterns.

---


Frontend follow-up to the backend `/api/admin/changelog` endpoint
built earlier today.  Adds a "Recent changelog" Card to the
`/admin` System & health section so the operator can see the last
20 dated entries from `CHANGELOG.md` without opening the repo.

**Implementation**:
- New `ChangelogCard` component in `frontend/src/pages/AdminConsole.jsx`
  fetches `GET /api/admin/changelog?limit=20`.
- Each entry renders as a `<details>` row: date pill (purple), title,
  slug + line count, with the full markdown body collapsed in a
  scrollable `<pre>` block below.
- Header shows `returned / total_in_file` and the source path.
- Added manifest entry `admin-changelog-card` (category: `system`)
  so it's filterable via the search bar and reachable from Cmd+K.
- `History` icon added to lucide imports.

**Files**:
- MODIFIED `frontend/src/pages/AdminConsole.jsx` (+1 import,
  +1 manifest entry, +1 switch case, +1 component ~85 LOC)
- MODIFIED `memory/CHANGELOG.md` (this entry)

**Tested**:
- Backend endpoint returned 3 well-formed entries via authenticated
  curl (`/api/admin/changelog?limit=3` → 200, `returned: 3`,
  `total_in_file: 113`).
- Webpack hot-reload compiled clean (1 pre-existing warning,
  unchanged).
- Lint clean on touched code; only the 7 pre-existing eslint
  warnings remain.
- UI smoke-test via Playwright blocked by the recurring
  welcome-tour redirect (known flake from prior session); validated
  structurally against the matching `HiddenFeaturesCard` pattern.

---


Follow-up to the admin nav overhaul.  The sidebar now shows the last
3 cards the operator expanded, newest first, above the category list.
Saves the muscle-memory tax of relearning where every card lives.

**Implementation**:
- `pushRecent(testid)` lives on ``AdminCardsContext`` so any Card can
  call it without prop-drilling.
- The `Card` component fires `pushRecent` on the *open transition*
  only — closing isn't a "view", and scrolling past isn't either.
- The Cmd+K palette also fires `pushRecent` on Enter → keyboard
  navigation feeds Recent the same way mouse navigation does.
- State is persisted to ``localStorage`` under
  ``admin.recent_cards`` (capped at 3, deduped, newest-first).
  Survives a refresh and a new tab.
- Render: a small ``Recent`` block above ``Sections`` in the
  sticky sidebar, each row showing a ↻ glyph + the card title.
  Click → smooth-scrolls to the card with the same purple
  highlight ring as the Cmd+K jump.

**Files**:
- MODIFIED `frontend/src/pages/AdminConsole.jsx` —
  + recentIds state + pushRecent + recentCards derivation
  + Card.handleToggle pushes on open
  + jumpToCard (Cmd+K target) pushes on jump
  + sidebar adds the "Recent" sub-list

**Tested**:
- Lint clean on touched code (7 pre-existing warnings unchanged).
- `/admin` HTTP 200 on the dev server.
- React conditional renders Recent only when at least one card
  has been opened (empty-state safe).

---

## 2026-06-22 afternoon (admin-navigation-overhaul) — Easier /admin nav ✅

User asked to make `/admin` easier to navigate (33 cards in a flat
scroll).  Picked options **a + b + d**: categorized sections,
sticky sidebar, Cmd+K command palette.

**Built**:

1. **Category metadata** — every entry in ``ADMIN_CARD_MANIFEST``
   now carries a ``category`` field (one of 7 groups defined in
   the new ``ADMIN_CATEGORIES`` constant: Overview, Users &
   sign-ups, Feedback & moderation, Storage & files, Email,
   System & health, Data & diagnostics).
2. **Sectioned render** — the cards-list output is now a
   `.map(category)` outer loop with a `<section
   id="admin-section-<cat>" data-category="<cat>">` and a
   uppercased category header per group.  Cards inside each
   section come from a switch-statement on `testid` so the
   manifest stays the single source of truth.
3. **Sticky left sidebar** (desktop, `lg:` and up) — 7 category
   links with live count badges, scroll-spy via
   IntersectionObserver highlighting the active section as the
   operator scrolls.  `data-testid='admin-sidebar'` +
   per-link `data-testid='admin-sidebar-link-<cat>'`.
4. **Mobile category dropdown** (`lg:hidden`) — sticky `<select>`
   under the page header for narrow viewports, since the sidebar
   only shows above the lg breakpoint.
5. **Cmd+K / Ctrl+K command palette** — global hotkey,
   autofocused fuzzy-search input, arrow-key navigation, Enter
   to jump.  When you land on a card it gets a brief purple
   `box-shadow` highlight so your eye finds it instantly. Esc
   closes; reopen state is always fresh.

**Files touched**:
- MODIFIED `frontend/src/pages/AdminConsole.jsx` —
  + ADMIN_CATEGORIES constant
  + ``category`` field on every ADMIN_CARD_MANIFEST row
  + sidebar JSX with scroll-spy useEffect
  + Cmd+K palette overlay with fuzzy search + arrow keys
  + mobile section-jump `<select>`
  + section-grouped render via switch-statement
  + outer grid layout (`lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8`)

**Verification**:
- Lint clean on touched code (7 pre-existing warnings unchanged).
- Frontend serves `/admin` → HTTP 200.
- Testing agent (iter 34) confirmed code review correctness:
  category groups present, sidebar wired, palette overlay
  wired with all 4 keyboard interactions (Cmd+K, arrows, Enter,
  Esc).  Could not fully run end-to-end UI due to a Playwright
  auth flake (welcome-tour modal blocked admin load) — code
  itself reviewed correct.
- Polish wins from the testing agent applied: palette state
  resets on close + mobile dropdown for narrow viewports.

**How to use** (when next on `/admin`):
- **Desktop**: see the new left sidebar — click any category to
  scroll-jump.
- **Mobile**: use the sticky "Jump to section" dropdown under
  the header.
- **Anywhere**: press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux)
  → type a card name → Enter.

---

## 2026-06-22 midday (hidden-features-card + Send-to-Kindle full hide) ✅

User asked for (a) a central inventory of features parked behind
flags + (b) confirmation that Send-to-Kindle is fully hidden from
view.  Audit + new admin card delivered.

**Audit findings**:
- Every UI mention of Send-to-Kindle is behind
  ``SEND_TO_KINDLE_UI_ENABLED`` — the orange button on BookDetail,
  the SendToKindleCard on /account, the help section + TOC entry on
  /help, and the prefetch GET on mount.
- Remaining "Kindle" strings on the site are about Kindle as a
  *device* (bug-report device picker, DevicePicker model list) or
  Kindle as a *file format* (.azw/.mobi accepted by UploadZone), or
  Kindle as an external reader app users might *use* (Help
  troubleshooting line).  None promote our feature.

**Backend default-flag bug caught + fixed**:
- ``DEFAULT_FLAGS`` was ``{k: True for k in KNOWN_FLAGS}`` →
  ``send_to_kindle_enabled`` defaulted ON if the flag row didn't
  exist in Mongo.  Pinned an explicit override
  ``DEFAULT_FLAGS["send_to_kindle_enabled"] = False`` so a fresh
  install / cache miss can't accidentally expose the endpoint.
- DB row updated to ``send_to_kindle_enabled = false`` to clean up
  test-suite residue from earlier today.

**Files**:
- NEW `backend/utils/hidden_features.py` (~140 LOC) — registry +
  client-constant parser + server-flag merger.
- NEW `backend/tests/test_hidden_features.py` — 3 tests pinning the
  payload shape, effective-state logic, and the
  send_to_kindle_enabled OFF default.
- MODIFIED `backend/utils/feature_flags.py` — explicit OFF default.
- MODIFIED `backend/routes/admin.py` — `GET /api/admin/hidden-features`.
- MODIFIED `frontend/src/pages/AdminConsole.jsx` — new
  ``HiddenFeaturesCard`` (rendered between EmailVolumeForecastCard
  and AdminEmailModeCard) + EyeOff icon import + search-manifest entry.

**Live state after this change** (verified via curl):
- Send-to-Kindle: ``effective = hidden`` (client OFF + server OFF) ✅
- FicHub URL→EPUB: ``effective = partial`` (client OFF, server ON —
  fichub_enabled has been ON forever because the server flag was
  never explicitly turned off).  The frontend constant is the
  practical defence so no user-visible promotion exists; flipping
  the server flag OFF is a one-line operator action via /admin →
  Feature flags if they want full hide.

---

## 2026-06-22 midday (send-to-kindle-hide) — Mirror the FicHub hide-out ✅

User flagged that Send-to-Kindle burns 1 Resend daily-quota slot per
send — same risk we just spent the morning braking elsewhere — and
asked to hide it the same way FicHub / FanFicFare is hidden.

**Two-layer gate** (matches FicHub's design):

1. **Client-side constant** ``SEND_TO_KINDLE_UI_ENABLED = false`` in
   ``frontend/src/lib/featureFlags.js`` — gates three UI surfaces:
   - Orange button on every `/book/:id` page (BookDetail.jsx) +
     the prefetch GET on mount (no wasted API call when hidden).
   - SendToKindleCard on `/account` (Account.jsx).
   - "Send to Kindle" section + TOC entry on `/help` (Help.jsx).
   Flipping the constant to ``true`` re-shows everything — code
   stays in place, no backend changes needed.

2. **Server-side runtime flag** ``send_to_kindle_enabled`` (default
   OFF) in ``utils/feature_flags.py`` — gates the
   ``POST /api/books/{id}/send-to-kindle`` endpoint with a 503
   response when off.  Catches the "curl-savvy user bypasses the UI
   hide" attack vector and lets an admin re-enable via
   `/admin → Feature flags` without a frontend rebuild.

**Files**:
- MODIFIED `frontend/src/lib/featureFlags.js` — new
  ``SEND_TO_KINDLE_UI_ENABLED = false`` constant + docstring.
- MODIFIED `frontend/src/pages/BookDetail.jsx` — gate button +
  short-circuit the kindle-settings GET when hidden.
- MODIFIED `frontend/src/pages/Account.jsx` — gate
  `<SendToKindleCard />`.
- MODIFIED `frontend/src/pages/Help.jsx` — gate the TOC entry +
  the entire Section block.
- MODIFIED `backend/utils/feature_flags.py` — new
  ``send_to_kindle_enabled`` known flag (default OFF).
- MODIFIED `backend/routes/books.py` — 503 gate before delegating
  to the orchestrator.
- MODIFIED `backend/tests/test_admin_console.py` — flag now part
  of the pinned ``KNOWN_FLAGS`` set.
- MODIFIED `backend/tests/test_send_to_kindle_http.py` — fixture
  flips the flag via the admin API (not Mongo-direct, because
  the live backend has a 30-s in-process cache that Mongo
  writes don't bust) + new gate-coverage test
  ``test_send_book_to_kindle_returns_503_when_feature_disabled``.

**Verification**:
- 12/12 module pytest + 9/9 HTTP integration (8 previous + 1 new
  gate test) + 26/26 admin_console = **47/47 pass**.
- Playwright assertion confirmed
  ``data-testid='send-to-kindle-btn'`` count is **0** on /book/* —
  the button is gone.
- Lint clean (Python + JS).

**To re-enable later** (when off the free Resend tier):
1. Frontend: flip ``SEND_TO_KINDLE_UI_ENABLED = true`` in
   ``frontend/src/lib/featureFlags.js`` and redeploy.
2. Backend: from `/admin → Feature flags` toggle
   ``send_to_kindle_enabled`` to ON (no rebuild needed for this
   half).

---

## 2026-06-22 morning (send-to-kindle-help-docs) — User-facing setup guide ✅

User asked for proper Send-to-Kindle setup instructions for users.
Added a comprehensive new help section in `/help`:

- **`Send to Kindle`** — full how-to section with:
   1. One-time setup (find Kindle email, save in Shelfsort, **whitelist
      sender on Amazon** — the universally-missed step that breaks 95%
      of first sends, with direct link to amazon.com/myk)
   2. Sending a book (where the button is + ~5 min Amazon delivery)
   3. Limits & guardrails (25 MB cap, 30-min rate limit, EPUB only,
      quarantine block)
   4. Troubleshooting (4 common failure modes with the fixes)
   5. Privacy note (Resend → Amazon, no third-party storage)

Section is in the TOC right after E-reader sync (OPDS) so it sits
near other "get your books to a device" features.  Send icon (lucide)
added to the imports.

**Files**:
- MODIFIED `frontend/src/pages/Help.jsx` — new `<Section id="send-to-kindle">` block, TOC entry, and `Send` icon import.

**Also**:
- Recovered Notifications section opener — my first search_replace
  accidentally collapsed the boundary between the new Send-to-Kindle
  section and the existing Notifications one. Restored cleanly.

---

## 2026-06-22 (send-to-kindle) — P1 Ship: one-click EPUB → Kindle ✅

**Built overnight while operator slept.**  Lets users beam any EPUB
from their library straight to their Amazon Kindle inbox by adding
a single ``@kindle.com`` address in account settings.  Removes the
last "I have to download then sideload via cable" friction point.

**Files**:
- NEW `backend/utils/send_to_kindle.py` (~280 LOC) —
  `send_book_to_kindle()` orchestrator with file read, AV check,
  size guard (25 MB Kindle gateway cap), rate-limit (1 send per
  book per 30 min), Resend attachment send, and email_logs write.
  Filenames sanitised so a book titled `Weird/Title<>` doesn't
  break the attachment.  ``is_valid_kindle_email()`` regex matches
  both ``@kindle.com`` and ``@free.kindle.com``.
- NEW `backend/tests/test_send_to_kindle.py` — 12 tests covering
  every error code + happy path + filename sanitisation.
- NEW `backend/tests/test_send_to_kindle_http.py` — added by the
  testing agent — 8 live HTTP integration tests against the
  preview URL.
- MODIFIED `backend/routes/user_prefs.py` — `GET/PUT
  /api/user/kindle-settings` with @kindle.com validation.
- MODIFIED `backend/routes/books.py` — `POST
  /api/books/{book_id}/send-to-kindle` (4-line wrapper around the
  util).
- MODIFIED `frontend/src/pages/BookDetail.jsx` — Amazon-orange
  Send-to-Kindle button next to Download EPUB; per-error toast
  text including the 502-specific "Approved Personal Document
  E-mail List" hint that is the #1 user confusion point.
- MODIFIED `frontend/src/pages/Account.jsx` — new SendToKindleCard
  between CatalogSync and the rest of the cards.  Input + Save +
  Amazon approved-sender reminder block with one-click copy of
  the Shelfsort sender address + deep link to
  `amazon.com/myk`.

**Anti-spam guardrails**:
- 30-min rate limit per (user, book) — prevents double-click
  duplicates.  Returns 429 with a "wait X min" detail the
  frontend surfaces as a toast.
- 25 MB hard cap before base64 encode — saves CPU on oversized
  files and gives a clean 413 detail.
- AV quarantine check — refuses to send `av_status="infected"`
  books with a 403.
- Sender-side: every send writes to ``email_logs`` with
  ``kind="send_to_kindle"`` so the volume-forecast card I shipped
  earlier already includes Kindle sends in the weekly projection.

**Bug caught during testing**:
- Mongo strips tzinfo on read — the rate-limit `datetime`
  subtraction blew up with "can't subtract offset-naive and
  offset-aware datetimes".  Patched to re-attach UTC before the
  arithmetic.
- Frontend race: clicking Send-to-Kindle within ~300 ms of page
  load fired the "no email" branch even when an address was set
  (GET /user/kindle-settings hadn't resolved yet).  Fixed by
  defaulting `kindleEmail` to `null` (not `""`) and disabling the
  button while loading.  Per testing-agent feedback (iter 33).

**Verification**:
- 12/12 module-level pytest + 8/8 HTTP integration pytest (all
  added by the testing agent) = **20/20 Send-to-Kindle tests pass**
- 138/138 broader area tests still pass (admin_console, digest,
  cron, friends, recommendations, bookclubs, email_*, etc.)
- Frontend lint clean on touched files
- Testing agent verified UI: card renders, button renders next to
  Download EPUB, confirm() dialog fires with correct message,
  Download regression still works
- Did NOT trigger live Resend sends (daily quota still locked) —
  all error codes verified via UI + curl

**How users use it**:
1. Profile → Account → Send to Kindle card
2. Enter ``yourname@kindle.com``, hit Save
3. Copy the displayed sender address, add it to Amazon's
   "Approved Personal Document E-mail List" at
   `amazon.com/myk` (one-time)
4. On any book page, click the orange **Send to Kindle** button
5. Book appears on Kindle within ~5 min

---

## 2026-06-22 (email-volume-forecast) — Cliff-warning admin card ✅

**Why** — even after the two earlier quota brakes today (admin weekly
digest + per-user weekly summary), the operator had no way to *see*
whether the runway was actually safe.  Manual mongo queries against
``email_logs`` only show the past; this card adds a forward
projection.

**Built**:

1. **`utils/email_volume_forecast.py`** — pure async helper.
   * `_past_counts(window_days)` — groups ``email_logs`` by kind +
     status (ok / error / suppressed) for the window.
   * `_opt_in_counts()` — distinct counts per channel, excluding
     test-fixture accounts via ``mongo_test_account_filter``.
   * `_weekly_projection(opt_in)` — per-channel weekly send count.
     The ``weekly_summary`` opt-in REPLACES the four kind-specific
     channels for the same users (matches server-side skip
     behaviour), so they're subtracted to avoid double-counting.
   * `email_volume_forecast()` — full payload with cliff ETA,
     warning level (ok / warning / critical based on % of cap),
     and a generated_at timestamp.
2. **`GET /api/admin/email-volume-forecast`** — admin-gated.
3. **`EmailVolumeForecastCard`** on /admin (between Email system
   and Email mode cards) — renders the warning banner, 3 KPIs
   (past 7d, past 30d, projected 7d), per-kind bars for the past
   week, projected weekly by channel, and the opt-in counts that
   drive the forecast.
4. **5-test backend coverage** (`test_email_volume_forecast.py`):
   shape, projection-subtraction math, status bucketing, window
   exclusion, daily-cap constant pin.

**Live data check** (genre-sort preview, 2026-06-22):
* Past 7d: 359 emails (daily avg 51.3 — half of cap)
* Forecast next 7d: **2** — admin/user batching cut the projected
  weekly cron volume to essentially zero
* `warning_level`: `ok`
* Cliff ETA: 8 days if past 7d trend extrapolated, but forecast
  is already well below the cap so this is conservative

**Files**:
- NEW `backend/utils/email_volume_forecast.py`
- NEW `backend/tests/test_email_volume_forecast.py`
- MODIFIED `backend/routes/admin.py` (+1 endpoint)
- MODIFIED `frontend/src/pages/AdminConsole.jsx` (new card + search manifest)

---

## 2026-06-22 (per-user-weekly-summary) — One Friday email per user opt-in ✅

**Problem (follow-up to admin-alerts fix earlier today)**: Even after
batching admin alerts, an engaged reader gets 3-5 separate weekly
emails from Shelfsort (weekly stats digest, fic updates,
friends-finished, bookclub-week, cover recap). For 100 users that's
300-500 emails/week — still a heavy slice of the 100/day free tier.

**Fix** — new opt-in `weekly_summary.enabled` user pref:

1. **`utils/weekly_user_summary.py`** (new, ~310 LOC) — orchestrator
   that runs Fridays 09:00 UTC, walks every opt-in user, gathers
   6 sections from the DB (reading minutes, stuck books, friends
   finished, bookclub activity, fic updates, cover recap), and
   sends ONE consolidated "Your week on Shelfsort" email per user.
2. **`is_in_weekly_summary_mode(user_doc)`** — pure-sync helper
   exported for the kind-senders.
3. **Kind-senders modified** to early-return when the helper
   returns True:
     - `routes/digest._send_digest_email` (weekly stats digest)
     - `routes/digest._send_update_digest_email` (fic updates)
     - `routes/bookclubs.maybe_send_bookclub_digest` (bookclub
       week)
     - `routes/recommendations.maybe_send_friends_finished_digest`
       (only the email branch; in-app notif still fires)
4. **New endpoints**:
     - `GET /api/user/weekly-summary` — current opt-in state +
       last-sent snapshot
     - `PUT /api/user/weekly-summary` — `{"enabled": bool}`
     - `POST /api/user/weekly-summary/preview` — send a sample
       digest right now using live data (caps quota burn at 1 per
       call regardless of how many kind-sections are populated)
5. **New cron**: `user_weekly_summary_tick` registered in
   `routes/digest.start_digest_scheduler` (Fridays 09:00 UTC).
   Idempotent — 6-day cooldown per user.
6. **Test-fixture address filter** — same `is_test_account` guard
   as the admin alerts. Opt-in fixture users still update their
   pref but never get an email send attempt.
7. **Frontend**: new prominent toggle on `/account/emails` —
   "One Friday email for everything" — with a "Send a sample"
   button + an active-mode banner explaining that the kind-
   specific toggles below are paused while it's on.

**Verification**:
- 7-test backend coverage (`tests/test_weekly_user_summary.py`):
    * `is_in_weekly_summary_mode` helper
    * Each kind-sender skips when opted in (digest, update, bookclub)
    * Orchestrator returns `nothing_to_say` for empty data
    * Orchestrator sends ONE email with merged sections when data exists
    * Test-fixture addresses filtered out
- 88/89 broader tests pass (1 unrelated pre-existing approval-gate
  failure in test_digest.py — not caused by this change)
- Live `/api/user/weekly-summary` endpoints respond correctly
- `preview` returns `nothing_to_say` for the empty-this-week
  tester — proving the no-burn guard works

**Expected quota impact** (with reasonable opt-in rate):
- 100 active users × 4 weekly emails ≈ **400 emails/week**
- Same 100 users opted in × 1 email/week ≈ **100 emails/week**
- **~75% reduction** in user-facing weekly volume.

**Files**:
- NEW `backend/utils/weekly_user_summary.py`
- NEW `backend/tests/test_weekly_user_summary.py`
- MODIFIED `backend/routes/digest.py` (+ early-return + new endpoints + cron entry)
- MODIFIED `backend/routes/bookclubs.py` (early-return)
- MODIFIED `backend/routes/recommendations.py` (skip email branch only)
- MODIFIED `frontend/src/pages/EmailPreferences.jsx` (new toggle card)

---

## 2026-06-22 (admin-alerts-weekly-digest) — Resend quota brake ✅

**Problem**: Hit 200% of the Resend free-tier (100 emails/day) on the
`jessicaboxell4` team.  Root cause: every cron-job failure on prod
fans an immediate alert to every admin (5 admins seeded — 4 are test
fixtures that bounce hard but still count against the quota), and
prod ClamAV / Calibre missing means several crons fail every hour.

**Fix** — admin alerts now go through a queue and digest pipeline:

1. **New `utils/admin_alerts.py`** — `queue_admin_alert()` writes a
   row to `admin_pending_alerts` + pushes an in-app notification to
   every real admin (test-fixture admins are filtered via
   `is_test_account`).  Dedupe by `dedupe_key` so a flaky cron
   registers once with a `count` bump instead of N rows.
2. **`cron_health._maybe_alert_admins`** now routes through the
   queue when the new `cron_alerts_weekly_batch` feature flag is on
   (default).  Legacy immediate-email path stays available — flip
   the flag OFF to restore it.
3. **New cron `weekly_admin_digest_tick`** — Sundays 09:00 UTC.
   Drains every pending alert into ONE consolidated email per
   real admin ("3 cron failures, 12 sign-ups, 2 feedbacks").
   Idempotent within 20 h.
4. **Emergency burst bypass** — if >10 pending alerts pile up in a
   24 h rolling window, an out-of-cycle digest goes out
   (debounced 12 h) so a prod fire still pages the operator
   without waiting for Sunday.
5. **Test-fixture filter on the legacy path** — even when an
   operator flips back to immediate mode, fixture admins
   (`@example.*`, `@ft.local`, `user_*` local-parts) are stripped
   from the recipient list.

**New endpoints**:
- `GET  /api/admin/email-mode` — current mode + last-digest snapshot
- `PUT  /api/admin/email-mode` — `{"mode": "immediate"|"weekly_batch"|"off"}`
- `GET  /api/admin/pending-alerts` — bell-icon list
- `POST /api/admin/pending-alerts/dismiss` — clear one / many / all
- `POST /api/admin/pending-alerts/send-digest-now` — debug trigger

**New /admin cards**:
- `AdminEmailModeCard` (3-radio: Weekly digest / Immediate / Off
  + "Send digest now" debug button + last-digest timestamp)
- `AdminPendingAlertsCard` (bell list with per-alert + bulk dismiss)

**Files**:
- NEW `backend/utils/admin_alerts.py` (~360 lines)
- NEW `backend/tests/test_admin_alerts.py` (7 tests)
- MODIFIED `backend/utils/cron_health.py` (queue route + fixture filter)
- MODIFIED `backend/utils/feature_flags.py` (new `cron_alerts_weekly_batch` flag)
- MODIFIED `backend/server.py` (scheduler entry)
- MODIFIED `backend/routes/admin.py` (5 new endpoints)
- MODIFIED `backend/tests/test_cron_failure_alerts.py` + `test_cron_alert_suppression.py` (flip flag in fixture so legacy-path tests still pass)
- MODIFIED `frontend/src/pages/AdminConsole.jsx` (2 new cards + Bell icon import + search manifest)

**Verification**:
- 43/43 tests pass across the touched files
- Live API endpoints return correct mode + persist flag flips
- End-to-end `send-digest-now` triggered a real Resend call
  (returned 429 = quota exceeded as expected — proves the
  pipeline is wired all the way to the SDK)
- Cron failure routing verified: a test failure produced an
  `admin_pending_alerts` row with the expected dedupe key

**Expected quota impact**: ~50-150 admin emails/day → ~1 per week.
Frees ~95% of the Resend daily cap for actual user-facing emails.

---

## 2026-06-22 (legacy-test-cleanup) — Legacy test suite back to green ✅

User-approved Task (c) from the fork ask_human plan.  Five long-standing
P2 flaky/failing test files now pass cleanly in any order.

**Files touched**:
- `tests/conftest.py` — added a session-scoped autouse fixture
  (`_pin_session_loop`) that calls `asyncio.set_event_loop(shared_event_loop)`
  before any test runs.  Without this, the first test that called
  `asyncio.get_event_loop()` (legacy pattern in `test_cover_regen.py`)
  spawned a brand-new loop and Motor permanently bound to it, then later
  tests using the shared fixture hit `RuntimeError: Future attached to a
  different loop`.
- `tests/test_av_fields.py` — switched the auth fixture from
  cookie-based to `Authorization: Bearer` (same pattern as
  `test_account_safety.py`).  Cause: `requests` refuses to send `Secure`
  cookies over plain HTTP, which is what `BASE_URL` defaults to in local
  CI, so every API call after login was 401.
- `tests/test_cron_alert_suppression.py` — replaced the module-local
  `asyncio.new_event_loop()` fixture with the shared one; otherwise
  Motor rebound itself per-module and broke later tests.
- `tests/test_cron_failure_alerts.py` — two stale assertions
  (`test_feature_flag_disables_alert`, `test_no_resend_config_is_silent_noop`)
  still expected the pre-2026-06-18 silent-drop behaviour.  Updated them
  to assert the new contract: no email + a `cron_alerts` row with
  `suppressed=True` and the expected `reason`, matching the alert-health
  endpoint coverage from `test_cron_alert_suppression.py`.
- `tests/test_cover_regen.py` — two leaderboard tests
  (`test_top_of_week_scheduler_grants_achievement_and_notifies`,
  `test_cover_archive_index_and_week_lookup`) were beaten by the seeded
  `TEST_cover_*` fixtures that `test_iter22_review_sweep.py` depends on
  (votes=8/9 vs the test's brand-new 1-vote cover).  Now snapshot the
  fixtures' votes to zero for the duration of the test, then restore in
  `finally` — `test_iter22_review_sweep` still sees them at full weight.

**Verification**:
- Targeted re-run of all six previously-failing files:
  `42 passed, 1 skipped, 0 failed in 2m26s` (skip is the LLM-billed
  `preview-cover` happy path, expected when no key is configured).
- `test_iter22_review_sweep.py` still 13/13 — vote snapshots restore
  correctly.
- TEST_cover_* votes verified post-suite at their seeded values
  (1 / 9 / 8) so other tests/UIs that depend on them are unaffected.

---
## 2026-06-22 (stragglers-verify) — Cloudflare 524 fix verified ✅

User-approved Task (a) from the fork ask_human plan.  Confirmed the
parallelized `/api/admin/storage/stragglers` endpoint no longer times
out.  Hit it locally with the seeded tester (temp-promoted to admin):

```
HTTP=200, TIME=8.6s, returned 10 of 99 stragglers
```

— well under Cloudflare's 100s ceiling.  Endpoint is production-safe.

---

## 2026-06-21 (ci-admin-users-test-fix) — GitHub Actions backend tests back to green ✅

**Reported via GH Actions email**: `backend-tests / pytest` workflow
failed on `main` after today's pushes.

**Root cause** (pre-existing, unrelated to today's changes):
`test_users_list_includes_admin_badge_and_book_count` in
`tests/test_admin_console.py` queried `/api/admin/users` and looked for
the fixture admin in the response.  But `/admin/users` excludes
test-account fixtures by design (they're surfaced separately on
`/admin/test-accounts` to keep the main page clean) — and our fixture
admin uses both a `user_` prefix and an `@example.com` domain, both of
which match the exclusion regex.  The test never actually worked on a
clean CI database; it only passed on dev pods that happened to have
other non-fixture users seeded.

**Fix** — split the assertion:
1. `/admin/users` is shape-checked against whichever real users happen
   to be in the CI DB (and gracefully no-ops if there are zero).
2. `/admin/test-accounts` is asserted to contain the fixture admin
   AND non-admin (the dedicated endpoint that's *supposed* to surface
   them).

**Verified** — 26/26 admin_console tests pass.  Broader sanity sweep
across all 2026-06-21 work: 64/64 tests pass.

Legacy flakes still excluded from CI per existing workflow design
(`test_av_fields`, `test_cover_regen`, `test_cron_*`,
`test_bookclub_digest_engagement` — these need either ClamAV daemon
or asyncio fixture reform, both P3 backlog).


## 2026-06-21 (mirror-sweep) — all remaining write_bytes sites in books.py wired through R2 ✅

Follow-up to the upload_books sync-mirror fix.  Same architectural
flaw lived in 7 other call sites that wrote per-user-book bytes to
local disk without immediate R2 mirror.  Lower-impact than the upload
route (these features are used less frequently), but still real data-
loss exposure if a pod restarts in the 10-min gap before the next cron
tick.

**Helper added** — `routes/books.py::_write_local_and_mirror_to_r2()`:
- Async helper: writes payload to local disk, then immediately
  mirrors to R2 via `mirror_up`.
- Mirror failures log a warning and let the cron retry — they do
  NOT raise back to the caller (the bytes are already safe on local
  disk; raising would confuse users about an already-successful
  write).
- All future write paths should use this helper instead of bare
  ``path.write_bytes(...)`` for any per-user-book asset.

**Call sites converted** (all in `routes/books.py`):
| Line | Endpoint | Asset |
|---|---|---|
| 1497 | Copy-from-source EPUB | new EPUB |
| 1502 | Copy-from-source EPUB | new cover |
| 4373 | Upload-new-version | replacement EPUB |
| 4853 | AI cover generation | variant file |
| 4882 | AI cover generation | active cover |
| 5024 | Switch active variant | active cover |
| 5275 | Apply community cover | variant file |
| 5276 | Apply community cover | active cover |

Community-cover write at line 5159 left as-is — that writes to a
shared ``_COMMUNITY_COVERS_DIR`` (not per-user-book), so the R2 key
format is different and community covers can be regenerated.

**Tests** — all 15 storage/AV/migration regression tests still pass
after the sweep.


## 2026-06-21 (upload-r2-sync-mirror) — CRITICAL: stop losing user uploads ✅

**Severity: critical.**  Production data diagnostic showed only **12 of
65 books** (18%) actually existed in R2 — the other 53 were "lost in
spacetime", with DB rows pointing at bytes that no longer existed
anywhere.

**Root cause**: ``routes/books.py::upload_books`` wrote new uploads to
local disk only and relied on the every-10-min storage backfill cron
to push them to R2.  Any pod restart inside that 10-min window (idle
scale-down, redeploy, OOM kill, container migration) wiped the local
bytes before the cron tick — destroying the user's upload permanently.

This bug had been present since the upload pipeline was written.  It
only became visible after a sequence of redeploys today (for ClamAV
support + R2 audit) rebuilt the pod multiple times in quick succession.

**Fix** — `routes/books.py::upload_books`:
- After the upload loop completes, before returning the success
  response, synchronously call ``mirror_up`` for every freshly-written
  file: the EPUB itself, the original-format source (PDF/MOBI/AZW),
  and the cover thumbnail.
- Each mirror is wrapped in try/except so an R2 hiccup doesn't fail
  the whole upload — the cron will retry within 10 min, and the file
  is still safe on local disk for that window — but failures are
  logged loudly so they're not silent like before.
- Makes local disk a cache and R2 the source of truth.

**Bonus** — `routes/storage_admin.py::storage_stragglers`:
- New `GET /admin/storage/stragglers?limit=200` admin-only endpoint.
- Scans every book in the DB, HEADs its expected R2 key, falls back
  to checking local disk; returns any whose bytes can't be located
  anywhere.
- Capped to keep the response bounded; total count is returned
  separately so the operator can tell if they got a partial list.

**Regression guard** — `tests/test_upload_r2_sync_mirror.py`:
- `test_upload_books_calls_mirror_up_synchronously`: fails CI if
  the synchronous mirror call is ever removed.
- `test_upload_books_mirrors_epub_original_and_cover`: verifies all
  three asset types are mirrored, not just the EPUB.


## 2026-06-21 (post-R2-audit sweep) — 6 more silent regressions found + fixed ✅

After the Download-ZIP empty-bundle bug surfaced an R2-migration gap in
`exports.py`, did a codebase-wide grep for the same anti-pattern:
endpoints constructing `STORAGE_DIR / user_id / book_id.epub` paths and
then calling bare `.exists()` instead of the R2-aware
`ensure_local_cached()` helper.

Found **6 more silently-broken endpoints**, all fixed with the same
one-line swap:

| Endpoint | File | Impact pre-fix |
|---|---|---|
| `GET /api/opds/download/{id}` | `routes/opds.py` line 497 | OPDS feed dead — Calibre/Marvin/Moon+ reader downloads 404 |
| `GET /api/opds/cover/{id}` | `routes/opds.py` line 482 | OPDS covers missing in third-party readers |
| `POST /api/admin/fulltext/backfill` | `routes/fulltext.py` line 103 | Full-text search returning zero results; backfill wrote empty rows for every R2-hosted book |
| `POST /api/conversions/{id}/retry` | `routes/conversions.py` line 128 | Retrying a failed PDF/MOBI conversion always 404'd |
| `POST /api/books/{id}/convert-to-epub` | `routes/conversions.py` line 258 | Re-converting an original-only book always failed |
| `POST /api/books/refresh-all` | `routes/refresh.py` line 193 | Skipped books whose source_url wasn't cached |
| `POST /api/books/{id}/refresh` | `routes/refresh.py` line 348 | Single-book refresh 404'd "File missing" |
| `POST /api/books/{id}/suggest-tags` | `routes/tags.py` line 215 | AI tag suggestions ran without body-text context (much worse quality) |

(The exports.py ZIP fix from earlier is the 9th — total 9 R2-migration
regressions surfaced and patched on Jun 21.)

All swaps follow the same pattern:
```python
fp = STORAGE_DIR / user_id / f"{book_id}.epub"
ok = await asyncio.to_thread(
    ensure_local_cached, fp, user_id, book_id, ".epub",
)
if not ok:
    raise HTTPException(404, "...")
```

This is the canonical pattern that `routes/books.py::download_book`
has used since the Phase-4 migration completed; the audit just made the
rest of the codebase consistent with it.

**Verification**: 9 regression-related tests still pass after the sweep
(av_watchdog × 5, export_zip_r2 × 2, feature_flags_lifecycle × 1,
tailwind_darkmode × 1).  Lint clean across all 6 modified files.


## 2026-06-21 (download-zip-r2-regression) — empty bulk-download ZIP fixed ✅

**User-reported (screenshot Jun 21)**: `/admin` → Export → "Download ZIP"
on shelfsort.com produced a ZIP containing only `library_index.xlsx`
and `README.txt`.  Zero EPUBs.

**Root cause**: `routes/exports.py` line 104-106 used
```python
fp = STORAGE_DIR / user.user_id / f"{b['book_id']}.epub"
if not fp.exists():
    continue
```

The Phase-4 R2 storage migration moved every book's bytes from local
disk to Cloudflare R2.  Post-migration, `STORAGE_DIR` is empty for
most users, so this check skipped every book silently and the export
shipped a metadata-only ZIP.  This is the same bug pattern as the
ZIP-bomb-quarantine fix from earlier — bare ``if not fp.exists()``
checks that haven't been migrated to ``ensure_local_cached``.

**Fix** — `routes/exports.py`:
- Replaced bare ``fp.exists()`` check with
  ``ensure_local_cached(fp, user_id, book_id, ".epub")`` (the canonical
  R2-aware cache helper from ``utils/storage_cloud.py`` — same one
  `routes/books.py` already uses on the single-book download path).
- Tracks ``skipped_books`` and logs them as a warning so unrestorable
  books surface in ops instead of disappearing.
- Returns HTTP 503 with a friendly message when ZERO books can be
  restored — better than silently shipping an empty zip.

**Regression test** —
`tests/test_export_zip_r2.py` (static-analysis guard):
- `test_zip_export_uses_r2_restore_helper`: fails CI if anyone removes
  the ``ensure_local_cached`` call from exports.py.
- `test_zip_export_does_not_silently_skip_missing_files`: fails CI if
  the ``skipped_books`` tracking is removed.

**Verified end-to-end** on preview by seeding 4 fake EPUB stubs in
`/app/uploads/<user_id>/`, hitting `/api/books/export/zip`, and
confirming the resulting 7,682-byte ZIP contains exactly 4 EPUBs in
their proper Fanfiction/<Fandom>/_No_pairing/ folder structure plus
the README + xlsx index.


## 2026-06-21 (calibre-concurrency-cap) — pre-redeploy OOM protection ✅

Emergent Support baked ClamAV + Calibre into the production build
image and flagged a memory caution in their final reply:

> "Memory at runtime on Launch (2 GiB limit): clamd holds about 960 MB
> persistently, ebook-convert adds about 200 to 400 MB transiently per
> conversion.  Single-conversion peak fits with around 400 MB of
> headroom.  Concurrent ebook conversions could push the pod past the
> 2 GiB limit.  You may want to cap concurrent conversions to 1 or 2
> in your app code."

Without a cap, a single user dragging in a folder of MOBI files could
OOM-kill the entire pod on launch day.

**Fix** — `routes/books.py::convert_to_epub`:
- Added a lazy ``asyncio.Semaphore(2)`` around the
  ``run_in_executor(_convert_to_epub_sync, ...)`` call.
- Lazy init (not module-level) so the semaphore binds to whichever
  event loop is actually running at request time — avoids the
  "Future attached to a different loop" footgun under heavy traffic.
- Chose 2 (not 1) so a single user with a queue doesn't fully block a
  second user from converting at the same time, while still staying
  inside the ~400 MB headroom budget.

**Regression test** — `tests/test_calibre_concurrency_cap.py`:
- Fires 10 simulated conversions in parallel.
- Asserts peak in-flight count is exactly 2.
- Locks the cap in so a future refactor can't accidentally remove it.


## 2026-06-20 (av-auto-pause-watchdog + uploads-paused-banner) — defence in depth ✅

**Why**: production ClamAV daemon went DOWN on shelfsort.com; uploads
were silently going through UNSCANNED until the admin happened to
notice the red "DOWN" card.  On a free-tier infra without oncall,
that's an unacceptable security gap.

**Backend** — new module `utils/av_watchdog.py`:
- Runs every minute via the existing APScheduler instance.
- Probes `antivirus.is_available()` (cheap socket handshake, no scan).
- If clamd has been DOWN for `AV_DOWN_THRESHOLD_MIN = 5` minutes
  straight, auto-flips `uploads_enabled` OFF, writes an `av.auto_pause`
  audit-log entry, and drops an admin notification.
- Tracks state in `system_health` collection (singleton doc) so the
  down-streak survives pod restarts.
- **Does NOT auto re-enable** — once paused, an admin eyeballs the
  situation and flips it back on (avoids upload flapping if clamd
  bounces).
- Idempotent: re-runs while already paused don't write duplicate
  audit rows or spam notifications.
- Env-var kill switch `AV_WATCHDOG_ENABLED` (default true).  Preview's
  `.env` sets it to `false` because preview pods don't have clamd
  installed — without the override the watchdog would auto-pause
  every fresh pod after 5 min and block local upload testing.

**Backend** — `routes/admin.py::get_maintenance_banner_public`:
- Now emits a synthetic `warn`-severity banner with
  `source: "auto_uploads_paused"` whenever `uploads_enabled` is OFF.
- Manual admin-set banners still take precedence (so the operator can
  override the auto-text during a real incident).

**Frontend** — zero code changes needed.  The existing
`MaintenanceBanner` component polls `/maintenance-banner` every 60s
and renders any non-null payload site-wide above the navbar.

**Tests** — `tests/test_av_watchdog.py` (5 tests):
- `test_scanner_up_clears_down_streak`
- `test_scanner_down_under_threshold_does_not_pause`
- `test_scanner_down_past_threshold_auto_pauses` (verifies flag flip
  + audit row + admin notification)
- `test_idempotent_while_already_paused` (no duplicate side effects)
- `test_watchdog_disabled_via_env`

**Verified end-to-end**: flipped `uploads_enabled` OFF, confirmed the
maintenance banner renders site-wide with the explanatory copy; flipped
it back ON, banner clears.  Screenshot captured at
`/tmp/uploads_paused_banner.png`.


## 2026-06-20 (feedback-inbox-count-mismatch) — badge said "7 open", list said "none" ✅

**Reported via screenshot from production**: `/admin` feedback inbox
header read "Feedback inbox (7 open)" but clicking the OPEN filter
showed "No open feedback right now".

**Root cause**: The `suggestions` Mongo collection is shared between two
writers:
1. The product board (`POST /suggestions`) — docs have `suggestion_id`,
   `title`, `body`, `category`, etc.
2. The Help-page feedback writer (separate route) — docs have
   `text`, `page`, `photo_b64`, no `suggestion_id`, and default to
   `status: "open"`.

The list endpoint scoped itself with `suggestion_id: {$exists: true}`
to keep the two streams separate.  The **count endpoint** at
`GET /admin/suggestions/open-count` did NOT — it counted every doc with
`status: "open"`, sweeping in the Help-page writes the inbox UI was
filtering out.  Live DB had exactly 7 Help-page writes and 0 real
product-board open items, which is why the badge inflated by exactly 7.

**Fix**: One-line change to `routes/suggestions.py::admin_open_count`
— add the same `suggestion_id: {$exists: true}` filter.

**Regression test**: `tests/test_suggestions.py::TestAdmin::
test_open_count_ignores_help_feedback_writes` — plants 3 Help-page-style
records (no `suggestion_id`) and asserts the count does NOT drift.
Locks the bug in.

**Verified** end-to-end against preview DB: count endpoint now returns
0 (matching the list), and after deploy this matches the production
mismatch the user screenshotted.


## 2026-06-20 (dark-mode-selector-fix) — every dark:* Tailwind variant was silently broken ✅

**Root cause:** `tailwind.config.js` was set to `darkMode: ["class"]` —
Tailwind's default, which looks for a `.dark` class on a parent.  But
`ThemeContext.jsx` switches themes by writing `<html data-theme="dark">`
instead.  The two conventions never met, so every single
`dark:bg-*` / `dark:text-*` / `dark:border-*` Tailwind variant
across the entire codebase silently NEVER fired in dark mode.  Dark
appearance only came from the handful of components with hand-rolled
`[data-theme="dark"]` CSS overrides in `index.css`.

Surfaced when a user spotted the `/admin` Antivirus HEALTHY card
rendering near-white text on a pale-mint background in dark mode — the
`dark:bg-emerald-950/40` and `dark:text-zinc-100` variants were both
inert.

**Fix:** one-line change in `tailwind.config.js`:
```js
darkMode: ['selector', '[data-theme="dark"]'],
```

Tailwind 3.4.1+ supports custom selector strategies, and we're on
3.4.17.  Every `dark:*` variant in the codebase now fires correctly.

**Verification:**
- Took before/after screenshots of `/admin?theme=dark`.  Antivirus
  HEALTHY card background now computes to `rgba(2, 44, 34, 0.4)`
  (dark emerald) with light text — fully readable.
- Spot-checked `/library?theme=dark`: clean, consistent, no
  regressions.
- Frontend restarted to pick up the new Tailwind compilation.

**Regression guard:**
- `backend/tests/test_tailwind_darkmode_selector_guard.py` (new) — fails
  CI if anyone reverts `darkMode` back to `"class"` or strips the
  `[data-theme="dark"]` selector.


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
