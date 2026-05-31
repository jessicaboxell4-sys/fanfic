import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, LogOut, Download, Link as LinkIcon, BarChart3, Filter } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import UpdatesBell from "./UpdatesBell";
import StreakBadge from "./StreakBadge";
import { toast } from "sonner";

// Authenticated file download — bypasses cross-site cookie blocks that
// `window.open(url)` runs into (browser fetches without auth → server
// returns 401 HTML, browser saves it as <name>.zip, file won't open).
async function downloadAsFile(path, fallbackName) {
  try {
    const resp = await api.get(path, { responseType: "blob" });
    // If the server actually returned a JSON error in a blob, surface it as a toast
    // instead of silently saving "{"detail":"No books"}" as a .zip / .xlsx.
    const ct = (resp.headers["content-type"] || resp.headers["Content-Type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
      const text = await resp.data.text();
      try {
        const j = JSON.parse(text);
        toast.error(j.detail || j.message || "Download failed");
      } catch {
        toast.error("Download failed");
      }
      return;
    }
    let name = fallbackName;
    const disp = resp.headers["content-disposition"] || resp.headers["Content-Disposition"];
    if (disp) {
      const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
      if (m && m[1]) name = decodeURIComponent(m[1]);
    }
    const url = window.URL.createObjectURL(resp.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    // Try to read the error blob body if axios threw on a 4xx/5xx
    if (e.response && e.response.data) {
      try {
        const text = await e.response.data.text();
        const j = JSON.parse(text);
        toast.error(j.detail || "Download failed — please try again");
        return;
      } catch { /* fall through */ }
    }
    toast.error("Download failed — please try again");
  }
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleDownloadAll = () => downloadAsFile("/books/export/zip", "shelfsort_library.zip");
  const handleDownloadLinks = () => downloadAsFile("/books/export/links?format=xlsx", "shelfsort_library.xlsx");

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
            title="Download an Excel workbook — one sheet per fandom with full metadata"
          >
            <LinkIcon className="w-4 h-4" />
            <span className="hidden md:inline">Library (.xlsx)</span>
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
