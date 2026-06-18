import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import TourOverlay, { hasSeenTour } from "@/components/TourOverlay";
import GlobalConfettiHost from "@/components/GlobalConfettiHost";
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
import GoalsPage from "@/pages/GoalsPage";
import YearInBooksPage from "@/pages/YearInBooksPage";
import PublicYearInBooks from "@/pages/PublicYearInBooks";
import PublicCoverProfile from "@/pages/PublicCoverProfile";
import PublicCoverDetail from "@/pages/PublicCoverDetail";
import ExploreCoversPage from "@/pages/ExploreCoversPage";
import CoverArchivePage from "@/pages/CoverArchivePage";
import StuckBooksPage from "@/pages/StuckBooksPage";
import SmartShelves from "@/pages/SmartShelves";
import SmartShelfPage from "@/pages/SmartShelfPage";
import AllBooksPage from "@/pages/AllBooksPage";
import ReadingQueuePage from "@/pages/ReadingQueuePage";
import TagCloudPage from "@/pages/TagCloudPage";
import TagShelfPage from "@/pages/TagShelfPage";
import CantFindOnline from "@/pages/CantFindOnline";
import Account from "@/pages/Account";
import AppearancePage from "@/pages/AppearancePage";
import FriendsPage from "@/pages/FriendsPage";
import BookclubsPage from "@/pages/BookclubsPage";
import RecommendationsPage from "@/pages/RecommendationsPage";
import SuggestionsPage from "@/pages/SuggestionsPage";
import InviteAcceptPage from "@/pages/InviteAcceptPage";
import Reader from "@/pages/Reader";
import ReadOriginal from "@/pages/ReadOriginal";
import CompareVersions from "@/pages/CompareVersions";
import EmailPreferences from "@/pages/EmailPreferences";
import FindDuplicates from "@/pages/FindDuplicates";
import Trash from "@/pages/Trash";
import UnreadLibraryPage from "@/pages/UnreadLibraryPage";
import BookmarksPage from "@/pages/BookmarksPage";
import Conversions from "@/pages/Conversions";
import FilterUrlList from "@/pages/FilterUrlList";
import DownloadPage from "@/pages/DownloadPage";
import CrossoverShelf from "@/pages/CrossoverShelf";
import LinklessShelf from "@/pages/LinklessShelf";
import PolishLibraryPage from "@/pages/PolishLibraryPage";
import PolishCoversPage from "@/pages/PolishCoversPage";
import UnreadableShelf from "@/pages/UnreadableShelf";
import UnknownSourcesPage from "@/pages/UnknownSourcesPage";
import { CompleteShelf, OngoingShelf } from "@/pages/StatusShelves";
import { AuthorsDirectory } from "@/pages/AuthorsPage";
import { PairingsDirectory, PairingShelf } from "@/pages/PairingsPage";
import RestoreBackupPage from "@/pages/RestoreBackupPage";
import OriginalsShelf from "@/pages/OriginalsShelf";
import Help from "@/pages/Help";
import Rules from "@/pages/Rules";
import AdminConsole from "@/pages/AdminConsole";
import AdminViewAs from "@/pages/AdminViewAs";
import ModInbox from "@/pages/ModInbox";
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

// ModeratorRoute — passes for mods OR admins so the Mod Inbox is reachable
// by either role.  Mods who try to hit /admin (the full console) still
// bounce back to /library via AdminRoute above; this gate exists so
// /admin/pending and similar focused pages aren't admin-exclusive.
function ModeratorRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="h-8 w-8 border-2 border-[#E07A5F] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin && !user.is_moderator) return <Navigate to="/library" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  // Detect Emergent OAuth callback in URL fragment, handle BEFORE normal routing.
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/share/yib/:token" element={<PublicYearInBooks />} />
      <Route path="/u/:username" element={<PublicCoverProfile />} />
      <Route path="/cover/:coverId" element={<PublicCoverDetail />} />
      <Route path="/explore/covers" element={<ExploreCoversPage />} />
      <Route path="/cover-archive" element={<CoverArchivePage />} />
      <Route path="/library/stuck" element={<ProtectedRoute><StuckBooksPage /></ProtectedRoute>} />
      <Route path="/library" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/library/all" element={<ProtectedRoute><AllBooksPage /></ProtectedRoute>} />
      <Route path="/library/queue" element={<ProtectedRoute><ReadingQueuePage /></ProtectedRoute>} />
      <Route path="/library/fandom/:fandom" element={<ProtectedRoute><FandomShelf /></ProtectedRoute>} />
      <Route path="/library/series/:name" element={<ProtectedRoute><SeriesShelf /></ProtectedRoute>} />
      <Route path="/library/author/:name" element={<ProtectedRoute><AuthorShelf /></ProtectedRoute>} />
      <Route path="/library/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
      <Route path="/goals" element={<ProtectedRoute><GoalsPage /></ProtectedRoute>} />
      <Route path="/library/year/:year" element={<ProtectedRoute><YearInBooksPage /></ProtectedRoute>} />
      <Route path="/library/smart-shelves" element={<ProtectedRoute><SmartShelves /></ProtectedRoute>} />
      <Route path="/library/smart/:id" element={<ProtectedRoute><SmartShelfPage /></ProtectedRoute>} />
      <Route path="/library/tags" element={<ProtectedRoute><TagCloudPage /></ProtectedRoute>} />
      <Route path="/library/tag/:name" element={<ProtectedRoute><TagShelfPage /></ProtectedRoute>} />
      <Route path="/library/cant-find-online" element={<ProtectedRoute><CantFindOnline /></ProtectedRoute>} />
      <Route path="/library/unread" element={<ProtectedRoute><UnreadLibraryPage /></ProtectedRoute>} />
      <Route path="/library/polish" element={<ProtectedRoute><PolishLibraryPage /></ProtectedRoute>} />
      <Route path="/library/polish-covers" element={<ProtectedRoute><PolishCoversPage /></ProtectedRoute>} />
      <Route path="/bookmarks" element={<ProtectedRoute><BookmarksPage /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/account/appearance" element={<ProtectedRoute><AppearancePage /></ProtectedRoute>} />
      <Route path="/messages" element={<Navigate to="/friends" replace />} />
      <Route path="/messages/:roomId" element={<MessagesRoomRedirect />} />
      <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
      <Route path="/bookclubs" element={<ProtectedRoute><BookclubsPage /></ProtectedRoute>} />
      <Route path="/bookclubs/:roomId" element={<ProtectedRoute><BookclubsPage /></ProtectedRoute>} />
      <Route path="/library/recommendations" element={<ProtectedRoute><RecommendationsPage /></ProtectedRoute>} />
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
      <Route path="/rules" element={<Rules />} />
      <Route path="/admin" element={<AdminRoute><AdminConsole /></AdminRoute>} />
      <Route path="/admin/pending" element={<ModeratorRoute><ModInbox /></ModeratorRoute>} />
      <Route path="/admin/view/:uid" element={<AdminRoute><AdminViewAs /></AdminRoute>} />
      <Route path="/book/:id" element={<ProtectedRoute><BookDetail /></ProtectedRoute>} />
      <Route path="/book/:id/compare" element={<ProtectedRoute><CompareVersions /></ProtectedRoute>} />
      <Route path="/read/:id" element={<ProtectedRoute><Reader /></ProtectedRoute>} />
      <Route path="/read-original/:id" element={<ProtectedRoute><ReadOriginal /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <TourMount />
    </>
  );
}

function MessagesRoomRedirect() {
  // Old deep-link `/messages/:roomId` still appears in older emails/notifications.
  // The route was retired in 2026-06-14 in favour of the inline DmDrawer on
  // /friends.  Preserve the roomId so FriendsPage can auto-open the matching
  // DM drawer instead of dropping the user on the bare /friends page.
  const { roomId } = useParams();
  return <Navigate to={`/friends?room=${encodeURIComponent(roomId || "")}`} replace />;
}

function TourMount() {
  const { user, loading } = useAuth();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (loading || !user) return;
    if (hasSeenTour()) return;
    // Brief delay so the destination page mounts first.
    const id = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(id);
  }, [loading, user]);
  React.useEffect(() => {
    const fn = () => setOpen(true);
    window.addEventListener("shelfsort:replay-tour", fn);
    return () => window.removeEventListener("shelfsort:replay-tour", fn);
  }, []);
  return <TourOverlay open={open} onClose={() => setOpen(false)} />;
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
              <GlobalConfettiHost />
              <Toaster position="top-center" richColors />
            </AuthProvider>
          </PaletteProvider>
        </ThemeProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
