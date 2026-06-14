import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen, LogOut, BarChart3, Filter, HelpCircle, FileText, ShieldCheck,
  Target, Menu, X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";
import DownloadZipButton from "./DownloadZipButton";
import NavbarQuickAdd from "./NavbarQuickAdd";
import AppearancePopover from "./AppearancePopover";
import ChatInboxIcon from "./ChatInboxIcon";
import NotificationsBell from "./NotificationsBell";
import DisplayName from "./DisplayName";
import BookQuickSearch from "./BookQuickSearch";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";

// Secondary links — rendered inline on lg+ and as a drawer on <lg.  Lives
// at module scope so React doesn't remount its children every render.
function SecondaryLinks({ user, unknownFandomCount, onNavigate, inDrawer = false }) {
  if (!user) return null;
  const wrap = inDrawer
    ? "flex flex-col gap-1 w-full"
    : "hidden xl:flex items-center gap-2";
  const itemBase = inDrawer
    ? "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#2C2C2C] hover:bg-[#F5F3EC] w-full"
    : "btn-secondary text-sm flex items-center gap-2";
  const close = () => { if (onNavigate) onNavigate(); };
  return (
    <div className={wrap}>
      <Link to="/library/smart-shelves" data-testid={inDrawer ? "drawer-shelves" : "navbar-smart-shelves"} className={itemBase} title="Smart shelves" onClick={close}>
        <Filter className="w-4 h-4" /> Shelves
      </Link>
      <Link to="/library/stats" data-testid={inDrawer ? "drawer-stats" : "navbar-stats"} className={itemBase} title="Reading statistics" onClick={close}>
        <BarChart3 className="w-4 h-4" /> Stats
      </Link>
      <Link to="/goals" data-testid={inDrawer ? "drawer-goals" : "navbar-goals"} className={itemBase} title="Reading goals" onClick={close}>
        <Target className="w-4 h-4" /> Goals
      </Link>
      <DownloadZipButton kind="xlsx" />
      <DownloadZipButton />
      <Link to="/help" data-testid={inDrawer ? "drawer-help" : "navbar-help"} className={inDrawer ? itemBase : "p-2 hover:bg-[#F5F3EC] rounded-lg"} title="Help & guide" onClick={close}>
        <HelpCircle className="w-4 h-4 text-[#6B705C]" /> {inDrawer && "Help"}
      </Link>
      {user.is_admin && (
        <Link
          to="/admin"
          data-testid={inDrawer ? "drawer-admin" : "navbar-admin"}
          className={inDrawer ? itemBase : "p-2 hover:bg-[#F5F3EC] rounded-lg relative"}
          title={unknownFandomCount > 0 ? `Admin console — ${unknownFandomCount} unknown fandom${unknownFandomCount === 1 ? "" : "s"}` : "Admin console"}
          onClick={close}
        >
          <ShieldCheck className="w-4 h-4 text-[#6B46C1]" />
          {inDrawer && "Admin console"}
          {unknownFandomCount > 0 && (
            <span
              data-testid={inDrawer ? "drawer-admin-badge" : "navbar-admin-badge"}
              className={inDrawer ? "ml-auto w-2 h-2 rounded-full bg-[#E07A5F]" : "absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E07A5F] ring-2 ring-[#FDFBF7]"}
            />
          )}
        </Link>
      )}
      <Link to="/library/originals" data-testid={inDrawer ? "drawer-originals" : "navbar-originals"} className={inDrawer ? itemBase : "p-2 hover:bg-[#F5F3EC] rounded-lg"} title="Original-format files (PDF, MOBI, etc.)" onClick={close}>
        <FileText className="w-4 h-4 text-[#6B705C]" /> {inDrawer && "Originals"}
      </Link>
    </div>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unknownFandomCount, setUnknownFandomCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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

  // Close the responsive hamburger when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
        <Link to="/library" className="flex items-center gap-2 shrink-0" data-testid="navbar-brand">
          <BookOpen className="w-6 h-6 text-[#E07A5F]" />
          <span className="font-serif text-2xl font-medium">Shelfsort</span>
        </Link>

        {user && FETCHING_UI_ENABLED && <NavbarQuickAdd />}
        {user && <div className="hidden md:block flex-1 max-w-xs"><BookQuickSearch /></div>}

        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3">
          {/* Always-visible primary icons.  These stay in the bar at every
              viewport because they're either status indicators (streak,
              notifications) or theme controls users expect everywhere. */}
          <AppearancePopover />
          {user && <NotificationsBell />}
          {user && <ChatInboxIcon />}
          {user && <StreakBadge />}
          {user && FETCHING_UI_ENABLED && <UpdatesBell />}

          {/* Secondary links inline on lg+, hidden behind a hamburger below. */}
          <SecondaryLinks user={user} unknownFandomCount={unknownFandomCount} />

          {user && (
            <>
              <Link
                to="/account"
                data-testid="navbar-account"
                className="flex items-center gap-2 px-1.5 md:px-2 py-1 rounded-lg hover:bg-[#F5F3EC] shrink-0"
                title="Account settings"
              >
                {user.picture && (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="w-8 h-8 rounded-full border border-[#E8E6E1]"
                  />
                )}
                <DisplayName
                  user={user}
                  className="text-sm text-[#2C2C2C] hidden xl:inline"
                  testid="navbar-user-name"
                />
              </Link>
              <button
                data-testid="navbar-logout"
                onClick={logout}
                className="p-2 hover:bg-[#F5F3EC] rounded-lg hidden md:inline-flex shrink-0"
                title="Sign out"
              >
                <LogOut className="w-4 h-4 text-[#6B705C]" />
              </button>

              {/* Hamburger toggle — only on <lg viewports where the
                  secondary links are tucked into the drawer below. */}
              <div className="relative xl:hidden" ref={menuRef}>
                <button
                  data-testid="navbar-menu-toggle"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-2 hover:bg-[#F5F3EC] rounded-lg"
                  title={menuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={menuOpen}
                  aria-label="Open menu"
                >
                  {menuOpen
                    ? <X className="w-5 h-5 text-[#6B705C]" />
                    : <Menu className="w-5 h-5 text-[#6B705C]" />}
                  {unknownFandomCount > 0 && user.is_admin && !menuOpen && (
                    <span
                      data-testid="navbar-menu-admin-badge"
                      className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E07A5F] ring-2 ring-[#FDFBF7]"
                    />
                  )}
                </button>
                {menuOpen && (
                  <div
                    data-testid="navbar-menu-drawer"
                    className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-[#E8E6E1] p-2 z-50"
                  >
                    <SecondaryLinks
                      user={user}
                      unknownFandomCount={unknownFandomCount}
                      inDrawer
                      onNavigate={() => setMenuOpen(false)}
                    />
                    <div className="border-t border-[#E8E6E1] mt-2 pt-2 md:hidden">
                      <button
                        data-testid="drawer-logout"
                        onClick={() => { setMenuOpen(false); logout(); }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#2C2C2C] hover:bg-[#F5F3EC] w-full"
                      >
                        <LogOut className="w-4 h-4" /> Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
