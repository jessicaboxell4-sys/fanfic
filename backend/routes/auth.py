from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import io
import re
import json
import uuid
import zipfile
import asyncio
import tempfile
import secrets
import bcrypt
import resend
import requests as http_requests

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from deps import (
    db, app, api_router, logger, ROOT_DIR, STORAGE_DIR,
    EMERGENT_LLM_KEY, RESET_TOKEN_TTL_HOURS, RESEND_API_KEY,
    SENDER_EMAIL, FRONTEND_URL,
    COOKIE_SECURE, COOKIE_SAMESITE,
)
from models import User, BookOut
from auth_dep import get_current_user
from utils.email_log import log_email_send


# ============================================================
# AUTH ROUTES
# ============================================================
@api_router.post("/auth/google")
async def auth_google(request: Request, response: Response):
    body = await request.json()
    session_id = body.get('session_id')
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    try:
        r = http_requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.error(f"Emergent auth failed: {e}")
        raise HTTPException(status_code=401, detail="OAuth verification failed")

    email = data['email']
    name = data['name']
    picture = data.get('picture', '')
    session_token = data['session_token']

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing['user_id']
        await db.users.update_one(
            {"email": email},
            {"$set": {"name": name, "picture": picture}}
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })

    # Track previous + current login timestamps so the "Activity since
    # last login" widget can ask "what's new since I was last here?".
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await db.users.find_one({"user_id": user_id}, {"_id": 0, "last_login_at": 1})
    prev_login = (existing or {}).get("last_login_at")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "previous_login_at": prev_login or now_iso,
            "last_login_at": now_iso,
        }},
    )

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return {"user_id": user_id, "email": email, "name": name, "picture": picture}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "is_admin": user.is_admin,
        "scheduled_deletion_at": user.scheduled_deletion_at.isoformat() if user.scheduled_deletion_at else None,
    }


@api_router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    session_token = request.cookies.get('session_token')
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ============================================================
# EMAIL / PASSWORD AUTH (second sign-in option)
# ============================================================
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 8


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(pw: str, pw_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), pw_hash.encode("utf-8"))
    except Exception:
        return False


async def _issue_session(user_id: str, response: Response) -> str:
    """Create a fresh session_token row + set the cookie. Mirrors the Google flow."""
    token = f"st_{uuid.uuid4().hex}{uuid.uuid4().hex[:16]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })
    # Track previous + current login timestamps for the "since last login" widget.
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await db.users.find_one({"user_id": user_id}, {"_id": 0, "last_login_at": 1})
    prev_login = (existing or {}).get("last_login_at")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "previous_login_at": prev_login or now_iso,
            "last_login_at": now_iso,
        }},
    )
    response.set_cookie(
        key="session_token",
        value=token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return token


async def _is_locked_out(identifier: str) -> bool:
    """5 failed attempts in 15min triggers a lockout."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    fails = await db.login_attempts.count_documents(
        {"identifier": identifier, "ts": {"$gte": cutoff}}
    )
    return fails >= 5


async def _record_failed_attempt(identifier: str):
    await db.login_attempts.insert_one({
        "identifier": identifier,
        "ts": datetime.now(timezone.utc),
    })


async def _clear_failed_attempts(identifier: str):
    await db.login_attempts.delete_many({"identifier": identifier})


class RegisterBody(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class LoginBody(BaseModel):
    email: str
    password: str

@api_router.post("/auth/register")
async def auth_register(body: RegisterBody, response: Response):
    email = (body.email or "").strip().lower()
    password = body.password or ""
    name = (body.name or "").strip() or email.split("@")[0]

    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LEN} characters")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "password_hash": _hash_password(password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await _issue_session(user_id, response)
    return {"user_id": user_id, "email": email, "name": name, "picture": ""}


@api_router.post("/auth/login")
async def auth_login(body: LoginBody, request: Request, response: Response):
    email = (body.email or "").strip().lower()
    password = body.password or ""

    # Throttle by email only — behind ingress/NAT we can't trust client IP.
    identifier = f"email:{email}"

    if await _is_locked_out(identifier):
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please try again in 15 minutes.",
        )

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        await _record_failed_attempt(identifier)
        # Same generic error whether email exists or not — don't leak
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not _verify_password(password, user["password_hash"]):
        await _record_failed_attempt(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await _clear_failed_attempts(identifier)
    await _issue_session(user["user_id"], response)
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture", ""),
    }

class UpdateProfileBody(BaseModel):
    name: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@api_router.patch("/auth/profile")
async def update_profile(body: UpdateProfileBody, user: User = Depends(get_current_user)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name can't be empty")
    if len(name) > 80:
        raise HTTPException(status_code=400, detail="Name is too long")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"name": name}},
    )
    return {"ok": True, "name": name}


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordBody, user: User = Depends(get_current_user)):
    if len(body.new_password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"New password must be at least {MIN_PASSWORD_LEN} characters",
        )
    record = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not record or not record.get("password_hash"):
        raise HTTPException(
            status_code=400,
            detail="This account doesn't have a password (Google sign-in only). Use 'Forgot password' to set one.",
        )
    if not _verify_password(body.current_password, record["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    new_hash = _hash_password(body.new_password)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"password_hash": new_hash}},
    )
    return {"ok": True}


@api_router.get("/auth/profile")
async def get_profile(user: User = Depends(get_current_user)):
    """Profile + whether the account has a password set (controls UI for password change)."""
    record = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "user_id": record["user_id"],
        "email": record["email"],
        "name": record.get("name", ""),
        "picture": record.get("picture", ""),
        "has_password": bool(record.get("password_hash")),
        "is_admin": bool(record.get("is_admin", False)),
        "created_at": record.get("created_at"),
    }


# ---- Password reset ------------------------------------------------------
# (RESET_TOKEN_TTL_HOURS / RESEND_API_KEY / SENDER_EMAIL / FRONTEND_URL are
# imported from deps.py above.)

async def _send_password_reset_email(to_email: str, reset_link: str):
    """Send the reset link via Resend, or fall back to console-log if no key configured."""
    subject = "Reset your Shelfsort password"
    text = (
        f"Hi,\n\n"
        f"Someone (hopefully you) asked to reset the password for your Shelfsort account.\n"
        f"Open this link within {RESET_TOKEN_TTL_HOURS} hour to choose a new password:\n\n"
        f"{reset_link}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n"
        f"— Shelfsort"
    )
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 0;font-family:Helvetica,Arial,sans-serif;">
      <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#6B46C1;font-weight:bold;text-transform:uppercase;">Shelfsort</p>
            <h1 style="margin:0 0 16px 0;font-family:Georgia,serif;color:#2C2C2C;font-size:28px;">Reset your password</h1>
            <p style="margin:0 0 24px 0;color:#6B705C;line-height:1.6;font-size:15px;">
              Someone (hopefully you) asked to reset the password on your Shelfsort account.
              Click the button below within {RESET_TOKEN_TTL_HOURS} hour to choose a new one.
            </p>
            <p style="margin:0 0 24px 0;">
              <a href="{reset_link}" style="display:inline-block;background:#E07A5F;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:600;font-size:15px;">Choose a new password</a>
            </p>
            <p style="margin:0 0 8px 0;color:#6B705C;font-size:13px;">Or paste this link into your browser:</p>
            <p style="margin:0 0 24px 0;word-break:break-all;font-size:12px;color:#E07A5F;">{reset_link}</p>
            <p style="margin:0;color:#6B705C;font-size:12px;line-height:1.5;">
              If you didn't request this, you can safely ignore this email — your password won't change.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    if not RESEND_API_KEY:
        logger.warning(
            "RESEND_API_KEY not set — password reset link for %s: %s",
            to_email, reset_link,
        )
        return {"delivered": False, "logged": True}
    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("password_reset", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id")}
    except Exception as e:
        logger.error("Resend send failed: %s", e)
        # Still log the link so the user can recover via support
        logger.warning("Reset link for %s (Resend failed): %s", to_email, reset_link)
        await log_email_send("password_reset", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e)}


class ForgotPasswordBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    password: str


@api_router.post("/auth/forgot-password")
async def auth_forgot_password(body: ForgotPasswordBody):
    """Always returns 200 so attackers can't probe which emails are registered."""
    email = (body.email or "").strip().lower()
    if not EMAIL_REGEX.match(email):
        # Still 200 to avoid enumeration; just no email gets sent
        return {"ok": True}

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and user.get("password_hash"):
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=RESET_TOKEN_TTL_HOURS)
        # Invalidate any prior outstanding tokens for this user
        await db.password_reset_tokens.delete_many({"user_id": user["user_id"]})
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["user_id"],
            "email": email,
            "expires_at": expires_at,
            "used": False,
            "created_at": datetime.now(timezone.utc),
        })
        base = FRONTEND_URL.rstrip("/") if FRONTEND_URL else ""
        reset_link = f"{base}/reset-password?token={token}"
        await _send_password_reset_email(email, reset_link)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def auth_reset_password(body: ResetPasswordBody, response: Response):
    token = (body.token or "").strip()
    password = body.password or ""

    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LEN} characters",
        )
    if not token:
        raise HTTPException(status_code=400, detail="Missing reset token")

    rec = await db.password_reset_tokens.find_one({"token": token}, {"_id": 0})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="This reset link is invalid or already used")

    exp = rec.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired")

    # Update password + invalidate token + clear lockouts
    new_hash = _hash_password(password)
    await db.users.update_one(
        {"user_id": rec["user_id"]},
        {"$set": {"password_hash": new_hash}},
    )
    await db.password_reset_tokens.update_one(
        {"token": token},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _clear_failed_attempts(f"email:{rec['email']}")

    # Issue a fresh session so the user is signed in immediately
    await _issue_session(rec["user_id"], response)
    user = await db.users.find_one({"user_id": rec["user_id"]}, {"_id": 0})
    return {
        "ok": True,
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture", ""),
    }


# ============================================================
# ACCOUNT DELETION (permanent)
# ============================================================
class DeleteAccountBody(BaseModel):
    confirm_email: str
    """Must equal the signed-in user's own email (case-insensitive). Acts
    as the second factor against an accidental POST. The frontend asks
    the user to type it explicitly into a text field."""


@api_router.post("/account/delete")
async def delete_account(
    body: DeleteAccountBody,
    response: Response,
    user: User = Depends(get_current_user),
):
    """**Soft-delete** the account with a 30-day grace period. Sets
    `scheduled_deletion_at` on the user record, force-logs-out (clears all
    sessions + the response cookie), but leaves books / files / shelves
    intact until the daily scheduler (`account_grace_tick`) finds the row
    past its grace window and runs the hard purge. Logging in during the
    grace period flags the user with `pending_deletion` on `/auth/me` so
    the frontend can show a "Cancel deletion" banner.

    Distinct from `POST /api/books/wipe-library`, which is per-book and
    keeps the account active.
    """
    if (body.confirm_email or "").strip().lower() != (user.email or "").strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Confirmation email does not match your account email.",
        )

    scheduled_for = datetime.now(timezone.utc) + timedelta(days=30)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"scheduled_deletion_at": scheduled_for}},
    )

    # Force-logout every device. User can still log back in during the
    # grace window to cancel — that re-issues a fresh session.
    await db.user_sessions.delete_many({"user_id": user.user_id})
    response.delete_cookie("session_token", path="/")

    return {
        "ok": True,
        "scheduled_deletion_at": scheduled_for.isoformat(),
        "grace_days": 30,
        "message": "Account scheduled for deletion in 30 days. Sign in any time before then to cancel.",
    }


@api_router.post("/account/cancel-deletion")
async def cancel_account_deletion(user: User = Depends(get_current_user)):
    """Unschedule a pending account deletion. Idempotent — returns ok=True
    even if nothing was scheduled."""
    res = await db.users.update_one(
        {"user_id": user.user_id, "scheduled_deletion_at": {"$exists": True}},
        {"$unset": {"scheduled_deletion_at": ""}},
    )
    return {"ok": True, "was_scheduled": res.modified_count > 0}


async def _hard_delete_user(user_id: str) -> Dict[str, int]:
    """Internal: irreversibly purge a user. Called by the daily scheduler
    once `scheduled_deletion_at` is in the past. Mirrors the inline logic
    that used to live in `delete_account`."""
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
    user_dir = STORAGE_DIR / user_id
    files_removed = 0
    if user_dir.exists():
        for p in user_dir.iterdir():
            try:
                if p.is_file():
                    p.unlink()
                    files_removed += 1
            except Exception as e:
                logger.warning("hard_delete: couldn't unlink %s: %s", p, e)
        try:
            user_dir.rmdir()
        except Exception as e:
            logger.warning("hard_delete: couldn't rmdir %s: %s", user_dir, e)
    purged = {
        "books": (await db.books.delete_many({"user_id": user_id})).deleted_count,
        "reading_activity": (await db.reading_activity.delete_many({"user_id": user_id})).deleted_count,
        "smart_shelves": (await db.smart_shelves.delete_many({"user_id": user_id})).deleted_count,
        "categories": (await db.categories.delete_many({"user_id": user_id})).deleted_count,
        "user_sessions": (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count,
        "password_reset_tokens": (await db.password_reset_tokens.delete_many({"user_id": user_id})).deleted_count,
        "users": (await db.users.delete_one({"user_id": user_id})).deleted_count,
        "files_removed": files_removed,
    }
    logger.info("Hard-deleted account %s (%s): %s", user_id, (user_doc or {}).get("email"), purged)
    return purged


@api_router.post("/account/grace-tick")
async def grace_tick_manual(user: User = Depends(get_current_user)):
    """Manual tick endpoint for testing — runs the same purge the daily
    scheduler does. Returns a list of accounts that were hard-deleted in
    this pass. Any authed user can call this (cheap, idempotent: only
    rows past their grace window are touched)."""
    cutoff = datetime.now(timezone.utc)
    cursor = db.users.find(
        {"scheduled_deletion_at": {"$lte": cutoff}},
        {"_id": 0, "user_id": 1, "email": 1},
    )
    purged = []
    async for u in cursor:
        result = await _hard_delete_user(u["user_id"])
        purged.append({"user_id": u["user_id"], "email": u.get("email"), **result})
    return {"deleted": len(purged), "details": purged}


# ============================================================
# EPUB PARSING & CLASSIFICATION
# ============================================================



