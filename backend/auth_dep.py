"""Auth dependency: get_current_user. Used by every router."""
from fastapi import HTTPException, Request
from datetime import datetime, timezone
from deps import db
from models import User

# ============================================================
# AUTH HELPERS
# ============================================================
async def get_current_user(request: Request) -> User:
    # Try cookie first, then Authorization header
    session_token = request.cookies.get('session_token')
    if not session_token:
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            session_token = auth[7:]
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session.get('expires_at')
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session['user_id']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


async def require_admin(request: Request) -> User:
    """Like `get_current_user`, but 403s if the user isn't flagged `is_admin`.

    Use for write/destructive endpoints that should be operator-only (e.g.
    publishing release-note announcements). A startup migration in
    `server.py` promotes the oldest existing user to admin so the operator
    of a freshly upgraded install isn't locked out.
    """
    user = await get_current_user(request)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return user
