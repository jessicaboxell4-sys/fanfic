from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Request, Response, Depends, Form
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import re
import json
import uuid
import zipfile
import logging
import asyncio
import tempfile
import requests as http_requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import bcrypt
import secrets
import resend

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Storage dir
STORAGE_DIR = Path('/app/uploads')
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================================
# MODELS
# ============================================================
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
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

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return {"user_id": user_id, "email": email, "name": name, "picture": picture}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return {"user_id": user.user_id, "email": user.email, "name": user.name, "picture": user.picture}


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
    response.set_cookie(
        key="session_token",
        value=token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
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

    ip = (request.client.host if request.client else "?") or "?"
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
        "created_at": record.get("created_at"),
    }


# ---- Password reset ------------------------------------------------------
RESET_TOKEN_TTL_HOURS = 1
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


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
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#3A5A40;font-weight:bold;text-transform:uppercase;">Shelfsort</p>
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
        return {"delivered": True, "id": result.get("id")}
    except Exception as e:
        logger.error("Resend send failed: %s", e)
        # Still log the link so the user can recover via support
        logger.warning("Reset link for %s (Resend failed): %s", to_email, reset_link)
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
# EPUB PARSING & CLASSIFICATION
# ============================================================
FANDOM_KEYWORDS = {
    "Harry Potter": ["harry potter", "hogwarts", "hermione", "voldemort", "dumbledore", "weasley", "snape", "draco malfoy", "ron weasley"],
    "Twilight": ["twilight saga", "bella swan", "edward cullen", "stephenie meyer", "forks washington", "jacob black", "cullen family"],
    "Marvel": ["avengers", "iron man", "tony stark", "spider-man", "spider man", "captain america", "marvel comics", "x-men", "wolverine"],
    "DC Comics": ["batman", "superman", "wonder woman", "gotham", "bruce wayne", "clark kent", "dc comics"],
    "Star Wars": ["star wars", "jedi", "sith", "skywalker", "darth vader", "obi-wan", "the force"],
    "Lord of the Rings": ["lord of the rings", "frodo", "gandalf", "middle-earth", "middle earth", "hobbit", "tolkien"],
    "Sherlock Holmes": ["sherlock holmes", "221b baker", "john watson", "moriarty"],
    "Percy Jackson": ["percy jackson", "camp half-blood", "rick riordan"],
    "Doctor Who": ["doctor who", "tardis", "the doctor", "gallifrey"],
    "Supernatural": ["supernatural fic", "dean winchester", "sam winchester", "castiel"],
    "Game of Thrones": ["game of thrones", "westeros", "jon snow", "daenerys", "targaryen", "stark family"],
    "Hunger Games": ["hunger games", "katniss everdeen", "panem", "district 12"],
    "Naruto": ["naruto uzumaki", "konoha", "sasuke uchiha", "hokage", "akatsuki"],
    "My Hero Academia": ["my hero academia", "izuku midoriya", "u.a. high", "all might", "bakugou"],
    "BTS": ["bts fanfic", "jeon jungkook", "kim taehyung", "park jimin", "min yoongi"],
    "One Direction": ["one direction", "harry styles", "louis tomlinson", "larry stylinson"],
}

FANFIC_SIGNALS = [
    "fanfiction", "fan fiction", "fanfic", "ao3", "archive of our own",
    "fanfiction.net", "wattpad", "x reader", "x-reader", "reader insert",
    "y/n", "self-insert", "slash fic", "shipping", "alternate universe",
    "canon divergence", "what if", "one-shot", "drabble"
]

NONFICTION_SIGNALS = [
    "memoir", "biography", "autobiography", "history of", "essay", "essays",
    "guide to", "how to", "handbook", "textbook", "self-help", "nonfiction",
    "non-fiction", "cookbook", "manual", "reference"
]


def extract_epub_metadata(filepath: Path) -> Dict[str, Any]:
    """Extract title, author, description, cover from an EPUB file."""
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as e:
        logger.warning(f"EPUB parse failed for {filepath}: {e}")
        return {
            "title": filepath.stem,
            "author": "Unknown",
            "description": "",
            "language": "",
            "publisher": "",
            "cover_bytes": None,
            "series_name": None,
            "series_index": None,
            "parse_failed": True,
            "parse_error": str(e)[:200],
        }

    def m(field):
        items = book.get_metadata('DC', field)
        if items and len(items) > 0:
            return items[0][0] or ""
        return ""

    title = m('title') or filepath.stem
    creator = m('creator') or "Unknown"
    description = m('description') or ""
    language = m('language') or ""
    publisher = m('publisher') or ""

    # Strip HTML from description
    if description:
        description = BeautifulSoup(description, 'html.parser').get_text(separator=' ').strip()

    # --- Series metadata (Calibre custom meta) ----
    series_name: Optional[str] = None
    series_index: Optional[float] = None
    try:
        meta_items = book.get_metadata('OPF', 'meta')
        for value, attrs in meta_items or []:
            name = (attrs or {}).get('name', '').lower()
            content = (attrs or {}).get('content', '')
            if name == 'calibre:series' and content:
                series_name = content.strip()
            elif name == 'calibre:series_index' and content:
                try:
                    series_index = float(content)
                except ValueError:
                    pass
    except Exception:
        pass

    # Get cover
    cover_bytes = None
    try:
        for item in book.get_items_of_type(ebooklib.ITEM_COVER):
            cover_bytes = item.get_content()
            break
        if not cover_bytes:
            # Try cover id from metadata
            cover_meta = book.get_metadata('OPF', 'cover')
            if cover_meta:
                cover_id = cover_meta[0][1].get('content')
                if cover_id:
                    cover_item = book.get_item_with_id(cover_id)
                    if cover_item:
                        cover_bytes = cover_item.get_content()
        if not cover_bytes:
            # Look for an image item with 'cover' in name
            for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
                if 'cover' in item.get_name().lower():
                    cover_bytes = item.get_content()
                    break
    except Exception as e:
        logger.debug(f"Cover extraction failed: {e}")

    # Sample text from first chapters for classification
    sample_text = ""
    try:
        count = 0
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            if count >= 3:
                break
            content = item.get_content().decode('utf-8', errors='ignore')
            text = BeautifulSoup(content, 'html.parser').get_text(separator=' ')
            sample_text += " " + text[:2000]
            count += 1
    except Exception:
        pass

    return {
        "title": title.strip(),
        "author": creator.strip(),
        "description": description[:2000],
        "language": language,
        "publisher": publisher,
        "cover_bytes": cover_bytes,
        "sample_text": sample_text[:5000],
        "series_name": series_name,
        "series_index": series_index,
        "parse_failed": False,
    }


# Series patterns (used when EPUB has no calibre:series meta)
SERIES_TITLE_PATTERNS = [
    # "Title (Series Name #3)" or "Title (Series Name, #3)" or "Title (Series Name 3)"
    re.compile(r'^(?P<title>.+?)\s*\((?P<series>[^()]+?),?\s*#?\s*(?P<idx>\d+(?:\.\d+)?)\)\s*$', re.IGNORECASE),
    # "Series Name 03 - Title" or "Series Name #3 - Title"
    re.compile(r'^(?P<series>[A-Za-z][\w\s\'\-]+?)\s+#?(?P<idx>\d+(?:\.\d+)?)\s*[-–—:]\s*(?P<title>.+)$'),
    # "Title - Book 3 of Series Name"
    re.compile(r'^(?P<title>.+?)\s*[-–—,]\s*Book\s+(?P<idx>\d+(?:\.\d+)?)\s+of\s+(?P<series>.+)$', re.IGNORECASE),
    # "Series Name, Book 3: Title"
    re.compile(r'^(?P<series>.+?),?\s+Book\s+(?P<idx>\d+(?:\.\d+)?)\s*[:\-–—]\s*(?P<title>.+)$', re.IGNORECASE),
]


def detect_series_from_title(title: str) -> tuple:
    """Returns (series_name, series_index) or (None, None)."""
    if not title:
        return None, None
    for pat in SERIES_TITLE_PATTERNS:
        m = pat.match(title.strip())
        if m:
            try:
                return m.group('series').strip(), float(m.group('idx'))
            except (ValueError, IndexError):
                continue
    return None, None


URL_REGEX = re.compile(
    r'(?i)\b((?:https?://|www\.)[^\s<>"\')\]]+)'
)


def _clean_url(u: str) -> str:
    # Strip trailing punctuation common in prose
    return u.rstrip('.,;:)>]"\'')


def extract_urls_from_epub(filepath: Path) -> List[Dict[str, str]]:
    """Return a deduped list of {url, anchor} dicts extracted from EPUB content."""
    seen = set()
    results: List[Dict[str, str]] = []
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as e:
        logger.warning(f"EPUB read failed for link extraction: {e}")
        return results

    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        try:
            raw = item.get_content().decode('utf-8', errors='ignore')
        except Exception:
            continue
        soup = BeautifulSoup(raw, 'html.parser')

        # <a href="..."> links
        for a in soup.find_all('a', href=True):
            href = (a.get('href') or '').strip()
            if not href:
                continue
            if href.startswith('#') or href.startswith('mailto:') or href.startswith('javascript:'):
                continue
            if not href.lower().startswith(('http://', 'https://', 'www.')):
                continue
            href = _clean_url(href)
            anchor = a.get_text(separator=' ', strip=True)[:200]
            key = href.lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": href, "anchor": anchor})

        # Plain text URLs (e.g., "Visit https://example.com")
        plain = soup.get_text(separator=' ')
        for m in URL_REGEX.finditer(plain):
            href = _clean_url(m.group(1))
            key = href.lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": href, "anchor": ""})

    return results


def format_links_txt(book_title: str, book_author: str, links: List[Dict[str, str]]) -> str:
    lines = []
    lines.append(f"Title:  {book_title}")
    lines.append(f"Author: {book_author}")
    lines.append(f"Links:  {len(links)}")
    lines.append("=" * 60)
    lines.append("")
    if not links:
        lines.append("(No URLs found in this EPUB.)")
    else:
        for i, item in enumerate(links, 1):
            lines.append(f"{i}. {item['url']}")
            if item.get('anchor'):
                lines.append(f"   ↳ {item['anchor']}")
        lines.append("")
    return "\n".join(lines) + "\n"


# ============================================================
# FICHUB REFRESH — pull latest version of a fanfic from its source URL
# ============================================================
FICHUB_SOURCE_PATTERNS = [
    r'https?://(?:www\.)?archiveofourown\.org/works/\d+',
    r'https?://(?:www\.)?fanfiction\.net/s/\d+',
    r'https?://(?:www\.)?fictionpress\.com/s/\d+',
    r'https?://(?:www\.)?royalroad\.com/fiction/\d+',
    r'https?://(?:www\.)?spacebattles\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?sufficientvelocity\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?questionablequesting\.com/threads/[\w-]+\.\d+',
]

FICHUB_USER_AGENT = "Shelfsort/0.1 (+https://github.com/shelfsort)"


class FicHubNotFoundError(Exception):
    """FicHub couldn't generate an EPUB for this URL — mark the book as unavailable."""
    pass


def find_source_url(links: List[Dict[str, str]]) -> Optional[str]:
    """Return the first URL in the list that points to a supported fanfic source."""
    for item in links:
        url = (item.get('url') or '').strip()
        for pat in FICHUB_SOURCE_PATTERNS:
            m = re.search(pat, url, re.IGNORECASE)
            if m:
                return m.group(0)
    return None


async def fichub_fetch_epub(source_url: str) -> tuple:
    """Call FicHub and download the resulting EPUB.

    Returns (epub_bytes, fichub_meta_dict). Raises HTTPException on failure.
    """
    loop = asyncio.get_event_loop()

    def _meta_call():
        r = http_requests.get(
            "https://fichub.net/api/v0/epub",
            params={"q": source_url},
            headers={"User-Agent": FICHUB_USER_AGENT, "Accept": "application/json"},
            timeout=90,
        )
        r.raise_for_status()
        return r.json()

    try:
        data = await loop.run_in_executor(None, _meta_call)
    except Exception as e:
        logger.error(f"FicHub meta failed: {e}")
        raise HTTPException(status_code=502, detail=f"FicHub error: {e}")

    if data.get("err", 0) != 0:
        err_code = data.get("err")
        msg = data.get("info") or data.get("msg") or "couldn't generate EPUB"
        # err -9 is FicHub's generic "couldn't fetch this story" code — treat as not-found.
        # Any non-zero err is also treated as unavailable so we stop hammering FicHub.
        detail = f"FicHub couldn't find this story" if err_code in (-9, -1) else f"FicHub: {msg}"
        raise FicHubNotFoundError(detail)

    urls = data.get("urls") or {}
    epub_href = urls.get("epub") or data.get("epub_url")
    if not epub_href:
        raise HTTPException(status_code=502, detail="FicHub returned no EPUB URL")
    if epub_href.startswith("/"):
        epub_href = f"https://fichub.net{epub_href}"

    def _epub_call():
        r = http_requests.get(
            epub_href,
            headers={"User-Agent": FICHUB_USER_AGENT},
            timeout=180,
        )
        r.raise_for_status()
        return r.content

    try:
        epub_bytes = await loop.run_in_executor(None, _epub_call)
    except Exception as e:
        logger.error(f"FicHub download failed: {e}")
        raise HTTPException(status_code=502, detail=f"FicHub download failed: {e}")

    fichub_meta = {
        "chapters": data.get("meta", {}).get("chapters"),
        "updated": data.get("meta", {}).get("rawExtendedMeta", {}).get("dateUpdated")
                   or data.get("meta", {}).get("updated"),
        "words": data.get("meta", {}).get("rawExtendedMeta", {}).get("words"),
        "status": data.get("meta", {}).get("rawExtendedMeta", {}).get("status"),
    }
    return epub_bytes, fichub_meta


async def apply_refresh(book: Dict[str, Any], user_id: str, source_url: str) -> Dict[str, Any]:
    """Download from FicHub, replace local EPUB + cover + links, update DB. Returns updated fields."""
    epub_bytes, fichub_meta = await fichub_fetch_epub(source_url)

    user_dir = STORAGE_DIR / user_id
    epub_path = user_dir / f"{book['book_id']}.epub"
    epub_path.write_bytes(epub_bytes)

    new_meta = extract_epub_metadata(epub_path)
    cover_path = user_dir / f"{book['book_id']}.cover"
    if new_meta.get('cover_bytes'):
        cover_path.write_bytes(new_meta['cover_bytes'])

    links = extract_urls_from_epub(epub_path)
    (user_dir / f"{book['book_id']}.links.txt").write_text(
        format_links_txt(new_meta['title'], new_meta['author'], links),
        encoding='utf-8',
    )

    update = {
        "title": new_meta['title'],
        "author": new_meta['author'],
        "description": new_meta['description'],
        "language": new_meta['language'],
        "publisher": new_meta['publisher'],
        "has_cover": bool(new_meta.get('cover_bytes')),
        "size_bytes": len(epub_bytes),
        "links_count": len(links),
        "source_url": source_url,
        "last_refreshed_at": datetime.now(timezone.utc).isoformat(),
        "fichub_meta": fichub_meta,
    }
    await db.books.update_one(
        {"book_id": book['book_id'], "user_id": user_id},
        {"$set": update},
    )
    return update


def classify_by_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Heuristic keyword classification. Returns dict with category, fandom, confidence."""
    blob = " ".join([
        meta.get("title", ""),
        meta.get("author", ""),
        meta.get("description", ""),
        meta.get("publisher", ""),
        meta.get("sample_text", "")[:2000],
    ]).lower()

    matched_fandom = None
    best_count = 0
    for fandom, keywords in FANDOM_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in blob)
        if count > best_count:
            best_count = count
            matched_fandom = fandom

    is_fanfic = any(s in blob for s in FANFIC_SIGNALS)
    is_nonfic = any(s in blob for s in NONFICTION_SIGNALS)

    if matched_fandom and best_count >= 1:
        return {
            "category": "Fanfiction",
            "fandom": matched_fandom,
            "confidence": min(0.6 + 0.1 * best_count, 0.95),
            "classifier": "metadata",
        }
    if is_fanfic:
        return {"category": "Fanfiction", "fandom": "Other", "confidence": 0.7, "classifier": "metadata"}
    if is_nonfic:
        return {"category": "Non-fiction", "fandom": None, "confidence": 0.7, "classifier": "metadata"}

    return {"category": "Unclassified", "fandom": None, "confidence": 0.2, "classifier": "metadata"}


async def classify_with_ai(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Use Claude to classify when metadata heuristics are uncertain."""
    if not EMERGENT_LLM_KEY:
        return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}

    system_msg = (
        "You are a librarian classifying ebooks. Given book metadata, respond with strict JSON only: "
        '{"category": "Fanfiction|Original Fiction|Non-fiction", "fandom": "<specific fandom name like Harry Potter, Twilight, Marvel, or null if not fanfiction>", "confidence": 0.0-1.0}. '
        "Use Fanfiction only when it is clearly fan-derived from another work. "
        "For original fiction novels (even popular ones like the actual Harry Potter series by Rowling), use Original Fiction, not Fanfiction. "
        "Common fandoms: Harry Potter, Twilight, Marvel, DC Comics, Star Wars, Lord of the Rings, Sherlock Holmes, Percy Jackson, Doctor Who, Supernatural, Game of Thrones, Hunger Games, Naruto, My Hero Academia, BTS, One Direction. "
        "Return ONLY the JSON object, no markdown."
    )
    user_text = (
        f"Title: {meta.get('title','')}\n"
        f"Author: {meta.get('author','')}\n"
        f"Publisher: {meta.get('publisher','')}\n"
        f"Description: {meta.get('description','')[:600]}\n"
        f"Sample text: {meta.get('sample_text','')[:800]}"
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"classify-{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=user_text))
        # Extract JSON
        text = resp.strip()
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            obj = json.loads(m.group(0))
            cat = obj.get('category', 'Unclassified')
            fandom = obj.get('fandom')
            if fandom in (None, "null", "None", ""):
                fandom = None
            conf = float(obj.get('confidence', 0.5))
            return {"category": cat, "fandom": fandom, "confidence": conf, "classifier": "ai"}
    except Exception as e:
        logger.error(f"AI classify failed: {e}")
    return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}


async def classify_book(meta: Dict[str, Any], force_ai: bool = False) -> Dict[str, Any]:
    if not force_ai:
        meta_result = classify_by_metadata(meta)
        if meta_result['confidence'] >= 0.6:
            return meta_result
    ai_result = await classify_with_ai(meta)
    if ai_result['confidence'] > 0:
        return ai_result
    return classify_by_metadata(meta)


# ============================================================
# BOOK ROUTES
# ============================================================
@api_router.post("/books/upload")
async def upload_books(
    request: Request,
    files: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
):
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    results = []

    for f in files:
        if not f.filename.lower().endswith('.epub'):
            results.append({"filename": f.filename, "error": "Not an EPUB"})
            continue

        book_id = f"book_{uuid.uuid4().hex[:12]}"
        target = user_dir / f"{book_id}.epub"
        content = await f.read()
        target.write_bytes(content)

        meta = extract_epub_metadata(target)

        # Short-circuit: if the EPUB can't be opened at all, file it under
        # "Can't Open" and skip classification / AI / links / series detection.
        if meta.get("parse_failed"):
            doc = {
                "book_id": book_id,
                "user_id": user.user_id,
                "filename": f.filename,
                "title": meta.get("title") or f.filename,
                "author": "Unknown",
                "description": "",
                "language": "",
                "publisher": "",
                "has_cover": False,
                "category": "Can't Open",
                "fandom": None,
                "confidence": 1.0,
                "classifier": "broken-epub",
                "size_bytes": len(content),
                "links_count": 0,
                "source_url": None,
                "last_refreshed_at": None,
                "series_name": None,
                "series_index": None,
                "epub_unreadable": True,
                "epub_parse_error": meta.get("parse_error"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.books.insert_one(doc)
            results.append({k: v for k, v in doc.items() if k != "_id"})
            continue

        classification = await classify_book(meta)

        # Save cover separately if exists
        cover_path = user_dir / f"{book_id}.cover"
        if meta.get('cover_bytes'):
            cover_path.write_bytes(meta['cover_bytes'])

        # Extract URLs and save to a notepad-friendly .txt file
        links = extract_urls_from_epub(target)
        links_path = user_dir / f"{book_id}.links.txt"
        links_path.write_text(
            format_links_txt(meta['title'], meta['author'], links),
            encoding='utf-8',
        )
        source_url = find_source_url(links)

        # Series detection: prefer EPUB Calibre meta, fall back to title regex
        series_name = meta.get('series_name')
        series_index = meta.get('series_index')
        if not series_name:
            sn, si = detect_series_from_title(meta['title'])
            if sn:
                series_name = sn
                series_index = si if si is not None else series_index

        doc = {
            "book_id": book_id,
            "user_id": user.user_id,
            "filename": f.filename,
            "title": meta['title'],
            "author": meta['author'],
            "description": meta['description'],
            "language": meta['language'],
            "publisher": meta['publisher'],
            "has_cover": bool(meta.get('cover_bytes')),
            "category": classification['category'],
            "fandom": classification.get('fandom'),
            "confidence": classification['confidence'],
            "classifier": classification['classifier'],
            "size_bytes": len(content),
            "links_count": len(links),
            "source_url": source_url,
            "last_refreshed_at": None,
            "series_name": series_name,
            "series_index": series_index,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.books.insert_one(doc)
        results.append({k: v for k, v in doc.items() if k != '_id'})

    return {"uploaded": len(results), "books": results}


@api_router.get("/books")
async def list_books(
    request: Request,
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    q: Optional[str] = None,
    smart: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query['category'] = category
    if fandom:
        query['fandom'] = fandom

    or_clauses: List[List[Dict[str, Any]]] = []
    if q:
        or_clauses.append([
            {"title": {"$regex": q, "$options": "i"}},
            {"author": {"$regex": q, "$options": "i"}},
        ])

    if smart == "reading":
        query['progress_percent'] = {"$gte": 0.05, "$lt": 0.95}
    elif smart == "finished":
        query['progress_percent'] = {"$gte": 0.99}
    elif smart == "unavailable":
        query['fichub_unavailable'] = True
    elif smart == "unread":
        or_clauses.append([
            {"progress_percent": {"$exists": False}},
            {"progress_percent": None},
            {"progress_percent": {"$lt": 0.05}},
        ])

    if len(or_clauses) == 1:
        query["$or"] = or_clauses[0]
    elif len(or_clauses) > 1:
        query["$and"] = [{"$or": clauses} for clauses in or_clauses]

    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"books": books}


@api_router.get("/books/stats")
async def book_stats(user: User = Depends(get_current_user)):
    pipeline_cat = [
        {"$match": {"user_id": user.user_id}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]
    pipeline_fandom = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    cats = await db.books.aggregate(pipeline_cat).to_list(100)
    fandoms = await db.books.aggregate(pipeline_fandom).to_list(100)
    total = await db.books.count_documents({"user_id": user.user_id})
    reading = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_percent": {"$gte": 0.05, "$lt": 0.95},
    })
    finished = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_percent": {"$gte": 0.99},
    })
    unreadable = await db.books.count_documents({
        "user_id": user.user_id,
        "epub_unreadable": True,
    })
    return {
        "total": total,
        "reading": reading,
        "finished": finished,
        "unreadable": unreadable,
        "categories": [{"name": c['_id'], "count": c['count']} for c in cats],
        "fandoms": [{"name": f['_id'], "count": f['count']} for f in fandoms],
    }


def _suggest_search_url(source_url: Optional[str], title: str, author: str) -> Optional[str]:
    """Build a 'find it again' search URL on the same site as the dead source."""
    from urllib.parse import quote_plus
    q = quote_plus(f"{title or ''} {author or ''}".strip())
    if not q:
        return None
    host = (source_url or "").lower()
    if "archiveofourown.org" in host:
        return f"https://archiveofourown.org/works/search?work_search%5Bquery%5D={q}"
    if "fanfiction.net" in host:
        return f"https://www.fanfiction.net/search/?keywords={q}&type=story"
    if "fictionpress.com" in host:
        return f"https://www.fictionpress.com/search/?keywords={q}&type=story"
    if "royalroad.com" in host:
        return f"https://www.royalroad.com/fictions/search?title={q}"
    if "spacebattles.com" in host or "sufficientvelocity.com" in host or "questionablequesting.com" in host:
        base = host.split("/")[2] if "://" in host else host
        return f"https://www.google.com/search?q=site%3A{base}+{q}"
    # Generic fallback: Google
    return f"https://www.google.com/search?q={q}"


@api_router.get("/books/export/unavailable")
async def export_unavailable_list(user: User = Depends(get_current_user)):
    """A plain .txt list of every book FicHub couldn't find — for manual lookup."""
    books = await db.books.find(
        {"user_id": user.user_id, "fichub_unavailable": True},
        {"_id": 0},
    ).sort("title", 1).to_list(5000)

    lines: List[str] = []
    lines.append("Shelfsort — books FicHub couldn't find online")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"Count: {len(books)}")
    lines.append("=" * 70)
    lines.append("")
    if not books:
        lines.append("(none — every refreshable book updated successfully)")
    else:
        for i, b in enumerate(books, 1):
            shelf = b.get("category") or "Uncategorized"
            if shelf == "Fanfiction" and b.get("fandom"):
                shelf = f"Fanfiction / {b['fandom']}"
            lines.append(f"{i}. {b.get('title') or '(untitled)'}")
            lines.append(f"   Author:      {b.get('author') or 'Unknown'}")
            lines.append(f"   Shelf:       {shelf}")
            if b.get("source_url"):
                lines.append(f"   Source URL:  {b['source_url']}")
            if b.get("fichub_last_error"):
                lines.append(f"   FicHub said: {b['fichub_last_error']}")
            if b.get("fichub_last_attempt_at"):
                lines.append(f"   Last tried:  {b['fichub_last_attempt_at']}")
            search = _suggest_search_url(
                b.get("source_url"), b.get("title", ""), b.get("author", "")
            )
            if search:
                lines.append(f"   How to fix:  {search}")
            lines.append("")
    body = "\n".join(lines) + "\n"
    headers = {"Content-Disposition": "attachment; filename=shelfsort_cant_find_online.txt"}
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)


@api_router.get("/books/refresh-status")
async def refresh_status(user: User = Depends(get_current_user)):
    """How many books in the library can be refreshed from a known fanfic source?"""
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "source_url": 1, "title": 1, "last_refreshed_at": 1, "fichub_unavailable": 1},
    ).to_list(5000)
    refreshable = sum(1 for b in books if b.get("source_url") and not b.get("fichub_unavailable"))
    unavailable = sum(1 for b in books if b.get("fichub_unavailable"))
    last = None
    for b in books:
        if b.get("last_refreshed_at"):
            if last is None or b["last_refreshed_at"] > last:
                last = b["last_refreshed_at"]
    return {
        "refreshable": refreshable,
        "unavailable": unavailable,
        "total": len(books),
        "last_refreshed_at": last,
    }


@api_router.get("/books/recent")
async def list_recent(limit: int = 8, user: User = Depends(get_current_user)):
    """Recently-opened books for the dashboard's Continue Reading rail."""
    cursor = db.books.find(
        {"user_id": user.user_id, "last_opened_at": {"$ne": None, "$exists": True}},
        {"_id": 0},
    ).sort("last_opened_at", -1).limit(max(1, min(int(limit), 24)))
    books = await cursor.to_list(24)
    return {"books": books}


@api_router.get("/books/{book_id}")
async def get_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    return book


@api_router.get("/books/{book_id}/cover")
async def get_cover(book_id: str, request: Request):
    # Allow token in query for img src
    token = request.query_params.get('t')
    user_id = None
    if token:
        sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if sess:
            user_id = sess['user_id']
    if not user_id:
        try:
            user = await get_current_user(request)
            user_id = user.user_id
        except HTTPException:
            raise HTTPException(status_code=401, detail="Not authenticated")
    book = await db.books.find_one({"book_id": book_id, "user_id": user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    cover = STORAGE_DIR / user_id / f"{book_id}.cover"
    if not cover.exists():
        raise HTTPException(status_code=404, detail="No cover")
    return FileResponse(str(cover), media_type="image/jpeg")


@api_router.get("/books/{book_id}/download")
async def download_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(str(fp), media_type="application/epub+zip", filename=book['filename'])


@api_router.delete("/books/{book_id}")
async def delete_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    await db.books.delete_one({"book_id": book_id, "user_id": user.user_id})
    for ext in ['.epub', '.cover', '.links.txt']:
        p = STORAGE_DIR / user.user_id / f"{book_id}{ext}"
        if p.exists():
            p.unlink()
    return {"ok": True}


def _safe_filename(name: str, ext: str) -> str:
    # Strip path separators / control chars
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name or 'book').strip().rstrip('.')
    base = base[:120] or 'book'
    return f"{base}{ext}"


@api_router.get("/books/export/links")
async def export_all_links(
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Download a single .txt file with every URL across the user's library (or a filter)."""
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = category
    if fandom:
        query["fandom"] = fandom
    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    user_dir = STORAGE_DIR / user.user_id
    scope = "your library"
    if fandom:
        scope = f"the {fandom} shelf"
    elif category:
        scope = f"the {category} shelf"

    lines: List[str] = []
    lines.append(f"Shelfsort — links extracted from {scope}")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"Books scanned: {len(books)}")
    lines.append("=" * 70)
    lines.append("")

    total_links = 0
    for b in books:
        epub_path = user_dir / f"{b['book_id']}.epub"
        if not epub_path.exists():
            continue
        links = extract_urls_from_epub(epub_path)
        total_links += len(links)

        shelf = b.get('category') or 'Uncategorized'
        if shelf == 'Fanfiction' and b.get('fandom'):
            shelf = f"Fanfiction / {b['fandom']}"

        lines.append(f"[{shelf}] {b.get('title','')} — {b.get('author','')}")
        if not links:
            lines.append("  (no URLs)")
        else:
            for item in links:
                if item.get('anchor'):
                    lines.append(f"  {item['url']}  —  {item['anchor']}")
                else:
                    lines.append(f"  {item['url']}")
        lines.append("")

    lines.insert(3, f"Total URLs:    {total_links}")
    body = "\n".join(lines) + "\n"

    fname = "shelfsort_all_links.txt"
    if fandom:
        fname = f"shelfsort_{_safe_folder(fandom)}_links.txt"
    elif category:
        fname = f"shelfsort_{_safe_folder(category)}_links.txt"
    headers = {"Content-Disposition": f"attachment; filename={fname}"}
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)


@api_router.get("/books/{book_id}/links")
async def get_book_links(book_id: str, user: User = Depends(get_current_user)):
    """Download the extracted URLs for a single book as a .txt file."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    user_dir = STORAGE_DIR / user.user_id
    links_path = user_dir / f"{book_id}.links.txt"

    # Regenerate if missing (e.g., older book uploaded before this feature)
    if not links_path.exists():
        epub_path = user_dir / f"{book_id}.epub"
        if not epub_path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        links = extract_urls_from_epub(epub_path)
        links_path.write_text(
            format_links_txt(book['title'], book['author'], links),
            encoding='utf-8',
        )
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$set": {"links_count": len(links)}},
        )

    filename = _safe_filename(book.get('title') or book_id, '.links.txt')
    return FileResponse(str(links_path), media_type="text/plain; charset=utf-8", filename=filename)


class ReclassifyBody(BaseModel):
    use_ai: bool = True


class ReclassifyAllBody(BaseModel):
    only_unclassified: bool = True
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/reclassify-all")
async def reclassify_all(body: ReclassifyAllBody, user: User = Depends(get_current_user)):
    """Run the AI classifier on every matching book, then persist the new labels."""
    query: Dict[str, Any] = {"user_id": user.user_id}
    if body.only_unclassified:
        query["category"] = "Unclassified"
    else:
        if body.category:
            query["category"] = body.category
        if body.fandom:
            query["fandom"] = body.fandom

    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        return {"processed": 0, "changed": 0}

    user_dir = STORAGE_DIR / user.user_id
    sem = asyncio.Semaphore(3)  # cap concurrent AI calls

    async def process(b):
        async with sem:
            fp = user_dir / f"{b['book_id']}.epub"
            if not fp.exists():
                return None
            try:
                meta = extract_epub_metadata(fp)
                cls = await classify_with_ai(meta)
            except Exception as e:
                logger.error(f"AI reclass error for {b['book_id']}: {e}")
                return None
            if cls['confidence'] <= 0:
                return None
            return (b['book_id'], cls)

    results = await asyncio.gather(*[process(b) for b in books])
    changed = 0
    for r in results:
        if not r:
            continue
        bid, cls = r
        await db.books.update_one(
            {"book_id": bid, "user_id": user.user_id},
            {"$set": {
                "category": cls['category'],
                "fandom": cls.get('fandom'),
                "confidence": cls['confidence'],
                "classifier": cls['classifier'],
            }},
        )
        changed += 1
    return {"processed": len(books), "changed": changed}


@api_router.post("/books/{book_id}/reclassify")
async def reclassify_book(book_id: str, body: ReclassifyBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File missing")
    meta = extract_epub_metadata(fp)
    classification = await classify_book(meta, force_ai=body.use_ai)
    await db.books.update_one(
        {"book_id": book_id},
        {"$set": {
            "category": classification['category'],
            "fandom": classification.get('fandom'),
            "confidence": classification['confidence'],
            "classifier": classification['classifier'],
        }},
    )
    return classification


class UpdateBookBody(BaseModel):
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/refresh-all")
async def refresh_all(user: User = Depends(get_current_user)):
    """Re-pull every refreshable book from FicHub. Runs serially per FicHub guidance."""
    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    user_dir = STORAGE_DIR / user.user_id

    # Determine eligible books (have a known fanfic source URL AND not already marked unavailable)
    eligible: List[tuple] = []
    for b in books:
        if b.get("fichub_unavailable"):
            continue
        src = b.get("source_url")
        if not src:
            epub_path = user_dir / f"{b['book_id']}.epub"
            if epub_path.exists():
                src = find_source_url(extract_urls_from_epub(epub_path))
        if src:
            eligible.append((b, src))

    refreshed = 0
    failures: List[Dict[str, str]] = []
    marked_unavailable = 0
    for b, src in eligible:
        try:
            await apply_refresh(b, user.user_id, src)
            refreshed += 1
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {"fichub_unavailable": False, "fichub_last_error": None}},
            )
        except FicHubNotFoundError as e:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {
                    "fichub_unavailable": True,
                    "fichub_last_error": str(e),
                    "fichub_last_attempt_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            marked_unavailable += 1
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        except HTTPException as he:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": he.detail})
        except Exception as e:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        await asyncio.sleep(1.5)

    return {
        "eligible": len(eligible),
        "refreshed": refreshed,
        "marked_unavailable": marked_unavailable,
        "failures": failures,
    }


class MarkBody(BaseModel):
    read: bool


@api_router.post("/books/{book_id}/mark")
async def mark_book(book_id: str, body: MarkBody, user: User = Depends(get_current_user)):
    """Mark a book as fully read or unread (sets progress to 100% / 0%)."""
    update: Dict[str, Any] = {
        "progress_percent": 1.0 if body.read else 0.0,
    }
    if body.read:
        update["last_opened_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "read": body.read}


async def _log_activity(user_id: str, book_id: str):
    """Append today's reading activity for streak calculations."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.reading_activity.update_one(
        {"user_id": user_id, "date": today},
        {
            "$addToSet": {"book_ids": book_id},
            "$set": {"last_ts": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
    )


class ProgressBody(BaseModel):
    percent: float
    cfi: Optional[str] = None


@api_router.post("/books/{book_id}/progress")
async def update_progress(book_id: str, body: ProgressBody, user: User = Depends(get_current_user)):
    """Persist reading progress (0.0-1.0) and last CFI for this book."""
    pct = max(0.0, min(1.0, float(body.percent)))
    update: Dict[str, Any] = {
        "progress_percent": pct,
        "last_opened_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.cfi:
        update["progress_cfi"] = body.cfi
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True, "percent": pct}


@api_router.post("/books/{book_id}/touch")
async def touch_book(book_id: str, user: User = Depends(get_current_user)):
    """Mark the book as opened just now (used for the Continue Reading rail)."""
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"last_opened_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True}


@api_router.post("/books/{book_id}/refresh")
async def refresh_book(book_id: str, user: User = Depends(get_current_user)):
    """Re-download the latest version of this book from its FicHub-supported source."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    user_dir = STORAGE_DIR / user.user_id
    epub_path = user_dir / f"{book_id}.epub"
    if not epub_path.exists():
        raise HTTPException(status_code=404, detail="File missing")

    source_url = book.get("source_url")
    if not source_url:
        source_url = find_source_url(extract_urls_from_epub(epub_path))
    if not source_url:
        raise HTTPException(
            status_code=400,
            detail="No supported fanfic URL found inside this EPUB (need AO3, FFnet, Royal Road, etc.)",
        )

    try:
        updated = await apply_refresh(book, user.user_id, source_url)
    except FicHubNotFoundError as e:
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$set": {
                "fichub_unavailable": True,
                "fichub_last_error": str(e),
                "fichub_last_attempt_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=404, detail=str(e))
    # Clear unavailable flag on success
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"fichub_unavailable": False, "fichub_last_error": None}},
    )
    return {
        "ok": True,
        "source_url": source_url,
        "title": updated["title"],
        "last_refreshed_at": updated["last_refreshed_at"],
        "fichub_meta": updated.get("fichub_meta"),
    }


class BulkIdsBody(BaseModel):
    book_ids: List[str]


class BulkMoveBody(BaseModel):
    book_ids: List[str]
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/bulk/delete")
async def bulk_delete(body: BulkIdsBody, user: User = Depends(get_current_user)):
    if not body.book_ids:
        return {"deleted": 0}
    user_dir = STORAGE_DIR / user.user_id
    for bid in body.book_ids:
        for ext in ['.epub', '.cover', '.links.txt']:
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                p.unlink()
    result = await db.books.delete_many(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id}
    )
    return {"deleted": result.deleted_count}


@api_router.post("/books/bulk/move")
async def bulk_move(body: BulkMoveBody, user: User = Depends(get_current_user)):
    if not body.book_ids:
        return {"updated": 0}
    update: Dict[str, Any] = {"classifier": "manual", "confidence": 1.0}
    if body.category is not None:
        update["category"] = body.category
    if body.fandom is not None:
        update["fandom"] = body.fandom if body.fandom else None
    if len(update) == 2:  # only classifier+confidence — nothing to move to
        raise HTTPException(status_code=400, detail="No category or fandom provided")
    result = await db.books.update_many(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
        {"$set": update},
    )
    return {"updated": result.modified_count}


class BulkMetadataBody(BaseModel):
    book_ids: List[str]
    author: Optional[str] = None      # if provided & non-empty, sets author on all
    fandom: Optional[str] = None      # "" => clear fandom (None); None => leave as-is
    category: Optional[str] = None    # category to set on all
    series_name: Optional[str] = None # "" => clear series; None => leave as-is
    series_start_index: Optional[float] = None  # if set, assigns series_index sequentially starting at this value
    title_prefix_strip: Optional[str] = None    # if provided & non-empty, strips this prefix from each book's title


@api_router.post("/books/bulk/metadata")
async def bulk_metadata(body: BulkMetadataBody, user: User = Depends(get_current_user)):
    """Edit metadata across many books at once.

    Use cases: fix a misspelled author across a series, drop everything into a
    new fandom shelf, group books into a series and number them in upload order,
    or strip a common prefix from titles (e.g. "[OLD] ").
    """
    if not body.book_ids:
        return {"updated": 0}

    # Fields that apply identically to every selected book
    set_common: Dict[str, Any] = {}
    unset_common: Dict[str, Any] = {}
    if body.author and body.author.strip():
        set_common["author"] = body.author.strip()
    if body.category is not None:
        set_common["category"] = body.category
        set_common["classifier"] = "manual"
        set_common["confidence"] = 1.0
    if body.fandom is not None:
        if body.fandom.strip():
            set_common["fandom"] = body.fandom.strip()
        else:
            unset_common["fandom"] = ""
    if body.series_name is not None and body.series_start_index is None:
        if body.series_name.strip():
            set_common["series_name"] = body.series_name.strip()
        else:
            unset_common["series_name"] = ""
            unset_common["series_index"] = ""

    updated = 0

    if set_common or unset_common:
        ops: Dict[str, Any] = {}
        if set_common:
            ops["$set"] = set_common
        if unset_common:
            ops["$unset"] = unset_common
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            ops,
        )
        updated = max(updated, result.modified_count)

    # Series numbering: assign sequentially in the order book_ids was provided
    if body.series_name is not None and body.series_start_index is not None and body.series_name.strip():
        idx = float(body.series_start_index)
        for bid in body.book_ids:
            await db.books.update_one(
                {"book_id": bid, "user_id": user.user_id},
                {"$set": {"series_name": body.series_name.strip(), "series_index": idx}},
            )
            idx += 1
        updated = max(updated, len(body.book_ids))

    # Title prefix strip (per-book, since each title is different)
    if body.title_prefix_strip and body.title_prefix_strip.strip():
        prefix = body.title_prefix_strip
        books = await db.books.find(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"_id": 0, "book_id": 1, "title": 1},
        ).to_list(5000)
        for b in books:
            t = b.get("title") or ""
            if t.startswith(prefix):
                new_t = t[len(prefix):].lstrip()
                if new_t and new_t != t:
                    await db.books.update_one(
                        {"book_id": b["book_id"], "user_id": user.user_id},
                        {"$set": {"title": new_t}},
                    )
                    updated += 1

    return {"updated": updated}


# ============================================================
# AUTHOR ROUTES
# ============================================================
@api_router.get("/authors")
async def list_authors(user: User = Depends(get_current_user)):
    """Distinct authors in the user's library with book counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "author": {"$ne": None, "$exists": True}}},
        {"$group": {"_id": "$author", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    authors = [
        {"name": r["_id"], "count": r["count"]}
        for r in rows
        if r.get("_id") and r["_id"].strip() and r["_id"].strip().lower() != "unknown"
    ]
    return {"authors": authors}


@api_router.get("/authors/{name}")
async def get_author(name: str, user: User = Depends(get_current_user)):
    """All books by this author, newest first."""
    books = await db.books.find(
        {"user_id": user.user_id, "author": name},
        {"_id": 0},
    ).sort("created_at", -1).to_list(2000)
    return {"name": name, "books": books}


@api_router.patch("/books/{book_id}")
async def update_book(book_id: str, body: UpdateBookBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    update: Dict[str, Any] = {"classifier": "manual", "confidence": 1.0}
    if body.category is not None:
        update['category'] = body.category
    if body.fandom is not None:
        update['fandom'] = body.fandom if body.fandom else None
    await db.books.update_one({"book_id": book_id, "user_id": user.user_id}, {"$set": update})
    return {"ok": True}


def _safe_folder(name: str) -> str:
    name = re.sub(r'[^\w\s-]', '', name or 'Uncategorized').strip()
    name = re.sub(r'\s+', '_', name)
    return name or 'Uncategorized'


@api_router.get("/books/export/zip")
async def export_zip(
    request: Request,
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = category
    if fandom:
        query["fandom"] = fandom
    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    def iter_zip():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for b in books:
                fp = STORAGE_DIR / user.user_id / f"{b['book_id']}.epub"
                if not fp.exists():
                    continue
                cat = _safe_folder(b.get('category') or 'Uncategorized')
                fnd = b.get('fandom')
                if cat == 'Fanfiction' and fnd:
                    folder = f"Fanfiction/{_safe_folder(fnd)}"
                else:
                    folder = cat
                arcname = f"{folder}/{b['filename']}"
                zf.write(str(fp), arcname=arcname)
        buf.seek(0)
        return buf

    buf = iter_zip()
    zip_name = "shelfsort_library.zip"
    if fandom:
        zip_name = f"shelfsort_{_safe_folder(fandom)}.zip"
    elif category:
        zip_name = f"shelfsort_{_safe_folder(category)}.zip"
    headers = {"Content-Disposition": f"attachment; filename={zip_name}"}
    return StreamingResponse(buf, media_type="application/zip", headers=headers)


# ============================================================
# CATEGORIES (custom)
# ============================================================
class CategoryBody(BaseModel):
    name: str


@api_router.get("/stats/overview")
async def stats_overview(user: User = Depends(get_current_user)):
    """Aggregate reading stats for the dashboard / stats card."""
    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    finished = sum(1 for b in books if (b.get("progress_percent") or 0) >= 0.99)
    reading = sum(1 for b in books if 0.05 <= (b.get("progress_percent") or 0) < 0.95)

    # Estimate pages: word counts when known, else size_bytes / 2500
    WORDS_PER_PAGE = 250
    BYTES_PER_PAGE = 2500
    pages_read = 0.0
    pages_total = 0.0
    for b in books:
        words = None
        if isinstance(b.get("fichub_meta"), dict):
            words = b["fichub_meta"].get("words")
        if isinstance(words, (int, float)) and words > 0:
            pages = float(words) / WORDS_PER_PAGE
        else:
            pages = max(1.0, float(b.get("size_bytes") or 0) / BYTES_PER_PAGE)
        pages_total += pages
        pages_read += pages * float(b.get("progress_percent") or 0)

    # Streak from reading_activity collection (one doc per active day)
    activity = await db.reading_activity.find(
        {"user_id": user.user_id}, {"_id": 0, "date": 1}
    ).to_list(2000)
    from datetime import date as _date, timedelta as _td
    active_dates = set()
    for a in activity:
        try:
            y, m, d = a["date"].split("-")
            active_dates.add(_date(int(y), int(m), int(d)))
        except Exception:
            continue
    today = datetime.now(timezone.utc).date()
    streak = 0
    if today in active_dates:
        cur = today
    elif (today - _td(days=1)) in active_dates:
        cur = today - _td(days=1)
    else:
        cur = None
    while cur and cur in active_dates:
        streak += 1
        cur = cur - _td(days=1)

    return {
        "books_total": len(books),
        "books_finished": finished,
        "books_reading": reading,
        "pages_read": int(pages_read),
        "pages_total": int(pages_total),
        "reading_streak_days": streak,
        "active_days_count": len(active_dates),
    }


@api_router.get("/stats/detailed")
async def stats_detailed(user: User = Depends(get_current_user)):
    """Deeper breakdown for the dedicated stats page:
       - daily activity (last 30 days), book count per day
       - top fandoms, top authors
       - books finished per month (last 12)
       - category breakdown
    """
    from datetime import date as _date, timedelta as _td

    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    today = datetime.now(timezone.utc).date()

    # ---- Daily activity: last 30 days ----
    cutoff = today - _td(days=29)
    activity = await db.reading_activity.find(
        {"user_id": user.user_id, "date": {"$gte": cutoff.isoformat()}},
        {"_id": 0, "date": 1, "book_ids": 1},
    ).to_list(2000)
    by_date: Dict[str, int] = {}
    for a in activity:
        # number of distinct book_ids opened that day
        by_date[a["date"]] = len(set(a.get("book_ids") or []))
    daily: List[Dict[str, Any]] = []
    for i in range(30):
        d = cutoff + _td(days=i)
        key = d.isoformat()
        daily.append({"date": key, "label": d.strftime("%b %d"), "books_opened": by_date.get(key, 0)})

    # ---- Top fandoms ----
    fandom_counts: Dict[str, int] = {}
    for b in books:
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
    top_fandoms = sorted(
        [{"name": k, "count": v} for k, v in fandom_counts.items()],
        key=lambda x: (-x["count"], x["name"]),
    )[:8]

    # ---- Top authors (exclude "Unknown") ----
    author_counts: Dict[str, int] = {}
    for b in books:
        a = (b.get("author") or "").strip()
        if a and a.lower() != "unknown":
            author_counts[a] = author_counts.get(a, 0) + 1
    top_authors = sorted(
        [{"name": k, "count": v} for k, v in author_counts.items()],
        key=lambda x: (-x["count"], x["name"]),
    )[:8]

    # ---- Books finished per month (last 12 months) ----
    finished_by_month: Dict[str, int] = {}
    for b in books:
        if (b.get("progress_percent") or 0) < 0.99:
            continue
        ts = b.get("last_opened_at") or b.get("created_at")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) if isinstance(ts, str) else ts
        except ValueError:
            continue
        key = dt.strftime("%Y-%m")
        finished_by_month[key] = finished_by_month.get(key, 0) + 1
    # Walk back 12 months
    monthly: List[Dict[str, Any]] = []
    yy, mm = today.year, today.month
    backlog: List[tuple] = []
    for _ in range(12):
        backlog.append((yy, mm))
        mm -= 1
        if mm == 0:
            mm = 12
            yy -= 1
    for (yy_, mm_) in reversed(backlog):
        key = f"{yy_:04d}-{mm_:02d}"
        label = _date(yy_, mm_, 1).strftime("%b %Y")
        monthly.append({"month": key, "label": label, "finished": finished_by_month.get(key, 0)})

    # ---- Category breakdown ----
    cat_counts: Dict[str, int] = {}
    for b in books:
        c = b.get("category") or "Unclassified"
        cat_counts[c] = cat_counts.get(c, 0) + 1
    categories = sorted(
        [{"name": k, "count": v} for k, v in cat_counts.items()],
        key=lambda x: -x["count"],
    )

    return {
        "daily": daily,
        "top_fandoms": top_fandoms,
        "top_authors": top_authors,
        "monthly_finished": monthly,
        "categories": categories,
        "books_total": len(books),
    }


@api_router.get("/series")
async def list_series(user: User = Depends(get_current_user)):
    """Return distinct series for the current user with book counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "series_name": {"$ne": None, "$exists": True}}},
        {"$group": {
            "_id": "$series_name",
            "count": {"$sum": 1},
            "max_index": {"$max": "$series_index"},
        }},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(500)
    return {
        "series": [
            {"name": r["_id"], "count": r["count"], "max_index": r.get("max_index")}
            for r in rows
        ]
    }


@api_router.get("/series/{name}")
async def get_series(name: str, user: User = Depends(get_current_user)):
    """All books in a series, ordered by series_index (nulls last)."""
    books = await db.books.find(
        {"user_id": user.user_id, "series_name": name},
        {"_id": 0},
    ).to_list(500)
    # Sort by series_index ascending, with None placed at the end
    books.sort(key=lambda b: (b.get("series_index") is None, b.get("series_index") or 0))
    return {"name": name, "books": books}


@api_router.post("/books/detect-series-all")
async def detect_series_all(user: User = Depends(get_current_user)):
    """Re-scan every book without a series_name and try to detect one from the title."""
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "series_name": 1},
    ).to_list(5000)
    user_dir = STORAGE_DIR / user.user_id
    found = 0
    for b in books:
        if b.get("series_name"):
            continue
        # Try filesystem EPUB metadata first
        sn = None
        si = None
        fp = user_dir / f"{b['book_id']}.epub"
        if fp.exists():
            try:
                m = extract_epub_metadata(fp)
                sn = m.get("series_name")
                si = m.get("series_index")
            except Exception:
                pass
        if not sn:
            sn, si = detect_series_from_title(b.get("title") or "")
        if sn:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {"series_name": sn, "series_index": si}},
            )
            found += 1
    return {"scanned": len(books), "found": found}


class SetSourceBody(BaseModel):
    source_url: str


@api_router.patch("/books/{book_id}/source-url")
async def set_source_url(book_id: str, body: SetSourceBody, user: User = Depends(get_current_user)):
    """Manually correct the fanfic source URL (e.g., when FicHub couldn't find it).
    Clears the unavailable flag so the next refresh will try the new URL."""
    new_url = (body.source_url or "").strip()
    if not new_url:
        raise HTTPException(status_code=400, detail="Source URL is empty")
    if not re.match(r"^https?://", new_url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Please paste a full http(s):// URL")
    # Validate it's a supported fanfic source
    matched = None
    for pat in FICHUB_SOURCE_PATTERNS:
        m = re.search(pat, new_url, re.IGNORECASE)
        if m:
            matched = m.group(0)
            break
    if not matched:
        raise HTTPException(
            status_code=400,
            detail="That URL isn't a supported fanfic source (AO3, FFnet, Royal Road, SpaceBattles, SufficientVelocity, FictionPress).",
        )
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "source_url": matched,
            "fichub_unavailable": False,
            "fichub_last_error": None,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "source_url": matched}


class SetSeriesBody(BaseModel):
    series_name: Optional[str] = None
    series_index: Optional[float] = None


@api_router.patch("/books/{book_id}/series")
async def set_series(book_id: str, body: SetSeriesBody, user: User = Depends(get_current_user)):
    update: Dict[str, Any] = {
        "series_name": (body.series_name.strip() if body.series_name else None),
        "series_index": body.series_index,
    }
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.get("/categories")
async def list_categories(user: User = Depends(get_current_user)):
    docs = await db.categories.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    base = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified"]
    customs = [d['name'] for d in docs]
    return {"defaults": base, "custom": customs}


@api_router.post("/categories")
async def add_category(body: CategoryBody, user: User = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Empty name")
    existing = await db.categories.find_one({"user_id": user.user_id, "name": name}, {"_id": 0})
    if existing:
        return {"ok": True}
    await db.categories.insert_one({
        "user_id": user.user_id, "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api_router.delete("/categories/{name}")
async def remove_category(name: str, user: User = Depends(get_current_user)):
    await db.categories.delete_one({"user_id": user.user_id, "name": name})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"app": "Shelfsort", "ok": True}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# WEEKLY READING DIGEST (Resend + APScheduler)
# ============================================================
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: E402

DEFAULT_DIGEST = {
    "enabled": False,
    "day_of_week": 6,   # 0=Mon ... 6=Sun (Python weekday convention)
    "hour": 8,          # 0..23, UTC
    "last_sent_at": None,
}
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class DigestSettingsBody(BaseModel):
    enabled: Optional[bool] = None
    day_of_week: Optional[int] = None  # 0..6
    hour: Optional[int] = None         # 0..23


def _get_digest_prefs(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(DEFAULT_DIGEST)
    d.update(user_doc.get("digest") or {})
    return d


async def _build_digest_payload(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return {subject, html, text, summary} for the user's last-7-days reading."""
    uid = user_doc["user_id"]
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]

    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=6)
    iso_from = week_start.isoformat()
    iso_to = today.isoformat()

    # Reading activity (last 7 days)
    activity = await db.reading_activity.find(
        {"user_id": uid, "date": {"$gte": iso_from, "$lte": iso_to}},
        {"_id": 0, "date": 1, "book_ids": 1},
    ).to_list(100)

    opened_book_ids: set = set()
    active_days = 0
    for a in activity:
        bids = a.get("book_ids") or []
        if bids:
            active_days += 1
            for b in bids:
                opened_book_ids.add(b)

    # Fetch books opened this week and overall library
    books_this_week = await db.books.find(
        {"user_id": uid, "book_id": {"$in": list(opened_book_ids)}},
        {"_id": 0},
    ).to_list(200) if opened_book_ids else []

    all_books = await db.books.find({"user_id": uid}, {"_id": 0}).to_list(5000)

    # Stats for this week
    finished_this_week = 0
    pages_this_week = 0
    fandom_counts: Dict[str, int] = {}
    for b in books_this_week:
        # finished this week heuristic: progress_percent >= 0.99 AND last_opened within window
        last_open = b.get("last_opened_at")
        try:
            lo_dt = datetime.fromisoformat(last_open.replace("Z", "+00:00")) if isinstance(last_open, str) else last_open
        except (ValueError, AttributeError):
            lo_dt = None
        if (b.get("progress_percent") or 0) >= 0.99 and lo_dt and lo_dt.date() >= week_start:
            finished_this_week += 1
        # Pages this week: approximate as (current_progress - 0) * total_pages distributed across active days
        # We don't have per-day progress deltas, so use a simpler heuristic:
        # estimate pages opened this week as len(text or chapters) * progress_percent for newly opened
        total = b.get("words") or 0
        pages = max(1, total // 250) if total else 0
        pct = float(b.get("progress_percent") or 0)
        pages_this_week += int(pages * pct)
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1

    top_fandom = sorted(fandom_counts.items(), key=lambda x: -x[1])[0][0] if fandom_counts else None

    # Books in progress >50% but not opened in the last 3 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=3)
    nudges: List[Dict[str, Any]] = []
    for b in all_books:
        pct = float(b.get("progress_percent") or 0)
        if 0.5 <= pct < 0.99:
            last_open = b.get("last_opened_at")
            try:
                lo_dt = datetime.fromisoformat(last_open.replace("Z", "+00:00")) if isinstance(last_open, str) else last_open
            except (ValueError, AttributeError):
                lo_dt = None
            if not lo_dt or lo_dt < cutoff:
                nudges.append({"title": b.get("title") or "Untitled",
                               "author": b.get("author") or "",
                               "progress": int(pct * 100),
                               "book_id": b["book_id"]})
    # Top 3 nudges by progress (closest to done first)
    nudges = sorted(nudges, key=lambda x: -x["progress"])[:3]

    # Build URLs
    base = FRONTEND_URL or os.environ.get("REACT_APP_BACKEND_URL", "")
    library_url = f"{base}/library" if base else "/library"
    stats_url = f"{base}/library/stats" if base else "/library/stats"

    # Summary line + subject
    if opened_book_ids:
        subject = f"Shelfsort weekly: {len(opened_book_ids)} book{'s' if len(opened_book_ids) != 1 else ''}, {active_days}/7 active days"
    else:
        subject = "Shelfsort weekly: a quiet reading week"
    summary = {
        "books_opened": len(opened_book_ids),
        "active_days": active_days,
        "finished_this_week": finished_this_week,
        "pages_this_week": pages_this_week,
        "top_fandom": top_fandom,
        "nudges": nudges,
        "library_total": len(all_books),
        "week_start": iso_from,
        "week_end": iso_to,
    }

    nudge_rows_html = ""
    for n in nudges:
        nudge_rows_html += (
            f'<tr><td style="padding:10px 0;border-top:1px solid #E8E6E1;">'
            f'<p style="margin:0;font-size:14px;color:#2C2C2C;font-weight:600;">{n["title"]}</p>'
            f'<p style="margin:2px 0 0 0;font-size:12px;color:#6B705C;">{n["author"]} · {n["progress"]}% done</p>'
            f'</td></tr>'
        )

    nudges_block_html = ""
    if nudges:
        nudges_block_html = (
            '<div style="margin-top:32px;background:#FDF3E1;padding:20px;border-radius:12px;">'
            '<p style="margin:0 0 8px 0;font-size:11px;letter-spacing:2px;color:#B87A00;font-weight:bold;text-transform:uppercase;">Don\'t forget…</p>'
            '<p style="margin:0 0 12px 0;font-size:14px;color:#2C2C2C;">Books you started but haven\'t finished:</p>'
            '<table width="100%" cellpadding="0" cellspacing="0">' + nudge_rows_html + '</table>'
            '</div>'
        )

    quiet_block_html = ""
    if not opened_book_ids:
        quiet_block_html = (
            '<div style="margin:24px 0;padding:20px;background:#F5F3EC;border-radius:12px;text-align:center;">'
            f'<p style="margin:0 0 8px 0;font-size:15px;color:#2C2C2C;">A quiet week — that\'s okay.</p>'
            f'<p style="margin:0;font-size:13px;color:#6B705C;">Your library has {len(all_books)} book{"s" if len(all_books) != 1 else ""} waiting.</p>'
            '</div>'
        )

    top_fandom_html = (
        f'<p style="margin:8px 0 0 0;font-size:14px;color:#6B705C;">'
        f'Most-opened fandom: <strong style="color:#E07A5F;">{top_fandom}</strong></p>'
        if top_fandom else ""
    )

    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 0;font-family:Georgia,serif;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#3A5A40;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Shelfsort · weekly digest</p>
            <h1 style="margin:0 0 8px 0;color:#2C2C2C;font-size:30px;line-height:1.15;">Hi {name},</h1>
            <p style="margin:0 0 24px 0;color:#6B705C;font-size:15px;line-height:1.6;">
              Here's how your reading week ({week_start.strftime('%b %d')} – {today.strftime('%b %d')}) went.
            </p>
            {quiet_block_html}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 8px 0;font-family:Helvetica,Arial,sans-serif;">
              <tr>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#E07A5F;font-family:Georgia,serif;line-height:1;">{len(opened_book_ids)}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Books opened</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#3A5A40;font-family:Georgia,serif;line-height:1;">{active_days}<span style="font-size:18px;color:#6B705C;">/7</span></p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Active days</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#B87A00;font-family:Georgia,serif;line-height:1;">{finished_this_week}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Finished</p>
                </td>
              </tr>
            </table>
            {top_fandom_html}
            {nudges_block_html}
            <p style="margin:32px 0 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              <a href="{library_url}" style="display:inline-block;background:#E07A5F;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;font-size:14px;">Open your library</a>
              <a href="{stats_url}" style="display:inline-block;margin-left:8px;background:#FFFFFF;color:#3A5A40;text-decoration:none;padding:13px 22px;border:1px solid #3A5A40;border-radius:10px;font-weight:600;font-size:14px;">See full stats</a>
            </p>
            <p style="margin:28px 0 0 0;color:#6B705C;font-size:11px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              You're receiving this because you turned on the weekly digest in Shelfsort.
              Change your settings any time in <a href="{base}/account" style="color:#3A5A40;">your account</a>.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

    text_lines = [
        f"Hi {name},",
        "",
        f"Your Shelfsort week ({week_start.strftime('%b %d')} – {today.strftime('%b %d')}):",
        f"  - Books opened: {len(opened_book_ids)}",
        f"  - Active days: {active_days}/7",
        f"  - Finished: {finished_this_week}",
    ]
    if top_fandom:
        text_lines.append(f"  - Most-opened fandom: {top_fandom}")
    if nudges:
        text_lines.append("")
        text_lines.append("Books you started but haven't finished:")
        for n in nudges:
            text_lines.append(f"  - {n['title']} by {n['author']} ({n['progress']}% done)")
    text_lines.append("")
    text_lines.append(f"Open your library: {library_url}")
    text_lines.append(f"Full stats: {stats_url}")
    text_lines.append("")
    text_lines.append("— Shelfsort")
    text = "\n".join(text_lines)

    return {"subject": subject, "html": html, "text": text, "summary": summary}


async def _send_digest_email(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    payload = await _build_digest_payload(user_doc)
    to_email = user_doc["email"]
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent digest to %s", to_email)
        return {"delivered": False, "logged": True, "summary": payload["summary"]}
    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": payload["subject"],
            "html": payload["html"],
            "text": payload["text"],
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        return {"delivered": True, "id": result.get("id"), "summary": payload["summary"]}
    except Exception as e:
        logger.error("Digest Resend send failed for %s: %s", to_email, e)
        return {"delivered": False, "error": str(e), "summary": payload["summary"]}


# ---- Settings endpoints ----
@api_router.get("/user/digest-settings")
async def get_digest_settings(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_digest_prefs(user_doc)
    last_sent = prefs.get("last_sent_at")
    return {
        "enabled": bool(prefs.get("enabled")),
        "day_of_week": int(prefs.get("day_of_week", 6)),
        "hour": int(prefs.get("hour", 8)),
        "last_sent_at": last_sent.isoformat() if isinstance(last_sent, datetime) else last_sent,
        "email_configured": bool(RESEND_API_KEY),
    }


@api_router.put("/user/digest-settings")
async def update_digest_settings(body: DigestSettingsBody, user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_digest_prefs(user_doc)
    if body.enabled is not None:
        prefs["enabled"] = bool(body.enabled)
    if body.day_of_week is not None:
        if not (0 <= int(body.day_of_week) <= 6):
            raise HTTPException(status_code=400, detail="day_of_week must be between 0 (Monday) and 6 (Sunday)")
        prefs["day_of_week"] = int(body.day_of_week)
    if body.hour is not None:
        if not (0 <= int(body.hour) <= 23):
            raise HTTPException(status_code=400, detail="hour must be between 0 and 23")
        prefs["hour"] = int(body.hour)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"digest": prefs}},
    )
    return {
        "enabled": prefs["enabled"],
        "day_of_week": prefs["day_of_week"],
        "hour": prefs["hour"],
    }


@api_router.post("/user/digest-preview")
async def send_digest_preview(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    result = await _send_digest_email(user_doc)
    return result


# ---- Scheduler tick ----
_scheduler: Optional[AsyncIOScheduler] = None


async def _digest_tick():
    """Runs every hour at minute 0. Find users due for a digest and send."""
    now = datetime.now(timezone.utc)
    weekday = now.weekday()
    hour = now.hour
    # Find users with matching schedule
    cursor = db.users.find({
        "digest.enabled": True,
        "digest.day_of_week": weekday,
        "digest.hour": hour,
    })
    cooldown = now - timedelta(days=6)  # avoid double-sending within the same week
    sent = 0
    async for user_doc in cursor:
        prefs = _get_digest_prefs(user_doc)
        last_sent = prefs.get("last_sent_at")
        try:
            ls_dt = datetime.fromisoformat(last_sent.replace("Z", "+00:00")) if isinstance(last_sent, str) else last_sent
        except (ValueError, AttributeError):
            ls_dt = None
        if ls_dt and ls_dt > cooldown:
            continue
        try:
            await _send_digest_email(user_doc)
            prefs["last_sent_at"] = now.isoformat()
            await db.users.update_one(
                {"user_id": user_doc["user_id"]},
                {"$set": {"digest": prefs}},
            )
            sent += 1
        except Exception as e:
            logger.error("Digest send failed for %s: %s", user_doc.get("email"), e)
    if sent:
        logger.info("Weekly digest tick: sent %d emails (weekday=%d, hour=%d)", sent, weekday, hour)


def start_digest_scheduler():
    global _scheduler
    if _scheduler:
        return
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(_digest_tick, "cron", minute=0, id="weekly_digest_tick", replace_existing=True)
    sched.start()
    _scheduler = sched
    logger.info("Weekly digest scheduler started (UTC, every hour at :00).")


app.include_router(api_router)


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.login_attempts.create_index("identifier")
        await db.login_attempts.create_index("ts")
        await db.password_reset_tokens.create_index("token", unique=True)
        await db.password_reset_tokens.create_index("user_id")
    except Exception as e:
        logger.warning(f"Index setup: {e}")
    # Start the weekly digest scheduler
    try:
        start_digest_scheduler()
    except Exception as e:
        logger.warning(f"Digest scheduler failed to start: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
