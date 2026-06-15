"""Auth dependency: get_current_user + variants. Used by every router.

Approval gate
-------------
Every API call goes through ``get_current_user``. As of 2026-06-15 we also
gate on ``approval_status`` here so a pending or rejected user can't act
on the API even if they hold a valid session cookie (the Google-OAuth
path issues a session before approval, so the cookie alone isn't enough).

Two flavours:
  • ``get_current_user`` — strict, the default. Refuses pending/rejected
    users with a structured 403 the frontend can detect and show the
    pending screen for.
  • ``get_current_user_any_status`` — for ``/auth/me`` and ``/auth/logout``
    only, where the FE needs to read the user's approval status without
    being booted off the API.
"""
from fastapi import HTTPException, Request
from datetime import datetime, timezone
from deps import db
from models import User


async def _resolve_session_user(request: Request) -> User:
    """Cookie/Bearer → session → user. No approval-status check."""
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


async def get_current_user(request: Request) -> User:
    """Strict dep: refuses pending or rejected accounts with 403.

    Returns a structured detail so the FE can branch:
      ``{"code": "pending_approval"}`` — sign-up awaiting admin review.
      ``{"code": "rejected", "reason": str}`` — sign-up was rejected.
    """
    user = await _resolve_session_user(request)
    status = (user.approval_status or "approved").lower()
    if status == "pending":
        raise HTTPException(
            status_code=403,
            detail={"code": "pending_approval", "message": "Your account is pending admin approval."},
        )
    if status == "rejected":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "rejected",
                "message": "Your sign-up was not approved.",
                "reason": user.approval_rejected_reason or "",
            },
        )
    return user


async def get_current_user_any_status(request: Request) -> User:
    """Lenient dep for the very few endpoints (``auth/me``, ``auth/logout``)
    that must work for users in any approval state — so the frontend can
    read the status and show the right screen without being kicked off
    the API entirely."""
    return await _resolve_session_user(request)


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
