import React from "react";

/**
 * SkipToContent — an invisible-until-focused link that lets keyboard
 * and screen-reader users bypass the sticky header/nav on the first
 * Tab keypress.  Required for WCAG 2.4.1 (Bypass Blocks).
 *
 * Pair with a `<main id="main-content" tabIndex={-1}>` element on the
 * same page — pressing Enter on the focused skip link moves focus
 * (and the scroll position) directly to that landmark.
 *
 * `sr-only` (from Tailwind) keeps it visually hidden by default; the
 * `focus:not-sr-only focus:fixed …` classes reveal it as a purple pill
 * in the top-left corner as soon as the browser's :focus-visible logic
 * highlights it (i.e. keyboard focus, not mouse click).
 */
export default function SkipToContent({ targetId = "main-content" }) {
  return (
    <a
      href={`#${targetId}`}
      data-testid="skip-to-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-[#6B46C1] focus:shadow-lg focus:border-2 focus:border-[#6B46C1] focus:font-semibold focus:text-sm"
    >
      Skip to main content
    </a>
  );
}
