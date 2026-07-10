import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "../lib/api";
import { Loader2, PieChart, Layers, List as ListIcon } from "lucide-react";

// Palette tuned to read on both light and dark themes — peach for the
// largest shelves, sage/teal in the middle, dusty rose at the tail.
const COLOR_RAMP = [
  "#E07A5F", "#D87553", "#C46A4A", "#A85B40",
  "#6B46C1", "#4E7553", "#608C68", "#7AAE82",
  "#B68063", "#9A6D55", "#7D5B47", "#604937",
  "#967159", "#A8836A", "#BB957F", "#CCA796",
];

function pickColor(idx) {
  return COLOR_RAMP[idx % COLOR_RAMP.length];
}

/** Custom shape so we control the label rendering ourselves. We only
 *  render the label when the cell has room. For grouped (parent) cells
 *  recharts also calls this for each child rectangle, so the same logic
 *  applies — small children stay clean. */
function TreemapCell(props) {
  const { x, y, width, height, name, count, depth, index } = props;
  const fill = pickColor(index ?? 0);
  const showLabel = width > 64 && height > 36;
  const showCount = width > 96 && height > 54;
  // Children render with a slightly translucent stroke so parent borders
  // visually contain them.
  const strokeOpacity = depth === 1 ? 0.18 : 0.32;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill, stroke: `rgba(0,0,0,${strokeOpacity})`, strokeWidth: 1, cursor: "default" }}
      />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 20}
          fill="#FFF8EE"
          fontSize={depth === 1 ? 13 : 12}
          fontFamily="ui-sans-serif, system-ui"
          fontWeight={depth === 1 ? 600 : 500}
        >
          {(name || "Unsorted").length > 26 ? (name || "Unsorted").slice(0, 25) + "…" : (name || "Unsorted")}
        </text>
      )}
      {showCount && count != null && (
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
      <div className="text-[#5B5F4D]">
        {item.count != null && <>{item.count} book{item.count === 1 ? "" : "s"} · </>}
        {item.pct != null ? item.pct.toFixed(1) + "%" : ""}
      </div>
      {item.children && (
        <div className="text-xs text-[#5B5F4D] mt-1">{item.children.length} sub-fandom{item.children.length === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

export default function FandomTreemap() {
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState(true);
  const [flat, setFlat] = useState([]);          // raw [{name, count}]
  const [groupedRows, setGroupedRows] = useState([]);  // [{name, count, children?}]
  const [franchiseCount, setFranchiseCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flatResp, grpResp] = await Promise.all([
          api.get("/fandoms"),
          api.get("/fandoms/grouped"),
        ]);
        if (cancelled) return;
        setFlat(flatResp.data?.fandoms || []);
        setGroupedRows(grpResp.data?.fandoms || []);
        setFranchiseCount(grpResp.data?.franchise_count || 0);
      } catch (e) { /* non-blocking widget */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Flat-view: cap at top 20 + "Other (N fandoms)" tail rollup.
  const flatRows = useMemo(() => {
    if (!flat || flat.length === 0) return { rows: [], total: 0, otherCount: 0 };
    const sorted = [...flat].sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, f) => s + (f.count || 0), 0) || 1;
    const head = [], tail = [];
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
  }, [flat]);

  // Grouped-view: feed the API rows straight through. Add `pct` for tooltips.
  const groupedView = useMemo(() => {
    if (!groupedRows || groupedRows.length === 0) return { rows: [], total: 0 };
    const total = groupedRows.reduce((s, r) => s + (r.count || 0), 0) || 1;
    const rows = groupedRows.map((r) => ({
      ...r,
      pct: (r.count / total) * 100,
      children: r.children
        ? r.children.map((c) => ({ ...c, pct: (c.count / total) * 100 }))
        : undefined,
    }));
    return { rows, total };
  }, [groupedRows]);

  const activeRows = grouped ? groupedView.rows : flatRows.rows;
  const total = grouped ? groupedView.total : flatRows.total;

  return (
    <div className="shelf-card p-6" data-testid="fandom-treemap-card">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">Library at a glance</h2>
            <p className="text-sm text-[#5B5F4D]">
              {total > 0
                ? <>Your library spans <strong>{flat.length}</strong> fandom{flat.length === 1 ? "" : "s"} across <strong>{total}</strong> book{total === 1 ? "" : "s"}{grouped && franchiseCount > 0 ? <>, grouped into <strong>{franchiseCount}</strong> franchise{franchiseCount === 1 ? "" : "s"}</> : null}.</>
                : "Upload a few books and your fandom distribution will appear here."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {flat.length > 0 && (
            <div className="inline-flex rounded-lg border border-[#E5DDC5] overflow-hidden text-sm" role="radiogroup" aria-label="Treemap grouping">
              <button
                onClick={() => setGrouped(true)}
                data-testid="treemap-mode-grouped"
                aria-pressed={grouped}
                className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${grouped ? "bg-[#E07A5F] text-white" : "bg-white text-[#5B5F4D] hover:bg-[#F5F3EC]"}`}
                title="Roll up sub-fandoms by franchise"
              >
                <Layers className="w-3.5 h-3.5" /> Franchises
              </button>
              <button
                onClick={() => setGrouped(false)}
                data-testid="treemap-mode-flat"
                aria-pressed={!grouped}
                className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${!grouped ? "bg-[#E07A5F] text-white" : "bg-white text-[#5B5F4D] hover:bg-[#F5F3EC]"}`}
                title="Show every fandom separately"
              >
                <ListIcon className="w-3.5 h-3.5" /> All fandoms
              </button>
            </div>
          )}
          {activeRows.length > 0 && (
            <Link
              to="/library/stats"
              data-testid="fandom-treemap-stats-link"
              className="text-sm text-[#E07A5F] hover:underline"
            >
              Full stats →
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-72 flex items-center justify-center text-[#5B5F4D]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : activeRows.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-[#5B5F4D] italic text-sm">
          No fandom data yet — the treemap fills in as you upload books with detected fandoms.
        </div>
      ) : (
        <>
          <div className="h-72 rounded-lg overflow-hidden" data-testid="fandom-treemap-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={activeRows}
                dataKey="count"
                stroke="rgba(0,0,0,0.18)"
                content={<TreemapCell />}
                isAnimationActive={false}
              >
                <Tooltip content={<ChartTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          {!grouped && flatRows.otherCount > 0 && (
            <p className="text-xs text-[#5B5F4D] mt-2 italic">
              {flatRows.otherCount} smaller fandom{flatRows.otherCount === 1 ? "" : "s"} rolled into &quot;Other&quot; — see Stats for the full breakdown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
