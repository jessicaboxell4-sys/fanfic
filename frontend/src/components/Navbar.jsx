import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, LogOut, BarChart3, Filter, HelpCircle, FileText, Sun, Moon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";
import DownloadZipButton from "./DownloadZipButton";
import NavbarQuickAdd from "./NavbarQuickAdd";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-3 flex items-center justify-between gap-4">
        <Link to="/library" className="flex items-center gap-2" data-testid="navbar-brand">
          <BookOpen className="w-6 h-6 text-[#E07A5F]" />
          <span className="font-serif text-2xl font-medium">Shelfsort</span>
        </Link>

        {user && <NavbarQuickAdd />}

        <div className="flex items-center gap-2 md:gap-3">
          <button
            data-testid="navbar-theme-toggle"
            onClick={toggleTheme}
            className="p-2 hover:bg-[#F5F3EC] rounded-lg"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark"
              ? <Sun className="w-4 h-4 text-[#6B705C]" />
              : <Moon className="w-4 h-4 text-[#6B705C]" />}
          </button>
          {user && <StreakBadge />}
          {user && <UpdatesBell />}
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
