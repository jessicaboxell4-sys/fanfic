import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { User as UserIcon, Mail, Lock, Loader2, Mail as MailIcon, Settings2, AlertTriangle, Layers, Plus, X as XIcon, Download, Sparkles, Trash2, Users as UsersIcon, ShieldCheck as ShieldCheckIcon, Wand2, HelpCircle, Send } from "lucide-react";
import LibraryStatsCard from "../components/LibraryStatsCard";
import FandomTreemap from "../components/FandomTreemap";
import CatalogSyncCard from "../components/CatalogSyncCard";
import PushHandoffToggle from "../components/PushHandoffToggle";
import ReadingPrivacyToggle from "../components/ReadingPrivacyToggle";
import UploadChimeCard from "../components/UploadChimeCard";
// PalettePickerCard moved to /account/appearance (linked from the navbar appearance popover)
import { FETCHING_UI_ENABLED, SEND_TO_KINDLE_UI_ENABLED } from "../lib/featureFlags";
import { toast } from "sonner";

function errMsg(d) {
  if (!d) return "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(d);
}

// Privacy & messaging — combines the DM privacy toggle (Phase 1a),
// the "hide me from user search" toggle (Phase 1b), and a deep-link to

// ---------------------------------------------------------------------------
// AdminAccessCard — incoming view-access consent requests from admins
// ---------------------------------------------------------------------------
// Admins can request READ-ONLY access to your library to help diagnose
// issues you report. They never assume your session — this is purely
// "look but don't touch". You can grant 24h / 7d / 30d, deny, or revoke
// at any time. Every read writes an audit row, so you can always see
// who looked and when via /admin/audit (if you're also an admin).
function AdminAccessCard() {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [grantingId, setGrantingId] = useState(null);
  const [grantHours, setGrantHours] = useState(24 * 7);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/account/view-requests");
      setConsents(data?.consents || []);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const grant = async (cid) => {
    setBusyId(cid);
    try {
      await api.post(`/account/view-requests/${cid}/respond`, { accept: true, hours: grantHours });
      toast.success("Access granted");
      setGrantingId(null);
      load();
    } catch { toast.error("Couldn't grant"); }
    finally { setBusyId(null); }
  };

  const deny = async (cid) => {
    if (!window.confirm("Deny this request? The admin will be told you said no.")) return;
    setBusyId(cid);
    try {
      await api.post(`/account/view-requests/${cid}/respond`, { accept: false, hours: 24 });
      toast.success("Request denied");
      load();
    } catch { toast.error("Couldn't deny"); }
    finally { setBusyId(null); }
  };

  const revoke = async (cid) => {
    if (!window.confirm("Revoke this grant? The admin loses access immediately.")) return;
    setBusyId(cid);
    try {
      await api.delete(`/account/view-consents/${cid}`);
      toast.success("Revoked");
      load();
    } catch { toast.error("Couldn't revoke"); }
    finally { setBusyId(null); }
  };

  if (loading) return null;
  if (consents.length === 0) return null;  // hide entirely when nothing to show

  const pending = consents.filter((c) => c.status === "pending");
  const active = consents.filter((c) => c.status === "granted");

  return (
    <section className="shelf-card p-6 mb-6" id="admin-access" data-testid="admin-access-card">
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1">Admin access</h2>
      <p className="text-sm text-[#6B705C] mb-4">
        An admin has asked to <strong>look at your library, read-only</strong>, to help diagnose something. They will never log in as you or make changes; reads are audit-logged.
      </p>

      {pending.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider text-[#8B4F00] mb-2 font-bold">
            {pending.length} pending request{pending.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-2">
            {pending.map((c) => (
              <li
                key={c.consent_id}
                className="rounded-xl border-2 border-[#D49A1E] bg-[#FDF3E1] p-3"
                data-testid={`admin-access-pending-${c.consent_id}`}
              >
                <p className="text-sm text-[#2C2C2C]">
                  <strong>{c.admin_name || c.admin_email}</strong> wants read-only access to your library.
                </p>
                {c.reason && <p className="text-sm text-[#5C3300] italic mt-1">"{c.reason}"</p>}
                {grantingId === c.consent_id ? (
                  <div className="mt-3 pt-3 border-t border-[#D49A1E]/40">
                    <p className="text-xs uppercase tracking-wider text-[#8B4F00] mb-2">Grant for how long?</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { h: 24, lbl: "24 hours" },
                        { h: 24 * 7, lbl: "7 days" },
                        { h: 24 * 30, lbl: "30 days" },
                      ].map((opt) => (
                        <button
                          key={opt.h}
                          onClick={() => setGrantHours(opt.h)}
                          data-testid={`admin-access-duration-${opt.h}`}
                          className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] ${
                            grantHours === opt.h ? "bg-[#1F8F4E] text-white" : "bg-white text-[#1F4D2A] border border-[#1F8F4E]/40"
                          }`}
                        >
                          {opt.lbl}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => grant(c.consent_id)}
                        disabled={busyId === c.consent_id}
                        data-testid={`admin-access-grant-confirm-${c.consent_id}`}
                        className="px-3 py-1.5 rounded-full bg-[#1F8F4E] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#176D3A] disabled:opacity-60"
                      >
                        Grant access
                      </button>
                      <button
                        onClick={() => setGrantingId(null)}
                        className="px-3 py-1.5 rounded-full text-[#6B705C] text-xs font-medium hover:text-[#2C2C2C]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => { setGrantHours(24 * 7); setGrantingId(c.consent_id); }}
                      data-testid={`admin-access-grant-${c.consent_id}`}
                      className="px-3 py-1.5 rounded-full bg-[#1F8F4E] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#176D3A]"
                    >
                      Grant…
                    </button>
                    <button
                      onClick={() => deny(c.consent_id)}
                      disabled={busyId === c.consent_id}
                      data-testid={`admin-access-deny-${c.consent_id}`}
                      className="px-3 py-1.5 rounded-full border border-[#D9534F] text-[#D9534F] text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#FBE9E5] disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-[#1F4D2A] mb-2 font-bold">
            {active.length} active grant{active.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-2">
            {active.map((c) => (
              <li
                key={c.consent_id}
                className="rounded-xl border border-[#1F8F4E]/40 bg-[#EEF3EC] p-3 flex flex-wrap items-center gap-2"
                data-testid={`admin-access-active-${c.consent_id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#2C2C2C]">
                    <strong>{c.admin_name || c.admin_email}</strong>
                  </p>
                  {c.expires_at && (
                    <p className="text-xs text-[#1F4D2A]">
                      Expires {new Date(c.expires_at).toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"})}
                      {c.last_used_at && <> · last viewed {new Date(c.last_used_at).toLocaleString(undefined, {dateStyle:"short", timeStyle:"short"})}</>}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => revoke(c.consent_id)}
                  disabled={busyId === c.consent_id}
                  data-testid={`admin-access-revoke-${c.consent_id}`}
                  className="px-3 py-1.5 rounded-full border border-[#D9534F] text-[#D9534F] text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#FBE9E5] disabled:opacity-60"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}


// the Friends page. Anchored at id="privacy" so banners can scroll here.
function PrivacyMessagingCard({ navigate }) {
  const { user } = useAuth();
  const [privacy, setPrivacy] = useState({ message_privacy: "friends_only", hidden_from_search: false });
  const [libraryVisible, setLibraryVisible] = useState(false);
  // Independent flag from libraryVisible — friends-only vs public are
  // two different choices.  Users may want to share with friends
  // privately, or share publicly without making the friends path
  // visible, so both toggles co-exist in the UI.
  const [publicLibraryVisible, setPublicLibraryVisible] = useState(false);
  // Set after a successful togglePublicLibrary() on first opt-in;
  // drives the "Your library is public!" share modal exactly once.
  const [showFirstShareModal, setShowFirstShareModal] = useState(false);
  // RSS subscription URL — lazy-fetched the first time the user opens
  // the public-library panel.  Token comes from the server so the URL
  // can be shared safely with feed readers.
  const [rssToken, setRssToken] = useState("");
  const [regeneratingRss, setRegeneratingRss] = useState(false);
  const [pendingIn, setPendingIn] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/account/privacy");
      setPrivacy(data);
    } catch { /* ignore */ }
    try {
      const { data } = await api.get("/account/library-visibility");
      setLibraryVisible(!!data?.library_visible_to_friends);
    } catch { /* ignore */ }
    try {
      const { data } = await api.get("/account/public-library-visibility");
      setPublicLibraryVisible(!!data?.library_visible_to_public);
    } catch { /* ignore */ }
    // Lazy-fetch RSS token so the URL is ready the moment user
    // toggles public ON and looks for the share details.
    try {
      const { data } = await api.get("/account/library-rss-token");
      setRssToken(data?.rss_token || "");
    } catch { /* ignore */ }
    try {
      const { data } = await api.get("/friends/pending-count");
      setPendingIn(data?.pending_in || 0);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const updatePrivacy = async (patch) => {
    setSaving(true);
    try {
      const { data } = await api.put("/account/privacy", patch);
      setPrivacy(data);
      toast.success("Saved");
    } catch (e) { toast.error(errMsg(e?.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const toggleLibrary = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/account/library-visibility", { library_visible_to_friends: !libraryVisible });
      setLibraryVisible(!!data?.library_visible_to_friends);
      toast.success("Saved");
    } catch (e) { toast.error(errMsg(e?.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  // Public-library toggle.  Flips users.library_visible_to_public so
  // /u/<handle>/library renders for anonymous visitors (Goodreads-style
  // discovery).  Independent from toggleLibrary above so users keep
  // granular control.  Requires a @handle since the public URL is
  // handle-based — gentle UX: surface a toast pointing them to the
  // Profile section instead of silently failing.
  const togglePublicLibrary = async () => {
    if (!publicLibraryVisible) {
      // Switching ON — defensively require a username first; the
      // public URL relies on it.  This mirrors the directory nudge.
      // We don't have user data here, so trust the backend to 4xx
      // if missing — but pre-flight with a hint.
      try {
        const me = await api.get("/auth/me");
        if (!(me?.data?.username || "").trim()) {
          toast.error("Claim a @handle in the Profile section first — your public library URL uses it.");
          return;
        }
      } catch { /* fall through; backend will validate */ }
    }
    setSaving(true);
    try {
      const { data } = await api.put("/account/public-library-visibility", { library_visible_to_public: !publicLibraryVisible });
      setPublicLibraryVisible(!!data?.library_visible_to_public);
      toast.success(data?.library_visible_to_public ? "Library is public" : "Library hidden from the public");
      // Open the one-time share modal when this is the very first
      // opt-in.  Backend sets show_first_share_modal=true exactly
      // once per user (tracked via first_public_share_shown_at).
      if (data?.show_first_share_modal) {
        setShowFirstShareModal(true);
      }
    } catch (e) { toast.error(errMsg(e?.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const regenerateRss = async () => {
    setRegeneratingRss(true);
    try {
      const { data } = await api.post("/account/library-rss-token/regenerate");
      setRssToken(data?.rss_token || "");
      toast.success("Old RSS URL revoked — copy the new one below.");
    } catch (e) { toast.error(errMsg(e?.response?.data?.detail)); }
    finally { setRegeneratingRss(false); }
  };

  const copyRssUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("RSS URL copied");
    } catch {
      toast.error("Couldn't copy — long-press the URL to copy manually.");
    }
  };

  return (
    <section className="shelf-card p-6 mb-6" id="privacy" data-testid="privacy-messaging-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <ShieldCheckIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Privacy & messaging</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">
            Control who can DM you and whether you show up in the public reader directory.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C2C2C]">Who can send me DMs</p>
            <p className="text-xs text-[#6B705C]">
              {privacy.message_privacy === "friends_only"
                ? "Only accepted friends can DM you. Strangers must send a friend request first."
                : "Anyone signed in can DM you directly, no friend request needed."}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => updatePrivacy({ message_privacy: "friends_only" })}
              disabled={saving || privacy.message_privacy === "friends_only"}
              data-testid="privacy-friends-only-btn"
              className={`text-xs px-3 py-1.5 rounded ${
                privacy.message_privacy === "friends_only"
                  ? "bg-[#6B46C1] text-white font-semibold"
                  : "border border-[#E5DDC5] text-[#6B705C] hover:bg-white"
              }`}
            >Friends only</button>
            <button
              type="button"
              onClick={() => updatePrivacy({ message_privacy: "anyone" })}
              disabled={saving || privacy.message_privacy === "anyone"}
              data-testid="privacy-anyone-btn"
              className={`text-xs px-3 py-1.5 rounded ${
                privacy.message_privacy === "anyone"
                  ? "bg-[#6B46C1] text-white font-semibold"
                  : "border border-[#E5DDC5] text-[#6B705C] hover:bg-white"
              }`}
            >Anyone</button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C2C2C]">Hide me from the reader directory</p>
            <p className="text-xs text-[#6B705C]">
              When on, you won&apos;t appear in user search or on the <Link to="/users" className="underline">public reader directory</Link>. Existing friends still see you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => updatePrivacy({ hidden_from_search: !privacy.hidden_from_search })}
            disabled={saving}
            data-testid="privacy-hidden-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              privacy.hidden_from_search ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${privacy.hidden_from_search ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C2C2C]">Share my library with friends</p>
            <p className="text-xs text-[#6B705C]">
              When on, accepted friends can browse a read-only list of your books and click "Want this" to politely DM you about ones they don&apos;t have. Files are never auto-shared — you decide what to send.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleLibrary}
            disabled={saving}
            data-testid="privacy-library-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              libraryVisible ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${libraryVisible ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* Public library toggle — new 2026-06-26.  Sits right under
            the friends-only toggle so the privacy spectrum reads
            top-to-bottom: friends → strangers in the directory →
            anyone on the web.  Off by default; flipping it on makes
            /u/<handle>/library reachable to anyone with the link. */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2C2C2C]">Make my library public on the web</p>
            <p className="text-xs text-[#6B705C]">
              When on, anyone with the link to <span className="font-mono">/u/your-handle/library</span> can browse a read-only list of your books (title, author, fandom).
              Files are never shared; AV-flagged books stay hidden.
            </p>
            {publicLibraryVisible && (user?.username || "").trim() && (
              <p className="text-xs mt-1.5">
                <Link
                  to={`/u/${user.username}/library`}
                  data-testid="privacy-view-my-public-library-link"
                  className="text-[#6B46C1] font-semibold underline"
                >
                  View my public library →
                </Link>
              </p>
            )}
            {/* RSS panel — only renders when public AND we have a
                handle + a token.  Lets power-users subscribe in their
                RSS reader of choice; tokenized URL works without
                Shelfsort sign-in (the documented exception to the
                2026-06-26 auth-required policy). */}
            {publicLibraryVisible && (user?.username || "").trim() && rssToken && (() => {
              const rssUrl = `${process.env.REACT_APP_BACKEND_URL}/api/feeds/library/${user.username}.rss?token=${rssToken}`;
              return (
                <div
                  className="mt-3 p-3 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] space-y-2"
                  data-testid="privacy-rss-panel"
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B705C]">
                    RSS subscription URL
                  </p>
                  <code
                    className="block text-[10px] text-[#2C2C2C] bg-white border border-[#E8E6E1] rounded px-2 py-1.5 break-all"
                    data-testid="privacy-rss-url"
                  >
                    {rssUrl}
                  </code>
                  <div className="flex items-center flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyRssUrl(rssUrl)}
                      data-testid="privacy-rss-copy-btn"
                      className="text-xs px-2.5 py-1 rounded-full bg-[#6B46C1] text-white hover:bg-[#553397] font-semibold"
                    >
                      Copy URL
                    </button>
                    <button
                      type="button"
                      onClick={regenerateRss}
                      disabled={regeneratingRss}
                      data-testid="privacy-rss-regen-btn"
                      className="text-xs px-2.5 py-1 rounded-full bg-[#F5F3EC] text-[#6B705C] hover:bg-[#E8E2D4] disabled:opacity-60"
                    >
                      {regeneratingRss ? "Regenerating…" : "Regenerate (invalidate old)"}
                    </button>
                  </div>
                  <p className="text-[10px] text-[#6B705C]">
                    Anyone with this URL can subscribe — keep it private if you don&apos;t want it indexed.
                  </p>
                </div>
              );
            })()}
          </div>
          <button
            type="button"
            onClick={togglePublicLibrary}
            disabled={saving}
            data-testid="privacy-public-library-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              publicLibraryVisible ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${publicLibraryVisible ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate("/friends")}
          data-testid="privacy-open-friends-btn"
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-[#E5DDC5] bg-white hover:bg-[#FBFAF6] transition-colors text-sm text-[#2C2C2C]"
        >
          <span className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-[var(--primary)]" />
            Manage friends
          </span>
          {pendingIn > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold">
              {pendingIn} pending
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate("/users")}
          data-testid="privacy-open-directory-btn"
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-[#E5DDC5] bg-white hover:bg-[#FBFAF6] transition-colors text-sm text-[#2C2C2C]"
        >
          <span className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-[#6B46C1]" />
            Find readers (public directory)
          </span>
          <span className="text-[10px] text-[#6B705C]">browse usernames</span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/bookclubs")}
          data-testid="privacy-open-bookclubs-btn"
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-[#E5DDC5] bg-white hover:bg-[#FBFAF6] transition-colors text-sm text-[#2C2C2C]"
        >
          <span className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-[#6B46C1]" />
            Reading rooms
          </span>
          <span className="text-[10px] text-[#6B705C]">read a book with friends</span>
        </button>
      </div>

      {/* First-time share modal — opens automatically the first time
          a user flips library public.  Backend stamps
          first_public_share_shown_at after the response so it never
          re-fires for the same account (even across devices). */}
      {showFirstShareModal && (user?.username || "").trim() && (() => {
        const libUrl = `${window.location.origin}/u/${user.username}/library`;
        const shareText = encodeURIComponent(`Just made my Shelfsort library public — come browse what I'm reading on Shelfsort! ${libUrl}`);
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(libUrl)}`;
        const twUrl = `https://twitter.com/intent/tweet?text=${shareText}`;
        const closeModal = () => setShowFirstShareModal(false);
        const copyLibUrl = async () => {
          try {
            await navigator.clipboard.writeText(libUrl);
            toast.success("Link copied");
          } catch {
            toast.error("Couldn't copy — long-press the URL.");
          }
        };
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={closeModal}
            data-testid="first-share-modal-backdrop"
          >
            <div
              className="bg-[#FBF7EE] rounded-2xl shadow-2xl border border-[#E5DDC5] w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="first-share-modal-title"
              data-testid="first-share-modal"
            >
              <div className="p-6">
                <h3 id="first-share-modal-title" className="font-serif text-xl text-[#2C2C2C] mb-1">
                  🎉 Your library is public!
                </h3>
                <p className="text-sm text-[#6B705C]">
                  Anyone with the link below can sign in and browse your shelves.
                  Want to tell people?
                </p>
                <code
                  className="block text-[10px] text-[#2C2C2C] bg-white border border-[#E8E6E1] rounded px-2 py-1.5 break-all mt-3"
                  data-testid="first-share-modal-url"
                >
                  {libUrl}
                </code>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <a
                    href={fbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="first-share-modal-fb-btn"
                    className="text-center text-xs font-semibold py-2 rounded-full bg-[#1877F2] text-white hover:opacity-90"
                  >
                    Facebook
                  </a>
                  <a
                    href={twUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="first-share-modal-tw-btn"
                    className="text-center text-xs font-semibold py-2 rounded-full bg-[#0F1419] text-white hover:opacity-90"
                  >
                    X / Twitter
                  </a>
                  <button
                    type="button"
                    onClick={copyLibUrl}
                    data-testid="first-share-modal-copy-btn"
                    className="text-xs font-semibold py-2 rounded-full bg-[#6B46C1] text-white hover:bg-[#553397]"
                  >
                    Copy link
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    data-testid="first-share-modal-close-btn"
                    className="text-xs text-[#6B705C] hover:text-[#2C2C2C] px-3 py-1.5"
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// Manual fandom aliases — e.g. "HP" -> "Harry Potter". Applied during
// canonicalization so abbreviations file with the full name everywhere.
function FandomAliasesCard() {
  const [aliases, setAliases] = useState({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/user/fandom-aliases");
        setAliases(data?.aliases || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const save = async (next) => {
    setSaving(true);
    try {
      const { data } = await api.put("/user/fandom-aliases", { aliases: next });
      setAliases(data?.aliases || {});
    } catch {
      toast.error("Couldn't save aliases");
    } finally {
      setSaving(false);
    }
  };

  const addAlias = async () => {
    const f = from.trim();
    const t = to.trim();
    if (!f || !t || f.toLowerCase() === t.toLowerCase()) {
      toast.error('Need "from" and "to" — and they must differ');
      return;
    }
    const next = { ...aliases, [f]: t };
    await save(next);
    setFrom("");
    setTo("");
  };

  const removeAlias = async (key) => {
    const next = { ...aliases };
    delete next[key];
    await save(next);
  };

  const runMergeNow = async () => {
    try {
      const { data } = await api.post("/fandoms/canonicalize-crossovers");
      toast.success(
        data.updated > 0
          ? `Re-canonicalized ${data.updated} book${data.updated === 1 ? "" : "s"} with the new aliases`
          : "Nothing changed — aliases already applied",
      );
    } catch {
      toast.error("Couldn't re-run canonicalization");
    }
  };

  const rows = Object.entries(aliases).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
          <Layers className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Fandom aliases</h2>
          <p className="text-sm text-[#6B705C] mt-1">
            Map abbreviations / nicknames to canonical fandom names. Applied automatically
            during uploads — and clickable below to apply retroactively to your library.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="From (e.g. HP)"
          data-testid="alias-from"
          className="flex-1 min-w-[140px] p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:outline-none focus:border-[#E07A5F]"
        />
        <span className="self-center text-[#6B705C] text-sm">→</span>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To (e.g. Harry Potter)"
          data-testid="alias-to"
          className="flex-1 min-w-[180px] p-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:outline-none focus:border-[#E07A5F]"
        />
        <button
          onClick={addAlias}
          disabled={saving}
          data-testid="alias-add"
          className="px-3 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[#6B705C] italic">No aliases yet. Add one above.</p>
      ) : (
        <ul className="space-y-1" data-testid="alias-list">
          {rows.map(([k, v]) => (
            <li
              key={k}
              className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white border border-[#E5DDC5] text-sm"
            >
              <span className="font-mono">
                <span className="text-[#6B705C]">{k}</span>
                <span className="mx-2 text-[#6B705C]">→</span>
                <span className="text-[#2C2C2C] font-semibold">{v}</span>
              </span>
              <button
                onClick={() => removeAlias(k)}
                data-testid={`alias-remove-${k.replace(/\s+/g, "-").toLowerCase()}`}
                className="text-[#6B705C] hover:text-[#6B46C1] p-1"
                aria-label={`Remove alias ${k}`}
              >
                <XIcon className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <button
          onClick={runMergeNow}
          data-testid="alias-apply-now"
          className="mt-4 text-xs text-[#6B46C1] hover:text-[#553397] underline"
        >
          Apply these aliases to existing books now
        </button>
      )}
    </>
  );
}

// Backup card — streams every active book + a manifest.json as a single
// ZIP via `GET /api/library/backup`. Triggers via a synthesized anchor
// so axios isn't in the path (axios would buffer the whole stream in
// memory). The anchor uses `api.defaults.baseURL` to keep the same
// base + cookies the rest of the app uses.
function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/user/backup-history");
      setHistory(data?.entries || []);
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => { loadHistory(); }, []);

  const download = async () => {
    setBusy(true);
    try {
      // Use a streaming fetch + Blob so we can hand the file off to the
      // browser without holding the full ZIP in memory longer than the
      // download dialog needs it.
      const resp = await api.get("/library/backup", {
        responseType: "blob",
        // Backup of a 5000-book library can take 30s+ to stream.
        timeout: 5 * 60 * 1000,
      });
      const blob = resp.data;
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = url;
      a.download = `shelfsort-backup-${today}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded.");
      // Refresh the history so the new entry shows up immediately.
      await loadHistory();
    } catch (e) {
      toast.error("Couldn't generate the backup — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const formatTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const diffH = (Date.now() - d.getTime()) / 1000 / 3600;
      if (diffH < 1) {
        const m = Math.max(1, Math.floor(diffH * 60));
        return `${m} min ago`;
      }
      if (diffH < 24) return `${Math.floor(diffH)}h ago`;
      const diffD = diffH / 24;
      if (diffD < 14) return `${Math.floor(diffD)}d ago`;
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch { return ""; }
  };

  return (
    <section className="shelf-card p-6 mb-6" data-testid="backup-card" id="backup-card">
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1 flex items-center gap-2">
        <Download className="w-5 h-5 text-[#6B46C1]" /> Library backup
      </h2>
      <p className="text-sm text-[#6B705C] mb-5">
        Download every EPUB plus a manifest of your books, tags, smart shelves, and preferences as a single ZIP. The filename is dated so you can keep multiple backups. Restore is manual for now — keep the ZIP somewhere safe.
      </p>
      <button
        onClick={download}
        disabled={busy}
        data-testid="backup-download-btn"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {busy ? "Generating…" : "Download library backup"}
      </button>
      <a
        href="/account/restore"
        data-testid="backup-restore-link"
        className="ml-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#6B46C1] hover:text-white transition-colors text-sm font-medium"
      >
        Restore from backup
      </a>
      <a
        href="/account/safety"
        data-testid="safety-report-link"
        className="ml-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#6B46C1] hover:text-white transition-colors text-sm font-medium"
      >
        Library safety report
      </a>

      {/* Backup history — chronological list so the user can answer
          "did I back up before <bad date>?" at a glance. */}
      <div className="mt-6 pt-5 border-t border-[#E5DDC5]" data-testid="backup-history">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
          Backup history
        </p>
        {historyLoading ? (
          <p className="text-xs text-[#6B705C] italic">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-[#6B705C] italic" data-testid="backup-history-empty">
            No backups yet — your first download will show up here.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="backup-history-list">
            {history.map((h, i) => (
              <li
                key={h.started_at || i}
                data-testid={`backup-history-entry-${i}`}
                className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-[#F5F3EC]"
              >
                <span className="text-[#2C2C2C]">
                  {new Date(h.started_at).toLocaleString(undefined, {
                    year: "numeric", month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                  <span className="text-[#6B705C]"> · {formatTime(h.started_at)}</span>
                </span>
                <span className="text-[#6B705C]">
                  {h.book_count} book{h.book_count === 1 ? "" : "s"}
                  {h.smart_shelf_count ? <> · {h.smart_shelf_count} smart shelves</> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


// Cloud-backup card — durable mirror of the user's EPUB + cover files
// to Emergent Object Storage so a redeploy can't wipe the library.
// Hits ``POST /api/account/backup-library`` (per-user slice of the
// admin backfill); the same files are also picked up automatically
// by the 10-min cron tick — this button is the visible reassurance.
function CloudBackupCard() {
  const [state, setState] = useState({ enabled: true, last_run_at: null, stats: {} });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/account/backup-library");
      setState(data || {});
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); }, []);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/account/backup-library");
      if (data?.ok) {
        const s = data.stats || {};
        toast.success(
          s.uploaded
            ? `Backed up ${s.uploaded} file${s.uploaded === 1 ? "" : "s"} to durable storage.`
            : "Your library is already fully backed up."
        );
        setState((prev) => ({
          ...prev,
          last_run_at: data.last_run_at,
          stats: s,
        }));
      } else {
        toast.warning("Cloud backup isn't configured on this deployment.");
      }
    } catch {
      toast.error("Cloud backup failed — try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso) => {
    if (!iso) return "never";
    try {
      const d = new Date(iso);
      const diffH = (Date.now() - d.getTime()) / 1000 / 3600;
      if (diffH < 1) return `${Math.max(1, Math.floor(diffH * 60))} min ago`;
      if (diffH < 24) return `${Math.floor(diffH)}h ago`;
      const diffD = diffH / 24;
      if (diffD < 14) return `${Math.floor(diffD)}d ago`;
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch { return ""; }
  };

  if (state.enabled === false) {
    // Object storage disabled on this deployment — silently skip the card
    // rather than confuse the user.
    return null;
  }

  const s = state.stats || {};
  const summary = s.scanned
    ? `${s.scanned} file${s.scanned === 1 ? "" : "s"} checked · ${s.uploaded || 0} newly mirrored`
    : null;

  return (
    <section className="shelf-card p-6 mb-6" data-testid="cloud-backup-card" id="cloud-backup-card">
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1 flex items-center gap-2">
        <Download className="w-5 h-5 text-[#3B5B3F]" /> Cloud library mirror
        <Link
          to="/help#cloud-backup"
          title="About cloud library mirror"
          data-testid="help-anchor-cloud-backup"
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[#6B705C] hover:text-[#6B46C1] transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </Link>
      </h2>
      <p className="text-sm text-[#6B705C] mb-5">
        Your EPUBs and covers are continuously mirrored to durable cloud storage so a server redeploy can&apos;t wipe them. Click below to trigger an immediate mirror — usually it runs in the background every 10 minutes.
      </p>
      <button
        onClick={run}
        disabled={busy}
        data-testid="cloud-backup-trigger-btn"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B5B3F] text-white hover:bg-[#2c4530] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {busy ? "Backing up…" : "Back up my library now"}
      </button>
      <div className="mt-4 text-xs text-[#6B705C]" data-testid="cloud-backup-status">
        Last backup: <span className="font-semibold text-[#2C2C2C]" data-testid="cloud-backup-last">{fmt(state.last_run_at)}</span>
        {summary && <span> · {summary}</span>}
      </div>
    </section>
  );
}
// Announcements card — publishes the "What's new" card shown on the Help
// page. Server endpoints live in /app/backend/routes/announcements.py.
// `version` doubles as the per-user dismissal key on the client, so any
// new version re-shows the card for every user.
const EMPTY_ITEM = { label: "", desc: "", to: "", link_to_2: "" };

function AnnouncementsCard() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(todayIso);
  const [title, setTitle] = useState("Fresh in Shelfsort");
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [publishing, setPublishing] = useState(false);

  const loadLatest = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/announcements/latest");
      setLatest(data || null);
    } catch { setLatest(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadLatest(); }, []);

  const updateItem = (idx, key, val) => {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
  };

  const addRow = () => setItems((rows) => [...rows, { ...EMPTY_ITEM }]);
  const removeRow = (idx) => setItems((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== idx)));

  const publish = async () => {
    const cleanItems = items
      .map((r) => ({
        label: r.label.trim(),
        desc: r.desc.trim(),
        to: r.to.trim(),
        ...(r.link_to_2.trim() ? { link_to_2: r.link_to_2.trim() } : {}),
      }))
      .filter((r) => r.label && r.desc && r.to);
    if (!version.trim() || !title.trim() || cleanItems.length === 0) {
      toast.error("Need version, title, and at least one fully-filled item row.");
      return;
    }
    setPublishing(true);
    try {
      await api.post("/announcements", { version: version.trim(), title: title.trim(), items: cleanItems });
      toast.success("Published. Users will see the new card on their next Help visit.");
      setItems([{ ...EMPTY_ITEM }]);
      setVersion(new Date().toISOString().slice(0, 10));
      await loadLatest();
    } catch (e) {
      const status = e?.response?.status;
      if (status === 409) toast.error(`Version "${version}" is already published — bump it.`);
      else toast.error("Publish failed — check the console.");
    } finally {
      setPublishing(false);
    }
  };

  const deleteLatest = async () => {
    if (!latest?.version) return;
    if (!window.confirm(`Delete announcement "${latest.version}"?`)) return;
    try {
      await api.delete(`/announcements/${encodeURIComponent(latest.version)}`);
      toast.success("Deleted.");
      await loadLatest();
    } catch { toast.error("Delete failed."); }
  };

  return (
    <section className="shelf-card p-6 mb-6" data-testid="announcements-card">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#FCEFE6] text-[#E07A5F] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Release notes</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">
            Publish the &quot;What&apos;s new&quot; card shown at the top of the Help page. Bump the version on every push — users see the card again until they dismiss this version.
          </p>
        </div>
      </div>

      {/* Current published note */}
      <div className="mt-4 mb-5 p-3 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid="announcements-current">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1.5">Currently live</p>
        {loading ? (
          <p className="text-xs text-[#6B705C] italic">Loading…</p>
        ) : !latest ? (
          <p className="text-xs text-[#6B705C] italic" data-testid="announcements-current-empty">
            No server-side announcement yet — users see the bundled fallback card.
          </p>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-[#2C2C2C] flex-1 min-w-0">
              <p className="font-semibold truncate">{latest.title}</p>
              <p className="text-[#6B705C]">v{latest.version} · {latest.items?.length || 0} item{(latest.items?.length || 0) === 1 ? "" : "s"}</p>
            </div>
            <button
              type="button"
              onClick={deleteLatest}
              data-testid="announcements-delete-btn"
              className="text-xs text-[#D9534F] hover:text-[#B53C39] inline-flex items-center gap-1 flex-shrink-0"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* New announcement form */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[140px,1fr] gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1">Version</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="2026-06-12"
              data-testid="announcements-version-input"
              className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fresh in Shelfsort"
              data-testid="announcements-title-input"
              className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1.5">Items</label>
          <div className="space-y-2">
            {items.map((row, idx) => (
              <div
                key={idx}
                data-testid={`announcements-item-row-${idx}`}
                className="p-3 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] space-y-2"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateItem(idx, "label", e.target.value)}
                    placeholder='Label (e.g. "Unreadable shelf" or "Ongoing & Finished")'
                    data-testid={`announcements-item-label-${idx}`}
                    className="w-full px-2 py-1.5 rounded border border-[#E5DDC5] bg-white text-xs text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
                  />
                  <input
                    type="text"
                    value={row.to}
                    onChange={(e) => updateItem(idx, "to", e.target.value)}
                    placeholder="Link (e.g. /library/unreadable)"
                    data-testid={`announcements-item-to-${idx}`}
                    className="w-full px-2 py-1.5 rounded border border-[#E5DDC5] bg-white text-xs text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
                  />
                </div>
                <input
                  type="text"
                  value={row.desc}
                  onChange={(e) => updateItem(idx, "desc", e.target.value)}
                  placeholder="Description — appears after the link(s)"
                  data-testid={`announcements-item-desc-${idx}`}
                  className="w-full px-2 py-1.5 rounded border border-[#E5DDC5] bg-white text-xs text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.link_to_2}
                    onChange={(e) => updateItem(idx, "link_to_2", e.target.value)}
                    placeholder="Optional second link (for combo labels like 'A & B')"
                    data-testid={`announcements-item-link2-${idx}`}
                    className="flex-1 px-2 py-1.5 rounded border border-[#E5DDC5] bg-white text-xs text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      data-testid={`announcements-item-remove-${idx}`}
                      className="p-1.5 rounded text-[#D9534F] hover:bg-[#FBE9E7]"
                      aria-label="Remove item"
                    >
                      <XIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRow}
            data-testid="announcements-add-row"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#6B46C1] hover:text-[#E07A5F]"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>

        <button
          type="button"
          onClick={publish}
          disabled={publishing}
          data-testid="announcements-publish-btn"
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {publishing ? "Publishing…" : "Publish announcement"}
        </button>
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Send-to-Kindle card (2026-06-22) — per-user Amazon Kindle send-to email.
// Pairs with the "Send to Kindle" button on every BookDetail page.
// Amazon requires the SENDER address to be on the user's "Approved
// Personal Document E-mail List" — that one-time setup step is the
// most common gotcha, so we surface the sender email right here with
// a copy button + a deep link to Amazon's setup page.
// ---------------------------------------------------------------------------
function SendToKindleCard() {
  const [loading, setLoading] = useState(true);
  const [kindleEmail, setKindleEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [lastSentAt, setLastSentAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/user/kindle-settings");
      setKindleEmail(data?.kindle_email || "");
      setDraft(data?.kindle_email || "");
      setSenderEmail(data?.sender_email || "");
      setLastSentAt(data?.last_sent_at || null);
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/user/kindle-settings", { kindle_email: draft.trim() });
      setKindleEmail(data?.kindle_email || "");
      toast.success(data?.kindle_email
        ? `Kindle address saved · ${data.kindle_email}`
        : "Kindle address cleared. Send-to-Kindle is now disabled.");
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const copySender = async () => {
    try {
      await navigator.clipboard.writeText(senderEmail);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — copy it manually instead.");
    }
  };

  return (
    <section
      className="shelf-card p-6 mb-6"
      id="send-to-kindle"
      data-testid="send-to-kindle-card"
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#FFF2DE] text-[#FF9900] flex items-center justify-center flex-shrink-0">
          <Send className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Send to Kindle</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">
            Beam any EPUB straight to your Amazon Kindle. One-tap from the book page.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#6B705C] italic mt-4">Loading…</p>
      ) : (
        <>
          {/* Step 1 — capture the user's @kindle.com address */}
          <div className="mt-4 mb-4">
            <label className="block text-sm font-semibold text-[#2C2C2C] mb-1">
              Your Kindle email
            </label>
            <p className="text-xs text-[#6B705C] mb-2">
              Find this in the Amazon app under <em>More → Settings → Personal Documents</em>.
              It looks like <code className="text-[#6B46C1]">yourname@kindle.com</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="yourname@kindle.com"
                data-testid="kindle-email-input"
                className="flex-1 min-w-[240px] px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:border-[#6B46C1] focus:outline-none"
              />
              <button
                type="button"
                onClick={save}
                disabled={saving || draft.trim() === kindleEmail.trim()}
                data-testid="kindle-email-save-btn"
                className="btn-primary text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {kindleEmail && (
              <p className="text-xs text-[#1F8F4E] mt-2" data-testid="kindle-email-saved">
                ✓ Currently saved: <code>{kindleEmail}</code>
              </p>
            )}
          </div>

          {/* Step 2 — Amazon approved-sender list reminder */}
          {senderEmail && (
            <div className="mt-4 p-3 rounded-xl border-2 border-dashed border-[#FF9900]/40 bg-[#FFF8EC]" data-testid="kindle-sender-reminder">
              <p className="text-sm font-semibold text-[#2C2C2C] mb-1">
                One-time setup on Amazon
              </p>
              <p className="text-xs text-[#6B705C] mb-2">
                Amazon will drop your books unless this sender is on your
                <em> Approved Personal Document E-mail List</em>:
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="px-2 py-1 rounded bg-[#FFE9C2] text-[#9B5A00] text-xs font-mono break-all">
                  {senderEmail}
                </code>
                <button
                  type="button"
                  onClick={copySender}
                  data-testid="kindle-sender-copy-btn"
                  className="text-xs px-3 py-1 rounded-full border border-[#FF9900] text-[#9B5A00] hover:bg-[#FFE9C2]"
                >
                  {showCopied ? "✓ Copied" : "Copy"}
                </button>
                <a
                  href="https://www.amazon.com/myk"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="kindle-amazon-link"
                  className="text-xs text-[#6B46C1] underline hover:text-[#5a3aa3]"
                >
                  Open Manage Your Content & Devices ↗
                </a>
              </div>
            </div>
          )}

          {/* Last-sent line, if any */}
          {lastSentAt && (
            <p className="text-xs text-[#6B705C] mt-3 italic" data-testid="kindle-last-sent">
              Last successful send: {new Date(lastSentAt).toLocaleString()}
            </p>
          )}

          {/* How it works */}
          <details className="mt-4">
            <summary className="text-xs text-[#6B705C] cursor-pointer hover:text-[#2C2C2C]">
              How does this work?
            </summary>
            <ul className="text-xs text-[#6B705C] mt-2 ml-4 list-disc space-y-1">
              <li>You hit <strong>Send to Kindle</strong> on any book in your library.</li>
              <li>Shelfsort emails the EPUB to your <code>@kindle.com</code> address.</li>
              <li>Amazon converts it and pushes it to every Kindle on your account within ~5 min.</li>
              <li>Files larger than 25 MB are rejected by Amazon&apos;s gateway — try a different format if that happens.</li>
              <li>To prevent accidental duplicates, the same book can&apos;t be re-sent within 30 min.</li>
            </ul>
          </details>
        </>
      )}

      {/* First-time share modal moved to PrivacyMessagingCard scope */}
    </section>
  );
}




export default function Account() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // Bio textarea (2026-06-26 evening).  Capped at 280 chars (tweet
  // length).  Surfaces on /u/<handle> and /u/<handle>/library; the
  // sign-in gate also renders it as a flavour line when present.
  const [bio, setBio] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Public-handle (username) state — separate flow from `name` because the
  // rules are stricter (lowercase, 3-20 chars, globally unique).
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameStatus, setUsernameStatus] = useState({ ok: null, reason: null });
  const [savingUsername, setSavingUsername] = useState(false);
  const [clearingPrev, setClearingPrev] = useState(false);

  // (Email preferences moved to /account/emails — handled in EmailPreferences.jsx)

  // FanFicFare options for fanfic downloads
  const [fff, setFff] = useState(null);
  const [savingFff, setSavingFff] = useState(false);
  const [applyingTpl, setApplyingTpl] = useState(false);
  const [tidyingNames, setTidyingNames] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [confirmEmailInput, setConfirmEmailInput] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetOpts, setResetOpts] = useState({
    reset_progress: false,
    reset_tags: false,
    reset_smart_shelves: false,
    reset_versions: false,
  });
  const [dupeCount, setDupeCount] = useState(null);
  const [dupePolicy, setDupePolicy] = useState("ask");
  const [savingDupePolicy, setSavingDupePolicy] = useState(false);
  const [formatPrefs, setFormatPrefs] = useState(null);
  const [savingFormatPrefs, setSavingFormatPrefs] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/profile");
        setProfile(data);
        setName(data.name || "");
        setBio(data.bio || "");
      } catch (e) {
        toast.error("Couldn't load your profile");
        navigate("/login");
      }
      try {
        const { data: f } = await api.get("/user/fff-options");
        setFff(f);
      } catch (e) { /* ignore */ }
      try {
        const { data: dc } = await api.get("/library/duplicates/count");
        setDupeCount(dc);
      } catch (e) { /* non-fatal — hide the count if it fails */ }
      try {
        const { data: dp } = await api.get("/user/duplicate-policy");
        setDupePolicy(dp.policy || "ask");
      } catch (e) { /* ignore */ }
      try {
        const { data: fp } = await api.get("/user/format-prefs");
        setFormatPrefs(fp);
      } catch (e) { /* ignore — falls back to default "ask" */ }
    })();
  }, [navigate]);

  const toggleFff = async (key) => {
    if (!fff) return;
    setSavingFff(true);
    const next = { ...fff, [key]: !fff[key] };
    setFff(next);
    try {
      await api.put("/user/fff-options", { [key]: next[key] });
      toast.success("Saved");
    } catch (e) {
      toast.error("Couldn't save");
      setFff(fff); // revert
    } finally {
      setSavingFff(false);
    }
  };

  const resetState = async () => {
    const picks = Object.entries(resetOpts).filter(([_, v]) => v).map(([k]) => k);
    if (picks.length === 0) {
      toast.error("Pick at least one thing to reset.");
      return;
    }
    if (!window.confirm(
      `Reset the following — books and EPUBs stay, only this metadata is cleared:\n\n` +
      picks.map(p => "  • " + p.replace(/^reset_/, "").replace(/_/g, " ")).join("\n") +
      "\n\nProceed?"
    )) return;
    setResetting(true);
    const t = toast.loading("Resetting…");
    try {
      const { data } = await api.post("/books/reset-state", resetOpts, { timeout: 600000 });
      const parts = [];
      if (data.books_progress_cleared) parts.push(`${data.books_progress_cleared} books · progress wiped`);
      if (data.books_tags_cleared) parts.push(`${data.books_tags_cleared} books · tags cleared`);
      if (data.smart_shelves_deleted) parts.push(`${data.smart_shelves_deleted} smart shelves removed`);
      if (data.versions_collapsed) parts.push(`${data.versions_collapsed} versions collapsed`);
      toast.success(parts.join(" · ") || "Nothing to reset", { id: t });
      setResetOpts({ reset_progress: false, reset_tags: false, reset_smart_shelves: false, reset_versions: false });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't reset", { id: t });
    } finally {
      setResetting(false);
    }
  };

  const wipeLibrary = async () => {
    const phrase = window.prompt(
      "This will PERMANENTLY delete every book in your library — EPUBs, covers, reading history, smart shelves, the lot.\n\nThis cannot be undone.\n\nType DELETE EVERYTHING (in capitals, exactly) to confirm:",
    );
    if (phrase !== "DELETE EVERYTHING") {
      if (phrase !== null) toast.error("Phrase didn't match. Nothing was deleted.");
      return;
    }
    setWiping(true);
    const t = toast.loading("Wiping library…");
    try {
      const { data } = await api.post("/books/wipe-library", { confirm: "DELETE_EVERYTHING" }, { timeout: 600000 });
      toast.success(data.message || "Library wiped.", { id: t });
      setTimeout(() => { window.location.href = "/library"; }, 1500);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't wipe library", { id: t });
    } finally {
      setWiping(false);
    }
  };

  // Full account deletion — separate from wipeLibrary. Requires the user
  // to type their own email into the confirmation field; backend re-checks
  // that match server-side so a tampered frontend can't bypass.
  const deleteAccount = async () => {
    if (!confirmEmailInput.trim()) {
      toast.error("Type your email to confirm.");
      return;
    }
    if (confirmEmailInput.trim().toLowerCase() !== (profile?.email || "").trim().toLowerCase()) {
      toast.error("That doesn't match your account email.");
      return;
    }
    if (!window.confirm(
      "Your account will be SCHEDULED for deletion in 30 days. You'll be signed out now; sign back in any time during the next 30 days to cancel.\n\nBooks and files are NOT touched until day 30.\n\nClick OK to schedule."
    )) return;
    setDeletingAccount(true);
    const t = toast.loading("Scheduling deletion…");
    try {
      const { data } = await api.post("/account/delete", { confirm_email: confirmEmailInput.trim() });
      const when = data?.scheduled_deletion_at ? new Date(data.scheduled_deletion_at).toLocaleString(undefined, { dateStyle: "long" }) : "in 30 days";
      toast.success(`Account scheduled for deletion on ${when}. Signing you out…`, { id: t, duration: 6000 });
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't schedule deletion", { id: t });
      setDeletingAccount(false);
    }
  };

  const tidyFilenames = async () => {
    if (!window.confirm(
      "Rename every book's display filename to 'Title_by_Author-<id>.epub'? Books that already match are skipped."
    )) return;
    setTidyingNames(true);
    const t = toast.loading("Tidying filenames…");
    try {
      const { data } = await api.post("/user/tidy-filenames", {}, { timeout: 600000 });
      const parts = [];
      if (data.updated > 0) parts.push(`${data.updated} renamed`);
      if (data.already_correct > 0) parts.push(`${data.already_correct} already correct`);
      toast.success(parts.join(" · ") || "Nothing to rename", { id: t });
    } catch (e) {
      toast.error("Couldn't tidy filenames — try again later", { id: t });
    } finally {
      setTidyingNames(false);
    }
  };

  const applyTemplateToAll = async () => {
    if (!window.confirm(
      "Re-template every existing book on your library? Already-templated copies are skipped automatically. This may take a minute for large libraries."
    )) return;
    setApplyingTpl(true);
    const t = toast.loading("Applying template to all books…");
    try {
      const { data } = await api.post("/user/apply-template-to-all", {}, { timeout: 600000 });
      const parts = [];
      if (data.templated > 0) parts.push(`${data.templated} updated`);
      if (data.already_templated > 0) parts.push(`${data.already_templated} already templated`);
      if (data.errors > 0) parts.push(`${data.errors} errors`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped (no EPUB file)`);
      toast.success(parts.join(" · ") || "Done — nothing to do", { id: t });
    } catch (e) {
      toast.error("Couldn't apply template — try again later", { id: t });
    } finally {
      setApplyingTpl(false);
    }
  };

  const saveName = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === profile?.name) return;
    setSavingName(true);
    try {
      await api.patch("/auth/profile", { name: name.trim() });
      toast.success("Name updated");
      setProfile((p) => ({ ...p, name: name.trim() }));
      setUser((u) => (u ? { ...u, name: name.trim() } : u));
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingName(false);
    }
  };

  const saveBio = async (e) => {
    e.preventDefault();
    const trimmed = (bio || "").trim();
    if (trimmed === (profile?.bio || "").trim()) return; // no change
    setSavingBio(true);
    try {
      const { data } = await api.put("/account/bio", { bio: trimmed });
      toast.success(trimmed ? "Bio updated" : "Bio cleared");
      setProfile((p) => ({ ...p, bio: data?.bio || "" }));
      // Mirror to auth context if it carries bio (added 2026-06-26 evening).
      setUser((u) => (u ? { ...u, bio: data?.bio || "" } : u));
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingBio(false);
    }
  };

  // Debounced availability check for the username input.
  useEffect(() => {
    if (!usernameInput) {
      setUsernameStatus({ ok: null, reason: null });
      return;
    }
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/auth/username-available", { params: { handle: usernameInput } });
        setUsernameStatus({ ok: !!data.available, reason: data.reason || null });
      } catch {
        setUsernameStatus({ ok: false, reason: "Couldn't check availability" });
      }
    }, 350);
    return () => clearTimeout(id);
  }, [usernameInput]);

  const saveUsername = async (e) => {
    e?.preventDefault?.();
    const handle = (usernameInput || "").trim();
    if (!handle) return;
    setSavingUsername(true);
    try {
      const { data } = await api.patch("/auth/username", { username: handle });
      const updated = {
        ...profile,
        username: data.username,
        previous_username: data.previous_username,
      };
      setProfile(updated);
      setUser((u) => (u ? { ...u, username: data.username, previous_username: data.previous_username } : u));
      setUsernameInput("");
      setUsernameStatus({ ok: null, reason: null });
      // Three-branch confirmation toast:
      //  - First-time claim + visible in directory → "Listed!" with a
      //    "View directory" action so the user can immediately see
      //    proof their handle is live.
      //  - First-time claim + hidden_from_search → confirm save but
      //    explicitly call out that the directory is opted-out so
      //    they aren't confused why they don't appear.
      //  - Rename of an existing handle → keep the neutral "Username
      //    changed" toast (no directory mention).
      //
      // Privacy lives in a different component (PrivacyCard), so we
      // fetch the current value inline.  Single extra GET, only on
      // the save path — cheap.
      const isFirstClaim = !profile?.username;
      if (isFirstClaim) {
        let hidden = false;
        try {
          const { data: priv } = await api.get("/account/privacy");
          hidden = !!priv?.hidden_from_search;
        } catch { /* assume visible on fetch failure */ }
        if (!hidden) {
          toast.success("Listed in the reader directory!", {
            description: `Friends can now find you by @${data.username}.`,
            duration: 8000,
            action: {
              label: "View directory",
              onClick: () => navigate("/users"),
            },
          });
        } else {
          toast.success("Handle saved.", {
            description: "You're hidden from the public directory — turn that off in Privacy to be discoverable.",
            duration: 8000,
          });
        }
      } else {
        toast.success("Username changed");
      }
    } catch (err) {
      toast.error(errMsg(err?.response?.data?.detail));
    } finally { setSavingUsername(false); }
  };

  const clearPreviousUsername = async () => {
    setClearingPrev(true);
    try {
      await api.delete("/auth/previous-username");
      setProfile((p) => ({ ...p, previous_username: null }));
      setUser((u) => (u ? { ...u, previous_username: null } : u));
      toast.success("Old handle removed");
    } catch (err) {
      toast.error(errMsg(err?.response?.data?.detail));
    } finally { setClearingPrev(false); }
  };

  const suggestUsername = async () => {
    try {
      const { data } = await api.get("/auth/username-suggest");
      setUsernameInput(data.suggestion || "");
    } catch { /* non-blocking */ }
  };

  const changePw = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      toast.error("New passwords don't match");
      return;
    }
    setSavingPw(true);
    try {
      await api.post("/auth/change-password", { current_password: currentPw, new_password: newPw });
      toast.success("Password updated");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingPw(false);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <div className="text-center py-20 text-[#6B705C]">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">Account</p>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-3" data-testid="account-title">Your shelf, your settings.</h1>
        <p className="text-[#6B705C] mb-10">Signed in as <strong className="text-[#2C2C2C]">{profile.email}</strong></p>

        <LibraryStatsCard />

        <div className="mb-6" data-testid="fandom-treemap-section">
          <FandomTreemap />
        </div>

        <BackupCard />
        <CloudBackupCard />

        {/* Profile info */}
        <section className="shelf-card p-6 mb-6">
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1">Profile</h2>
          <p className="text-sm text-[#6B705C] mb-5">Change how your name shows up around Shelfsort.</p>
          <form onSubmit={saveName} className="space-y-3">
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
              <input
                type="email"
                value={profile.email}
                disabled
                className="w-full bg-[#F5F3EC] border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm text-[#6B705C]"
              />
            </div>
            <div className="relative">
              <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
              <input
                data-testid="profile-name-input"
                type="text"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
                className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              />
            </div>
            <button
              type="submit"
              data-testid="save-name-btn"
              disabled={savingName || !name.trim() || name.trim() === profile.name}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {savingName && <Loader2 className="w-4 h-4 animate-spin" />}
              Save name
            </button>
          </form>

          {/* Bio (about) — 2026-06-26 evening.  Surfaces on /u/<handle>,
              /u/<handle>/library, and the sign-in gate.  Capped at 280
              chars to keep it scannable. */}
          <form onSubmit={saveBio} className="space-y-2 mt-5 pt-5 border-t border-[#E8E6E1]">
            <label htmlFor="profile-bio-input" className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
              Bio
            </label>
            <textarea
              id="profile-bio-input"
              data-testid="profile-bio-input"
              value={bio}
              maxLength={280}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={2}
              placeholder="A short line about you — what you read, vibe, anything."
              className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20 resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#6B705C]">
                {bio.length}/280 — shown publicly on your library + cover profile.
              </span>
              <button
                type="submit"
                data-testid="save-bio-btn"
                disabled={savingBio || (bio || "").trim() === (profile.bio || "").trim()}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingBio && <Loader2 className="w-4 h-4 animate-spin" />}
                Save bio
              </button>
            </div>
          </form>
        </section>

        {/* Username (public handle) */}
        <section className="shelf-card p-6 mb-6" data-testid="username-card">
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1">Public handle</h2>
          <p className="text-sm text-[#6B705C] mb-4">
            Your <code className="bg-[#F5F3EC] px-1 py-0.5 rounded text-[12px]">@username</code> is how friends find you and how you show up across the app. Lowercase letters, numbers, and underscores — 3 to 20 characters.
          </p>
          {profile.username ? (
            <p className="text-sm text-[#2C2C2C] mb-4">
              Current: <strong className="font-mono" data-testid="current-username">@{profile.username}</strong>
              {profile.previous_username && (
                <span className="text-[#6B705C]">
                  {" "}(was <code className="font-mono" data-testid="previous-username">@{profile.previous_username}</code>
                  {" "}—{" "}
                  <button
                    onClick={clearPreviousUsername}
                    disabled={clearingPrev}
                    data-testid="clear-previous-username"
                    className="underline hover:text-[#2C2C2C]"
                  >hide</button>)
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-[#6B46C1] mb-4 flex items-center gap-2" data-testid="claim-username-hint">
              You haven&apos;t picked a handle yet.
              <button
                onClick={suggestUsername}
                className="text-xs underline hover:text-[#553B96]"
                data-testid="suggest-username-btn"
              >Suggest one</button>
            </p>
          )}
          <form onSubmit={saveUsername} className="space-y-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C] text-sm">@</span>
              <input
                data-testid="username-input"
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder={profile.username || "bookworm42"}
                maxLength={20}
                autoComplete="off"
                className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-7 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#6B46C1]/20"
              />
            </div>
            {usernameInput && usernameStatus.ok === true && (
              <p className="text-xs text-[#1F8F4E]" data-testid="username-available-msg">
                ✓ <code className="font-mono">@{usernameInput}</code> is available
              </p>
            )}
            {usernameInput && usernameStatus.ok === false && (
              <p className="text-xs text-[#B43F26]" data-testid="username-unavailable-msg">{usernameStatus.reason}</p>
            )}
            <button
              type="submit"
              data-testid="save-username-btn"
              disabled={savingUsername || !usernameInput || usernameStatus.ok !== true}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {savingUsername && <Loader2 className="w-4 h-4 animate-spin" />}
              {profile.username ? "Change handle" : "Claim handle"}
            </button>
          </form>
        </section>

        {/* Push notifications for cross-device reading handoff. */}
        <PushHandoffToggle />

        {/* Reading-data sharing opt-out (heatmap contributor toggle). */}
        <ReadingPrivacyToggle />

        {/* Email preferences link */}
        <section className="shelf-card p-6 mb-6" data-testid="email-prefs-link-card">
          <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex items-start gap-3 min-w-0 w-full sm:flex-1">
              <div className="w-10 h-10 rounded-xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
                <MailIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-xl sm:text-2xl text-[#2C2C2C]">Email preferences</h2>
                <p className="text-sm text-[#6B705C] mt-0.5">
                  Manage your weekly digest, fic-update alerts, and yearly recap — all in one place.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/account/emails")}
              className="btn-secondary text-sm whitespace-nowrap flex-shrink-0 self-center w-full sm:w-auto"
              data-testid="email-prefs-open-btn"
            >
              Manage
            </button>
          </div>
        </section>

        {/* Privacy & messaging */}
        <PrivacyMessagingCard navigate={navigate} />
        <AdminAccessCard />

        {/* E-reader sync (OPDS catalog) */}
        <CatalogSyncCard />

        {/* Send to Kindle (2026-06-22) — single-click EPUB → Kindle email.
            Gated on SEND_TO_KINDLE_UI_ENABLED so the card disappears
            cleanly while the feature is hidden (Resend quota brake). */}
        {SEND_TO_KINDLE_UI_ENABLED && <SendToKindleCard />}

        {/* FanFicFare options */}
        {FETCHING_UI_ENABLED && (
        <section className="shelf-card p-6 mb-6" data-testid="fff-options-card">
          <div className="flex items-start gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-[#EEF3EC] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Fanfic download options</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Tweak how Shelfsort builds EPUBs from AO3, FFN, SpaceBattles and the
                other 100+ supported sites. Applies to every refresh from now on —
                existing copies stay untouched.
              </p>
            </div>
          </div>

          {fff === null ? (
            <p className="text-sm text-[#6B705C] mt-4">Loading…</p>
          ) : (
            <div className="mt-5 space-y-3">
              {[
                {
                  key: "include_author_notes",
                  title: "Include author's notes",
                  blurb: "Keep the author's pre- and post-chapter commentary inside the EPUB.",
                },
                {
                  key: "include_images",
                  title: "Include images",
                  blurb: "Embed images linked in the story (only AO3 hosts these reliably).",
                },
                {
                  key: "keep_chapter_links",
                  title: "Keep external chapter links",
                  blurb: "Preserve in-text hyperlinks rather than flattening them to plain text.",
                },
                {
                  key: "apply_template",
                  title: "Use Shelfsort template",
                  blurb: "Add a clean intro page (title, author, source URL, chapter count) and apply the house stylesheet to every refresh.",
                },
                {
                  key: "try_fichub_fallback",
                  title: "FicHub fallback when FanFicFare fails",
                  blurb: "If FanFicFare can't fetch a fic (often because AO3 or FFnet rate-limited our server), Shelfsort will retry the same URL via fichub.net. FicHub fetches from their own infrastructure, so it usually works when ours doesn't. Fetched strictly one at a time with a 2-second gap to be polite to their service.",
                },
              ].map((opt) => (
                <div
                  key={opt.key}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl border border-[#E8E6E1] bg-[#FBFAF6]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#2C2C2C]">{opt.title}</p>
                    <p className="text-xs text-[#6B705C] mt-0.5">{opt.blurb}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!fff[opt.key]}
                    data-testid={`fff-toggle-${opt.key}`}
                    disabled={savingFff}
                    onClick={() => toggleFff(opt.key)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 ${
                      fff[opt.key] ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
                    } ${savingFff ? "opacity-60" : ""}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        fff[opt.key] ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}

          {fff !== null && (
            <div className="mt-5 pt-5 border-t border-[#E8E6E1] space-y-3">
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  onClick={applyTemplateToAll}
                  disabled={applyingTpl}
                  data-testid="apply-template-all-btn"
                  className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
                >
                  {applyingTpl ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Settings2 className="w-4 h-4" />
                  )}
                  {applyingTpl ? "Working…" : "Apply template to all my books"}
                </button>
                <p className="text-xs text-[#6B705C]">
                  Retroactively adds the intro page + house stylesheet to every existing EPUB. Idempotent.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  onClick={tidyFilenames}
                  disabled={tidyingNames}
                  data-testid="tidy-filenames-btn"
                  className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
                >
                  {tidyingNames ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Settings2 className="w-4 h-4" />
                  )}
                  {tidyingNames ? "Working…" : "Tidy filenames"}
                </button>
                <p className="text-xs text-[#6B705C]">
                  Renames display filenames to <span className="font-mono text-[10px]">Title_by_Author-id.epub</span>.
                </p>
              </div>
            </div>
          )}
        </section>
        )}

        {/* Password */}
        <section className="shelf-card p-6">
          <h2 className="font-serif text-2xl text-[#2C2C2C] mb-1">Password</h2>
          {profile.has_password ? (
            <>
              <p className="text-sm text-[#6B705C] mb-5">
                Change the password you use to sign in.
              </p>
              <form onSubmit={changePw} className="space-y-3">
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                  <input
                    data-testid="current-pw-input"
                    type="password"
                    required
                    placeholder="Current password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    autoComplete="current-password"
                    className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                  <input
                    data-testid="new-pw-input"
                    type="password"
                    required
                    minLength={8}
                    placeholder="New password (at least 8 characters)"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                    className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  />
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                  <input
                    data-testid="confirm-pw-input"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Confirm new password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    autoComplete="new-password"
                    className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  />
                </div>
                <button
                  type="submit"
                  data-testid="save-pw-btn"
                  disabled={savingPw || !currentPw || !newPw}
                  className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingPw && <Loader2 className="w-4 h-4 animate-spin" />}
                  Update password
                </button>
              </form>
            </>
          ) : (
            <p className="text-sm text-[#6B705C]">
              This account uses Google sign-in. Use{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="text-[#E07A5F] underline"
              >
                &ldquo;Forgot password&rdquo;
              </button>{" "}
              from the sign-in page to set one.
            </p>
          )}
        </section>

        {/* Duplicate handling default policy */}
        <section className="shelf-card p-6 mb-6" data-testid="duplicate-policy-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Duplicate handling</h2>
              <p className="text-sm text-[#6B705C] mt-1">
                When an upload matches a book already on your shelves, what should happen by default?
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Default duplicate policy">
            {[
              { val: "ask", label: "Ask me each time", desc: "Pop the duplicate-resolution modal (current behavior)." },
              { val: "keep_both", label: "Keep both copies", desc: "Just add the upload alongside, no questions asked." },
              { val: "discard", label: "Send to Trash", desc: "Move duplicates to Trash for 30 days, then auto-delete." },
              { val: "new_version", label: "Replace as new version", desc: "Archive the existing copy, put upload on a dated shelf." },
              { val: "historical", label: "Link as historical version", desc: "Archive the upload under the existing copy." },
            ].map((opt) => (
              <button
                key={opt.val}
                data-testid={`dupe-policy-${opt.val}`}
                onClick={async () => {
                  if (dupePolicy === opt.val) return;
                  setSavingDupePolicy(true);
                  const prev = dupePolicy;
                  setDupePolicy(opt.val);
                  try {
                    await api.put("/user/duplicate-policy", { policy: opt.val });
                    toast.success("Default updated");
                  } catch (e) {
                    setDupePolicy(prev);
                    toast.error("Couldn't save");
                  } finally {
                    setSavingDupePolicy(false);
                  }
                }}
                disabled={savingDupePolicy}
                className={`text-left p-3 rounded-lg border transition ${
                  dupePolicy === opt.val
                    ? "border-[#E07A5F] bg-[#FDF3E1]"
                    : "border-[#E5DDC5] hover:border-[#E07A5F]/50"
                } ${savingDupePolicy ? "opacity-60" : ""}`}
              >
                <div className="font-medium text-sm text-[#2C2C2C]">{opt.label}</div>
                <p className="text-xs text-[#6B705C] mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Non-EPUB upload preferences — per-format default action */}
        <UploadChimeCard />

        <section className="shelf-card p-6 mb-6" data-testid="format-prefs-card">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Non-EPUB upload preferences</h2>
              <p className="text-sm text-[#6B705C] mt-1">
                EPUBs always upload silently. For everything else, Shelfsort
                <strong className="font-medium"> never auto-converts</strong> — every
                non-EPUB upload prompts you per format group (Convert to EPUB · Keep
                original on the <Link to="/library/originals" className="underline">Originals shelf</Link> · Skip).
                Set a group to <em>Skip</em> here if you want it dropped silently without a prompt.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { key: "pdf", label: "PDF", exts: ".pdf" },
              { key: "kindle", label: "Kindle", exts: ".mobi .azw .azw3 .kf8 .kfx" },
              { key: "word", label: "Word / RTF", exts: ".docx .doc .rtf" },
              { key: "other_ebook", label: "Other ebook", exts: ".fb2 .lit .lrf .pdb" },
              { key: "txt", label: "Plain text", exts: ".txt (URL lists are deduped instead)" },
              { key: "html", label: "HTML", exts: ".html .htm" },
            ].map((grp) => {
              const cur = (formatPrefs && formatPrefs[grp.key]) || "ask";
              return (
                <div
                  key={grp.key}
                  data-testid={`format-row-${grp.key}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[#E5DDC5] bg-white"
                >
                  <div className="min-w-[140px]">
                    <div className="text-sm font-medium text-[#2C2C2C]">{grp.label}</div>
                    <div className="text-xs text-[#6B705C] font-mono">{grp.exts}</div>
                  </div>
                  <div className="flex gap-1.5" role="radiogroup" aria-label={`${grp.label} preference`}>
                    {[
                      { val: "ask", label: "Ask" },
                      { val: "skip", label: "Skip" },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        data-testid={`format-${grp.key}-${opt.val}`}
                        onClick={async () => {
                          if (cur === opt.val) return;
                          const prev = formatPrefs || {};
                          setFormatPrefs({ ...prev, [grp.key]: opt.val });
                          setSavingFormatPrefs(true);
                          try {
                            const { data } = await api.put("/user/format-prefs", { [grp.key]: opt.val });
                            setFormatPrefs(data);
                          } catch (e) {
                            setFormatPrefs(prev);
                            toast.error("Couldn't save");
                          } finally {
                            setSavingFormatPrefs(false);
                          }
                        }}
                        disabled={savingFormatPrefs}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                          cur === opt.val
                            ? "bg-[#E07A5F] text-white"
                            : "bg-[#FDF3E1] text-[#6B705C] hover:bg-[#E07A5F]/10 hover:text-[#E07A5F]"
                        } ${savingFormatPrefs ? "opacity-60" : ""}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Polish my library — bulk metadata cleanup, runs on the EPUB file too */}
        <section className="shelf-card p-6 mb-6" data-testid="polish-library-card">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EDE7FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Polish my library</h2>
              <p className="text-sm text-[#6B705C] mt-1">
                Scan for books whose title still looks like a filename or whose author is&nbsp;
                <em>Unknown</em>, and suggest cleaner values inferred from the file or source URL.
                You preview every change before applying — corrections are written into the EPUB
                itself, so they travel with the file.
              </p>
            </div>
            <button
              data-testid="polish-library-btn"
              onClick={() => navigate("/library/polish")}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#6B46C1] text-white hover:bg-[#5b3aa5] flex-shrink-0"
            >
              Scan library
            </button>
          </div>
        </section>

        {/* Find duplicates — scan the library for matching books */}
        <section className="shelf-card p-6 mb-6" data-testid="find-duplicates-card">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Find duplicates</h2>
              {dupeCount && dupeCount.total_groups > 0 ? (
                <p
                  data-testid="find-duplicates-count"
                  className="text-sm text-amber-700 mt-1 font-medium"
                >
                  {dupeCount.total_groups} possible duplicate group{dupeCount.total_groups === 1 ? "" : "s"} found across {dupeCount.total_dupe_books} books.
                </p>
              ) : dupeCount && dupeCount.total_groups === 0 ? (
                <p data-testid="find-duplicates-count" className="text-sm text-[#6B705C] mt-1">
                  No duplicates spotted right now.
                </p>
              ) : (
                <p className="text-sm text-[#6B705C] mt-1">
                  Scan your library for books that share a title, source URL, or fanfic permalink — pick a keeper, archive or delete the rest.
                </p>
              )}
            </div>
            <button
              data-testid="find-duplicates-btn"
              onClick={() => navigate("/account/duplicates")}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] flex-shrink-0"
            >
              {dupeCount && dupeCount.total_groups > 0 ? "Review duplicates" : "Scan library"}
            </button>
          </div>
        </section>

        {/* Canonicalize crossover fandoms — collapse "Harry Potter & Twilight"
            and "Twilight/Harry Potter" into a single shelf so crossovers file
            together everywhere. */}
        <section className="shelf-card p-6 mb-6" data-testid="canonicalize-crossovers-card">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Merge crossover fandoms</h2>
              <p className="text-sm text-[#6B705C] mt-1">
                Books tagged &ldquo;Harry Potter &amp; Twilight&rdquo; and &ldquo;Twilight/Harry Potter&rdquo; will be unified
                into the same canonical shelf (&ldquo;Harry Potter / Twilight&rdquo;). New uploads do this
                automatically — this is for cleaning up older imports.
              </p>
            </div>
            <button
              data-testid="canonicalize-crossovers-btn"
              onClick={async () => {
                try {
                  const { data } = await api.post("/fandoms/canonicalize-crossovers");
                  if (data.updated > 0) {
                    const examples = (data.mappings || []).slice(0, 3).map((m) => `${m.from} → ${m.to}`).join(", ");
                    toast.success(
                      `Merged ${data.updated} book${data.updated === 1 ? "" : "s"} across ${data.mappings.length} crossover${data.mappings.length === 1 ? "" : "s"}${examples ? `. e.g. ${examples}` : ""}`,
                      { duration: 8000 },
                    );
                  } else {
                    toast(`Scanned ${data.scanned} book${data.scanned === 1 ? "" : "s"} — nothing to merge`);
                  }
                } catch (e) {
                  toast.error("Merge failed — try again");
                }
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] flex-shrink-0"
            >
              Run merge
            </button>
          </div>
        </section>

        {/* Release notes — publish the "What's new" card shown on Help.
            Admin-only; non-admin users don't see this section at all. */}
        {profile?.is_admin && <AnnouncementsCard />}

        {/* Fandom aliases — manual mappings applied during canonicalization */}
        <section className="shelf-card p-6 mb-6" data-testid="fandom-aliases-card">
          <FandomAliasesCard />
        </section>

        {/* Reset library state — selective wipe of metadata, books stay */}
        <section
          className="shelf-card p-6 mb-6"
          data-testid="reset-state-card"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Reset library state</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Wipe selected metadata while keeping every book + EPUB intact.
                Useful when sharing/cloning a library without your private reading habits.
              </p>
            </div>
          </div>
          <div className="space-y-2 mt-4">
            {[
              { key: "reset_progress", label: "Reading progress", blurb: "Bookmarks, time spent, streak history." },
              { key: "reset_tags", label: "Tags", blurb: "Clear every tag you've added to every book." },
              { key: "reset_smart_shelves", label: "Smart shelves", blurb: "Delete your saved smart-shelf queries." },
              { key: "reset_versions", label: "Version history", blurb: "Collapse 'Old stories' + dated 'Updated stories' back into one category." },
            ].map((opt) => (
              <label
                key={opt.key}
                className="flex items-start gap-3 p-3 rounded-xl border border-[#E8E6E1] bg-[#FBFAF6] cursor-pointer hover:border-[#B87A00]/40"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={resetOpts[opt.key]}
                  data-testid={`reset-opt-${opt.key}`}
                  onChange={(e) => setResetOpts((s) => ({ ...s, [opt.key]: e.target.checked }))}
                />
                <div>
                  <p className="text-sm font-semibold text-[#2C2C2C]">{opt.label}</p>
                  <p className="text-xs text-[#6B705C]">{opt.blurb}</p>
                </div>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={resetState}
            disabled={resetting}
            data-testid="reset-state-btn"
            className="mt-4 px-4 py-2 rounded-xl bg-[#B87A00] hover:bg-[#9D6A00] text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60 transition-colors"
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
            {resetting ? "Resetting…" : "Reset selected"}
          </button>
        </section>

        {/* Danger zone — wipe entire library */}
        <section
          className="shelf-card p-6 mb-6 border-2 border-[#D9534F]/30"
          data-testid="danger-zone-card"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#FBE9E7] text-[#D9534F] flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Danger zone</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Permanently delete every book in your library. EPUBs, covers,
                reading history, smart shelves, and custom categories all go.
                Your account stays — only the books are wiped. <strong>This cannot be undone.</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={wipeLibrary}
            disabled={wiping}
            data-testid="wipe-library-btn"
            className="px-4 py-2 rounded-xl bg-[#D9534F] hover:bg-[#B53C39] text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60 transition-colors"
          >
            {wiping ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            {wiping ? "Wiping…" : "Delete entire library"}
          </button>
        </section>

        {/* Account deletion — completely separate from library wipe.       */}
        {/* Removes the user record, sessions, password tokens, and every  */}
        {/* book/file. Requires the user to type their email to confirm.  */}
        <section
          className="shelf-card p-6 mb-6 border-2 border-[#D9534F]/60"
          data-testid="delete-account-card"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#FBE9E7] text-[#D9534F] flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-[#2C2C2C]">Delete account permanently</h2>
              <p className="text-sm text-[#6B705C] mt-0.5">
                Schedules your account for deletion in <strong>30 days</strong>. You&apos;ll be signed out immediately, but books and files are kept untouched during the grace window — sign back in any time during those 30 days to cancel. After day 30, everything is purged: login credentials, profile, library, files, reading history, smart shelves, custom categories, sessions. <strong>No undo after day 30.</strong>
              </p>
            </div>
          </div>
          {confirmEmailInput.trim() && (
            <div
              data-testid="delete-account-backup-nag"
              className="mb-3 p-3 rounded-lg bg-[#FDF3E1] border border-[#B87A00]/40 text-xs text-[#8C5C00] flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                <strong>Heads up</strong> — download a library backup first if you might ever want this data back.
                After day 30 the ZIP is your only recovery. <a href="#backup-card" onClick={(e) => { e.preventDefault(); document.getElementById("backup-card")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="underline font-semibold">Jump to backup card →</a>
              </p>
            </div>
          )}
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#D9534F] mb-1.5">Type your email to confirm</p>
          <input
            type="email"
            value={confirmEmailInput}
            onChange={(e) => setConfirmEmailInput(e.target.value)}
            placeholder={profile?.email || "you@example.com"}
            data-testid="delete-account-email-input"
            className="w-full md:w-96 px-3 py-2 rounded-lg border border-[#D9534F]/40 bg-white text-sm text-[#2C2C2C] focus:outline-none focus:border-[#D9534F] mb-3"
          />
          <div>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deletingAccount || !confirmEmailInput.trim()}
              data-testid="delete-account-btn"
              className="px-4 py-2 rounded-xl bg-[#D9534F] hover:bg-[#B53C39] text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60 transition-colors"
            >
              {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              {deletingAccount ? "Scheduling…" : "Schedule deletion (30-day grace)"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
