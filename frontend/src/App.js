import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { PaletteProvider } from "@/context/PaletteContext";
import UrlPasteDetector from "@/components/UrlPasteDetector";
import { FETCHING_UI_ENABLED } from "@/lib/featureFlags";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import BookDetail from "@/pages/BookDetail";
import FandomShelf from "@/pages/FandomShelf";
import SeriesShelf from "@/pages/SeriesShelf";
import AuthorShelf from "@/pages/AuthorShelf";
import StatsPage from "@/pages/StatsPage";
import YearInBooksPage from "@/pages/YearInBooksPage";
import PublicYearInBooks from "@/pages/PublicYearInBooks";
import SmartShelves from "@/pages/SmartShelves";
import SmartShelfPage from "@/pages/SmartShelfPage";
import TagCloudPage from "@/pages/TagCloudPage";
import TagShelfPage from "@/pages/TagShelfPage";
import CantFindOnline from "@/pages/CantFindOnline";
import Account from "@/pages/Account";
import AppearancePage from "@/pages/AppearancePage";
import MessagesPage from "@/pages/MessagesPage";
import FriendsPage from "@/pages/FriendsPage";
import SuggestionsPage from "@/pages/SuggestionsPage";
import InviteAcceptPage from "@/pages/InviteAcceptPage";
import Reader from "@/pages/Reader";
import CompareVersions from "@/pages/CompareVersions";
import EmailPreferences from "@/pages/EmailPreferences";
import FindDuplicates from "@/pages/FindDuplicates";
import Trash from "@/pages/Trash";
import UnreadLibraryPage from "@/pages/UnreadLibraryPage";
import Conversions from "@/pages/Conversions";
import FilterUrlList from "@/pages/FilterUrlList";
import DownloadPage from "@/pages/DownloadPage";
import CrossoverShelf from "@/pages/CrossoverShelf";
import LinklessShelf from "@/pages/LinklessShelf";
import UnreadableShelf from "@/pages/UnreadableShelf";
import UnknownSourcesPage from "@/pages/UnknownSourcesPage";
import { CompleteShelf, OngoingShelf } from "@/pages/StatusShelves";
import { AuthorsDirectory } from "@/pages/AuthorsPage";
import { PairingsDirectory, PairingShelf } from "@/pages/PairingsPage";
import RestoreBackupPage from "@/pages/RestoreBackupPage";
import OriginalsShelf from "@/pages/OriginalsShelf";
import Help from "@/pages/Help";
import AdminConsole from "@/pages/AdminConsole";
import AuthCallback from "@/pages/AuthCallback";
import ResetPassword from "@/pages/ResetPassword";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import PendingDeletionBanner from "@/components/PendingDeletionBanner";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/library" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  // Detect Emergent OAuth callback in URL fragment, handle BEFORE normal routing.
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/share/yib/:token" element={<PublicYearInBooks />} />
      <Route path="/library" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/library/fandom/:fandom" element={<ProtectedRoute><FandomShelf /></ProtectedRoute>} />
      <Route path="/library/series/:name" element={<ProtectedRoute><SeriesShelf /></ProtectedRoute>} />
      <Route path="/library/author/:name" element={<ProtectedRoute><AuthorShelf /></ProtectedRoute>} />
      <Route path="/library/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
      <Route path="/library/year/:year" element={<ProtectedRoute><YearInBooksPage /></ProtectedRoute>} />
      <Route path="/library/smart-shelves" element={<ProtectedRoute><SmartShelves /></ProtectedRoute>} />
      <Route path="/library/smart/:id" element={<ProtectedRoute><SmartShelfPage /></ProtectedRoute>} />
      <Route path="/library/tags" element={<ProtectedRoute><TagCloudPage /></ProtectedRoute>} />
      <Route path="/library/tag/:name" element={<ProtectedRoute><TagShelfPage /></ProtectedRoute>} />
      <Route path="/library/cant-find-online" element={<ProtectedRoute><CantFindOnline /></ProtectedRoute>} />
      <Route path="/library/unread" element={<ProtectedRoute><UnreadLibraryPage /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/account/appearance" element={<ProtectedRoute><AppearancePage /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
      <Route path="/messages/:roomId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
      <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
      <Route path="/suggestions" element={<ProtectedRoute><SuggestionsPage /></ProtectedRoute>} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/account/emails" element={<ProtectedRoute><EmailPreferences /></ProtectedRoute>} />
      <Route path="/account/duplicates" element={<ProtectedRoute><FindDuplicates /></ProtectedRoute>} />
      <Route path="/library/trash" element={<ProtectedRoute><Trash /></ProtectedRoute>} />
      <Route path="/library/conversions" element={<ProtectedRoute><Conversions /></ProtectedRoute>} />
      <Route path="/library/filter-urls" element={<ProtectedRoute><FilterUrlList /></ProtectedRoute>} />
      <Route path="/library/download" element={<ProtectedRoute><DownloadPage /></ProtectedRoute>} />
      <Route path="/library/crossovers" element={<ProtectedRoute><CrossoverShelf /></ProtectedRoute>} />
      <Route path="/library/linkless" element={<ProtectedRoute><LinklessShelf /></ProtectedRoute>} />
      <Route path="/library/unreadable" element={<ProtectedRoute><UnreadableShelf /></ProtectedRoute>} />
      <Route path="/admin/unknown-sources" element={<ProtectedRoute><UnknownSourcesPage /></ProtectedRoute>} />
      <Route path="/library/complete" element={<ProtectedRoute><CompleteShelf /></ProtectedRoute>} />
      <Route path="/library/ongoing" element={<ProtectedRoute><OngoingShelf /></ProtectedRoute>} />
      <Route path="/library/authors" element={<ProtectedRoute><AuthorsDirectory /></ProtectedRoute>} />
      <Route path="/library/pairings" element={<ProtectedRoute><PairingsDirectory /></ProtectedRoute>} />
      <Route path="/library/by-pairing/:pairing" element={<ProtectedRoute><PairingShelf /></ProtectedRoute>} />
      <Route path="/account/restore" element={<ProtectedRoute><RestoreBackupPage /></ProtectedRoute>} />
      <Route path="/library/originals" element={<ProtectedRoute><OriginalsShelf /></ProtectedRoute>} />
      <Route path="/help" element={<ProtectedRoute><Help /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminRoute><AdminConsole /></AdminRoute>} />
      <Route path="/book/:id" element={<ProtectedRoute><BookDetail /></ProtectedRoute>} />
      <Route path="/book/:id/compare" element={<ProtectedRoute><CompareVersions /></ProtectedRoute>} />
      <Route path="/read/:id" element={<ProtectedRoute><Reader /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ThemeProvider>
          <PaletteProvider>
            <AuthProvider>
              <PendingDeletionBanner />
              <MaintenanceBanner />
              {FETCHING_UI_ENABLED && <UrlPasteDetector />}
              <AppRouter />
              <Toaster position="top-center" richColors />
            </AuthProvider>
          </PaletteProvider>
        </ThemeProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
