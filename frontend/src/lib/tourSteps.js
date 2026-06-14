/**
 * First-time tour steps. Add new entries to keep the tour fresh as features ship.
 *
 * Each step:
 *   id      — stable identifier (used to advance/skip from URLs if needed)
 *   title   — short headline
 *   body    — paragraph copy (string or array of paragraphs)
 *   path    — optional route to navigate to before showing this step
 *   testid  — optional data-testid of an element to spotlight (for future use)
 *
 * The tour runs in order. To insert a new step at a particular point just
 * splice it into this array.
 */
const TOUR_STEPS = [
  {
    id: "welcome",
    title: "Welcome to Shelfsort 👋",
    body: [
      "This quick tour will walk you through Shelfsort's main hubs — library, friends, reading rooms, recommendations, appearance, and feedback — so you can find your way around.",
      "Hit Skip any time — you can replay this tour from the Help page later.",
    ],
    path: "/dashboard",
  },
  {
    id: "library",
    title: "Your library",
    body: [
      "Every EPUB you upload gets auto-categorised by fandom and pairing. Drag-drop files anywhere on the Library page or use the Upload button.",
      "Reading-time estimates and word counts ship for every book you upload — turn on the Library tile on your dashboard once you have a few.",
    ],
    path: "/library/all",
  },
  {
    id: "friends",
    title: "Friends & direct messages",
    body: [
      "Add friends by email or by searching for their username. Once accepted, click the Message button on any friend card to slide open an inline chat drawer — no nav away from the page.",
      "Friends can also share their library so you get personalised book recommendations.",
    ],
    path: "/friends",
  },
  {
    id: "bookclubs",
    title: "Reading rooms",
    body: [
      "Read a book together with friends, chapter by chapter. Pick a book from your library, invite friends, and discuss each chapter in its own thread — perfect for spoiler-safe book-club chats.",
      "Open the Lobby for general chatter; switch to a numbered chapter tab when you want to discuss specific scenes.",
    ],
    path: "/bookclubs",
  },
  {
    id: "recs",
    title: "From your friends",
    body: [
      "Once friends opt to share their library, you'll see ranked recommendations of books they've loved that you don't own yet — on the Dashboard and the dedicated Recommendations page.",
      "Every Sunday at 18:00 UTC you get an in-app rollup; add the email channel from /account/emails if you want one in your inbox too.",
    ],
    path: "/library/recommendations",
  },
  {
    id: "appearance",
    title: "Make it feel like home",
    body: [
      "Tap the Sun/Moon icon in the top navbar to open the appearance popover. From there you can flip light ↔ dark and pick from seven curated colour schemes (Peach, Purple, Forest, Ocean, Crimson, Charcoal, Custom).",
      "Want more? Account → Appearance gives you a full hex picker for Custom palettes, a live preview, and a scheduled auto-theme (e.g. dark from 19:00 to 07:00 local).",
    ],
    path: "/account/appearance",
  },
  {
    id: "account",
    title: "Other settings",
    body: [
      "Account → Emails covers every opt-in email channel (weekly digest, Year-in-Books, book-club digest) plus a per-kind mute matrix for in-app notifications. Account → Username lets you claim a public @handle so friends can find you without sharing your email.",
      "Reading speed lives under Appearance and tunes the time estimates everywhere — set it once and the whole library updates.",
    ],
    path: "/account",
  },
  {
    id: "feedback",
    title: "Suggestions & feedback",
    body: [
      "Found a bug, want a new fandom added, or have a feature idea? The Suggestions page is a 5-second feedback box — drop a one-liner and you'll get a notification when its status changes.",
      "There's also a quick Suggestion card right on the dashboard. Every idea is read.",
    ],
    path: "/suggestions",
  },
  {
    id: "done",
    title: "You're all set 🎉",
    body: [
      "Every feature has a section on the Help page (with a What's new strip showing the latest additions). Hit ? in the navbar any time.",
      "Happy reading.",
    ],
  },
];

export default TOUR_STEPS;
