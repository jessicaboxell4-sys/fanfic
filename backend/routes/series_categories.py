from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
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
)
from models import User, BookOut
from auth_dep import get_current_user

class CategoryBody(BaseModel):
    name: str


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






@api_router.get("/categories")
async def list_categories(user: User = Depends(get_current_user)):
    docs = await db.categories.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    base = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified", "Updated stories", "Old stories"]
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

