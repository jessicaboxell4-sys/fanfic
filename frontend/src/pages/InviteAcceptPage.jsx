import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Mail, Check, Loader2, BookOpen, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Public-readable invite landing page. If the visitor is signed in, they
// click Accept and immediately become friends. If not, we show a sign
// in / register call-to-action (the invite token survives via the URL).
export default function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.get(`/invites/${token}`)
      .then(({ data }) => setInfo(data))
      .catch((e) => setError(e?.response?.data?.detail || "Invite not found"));
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    try {
      await api.post(`/invites/${token}/accept`);
      toast.success("You are now friends");
      navigate("/friends");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't accept invite");
    } finally { setAccepting(false); }
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE] flex flex-col items-center justify-center p-6" data-testid="invite-page">
      <div className="max-w-md w-full shelf-card p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center mb-4">
          <BookOpen className="w-7 h-7 text-[var(--primary)]" />
        </div>
        {error ? (
          <>
            <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">Invite unavailable</h1>
            <p className="text-sm text-[#6B705C]">{error}</p>
            <Link to="/" className="inline-block mt-6 text-sm text-[var(--primary)] underline">
              Go to Shelfsort
            </Link>
          </>
        ) : !info ? (
          <p className="text-sm text-[#6B705C]"><Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…</p>
        ) : info.status !== "pending" ? (
          <>
            <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">This invite is {info.status}</h1>
            <p className="text-sm text-[#6B705C]">Ask {info.inviter_name} to send a fresh one.</p>
            <Link to="/" className="inline-block mt-6 text-sm text-[var(--primary)] underline">Go to Shelfsort</Link>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-[#6B705C] font-semibold mb-2">Shelfsort invite</p>
            <h1 className="font-serif text-2xl text-[#2C2C2C] mb-3">
              <strong>{info.inviter_name}</strong> invited you to be friends.
            </h1>
            <p className="text-sm text-[#6B705C] mb-2">
              Sent to <code className="text-xs bg-[#FBFAF6] px-1.5 py-0.5 rounded">{info.target_email}</code>
            </p>
            {info.note && (
              <p className="text-sm text-[#4A4A4A] my-4 p-3 rounded-lg bg-[#FBFAF6] border-l-4 border-[#B87A00] text-left">
                <strong>Note:</strong> {info.note}
              </p>
            )}
            {authLoading ? (
              <p className="text-xs text-[#6B705C] mt-4">Checking your session…</p>
            ) : user ? (
              <button
                type="button"
                onClick={accept}
                disabled={accepting}
                data-testid="invite-accept-btn"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-60"
              >
                {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Accept &amp; become friends
              </button>
            ) : (
              <>
                <p className="text-sm text-[#4A4A4A] mt-6 mb-3">
                  Sign in or create an account to accept. Come back to this link after you sign in.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <Link
                    to={`/login?next=/invite/${token}`}
                    data-testid="invite-signin-link"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white font-semibold text-sm hover:bg-[var(--primary-hover)]"
                  >
                    Sign in <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    to={`/login?next=/invite/${token}`}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--primary)] text-[var(--primary)] font-semibold text-sm"
                  >
                    <Mail className="w-4 h-4" /> Create account
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
