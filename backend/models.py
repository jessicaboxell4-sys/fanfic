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
    # New-user gate (2026-06-15): every new sign-up lands in ``"pending"`` and
    # cannot log in until an admin approves them from /admin → Pending
    # sign-ups. Existing users without the field default to ``"approved"``
    # so the rollout doesn't lock anyone out. Admins can also ``"reject"``
    # a sign-up with a reason — those users get an email + can re-register.
    approval_status: str = "approved"  # "approved" | "pending" | "rejected"
    approval_rejected_reason: Optional[str] = None
    scheduled_deletion_at: Optional[datetime] = None
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

