import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen, LogOut, BarChart3, Filter, HelpCircle, FileText, ShieldCheck,
  Target, Menu, X, Library, Download, ChevronDown, Link as LinkIcon,
  Lightbulb, MessageCircleQuestion, Sparkles, Users, MessageSquare,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";
import NavbarQuickAdd from "./NavbarQuickAdd";
import AppearancePopover from "./AppearancePopover";
import MessagesDropdown from "./MessagesDropdown";
import NotificationsBell from "./NotificationsBell";
import AccountDropdown from "./AccountDropdown";
import DisplayName from "./DisplayName";
import BookQuickSearch from "./BookQuickSearch";
import { FETCHING_UI_ENABLED } from "../lib/featureFlags";

// Lightweight dropdown trigger used to group related navbar links so the
// bar stays scannable.  Click toggles open; outside-click and link-click
// both close.  No portal needed — the menu is positioned right under the
// trigger button.
function NavDropdown({ label, icon: Icon, items, testid }) {
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
        onClick={() => setOpen((v) => !v)}
        data-testid={testid}
        aria-expanded={open}
        className="btn-secondary text-sm flex items-center gap-1.5"
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          data-testid={`${testid}-menu`}
          className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-[#E8E6E1] py-1.5 z-50"
        >
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              data-testid={it.testid}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC]"
              title={it.title}
            >
              {it.icon && <it.icon className="w-4 h-4 text-[#6B705C]" />}
              <span className="flex-1">{it.label}</span>
              {it.hint && <span className="text-[10px] text-[#6B705C]">{it.hint}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Secondary nav — inline (xl+) shows dropdowns to keep the bar compact, the
// hamburger drawer (< xl) shows everything flat so users can scan all
// destinations at once.
function SecondaryLinks({ user, unknownFandomCount, onNavigate, inDrawer = false }) {
  if (!user) return null;

  // Items used in BOTH layouts — defining once keeps wording identical.
  const libraryItems = [
    { to: "/library/all", label: "All books", testid: "navbar-all-books", icon: BookOpen, title: "Every book in your library, in one scrollable grid" },
    { to: "/library/smart-shelves", label: "Smart shelves", testid: "navbar-smart-shelves", icon: Filter, title: "Saved filter combinations" },
    { to: "/library/stats", label: "Reading stats", testid: "navbar-stats", icon: BarChart3, title: "Reading statistics" },
    { to: "/goals", label: "Reading goals", testid: "navbar-goals", icon: Target, title: "Yearly & monthly reading targets" },
    { to: "/library/recommendations", label: "Recommendations", testid: "navbar-recommendations", icon: Sparkles, title: "Books your friends loved that you don't own yet" },
    { to: "/library/originals", label: "Originals", testid: "navbar-originals", icon: FileText, title: "Original-format files (PDF, MOBI, DOCX, etc.) kept without conversion" },
  ];
  const exportItems = [
    { to: "/library/download?kind=xlsx", label: "Library (.xlsx)", testid: "navbar-download-links", icon: LinkIcon, title: "Excel workbook with title + author + source link" },
    { to: "/library/download", label: "Download ZIP", testid: "navbar-download-zip", icon: Download, title: "Bulk-download EPUBs as a single ZIP" },
  ];
  const helpItems = [
    { to: "/help", label: "Help & guide", testid: "navbar-help", icon: HelpCircle, title: "Full Shelfsort guide — uploads, shelves, exports, everything" },
    { to: "/suggestions", label: "Suggestions & feedback", testid: "navbar-suggestions", icon: Lightbulb, title: "Send feedback or request new features" },
  ];

  if (inDrawer) {
    const close = () => { if (onNavigate) onNavigate(); };
    const itemBase = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#2C2C2C] hover:bg-[#F5F3EC] w-full";
    return (
      <div className="flex flex-col gap-1 w-full">
        <p className="px-3 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B705C]">Library</p>
        {libraryItems.map((it) => (
          <Link key={it.to} to={it.to} data-testid={`drawer-${it.testid.replace("navbar-","")}`} className={itemBase} onClick={close}>
            <it.icon className="w-4 h-4" /> {it.label}
          </Link>
        ))}
        <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B705C]">Export</p>
        {exportItems.map((it) => (
          <Link key={it.to} to={it.to} data-testid={`drawer-${it.testid.replace("navbar-","")}`} className={itemBase} onClick={close}>
            <it.icon className="w-4 h-4" /> {it.label}
          </Link>
        ))}
        <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B705C]">Community</p>
        <Link to="/friends" data-testid="drawer-messages" className={itemBase} onClick={close}>
          <MessageSquare className="w-4 h-4" /> Messages
        </Link>
        <Link to="/friends" data-testid="drawer-friends" className={itemBase} onClick={close}>
          <Users className="w-4 h-4" /> Friends
        </Link>
        <Link to="/bookclubs" data-testid="drawer-bookclubs" className={itemBase} onClick={close}>
          <BookOpen className="w-4 h-4" /> Reading rooms
        </Link>
        <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B705C]">Help &amp; feedback</p>
        <Link to="/help" data-testid="drawer-help" className={itemBase} onClick={close}>
          <HelpCircle className="w-4 h-4" /> Help &amp; guide
        </Link>
        <Link to="/suggestions" data-testid="drawer-suggestions" className={itemBase} onClick={close}>
          <Lightbulb className="w-4 h-4" /> Suggestions &amp; feedback
        </Link>
        {user.is_admin && (
          <Link to="/admin" data-testid="drawer-admin" className={itemBase} onClick={close}>
            <ShieldCheck className="w-4 h-4 text-[#6B46C1]" />
            Admin console
            {unknownFandomCount > 0 && (
              <span data-testid="drawer-admin-badge" className="ml-auto w-2 h-2 rounded-full bg-[#E07A5F]" />
            )}
          </Link>
        )}
        {/* Moderators get the Pending sign-ups inbox without the full admin
            console (they wouldn't have permission to use most of it
            anyway).  Admins already hit it through the AdminConsole link
            above, so we only show this for mod-but-not-admin users. */}
        {user.is_moderator && !user.is_admin && (
          <Link to="/admin/pending" data-testid="drawer-mod-inbox" className={itemBase} onClick={close}>
            <ShieldCheck className="w-4 h-4 text-[#3D8B79]" />
            Mod inbox
          </Link>
        )}
      </div>
    );
  }

  // Inline (lg+) — two compact dropdowns + standalone Help/Admin/Originals.
  return (
    <div className="hidden lg:flex items-center gap-2">
      <NavDropdown label="Library" icon={Library} items={libraryItems} testid="navbar-library-menu" />
      <NavDropdown label="Export" icon={Download} items={exportItems} testid="navbar-export-menu" />
      <NavDropdown label="Help" icon={MessageCircleQuestion} items={helpItems} testid="navbar-help-menu" />
      {user.is_admin && (
        <Link
          to="/admin"
          data-testid="navbar-admin"
          className="p-2 hover:bg-[#F5F3EC] rounded-lg relative"
          title={unknownFandomCount > 0 ? `Admin console — ${unknownFandomCount} unknown fandom${unknownFandomCount === 1 ? "" : "s"}` : "Admin console"}
        >
          <ShieldCheck className="w-4 h-4 text-[#6B46C1]" />
          {unknownFandomCount > 0 && (
            <span
              data-testid="navbar-admin-badge"
              className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E07A5F] ring-2 ring-[#FDFBF7]"
            />
          )}
        </Link>
      )}
      {/* Mod-but-not-admin: shortcut to the pending sign-up queue. */}
      {user.is_moderator && !user.is_admin && (
        <Link
          to="/admin/pending"
          data-testid="navbar-mod-inbox"
          className="p-2 hover:bg-[#F5F3EC] rounded-lg"
          title="Mod inbox — pending sign-ups"
        >
          <ShieldCheck className="w-4 h-4 text-[#3D8B79]" />
        </Link>
      )}
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
        {user && <div className="hidden md:block flex-1 max-w-sm"><BookQuickSearch /></div>}

        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3">
          {/* Primary navigation dropdowns (Library / Export / Help) — on the
              LEFT so users reach top-level destinations first. */}
          <SecondaryLinks user={user} unknownFandomCount={unknownFandomCount} />

          {/* Status & personal icons — theme, notifications, messages,
              streak.  Sitting on the RIGHT keeps them near the account
              avatar where users expect status / "me" controls. */}
          <AppearancePopover />
          {user && <NotificationsBell />}
          {user && <MessagesDropdown />}
          {user && <StreakBadge />}
          {user && FETCHING_UI_ENABLED && <UpdatesBell />}

          {user && (
            <>
              <AccountDropdown user={user} onLogout={logout} />

              {/* Hamburger toggle — only on <lg viewports where the
                  secondary links are tucked into the drawer below. */}
              <div className="relative lg:hidden" ref={menuRef}>
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
