from __future__ import annotations

from backend.monitor import worker as worker_mod

AUTH = "owner@example.com"
CUSTOM = "someone.else@example.com"


def test_custom_recipient_needs_the_users_own_sender() -> None:
    """Without own credentials the worker's shared sender would be the relay."""
    assert worker_mod._resolve_recipient(AUTH, CUSTOM, has_own_sender=False) == AUTH
    assert worker_mod._resolve_recipient(AUTH, CUSTOM, has_own_sender=True) == CUSTOM


def test_unset_or_malformed_recipient_falls_back_to_the_auth_email() -> None:
    for value in (None, "", "   ", "not-an-email", "no@tld", "@example.com"):
        assert worker_mod._resolve_recipient(AUTH, value, has_own_sender=True) == AUTH


def test_header_injection_is_rejected() -> None:
    """The value lands in a MIME To: header, so a newline must never survive."""
    injected = "a@example.com\nBcc: victim@example.com"
    assert worker_mod._resolve_recipient(AUTH, injected, has_own_sender=True) == AUTH
    assert worker_mod._valid_email("a@example.com\r\nBcc: x@y.com") == ""
