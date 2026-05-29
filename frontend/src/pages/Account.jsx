import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { User as UserIcon, Mail, Lock, Loader2, Mail as MailIcon, Send, Calendar } from "lucide-react";
import { toast } from "sonner";

function errMsg(d) {
  if (!d) return "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(d);
}

export default function Account() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Weekly digest settings
  const [digest, setDigest] = useState(null);
  const [savingDigest, setSavingDigest] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/profile");
        setProfile(data);
        setName(data.name || "");
      } catch (e) {
        toast.error("Couldn't load your profile");
        navigate("/login");
      }
      try {
        const { data: d } = await api.get("/user/digest-settings");
        setDigest(d);
      } catch (e) { /* ignore */ }
    })();
  }, [navigate]);

  const saveDigest = async (next) => {
    setSavingDigest(true);
    try {
      const { data } = await api.put("/user/digest-settings", next);
      setDigest((d) => ({ ...(d || {}), ...data }));
      toast.success(next.enabled === false ? "Weekly digest paused" : "Settings saved");
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingDigest(false);
    }
  };

  const sendPreview = async () => {
    setSendingPreview(true);
    try {
      const { data } = await api.post("/user/digest-preview");
      if (data.delivered) {
        toast.success(`Preview sent to ${profile.email}`);
      } else if (data.logged) {
        toast.warning("Email sending isn't configured on this server — but here's your digest summary in the console.");
        console.log("Digest summary:", data.summary);
      } else {
        toast.error("Couldn't send preview");
      }
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSendingPreview(false);
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
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2">Account</p>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-3" data-testid="account-title">Your shelf, your settings.</h1>
        <p className="text-[#6B705C] mb-10">Signed in as <strong className="text-[#2C2C2C]">{profile.email}</strong></p>

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
        </section>

        {/* Weekly digest */}
        <section className="shelf-card p-6 mb-6" data-testid="digest-settings-card">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
                <MailIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Weekly reading digest</h2>
                <p className="text-sm text-[#6B705C] mt-0.5">
                  A friendly recap emailed straight to <strong className="text-[#2C2C2C]">{profile.email}</strong>: what you opened, your top fandom, and the books still waiting at the bookmark.
                </p>
              </div>
            </div>
          </div>

          {digest === null ? (
            <p className="text-sm text-[#6B705C] mt-4">Loading…</p>
          ) : (
            <>
              {!digest.email_configured && (
                <p className="text-xs text-[#B87A00] bg-[#FDF3E1] rounded-lg p-3 mt-4" data-testid="digest-email-warning">
                  Email delivery isn't fully configured on this server yet. The schedule will save normally; once Resend is set up, your digests will start arriving.
                </p>
              )}

              <div className="mt-5 flex items-center justify-between gap-3 p-3 rounded-xl border border-[#E8E6E1] bg-white">
                <div>
                  <p className="text-sm font-semibold text-[#2C2C2C]">Send me a weekly digest</p>
                  <p className="text-xs text-[#6B705C]">You can stop these any time.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={digest.enabled}
                  data-testid="digest-toggle"
                  disabled={savingDigest}
                  onClick={() => saveDigest({ enabled: !digest.enabled })}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 ${
                    digest.enabled ? "bg-[#3A5A40]" : "bg-[#E8E6E1]"
                  } ${savingDigest ? "opacity-60" : ""}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      digest.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className={`mt-4 grid sm:grid-cols-2 gap-3 transition-opacity ${digest.enabled ? "opacity-100" : "opacity-50 pointer-events-none"}`}>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" /> Day of week
                  </label>
                  <select
                    data-testid="digest-day"
                    value={digest.day_of_week}
                    onChange={(e) => saveDigest({ day_of_week: Number(e.target.value) })}
                    disabled={!digest.enabled || savingDigest}
                    className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  >
                    {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
                    Time (UTC)
                  </label>
                  <select
                    data-testid="digest-hour"
                    value={digest.hour}
                    onChange={(e) => saveDigest({ hour: Number(e.target.value) })}
                    disabled={!digest.enabled || savingDigest}
                    className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                  >
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00 UTC
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {digest.last_sent_at && (
                <p className="text-xs text-[#6B705C] mt-3">
                  Last digest sent {new Date(digest.last_sent_at).toLocaleString()}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2 items-center border-t border-[#E8E6E1] pt-4">
                <button
                  type="button"
                  onClick={sendPreview}
                  disabled={sendingPreview}
                  data-testid="digest-send-preview"
                  className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
                >
                  {sendingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send me a preview now
                </button>
                <p className="text-xs text-[#6B705C]">
                  Useful for previewing the layout without waiting for the schedule.
                </p>
              </div>
            </>
          )}
        </section>

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
                "Forgot password"
              </button>{" "}
              from the sign-in page to set one.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
