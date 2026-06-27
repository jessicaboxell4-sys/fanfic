import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Breadcrumb
 * ----------
 * Tiny, dependency-free trail rendered above page headers on
 * navigation-deep pages (pairing shelves, character shelves, the
 * fandom-with-character-filter view, etc.).  Items are clickable when
 * a ``to`` is provided; the final item is the current page and is
 * shown in non-link styling.
 *
 * Usage:
 *   <Breadcrumb items={[
 *     { label: "Library", to: "/library" },
 *     { label: "Pairings", to: "/library/pairings" },
 *     { label: "Harry Potter/Draco Malfoy" },
 *   ]} />
 */
export default function Breadcrumb({ items, testId = "breadcrumb" }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid={testId}
      className="mb-4 flex flex-wrap items-center gap-1 text-xs text-[#6B705C]"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {item.to && !isLast ? (
              <Link
                to={item.to}
                data-testid={`${testId}-link-${idx}`}
                className="hover:text-[#6B46C1] underline-offset-2 hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                data-testid={`${testId}-current-${idx}`}
                className={isLast ? "text-[#2C2C2C] font-semibold" : ""}
              >
                {item.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight className="w-3 h-3 opacity-60" aria-hidden="true" />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
