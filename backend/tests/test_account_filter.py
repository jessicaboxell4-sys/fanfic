"""Regression coverage for the test-account fixture filter."""
from utils.test_account_filter import is_test_account, mongo_test_account_filter


def test_is_test_account_for_test_local_domain():
    assert is_test_account("sync_abc@test.local") is True
    assert is_test_account("linkless_xyz@TEST.LOCAL") is True


def test_is_test_account_for_example_com():
    assert is_test_account("anyone@example.com") is True
    assert is_test_account("alert@example.org") is True


def test_is_test_account_for_prefix_local_parts():
    assert is_test_account("test_reg_abc@mail.com") is True
    assert is_test_account("t_1781699373@mail.com") is True
    assert is_test_account("sync_abc@mail.com") is True
    assert is_test_account("linkless_abc@mail.com") is True
    assert is_test_account("qa_smoke@mail.com") is True


def test_is_test_account_rejects_real_emails():
    assert is_test_account("jane@gmail.com") is False
    assert is_test_account("shelfsort-tester@gmail.com") is False
    assert is_test_account("") is False
    assert is_test_account(None) is False


def test_mongo_filter_has_or_clauses():
    f = mongo_test_account_filter()
    assert "$or" in f
    # At least one regex per domain + one per prefix
    assert len(f["$or"]) >= 8
    # Every clause targets the email field with either a direct
    # ``$regex`` (positive match: domain or prefix) or a ``$not``
    # wrapper (negative match: malformed email with no @).
    for clause in f["$or"]:
        assert "email" in clause
        cond = clause["email"]
        assert "$regex" in cond or ("$not" in cond and "$regex" in cond["$not"]), \
            f"clause has neither $regex nor $not/$regex: {clause}"
