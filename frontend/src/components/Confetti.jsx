import React from "react";

// CSS-only confetti burst. Renders 60 absolutely-positioned pieces with
// staggered fall animations.  When `active` is false the component
// renders nothing so it has zero cost on idle pages.
//
// Kept dependency-free (no canvas-confetti, no JSConfetti) so the global
// host can mount it in App.js without bloating the initial bundle.
export default function Confetti({ active }) {
  if (!active) return null;
  const colors = ["#E07A5F", "#6B46C1", "#81B29A", "#F2CC8F", "#3D405B", "#F4D8CD"];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.4,
    duration: 2 + Math.random() * 1.4,
    color: colors[i % colors.length],
    size: 6 + Math.random() * 8,
    rotateStart: Math.random() * 360,
    rotateEnd: Math.random() * 720 - 360,
  }));
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
      data-testid="confetti"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--rot-start": `${p.rotateStart}deg`,
            "--rot-end": `${p.rotateEnd}deg`,
          }}
        />
      ))}
      <style>{`
        .confetti-piece {
          position: absolute;
          top: -20px;
          border-radius: 2px;
          opacity: 0.95;
          animation-name: confetti-fall;
          animation-timing-function: cubic-bezier(.16,.84,.44,1);
          animation-iteration-count: 1;
          animation-fill-mode: forwards;
        }
        @keyframes confetti-fall {
          0%   { transform: translateY(0)        rotate(var(--rot-start)); opacity: 1; }
          100% { transform: translateY(115vh)    rotate(var(--rot-end));   opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
