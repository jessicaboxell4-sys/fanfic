import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X as XIcon, ArrowLeft, ArrowRight, Check } from "lucide-react";
import TOUR_STEPS from "../lib/tourSteps";

const STORAGE_KEY = "shelfsort_tour_seen";
const STEP_STORAGE_KEY = "shelfsort_tour_step";

export function hasSeenTour() {
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; }
  catch (e) { return false; }
}
export function markTourSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
    window.localStorage.removeItem(STEP_STORAGE_KEY);
  }
  catch (e) { /* ignore */ }
}
export function clearTourSeen() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STEP_STORAGE_KEY);
  }
  catch (e) { /* ignore */ }
}

// 2026-06-30 — Tour progress persistence.  In response to user
// report: "intro tour keeps crashing out on page of 6/9 ... refresh
// starts back at the beginning."  The crash itself is now handled
// by AppErrorBoundary; this hook stops a refresh / accidental nav
// from resetting the user's progress.  Stored as a small integer
// in localStorage; cleared when the tour completes or is dismissed.
function loadSavedStep() {
  try {
    const raw = window.localStorage.getItem(STEP_STORAGE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    // Clamp to a sane upper bound — the tour file is the source of truth.
    return n;
  } catch (e) { return 0; }
}
function saveStep(n) {
  try { window.localStorage.setItem(STEP_STORAGE_KEY, String(n)); }
  catch (e) { /* ignore */ }
}

/**
 * First-time tour overlay. Render this near the App root; it self-controls
 * via `open` prop. Closes by setting localStorage so it doesn't re-fire.
 *
 * To replay, call clearTourSeen() and then open it again.
 */
export default function TourOverlay({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Seed from the saved step so a refresh mid-tour resumes where the
  // user was, instead of resetting to step 0.  Clamp against the
  // current TOUR_STEPS length in case a deployment removed a step
  // (otherwise we'd render undefined and crash).
  const [idx, setIdx] = useState(() => {
    const saved = loadSavedStep();
    return Math.min(saved, TOUR_STEPS.length - 1);
  });
  const step = TOUR_STEPS[idx];
  const isLast = idx === TOUR_STEPS.length - 1;

  // Persist every step change so a refresh resumes mid-tour.
  useEffect(() => { saveStep(idx); }, [idx]);

  // Navigate to the step's path if it differs from where the user is.
  useEffect(() => {
    if (!open || !step?.path) return;
    if (location.pathname !== step.path) navigate(step.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx]);

  if (!open || !step) return null;

  const close = () => {
    markTourSeen();
    setIdx(0);
    onClose?.();
  };
  const next = () => { if (isLast) close(); else setIdx((i) => i + 1); };
  const back = () => { if (idx > 0) setIdx((i) => i - 1); };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/30" data-testid="tour-overlay">
      <div
        className="bg-white border border-[#E8E6E1] rounded-2xl max-w-md w-full p-6 shadow-2xl"
        data-testid={`tour-step-${step.id}`}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B46C1]">
            Tour · {idx + 1} / {TOUR_STEPS.length}
          </p>
          <button
            data-testid="tour-skip"
            onClick={close}
            className="p-1 hover:bg-[#F5F3EC] rounded text-[#5B5F4D]"
            title="Skip"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <h3 className="font-serif text-2xl text-[#2C2C2C] mb-3">{step.title}</h3>
        {Array.isArray(step.body) ? (
          step.body.map((p, i) => (
            <p key={i} className="text-sm text-[#2C2C2C] mb-2 leading-relaxed">{p}</p>
          ))
        ) : (
          <p className="text-sm text-[#2C2C2C] leading-relaxed">{step.body}</p>
        )}

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 mt-5 mb-4" data-testid="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-1.5 h-1.5 rounded-full transition ${
                i === idx ? "bg-[#6B46C1] w-4" : "bg-[#E5DDC5] hover:bg-[#6B46C1]/40"
              }`}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={back}
            disabled={idx === 0}
            data-testid="tour-back"
            className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
          <button
            onClick={next}
            data-testid="tour-next"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#553B96] transition-colors"
          >
            {isLast ? (<>Got it <Check className="w-3 h-3" /></>) : (<>Next <ArrowRight className="w-3 h-3" /></>)}
          </button>
        </div>
      </div>
    </div>
  );
}
