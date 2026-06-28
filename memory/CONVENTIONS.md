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


## 3. Dark-mode coverage (2026-06-28)

> **Every light-coloured `bg-[#XXXXXX]` background MUST have a
> matching `:root[data-theme="dark"]` rule in
> `frontend/src/index.css`, OR an explicit `// dark-ok` opt-out on
> the JSX line.**

Why: Shelfsort uses literal hex utility classes
(`bg-[#FBFAF6]` etc.) throughout the codebase and flips to dark
mode by *retargeting those exact compiled class names* via
attribute selectors in `index.css`.  A light hex background
without a dark-mode rule renders as a giant white slab when the
user flips the theme — the kind of bug spotted with the admin
"Jump to section" dropdown and the upload resume banner.

### The check

```bash
python3 scripts/check_dark_mode_coverage.py
```

* Scans every `.js` / `.jsx` / `.ts` / `.tsx` file under
  `frontend/src/`.
* Flags any `bg-[#XXXXXX]` or opaque `bg-white` with WCAG
  luminance > 0.70 that doesn't appear in a
  `:root[data-theme="dark"]` rule in `index.css`.
* Skips `bg-white/N` semi-transparent overlays by default (they're
  almost always intentional on dark gradients — pass
  `--include-white-opacity` for strict mode).
* Exits 1 on any uncovered class, prints `file:line` so you can
  jump straight to the fix.

### When to run it

* **After any frontend change that introduces a new `bg-[#…]`
  class** — don't wait for the user to screenshot the bug.
* As part of the "any bugs?" deep-dive (see PRD.md step 7).
* Before any deploy that touches frontend files.

### Fixing a flagged class

Two options:

1. **Add the dark-mode mapping** — at the bottom of `index.css`
   (look for the dated "Dark-mode coverage backfill" block), group
   the new hex under the right accent family (cream / purple /
   mint / peach / amber / sky).  Each family maps to an
   appropriately-tinted dark surface so the colour identity is
   preserved.

   ```css
   :root[data-theme="dark"] .bg-\[\#XXXXXX\] { background-color: rgba(…); }
   ```

2. **`// dark-ok`** — append the marker to the JSX line if the
   bright background is intentional in both modes.  Example:
   a hero overlay using `bg-white/10` over a saturated gradient,
   or a deliberately bright sticker chip.

   ```jsx
   <div className="bg-white/40 ..."> {/* dark-ok — intentional overlay on hero gradient */}
   ```

### Don't

* Don't add a generic catch-all like `*[class*="bg-["]` — it would
  steamroll every per-colour tinted design.
* Don't disable the check by reducing the luminance threshold —
  the cutoff is calibrated to catch every cream/pastel that reads
  as "white-ish" without the user squinting.

## 4. Tiny-font accessibility (2026-06-28)

> **No `text-[Npx]` class where N ≤ 9 is allowed without an
> explicit `// fontsize-ok` opt-out on the same line.**

Why: anything below 10px is below the WCAG comfort threshold for
any text on any surface — even readers with 20/20 vision squint.
The codebase has a few legitimate cases (single-character chips,
count bubbles inside 16×16 px squares, intentional cover-overlay
text on thumbnails) but they should be deliberate, marked, and
reviewed — not slipping in unnoticed.

### The check

```bash
python3 scripts/check_tiny_fonts.py
```

* Scans every `.js` / `.jsx` / `.ts` / `.tsx` under
  `frontend/src/` for `text-[Npx]` patterns with N = 1–9.
* Auto-exempts the standard `uppercase tracking-wider` badge
  pattern (e.g. status pills, role badges) — tight letters at
  9px read as well as un-tracked 11px, so flagging them would
  generate noise.
* Honours `// fontsize-ok` on the same line as the escape hatch.
* Exits 1 on any unmarked finding.

Note: `text-xs` (12px) is **not** flagged — it's used 1000+ times
in the codebase for legitimate badges and meta info.  The
standing rule is: use `text-sm` (14px) minimum for paragraph /
body text, `text-xs` only for chips and meta.

### When to run it

* **After any frontend change that introduces a new `text-[Npx]`
  class.**
* As part of the "any bugs?" deep-dive (PRD.md step 8).
* Before any deploy that touches frontend files.

### Fixing a flagged class

1. **Bump the size** — `text-[10px]` is the smallest comfortable
   value for most cases; `text-xs` is preferred for everything
   that isn't a single character or count.
2. **`// fontsize-ok` marker** — append to the JSX line if the
   tiny size is genuinely needed.  Explain in a brief inline
   comment why:

   ```jsx
   <span className="text-[8px] ...">Title</span> {/* fontsize-ok — fallback inside 60px thumb */}
   ```

