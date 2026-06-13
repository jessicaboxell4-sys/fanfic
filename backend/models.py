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
    picture: Optional[str] = None
    is_admin: bool = False
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

