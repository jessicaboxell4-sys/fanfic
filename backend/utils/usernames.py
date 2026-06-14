"""Username helpers — strict format, uniqueness, suggestion-from-email."""
import re
from typing import Optional

from deps import db

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,20}$")
USERNAME_MIN_LEN = 3
USERNAME_MAX_LEN = 20
# Reserved handles so users can't squat on system routes.
RESERVED_USERNAMES = {
    "admin", "administrator", "root", "system", "support", "help", "shelfsort",
    "you", "me", "self", "null", "none", "undefined", "anonymous", "guest",
    "api", "auth", "login", "logout", "register", "settings", "account",
    "library", "books", "library", "friends", "messages", "bookclubs",
    "goals", "year-in-books", "yearinbooks", "share", "tour", "demo",
    "test", "user", "users", "everyone", "all",
}


def normalize_username(raw: str) -> str:
    """Lowercase + strip; does NOT enforce the regex (validate separately)."""
    return (raw or "").strip().lower()


def validate_username_format(handle: str) -> Optional[str]:
    """Return None when valid, else a human-friendly error string."""
    if not handle:
        return "Username can't be empty"
    if len(handle) < USERNAME_MIN_LEN:
        return f"Username must be at least {USERNAME_MIN_LEN} characters"
    if len(handle) > USERNAME_MAX_LEN:
        return f"Username must be at most {USERNAME_MAX_LEN} characters"
    if not USERNAME_RE.match(handle):
        return "Username can only contain lowercase letters, numbers, and underscores"
    if handle in RESERVED_USERNAMES:
        return "That username is reserved"
    if handle.startswith("_") or handle.endswith("_"):
        return "Username can't start or end with an underscore"
    return None


async def username_is_taken(handle: str, except_user_id: Optional[str] = None) -> bool:
    """Case-insensitive uniqueness check across all users."""
    if not handle:
        return False
    q = {"username": handle}
    if except_user_id:
        q["user_id"] = {"$ne": except_user_id}
    found = await db.users.find_one(q, {"_id": 0, "user_id": 1})
    return found is not None


def suggestion_from_email(email: str) -> str:
    """Derive a sensible starter handle from an email prefix.
    Returns a lowercase, regex-compliant slug — may still collide; callers
    should append a suffix if so."""
    prefix = (email or "").split("@")[0].lower()
    slug = re.sub(r"[^a-z0-9_]", "_", prefix)
    slug = re.sub(r"_+", "_", slug).strip("_")
    if len(slug) < USERNAME_MIN_LEN:
        slug = (slug + "_user")[:USERNAME_MAX_LEN]
    return slug[:USERNAME_MAX_LEN]
