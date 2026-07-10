// uploadChime.js — opt-in audio ping fired when the last in-flight
// upload job finishes.  Off by default; toggled from Account →
// Notifications.  Stored in localStorage so it's per-device (no
// backend round-trip on every toggle).
//
// Rationale: a few power users who batch-upload large folders asked
// for an audible cue so they can tab away and come back when the
// shelf is sorted.  Implemented via WebAudio (no asset to host, no
// MIME wrangling, ~120 bytes of code).

const KEY = "shelfsort.uploadChimeEnabled";

export function isUploadChimeEnabled() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setUploadChimeEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch { /* ignore */ }
}

// Tiny two-note chime — pleasant, short, can't be confused with a
// system alert.  Uses the WebAudio API directly; no asset hosting,
// no autoplay headaches (it's gated by user interaction at the
// page-level since they had to enable it).
export function playUploadChime() {
  if (!isUploadChimeEnabled()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    };
    // C5 → E5 — light, "task done" feel.
    playTone(523.25, 0, 0.18);
    playTone(659.25, 0.16, 0.22);
    // Close the context once the last tone finishes so we don't leak.
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 600);
  } catch { /* WebAudio unavailable — silent fallback */ }
}
