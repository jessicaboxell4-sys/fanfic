import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import BookDetail from "@/pages/BookDetail";
import FandomShelf from "@/pages/FandomShelf";
import SeriesShelf from "@/pages/SeriesShelf";
import AuthorShelf from "@/pages/AuthorShelf";
import StatsPage from "@/pages/StatsPage";
import YearInBooksPage from "@/pages/YearInBooksPage";
import CantFindOnline from "@/pages/CantFindOnline";
import Account from "@/pages/Account";
import Reader from "@/pages/Reader";
import AuthCallback from "@/pages/AuthCallback";
import ResetPassword from "@/pages/ResetPassword";

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
      <Route path="/library" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/library/fandom/:fandom" element={<ProtectedRoute><FandomShelf /></ProtectedRoute>} />
      <Route path="/library/series/:name" element={<ProtectedRoute><SeriesShelf /></ProtectedRoute>} />
      <Route path="/library/author/:name" element={<ProtectedRoute><AuthorShelf /></ProtectedRoute>} />
      <Route path="/library/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
      <Route path="/library/year/:year" element={<ProtectedRoute><YearInBooksPage /></ProtectedRoute>} />
      <Route path="/library/cant-find-online" element={<ProtectedRoute><CantFindOnline /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/book/:id" element={<ProtectedRoute><BookDetail /></ProtectedRoute>} />
      <Route path="/read/:id" element={<ProtectedRoute><Reader /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
