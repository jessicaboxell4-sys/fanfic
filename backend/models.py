"""Shared Pydantic models."""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

# ============================================================
# MODELS
# ============================================================
class User(BaseModel):
    user_id: str
    email: str
    name: str
    # Optional public Discord-style handle. Lowercase, [a-z0-9_], 3-20 chars,
    # globally unique. Falls back to ``name`` everywhere it's displayed.
    username: Optional[str] = None
    # Previous handle, set the first time the user changes their username so
    # the UI can render "newhandle (oldhandle)" until they change it again.
    previous_username: Optional[str] = None
    picture: Optional[str] = None
    is_admin: bool = False
    # Moderators role (2026-06-17): a permission tier between regular users
    # and full admins. Mods can approve / reject pending sign-ups and lock
    # bookclub rooms, but cannot ban users, demote admins, set feature
    # flags, or run destructive admin actions. Promoted by admins only.
    is_moderator: bool = False
    # New-user gate (2026-06-15): every new sign-up lands in ``"pending"`` and
    # cannot log in until an admin approves them from /admin → Pending
    # sign-ups. Existing users without the field default to ``"approved"``
    # so the rollout doesn't lock anyone out. Admins can also ``"reject"``
    # a sign-up with a reason — those users get an email + can re-register.
    approval_status: str = "approved"  # "approved" | "pending" | "rejected"
    approval_rejected_reason: Optional[str] = None
    scheduled_deletion_at: Optional[datetime] = None
    # Short user-supplied "about" line surfaced on /u/<handle> and
    # /u/<handle>/library (2026-06-26 evening).  Hard-capped at 280
    # chars frontend + backend; never required.
    bio: Optional[str] = None
    # Per-user unguessable token for the library RSS feed
    # (2026-06-26 evening).  Lazily generated the first time the user
    # opens Account → Privacy or hits the regenerate button.  Stored
    # only on the user doc, never logged.
    rss_token: Optional[str] = None
    # Stamps the FIRST time a user flipped their library public so we
    # can show the one-time "Your library is public — share it!" modal.
    # If null when they flip ON, the modal is shown then this is set.
    first_public_share_shown_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BookOut(BaseModel):
    book_id: str
    user_id: str
    filename: str
    title: str
    author: str
    description: Optional[str] = ""
    language: Optional[str] = ""
    publisher: Optional[str] = ""
    has_cover: bool = False
    category: str  # e.g., "Fanfiction", "Original Fiction", "Non-fiction"
    fandom: Optional[str] = None  # e.g., "Harry Potter", "Twilight"
    confidence: float = 0.0
    classifier: str = "metadata"  # "metadata" | "ai" | "manual"
    size_bytes: int = 0
    created_at: datetime

