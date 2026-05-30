import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, LogOut, Download, Link as LinkIcon, BarChart3, Filter } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, API } from "../lib/api";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleDownloadAll = async () => {
    const url = `${API}/books/export/zip`;
    window.open(url, "_blank");
  };

  const handleDownloadLinks = async () => {
    // Per-fic folders inside a ZIP — each fanfic gets its own links.txt
    const url = `${API}/books/export/links?format=zip`;
    window.open(url, "_blank");
  };

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-3 flex items-center justify-between gap-4">
        <Link to="/library" className="flex items-center gap-2" data-testid="navbar-brand">
          <BookOpen className="w-6 h-6 text-[#E07A5F]" />
          <span className="font-serif text-2xl font-medium">Shelfsort</span>
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
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
          <button
            data-testid="navbar-download-links"
            onClick={handleDownloadLinks}
            className="btn-secondary text-sm flex items-center gap-2"
            title="Download a ZIP — one folder per fanfic, each with its own links.txt"
          >
            <LinkIcon className="w-4 h-4" />
            <span className="hidden md:inline">All links (.txt)</span>
          </button>
          <button
            data-testid="navbar-download-zip"
            onClick={handleDownloadAll}
            className="btn-secondary text-sm flex items-center gap-2"
            title="Download organized ZIP"
          >
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Download ZIP</span>
          </button>
          {user && (
            <>
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
