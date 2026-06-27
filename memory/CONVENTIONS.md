# Shelfsort Engineering Conventions

This doc captures the in-house patterns every agent (and human
contributor) should follow when shipping changes to Shelfsort.
Conventions are added as we learn what works — when in doubt, check
the most recent CHANGELOG entry that mentions the convention.

---

## 1. New-feature announcement convention (2026-06-27)

> **Whenever a user-facing feature ships, mount a one-time tip near
> the surface it affects so existing users discover it without
> needing release notes.**

Why: the in-app tip is the highest-conversion channel for feature
discovery.  Toasts get missed in a flood; release-note pages get
ignored.  An inline banner mounted **next to the surface the feature
changes** catches users in context, then disappears forever once
they X out.

### The pattern

Use `frontend/src/components/OneTimeTip.jsx` — the reusable
educational banner.  Drop it directly inside whatever page /
component the new feature affects, above (or near) the affected
surface.

```jsx
import OneTimeTip from "@/components/OneTimeTip";

// Inside the page that hosts the new feature:
<OneTimeTip tipKey="characters-browser" accent="purple">
  every character from your library is now browsable at{" "}
  <Link to="/library/characters" className="underline">/library/characters</Link>.
  Hover any category badge on a book card to see why Claude picked
  that fandom — new this week.
</OneTimeTip>
```

### Rules

1. **Tip key naming** — `<feature-slug>` (kebab-case, no
   `shelfsort.tip.` prefix — `OneTimeTip` adds that automatically).
   Examples: `airdrop-tab-close`, `characters-browser`,
   `wrapped-share`, `friend-request-banner`.
2. **One tip per feature** — never stack two tips on the same
   surface.  If multiple features land in the same week, prefer ONE
   tip with two short paragraphs over two separate tips.
3. **Copy style**:
   - Lead with what's NEW or what the user can DO ("once the
     upload bar finishes, you can close this tab").
   - Don't explain implementation ("we moved this to a background
     queue").
   - Cap at ~140 chars of bold + ~280 chars of detail.
4. **Accent** — `purple` (default) for general features,
   `amber` for upload / pipeline / "things in flight" themes.
5. **Compact variant** — pass `compact={true}` when the tip lives
   inside a small card or sidebar (dashboard upload widget, etc.).
   Use the full variant on dedicated pages.
6. **Persistence** — `localStorage` key is auto-managed.  Never
   build a parallel "tip seen" tracking mechanism.
7. **Removal** — tips can be deleted from the codebase once
   adoption stabilizes (say, 30 days post-launch).  The dismissal
   key is orphaned but harmless; users who never dismissed will
   never see the tip again because the component isn't mounted.

### Examples of features that should have shipped with a tip

| Feature | Tip key (suggested) | Surface |
|---|---|---|
| Airdrop mode | `airdrop-tab-close` ✅ | UploadZone |
| Characters browser | `characters-browser` | AllBooksPage |
| Per-book "Sort now" chip | `sort-now-chip` | AllBooksPage |
| Classifier rationale tooltip | `classifier-reason-tooltip` | AllBooksPage |
| FriendRequestBanner | `friend-request-fix` | AllBooksPage / Friends |
| Wrapped year-in-books | `wrapped-share` | Wrapped page |

If you're shipping a new feature and not sure where the tip goes —
default to the page where the user is most likely to use it first.

### Don't forget

When you add a `OneTimeTip` for a new feature, add a one-line entry
to the CHANGELOG noting:
- The tip key
- Which surface it mounts on
- The copy

So this convention itself stays discoverable.

---

## 2. Data testid convention

Every interactive element + every element showing critical user-
facing info must have a `data-testid`.  Naming: kebab-case,
describes function not style (`login-form-submit-button`, not
`primary-cta`).  See top-level system prompt.

---

## 3. Background work resilience pattern (2026-06-27)

When deferring user-triggered work to a background task on the
backend event loop, always pair it with:

1. **In-memory inflight gate** to prevent double-spawn from
   concurrent triggers.
2. **5-minute recovery cron** that re-schedules stuck rows.
3. **Startup hook** (~20s delay) that runs the recovery once.

Pattern reference: `utils/polish_worker.py` and
`routes/upload_jobs.py::recover_stuck_upload_jobs` — both follow
this triple safety net.

---

## 4. MongoDB cascade deletes

When a user deletes their account (`_hard_delete_user` in
`routes/auth.py`), every collection that references their
`user_id` must be cleared.  See the friend-request "Someone" bug
fix changelog entry — that bug was caused by missing
`friendships` / `invites` / `notifications` cascade.

When adding a new collection that stores a `user_id`, append it to
the `_hard_delete_user` purge list immediately.

---
