import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = m[1];

    (async () => {
      try {
        const { data } = await api.post("/auth/google", { session_id });
        setUser(data);
        // Clean URL & go to library
        window.history.replaceState({}, document.title, "/library");
        navigate("/library", { replace: true, state: { user: data } });
      } catch (e) {
        console.error(e);
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <div className="text-center">
        <div className="inline-block h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-[#6B705C] font-serif text-xl">Opening your library…</p>
      </div>
    </div>
  );
}
