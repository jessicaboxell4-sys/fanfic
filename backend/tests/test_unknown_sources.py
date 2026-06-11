"""Pure-unit tests for `utils.unknown_sources` heuristic + recorder.

These mock Mongo via a tiny dict-backed stub so they run in
milliseconds. End-to-end coverage (upload + paste flows actually
writing to Mongo) lives in `test_new_features.py`.
"""

import asyncio

import pytest

from utils.unknown_sources import (
    _host_of,
    looks_like_fanfic_url,
    record_unknown_sources,
)


class TestHostOf:
    @pytest.mark.parametrize("url,expected", [
        ("https://www.scribblehub.com/series/12345/", "scribblehub.com"),
        ("https://m.scribblehub.com/series/12345/", "scribblehub.com"),
        ("https://mobile.scribblehub.com/series/12345/", "scribblehub.com"),
        ("https://archiveofourown.org/works/1", "archiveofourown.org"),
        # Edge cases
        ("", None),
        (None, None),
        ("not-a-url", None),
    ])
    def test_strips_subdomain_noise(self, url, expected):
        assert _host_of(url or "") == expected


class TestLooksLikeFanficUrl:
    @pytest.mark.parametrize("url", [
        # eFiction story URLs
        "https://newarchive.com/story.php?no=42",
        "https://newarchive.com/viewstory.php?sid=42",
        "https://efiction-mirror.org/story/12345",
        # Forum thread on a new xenforo host
        "https://forums.newfic.com/threads/some-slug.99999/",
        # RoyalRoad-style numeric
        "https://different-rr.com/fiction/12345",
        # AO3-like permalink on a mirror not in our list
        "https://newmirror.org/works/87654",
        # Chapter URL
        "https://novelhost.com/chapter/42",
        # /s/N FFnet-clone
        "https://ffnet-clone.com/s/9999",
    ])
    def test_positive(self, url):
        assert looks_like_fanfic_url(url) is True, f"should flag {url}"

    @pytest.mark.parametrize("url", [
        # Generic social / search / public sites — denylist
        "https://twitter.com/some_user/status/123",
        "https://www.youtube.com/watch?v=abc",
        "https://en.wikipedia.org/wiki/Fanfic",
        "https://www.reddit.com/r/fanfic/",
        "https://www.amazon.com/dp/B000123/",
        "https://archive.org/details/something",
        # Random blog footnote
        "https://example.com/blog/post-title",
        # Just a homepage, no story path
        "https://newarchive.com/",
        "https://newarchive.com/browse",
        # Empty / malformed
        "",
        "not-a-url",
    ])
    def test_negative(self, url):
        assert looks_like_fanfic_url(url) is False, f"should NOT flag {url}"


# ---------------------------------------------------------------------------
# In-memory Mongo stub — supports just the methods record_unknown_sources
# uses (update_one with upsert). Validates the document shape end-to-end.
# ---------------------------------------------------------------------------
class _StubCollection:
    def __init__(self):
        self.docs = {}  # host → doc

    async def update_one(self, filt, update, upsert=False):
        host = filt["host"]
        doc = self.docs.get(host)
        if doc is None:
            if not upsert:
                return type("R", (), {"matched_count": 0})()
            doc = {}
            # Apply $setOnInsert
            doc.update(update.get("$setOnInsert", {}))
            self.docs[host] = doc
        # Apply $set
        doc.update(update.get("$set", {}))
        # Apply $inc
        for k, v in update.get("$inc", {}).items():
            cur = doc
            parts = k.split(".")
            for p in parts[:-1]:
                cur = cur.setdefault(p, {})
            cur[parts[-1]] = cur.get(parts[-1], 0) + v
        # Apply $push with $each / $slice
        for k, payload in update.get("$push", {}).items():
            arr = doc.setdefault(k, [])
            if isinstance(payload, dict) and "$each" in payload:
                arr.extend(payload["$each"])
                if "$slice" in payload:
                    arr[:] = arr[payload["$slice"]:]
            else:
                arr.append(payload)
        return type("R", (), {"matched_count": 1})()


class _StubDB:
    def __init__(self):
        self.unknown_sources = _StubCollection()


class TestRecordUnknownSources:
    def _run(self, *args, **kwargs):
        return asyncio.get_event_loop().run_until_complete(
            record_unknown_sources(*args, **kwargs)
        )

    def test_skips_already_accepted(self):
        db = _StubDB()
        # AO3, FFnet, RoyalRoad — all on the accepted list.
        hosts = self._run(db, [
            "https://archiveofourown.org/works/1",
            "https://www.fanfiction.net/s/1",
            "https://www.royalroad.com/fiction/1",
        ], context="paste")
        assert hosts == []
        assert db.unknown_sources.docs == {}

    def test_skips_non_story_urls(self):
        db = _StubDB()
        hosts = self._run(db, [
            "https://example.com/blog/some-post",
            "https://twitter.com/u/status/123",
            "",
        ], context="paste")
        assert hosts == []

    def test_skips_ao3_non_work_pages(self):
        # AO3 series / user pages are routed to their own bucket on the
        # dedupe screen; we don't want to ALSO flag them as unknown.
        db = _StubDB()
        hosts = self._run(db, [
            "https://archiveofourown.org/series/4242",
            "https://archiveofourown.org/users/somebody/works",
        ], context="paste")
        assert hosts == []

    def test_records_new_host_with_metadata(self):
        db = _StubDB()
        url = "https://scribblehub.com/series/12345/some-story"
        hosts = self._run(
            db, [url], context="upload",
            user_id="user_abc",
            book_id="book_1", book_title="My Story", book_author="Anon",
        )
        assert hosts == ["scribblehub.com"]
        doc = db.unknown_sources.docs["scribblehub.com"]
        assert doc["host"] == "scribblehub.com"
        assert doc["hit_count"] == 1
        assert doc["contexts"] == {"upload": 1}
        assert doc["samples"] == [url]
        assert doc["last_user_id"] == "user_abc"
        assert doc["last_book_id"] == "book_1"
        assert doc["last_book_title"] == "My Story"
        assert doc["last_book_author"] == "Anon"
        assert "first_seen" in doc and "last_seen" in doc

    def test_increments_on_second_sighting(self):
        db = _StubDB()
        self._run(db, ["https://scribblehub.com/series/1/x"], context="paste")
        self._run(db, ["https://scribblehub.com/series/2/y"], context="upload")
        self._run(db, ["https://scribblehub.com/series/3/z"], context="claim")
        doc = db.unknown_sources.docs["scribblehub.com"]
        assert doc["hit_count"] == 3
        assert doc["contexts"] == {"paste": 1, "upload": 1, "claim": 1}
        # Samples are capped at 5; we sent 3 so all should be present.
        assert len(doc["samples"]) == 3

    def test_samples_capped_at_five(self):
        db = _StubDB()
        for i in range(8):
            self._run(db, [f"https://scribblehub.com/series/{i}/abc"], context="paste")
        doc = db.unknown_sources.docs["scribblehub.com"]
        assert len(doc["samples"]) == 5
        # Should keep the 5 MOST RECENT — i.e. 3,4,5,6,7
        assert "series/3/abc" in doc["samples"][0]
        assert "series/7/abc" in doc["samples"][-1]

    def test_normalizes_subdomain_variants_to_one_host(self):
        db = _StubDB()
        self._run(db, ["https://www.scribblehub.com/series/1/x"], context="paste")
        self._run(db, ["https://m.scribblehub.com/series/2/y"], context="paste")
        self._run(db, ["https://mobile.scribblehub.com/series/3/z"], context="paste")
        # All three should collapse to the same root host record.
        assert list(db.unknown_sources.docs.keys()) == ["scribblehub.com"]
        assert db.unknown_sources.docs["scribblehub.com"]["hit_count"] == 3

    def test_dedupes_within_single_call(self):
        # If the same host appears multiple times in one batch we record it
        # just once (Mongo write per distinct host).
        db = _StubDB()
        hosts = self._run(db, [
            "https://newhost.com/story/1",
            "https://newhost.com/story/2",
            "https://newhost.com/story/3",
        ], context="paste")
        assert hosts == ["newhost.com"]
        # Even though the function only recorded once, the hit_count is 1.
        # The user's expectation is "this is a new host" — the per-URL count
        # within a single submission isn't the interesting number.
        assert db.unknown_sources.docs["newhost.com"]["hit_count"] == 1

    def test_unknown_context_falls_back_to_paste(self):
        db = _StubDB()
        self._run(db, ["https://newhost.com/story/1"], context="garbage")
        doc = db.unknown_sources.docs["newhost.com"]
        assert doc["contexts"] == {"paste": 1}
