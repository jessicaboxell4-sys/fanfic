# Contest submission — draft & to-do

**Contest:** Emergent × Fabrizio Romano, ends **July 21, 2026**.
**Live app:** https://shelfsort.com
**Submission page:** https://app.emergent.sh/home (click "Submit your app")

This file is a hold-file so we don't lose the draft before you're ready to
submit.  When you're ready, tell the agent "let's do the contest submission"
and it'll walk you through pasting these values into the form.

---

## 📝 Draft submission copy

### One-line tagline

> Drop a Downloads folder of nameless EPUBs. Shelfsort sorts them by
> fandom, in your browser, with AI — then gives you a reader, a
> year-in-books recap, and friends to talk about them with.

### Short description (100–150 words)

> Shelfsort is a quiet corner of the internet for people who read the way
> real readers do — a folder of half-titled EPUBs from AO3, a Kindle
> export nobody labelled, and a "someday" pile that never got sorted.
>
> Drop the folder. Shelfsort reads the metadata, uses Claude as a quiet
> second opinion when the title alone won't tell, and files every book
> by fandom — Harry Potter, ACOTAR, Marvel, Original Fiction — with
> pairings and characters cross-referenced.
>
> Then it gives your library a home: an in-browser reader that respects
> your eyes (dark mode, sync-across-devices bookmarks, zero ads), a
> nine-slide Year-in-Books recap, book clubs with chapter-per-week pacing,
> and friends who actually read.
>
> Every upload is virus-scanned. Free while we grow.

### Longer description (250 words, if the form allows)

> Shelfsort was built for the fanfic archivist with 2,000 EPUBs and
> nowhere to put them, the AO3 → re-read pile, and the casual reader who
> just wants an ad-free place to open a book from any device.  Drop a
> folder, and Shelfsort reads the EPUB metadata, cross-references it
> against Claude when the title is ambiguous, and files each book by
> fandom + pairing + character.  Original fiction and non-fiction keep
> their own shelves — nothing gets forced into a category it doesn't
> belong to.
>
> The reader handles EPUB, PDF, TXT and DOCX inline.  Reading position
> syncs across devices.  Bookmarks remember the chapter you cared about.
>
> Year in Books ships nine cinematic slides at the end of every year:
> books opened, pages turned, longest streak, top fandom, top author,
> top pairing.  Download as PNG, paste into Threads or iMessage.
>
> Book clubs run a chapter a week; the app auto-posts discussion prompts
> and emails a weekly digest.  Friends see each other's public shelves
> — opt-in, revocable.  Nothing is scraped.  Nothing is sold.
>
> Every upload is malware-scanned.  Everything is free while the project
> is growing.

### Recommended tags / keywords

`ai`, `epub`, `fanfiction`, `reading`, `library`, `ao3`, `books`,
`claude`, `personal-library`, `ebook-reader`, `year-in-books`,
`book-clubs`, `pdf-reader`, `accessibility`.

### Recommended hero screenshot for the submission thumbnail

1. **`/og-image.png`** (`1200×630`) — already served by the site as the
   OpenGraph card.  This is the fastest safe choice.
2. **Landing hero** — the sage-green armchair illustration on the home
   page.  Warm, on-brand, non-generic.
3. **Real library shot** — screenshot of your `/library` grid with
   30-40 real books already sorted into HP, ACOTAR, Marvel, Original
   Fiction, and one or two smaller fandoms.  Best signal of "this
   thing actually does what it says."  Recommend cropping to
   `1200×630`.

---

## 🎬 Demo GIF / video — where does it go?

**Short answer:** the submission form on `app.emergent.sh/home` will
almost certainly have a "video URL" or "demo link" field when you click
**Submit your app**.  Emergent contests typically accept:

* A **Loom / YouTube / Vimeo URL** (easiest — free hosting, embeds
  cleanly in the contest gallery).
* A **direct MP4 / GIF file upload** (some forms accept up to ~50 MB).

If the submission form only shows a text field, use the URL.
If it accepts a file, upload the MP4/GIF directly.

**Aim for:** 30–60 seconds, `1280×720` or `1080p`, no audio required.
**Shot list (my suggestion):**

1. `0:00–0:05` — Empty library on `/library`.  Drag a folder of ~20 EPUBs
   onto the drop zone.
2. `0:05–0:15` — Watch them auto-sort — background upload bell + fandom
   shelves populating.
3. `0:15–0:25` — Click into the Harry Potter shelf.  Open a book.
   Reader loads, dark-mode toggle.
4. `0:25–0:35` — Close the book, jump to Year-in-Books slides.  Show 2–3
   slides.
5. `0:35–0:45` — Land back on `/library` with everything filed.
   Overlay the tagline text.

**Also worth doing (bonus surface):**
Once the video is up, add an embedded `<video>` or Loom `<iframe>` in a
new "See it work" strip on the Landing page (below the hero, above the
feature cards).  Contest judges bouncing from the submission page back
to the live app will see the same demo they just watched — reinforces
the pitch.

---

## 🎗️ Emergent Contest chip on the landing hero — hold

User asked to add a small `Featured in Emergent Contest · July 2026`
chip near the hero as a badge (turns the Emergent connection from a
footer credit into a positive signal).  Status: **not yet.**  Agent
will add it when the user says "add the contest chip."  Expected
placement: right next to the `A quieter way to organize ebooks`
tagline, matching pill shape.  ~5 lines of JSX.

---

## ✅ Pre-submission checklist

* [x] Maintenance banner rewritten to positive copy (2026-07-09)
* [x] Presence-pill visual regression fix in preview
* [x] "Built by one person, in the open." tagline in preview
* [x] Skip-to-content + `<main>` landmark + focus outline on Landing,
      Login, Help, Changelog, KindleImport (WCAG 2.4.1 & 2.4.7)
* [ ] Redeploy from Emergent chat — pushes preview → prod
* [ ] Record demo GIF (see shot list above)
* [ ] Add Emergent Contest chip (deferred)
* [ ] Fill out submission form on `app.emergent.sh/home`

---

## 🖼️ Preview walkthrough — hold

User asked for a set of preview screenshots showing the polished state
(pill fix in Admin > Users & admins, "Built by one person, in the open."
tagline under stats, skip link visible on first Tab, etc.) BEFORE
committing to Re-publish, so she can eyeball everything landing on
prod.  Status: **not yet.**  Agent will run the walkthrough when the
user says "run the preview walkthrough" or similar.  Expected shots:
Landing hero + counter strip + tagline, Admin Users&admins pills,
Login screen with skip link focused (Tab once), Help/Changelog/Kindle
Import each with main landmark visible in devtools.

---

## 🕓 Hardening reminders — surfaced by testing agent iteration 75

Non-urgent but worth doing at some point:

1. **`iter` test-account prefix false-positive risk** — `utils/test_account_filter.py` treats any email starting with `iter` (no underscore, no digit) as a test account.  This would false-positive a real user like `iterative@company.com`.  Fix: change to `iter[0-9]` regex-style, or expand to `iter1`, `iter2`, ..., `iter9` explicit prefixes.

2. **Purge endpoint matches by display-name substring** — the new `/api/admin/purge-test-account-spam` endpoint (2026-07-09) matches friend-request notifications by title regex against the test-account display name.  A real user whose display name happens to start with the same string as a test account (unlikely but possible) would have their friend-request notifications purged too.  Longer-term fix: stamp `sender_user_id` onto every `create_notification` payload so purge can filter by user_id instead of title.

---

*Last updated: 2026-07-09*
