import React from "react";
import { BookOpen } from "lucide-react";

export default function Login() {
  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/library";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-paper">
      <div className="hidden md:block relative">
        <img
          src="https://static.prod-images.emergentagent.com/jobs/a7cbf064-1bb1-48e6-b642-01b29d2915a4/images/69b714e80ad3526797631c1c9c820d1ffe10c66de28dc4bc99a11bde433fe454.png"
          alt="Reading corner"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#2C2C2C]/30 via-transparent to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 text-white">
          <p className="font-serif text-3xl lg:text-4xl leading-tight">
            "A library is a hospital for the mind."
          </p>
          <p className="text-sm mt-3 opacity-80">— ancient Greek proverb</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 md:p-16">
        <div className="w-full max-w-sm fade-in">
          <div className="flex items-center gap-2 mb-10">
            <BookOpen className="w-7 h-7 text-[#E07A5F]" />
            <span className="font-serif text-2xl">Shelfsort</span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-3">
            Welcome back
          </p>
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-3">Open your library.</h1>
          <p className="text-[#6B705C] mb-10">
            Sign in with Google to save your sorted shelves across devices.
          </p>

          <button
            data-testid="google-signin-btn"
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border border-[#E8E6E1] hover:bg-[#F5F3EC] text-[#2C2C2C] font-medium px-5 py-3 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-xs text-[#6B705C] mt-8 leading-relaxed">
            By signing in, you agree to keep your EPUB library on Shelfsort. We never share your books.
          </p>
        </div>
      </div>
    </div>
  );
}
