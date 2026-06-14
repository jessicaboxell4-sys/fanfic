import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { User as UserIcon, LogOut, Settings } from "lucide-react";
import DisplayName from "./DisplayName";

// Avatar-click dropdown.  Replaces the bare avatar link + Sign-out icon
// with a compact menu so the navbar has one less raw icon and Sign out
// gets a confirmation-style "click avatar first" guard.
export default function AccountDropdown({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

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
