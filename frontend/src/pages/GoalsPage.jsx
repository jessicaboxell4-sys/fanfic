import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Plus, Target, Trash2, Edit3, BookOpen,
  CalendarDays, Sparkles, X as XIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";

/* ---------------------------------------------------------------- *
 * Reading-goals page.
 *
 * Lets the user set per-period reading targets (books / words / pages)
 * for any year or month and tracks live progress against the existing
 * "books with progress_percent >= 0.99 within the period" heuristic.
 * Multi-year history visible, retroactive goal creation supported.
 *
 * Goal-hit moments: a one-time in-app notification fires on the server,
 * and the first time the user opens this page after the hit, a confetti
 * animation plays + a toast offers the Year-in-Books link.  Marking the
 * celebration as seen calls POST /goals/:id/celebrate so it doesn't
 * replay on every visit.
 * ---------------------------------------------------------------- */

const METRIC_OPTIONS = [
  { value: "books", label: "Books finished", unitSingular: "book", unitPlural: "books" },
  { value: "pages", label: "Pages read",     unitSingular: "page", unitPlural: "pages" },
  { value: "words", label: "Words read",     unitSingular: "word", unitPlural: "words" },
];
const PERIOD_OPTIONS = [
  { value: "year",  label: "Yearly"  },
  { value: "month", label: "Monthly" },
];
const NOW = new Date();
const CURRENT_YEAR = NOW.getUTCFullYear();
const CURRENT_MONTH = NOW.getUTCMonth() + 1;  // 1-12
const PERIOD_VALUE_DEFAULTS = {
  year:  String(CURRENT_YEAR),
  month: `${CURRENT_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}`,
};

function metricUnit(metric, n) {
  const m = METRIC_OPTIONS.find((x) => x.value === metric);
  if (!m) return "";
  return n === 1 ? m.unitSingular : m.unitPlural;
}

function formatNumber(n) {
  return new Intl.NumberFormat().format(n);
}

/* ---------- SVG progress ring ---------- */

function ProgressRing({ fraction, hit, size = 140, stroke = 12 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.min(1, Math.max(0, fraction)));
  const trackColor = "#E5DDC5";
  const fillColor = hit ? "#1F8F4E" : "#6B46C1";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="progress" className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={fillColor} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 800ms cubic-bezier(.2,.7,.3,1), stroke 400ms" }}
      />
    </svg>
  );
}

/* ---------- CSS-only confetti burst ---------- */

function Confetti({ active }) {
  // Random positions live in state so React's hook-purity linter is happy
  // and the same burst doesn't reshuffle on every re-render. We reseed each
  // time `active` flips on.
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    if (!active) {
      setPieces([]);
      return;
    }
    const COUNT = 90;
    const COLORS = ["#6B46C1", "#E07A5F", "#F2CC8F", "#81B29A", "#3D405B", "#FDF3E1"];
    const seeded = Array.from({ length: COUNT }).map((_, i) => ({
      key: `${Date.now()}-${i}`,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      dur: 2 + Math.random() * 2,
      rot: Math.floor(Math.random() * 360),
      color: COLORS[i % COLORS.length],
      horiz: (Math.random() - 0.5) * 200,
    }));
    setPieces(seeded);
  }, [active]);

  if (!active || pieces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" data-testid="confetti">
      {pieces.map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
            transform: `rotate(${p.rot}deg)`,
            "--drift": `${p.horiz}px`,
          }}
        />
      ))}
      <style>{`
        .confetti-piece {
          position: absolute;
          top: -6%;
          width: 8px;
          height: 14px;
          opacity: 0.95;
          border-radius: 1px;
          animation-name: confetti-fall;
          animation-timing-function: cubic-bezier(.45,.05,.55,.95);
          animation-fill-mode: forwards;
        }
        @keyframes confetti-fall {
          0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); }
          100% { transform: translate3d(var(--drift, 0px), 110vh, 0) rotate(720deg); }
        }
      `}</style>
    </div>
  );
}

/* ---------- Create / edit dialog ---------- */

function GoalDialog({ initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [metric, setMetric] = useState(initial?.metric || "books");
  const [periodType, setPeriodType] = useState(initial?.period_type || "year");
  const [periodValue, setPeriodValue] = useState(initial?.period_value || PERIOD_VALUE_DEFAULTS.year);
  const [target, setTarget] = useState(initial?.target || (initial?.metric === "words" ? 100000 : 24));
  const [saving, setSaving] = useState(false);

  // When period type changes, pre-fill a sensible value.
  const onPeriodTypeChange = (v) => {
    setPeriodType(v);
    if (!isEdit) setPeriodValue(PERIOD_VALUE_DEFAULTS[v]);
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        const { data } = await api.patch(`/goals/${initial.goal_id}`, { target: parseInt(target, 10) });
        toast.success("Goal updated");
        onSaved?.(data);
      } else {
        const { data } = await api.post("/goals", {
          metric, period_type: periodType, period_value: periodValue,
          target: parseInt(target, 10),
        });
        toast.success("Goal set");
        onSaved?.(data);
      }
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save goal");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" data-testid="goal-dialog">
      <div className="bg-[#FDFBF7] rounded-2xl max-w-md w-full p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl text-[#2C2C2C]">{isEdit ? "Edit goal" : "New reading goal"}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#F5F3EC] rounded" data-testid="goal-dialog-close">
            <XIcon className="w-4 h-4 text-[#6B705C]" />
          </button>
        </div>

        {!isEdit && (
          <>
            <div>
              <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Metric</label>
              <select
                data-testid="goal-metric-select"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
              >
                {METRIC_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Cadence</label>
              <select
                data-testid="goal-period-type-select"
                value={periodType}
                onChange={(e) => onPeriodTypeChange(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
              >
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">
                {periodType === "year" ? "Year (YYYY)" : "Month (YYYY-MM)"}
              </label>
              <input
                data-testid="goal-period-value-input"
                value={periodValue}
                onChange={(e) => setPeriodValue(e.target.value)}
                placeholder={periodType === "year" ? "2026" : "2026-03"}
                className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
              />
            </div>
          </>
        )}

        <div>
          <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">
            Target {metric === "books" ? "books" : metric === "pages" ? "pages" : "words"}
          </label>
          <input
            type="number"
            data-testid="goal-target-input"
            min={1}
            max={10000000}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn-primary text-sm flex items-center gap-2" data-testid="goal-dialog-save">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
            {isEdit ? "Save" : "Set goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Goal card ---------- */

function GoalCard({ goal, onEdit, onDelete }) {
  const hit = !!goal.hit_at;
  const pctText = `${Math.round((goal.fraction || 0) * 100)}%`;
  return (
    <div
      data-testid={`goal-card-${goal.goal_id}`}
      className={`shelf-card p-5 flex items-center gap-5 ${hit ? "ring-2 ring-[#1F8F4E]/30" : ""}`}
    >
      <div className="flex-shrink-0 relative">
        <ProgressRing fraction={goal.fraction || 0} hit={hit} />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className={`font-serif text-2xl leading-none ${hit ? "text-[#1F8F4E]" : "text-[#2C2C2C]"}`}>{pctText}</p>
          <p className="text-[10px] uppercase tracking-wider text-[#6B705C] mt-1">{hit ? "Hit!" : "of goal"}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B46C1] flex items-center gap-1">
          {goal.period_type === "year" ? <CalendarDays className="w-3 h-3" /> : <CalendarDays className="w-3 h-3" />}
          {goal.period_label}
        </p>
        <h3 className="font-serif text-2xl text-[#2C2C2C] truncate" data-testid={`goal-target-${goal.goal_id}`}>
          {formatNumber(goal.target)} {metricUnit(goal.metric, goal.target)}
        </h3>
        <p className="text-sm text-[#6B705C] mt-1" data-testid={`goal-progress-${goal.goal_id}`}>
          <span className="font-semibold text-[#2C2C2C]">{formatNumber(goal.current)}</span> {metricUnit(goal.metric, goal.current)} so far
          {hit ? " — you did it." : ` · ${formatNumber(Math.max(0, goal.target - goal.current))} to go`}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            data-testid={`goal-edit-${goal.goal_id}`}
            onClick={() => onEdit(goal)}
            className="btn-secondary text-xs flex items-center gap-1"
          >
            <Edit3 className="w-3 h-3" /> Edit target
          </button>
          <button
            data-testid={`goal-delete-${goal.goal_id}`}
            onClick={() => onDelete(goal)}
            className="text-xs text-[#6B705C] hover:text-[#B43F26] inline-flex items-center gap-1 px-2 py-1"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main page ---------- */

export default function GoalsPage() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const [activeYearTab, setActiveYearTab] = useState(String(CURRENT_YEAR));

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/goals");
      const list = data?.goals || [];
      setGoals(list);

      // Look for any newly-hit goal we haven't celebrated yet.
      const fresh = list.find((g) => g.hit_at && !g.hit_celebrated_at);
      if (fresh) {
        setConfettiActive(true);
        const isYear = fresh.period_type === "year";
        toast.success(
          `You hit your ${fresh.period_label} goal of ${formatNumber(fresh.target)} ${metricUnit(fresh.metric, fresh.target)}! 🎉`,
          isYear ? {
            action: { label: "Year in Books →", onClick: () => window.location.assign("/year-in-books") },
            duration: 8000,
          } : { duration: 6000 },
        );
        try {
          await api.post(`/goals/${fresh.goal_id}/celebrate`);
        } catch { /* non-blocking */ }
        // Auto-stop the confetti after 4s.
        setTimeout(() => setConfettiActive(false), 4000);
      }
    } catch {
      toast.error("Couldn't load goals");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Year tabs: every year that has at least one goal, ordered desc, plus the current year.
  const years = useMemo(() => {
    const set = new Set([String(CURRENT_YEAR)]);
    goals.forEach((g) => {
      if (g.period_type === "year") set.add(g.period_value);
      else if (g.period_value?.length >= 4) set.add(g.period_value.slice(0, 4));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [goals]);

  // Goals filtered to the active year tab.
  const tabGoals = useMemo(() => goals.filter((g) => {
    if (g.period_type === "year") return g.period_value === activeYearTab;
    return g.period_value?.startsWith(activeYearTab);
  }), [goals, activeYearTab]);

  const deleteGoal = async (g) => {
    if (!window.confirm(`Delete the ${g.period_label} goal?`)) return;
    try {
      await api.delete(`/goals/${g.goal_id}`);
      toast.success("Goal removed");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    }
  };

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (g) => { setEditing(g); setDialogOpen(true); };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <Confetti active={confettiActive} />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8" data-testid="goals-page">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
              <Target className="h-5 w-5 text-[var(--primary)]" />
            </div>
            <div>
              <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C]">Reading goals</h1>
              <p className="text-sm text-[#6B705C]">
                Set yearly or monthly targets — books, pages, or word count. Progress counts any book you finished (clicked &quot;Mark read&quot; or hit 100%) within the period.
              </p>
            </div>
          </div>
          <button
            data-testid="new-goal-btn"
            onClick={openCreate}
            className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New goal
          </button>
        </div>

        {/* Year tabs */}
        <div className="flex flex-wrap gap-1.5 mb-5" data-testid="goals-year-tabs">
          {years.map((y) => (
            <button
              key={y}
              data-testid={`goals-year-tab-${y}`}
              onClick={() => setActiveYearTab(y)}
              className={`text-sm px-3 py-1 rounded-full border transition ${
                y === activeYearTab
                  ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                  : "bg-white text-[#6B705C] border-[#E5DDC5] hover:border-[#6B46C1]"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-[#6B705C] text-sm flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading goals…</div>
        ) : tabGoals.length === 0 ? (
          <section className="shelf-card p-10 text-center" data-testid="goals-empty-state">
            <BookOpen className="w-12 h-12 text-[#E5DDC5] mx-auto mb-2" />
            <p className="font-serif text-xl text-[#2C2C2C] mb-1">No goals for {activeYearTab} yet</p>
            <p className="text-sm text-[#6B705C] mb-4">
              Pick a target you can casually hit, or a stretch one — past years are fair game for backfill bragging rights.
            </p>
            <button
              data-testid="goals-empty-create-btn"
              onClick={openCreate}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> Set your first goal
            </button>
          </section>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4" data-testid="goals-grid">
            {tabGoals.map((g) => (
              <GoalCard
                key={g.goal_id}
                goal={g}
                onEdit={openEdit}
                onDelete={deleteGoal}
              />
            ))}
          </div>
        )}

        {dialogOpen && (
          <GoalDialog
            initial={editing}
            onClose={() => setDialogOpen(false)}
            onSaved={() => load()}
          />
        )}
      </main>
    </div>
  );
}
