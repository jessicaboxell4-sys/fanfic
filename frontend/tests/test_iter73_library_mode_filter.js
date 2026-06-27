/**
 * Iter 73 — Library-mode hard filter on AllBooksPage visibleBooks.
 *
 * Pure unit test of the filter semantics:
 *   • fanfic   → only category "Fanfiction" books visible
 *   • original → fanfic-category books dropped; everything else visible
 *   • mixed    → all books visible (section split is the visual divide)
 *
 * The actual filter lives inside AllBooksPage.jsx's `visibleBooks`
 * useMemo — this file mirrors the same predicate so we can lock
 * the behaviour with a fast Node-level test without spinning up
 * a full React render harness.  If the predicate ever changes,
 * update BOTH places.
 */

// Mirror the filter from AllBooksPage.jsx (line ~537).
function applyLibraryModeFilter(books, libraryMode) {
  const lm = libraryMode || "mixed";
  if (lm === "fanfic") {
    return books.filter((b) => (b.category || "").toLowerCase() === "fanfiction");
  }
  if (lm === "original") {
    return books.filter((b) => (b.category || "").toLowerCase() !== "fanfiction");
  }
  return books;
}

const corpus = [
  { id: 1, title: "HP fanfic",        category: "Fanfiction" },
  { id: 2, title: "MCU one-shot",     category: "Fanfiction" },
  { id: 3, title: "Crime debut",      category: "Original Fiction" },
  { id: 4, title: "Atomic Habits",    category: "Non-fiction" },
  { id: 5, title: "Mystery import",   category: "Unclassified" },
  { id: 6, title: "Custom shelf",     category: "Currently reading" },  // custom user category
  { id: 7, title: "Edge case empty",  category: "" },
  { id: 8, title: "Edge case null",   category: null },
  { id: 9, title: "Edge case CASING", category: "FANFICTION" },         // case-insensitive
];

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// --- Fanfic mode ---
const fanficMode = applyLibraryModeFilter(corpus, "fanfic");
const fanficIds = fanficMode.map((b) => b.id).sort((a, b) => a - b);
assert(
  JSON.stringify(fanficIds) === JSON.stringify([1, 2, 9]),
  `fanfic mode should keep only Fanfiction-category books; got ${JSON.stringify(fanficIds)}`,
);

// --- Original mode ---
const originalMode = applyLibraryModeFilter(corpus, "original");
const originalIds = originalMode.map((b) => b.id).sort((a, b) => a - b);
assert(
  JSON.stringify(originalIds) === JSON.stringify([3, 4, 5, 6, 7, 8]),
  `original mode should drop only Fanfiction-category books; got ${JSON.stringify(originalIds)}`,
);
// Critical regression assertion: NO fanfic-category book in original mode.
assert(
  originalMode.every((b) => (b.category || "").toLowerCase() !== "fanfiction"),
  "original mode must NEVER include a Fanfiction-category book",
);

// --- Mixed mode ---
const mixedMode = applyLibraryModeFilter(corpus, "mixed");
assert(mixedMode.length === corpus.length, "mixed mode should pass through all books");

// --- Default / undefined → mixed ---
const defaultMode = applyLibraryModeFilter(corpus, undefined);
assert(defaultMode.length === corpus.length, "undefined mode should behave like mixed");

// --- Empty library edge cases ---
assert(applyLibraryModeFilter([], "fanfic").length === 0, "fanfic + empty = empty");
assert(applyLibraryModeFilter([], "original").length === 0, "original + empty = empty");
assert(applyLibraryModeFilter([], "mixed").length === 0, "mixed + empty = empty");

console.log("PASS iter73 library-mode filter — 8 assertions OK");
