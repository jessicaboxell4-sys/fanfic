import React from "react";

/**
 * Single source of truth for how a user's public identity is rendered.
 *
 * Display rules (in priority order):
 *  1. If the user has `username` AND `previous_username` → "username (previous_username)"
 *  2. If the user has `username` only → "@username"
 *  3. Else → name (existing behaviour for legacy users with no handle yet)
 *  4. Else → email prefix as a last-resort fallback
 *
 * Props:
 *   user        - { username?, previous_username?, name?, email? }
 *   atSign      - prepend "@" before the username when no previous one is set
 *                 (default true). Useful for chat headers; turn off in lists.
 *   className   - passthrough
 *   testid      - data-testid
 */
export default function DisplayName({ user, atSign = true, className = "", testid }) {
  if (!user) return null;
  const u = (user.username || "").trim();
  const prev = (user.previous_username || "").trim();
  const name = (user.name || "").trim();
  const email = (user.email || "").trim();

  let primary = "";
  let suffix = "";
  if (u) {
    primary = atSign ? `@${u}` : u;
    if (prev) suffix = ` (${prev})`;
  } else if (name) {
    primary = name;
  } else if (email) {
    primary = email.split("@")[0];
  } else {
    primary = "Someone";
  }

  return (
    <span className={className} data-testid={testid}>
      {primary}
      {suffix && <span className="text-[#5B5F4D] text-[0.85em]" data-testid={testid ? `${testid}-prev` : undefined}>{suffix}</span>}
    </span>
  );
}
