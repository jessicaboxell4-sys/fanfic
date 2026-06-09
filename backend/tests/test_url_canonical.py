"""Pure-unit tests for `utils.url_canonical`.

These are intentionally I/O-free — no HTTP server, no DB — so they run
in milliseconds and catch regressions in the URL canonicalizer the
instant they're introduced. The integration coverage for the same
helpers (via `routes.books`) lives in `test_new_features.py`.
"""

import pytest

from utils.url_canonical import (
    URL_REGEX,
    _URL_RE,
    _canonical_fanfic_url,
    _clean_url,
    _is_ao3_host,
    _looks_like_url_list,
    _source_for,
    classify_ao3_non_work,
    FANFIC_SOURCE_PATTERNS,
    normalize_fanfic_url,
)


class TestNormalizeFanficUrl:
    @pytest.mark.parametrize("raw,expected", [
        # AO3 canonical
        ("https://archiveofourown.org/works/12345",
         "https://archiveofourown.org/works/12345"),
        # AO3 mobile + adult interstitial query
        ("https://m.archiveofourown.org/works/12345?view_adult=true",
         "https://archiveofourown.org/works/12345"),
        # AO3 chapter
        ("http://archiveofourown.org/works/12345/chapters/67890",
         "https://archiveofourown.org/works/12345"),
        # AO3 mirror — .gay
        ("https://archiveofourown.gay/works/12345",
         "https://archiveofourown.org/works/12345"),
        # AO3 mirror — ao3.org
        ("https://ao3.org/works/12345",
         "https://archiveofourown.org/works/12345"),
        # AO3 mirror — transformative works
        ("https://archive.transformativeworks.org/works/12345",
         "https://archiveofourown.org/works/12345"),
        # AO3 collection prefix
        ("https://archiveofourown.org/collections/SomeColl/works/12345",
         "https://archiveofourown.org/works/12345"),
        # AO3 insecure subdomain
        ("https://insecure.archiveofourown.org/works/12345",
         "https://archiveofourown.org/works/12345"),
        # FFnet — uppercase + trailing slash
        ("https://WWW.fanfiction.net/s/9876/1/Some-Title/",
         "https://www.fanfiction.net/s/9876"),
        # FictionPress
        ("https://www.fictionpress.com/s/4242/",
         "https://www.fictionpress.com/s/4242"),
        # RoyalRoad
        ("https://www.royalroad.com/fiction/12345/some-slug",
         "https://www.royalroad.com/fiction/12345"),
        # SpaceBattles
        ("https://forums.spacebattles.com/threads/My-Thread.111222/",
         "https://forums.spacebattles.com/threads/my-thread.111222"),
        # SufficientVelocity
        ("https://forums.sufficientvelocity.com/threads/Slug.999/",
         "https://forums.sufficientvelocity.com/threads/slug.999"),
        # QQ
        ("https://forum.questionablequesting.com/threads/abc.111/",
         "https://forum.questionablequesting.com/threads/abc.111"),
        # AFF
        ("http://hp.adult-fanfiction.org/story.php?no=12345",
         "https://www.adult-fanfiction.org/story.php?no=12345"),
        # Potions & Snitches (.net mirror)
        ("https://potionsandsnitches.net/fanfiction/viewstory.php?sid=42",
         "https://www.potionsandsnitches.org/fanfiction/viewstory.php?sid=42"),
        # Twilighted
        ("https://twilighted.net/viewstory.php?sid=7",
         "https://www.twilighted.net/viewstory.php?sid=7"),
    ])
    def test_canonicalize(self, raw, expected):
        assert normalize_fanfic_url(raw) == expected

    @pytest.mark.parametrize("raw", [
        None, "", "not a url", "https://example.com/blog",
        "ftp://archiveofourown.org/works/1",  # wrong scheme
        "https://archiveofourown.org/users/me",  # user page, not story
    ])
    def test_rejects_non_fanfic(self, raw):
        assert normalize_fanfic_url(raw) is None

    def test_alias(self):
        url = "https://archiveofourown.org/works/12345/chapters/67890"
        assert _canonical_fanfic_url(url) == normalize_fanfic_url(url)


class TestAO3HostHelpers:
    @pytest.mark.parametrize("url", [
        "https://archiveofourown.org/works/1",
        "https://www.archiveofourown.org/users/me",
        "https://archiveofourown.com/works/1",
        "https://archiveofourown.gay/works/1",
        "https://ao3.org/works/1",
        "https://archive.transformativeworks.org/works/1",
    ])
    def test_is_ao3_host_positive(self, url):
        assert _is_ao3_host(url) is True

    @pytest.mark.parametrize("url", [
        "", "https://fanfiction.net/s/1", "https://example.com",
    ])
    def test_is_ao3_host_negative(self, url):
        assert _is_ao3_host(url) is False

    def test_classify_ao3_series(self):
        assert classify_ao3_non_work("https://archiveofourown.org/series/4242") == "ao3_series"

    def test_classify_ao3_collection(self):
        assert classify_ao3_non_work("https://archiveofourown.org/collections/MyColl") == "ao3_collection"

    def test_classify_ao3_user(self):
        assert classify_ao3_non_work("https://archiveofourown.org/users/some_pseud") == "ao3_user"

    def test_classify_ao3_work_returns_none(self):
        # A work permalink is NOT a non-work — should fall through.
        assert classify_ao3_non_work("https://archiveofourown.org/works/12345") is None

    def test_classify_non_ao3_returns_none(self):
        assert classify_ao3_non_work("https://fanfiction.net/s/1") is None


class TestSourceFor:
    @pytest.mark.parametrize("url,label", [
        ("https://archiveofourown.org/works/1", "AO3"),
        ("https://ao3.org/works/1", "AO3"),
        ("https://archive.transformativeworks.org/works/1", "AO3"),
        ("https://www.fanfiction.net/s/9876", "FFnet"),
        ("https://www.fictionpress.com/s/1", "FictionPress"),
        ("https://forums.spacebattles.com/threads/x.1", "SpaceBattles"),
        ("https://forums.sufficientvelocity.com/threads/x.1", "SufficientVelocity"),
        ("https://forum.questionablequesting.com/threads/x.1", "QQ"),
        ("https://www.royalroad.com/fiction/1", "RoyalRoad"),
        ("https://hp.adult-fanfiction.org/story.php?no=1", "AFF"),
        ("https://potionsandsnitches.org/fanfiction/viewstory.php?sid=1", "Potions & Snitches"),
        ("https://twilighted.net/viewstory.php?sid=1", "Twilighted"),
        ("https://example.com", ""),
        ("", ""),
    ])
    def test_label(self, url, label):
        assert _source_for(url) == label


class TestLooksLikeUrlList:
    def test_three_fanfic_urls(self):
        text = "\n".join([
            "https://archiveofourown.org/works/1",
            "https://archiveofourown.org/works/2",
            "https://www.fanfiction.net/s/9999",
        ])
        assert _looks_like_url_list(text) is True

    def test_dominant_urls_threshold(self):
        # 2 URLs out of 3 non-empty lines = 66% URLs, with 1 known fanfic source.
        text = "\n".join([
            "https://archiveofourown.org/works/1",
            "Notes from a friend",
            "https://example.com",
            "https://www.fanfiction.net/s/9999",
        ])
        assert _looks_like_url_list(text) is True

    def test_single_url_rejects(self):
        # 1 URL across 5 lines = 20% URL density → below the 40% threshold
        # AND below the 3-URL absolute count, so this is treated as prose.
        text = "\n".join([
            "Just an article with one URL footnote.",
            "It has multiple paragraphs.",
            "Mostly prose.",
            "see: https://archiveofourown.org/works/1",
            "End of article.",
        ])
        assert _looks_like_url_list(text) is False

    def test_urls_but_no_fanfic_source(self):
        text = "\n".join([
            "https://google.com",
            "https://wikipedia.org",
            "https://news.ycombinator.com",
        ])
        assert _looks_like_url_list(text) is False

    @pytest.mark.parametrize("bad", [None, "", "tiny"])
    def test_empty_inputs(self, bad):
        assert _looks_like_url_list(bad) is False


class TestCleanUrl:
    @pytest.mark.parametrize("raw,expected", [
        ("https://archiveofourown.org/works/1.", "https://archiveofourown.org/works/1"),
        ("https://archiveofourown.org/works/1,", "https://archiveofourown.org/works/1"),
        ("https://archiveofourown.org/works/1)", "https://archiveofourown.org/works/1"),
        ("https://archiveofourown.org/works/1", "https://archiveofourown.org/works/1"),
    ])
    def test_clean(self, raw, expected):
        assert _clean_url(raw) == expected


class TestModuleSurface:
    def test_url_regex_matches_http_and_www(self):
        # Both schemes are picked up by the prose-extraction regex.
        assert URL_REGEX.search("see https://archiveofourown.org/works/1")
        assert URL_REGEX.search("see www.fanfiction.net/s/1")

    def test_url_re_matches_only_full_http(self):
        # _URL_RE is stricter — full scheme only, used for the URL-list heuristic.
        assert _URL_RE.search("https://archiveofourown.org/works/1")
        assert not _URL_RE.search("www.fanfiction.net/s/1")

    def test_fanfic_source_patterns_present(self):
        # Sanity-check that the patterns list covers every supported site.
        # Patterns use escaped dots (`\.`) so check the unescaped substring.
        joined = " ".join(FANFIC_SOURCE_PATTERNS).replace("\\.", ".")
        for needle in [
            "archiveofourown", "fanfiction.net", "fictionpress",
            "royalroad", "spacebattles", "sufficientvelocity",
            "questionablequesting", "adult-fanfiction",
            "potionsandsnitches", "twilighted",
        ]:
            assert needle in joined, f"{needle} missing from FANFIC_SOURCE_PATTERNS"
