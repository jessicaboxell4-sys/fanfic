"""Username helpers — strict format, uniqueness, suggestion-from-email."""
import re
from typing import Optional

from deps import db

# Allow both cases so users can pick a stylised handle (e.g. "ImCrazy").
# Uniqueness is enforced *case-insensitively* — see `username_is_taken`.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
USERNAME_MIN_LEN = 3
USERNAME_MAX_LEN = 20
# Reserved handles so users can't squat on system routes. Compared lowercase.
RESERVED_USERNAMES = {
    "admin", "administrator", "root", "system", "support", "help", "shelfsort",
    "you", "me", "self", "null", "none", "undefined", "anonymous", "guest",
    "api", "auth", "login", "logout", "register", "settings", "account",
    "library", "books", "library", "friends", "messages", "bookclubs",
    "goals", "year-in-books", "yearinbooks", "share", "tour", "demo",
    "test", "user", "users", "everyone", "all",
}


def normalize_username(raw: str) -> str:
    """Strip whitespace; preserves the user's chosen casing."""
    return (raw or "").strip()


def validate_username_format(handle: str) -> Optional[str]:
    """Return None when valid, else a human-friendly error string."""
    if not handle:
        return "Username can't be empty"
    if len(handle) < USERNAME_MIN_LEN:
        return f"Username must be at least {USERNAME_MIN_LEN} characters"
    if len(handle) > USERNAME_MAX_LEN:
        return f"Username must be at most {USERNAME_MAX_LEN} characters"
    if not USERNAME_RE.match(handle):
        return "Username can only contain letters, numbers, and underscores"
    if handle.lower() in RESERVED_USERNAMES:
        return "That username is reserved"
    if handle.startswith("_") or handle.endswith("_"):
        return "Username can't start or end with an underscore"
    return None


async def username_is_taken(handle: str, except_user_id: Optional[str] = None) -> bool:
    """Case-INSENSITIVE uniqueness check across all users.

    Stops two users from sharing the same handle in different casings
    (``Brad`` vs ``brad``) — would be confusing in friend search & DMs.
    """
    if not handle:
        return False
    lowered = handle.lower()
    q = {"username_lower": lowered}
    if except_user_id:
        q["user_id"] = {"$ne": except_user_id}
    found = await db.users.find_one(q, {"_id": 0, "user_id": 1})
    if found:
        return True
    # Backfill path: older users may not have `username_lower` yet — fall back
    # to a regex match on `username` itself. (Not a hot path; once each user
    # claims a fresh handle their `username_lower` is written.)
    q2 = {"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}}
    if except_user_id:
        q2["user_id"] = {"$ne": except_user_id}
    return await db.users.find_one(q2, {"_id": 0, "user_id": 1}) is not None


def suggestion_from_email(email: str) -> str:
    """Derive a sensible starter handle from an email prefix.
    Returns a regex-compliant slug — may still collide; callers should
    append a suffix if so."""
    prefix = (email or "").split("@")[0]
    slug = re.sub(r"[^A-Za-z0-9_]", "_", prefix)
    slug = re.sub(r"_+", "_", slug).strip("_")
    if len(slug) < USERNAME_MIN_LEN:
        slug = (slug + "_user")[:USERNAME_MAX_LEN]
    return slug[:USERNAME_MAX_LEN]
