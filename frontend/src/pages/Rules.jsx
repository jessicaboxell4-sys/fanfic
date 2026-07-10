import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Loader2, ArrowLeft } from "lucide-react";
import { api } from "../lib/api";

/**
 * Public community-rules page.  Reads the admin-editable markdown
 * from ``/api/rules`` so updates ship without a redeploy.  Linked
 * from the register form's "I agree" checkbox and from the footer.
 *
 * The markdown is rendered with a tiny home-grown formatter — no
 * extra dependency for the four constructs we actually use
 * (``# heading``, ``## heading``, paragraphs, blank-line breaks).
 */
function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split(/\r?\n/);
  const out = [];
  let buf = [];
  const flushBuf = (key) => {
    if (buf.length === 0) return;
    out.push(
      <p key={`p-${key}`} className="text-[#2C2C2C] leading-relaxed mb-4">
        {buf.join(" ")}
      </p>
    );
    buf = [];
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flushBuf(idx);
      return;
    }
    if (line.startsWith("# ")) {
      flushBuf(idx);
      out.push(
        <h1
          key={`h1-${idx}`}
          className="font-serif text-3xl text-[#2C2C2C] mt-2 mb-6"
        >
          {line.slice(2)}
        </h1>
      );
      return;
    }
    if (line.startsWith("## ")) {
      flushBuf(idx);
      out.push(
        <h2
          key={`h2-${idx}`}
          className="font-serif text-xl text-[#2C2C2C] mt-7 mb-3"
        >
          {line.slice(3)}
        </h2>
      );
      return;
    }
    buf.push(line);
  });
  flushBuf("end");
  return out;
}

export default function Rules() {
  const [md, setMd] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .get("/rules")
      .then(({ data }) => {
        if (mounted) setMd(data?.rules_md || "");
      })
      .catch(() => {
        if (mounted) setMd("");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-paper" data-testid="rules-page">
      <header className="border-b border-[#E8E6E1]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            to="/"
            className="text-[#5B5F4D] hover:text-[#E07A5F] inline-flex items-center gap-1.5 text-sm font-semibold"
            data-testid="rules-back-home"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div className="flex-1" />
          <div className="inline-flex items-center gap-2 text-[#2C2C2C]">
            <BookOpen className="w-5 h-5 text-[#E07A5F]" />
            <span className="font-serif text-lg">Shelfsort</span>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        {loading ? (
          <p
            className="text-sm text-[#5B5F4D] inline-flex items-center gap-2"
            data-testid="rules-loading"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading rules…
          </p>
        ) : md ? (
          <article data-testid="rules-content">{renderMarkdown(md)}</article>
        ) : (
          <p className="text-sm text-[#5B5F4D] italic" data-testid="rules-empty">
            Couldn&apos;t load the community rules right now. Please try again later.
          </p>
        )}
      </main>
    </div>
  );
}
