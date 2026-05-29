"""Shared singletons used by all routers.

All `@api_router.X` decorators across the route modules reference the
SAME APIRouter instance defined here, so the existing endpoint code
keeps working unchanged after the refactor.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Request
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pathlib import Path
from datetime import datetime, timezone
import os
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Storage dir
STORAGE_DIR = Path("/app/uploads")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# Env configuration
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
RESET_TOKEN_TTL_HOURS = 1
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")

# Session-cookie security flags. In production these are set so cookies
# only travel over HTTPS and cross-origin (the SPA lives on a separate
# subdomain). For local HTTP integration tests `COOKIE_SECURE=false`
# emits a plain cookie so `requests.Session` will echo it back.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() not in ("0", "false", "no")
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "none" if COOKIE_SECURE else "lax")

# FastAPI singletons
app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("server")
