# Shelfsort — Launch Tweet Drafts

Two-paragraph drop, multi-platform. Pick one based on the channel:
**Twitter/X** (cap 280, image required), **Bluesky** (cap 300), and
**Mastodon/Threads** (longer-form, can tag fandoms directly).

---

## A. Cover-ecosystem flagship (preferred — most shareable)

> 📚 Shelfsort sorts your epubs by fandom, generates AI book covers in
> the aesthetic of your choosing, and lets you cross-pollinate cover
> ideas with other readers.
>
> Free, no ads, runs in the browser. Built for the AO3 → re-read pile.
>
> Try it 👉 https://shelfsort.com

Asset suggestion: 4-up grid of the top "Cover of the Week" entries
from `/api/cover/leaderboard`. Pair with `@username` on the tweet so
the original sharer gets a notification.

---

## B. Cross-device reading sync angle

> Started a fic on your laptop, finished it on the subway? Same.
>
> Shelfsort now syncs your reading position across every device the
> moment you stop turning pages. EPUB + AI-generated covers + private
> bookclubs. Free, no ads.
>
> https://shelfsort.com

Asset: animated GIF of cursor jumping from a Mac browser → iPhone with
the "Resume" badge lighting up.

---

## C. Privacy & community angle (Mastodon-flavored, longer)

> Shelfsort is a fan-built epub library that:
>
> • sorts by fandom automatically (Harry Potter / Twilight / etc.)
> • generates AI covers in any style you like
> • syncs your reading position across phone + laptop
> • lets you co-read with friends in a private bookclub
>
> Zero ads. Your reading data never leaves the app. The cover heatmap
> + community pool are 100% opt-in.
>
> https://shelfsort.com — would love to hear what's missing.

---

## Posting checklist

- [ ] Deploy to production first (Platform "Deploy" button)
- [ ] Verify https://shelfsort.com/explore/covers renders nice OG tags
      (Cmd+L → paste link into a Discord channel for the preview test)
- [ ] Pick a top community cover, attach its image, tag the sharer's
      username in the tweet body
- [ ] Schedule for **Tuesday 10:00 UTC** (best B2C engagement window
      per the visitor-analytics widget on the Admin Console)
- [ ] Cross-post to Bluesky + Mastodon within the same 5-minute window
- [ ] Reply-thread the 2nd tweet with the changelog highlights once
      the first reply trickles in (≈ T+30 min)

## After-launch monitoring

- Watch `/admin` → Analytics widget for the explore/cover → signup
  funnel.  We expect ≈ 5–8 % cover-page → signup if the angle lands.
- Watch `/var/log/supervisor/backend.*.log` for any SSE backpressure
  warnings during the first hour of inbound traffic.
- If the cover ecosystem gets a sudden inrush of voters, ride the
  wave with a follow-up "Cover of the Week" highlight thread the
  following Monday.
