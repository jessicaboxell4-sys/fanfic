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

Live-presence touch
-------------------
2026-06-29 — every authenticated request bumps ``users.last_seen_at``
so the admin "online?" indicator can compare it against now-5min.  The
write is throttled per-user (in-memory, 60s minimum gap) so a chatty
client polling 4-5 endpoints a second only writes Mongo at most once
per minute per user.  Process restart loses the throttle map — harmless,
just means a brief re-bump after pod redeploys.
"""
from fastapi import HTTPException, Request
from datetime import datetime, timezone
from deps import db
from models import User

# In-memory presence-touch throttle.  Maps user_id -> last write epoch.
# Capped lazily — when the map exceeds 10k keys we drop entries older
# than 5 min so the dict never grows unbounded.
_LAST_SEEN_WRITE: dict[str, float] = {}
_TOUCH_MIN_GAP_S = 60.0
_LAST_SEEN_MAP_CAP = 10_000

# 2026-08-22 — Companion throttle for per-session `last_active_at`
# (drives the Account → Active devices list). Keyed on the session
# token itself so two devices signed into the same account each get
# their OWN last-active timestamp instead of stealing the throttle.
_SESSION_TOUCH_WRITE: dict[str, float] = {}
_SESSION_TOUCH_MIN_GAP_S = 60.0
_SESSION_TOUCH_MAP_CAP = 10_000

# 2026-07-10 — Paths that don't tell us anything useful about where
# the user actually IS in the product (background polls, presence
# refresh, health checks).  Skipping them means the stamped
# ``last_seen_path`` reflects a real page navigation, not the noisy
# polling loop firing every 30s.
_PRESENCE_SKIP_PREFIXES = (
    "/api/notifications/unread-count",
    "/api/notifications/poll",
    "/api/health",
    "/api/admin/online-now",
    "/api/library/queue/summary",
    "/api/bgjobs",
)


async def _touch_last_seen(user_id: str, path: str | None = None) -> None:
    """Best-effort presence stamp.  Throttled per-user.  Never raises."""
    import time
    now_epoch = time.monotonic()
    last = _LAST_SEEN_WRITE.get(user_id)
    if last is not None and (now_epoch - last) < _TOUCH_MIN_GAP_S:
        return
    _LAST_SEEN_WRITE[user_id] = now_epoch
    if len(_LAST_SEEN_WRITE) > _LAST_SEEN_MAP_CAP:
        cutoff = now_epoch - 300.0
        for uid in [k for k, v in _LAST_SEEN_WRITE.items() if v < cutoff]:
            _LAST_SEEN_WRITE.pop(uid, None)
    update = {"last_seen_at": datetime.now(timezone.utc).isoformat()}
    # Only record ``last_seen_path`` when the endpoint is meaningful
    # for admin diagnostics (skip background polls).  Keeps the value
    # matching "where they were doing something" not "what polled".
    if path and not any(path.startswith(p) for p in _PRESENCE_SKIP_PREFIXES):
        update["last_seen_path"] = path
    try:
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": update},
        )
    except Exception:
        # Presence is a nice-to-have — never break an auth resolution
        # over a Mongo blip.  The throttle map already absorbs the
        # next call's worth of latency.
        pass


async def _touch_session_active(session_token: str) -> None:
    """Best-effort `last_active_at` stamp on the session row.

    Throttled per-session token so a chatty client polling many
    endpoints only writes the field at most once a minute. Never
    raises — presence data is nice-to-have.
    """
    if not session_token:
        return
    import time
    now_epoch = time.monotonic()
    last = _SESSION_TOUCH_WRITE.get(session_token)
    if last is not None and (now_epoch - last) < _SESSION_TOUCH_MIN_GAP_S:
        return
    _SESSION_TOUCH_WRITE[session_token] = now_epoch
    if len(_SESSION_TOUCH_WRITE) > _SESSION_TOUCH_MAP_CAP:
        cutoff = now_epoch - 300.0
        for tk in [k for k, v in _SESSION_TOUCH_WRITE.items() if v < cutoff]:
            _SESSION_TOUCH_WRITE.pop(tk, None)
    try:
        await db.user_sessions.update_one(
            {"session_token": session_token},
            {"$set": {"last_active_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass


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
    # Fire-and-forget presence touch (throttled per-user to ≤1 write/min).
    # Mounted here so EVERY authenticated path bumps the timestamp — page
    # loads, polls, uploads, websocket-equivalent polls.  See _touch_last_seen.
    # Also stamps ``last_seen_path`` (except for noisy polling endpoints)
    # so admins can see "on /library/all" style hints in the
    # Users & admins card.  Frontend adds a `X-Client-Path` header on
    # every axios request (see /app/frontend/src/lib/api.js).  For
    # legacy sessions / non-axios callers that don't set the header,
    # fall back to the API path with the ``/api`` prefix stripped so
    # the admin card still reads "/admin/fulltext/stats" instead of
    # the internal "/api/admin/fulltext/stats".
    client_path = request.headers.get("X-Client-Path")
    if not client_path:
        raw = request.url.path or ""
        client_path = raw[4:] if raw.startswith("/api/") else raw
    await _touch_last_seen(session['user_id'], client_path)
    # 2026-08-22 — Bump the per-session `last_active_at` so the Account
    # → Active devices card can show a real "last active 5 min ago"
    # instead of always saying "just now" from `created_at`.
    await _touch_session_active(session_token)
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


async def get_current_user_or_none(request: Request) -> "User | None":
    """Public-with-context dependency: returns the logged-in user if a
    valid session is present, else ``None``.  Use on endpoints that are
    publicly readable but want to personalise the response when the
    caller happens to be signed in (e.g. ``voted_by_me`` flag on the
    public covers feed)."""
    try:
        return await _resolve_session_user(request)
    except HTTPException:
        return None


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


async def require_moderator_or_admin(request: Request) -> User:
    """Permissive sibling of ``require_admin``: passes for either flag.

    Use for endpoints that should be open to moderators in addition to
    admins — pending-signup triage, bookclub room locking, etc. Mods
    inherit nothing from admins (no implicit promotion); both flags are
    independent columns on the user document, and an admin promotion
    intentionally does NOT also set ``is_moderator`` so the audit trail
    stays clean.
    """
    user = await get_current_user(request)
    if not (user.is_admin or user.is_moderator):
        raise HTTPException(status_code=403, detail="Moderator or admin only")
    return user
