import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Loader2, X as XIcon, Users, RotateCcw,
  ExternalLink, BookOpen,
} from "lucide-react";
import Navbar from "../components/Navbar";
import PrimaryCTAButton from "../components/PrimaryCTAButton";
import { api } from "../lib/api";

function RecRow({ rec, onDismiss, busyKey }) {
  const friendNames = rec.friends.slice(0, 5).map((f) => f.name);
  const moreCount = Math.max(0, rec.friend_count - friendNames.length);
  const byline = friendNames.join(", ") + (moreCount > 0 ? ` +${moreCount} more` : "");

  return (
    <li
      data-testid={`rec-row-${rec.rec_key}`}
      className="bg-white border border-[#E8E6E1] rounded-2xl p-5 flex flex-col md:flex-row md:items-start gap-4"
    >
      <div className="flex-shrink-0 w-12 h-16 bg-[#F5F3EC] rounded-md flex items-center justify-center">
        <BookOpen className="w-6 h-6 text-[#E5DDC5]" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-lg text-[#2C2C2C]">{rec.title}</h3>
        <p className="text-sm text-[#5B5F4D]">{rec.author}{rec.fandom ? ` · ${rec.fandom}` : ""}</p>
        {rec.description && (
          <p className="text-xs text-[#5B5F4D] mt-2 line-clamp-3">{rec.description}</p>
        )}
        <p className="text-xs text-[#6B46C1] mt-2 flex items-center gap-1.5">
          <Users className="w-3 h-3" /> {byline}
        </p>
        <div className="text-[11px] text-[#5B5F4D] mt-1 flex flex-wrap gap-3">
          {rec.finished_count > 0 && <span className="text-[#1F4D2A]">{rec.finished_count} finished</span>}
          {rec.total_minutes > 0 && <span>{Math.round(rec.total_minutes)} min combined reading time</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 md:flex-col md:items-stretch">
        {rec.source_url && (
          <a
            href={rec.source_url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`rec-open-${rec.rec_key}`}
            className="btn-secondary text-xs inline-flex items-center gap-1 justify-center"
          >
            <ExternalLink className="w-3 h-3" /> Open source
          </a>
        )}
        <button
          data-testid={`rec-hide-${rec.rec_key}`}
          onClick={() => onDismiss(rec)}
          disabled={busyKey === rec.rec_key}
          className="btn-secondary text-xs inline-flex items-center gap-1 justify-center"
        >
          {busyKey === rec.rec_key ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
          Hide
        </button>
      </div>
    </li>
  );
}

export default function RecommendationsPage() {
  const [recs, setRecs] = useState([]);
  const [meta, setMeta] = useState({ friend_count: 0, shared_friend_count: 0 });
  const [dismissed, setDismissed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [digestEmailEnabled, setDigestEmailEnabled] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);

  const loadDigestSettings = async () => {
    try {
      const { data } = await api.get("/recommendations/friends-finished/settings");
      setDigestEmailEnabled(!!data?.email_enabled);
    } catch { /* non-blocking */ }
  };

  const toggleDigestEmail = async () => {
    const next = !digestEmailEnabled;
    setDigestEmailEnabled(next);  // optimistic
    setDigestBusy(true);
    try {
      await api.put("/recommendations/friends-finished/settings", { email_enabled: next });
      toast.success(next ? "We'll email you a copy each Sunday" : "Email copy off — in-app notifications still fire");
    } catch (e) {
      setDigestEmailEnabled(!next);  // revert
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setDigestBusy(false); }
  };

  const sendDigestPreview = async (withEmail = false) => {
    setDigestBusy(true);
    try {
      const { data } = await api.post(
        `/recommendations/friends-finished/preview${withEmail ? "?send_email=true" : ""}`,
      );
      if (data?.fired) {
        const emailSuffix = withEmail
          ? (data.email_sent ? " · Email sent." : data.email_error ? ` · Email error: ${data.email_error}` : "")
          : "";
        toast.success(`Sent — ${data.total} book${data.total === 1 ? "" : "s"} from your friends. Check the notifications bell.${emailSuffix}`);
      } else if (data?.reason === "no_new_finishes") {
        toast.info("No new finishes from your friends in the last week.");
      } else {
        toast.info("No notification sent.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send preview");
    } finally { setDigestBusy(false); }
  };

  const [affinity, setAffinity] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/recommendations/friends?limit=100");
      setRecs(data?.recommendations || []);
      setMeta({
        friend_count: data?.friend_count || 0,
        shared_friend_count: data?.shared_friend_count || 0,
      });
    } catch { toast.error("Couldn't load recommendations"); }
    finally { setLoading(false); }
  };

  const loadAffinity = async () => {
    try {
      const { data } = await api.get("/recommendations/by-affinity", { params: { limit: 12 } });
      setAffinity(data);
    } catch { /* affinity is best-effort */ }
  };

  const loadDismissed = async () => {
    try {
      const { data } = await api.get("/recommendations/dismissed");
      setDismissed(data?.dismissed || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    loadDismissed();
    loadAffinity();
    loadDigestSettings();
  }, []);

  const dismiss = async (rec) => {
    setBusyKey(rec.rec_key);
    try {
      await api.post("/recommendations/dismiss", { rec_key: rec.rec_key });
      setRecs((prev) => prev.filter((r) => r.rec_key !== rec.rec_key));
      await loadDismissed();
      toast.success("Hidden — you won't see this again");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't hide");
    } finally { setBusyKey(null); }
  };

  const undismiss = async (rec) => {
    setBusyKey(rec.rec_key);
    try {
      await api.post("/recommendations/undismiss", { rec_key: rec.rec_key });
      setDismissed((prev) => prev.filter((r) => r.rec_key !== rec.rec_key));
      toast.success("Restored — refresh to see it again");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't restore");
    } finally { setBusyKey(null); }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 md:px-8 py-8 space-y-6" data-testid="recommendations-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/library" className="text-xs text-[#5B5F4D] hover:text-[#2C2C2C] flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to library
            </Link>
            <h1 className="font-serif text-4xl text-[#2C2C2C] flex items-center gap-3 mt-1">
              <Sparkles className="w-7 h-7 text-[#6B46C1]" /> From your friends
            </h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-xl">
              Books your friends have read &amp; loved — ranked by finishers + reading time. Already-owned books are filtered out.
            </p>
          </div>
          <PrimaryCTAButton
            to="/bookclubs"
            icon={Users}
            testid="recs-to-bookclubs"
          >
            Read together
          </PrimaryCTAButton>
        </div>

        {/* Meta strip */}
        <div className="text-xs text-[#5B5F4D] flex flex-wrap gap-3">
          <span>You have <strong className="text-[#2C2C2C]">{meta.friend_count}</strong> friend{meta.friend_count === 1 ? "" : "s"}</span>
          <span>·</span>
          <span><strong className="text-[#2C2C2C]">{meta.shared_friend_count}</strong> share their libraries</span>
          {meta.shared_friend_count < meta.friend_count && (
            <Link to="/friends" className="text-[#6B46C1] underline">
              Friends who haven&apos;t opted in see no books here
            </Link>
          )}
        </div>

        {/* Affinity rail — community covers in your top fandoms/authors */}
        {affinity && (affinity.recommendations || []).length > 0 && (
          <section data-testid="affinity-rail" className="border-t border-[#E8E6E1] pt-6">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] inline-flex items-center gap-2">
                  <Sparkles className="w-3 h-3" /> More from authors &amp; fandoms you read
                </p>
                {affinity.top_fandoms?.length > 0 && (
                  <p className="text-xs text-[#5B5F4D] mt-1">
                    Based on:{" "}
                    {[...(affinity.top_fandoms || []), ...(affinity.top_authors || [])]
                      .slice(0, 5).join(" · ")}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {affinity.recommendations.map((c) => (
                <Link
                  key={c.cover_id}
                  to={`/cover/${c.cover_id}`}
                  className="bg-white rounded-lg border border-[#E8E6E1] overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  data-testid={`affinity-card-${c.cover_id}`}
                >
                  <div className="aspect-[2/3] bg-[#F5F2EA] overflow-hidden">
                    <img
                      src={`data:${c.mime_type};base64,${c.image_base64}`}
                      alt={c.title}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-2">
                    <p className="font-serif text-sm text-[#2C2C2C] leading-tight line-clamp-2">
                      {c.title}
                    </p>
                    <p className="text-[10px] text-[#5B5F4D] mt-1 truncate" title={c.match_reason}>
                      {c.match_reason}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Weekly digest — in-app always fires; email is opt-in */}
        <div
          data-testid="friends-finished-digest-card"
          className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-4 flex flex-wrap items-center gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#2C2C2C]">Weekly &quot;From friends&quot; digest</p>
            <p className="text-xs text-[#5B5F4D] mt-0.5">
              Every Sunday at 18:00 UTC, we drop an in-app notification listing the books your sharing friends finished that week. The notification always fires — toggle below to also receive an email copy.
            </p>
          </div>
          <button
            data-testid="friends-finished-preview"
            onClick={() => sendDigestPreview(false)}
            disabled={digestBusy}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            {digestBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Send in-app sample
          </button>
          <button
            data-testid="friends-finished-preview-email"
            onClick={() => sendDigestPreview(true)}
            disabled={digestBusy}
            className="btn-secondary text-xs inline-flex items-center gap-1"
            title="Fire the in-app notification AND send the email copy now (regardless of toggle below)"
          >
            {digestBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Sample email
          </button>
          <label className="flex items-center gap-2 text-xs text-[#5B5F4D]">
            <span>Email me too</span>
            <button
              type="button"
              data-testid="friends-finished-email-toggle"
              onClick={toggleDigestEmail}
              disabled={digestBusy}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                digestEmailEnabled ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
              }`}
              title={digestEmailEnabled ? "Disable email copy" : "Enable email copy"}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                digestEmailEnabled ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </label>
        </div>

        {/* Recs */}
        {loading ? (
          <div className="text-sm text-[#5B5F4D] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading recommendations…</div>
        ) : recs.length === 0 ? (
          <div className="bg-[#FBFAF6] border border-dashed border-[#E5DDC5] rounded-2xl p-10 text-center" data-testid="recs-empty">
            <Sparkles className="w-10 h-10 text-[#E5DDC5] mx-auto mb-2" />
            <p className="text-sm text-[#5B5F4D]">
              No recommendations yet.
              {meta.friend_count === 0 && <> Add some <Link to="/friends" className="text-[#6B46C1] underline">friends</Link> first.</>}
              {meta.friend_count > 0 && meta.shared_friend_count === 0 && <> None of your friends have shared their library yet.</>}
              {meta.friend_count > 0 && meta.shared_friend_count > 0 && <> Your friends haven&apos;t finished any books that you don&apos;t already own.</>}
            </p>
          </div>
        ) : (
          <ul className="space-y-3" data-testid="recs-list">
            {recs.map((rec) => (
              <RecRow key={rec.rec_key} rec={rec} onDismiss={dismiss} busyKey={busyKey} />
            ))}
          </ul>
        )}

        {/* Dismissed list */}
        <section className="pt-4 border-t border-[#E8E6E1]">
          <button
            data-testid="toggle-dismissed"
            onClick={() => setShowDismissed((v) => !v)}
            className="text-xs text-[#5B5F4D] hover:text-[#6B46C1] inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> {showDismissed ? "Hide" : "Show"} dismissed ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="mt-3 space-y-1" data-testid="dismissed-list">
              {dismissed.length === 0 ? (
                <li className="text-xs text-[#5B5F4D] italic">Nothing dismissed yet.</li>
              ) : dismissed.map((d) => (
                <li key={d.rec_key} className="flex items-center gap-2 text-xs bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
                  <span className="flex-1 truncate text-[#2C2C2C]">{d.title || d.rec_key} {d.author && <span className="text-[#5B5F4D]">— {d.author}</span>}</span>
                  <button
                    data-testid={`restore-${d.rec_key}`}
                    onClick={() => undismiss(d)}
                    disabled={busyKey === d.rec_key}
                    className="text-[#6B46C1] hover:underline"
                  >
                    {busyKey === d.rec_key ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Restore"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
