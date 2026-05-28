import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { BookOpen, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

function errMsg(detail) {
  if (!detail) return "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(detail);
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setUser } = useAuth();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/reset-password", { token, password });
      setUser({
        user_id: data.user_id,
        email: data.email,
        name: data.name,
        picture: data.picture,
      });
      setDone(true);
      setTimeout(() => navigate("/library"), 1400);
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-6 text-center">
        <div className="max-w-md">
          <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
          <h1 className="font-serif text-3xl text-[#2C2C2C] mb-3">Reset link missing</h1>
          <p className="text-[#6B705C] mb-6">
            The reset link you used doesn't include a token. Try requesting a new email.
          </p>
          <Link to="/login" className="btn-primary text-sm">Back to sign-in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm fade-in">
        <div className="flex items-center gap-2 mb-10">
          <BookOpen className="w-7 h-7 text-[#E07A5F]" />
          <span className="font-serif text-2xl">Shelfsort</span>
        </div>

        {done ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-[#E5EBE6] text-[#3A5A40] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="font-serif text-3xl text-[#2C2C2C] mb-3">Password updated</h1>
            <p className="text-[#6B705C]">Taking you to your library…</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-3">
              Almost there
            </p>
            <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">Choose a new password.</h1>
            <p className="text-[#6B705C] mb-8">At least 8 characters. You'll be signed in once it's saved.</p>

            <form onSubmit={submit} className="space-y-3">
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="reset-password-input"
                  type="password"
                  required
                  minLength={8}
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="reset-confirm-input"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-white border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                />
              </div>
              <button
                type="submit"
                data-testid="reset-submit-btn"
                disabled={busy}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Save new password
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
