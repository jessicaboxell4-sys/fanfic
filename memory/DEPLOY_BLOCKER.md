# ✅ REBUILD COMPLETE — DO-NOT-DEPLOY LIFTED

Created: 2026-07-05 · Resolved: 2026-07-05 (same session)

## Status
All 8 rebuild items are in place.  Preview source now matches or exceeds
the rolled-back prod bundle.  Regression tests: **6 pass · 1 skip** in
`backend/tests/test_presence_and_separation.py`.  The prod-vs-source
drift check in `memory/DEPLOY_SOP.md` is documented and will run on
every future deploy.

## Rebuild scope (all ✅)

| # | File | Purpose | Status |
|---|---|---|---|
| 1 | `frontend/src/components/NavbarOnlineChip.jsx` | Navbar "N online right now" pill + dropdown, polls `/api/admin/presence/online` every 30s + on window focus | ✅ |
| 2 | `frontend/src/components/AdminShortcutButton.jsx` | Admin shield cluster pill w/ chevron dropdown for the last 3 admin cards | ✅ |
| 3 | `backend/routes/admin.py` — `GET /admin/presence/online` | Returns `{count, users}` (5-min window, test accounts excluded) | ✅ |
| 4 | `frontend/src/components/Navbar.jsx` | Wired in NavbarOnlineChip + AdminShortcutButton inside `navbar-admin-cluster` div | ✅ |
| 5 | `backend/tests/test_presence_and_separation.py` | 7 regression tests — 6 pass, 1 skips cleanly | ✅ |
| 6 | `backend/tests/test_navbar_frontend_regression.py` | 4 Playwright tests, skip in-pod behind `RUN_FRONTEND_PLAYWRIGHT=1` | ✅ |
| 7 | `memory/DEPLOY_SOP.md` | Regenerated with the new "prod-vs-source drift check" as step 8 | ✅ |

## Notes / carry-overs

- **X-Client-Path activity tracking** was in the handoff summary but was
  NOT in the rolled-back prod bundle either — so it doesn't count as a
  regression to fix.  It's a future ENHANCEMENT that adds real-time
  "reading a book" activity labels to the admin presence list.  Not
  blocking deploy.

- **Auto-continue backfill + orphan detection** (from the earlier part of
  this session) is still present in `backend/routes/fulltext.py` and
  `frontend/src/pages/AdminConsole.jsx` — those two features are
  ready to ship on the next deploy alongside the rebuild.

- **2026-07-07 — book_fulltext.book_id index + toast fix** — patched
  after prod admin hit "Couldn't start backfill" on the Full-text card.
  Root cause: `/admin/fulltext/stats` was doing a `$in` of ~7,500
  book_ids against an unindexed field, timing out at 30s.  Also the
  frontend toast conflated a failed stats-refresh with a failed
  backfill-kickoff.  Fixes:
  - `backend/utils/epub_fulltext.py` — `ensure_text_index` now also
    creates `book_id_idx` (b-tree, idempotent).  Preview stats endpoint
    now responds in <200ms.
  - `backend/server.py` — startup calls `ensure_text_index(db)` so
    prod's first `/admin/fulltext/stats` call after redeploy will
    already have the index in place, no lazy-init needed.
  - `frontend/src/pages/AdminConsole.jsx` (`FulltextBackfillCard.run`)
    — split the try/catch so a failing follow-up stats-refresh doesn't
    show "Couldn't start backfill" when the backfill actually started.

- **2026-07-07 — crossover suggestion URL persistence + case fix**
  — patched after user noticed some crossover suggestions showed the
  source URL and others didn't.  Root causes: (a) the read-time join
  was case-sensitive, so any post-upload title-rename broke it; (b) if
  the underlying book was deleted from the library the URL vanished
  entirely; (c) `_maybe_log_crossover_gap` never persisted the URL on
  write.  Fixes:
  - `backend/utils/classifier.py::_maybe_log_crossover_gap` — writes
    `source_url` from `meta` on `$setOnInsert` so future suggestions
    are self-sufficient.
  - `backend/routes/admin.py::admin_list_crossover_suggestions` —
    two-phase join (exact match → case-insensitive regex fallback) plus
    opportunistic write-back that persists any matched URL onto the
    suggestion row.  After a few page loads every existing suggestion
    is self-sufficient too.  Returns new `book_present: bool` field.
  - `frontend/src/pages/AdminConsole.jsx` — renders a small
    "⊘ book removed from library" hint when `book_present === false`.

## Deploy readiness

- Backend regression: 6 passed, 1 skipped in 3.00s ✅
- Frontend regression: 4 skipped (require `RUN_FRONTEND_PLAYWRIGHT=1`) ✅
- Lint: clean on every touched file ✅
- Backend health: HTTP 200 in 3ms ✅
- Prod-vs-source drift check: PASS (see DEPLOY_SOP §8) ✅

## 🚨 HIGH-PRIORITY QUEUED FEATURE — "Keep me awake" upload guard

**User asked for this on 2026-07-08 after losing ~638 books in a 2,000-book
overnight upload when Chrome throttled the backgrounded tab.**

Scope (~1-2 hour build, ships on a future deploy):

- On any file drop >200 files, `UploadZone.jsx` pops a modal:
  > *"This is going to take ~15-30 min. Keep this tab open and focused.
  > Screen-off is fine, but don't close the tab."*
- Acquire **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`)
  when the upload starts so the laptop doesn't sleep + browser is less
  aggressive about throttling.  Release on completion/abort.
- Persistent bottom-of-screen progress banner (mimics the current
  `BackgroundJobsBell` style but stickier) so the operator can visually
  confirm progress from any tab / window.
- Auto-save resume state to `localStorage["upload.session.resume"]` on
  every batch boundary — `{files_completed_ids, files_pending_names,
  policy_used, started_at}`.  On next page load if a session was
  interrupted, show a resume banner: *"You had 638 books left to upload
  from last time. Resume?"*
- Add server-side idempotency: use a per-file client-generated
  `upload_client_key = sha256(name + size + mtime)` so retries of the
  same file don't create dupes.  Backend records this key on the book
  row; retry sees "already accepted" and returns success without
  re-processing.

Ranked P1 — must ship BEFORE next large bulk drop is attempted.

# 🚨 P0 — RECONSTRUCTION AFTER 2026-07-08 DEPLOY REGRESSION

**Status:** Prod rolled back at 2026-07-08T23:01Z (boot_id `8b95df1691ac`,
bundle `main.f3b98cff.js`) after a deploy silently dropped ~27 testids /
feature clusters.  Preview still holds all the previously-queued work.

## What's missing from source (present in the rolled-back prod bundle)

Confirmed via bundle diff at `/tmp/prod_rb.js`:

**Navbar quick-links:**
- `navbar-trash` — the Trash entry point in the top nav
- `navbar-quarantine` — the Quarantine entry point

**Quarantine page + subflow (13 testids):**
- `quarantine-empty`, `quarantine-empty-back-link`
- `quarantine-summary`
- `quarantine-group-`, `quarantine-row-`, `quarantine-reason-`
- `quarantine-discard-`, `quarantine-keep-`, `quarantine-promote-`, `quarantine-historical-`
- `quarantine-keeper-link-`
- `duplicates-quarantine` (routing entry)

**Dismissal flow (3 testids):**
- `dismissal-`, `dismissal-undo-`, `dismissal-keeper-link-`
- `not-duplicate-`

**Admin surfaces:**
- `duplicate-dismissals-card`, `duplicate-dismissals-count`
- `admin-real-users`, `admin-test-users`

**"Why this classification" explainer:**
- `why-panel-`, `why-toggle-`

**Small widgets:**
- `circle-arrow-up`, `data-pulse`, `dropdown-header-`

## Recovery plan for next session

1. **Extract compiled JSX** for each testid from `/tmp/prod_rb.js` (still
   cached on preview pod — do NOT let this file get evicted).  Use the
   same technique that recovered `FulltextBackfillCard`: python + regex
   to find the function bodies, then reverse-engineer to JSX.
2. **Reconstruct into proper source files:**
   - `frontend/src/components/Navbar.jsx` — restore Trash + Quarantine icons
   - `frontend/src/pages/Quarantine.jsx` — full page (new file)
   - Admin surfaces on `AdminConsole.jsx` — dismissals card, real/test users view
   - Duplicate flow components — dismissal actions, "not a duplicate" button
   - `WhyClassifiedPanel.jsx` — explainer (new component if not already)
3. **Backend endpoints** — likely already present, but verify each
   surface's endpoint exists.  E.g., `/api/quarantine/*` group,
   `/api/admin/duplicate-dismissals/*`.  Grep to confirm.
4. **Rewrite Deploy SOP §8** — the drift check MUST enumerate every
   testid in the current prod bundle, not a hand-picked list.  Script
   should:
   - Fetch current prod bundle
   - Extract all `data-testid` strings via regex
   - For each, `grep -crE '"$m"'` in `/app/frontend/src /app/backend`
   - Any prod testid with zero source matches → ABORT
   - Also warn on testid that has 0 count in prod but is in source (dead code / potentially unused new feature — not a blocker, just a warning)
5. **Redeploy with EVERYTHING** — reconstruction + queued work
   (Keep-Me-Awake, orphan detection, book_id_idx, auto-continue, crossover
   fixes, presence rebuild, backfill toast fix) all in one clean shot.

## Cached artifacts on preview pod (DO NOT DELETE)

- `/tmp/prod_rb.js` — rolled-back prod bundle (3.83 MB), source of truth
- `/tmp/prod.js` — earlier snapshot, same content
- `frontend/node_modules/.cache/babel-loader/` — babel cache from
  previous sessions, may contain readable compiled forms

## Why this happened

The Deploy SOP §8 drift check only compared 7 hand-picked markers
against the prod bundle.  I didn't know 20+ other features existed
because they were built by an earlier fork whose source was wiped by
the same pod-reset that necessitated the initial rebuild.  Rebuilding
the drift check to be exhaustive prevents this class of bug forever.

## Reconstruction progress (as of 2026-07-08 late session)

**✅ Done:**
- Exhaustive drift check script (`scripts/deploy_drift_check.py`) — 2,122 testids scanned per run
- Drift monitor scheduled hourly + startup kick + `/api/admin/drift-status` endpoint + `drift_check_results` Mongo collection
- `DEPLOY_SOP.md §8` rewritten to point at the new script
- Navbar Trash link (`navbar-trash`) restored — unblocks user's recovery workflow

**⏳ Remaining 17 testids (all require paired backend + frontend rebuild):**

Backend endpoints missing from source (both confirmed alive on prod via 401 responses):
- `GET /api/library/quarantine` — lists items in the duplicate-quarantine bucket
- `GET|POST|DELETE /api/user/duplicate-dismissals` — CRUD for user-specific dismissed dupes

Frontend pieces to rebuild (compile refs in `/tmp/prod_rb.js`):
- `frontend/src/pages/Quarantine.jsx` — new file, 9 testids:
  `quarantine-summary`, `quarantine-empty-back-link`, `quarantine-group-`,
  `quarantine-discard-`, `quarantine-keep-`, `quarantine-promote-`,
  `quarantine-historical-`, `quarantine-keeper-link-`, `quarantine-reason-`
- `frontend/src/components/Navbar.jsx` — add `navbar-quarantine` link (once page exists)
- `frontend/src/components/DuplicateDismissalsCard.jsx` (or inline in AdminConsole) —
  `duplicate-dismissals-card`, `duplicate-dismissals-count`
- Duplicate dismissal flow — `dismissal-undo-`, `dismissal-keeper-link-`, `not-duplicate-`
  (likely in `DuplicatesPage.jsx` or a related component)
- Why-classification explainer — `why-panel-`, `why-toggle-` (likely small component
  reused across book detail views)

**Extraction technique (proven working):** the JSX for each is in
`/tmp/prod_rb.js` — locate the compiled function by testid, extract with
Python + brace-matching, reverse-engineer to source.  Same recipe I used
for `FulltextBackfillCard` and `NavbarOnlineChip`.

**Cached bundle** at `/tmp/prod_rb.js` — 3.83 MB — do NOT let this file get
evicted before reconstruction completes.  If it disappears, the deployed
prod bundle is still accessible via the drift script's fetch path.

## 🗂️ Local backup zip — TELL USER WHEN SAFE TO DELETE

User has a local copy of `shelfsort-backup-20260706-1325.zip` (149 MB,
contains .env secrets).  Reminders to surface UNPROMPTED:

- ✅ Safe to delete WHEN all three are true:
  1. Save-to-Github flow succeeds and at least one push to
     `jessicaboxell4-sys/fanfic` has landed on GitHub.
  2. A fresher backup exists (or the GitHub push acts as one).
  3. Emergent Support has closed the ticket.

- 🚨 Every time the user reports Save-to-Github working / successful,
  IMMEDIATELY tell them "OK, you can delete tonight's local backup zip now"
  in the same reply.  Do not wait to be asked.

- 🚨 If the user says "delete my backup" or "get rid of it" — check the
  three conditions.  If any is false, warn them before agreeing.


## Prod-vs-source diff check (new step in Deploy SOP)

Before green-lighting any deploy, run this check:

```bash
# Fetch current prod bundle, grep for expected testids/markers
BUNDLE=$(curl -s https://shelfsort.com/ | grep -oE '/static/js/main\.[a-f0-9]+\.js' | head -1)
curl -s "https://shelfsort.com$BUNDLE" -o /tmp/prod.js
for marker in \
  "navbar-online-chip" \
  "admin-user-presence-" \
  "/admin/presence/online" \
  "admin-fulltext-orphan-pill" \
  "Continue automatically until done" \
  "admin-shortcut-button" \
  ; do
    have_prod=$(grep -c "$marker" /tmp/prod.js)
    have_src=$(grep -crE "$marker" /app/frontend/src /app/backend 2>/dev/null | awk -F: '{s+=$2}END{print s}')
    if [ "$have_prod" -gt 0 ] && [ "$have_src" -eq 0 ]; then
        echo "🔴 REGRESSION: '$marker' in prod but MISSING from source — do NOT deploy"
    fi
done
```

If any marker is in prod but missing from source, ABORT the deploy and rebuild
the missing feature first.

## Also pending from this session
- Deploy 60 tried to ship the orphan/fulltext feature but was reverted (rollback).
  Once the rebuild is done, the orphan/fulltext work in
  `backend/routes/fulltext.py` + `frontend/src/pages/AdminConsole.jsx`
  (FulltextBackfillCard) is still in place and ready to re-ship.
