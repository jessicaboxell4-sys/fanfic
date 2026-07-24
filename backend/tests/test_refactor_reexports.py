# Regression: verify routes.books re-exports still resolve and are identical
# to the newly-extracted utils.duplicates / utils.fanfic implementations.
import importlib


def test_routes_books_reexports_resolve():
    books = importlib.import_module("routes.books")
    dup = importlib.import_module("utils.duplicates")
    fan = importlib.import_module("utils.fanfic")
    consts = importlib.import_module("utils.constants")

    # duplicates helpers
    for name in [
        "_clean_author_string",
        "_normalize_title_for_match",
        "_normalize_author_for_match",
        "_updated_shelf_name",
        "find_duplicate_candidates",
        "_apply_duplicate_policy",
    ]:
        assert hasattr(books, name), f"routes.books missing {name}"
        assert getattr(books, name) is getattr(dup, name), f"identity mismatch for {name}"

    # fanfic helpers
    for name in [
        "FANFICFARE_USER_AGENT",
        "FanficNotFoundError",
        "find_source_url",
        "extract_fanfic_urls",
        "fanfic_fetch_epub",
        "fetch_fanfic_with_fallback",
        "apply_refresh",
    ]:
        assert hasattr(books, name), f"routes.books missing {name}"
        assert getattr(books, name) is getattr(fan, name), f"identity mismatch for {name}"

    # constants
    assert hasattr(books, "OLD_STORIES_SHELF")
    assert books.OLD_STORIES_SHELF == consts.OLD_STORIES_SHELF

    # 2026-08-22 — Phase 6C slice 4: filesystem + filename helpers
    # extracted to utils.book_files and re-exported from routes.books.
    book_files = importlib.import_module("utils.book_files")
    for name in [
        "_write_local_and_mirror_to_r2",
        "_safe_folder",
        "_safe_filename",
        "_templated_filename",
    ]:
        assert hasattr(books, name), f"routes.books missing {name}"
        assert getattr(books, name) is getattr(book_files, name), f"identity mismatch for {name}"


def test_templated_filename_shape():
    """Guard the historical output shape 'Title_by_Author-shortid.epub'."""
    from routes.books import _templated_filename
    assert _templated_filename("A Black Comedy", "nonjon", "book_2F4YtDd3") == \
        "A_Black_Comedy_by_nonjon-2F4YtDd3.epub"
    # Filesystem-unsafe chars are stripped, not underscored.
    got = _templated_filename('Bad/File:Name*', 'Author?', 'book_x', ext=".txt")
    assert got.endswith(".txt")
    assert "/" not in got and ":" not in got and "*" not in got and "?" not in got


def test_safe_folder_and_safe_filename_boundaries():
    """Guard the sanitizer edge cases used by exports + downloads."""
    from routes.books import _safe_folder, _safe_filename
    assert _safe_folder("") == "unknown"
    assert _safe_folder(None) == "unknown"
    assert _safe_folder("A" * 200)[:60] == "A" * 60  # capped at 60
    assert "/" not in _safe_folder("dir/name")
    assert _safe_filename("book", ".epub") == "book.epub"
    assert _safe_filename("", ".epub") == "book.epub"
    assert _safe_filename("A" * 200, ".epub").endswith(".epub")
    assert len(_safe_filename("A" * 200, ".epub")) <= 120 + len(".epub")
