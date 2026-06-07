import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { User as UserIcon, Mail, Lock, Loader2, Mail as MailIcon, Settings2, AlertTriangle, Layers, Plus, X as XIcon } from "lucide-react";
import LibraryStatsCard from "../components/LibraryStatsCard";
import FandomTreemap from "../components/FandomTreemap";
import { toast } from "sonner";

function errMsg(d) {
  if (!d) return "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(d);
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
                className="text-[#6B705C] hover:text-[#900] p-1"
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
          className="mt-4 text-xs text-[#2a6496] hover:text-[#900] underline"
        >
          Apply these aliases to existing books now
        </button>
      )}
    </>
  );
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

        <LibraryStatsCard />

        <div className="mb-6" data-testid="fandom-treemap-section">
          <FandomTreemap />
        </div>

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
      </main>
    </div>
  );
}
