import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  X,
  Mail,
  Loader2,
  Share2,
  Copy,
  Link as LinkIcon,
  Eye,
  Trash2,
  ArrowRight,
  ArrowLeft,
  ImageDown,
  ClipboardCopy,
} from "lucide-react";
import { toPng, toBlob } from "html-to-image";
import YearInBooksWrapped, { YearInBooksEmpty } from "../components/YearInBooksWrapped";
import YearInBooksShareCard from "../components/YearInBooksShareCard";

export default function YearInBooksPage() {
  const { year: yearParam } = useParams();
  const navigate = useNavigate();
  const year = Number(yearParam) || new Date().getFullYear() - 1;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Sharing
  const [share, setShare] = useState(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Progress dots
  const scrollRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);

  // PNG export
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const canCopyImage =
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === "function";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/year-in-books/${year}`);
        if (!cancelled) setData(data);
      } catch (e) {
        toast.error("Couldn't load your year recap");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/year-in-books/${year}/share`);
        if (!cancelled) setShare(data);
      } catch (e) {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

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

  const createShare = async () => {
    setSharing(true);
    try {
      const { data } = await api.post(`/year-in-books/${year}/share`);
      setShare(data);
      setShareDialogOpen(true);
      toast.success("Share link ready");
    } catch (e) {
      toast.error("Couldn't create share link");
    } finally {
      setSharing(false);
    }
  };

  const revokeShare = async () => {
    if (!window.confirm("Revoke this share link? The URL will stop working immediately.")) return;
    setSharing(true);
    try {
      await api.delete(`/year-in-books/${year}/share`);
      setShare({ shared: false });
      setShareDialogOpen(false);
      toast.success("Share link revoked");
    } catch (e) {
      toast.error("Couldn't revoke");
    } finally {
      setSharing(false);
    }
  };

  const copyShareUrl = async () => {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      toast.success("Link copied!");
    } catch (e) {
      toast.error("Couldn't copy — please copy manually");
    }
  };

  const emailMe = async () => {
    setSendingEmail(true);
    try {
      const { data } = await api.post(`/year-in-books/${year}/email`);
      if (data.delivered) toast.success("Year recap emailed!");
      else if (data.logged)
        toast.warning("Email isn't configured on this server — but the recap is right here on this page.");
      else toast.error("Couldn't send email");
    } catch (e) {
      toast.error("Couldn't send email");
    } finally {
      setSendingEmail(false);
    }
  };

  const scrollToSlide = (idx) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * el.clientHeight, behavior: "smooth" });
  };

  const downloadPng = async () => {
    const node = cardRef.current;
    if (!node) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1080,
        height: 1350,
        backgroundColor: "#1B1240",
      });
      const link = document.createElement("a");
      link.download = `shelfsort-wrapped-${year}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Saved! Share it anywhere.");
    } catch (e) {
      toast.error("Couldn't generate image — please try again");
    } finally {
      setDownloading(false);
    }
  };

  const copyPng = async () => {
    const node = cardRef.current;
    if (!node) return;
    setCopying(true);
    try {
      const blob = await toBlob(node, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1080,
        height: 1350,
        backgroundColor: "#1B1240",
      });
      if (!blob) throw new Error("blob_null");
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blob }),
      ]);
      toast.success("Image copied — paste into Instagram, Threads, anywhere");
    } catch (e) {
      toast.error("Couldn't copy — try Download as PNG instead");
    } finally {
      setCopying(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center"
        style={{ background: "linear-gradient(135deg, #1B1240 0%, #6B46C1 100%)", color: "#fff" }}
      >
        <Loader2 className="w-10 h-10 animate-spin mb-4 opacity-90" />
        <p className="font-serif text-2xl italic opacity-90">Reading your year…</p>
      </div>
    );
  }

  const s = data?.summary || {};
  const hasData = data?.has_data;
  const currentYear = new Date().getFullYear();

  if (!hasData) {
    return (
      <YearInBooksEmpty
        year={year}
        currentYear={currentYear}
        onPrev={() => navigate(`/library/year/${year - 1}`)}
        closeButton={
          <button
            onClick={() => navigate("/library/stats")}
            data-testid="back-to-stats"
            className="absolute top-5 left-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center"
            aria-label="Back to stats"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
      />
    );
  }

  const footerCta = (
    <>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={downloadPng}
          disabled={downloading}
          data-testid="download-year-png"
          className="px-5 py-2.5 rounded-full bg-white text-[#2C2C2C] text-sm font-semibold hover:bg-white/90 inline-flex items-center gap-2 disabled:opacity-60"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageDown className="w-4 h-4" />}
          Download as PNG
        </button>
        {canCopyImage && (
          <button
            onClick={copyPng}
            disabled={copying}
            data-testid="copy-year-png"
            className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCopy className="w-4 h-4" />}
            Copy image
          </button>
        )}
        <button
          onClick={emailMe}
          disabled={sendingEmail}
          data-testid="email-year-recap"
          className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Email me this recap
        </button>
        <button
          onClick={share?.shared ? () => setShareDialogOpen(true) : createShare}
          disabled={sharing}
          data-testid="share-year-recap"
          className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
          {share?.shared ? "Manage share link" : "Share my year"}
        </button>
      </div>
      <p className="text-xs opacity-70 mt-4">
        PNG works great on Instagram & Twitter. Share link works without an account — revoke any time.
      </p>
      <div className="mt-8">
        <button
          onClick={() => navigate("/library/stats")}
          className="text-xs uppercase tracking-[0.25em] opacity-70 hover:opacity-100"
        >
          ← Back to stats
        </button>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-30 bg-black">
      {/* Top bar — exit + year nav */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-5 py-4 pointer-events-none">
        <button
          onClick={() => navigate("/library/stats")}
          data-testid="back-to-stats"
          className="pointer-events-auto w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center text-white"
          aria-label="Close recap"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => navigate(`/library/year/${year - 1}`)}
            data-testid="prev-year"
            className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-xs font-medium inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3 h-3" /> {year - 1}
          </button>
          {year < currentYear && (
            <button
              onClick={() => navigate(`/library/year/${year + 1}`)}
              data-testid="next-year"
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              {year + 1} <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <YearInBooksWrapped
        summary={s}
        year={year}
        scrollRef={scrollRef}
        activeSlide={activeSlide}
        onScrollToSlide={scrollToSlide}
        footerCta={footerCta}
      />

      {/* Off-screen share card used for PNG export */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: -99999,
          top: 0,
          width: 1080,
          height: 1350,
          pointerEvents: "none",
        }}
      >
        <YearInBooksShareCard ref={cardRef} summary={s} year={year} />
      </div>

      {/* Share dialog */}
      {shareDialogOpen && share?.shared && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShareDialogOpen(false)}
          data-testid="share-dialog-overlay"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full text-[#2C2C2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-[#E8E6E1] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1">Public link</p>
                <h2 className="font-serif text-2xl">Share your {year}</h2>
              </div>
              <button
                onClick={() => setShareDialogOpen(false)}
                data-testid="share-dialog-close"
                className="w-9 h-9 rounded-full hover:bg-[#F5F3EC] flex items-center justify-center text-[#6B705C]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-[#6B705C]">
                Anyone with this link can see your {year} recap — no Shelfsort account needed. Your email and book IDs stay private.
              </p>

              <div className="relative">
                <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
                <input
                  data-testid="share-url-input"
                  type="text"
                  readOnly
                  value={share.url || ""}
                  onClick={(e) => e.target.select()}
                  className="w-full bg-[#F5F3EC] border border-[#E8E6E1] rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={copyShareUrl}
                  data-testid="share-copy-btn"
                  className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy link
                </button>
                <a
                  href={share.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="share-open-btn"
                  className="btn-secondary text-sm inline-flex items-center gap-2"
                >
                  <ArrowRight className="w-4 h-4" />
                  Open
                </a>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#E8E6E1]">
                <div className="flex items-center gap-2 text-sm text-[#6B705C]" data-testid="share-view-count">
                  <Eye className="w-4 h-4" />
                  {share.view_count ?? 0} view{(share.view_count ?? 0) === 1 ? "" : "s"}
                  {share.last_viewed_at && (
                    <span className="text-xs">
                      · last seen {new Date(share.last_viewed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={revokeShare}
                  disabled={sharing}
                  data-testid="share-revoke-btn"
                  className="text-sm text-[#D9534F] hover:text-[#a83a36] inline-flex items-center gap-1.5 font-semibold disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
