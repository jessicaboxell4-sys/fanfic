import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Sparkles, FolderTree, Download } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleStart = () => {
    if (user) navigate("/library");
    else navigate("/login");
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#FDFBF7]/80 border-b border-[#E8E6E1]">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
            <BookOpen className="w-6 h-6 text-[#E07A5F]" />
            <span className="font-serif text-2xl font-medium text-[#2C2C2C]">Shelfsort</span>
          </Link>
          <button
            data-testid="header-cta"
            onClick={handleStart}
            className="btn-primary text-sm"
          >
            {user ? "Open library" : "Sign in"}
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-20 grid lg:grid-cols-2 gap-12 items-center">
        <div className="fade-in">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-6">
            A quieter way to organize ebooks
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05] mb-6">
            Your EPUBs,<br/>
            sorted by <span className="italic text-[#E07A5F]">fandom</span>.
          </h1>
          <p className="text-base sm:text-lg text-[#6B705C] leading-relaxed mb-8 max-w-lg">
            Drop in a folder of EPUBs. Shelfsort reads the metadata and uses AI to file
            them by Harry Potter, Twilight, Marvel, original fiction, and anything else hiding
            in your downloads.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              data-testid="hero-cta-start"
              onClick={handleStart}
              className="btn-primary"
            >
              Start sorting
            </button>
            <a
              href="#features"
              className="btn-secondary"
              data-testid="hero-cta-learn"
            >
              How it works
            </a>
          </div>
        </div>
        <div className="relative">
          <img
            src="https://static.prod-images.emergentagent.com/jobs/a7cbf064-1bb1-48e6-b642-01b29d2915a4/images/69b714e80ad3526797631c1c9c820d1ffe10c66de28dc4bc99a11bde433fe454.png"
            alt="A cozy reading corner"
            className="rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full"
          />
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 md:px-8 pb-24 grid md:grid-cols-3 gap-6">
        <Feature
          icon={<Sparkles className="w-5 h-5" />}
          title="AI + metadata"
          body="EPUB metadata first, Claude as a quiet second opinion when the title alone won't tell."
        />
        <Feature
          icon={<FolderTree className="w-5 h-5" />}
          title="Folders that feel right"
          body="Fanfiction nests by fandom. Original fiction and non-fiction stay tidy on their own shelves."
        />
        <Feature
          icon={<Download className="w-5 h-5" />}
          title="Take it with you"
          body="Download a perfectly organized ZIP — your library, on any device, anywhere."
        />
      </section>
    </div>
  );
}

function Feature({ icon, title, body }) {
  return (
    <div className="shelf-card p-6">
      <div className="w-10 h-10 rounded-lg bg-[#E5EBE6] text-[#3A5A40] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-serif text-xl text-[#2C2C2C] mb-2">{title}</h3>
      <p className="text-sm text-[#6B705C] leading-relaxed">{body}</p>
    </div>
  );
}
