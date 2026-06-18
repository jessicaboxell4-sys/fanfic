import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { User as UserIcon, LogOut, Settings, ShieldCheck } from "lucide-react";
import DisplayName from "./DisplayName";
import { api } from "../lib/api";

// Avatar-click dropdown.  Replaces the bare avatar link + Sign-out icon
// with a compact menu so the navbar has one less raw icon and Sign out
// gets a confirmation-style "click avatar first" guard.
export default function AccountDropdown({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Fetch the cloud-backup state on mount.  When the user has run
  // (or had the cron tick run) a backup in the last 24 h, show a
  // tiny green check overlay on the avatar.  Constant reassurance
  // signal that doesn't require visiting Settings.
  const [backupFresh, setBackupFresh] = useState(false);
  const [backupAgo, setBackupAgo] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/account/backup-library");
        if (cancelled) return;
        const iso = data?.last_run_at;
        if (!iso) return;
        const ageH = (Date.now() - new Date(iso).getTime()) / 3600000;
        if (ageH < 24) {
          setBackupFresh(true);
          setBackupAgo(ageH < 1
            ? `${Math.max(1, Math.floor(ageH * 60))} min ago`
            : `${Math.floor(ageH)}h ago`);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="navbar-account"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 px-1.5 md:px-2 py-1 rounded-lg hover:bg-[#F5F3EC] shrink-0"
        title="Account menu"
      >
        <span className="relative inline-block">
          {user.picture
            ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-8 h-8 rounded-full border border-[#E8E6E1]"
              />
            )
            : (
              <span className="w-8 h-8 rounded-full bg-[#F5F3EC] border border-[#E8E6E1] flex items-center justify-center">
                <UserIcon className="w-4 h-4 text-[#6B705C]" />
              </span>
            )
          }
          {backupFresh && (
            <span
              data-testid="backup-fresh-badge"
              title={`Library backed up ${backupAgo}`}
              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#3B5B3F] border-2 border-white flex items-center justify-center"
            >
              <ShieldCheck className="w-2 h-2 text-white" strokeWidth={3} />
            </span>
          )}
        </span>
        <DisplayName
          user={user}
          className="text-sm text-[#2C2C2C] hidden xl:inline"
          testid="navbar-user-name"
        />
      </button>
      {open && (
        <div
          data-testid="navbar-account-menu"
          className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-[#E8E6E1] py-1.5 z-50"
        >
          <div className="px-3 py-2 border-b border-[#E8E6E1]">
            <DisplayName
              user={user}
              className="text-sm font-semibold text-[#2C2C2C] block truncate"
              testid="account-menu-name"
            />
            {user.email && (
              <p className="text-[11px] text-[#6B705C] truncate">{user.email}</p>
            )}
          </div>
          <Link
            to="/account"
            data-testid="account-menu-settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC]"
          >
            <Settings className="w-4 h-4 text-[#6B705C]" />
            Account settings
          </Link>
          <button
            type="button"
            data-testid="account-menu-logout"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC] border-t border-[#E8E6E1]"
          >
            <LogOut className="w-4 h-4 text-[#6B705C]" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
