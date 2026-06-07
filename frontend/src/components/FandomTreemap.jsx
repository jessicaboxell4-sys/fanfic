import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "../lib/api";
import { Loader2, PieChart } from "lucide-react";

// Palette tuned to read on both light and dark themes — peach for the
// largest shelves, sage/teal in the middle, dusty rose at the tail.
const COLOR_RAMP = [
  "#E07A5F", "#D87553", "#C46A4A", "#A85B40",
  "#3A5A40", "#4E7553", "#608C68", "#7AAE82",
  "#B68063", "#9A6D55", "#7D5B47", "#604937",
  "#967159", "#A8836A", "#BB957F", "#CCA796",
];

function pickColor(idx) {
  return COLOR_RAMP[idx % COLOR_RAMP.length];
}

/** Custom shape so we control the label rendering ourselves — recharts'
 *  default Treemap label clips to the cell and hides text on small cells.
 *  We only render the label when the cell has room.
 */
function TreemapCell(props) {
  const { x, y, width, height, name, count, index } = props;
  const fill = pickColor(index ?? 0);
  const showLabel = width > 64 && height > 36;
  const showCount = width > 96 && height > 54;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill, stroke: "rgba(0,0,0,0.18)", strokeWidth: 1, cursor: "default" }}
      />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 20}
          fill="#FFF8EE"
          fontSize={13}
          fontFamily="ui-sans-serif, system-ui"
          fontWeight={600}
        >
          {(name || "Unsorted").length > 26 ? (name || "Unsorted").slice(0, 25) + "…" : (name || "Unsorted")}
        </text>
      )}
      {showCount && (
        <text
          x={x + 8}
          y={y + 38}
          fill="rgba(255, 248, 238, 0.78)"
          fontSize={11}
          fontFamily="ui-sans-serif, system-ui"
        >
          {count} {count === 1 ? "book" : "books"}
        </text>
      )}
    </g>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white border border-[#E5DDC5] rounded-lg px-3 py-2 shadow-md text-sm">
      <div className="font-medium text-[#2C2C2C]">{item.name || "Unsorted"}</div>
      <div className="text-[#6B705C]">
        {item.count} book{item.count === 1 ? "" : "s"} · {item.pct.toFixed(1)}%
      </div>
    </div>
  );
}

export default function FandomTreemap() {
  const [loading, setLoading] = useState(true);
  const [fandoms, setFandoms] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get("/fandoms");
        if (cancelled) return;
        setFandoms(resp.data?.fandoms || []);
      } catch (e) { /* fandom widget is non-blocking */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build the treemap data. Tail fandoms (anything < 1% of the library AND
  // outside the top 20) get rolled into an "Other (N fandoms)" cell so the
  // chart stays legible — clicking through the Stats page is the right
  // place to see the full long-tail.
  const { rows, total, otherCount } = useMemo(() => {
    if (!fandoms || fandoms.length === 0) return { rows: [], total: 0, otherCount: 0 };
    const sorted = [...fandoms].sort((a, b) => b.count - a.count);
    const total = sorted.reduce((sum, f) => sum + (f.count || 0), 0) || 1;
    const head = [];
    const tail = [];
    sorted.forEach((f, idx) => {
      const pct = (f.count / total) * 100;
      if (idx < 20 && pct >= 1) head.push({ ...f, pct });
      else tail.push(f);
    });
    if (tail.length > 0) {
      const tailSum = tail.reduce((s, f) => s + (f.count || 0), 0);
      head.push({ name: `Other (${tail.length} fandoms)`, count: tailSum, pct: (tailSum / total) * 100 });
    }
    return { rows: head, total, otherCount: tail.length };
  }, [fandoms]);

  return (
    <div
      className="shelf-card p-6"
      data-testid="fandom-treemap-card"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">Library at a glance</h2>
            <p className="text-sm text-[#6B705C]">
              {total > 0
                ? <>Your library spans <strong>{fandoms.length}</strong> fandom{fandoms.length === 1 ? "" : "s"} across <strong>{total}</strong> book{total === 1 ? "" : "s"}.</>
                : "Upload a few books and your fandom distribution will appear here."}
            </p>
          </div>
        </div>
        {rows.length > 0 && (
          <Link
            to="/library/stats"
            data-testid="fandom-treemap-stats-link"
            className="text-sm text-[#E07A5F] hover:underline"
          >
            Full stats →
          </Link>
        )}
      </div>

      {loading ? (
        <div className="h-72 flex items-center justify-center text-[#6B705C]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-[#6B705C] italic text-sm">
          No fandom data yet — the treemap fills in as you upload books with detected fandoms.
        </div>
      ) : (
        <>
          <div
            className="h-72 rounded-lg overflow-hidden"
            data-testid="fandom-treemap-canvas"
          >
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={rows}
                dataKey="count"
                stroke="rgba(0,0,0,0.18)"
                content={<TreemapCell />}
                isAnimationActive={false}
              >
                <Tooltip content={<ChartTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          {otherCount > 0 && (
            <p className="text-xs text-[#6B705C] mt-2 italic">
              {otherCount} smaller fandom{otherCount === 1 ? "" : "s"} rolled into &quot;Other&quot; — see Stats for the full breakdown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
