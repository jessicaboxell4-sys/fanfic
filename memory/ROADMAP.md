# Shelfsort — Roadmap

> Active backlog. Items move to [CHANGELOG.md](./CHANGELOG.md) when shipped.

## P1 — high value, ready to pull
- **Moderators role** — third role between regular user and admin. Mod-level
  permissions: review reported messages / books, hide bookclub posts, mark
  feedback as resolved, view (but not edit) admin console. Implementation
  notes:
    * Add `is_moderator: bool` flag on `User` model (alongside the existing
      `is_admin`).
    * New `auth_dep.get_current_moderator_or_admin` dependency.
    * Backend: gate the existing report/feedback/abuse routes on mod OR admin.
    * Frontend: surface a "Mod inbox" link in the Navbar dropdown for users
      with the flag; reuse `AdminConsole` shell with a feature-flag prop so
      mods see only the moderation tabs.
    * Promote/demote mods from the existing Admin Console user-list, same
      UI pattern as the admin promotion flow.
    * Decide: can mods promote other mods? Default = NO, admin-only.
    * **Open questions to confirm with user before implementing:**
        - Should mods be able to ban users? (default proposal: no — admin-only)
        - Can mods lock bookclub rooms? (default proposal: yes)
        - Can mods approve pending sign-ups? (default proposal: yes —
          frees up the admin for everything else)
        - Should mods be able to hide/delete EPUB uploads they consider
          abusive, or just flag them for admin review?

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

## P2 — polish & infrastructure
- OG/Twitter card meta tags for `/share/yib/:token` ✅ (shipped 2026-06-16, see CHANGELOG)
- Cover regeneration via AI when EPUB has no cover image
- Move from local FS to object storage when scaling

## P3 — nice-to-have
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
