import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

function timeBetween(start, finish) {
  if (!start || !finish) return null;
  try {
    const ms = new Date(finish).getTime() - new Date(start).getTime();
    if (ms < 1000) return "<1s";
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  } catch {
    return null;
  }
}

function relativeAgo(iso) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
    return `${Math.round(ms / 3600000)}h ago`;
  } catch {
    return "";
  }
}

const STATUS_BADGES = {
  processing: { label: "Converting", color: "bg-amber-100 text-amber-800 border-amber-200", Icon: Loader2, spinning: true },
  done: { label: "Done", color: "bg-green-100 text-green-800 border-green-200", Icon: CheckCircle2 },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 border-red-200", Icon: AlertTriangle },
};

export default function Conversions() {
  const [data, setData] = useState({ converting: 0, recent_done: 0, recent_failed: 0, visibility_hours: 4, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/conversions/status");
      setData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll while any job is in flight
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const retry = async (jobId) => {
    setRetrying((s) => ({ ...s, [jobId]: true }));
    try {
      const { data: r } = await api.post(`/conversions/${jobId}/retry`);
      if (r.ok) {
        toast.success(r.warning ? `Converted with warnings: ${r.warning}` : `Converted successfully — now on "${r.category}"`);
      } else {
        toast.error(`Still failing: ${r.error || "unknown error"}`);
      }
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Retry failed");
    } finally {
      setRetrying((s) => ({ ...s, [jobId]: false }));
    }
  };

  const dismissAll = async () => {
    try {
      await api.post("/conversions/dismiss");
      load();
    } catch (e) {
      toast.error("Couldn't clear");
    }
  };

  const showEmpty = !loading && data.jobs.length === 0;

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-start gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Conversions</h1>
            <p className="text-[#6B705C] mt-1">
              Calibre-powered uploads from the last {data.visibility_hours} hours. Retry any that didn't make it through.
            </p>
          </div>
          {(data.recent_done + data.recent_failed) > 0 && (
            <button
              data-testid="dismiss-all-btn"
              onClick={dismissAll}
              className="px-3 py-1.5 rounded text-xs font-medium bg-white border border-[#6B705C]/30 text-[#6B705C] hover:bg-[#6B705C]/10 inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear history
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="w-8 h-8 text-amber-700 animate-spin mx-auto" />
          </div>
        ) : showEmpty ? (
          <div data-testid="conversions-empty" className="shelf-card p-10 text-center">
            <Sparkles className="w-10 h-10 text-amber-300 mx-auto mb-4" />
            <p className="font-serif text-2xl text-[#2C2C2C]">Nothing to show</p>
            <p className="text-sm text-[#6B705C] mt-2">Upload a PDF, MOBI, or DOCX and you'll see its conversion progress here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.converting > 0 && (
              <div className="shelf-card p-3 flex items-center gap-3 bg-amber-50 border-amber-200">
                <Loader2 className="w-4 h-4 text-amber-700 animate-spin" />
                <p className="text-sm text-[#2C2C2C]">
                  {data.converting} conversion{data.converting === 1 ? "" : "s"} in progress · refreshing every 3s
                </p>
              </div>
            )}
            {data.jobs.map((j) => {
              const badge = STATUS_BADGES[j.status] || STATUS_BADGES.processing;
              const elapsed = timeBetween(j.started_at, j.finished_at);
              return (
                <div
                  key={j.id}
                  data-testid={`conversion-row-${j.id}`}
                  className="shelf-card p-4 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}>
                        <badge.Icon className={`w-3 h-3 ${badge.spinning ? "animate-spin" : ""}`} />
                        {badge.label}
                      </span>
                      <span className="font-mono text-xs uppercase text-[#6B705C]">.{j.original_format}</span>
                      {elapsed && <span className="text-xs text-[#6B705C]">· {elapsed}</span>}
                    </div>
                    <p className="font-medium text-[#2C2C2C] truncate">
                      {j.status === "done" && j.book_id ? (
                        <Link to={`/book/${j.book_id}`} className="hover:underline">{j.title || "Untitled"}</Link>
                      ) : (
                        j.title || "Untitled"
                      )}
                    </p>
                    {j.error && (
                      <p className="text-xs text-red-700 mt-1 break-words">{j.error}</p>
                    )}
                    <p className="text-xs text-[#6B705C] mt-1">
                      {j.finished_at ? `finished ${relativeAgo(j.finished_at)}` : `started ${relativeAgo(j.started_at)}`}
                    </p>
                  </div>
                  {j.status === "failed" && (
                    <button
                      data-testid={`retry-${j.id}`}
                      onClick={() => retry(j.id)}
                      disabled={!!retrying[j.id]}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-60 inline-flex items-center gap-1 flex-shrink-0"
                    >
                      {retrying[j.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Retry
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
