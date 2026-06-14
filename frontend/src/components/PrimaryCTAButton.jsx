import React from "react";
import { Link } from "react-router-dom";

/**
 * Standardised primary CTA. Either renders an internal <Link> when `to` is
 * provided, an external <a> when `href`, an in-page anchor <a> when `anchor`
 * (e.g. "#features"), or a `<button>` otherwise.
 *
 * Props:
 *   to       — internal route (uses react-router Link)
 *   href     — external URL (uses <a target=_blank>)
 *   anchor   — in-page hash like "#features" (same-page scroll, no _blank)
 *   onClick  — falls back to a <button>
 *   icon     — optional left-side icon (lucide-react component)
 *   size     — "sm" (compact) | "md" (default)
 *   testid   — data-testid
 *   disabled — buttons only
 *   children — label
 */
const SIZE_CLASSES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export default function PrimaryCTAButton({
  to,
  href,
  anchor,
  onClick,
  icon: Icon,
  size = "md",
  testid,
  disabled = false,
  className = "",
  children,
}) {
  const base = `inline-flex items-center gap-2 rounded-lg bg-[#6B46C1] text-white font-semibold hover:bg-[#553B96] transition-colors shadow-sm ${SIZE_CLASSES[size] || SIZE_CLASSES.md} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`;

  const iconEl = Icon ? <Icon className={size === "sm" ? "w-3 h-3" : "w-4 h-4"} /> : null;
  const content = (
    <>
      {iconEl}
      {children}
    </>
  );
  const sharedProps = { className: base, ...(testid ? { "data-testid": testid } : {}) };

  if (to && !disabled) {
    return <Link to={to} {...sharedProps}>{content}</Link>;
  }
  if (anchor && !disabled) {
    return <a href={anchor} {...sharedProps}>{content}</a>;
  }
  if (href && !disabled) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...sharedProps}>{content}</a>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...sharedProps}
    >
      {content}
    </button>
  );
}
