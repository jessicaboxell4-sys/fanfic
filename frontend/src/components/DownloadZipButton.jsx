import React from "react";
import { Link } from "react-router-dom";
import { Download, Link as LinkIcon } from "lucide-react";

// Navbar trigger that routes to the full-page Download experience at
// /library/download (or /library/download?kind=xlsx for the Excel variant).
// The actual filtering + streaming download lives on DownloadPage.jsx.
export default function DownloadZipButton({ kind = "zip" }) {
  const isXlsx = kind === "xlsx";
  const Icon = isXlsx ? LinkIcon : Download;
  const label = isXlsx ? "Library (.xlsx)" : "Download ZIP";
  const to = isXlsx ? "/library/download?kind=xlsx" : "/library/download";
  return (
    <Link
      to={to}
      data-testid={isXlsx ? "navbar-download-links" : "navbar-download-zip"}
      className="btn-secondary text-sm flex items-center gap-2"
      title={
        isXlsx
          ? "Download an Excel workbook — pick fandoms, pairings, authors, or categories first"
          : "Download a ZIP — pick fandoms, pairings, authors, or categories first"
      }
    >
      <Icon className="w-4 h-4" />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}
