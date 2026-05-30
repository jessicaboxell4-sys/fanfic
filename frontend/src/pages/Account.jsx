import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { User as UserIcon, Mail, Lock, Loader2, Mail as MailIcon, Settings2, AlertTriangle } from "lucide-react";
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

  // (Email preferences moved to /account/emails — handled in EmailPreferences.jsx)

  // FanFicFare options for fanfic downloads
  const [fff, setFff] = useState(null);
  const [savingFff, setSavingFff] = useState(false);
  const [applyingTpl, setApplyingTpl] = useState(false);
  const [tidyingNames, setTidyingNames] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOpts, setResetOpts] = useState({
    reset_progress: false,
    reset_tags: false,
    reset_smart_shelves: false,
    reset_versions: false,
  });

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
        const { data: f } = await api.get("/user/fff-options");
        setFff(f);
      } catch (e) { /* ignore */ }
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

        {/* Email preferences link */}
        <section className="shelf-card p-6 mb-6" data-testid="email-prefs-link-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#FDF3E1] text-[#B87A00] flex items-center justify-center flex-shrink-0">
                <MailIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-2xl text-[#2C2C2C]">Email preferences</h2>
                <p className="text-sm text-[#6B705C] mt-0.5">
                  Manage your weekly digest, fic-update alerts, and yearly recap — all in one place.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/account/emails")}
              className="btn-secondary text-sm whitespace-nowrap flex-shrink-0 self-center"
              data-testid="email-prefs-open-btn"
            >
              Manage
            </button>
          </div>
        </section>

        {/* FanFicFare options */}
        <section className="shelf-card p-6 mb-6" data-testid="fff-options-card">
          <div className="flex items-start gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-[#EEF3EC] text-[#3A5A40] flex items-center justify-center flex-shrink-0">
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
                      fff[opt.key] ? "bg-[#3A5A40]" : "bg-[#E8E6E1]"
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
      </main>
    </div>
  );
}
