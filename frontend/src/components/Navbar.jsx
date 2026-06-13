import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, LogOut, BarChart3, Filter, HelpCircle, FileText, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";
import DownloadZipButton from "./DownloadZipButton";
import NavbarQuickAdd from "./NavbarQuickAdd";
import AppearancePopover from "./AppearancePopover";
import ChatInboxIcon from "./ChatInboxIcon";
import NotificationsBell from "./NotificationsBell";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unknownFandomCount, setUnknownFandomCount] = useState(0);

  // Poll the unknown-fandoms count on mount + every 5 minutes so admins
  // notice when a new unrecognized fandom enters the library. Server-side
  // cache means this is essentially free.
  useEffect(() => {
    if (!user?.is_admin) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/admin/unknown-fandoms/count");
        if (!cancelled) setUnknownFandomCount(data?.count || 0);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 300000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user?.is_admin]);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-3 flex items-center justify-between gap-4">
        <Link to="/library" className="flex items-center gap-2" data-testid="navbar-brand">
          <BookOpen className="w-6 h-6 text-[#E07A5F]" />
          <span className="font-serif text-2xl font-medium">Shelfsort</span>
        </Link>

        {user && FETCHING_UI_ENABLED && <NavbarQuickAdd />}

        <div className="flex items-center gap-2 md:gap-3">
          <AppearancePopover />
          {user && <NotificationsBell />}
          {user && <ChatInboxIcon />}
          {user && <StreakBadge />}
          {user && FETCHING_UI_ENABLED && <UpdatesBell />}
          {user && (
            <Link
              to="/library/smart-shelves"
              data-testid="navbar-smart-shelves"
              className="btn-secondary text-sm flex items-center gap-2"
              title="Smart shelves"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden md:inline">Shelves</span>
            </Link>
          )}
          {user && (
            <Link
              to="/library/stats"
              data-testid="navbar-stats"
              className="btn-secondary text-sm flex items-center gap-2"
              title="Reading statistics"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="hidden md:inline">Stats</span>
            </Link>
          )}
          {user && <DownloadZipButton kind="xlsx" />}
          {user && <DownloadZipButton />}
          {user && (
            <>
              <Link
                to="/help"
                data-testid="navbar-help"
                className="p-2 hover:bg-[#F5F3EC] rounded-lg"
                title="Help & guide"
              >
                <HelpCircle className="w-4 h-4 text-[#6B705C]" />
              </Link>
              {user.is_admin && (
                <Link
                  to="/admin"
                  data-testid="navbar-admin"
                  className="p-2 hover:bg-[#F5F3EC] rounded-lg relative"
                  title={unknownFandomCount > 0 ? `Admin console — ${unknownFandomCount} unknown fandom${unknownFandomCount === 1 ? "" : "s"}` : "Admin console"}
                >
                  <ShieldCheck className="w-4 h-4 text-[#3A5A40]" />
                  {unknownFandomCount > 0 && (
                    <span
                      data-testid="navbar-admin-badge"
                      className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E07A5F] ring-2 ring-[#FDFBF7]"
                    />
                  )}
                </Link>
              )}
              <Link
                to="/library/originals"
                data-testid="navbar-originals"
                className="p-2 hover:bg-[#F5F3EC] rounded-lg"
                title="Original-format files (PDF, MOBI, etc.)"
              >
                <FileText className="w-4 h-4 text-[#6B705C]" />
              </Link>
              <Link
                to="/account"
                data-testid="navbar-account"
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#F5F3EC]"
                title="Account settings"
              >
                {user.picture && (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="w-8 h-8 rounded-full border border-[#E8E6E1]"
                  />
                )}
                <span className="text-sm text-[#2C2C2C] hidden md:inline" data-testid="navbar-user-name">{user.name}</span>
              </Link>
              <button
                data-testid="navbar-logout"
                onClick={logout}
                className="p-2 hover:bg-[#F5F3EC] rounded-lg"
                title="Sign out"
              >
                <LogOut className="w-4 h-4 text-[#6B705C]" />
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
