# "What's next?" — Standard Response Format

When the user asks **"what's next?"** or **"what's next again?"** (or any
close paraphrase: "what now", "what should we do next", etc.), respond
in **exactly this structure and order**. Locked-in by the user on
2026-06-27.

---

## Section 1 — ASAP? (always first, always honest)

Open with a single line: **"ASAP? Honestly — just one thing"** (or
"nothing" or "two things" — be honest about the count).

Then a single 🟡 bullet calling out the most time-sensitive item.
Include WHY it's urgent (concrete evidence: log sizes, failure counts,
auth/billing issues — never vibes).

Follow with a short bulleted list under **"Everything else can wait:"**
explaining what looks scary but isn't (warnings, background jobs, etc.).
This is the "nothing's on fire" reassurance section.

Rule: if there is GENUINELY nothing ASAP, say so plainly and don't
manufacture urgency.

---

## Section 2 — What's next — my pick (recommendations)

Open with one line of context (e.g., "Given you just shipped X, the
highest-ROI next session is..." or "Backlog priorities right now:").

Present a **lettered list (a, b, c, d, e)** with these conventions:
  - 🟢 = quick win, low risk, ≤30 min each
  - 🟡 = medium, more visible, more risk
  - 🔵 = big and risky / refactor / fresh-context job
  - Each entry: **Bold task name** (~time estimate) — one-sentence
    description ending with the user-facing benefit (not the
    implementation detail)

If multiple quick wins compose into a natural mini-bundle (~40-60 min
total), surface that as a labeled bundle ("a + b + c") with a single
combined rationale.

End the section with **"My pick: <option>."** followed by a single line
of justification grounded in: builds on recent work / customer-facing /
testable / unblocks another roadmap item.

---

## Section 3 — Close

Single short line: **"Want me to start it?"** or **"Or do you have
something else in mind?"** — invite confirmation, don't assume.

---

## Tone rules

- No emojis as decoration — only the 🟢🟡🔵🛑✨🐛 status icons defined
  above
- No marketing language ("supercharge", "unlock", "amazing")
- Cite evidence over vibes (log sizes, test counts, file LOC)
- If a previously-roadmapped task was secretly already shipped, flag
  it and skip it — don't pretend it's still open
- Keep ASAP section honest. Crying wolf erodes the user's trust in
  this format.
