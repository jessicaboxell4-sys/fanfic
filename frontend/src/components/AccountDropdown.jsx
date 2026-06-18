import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { User as UserIcon, LogOut, Settings, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import DisplayName from "./DisplayName";
import { toast } from "sonner";
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
  const [backupCount, setBackupCount] = useState(0);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const popoverRef = useRef(null);

  const refreshBackup = async () => {
    try {
      const { data } = await api.get("/account/backup-library");
      const iso = data?.last_run_at;
      const scanned = data?.stats?.scanned || 0;
      setBackupCount(scanned);
      if (!iso) {
        setBackupFresh(false);
        setBackupAgo("");
        return;
      }
      const ageH = (Date.now() - new Date(iso).getTime()) / 3600000;
      setBackupAgo(ageH < 1
        ? `${Math.max(1, Math.floor(ageH * 60))} min ago`
        : ageH < 24 ? `${Math.floor(ageH)}h ago`
        : `${Math.floor(ageH / 24)}d ago`);
      setBackupFresh(ageH < 24);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { refreshBackup(); }, []);

  // Close the backup popover on outside click.
  useEffect(() => {
    if (!backupOpen) return;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setBackupOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [backupOpen]);

  const runBackupAgain = async () => {
    setBackupBusy(true);
    try {
      const { data } = await api.post("/account/backup-library");
      if (data?.ok) {
        const up = data?.stats?.uploaded || 0;
        toast.success(up
          ? `Backed up ${up} new file${up === 1 ? "" : "s"}.`
          : "Library already fully backed up.");
        await refreshBackup();
      } else {
        toast.warning("Cloud backup isn't configured on this deployment.");
      }
    } catch {
      toast.error("Backup failed — try again in a minute.");
    } finally {
      setBackupBusy(false);
    }
  };

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
            <button
              type="button"
              data-testid="backup-fresh-badge"
              title={`Library backed up ${backupAgo}`}
              onClick={(e) => {
                e.stopPropagation();
                setBackupOpen((v) => !v);
              }}
              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#3B5B3F] border-2 border-white flex items-center justify-center hover:bg-[#2c4530]"
            >
              <ShieldCheck className="w-2 h-2 text-white" strokeWidth={3} />
            </button>
          )}
        </span>
        <DisplayName
          user={user}
          className="text-sm text-[#2C2C2C] hidden xl:inline"
          testid="navbar-user-name"
        />
      </button>
      {backupOpen && (
        <div
          ref={popoverRef}
          data-testid="backup-fresh-popover"
          className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-[#E8E6E1] p-4 z-50"
        >
          <div className="flex items-start gap-2.5 mb-3">
            <span className="w-7 h-7 rounded-full bg-[#3B5B3F] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" strokeWidth={2.5} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#2C2C2C] leading-tight flex items-center gap-1.5">
                Backed up {backupAgo}
                <Link
                  to="/help#cloud-backup"
                  onClick={() => setBackupOpen(false)}
                  title="About cloud backup"
                  data-testid="help-anchor-cloud-backup-popover"
                  className="inline-flex text-[#6B705C] hover:text-[#6B46C1]"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </Link>
              </p>
              {backupCount > 0 && (
                <p className="text-xs text-[#6B705C] mt-0.5" data-testid="backup-fresh-count">
                  {backupCount.toLocaleString()} file{backupCount === 1 ? "" : "s"} safe in cloud storage
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={runBackupAgain}
            disabled={backupBusy}
            data-testid="backup-fresh-trigger"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3B5B3F] text-white hover:bg-[#2c4530] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
          >
            {backupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <>Back up again <ArrowRight className="w-3 h-3" /></>}
          </button>
        </div>
      )}
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
