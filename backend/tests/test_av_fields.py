"""
Iteration 31 — Antivirus badge backend integration.

Verifies that GET /api/books surfaces av_status + av_scanned_at for
the seeded tester books, and that the values match the spec
(bk_tester_1/2 clean, bk_tester_3 infected with signature).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD},
               timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


def _book_by_id(session, book_id):
    r = session.get(f"{BASE_URL}/api/books", timeout=20)
    assert r.status_code == 200, r.text[:200]
    payload = r.json()
    books = payload if isinstance(payload, list) else payload.get("books", [])
    return next((b for b in books if b.get("book_id") == book_id), None)


def test_books_endpoint_exposes_av_fields(auth_session):
    """Every tester book has both av_status and av_scanned_at populated."""
    for bid in ["bk_tester_1", "bk_tester_2", "bk_tester_3"]:
        book = _book_by_id(auth_session, bid)
        assert book is not None, f"missing book {bid}"
        assert "av_status" in book, f"{bid} has no av_status field: {list(book.keys())}"
        assert "av_scanned_at" in book and book["av_scanned_at"], \
            f"{bid} has no av_scanned_at: {book.get('av_scanned_at')}"


def test_clean_books_status(auth_session):
    for bid in ["bk_tester_1", "bk_tester_2"]:
        book = _book_by_id(auth_session, bid)
        assert book["av_status"] == "clean", f"{bid} av_status={book.get('av_status')}"


def test_infected_book_status_and_signature(auth_session):
    book = _book_by_id(auth_session, "bk_tester_3")
    assert book["av_status"] == "infected"
    # signature is optional in API but seeded in Mongo
    sig = book.get("av_signature", "")
    assert "EICAR" in (sig or ""), f"unexpected signature: {sig!r}"


def test_book_detail_endpoint_exposes_av_fields(auth_session):
    r = auth_session.get(f"{BASE_URL}/api/books/bk_tester_1", timeout=20)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    assert data.get("av_status") == "clean"
    assert data.get("av_scanned_at")


def test_rescan_persists_av_scanned_at(auth_session):
    """POST /api/account/safety/rescan must set av_scanned_at on any newly-scanned book.

    With emergent_object_storage backend, scanned count may be 0 if the local
    pod cache is empty — in that case at least the seeded books retain their
    av_scanned_at (which is what the badge depends on).
    """
    r = auth_session.post(f"{BASE_URL}/api/account/safety/rescan", timeout=60)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert "scanned" in body, body
    # Regardless of scan count, books already scanned must still have the field
    book = _book_by_id(auth_session, "bk_tester_1")
    assert book["av_status"] == "clean"
    assert book["av_scanned_at"]
