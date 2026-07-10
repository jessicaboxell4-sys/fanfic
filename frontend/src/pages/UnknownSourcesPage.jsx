import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Globe, ExternalLink, Check, X, Tag } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// "Unknown sources" curation queue — story-shaped URLs from hosts that
// aren't on Shelfsort's accepted-sources list yet. The user can mark a
// host as "should be added" (the agent picks this up next session) or
// dismiss it as "not a real fic archive." Sample URLs and book metadata
// give context so the user can decide without leaving the page.
export default function UnknownSourcesPage() {
  const navigate = useNavigate();
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | marked | unmarked
  const [busyHost, setBusyHost] = useState(null);
  const [newUrl, setNewUrl] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    try {
      const { data } = await api.get("/admin/unknown-sources");
      setHosts(data?.hosts || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/admin/unknown-sources");
        if (!cancelled) setHosts(data?.hosts || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return hosts.filter((h) => {
      if (filter === "marked" && !h.marked_accepted) return false;
      if (filter === "unmarked" && h.marked_accepted) return false;
      if (!needle) return true;
      const hay = (h.host + " " + (h.samples || []).join(" ") + " " + (h.last_book_title || "")).toLowerCase();
      return hay.includes(needle);
    });
  }, [hosts, search, filter]);

  const counts = useMemo(() => ({
    all: hosts.length,
    marked: hosts.filter((h) => h.marked_accepted).length,
    unmarked: hosts.filter((h) => !h.marked_accepted).length,
  }), [hosts]);

  const toggleAccepted = async (h) => {
    const want = !h.marked_accepted;
    setBusyHost(h.host);
    try {
      const { data } = await api.patch(
        `/admin/unknown-sources/${encodeURIComponent(h.host)}/mark-accepted`,
        { accepted: want },
      );
      setHosts((prev) => prev.map((row) => row.host === h.host ? data.host : row));
      toast.success(want
        ? `Marked ${h.host} — I'll add it next session.`
        : `Un-marked ${h.host}.`);
    } catch {
      toast.error("Couldn't update that host.");
    } finally {
      setBusyHost(null);
    }
  };

  const dismiss = async (h) => {
    if (!window.confirm(`Drop ${h.host} from the queue?\n\nUse this when you've confirmed it's NOT a fic archive (e.g. a personal blog with one numeric URL by coincidence). If you want it added, click "Mark for adding" instead.`)) return;
    setBusyHost(h.host);
    try {
      await api.delete(`/admin/unknown-sources/${encodeURIComponent(h.host)}`);
      setHosts((prev) => prev.filter((row) => row.host !== h.host));
      toast.success(`Dismissed ${h.host}.`);
    } catch {
      toast.error("Couldn't dismiss that host.");
    } finally {
      setBusyHost(null);
    }
  };

  const addManual = async (e) => {
    e?.preventDefault?.();
    const url = newUrl.trim();
    if (!url) {
      toast.error("Paste a URL first.");
      return;
    }
    setAdding(true);
    try {
      const { data } = await api.post("/admin/unknown-sources", {
        url, note: newNote.trim() || undefined,
      });
      if (data?.already_accepted) {
        toast(`${data.host || "That host"} is already on the accepted list — no need to queue it.`, { duration: 6000 });
      } else {
        toast.success(`Queued ${data.host} for review — I'll look at it next session.`);
      }
      setNewUrl("");
      setNewNote("");
      await reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't queue that URL.");
    } finally {
      setAdding(false);
    }
  };

  const formatTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const diffH = (Date.now() - d.getTime()) / 1000 / 3600;
      if (diffH < 1) return "just now";
      if (diffH < 24) return `${Math.floor(diffH)}h ago`;
      const diffD = diffH / 24;
      if (diffD < 14) return `${Math.floor(diffD)}d ago`;
      return d.toLocaleDateString();
    } catch { return ""; }
  };

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="unknown-back"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Unknown sources</h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-2xl">
              URLs Shelfsort spotted in uploads or pastes that look like fanfic story links but live on hosts we don&apos;t recognize yet. Mark a host to have it added to the accepted-sources list next session, or dismiss it if it&apos;s not actually a fic archive.
            </p>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="unknown-summary">
          <div className="flex-shrink-0">
            <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="unknown-count">{hosts.length}</div>
            <div className="text-xs text-[#5B5F4D] uppercase tracking-wide">host{hosts.length === 1 ? "" : "s"} pending</div>
          </div>
          {hosts.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              {[
                { id: "all", label: "All" },
                { id: "marked", label: "Marked" },
                { id: "unmarked", label: "Unmarked" },
              ].map((b) => (
                <button
                  key={b.id}
                  onClick={() => setFilter(b.id)}
                  data-testid={`unknown-filter-${b.id}`}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    filter === b.id
                      ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                      : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {b.label} · {counts[b.id]}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={addManual}
          className="shelf-card p-4 mb-4 flex flex-col sm:flex-row gap-2"
          data-testid="unknown-add-form"
        >
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            data-testid="unknown-add-url"
            placeholder="Add a host manually — paste a URL (e.g. https://newarchive.com/story/1)"
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            data-testid="unknown-add-note"
            placeholder="Optional note ('friend mentioned it')"
            maxLength={500}
            className="sm:w-64 px-3 py-2 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
          <button
            type="submit"
            disabled={adding || !newUrl.trim()}
            data-testid="unknown-add-submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {adding ? "Queueing…" : "Queue for review"}
          </button>
        </form>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5B5F4D]" />
          <input
            type="search"
            data-testid="unknown-search"
            placeholder="Search host, sample URL, or book title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#5B5F4D] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#5B5F4D]">
            {hosts.length === 0 ? (
              <>
                <Globe className="w-10 h-10 mx-auto mb-3 text-[#6B46C1]" />
                <p className="font-medium text-[#2C2C2C] mb-1">No unknown sources.</p>
                <p className="text-sm">Every URL you&apos;ve seen so far comes from a host we already recognize.</p>
              </>
            ) : (
              <p className="text-sm italic">No hosts match your filter.</p>
            )}
          </div>
        ) : (
          <ul className="space-y-3" data-testid="unknown-list">
            {filtered.map((h) => (
              <li
                key={h.host}
                className="shelf-card p-4"
                data-testid={`unknown-host-${h.host}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-mono text-sm font-medium text-[#2C2C2C]">{h.host}</span>
                      {h.marked_accepted && (
                        <span
                          data-testid={`unknown-marked-${h.host}`}
                          className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide bg-[#6B46C1]/10 text-[#6B46C1] inline-flex items-center gap-1"
                          title={`Marked ${formatTime(h.marked_accepted_at)} — agent will pick this up next session`}
                        >
                          <Tag className="w-3 h-3" /> Marked for adding
                        </span>
                      )}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C]">
                        {h.hit_count} hit{h.hit_count === 1 ? "" : "s"}
                      </span>
                      {Object.entries(h.contexts || {}).map(([ctx, n]) => (
                        <span key={ctx} className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#E5DDC5] text-[#5B5F4D]">
                          {ctx} · {n}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-[#5B5F4D] mb-2">
                      First seen {formatTime(h.first_seen)} · last seen {formatTime(h.last_seen)}
                      {h.last_book_title ? (
                        <> · from <em>&ldquo;{h.last_book_title}&rdquo;</em>{h.last_book_author ? ` by ${h.last_book_author}` : ""}</>
                      ) : null}
                    </div>
                    {(h.samples || []).length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-[#6B46C1] hover:text-[#2C2C2C]">
                          {h.samples.length} sample URL{h.samples.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-2 space-y-1 ml-2">
                          {h.samples.map((u, i) => (
                            <li key={i} className="font-mono break-all">
                              <a
                                href={u}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#5B5F4D] hover:text-[#6B46C1] inline-flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleAccepted(h)}
                      disabled={busyHost === h.host}
                      data-testid={`unknown-mark-${h.host}`}
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                        h.marked_accepted
                          ? "bg-[#6B46C1] text-white border-[#6B46C1] hover:bg-[#2c4530]"
                          : "bg-white text-[#6B46C1] border-[#6B46C1]/30 hover:bg-[#6B46C1] hover:text-white"
                      }`}
                      title={h.marked_accepted ? "Un-mark this host" : "Mark this host for adding to the accepted list next session"}
                    >
                      <Check className="w-3.5 h-3.5" />
                      {h.marked_accepted ? "Marked" : "Mark for adding"}
                    </button>
                    <button
                      onClick={() => dismiss(h)}
                      disabled={busyHost === h.host}
                      data-testid={`unknown-dismiss-${h.host}`}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[#6B705C]/40 bg-white text-[#5B5F4D] hover:bg-[#6B705C] hover:text-white transition-colors disabled:opacity-50"
                      title="Not a fic archive — drop from the queue"
                    >
                      <X className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
