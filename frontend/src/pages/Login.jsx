import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Mail, Lock, User as UserIcon, AtSign, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

function errMsg(detail) {
  if (!detail) return "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(detail);
}

export default function Login() {
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  // Approval-gate states (2026-06-15). When the backend tells us the
  // sign-up is pending or rejected we swap the whole right-hand panel
  // for a calm explainer instead of just toast-ing — toasts vanish and
  // users panic. ``rejected`` includes the admin's reason.
  const [pendingNotice, setPendingNotice] = useState(null);
  const [rejectedNotice, setRejectedNotice] = useState(null);

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/library";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "forgot") {
        await api.post("/auth/forgot-password", { email });
        toast.success("If that email is registered, a reset link is on its way.");
        setMode("login");
        return;
      }
      const url = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { email, password, name: name || undefined };
      const { data } = await api.post(url, body);

      // Register may have completed with the user landing in the
      // pending-approval queue; the backend signals that with
      // ``{pending: true, email, name, message}`` instead of a session.
      if (data?.pending) {
        setPendingNotice({
          email: data.email || email,
          name: data.name || name,
          message: data.message || "Your account is pending admin approval.",
        });
        return;
      }

      // Belt-and-suspenders: ``loginSuccess`` does ``setUser(data)``
      // immediately AND re-fetches /auth/me so any field the login
      // response dropped (e.g. ``is_admin`` pre-2026-06-15) self-heals
      // before the FE renders auth-gated UI like the AdminConsole button.
      loginSuccess(data);
      toast.success(mode === "login" ? "Welcome back" : "Account created");
      navigate("/library");
    } catch (err) {
      // 403 with structured detail = approval-gate refusal (login path).
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
              <p className="text-[#6B705C] mb-6">
                Shelfsort is invite-only right now. We&apos;ve queued your sign-up{pendingNotice.email ? ` for ${pendingNotice.email}` : ""} for an admin to review.
                You&apos;ll get an email at that address once it&apos;s approved — usually within a day.
              </p>
              <div className="rounded-2xl border border-[#E5DDC5] bg-[#FBFAF6] p-4 mb-6">
                <p className="text-xs uppercase tracking-wider text-[#6B705C] mb-1">What happens next</p>
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
              <p className="text-[#6B705C] mb-4">
                The admin team reviewed{rejectedNotice.email ? ` ${rejectedNotice.email}` : " your sign-up"} and decided not to approve the account.
              </p>
              {rejectedNotice.reason ? (
                <div className="rounded-2xl border border-[#D9534F]/40 bg-[#FBE9E5] p-4 mb-6" data-testid="rejected-reason">
                  <p className="text-xs uppercase tracking-wider text-[#B43F26] mb-1">Reason</p>
                  <p className="text-sm text-[#7A2417]">{rejectedNotice.reason}</p>
                </div>
              ) : (
                <p className="text-sm text-[#6B705C] italic mb-6">No reason was provided.</p>
              )}
              <p className="text-sm text-[#6B705C] mb-6">
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
                className="text-sm font-semibold text-[#6B705C] hover:text-[#2C2C2C]"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
          <>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            {mode === "login" ? "Welcome back" : mode === "register" ? "Make a shelf" : "Forgot your password?"}
          </p>
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">
            {mode === "login" ? "Open your library." : mode === "register" ? "Start your library." : "We'll send a link."}
          </h1>
          <p className="text-[#6B705C] mb-8">
            {mode === "login"
              ? "Sign in to save your sorted shelves across devices."
              : mode === "register"
              ? "Create an account or sign in with Google. Sign-ups are reviewed before activation."
              : "Enter the email on your account and we'll send a one-hour reset link."}
          </p>

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

          <div className="flex items-center gap-3 text-xs text-[#6B705C] mb-5">
            <span className="flex-1 h-px bg-[#E8E6E1]" />
            <span>or with email</span>
            <span className="flex-1 h-px bg-[#E8E6E1]" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="auth-name-input"
                  type="text"
                  placeholder="Display name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
            )}
            {mode === "register" && (
              <div className="relative">
                <AtSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="auth-username-input"
                  type="text"
                  placeholder="username (optional, e.g. ImCrazy)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={20}
                  autoComplete="off"
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
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
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
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
                  className="text-xs text-[#6B705C] hover:text-[#E07A5F]"
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
              {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}
            </button>
          </form>

          <p className="text-xs text-[#6B705C] mt-6 text-center">
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
    </div>
  );
}
