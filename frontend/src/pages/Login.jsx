import React, { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { BookOpen, Mail, Lock, User as UserIcon, AtSign, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import SiteFooter from "../components/SiteFooter";

function errMsg(detail) {
  if (!detail) return "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(detail);
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginSuccess } = useAuth();
  // 2026-06-20 — Read ?ref= synchronously in the state initializer so the
  // very first render is already in REGISTER mode for invite-link visitors.
  // Previously we flipped via a useEffect after mount, which caused a
  // visible "Sign in" flash (and on slow devices, users could submit the
  // login form before the effect landed — the "2/3 times it stays in
  // sign-in mode" bug reported during the HP-fanfic FB-post dry-run).
  const initialRef = (() => {
    if (typeof window === "undefined") return "";
    try {
      const params = new URLSearchParams(window.location.search);
      return (params.get("ref") || "").trim().toLowerCase().slice(0, 40);
    } catch {
      return "";
    }
  })();
  const [mode, setMode] = useState(initialRef ? "register" : "login"); // "login" | "register" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingNotice, setPendingNotice] = useState(null);
  const [rejectedNotice, setRejectedNotice] = useState(null);

  // 2026-06-18 — admin-controlled signup config drives whether the
  // register form shows onboarding questions and the rules-accept
  // checkbox.  Pulled once on mount; the form re-fetches every time
  // the user flips into ``register`` mode so a freshly-flipped admin
  // toggle is honored without a hard refresh.
  const [signupCfg, setSignupCfg] = useState({
    approval_gate_enabled: true,
    questions_enabled: false,
  });
  const [registerStep, setRegisterStep] = useState(1); // 1 = email/pw, 2 = onboarding
  const [referral, setReferral] = useState(initialRef);
  const [favoriteFandom, setFavoriteFandom] = useState("");
  const [readerType, setReaderType] = useState("");
  const [is13Plus, setIs13Plus] = useState(null); // true | false | null
  const [acceptedRules, setAcceptedRules] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/signup/config")
      .then(({ data }) => {
        if (mounted) setSignupCfg(data);
      })
      .catch(() => { /* fall back to defaults */ });
    return () => { mounted = false; };
  }, [mode]);

  // 2026-06-18 — Tracked invite links.  Visiting /?ref=facebook (or
  // ?ref=hpfanfic, ?ref=bookstagram, etc.) auto-flips the form into
  // register mode AND pre-selects the onboarding "How did you find
  // Shelfsort?" answer.  When the answer matches a known channel
  // (google / twitter / reddit / facebook / tiktok / friend), the
  // matching radio is highlighted; arbitrary tags (e.g. ?ref=hpfanfic)
  // are stored verbatim and surface in /admin/onboarding-stats.
  useEffect(() => {
    const ref = (searchParams.get("ref") || "").trim().toLowerCase();
    if (!ref) return;
    setMode("register");
    setReferral(ref.slice(0, 40));
  }, [searchParams]);

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/library";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    // 2026-06-20 — Fast-track for invite-link visitors.  When the
    // user arrived with ``?ref=...`` they've already self-selected
    // (they came from a known community/partner channel), so we skip
    // the onboarding questions panel and submit a minimal payload
    // straight from step 1.  Backend still requires ``accepted_rules``
    // and at least one ``onboarding`` answer; the referral itself
    // satisfies the "answer" check.  Rules consent is folded into
    // the submit-button microcopy below so the user sees the link.
    const inviteFastTrack = mode === "register" && !!referral;

    // Multi-step register flow: when onboarding questions are enabled
    // we collect email/pw on step 1, advance to a questions panel on
    // step 2, and POST /auth/register only when step 2 is submitted.
    if (
      mode === "register" &&
      signupCfg.questions_enabled &&
      registerStep === 1 &&
      !inviteFastTrack
    ) {
      if (!email || (password || "").length < 8) {
        toast.error("Email and 8+ char password are required");
        return;
      }
      setRegisterStep(2);
      return;
    }

    setBusy(true);
    try {
      if (mode === "forgot") {
        await api.post("/auth/forgot-password", { email });
        toast.success("If that email is registered, a reset link is on its way.");
        setMode("login");
        return;
      }
      const url = mode === "login" ? "/auth/login" : "/auth/register";
      let body;
      if (mode === "login") {
        body = { email, password };
      } else {
        body = { email, password, name: name || undefined };
        if (signupCfg.questions_enabled && !inviteFastTrack) {
          if (!acceptedRules) {
            toast.error("Please agree to the community rules.");
            setBusy(false);
            return;
          }
          body.accepted_rules = true;
          body.onboarding = {
            referral:        referral || undefined,
            favorite_fandom: favoriteFandom || undefined,
            reader_type:     readerType || undefined,
            is_13_plus:      is13Plus,
          };
        } else if (inviteFastTrack) {
          // Invite-link fast-track: rules consent is implicit via the
          // disclaimer microcopy near the submit button.  Backend
          // requires ``accepted_rules`` whenever questions_enabled is
          // True, so we set it explicitly here; ``referral`` itself
          // counts as a valid onboarding answer.
          body.accepted_rules = true;
          body.onboarding = { referral };
        } else if (referral) {
          // Tracked invite links still record the referral source
          // even when onboarding questions are disabled — otherwise
          // ?ref=facebook links would silently lose their attribution.
          body.onboarding = { referral };
        }
      }
      const { data } = await api.post(url, body);

      if (data?.pending) {
        setPendingNotice({
          email: data.email || email,
          name: data.name || name,
          message: data.message || "Your account is pending admin approval.",
        });
        return;
      }

      loginSuccess(data);
      toast.success(mode === "login" ? "Welcome back" : "Account created");
      navigate("/library");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 403 && detail && typeof detail === "object") {
        if (detail.code === "pending_approval") {
          setPendingNotice({ email, name: "", message: detail.message });
          return;
        }
        if (detail.code === "rejected") {
          setRejectedNotice({ email, reason: detail.reason || "" });
          return;
        }
      }
      toast.error(errMsg(detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-paper">
      <div className="hidden md:block relative">
        <img
          src="https://static.prod-images.emergentagent.com/jobs/a7cbf064-1bb1-48e6-b642-01b29d2915a4/images/69b714e80ad3526797631c1c9c820d1ffe10c66de28dc4bc99a11bde433fe454.png"
          alt="Reading corner"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#2C2C2C]/30 via-transparent to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 text-white">
          <p className="font-serif text-3xl lg:text-4xl leading-tight">
            "A library is a hospital for the mind."
          </p>
          <p className="text-sm mt-3 opacity-80">— ancient Greek proverb</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 md:p-16">
        <div className="w-full max-w-sm fade-in">
          <div className="flex items-center gap-2 mb-10">
            <BookOpen className="w-7 h-7 text-[#E07A5F]" />
            <span className="font-serif text-2xl">Shelfsort</span>
          </div>

          {pendingNotice ? (
            <div data-testid="pending-approval-panel">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
                Almost there
              </p>
              <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">Pending admin approval.</h1>
              <p className="text-[#5B5F4D] mb-6">
                Shelfsort is invite-only right now. We&apos;ve queued your sign-up{pendingNotice.email ? ` for ${pendingNotice.email}` : ""} for an admin to review.
                You&apos;ll get an email at that address once it&apos;s approved — usually within a day.
              </p>
              <div className="rounded-2xl border border-[#E5DDC5] bg-[#FBFAF6] p-4 mb-6">
                <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-1">What happens next</p>
                <ol className="text-sm text-[#2C2C2C] space-y-1.5 list-decimal list-inside">
                  <li>An admin reviews your sign-up.</li>
                  <li>You get an email with the result.</li>
                  <li>If approved, sign in here with your password.</li>
                </ol>
              </div>
              <button
                type="button"
                onClick={() => { setPendingNotice(null); setMode("login"); }}
                data-testid="pending-back-to-login"
                className="text-sm font-semibold text-[#6B46C1] hover:text-[#553397]"
              >
                ← Back to sign in
              </button>
            </div>
          ) : rejectedNotice ? (
            <div data-testid="rejected-panel">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#D9534F] mb-3">
                Not approved
              </p>
              <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">Sign-up declined.</h1>
              <p className="text-[#5B5F4D] mb-4">
                The admin team reviewed{rejectedNotice.email ? ` ${rejectedNotice.email}` : " your sign-up"} and decided not to approve the account.
              </p>
              {rejectedNotice.reason ? (
                <div className="rounded-2xl border border-[#D9534F]/40 bg-[#FBE9E5] p-4 mb-6" data-testid="rejected-reason">
                  <p className="text-xs uppercase tracking-wider text-[#B43F26] mb-1">Reason</p>
                  <p className="text-sm text-[#7A2417]">{rejectedNotice.reason}</p>
                </div>
              ) : (
                <p className="text-sm text-[#5B5F4D] italic mb-6">No reason was provided.</p>
              )}
              <p className="text-sm text-[#5B5F4D] mb-6">
                If you think this was a mistake, you can{" "}
                <button
                  type="button"
                  onClick={() => { setRejectedNotice(null); setMode("register"); setPassword(""); }}
                  data-testid="rejected-reregister"
                  className="font-semibold text-[#6B46C1] hover:text-[#553397] underline-offset-2 hover:underline"
                >
                  re-register here
                </button>.
              </p>
              <button
                type="button"
                onClick={() => { setRejectedNotice(null); setMode("login"); }}
                className="text-sm font-semibold text-[#5B5F4D] hover:text-[#2C2C2C]"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
          <>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            {mode === "login"
              ? "Welcome back"
              : mode === "register"
              ? (registerStep === 2 ? "Quick intro" : "Make a shelf")
              : "Forgot your password?"}
          </p>
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">
            {mode === "login"
              ? "Open your library."
              : mode === "register"
              ? (registerStep === 2 ? "Tell us about you." : "Start your library.")
              : "We'll send a link."}
          </h1>
          <p className="text-[#5B5F4D] mb-8">
            {mode === "login"
              ? "Sign in to save your sorted shelves across devices."
              : mode === "register"
              ? (registerStep === 2
                  ? "Four quick questions so we can shape Shelfsort to fit you."
                  : signupCfg.approval_gate_enabled
                  ? "Create an account or sign in with Google. Sign-ups are reviewed before activation."
                  : "Create an account or sign in with Google.")
              : "Enter the email on your account and we'll send a one-hour reset link."}
          </p>

          {mode === "register" && registerStep === 2 ? (
            <form
              onSubmit={submit}
              className="space-y-5"
              data-testid="onboarding-form"
            >
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-2 block">
                  How did you find Shelfsort?
                </label>
                <div className="grid grid-cols-2 gap-2" data-testid="onboarding-referral">
                  {[
                    ["google", "Google"],
                    ["twitter", "Twitter / X"],
                    ["reddit", "Reddit"],
                    ["facebook", "Facebook"],
                    ["friend", "A friend"],
                    ["tiktok", "TikTok"],
                    ["other", "Somewhere else"],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setReferral(val)}
                      data-testid={`onboarding-referral-${val}`}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        referral === val
                          ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                          : "bg-white text-[#2C2C2C] border-[#E8E6E1] hover:border-[#6B46C1]"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-2 block">
                  Favorite fanfic fandom (optional)
                </label>
                <input
                  type="text"
                  data-testid="onboarding-favorite-fandom"
                  value={favoriteFandom}
                  onChange={(e) => setFavoriteFandom(e.target.value.slice(0, 80))}
                  placeholder="e.g. Harry Potter, Star Wars, Marvel…"
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-2 block">
                  What kind of reader are you?
                </label>
                <div className="grid grid-cols-2 gap-2" data-testid="onboarding-reader-type">
                  {[
                    ["fanfic", "Mostly fanfic"],
                    ["original", "Mostly original"],
                    ["mix", "Healthy mix"],
                    ["organize", "Just organizing"],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setReaderType(val)}
                      data-testid={`onboarding-reader-type-${val}`}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        readerType === val
                          ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                          : "bg-white text-[#2C2C2C] border-[#E8E6E1] hover:border-[#6B46C1]"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-2 block">
                  Are you 13 or older?
                </label>
                <div className="flex gap-2" data-testid="onboarding-age">
                  {[
                    [true, "Yes, 13+"],
                    [false, "No, under 13"],
                  ].map(([val, lbl]) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setIs13Plus(val)}
                      data-testid={`onboarding-age-${val ? "yes" : "no"}`}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                        is13Plus === val
                          ? (val
                              ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                              : "bg-[#D9534F] text-white border-[#D9534F]")
                          : "bg-white text-[#2C2C2C] border-[#E8E6E1] hover:border-[#6B46C1]"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <label
                className="flex items-start gap-2 cursor-pointer select-none"
                data-testid="onboarding-rules-label"
              >
                <input
                  type="checkbox"
                  checked={acceptedRules}
                  onChange={(e) => setAcceptedRules(e.target.checked)}
                  data-testid="onboarding-rules-checkbox"
                  className="mt-1 accent-[#6B46C1]"
                />
                <span className="text-xs text-[#2C2C2C]">
                  I&apos;ve read and agree to the{" "}
                  <Link
                    to="/rules"
                    target="_blank"
                    className="text-[#6B46C1] font-semibold underline"
                    data-testid="onboarding-rules-link"
                  >
                    Shelfsort community rules
                  </Link>
                  .
                </span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRegisterStep(1)}
                  data-testid="onboarding-back-btn"
                  className="text-sm font-semibold text-[#5B5F4D] hover:text-[#2C2C2C]"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  data-testid="onboarding-submit-btn"
                  disabled={busy || !acceptedRules}
                  className="ml-auto btn-primary py-3 px-6 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create account
                </button>
              </div>
            </form>
          ) : (
          <>
          <button
            data-testid="google-signin-btn"
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border border-[#E8E6E1] hover:bg-[#F5F3EC] text-[#2C2C2C] font-medium px-5 py-3 rounded-xl transition-colors mb-5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 text-xs text-[#5B5F4D] mb-5">
            <span className="flex-1 h-px bg-[#E8E6E1]" />
            <span>or with email</span>
            <span className="flex-1 h-px bg-[#E8E6E1]" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
                <input
                  data-testid="auth-name-input"
                  type="text"
                  placeholder="Display name (optional, e.g. Beatrix Quill)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
            )}
            {mode === "register" && (
              <div className="relative">
                <AtSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
                <input
                  data-testid="auth-username-input"
                  type="text"
                  placeholder="username (optional, e.g. bookworm42)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={20}
                  autoComplete="off"
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
              <input
                data-testid="auth-email-input"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
              <input
                data-testid="auth-password-input"
                type="password"
                required={mode !== "forgot"}
                minLength={8}
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={`w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20 ${mode === "forgot" ? "hidden" : ""}`}
              />
            </div>
            {mode === "login" && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  data-testid="forgot-password-btn"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-[#5B5F4D] hover:text-[#E07A5F]"
                >
                  Forgot password?
                </button>
              </div>
            )}
            <button
              type="submit"
              data-testid="auth-submit-btn"
              disabled={busy}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "login"
                ? "Sign in"
                : mode === "register"
                ? (signupCfg.questions_enabled && !referral ? "Continue" : "Create account")
                : "Send reset link"}
            </button>
            {/* 2026-06-20 — Invite-link fast-track consent microcopy.
                When the user arrived with ?ref=... we skip the
                onboarding questions panel; rules consent is folded
                into this submit-button line so the user still sees
                the link and the 13+ age confirmation. */}
            {mode === "register" && referral && signupCfg.questions_enabled && (
              <p
                className="text-[11px] text-[#5B5F4D] mt-2 text-center leading-relaxed"
                data-testid="invite-fast-track-consent"
              >
                Welcome from your invite link! By creating an account you agree to the{" "}
                <Link to="/rules" className="text-[var(--primary)] underline">community rules</Link>
                {" "}and confirm you&apos;re 13 or older.
              </p>
            )}
          </form>
          </>
          )}

          <p className="text-xs text-[#5B5F4D] mt-6 text-center">
            {mode === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  data-testid="switch-to-register"
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-[#E07A5F] font-medium hover:underline"
                >
                  Create one
                </button>
              </>
            ) : mode === "register" ? (
              <>
                Already have an account?{" "}
                <button
                  data-testid="switch-to-login"
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-[#E07A5F] font-medium hover:underline"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Remembered it?{" "}
                <button
                  data-testid="back-to-login"
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-[#E07A5F] font-medium hover:underline"
                >
                  Back to sign-in
                </button>
              </>
            )}
          </p>
          </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
