import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

/**
 * Twitter-style vanity URL: `/@username` redirects to `/u/{username}`.
 * Keeps shareable URLs short while leaving the canonical SPA route
 * unchanged.
 */
export default function VanityRedirect() {
  const { username } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (username) navigate(`/u/${username}`, { replace: true });
  }, [username, navigate]);
  return null;
}
