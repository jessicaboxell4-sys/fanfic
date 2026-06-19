import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Check,
  AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * Library safety report — user-facing transparency surface.
 *
 * Shows the calling user how many of their own books are
 * clean / infected / unscanned, plus a "Rescan my library" button
 * that re-runs ClamAV across every cached file they own.  The admin
 * antivirus card (in AdminConsole) is the cross-user version of this
 * — this surface is intentionally limited to the caller's own data.
 */
export default function AccountSafety() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/account/safety");
      setReport(data);
    } catch {
      toast.error("Couldn't load your safety report");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      const { data } = await api.post("/account/safety/rescan");
      toast.success(
        data.flagged > 0
          ? `Scan complete — ${data.flagged} file(s) flagged.`
          : `Scan complete — ${data.scanned} file(s), all clean.`
      );
      await load();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || "Couldn't rescan right now — try again in a minute."
      );
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper" data-testid="account-safety-page">
      <header className="border-b border-[#E8E6E1]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            to="/account"
            className="text-[#6B705C] hover:text-[#E07A5F] inline-flex items-center gap-1.5 text-sm font-semibold"
            data-testid="safety-back-account"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to account
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
          Library safety
        </p>
        <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">
          Your library, scanned.
        </h1>
        <p className="text-[#6B705C] mb-10 max-w-prose">
          Every file you upload to Shelfsort is scanned by ClamAV before it
          lands in your library, and rescanned automatically when you download
          it.  This page shows you the result for your own books — no other
          user&apos;s data is visible here.
        </p>

        {loading || !report ? (
          <p
            className="text-sm text-[#6B705C] inline-flex items-center gap-2"
            data-testid="safety-loading"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading your report…
          </p>
        ) : (
          <>
            {/* Stat triple */}
            <div className="grid sm:grid-cols-3 gap-3 mb-8">
              <SafetyStat
                icon={Check}
                label="Clean"
                value={report.clean}
                total={report.total}
                color="green"
                testid="safety-stat-clean"
              />
              <SafetyStat
                icon={ShieldAlert}
                label="Flagged"
                value={report.infected}
                total={report.total}
                color="red"
                testid="safety-stat-infected"
              />
              <SafetyStat
                icon={ShieldCheck}
                label="Awaiting first scan"
                value={report.unscanned}
                total={report.total}
                color="grey"
                testid="safety-stat-unscanned"
              />
            </div>

            {/* Scanner availability banner */}
            {!report.av_available && (
              <div
                className="rounded-xl border border-[#B43F26] bg-[#FDECE6] p-4 mb-6 inline-flex items-start gap-3"
                data-testid="safety-av-down"
              >
                <AlertTriangle className="w-5 h-5 text-[#B43F26] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[#2C2C2C]">
                    Antivirus is temporarily unavailable.
                  </p>
                  <p className="text-sm text-[#6B705C] mt-1">
                    New uploads still work but are queued for scanning.  Check
                    back in a few minutes.
                  </p>
                </div>
              </div>
            )}

            {/* Recent flags */}
            {report.recent_infected && report.recent_infected.length > 0 && (
              <div className="mb-8" data-testid="safety-recent-infected">
                <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] font-bold mb-2">
                  Recent flags
                </p>
                <ul className="space-y-2">
                  {report.recent_infected.map((r, idx) => (
                    <li
                      key={`${r.ts}-${idx}`}
                      className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
                      data-testid={`safety-flag-row-${idx}`}
                    >
                      <p className="text-sm font-medium text-[#2C2C2C] truncate">
                        {r.filename}
                      </p>
                      <p className="text-xs text-[#B43F26] font-mono mt-0.5">
                        {r.signature || "(no signature)"}
                      </p>
                      <p className="text-xs text-[#6B705C] mt-1">
                        Scanned {fmtTime(r.ts)} · source: {r.source}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Rescan CTA */}
            <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-5">
              <p className="font-medium text-[#2C2C2C] mb-1">Rescan my library</p>
              <p className="text-sm text-[#6B705C] mb-4">
                Re-run ClamAV across every file in your library with today&apos;s
                latest signatures.  Useful if a new threat was published or
                you just want fresh peace of mind.  Limited to your 500 most
                recent files per rescan.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={rescan}
                  disabled={rescanning || !report.av_available}
                  data-testid="safety-rescan-btn"
                  className="btn-primary px-5 py-2.5 inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {rescanning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {rescanning ? "Scanning…" : "Rescan now"}
                </button>
                {report.last_rescan_at && (
                  <span className="text-xs text-[#6B705C]" data-testid="safety-last-rescan">
                    Last rescan {fmtTime(report.last_rescan_at)}
                    {report.last_rescan_summary && (
                      <>
                        {" "}· {report.last_rescan_summary.scanned} scanned,{" "}
                        {report.last_rescan_summary.flagged} flagged
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SafetyStat({ icon: Icon, label, value, total, color, testid }) {
  const palette = {
    green: { bg: "#E8F3EC", border: "#2C7A3E", text: "#2C7A3E", muted: "#3F4034" },
    red:   { bg: "#FDECE6", border: "#B43F26", text: "#B43F26", muted: "#3F4034" },
    grey:  { bg: "#FBFAF6", border: "#E5DDC5", text: "#6B705C", muted: "#3F4034" },
  }[color] || { bg: "#FBFAF6", border: "#E5DDC5", text: "#6B705C", muted: "#3F4034" };
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: palette.bg, borderColor: palette.border }}
      data-testid={testid}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: palette.text }} />
        <p className="text-xs uppercase tracking-[0.15em] font-bold" style={{ color: palette.text }}>
          {label}
        </p>
      </div>
      <p className="font-serif text-3xl text-[#2C2C2C]">{value}</p>
      <p className="text-xs mt-0.5" style={{ color: palette.muted }}>
        {total > 0 ? `${pct}% of your ${total} book${total === 1 ? "" : "s"}` : "no books yet"}
      </p>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day:   "numeric",
      year:  "numeric",
      hour:  "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
