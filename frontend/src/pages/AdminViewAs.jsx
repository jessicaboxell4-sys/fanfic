import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import Navbar from "../components/Navbar";
import { ArrowLeft, BookOpen, Clock, ShieldAlert, Eye } from "lucide-react";

/**
 * Read-only "view as user" surface.
 *
 * The admin stays logged in as themselves — this page just *renders* a
 * consented user's library snapshot + activity timeline. Reaching this
 * route without an active consent for this (admin, target) pair returns
 * 403 from the API and the page shows a clear "no consent" notice with
 * a link back to /admin → View-as-user consents.
 */
export default function AdminViewAs() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [snap, tl] = await Promise.all([
          api.get(`/admin/users/${uid}/view-as-data`),
          api.get(`/admin/users/${uid}/timeline`),
        ]);
        if (cancelled) return;
        setData(snap.data);
        setTimeline(tl.data);
      } catch (e) {
        const detail = e?.response?.data?.detail;
        if (e?.response?.status === 403 && typeof detail === "object" && detail?.code === "no_consent") {
          setError({ kind: "no_consent", message: detail.message });
        } else if (e?.response?.status === 404) {
          setError({ kind: "not_found", message: "User not found." });
        } else {
          setError({ kind: "other", message: "Couldn't load this user's library." });
          toast.error("Couldn't load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8">
        <button
          onClick={() => navigate("/admin")}
          data-testid="back-to-admin"
          className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] hover:text-[#553B96] inline-flex items-center gap-1 mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to admin
        </button>

        {loading ? (
          <p className="font-serif text-2xl text-[#2C2C2C] italic">Loading…</p>
        ) : error ? (
          <div className="rounded-2xl border border-[#D9534F]/40 bg-[#FBE9E5] p-6" data-testid="view-as-error">
            <ShieldAlert className="w-8 h-8 text-[#B43F26] mb-3" />
            <h1 className="font-serif text-2xl text-[#7A2417] mb-2">
              {error.kind === "no_consent" ? "No active consent" : error.kind === "not_found" ? "User not found" : "Couldn't load"}
            </h1>
            <p className="text-sm text-[#7A2417] mb-4">{error.message}</p>
            <Link to="/admin" className="btn-primary text-sm inline-block">
              Go back to admin
            </Link>
          </div>
        ) : (
          <>
            {/* Header — who you're viewing + consent meta */}
            <div className="rounded-2xl border-2 border-[#6B46C1] bg-[#F0E8F5] p-4 mb-6 flex items-start gap-3" data-testid="view-as-header">
              <Eye className="w-5 h-5 text-[#6B46C1] flex-shrink-0 mt-1" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1">
                  Read-only · viewing as
                </p>
                <h1 className="font-serif text-2xl text-[#2C2C2C] mb-1">
                  {data.user.name || data.user.email}{" "}
                  {data.user.username && <span className="text-base text-[#6B46C1]">@{data.user.username}</span>}
                </h1>
                <p className="text-xs text-[#5B5F4D]">
                  {data.user.email}
                  {data.consent.expires_at && (
                    <> · consent expires {new Date(data.consent.expires_at).toLocaleString(undefined, {dateStyle:"short", timeStyle:"short"})}</>
                  )}
                </p>
              </div>
            </div>

            {/* Library summary */}
            <section className="shelf-card p-6 mb-6" data-testid="view-as-library">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="w-5 h-5 text-[#E07A5F]" />
                <h2 className="font-serif text-xl text-[#2C2C2C]">Library — {data.library.total_books} books</h2>
              </div>

              {data.library.fandoms.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-2">Top fandoms</p>
                  <ul className="flex flex-wrap gap-1.5" data-testid="view-as-fandoms">
                    {data.library.fandoms.slice(0, 20).map((f) => (
                      <li key={f.name} className="px-2 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] text-xs">
                        {f.name} · <strong>{f.count}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-2">Recent uploads</p>
              <ul className="space-y-1" data-testid="view-as-recent-books">
                {data.library.recent_books.slice(0, 30).map((b) => (
                  <li key={b.book_id} className="text-sm flex items-baseline justify-between gap-2 py-1 border-b border-[#F5F3EC] last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-[#2C2C2C]">{b.title}</span>
                      {b.fandom && <span className="text-[#6B46C1] ml-2">· {b.fandom}</span>}
                    </div>
                    <span className="text-xs text-[#5B5F4D] flex-shrink-0">
                      {b.created_at ? new Date(b.created_at).toLocaleDateString() : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Timeline */}
            {timeline && (
              <section className="shelf-card p-6" data-testid="view-as-timeline">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-[#6B46C1]" />
                  <h2 className="font-serif text-xl text-[#2C2C2C]">Activity timeline · {timeline.count} events</h2>
                </div>
                <ul className="space-y-1.5">
                  {timeline.events.slice(0, 50).map((ev, i) => (
                    <li key={i} className="text-sm flex items-baseline gap-3 py-1 border-b border-[#F5F3EC] last:border-0">
                      <span className="text-xs uppercase tracking-wider text-[#5B5F4D] w-24 flex-shrink-0">
                        {ev.at ? new Date(ev.at).toLocaleDateString() : ""}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-[0.1em] text-[#6B46C1] w-28 flex-shrink-0">
                        {ev.kind === "book_uploaded" ? "Uploaded" : ev.kind === "book_opened" ? "Opened" : ev.kind === "admin_action" ? "Admin" : ev.kind}
                      </span>
                      <span className="flex-1 min-w-0 text-[#2C2C2C]">
                        {ev.title || ev.action || JSON.stringify(ev).slice(0, 100)}
                        {ev.fandom && <span className="text-[#6B46C1] ml-2">· {ev.fandom}</span>}
                        {ev.actor && <span className="text-[#5B5F4D] ml-2">· by {ev.actor}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
