import { api } from "./api";

// LocalStorage key holding the set of goal_ids the user has already seen
// celebrated.  Without this, every page-load that GETs /goals (which
// lazily stamps hit_at) would re-fire confetti on the same achievements.
const STORAGE_KEY = "shelfsort_goals_celebrated";

const EVENT = "shelfsort:goal-hit";

function readSeen() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(set) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch { /* ignore quota / disabled storage */ }
}

// Public API: poll /api/goals once, detect newly-hit goals the user
// hasn't seen celebrated yet, and dispatch a window event for the
// GlobalConfettiHost to pick up.
//
// Returns an array of newly-hit goals so callers can also surface a
// toast or analytics ping if they want.
export async function pulseGoalsCheck() {
  try {
    const { data } = await api.get("/goals");
    const goals = data?.goals || [];
    const seen = readSeen();
    const fresh = goals.filter((g) => g.hit_at && !seen.has(g.goal_id));
    if (fresh.length > 0) {
      fresh.forEach((g) => seen.add(g.goal_id));
      writeSeen(seen);
      // Send one event per hit so the host can stack labels if multiple
      // goals flip simultaneously (rare, but possible when the user
      // bulk-marks finished).
      fresh.forEach((g) => {
        window.dispatchEvent(new CustomEvent(EVENT, { detail: g }));
      });
    }
    return fresh;
  } catch {
    return [];
  }
}

// Reset helper for tests / manual replay from the Goals page.
export function clearCelebratedGoals() {
  try { window.localStorage.removeItem(STORAGE_KEY); }
  catch { /* ignore */ }
}

export const GOAL_HIT_EVENT = EVENT;
