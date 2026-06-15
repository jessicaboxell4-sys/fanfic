import React, { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { BookOpen, ArrowRight, Loader2 } from "lucide-react";
import YearInBooksWrapped, { YearInBooksEmpty } from "../components/YearInBooksWrapped";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicYearInBooks() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const scrollRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/public/year/${token}`);
        if (!cancelled) setData(data);
      } catch (e) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Update meta tags for nicer link previews
  useEffect(() => {
    if (!data) return;
    const s = data.summary || {};
    const title = `${data.display_name}'s ${data.year} in books — Shelfsort`;
    const desc = data.has_data
      ? `${s.books_opened} books opened, ${s.books_finished} finished, ${s.longest_streak}-day longest streak.`
      : `${data.display_name}'s reading recap on Shelfsort.`;
    document.title = title;
    const setMeta = (attr, name, content) => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("name", "description", desc);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:type", "article");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
  }, [data]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollTop / el.clientHeight);
      setActiveSlide(idx);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [loading, data]);

  const scrollToSlide = (idx) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * el.clientHeight, behavior: "smooth" });
  };

  if (loading) {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center"
        style={{ background: "linear-gradient(135deg, #1B1240 0%, #6B46C1 100%)", color: "#fff" }}
      >
        <Loader2 className="w-10 h-10 animate-spin mb-4 opacity-90" />
        <p className="font-serif text-2xl italic opacity-90">Loading recap…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-paper">
        <header className="border-b border-[#E8E6E1] bg-paper/95 backdrop-blur sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#E07A5F]" />
              <span className="font-serif text-xl text-[#2C2C2C]">Shelfsort</span>
            </Link>
            <Link to="/login" className="btn-secondary text-xs">Sign in</Link>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-6 py-20 text-center">
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-4">This recap isn&apos;t available</h1>
          <p className="text-[#6B705C] mb-8">
            The share link may have been revoked or never existed. Check the URL or ask the sender for a fresh link.
          </p>
          <Link to="/" className="btn-primary text-sm inline-block">Visit Shelfsort</Link>
        </main>
      </div>
    );
  }

  const s = data.summary || {};
  const hasData = data.has_data;
  const year = data.year;
  const ownerName = data.display_name;
  const currentYear = new Date().getFullYear();

  if (!hasData) {
    return (
      <YearInBooksEmpty
        year={year}
        currentYear={currentYear}
        onLibraryLink="/"
      />
    );
  }

  const footerCta = (
    <>
      <p className="text-sm opacity-80 mb-4">
        Made on <span className="font-semibold">Shelfsort</span> — quietly organize your ebook library.
      </p>
      <Link
        to="/"
        data-testid="public-cta-signup"
        className="px-5 py-2.5 rounded-full bg-white text-[#2C2C2C] text-sm font-semibold hover:bg-white/90 inline-flex items-center gap-2"
      >
        Try Shelfsort free <ArrowRight className="w-4 h-4" />
      </Link>
    </>
  );

  return (
    <div className="fixed inset-0 z-30 bg-black">
      {/* Minimal top bar — Shelfsort logo only */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-5 py-4 pointer-events-none">
        <Link
          to="/"
          data-testid="public-shelfsort-logo"
          className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-xs font-medium"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Shelfsort
        </Link>
        <Link
          to="/login"
          className="pointer-events-auto px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-xs font-medium"
        >
          Sign in
        </Link>
      </div>

      <YearInBooksWrapped
        summary={s}
        year={year}
        ownerName={ownerName}
        scrollRef={scrollRef}
        activeSlide={activeSlide}
        onScrollToSlide={scrollToSlide}
        footerCta={footerCta}
      />
    </div>
  );
}
