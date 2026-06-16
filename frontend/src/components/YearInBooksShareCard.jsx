import React, { forwardRef } from "react";
import { Flame, Sparkles, UserCircle2, BookOpen } from "lucide-react";

/**
 * Instagram-friendly portrait card (1080x1350) used for PNG export.
 * Rendered off-screen by the parent; captured via html-to-image.
 *
 * Props:
 *   - summary: same shape as YearInBooksWrapped
 *   - year: number
 *   - ownerName?: string (used on the public share surface)
 */
const YearInBooksShareCard = forwardRef(function YearInBooksShareCard(
  { summary, year, ownerName },
  ref
) {
  const s = summary || {};
  const topFandom = (s.top_fandoms || [])[0];
  const topAuthor = (s.top_authors || [])[0];
  const subject = ownerName ? `${ownerName}'s` : "My";

  const stat = (label, value) => (
    <div style={{ flex: "1 1 0", minWidth: 0 }}>
      <div
        style={{
          fontFamily: "Georgia, 'Cormorant Garamond', serif",
          fontSize: 88,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 18,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.78,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  );

  const highlight = (Icon, label, primary, secondary) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 24,
        padding: "22px 26px",
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 999,
          background: "rgba(255,255,255,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon style={{ width: 26, height: 26, color: "#fff" }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            opacity: 0.72,
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: "Georgia, 'Cormorant Garamond', serif",
            fontSize: 38,
            lineHeight: 1.08,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {primary}
        </div>
        {secondary && (
          <div style={{ marginTop: 4, fontSize: 17, opacity: 0.7 }}>{secondary}</div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      data-testid="year-in-books-share-card"
      style={{
        width: 1080,
        height: 1350,
        position: "relative",
        overflow: "hidden",
        color: "#FFFFFF",
        fontFamily:
          "'Manrope', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
        background:
          "linear-gradient(135deg, #1B1240 0%, #3B1F7A 45%, #6B46C1 100%)",
        padding: "72px 80px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Soft starfield overlay */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.08,
          backgroundImage:
            "radial-gradient(circle at 18% 22%, #fff 0px, transparent 1.5px), radial-gradient(circle at 78% 58%, #fff 0px, transparent 1.5px), radial-gradient(circle at 42% 82%, #fff 0px, transparent 1.5px), radial-gradient(circle at 88% 18%, #fff 0px, transparent 1.5px)",
          backgroundSize: "5px 5px",
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontWeight: 700,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            fontSize: 18,
            opacity: 0.92,
          }}
        >
          <BookOpen style={{ width: 22, height: 22 }} />
          Shelfsort wrapped
        </div>
        <div
          style={{
            fontSize: 18,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            opacity: 0.7,
            fontWeight: 600,
          }}
        >
          {year}
        </div>
      </div>

      {/* Hero year + subtitle */}
      <div style={{ marginTop: 56, position: "relative", zIndex: 1 }}>
        <div
          style={{
            fontFamily: "Georgia, 'Cormorant Garamond', serif",
            fontSize: 320,
            lineHeight: 0.86,
            letterSpacing: "-0.04em",
            fontWeight: 500,
          }}
        >
          {year}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: "Georgia, 'Cormorant Garamond', serif",
            fontStyle: "italic",
            fontSize: 56,
            lineHeight: 1.05,
            opacity: 0.95,
          }}
        >
          {subject} year in books.
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          marginTop: 60,
          display: "flex",
          gap: 36,
          position: "relative",
          zIndex: 1,
        }}
      >
        {stat("Books", Number(s.books_opened) || 0)}
        {stat("Pages", (Number(s.pages_read) || 0).toLocaleString())}
        {stat("Streak", `${Number(s.longest_streak) || 0}d`)}
      </div>

      {/* Highlights */}
      <div
        style={{
          marginTop: 50,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          position: "relative",
          zIndex: 1,
        }}
      >
        {topFandom &&
          highlight(
            Sparkles,
            "Top world",
            topFandom.name,
            `${topFandom.count} book${topFandom.count === 1 ? "" : "s"}`
          )}
        {topAuthor &&
          highlight(
            UserCircle2,
            "Top voice",
            topAuthor.name,
            `${topAuthor.count} book${topAuthor.count === 1 ? "" : "s"}`
          )}
        {s.best_month && s.best_month.opens > 0 &&
          highlight(
            Flame,
            "Reading peak",
            s.best_month.name,
            `${s.best_month.opens} book${s.best_month.opens === 1 ? "" : "s"} opened`
          )}
      </div>

      {/* Footer */}
      <div style={{ flex: 1 }} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          paddingTop: 28,
          borderTop: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              opacity: 0.7,
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            {ownerName ? "Reader" : "From"}
          </div>
          <div
            style={{
              fontFamily: "Georgia, 'Cormorant Garamond', serif",
              fontSize: 36,
              lineHeight: 1,
            }}
          >
            {ownerName || "shelfsort.app"}
          </div>
        </div>
        <div
          style={{
            fontSize: 16,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            opacity: 0.7,
            fontWeight: 700,
            textAlign: "right",
          }}
        >
          shelfsort
        </div>
      </div>
    </div>
  );
});

export default YearInBooksShareCard;
