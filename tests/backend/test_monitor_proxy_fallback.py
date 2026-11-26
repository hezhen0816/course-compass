from __future__ import annotations

import requests

from backend.monitor import api_client


def test_proxy_errors_are_recognised() -> None:
    assert api_client._is_proxy_unreachable(requests.exceptions.ProxyError("boom")) is True
    assert api_client._is_proxy_unreachable(
        requests.exceptions.ConnectionError("SOCKSHTTPSConnectionPool: failed to open a socket to the proxy")
    ) is True


def test_school_side_failures_do_not_trigger_the_fallback() -> None:
    """A school timeout must not silently bypass the proxy the user configured."""
    assert api_client._is_proxy_unreachable(requests.exceptions.ReadTimeout("read timed out")) is False
    assert api_client._is_proxy_unreachable(requests.exceptions.SSLError("certificate verify failed")) is False
    assert api_client._is_proxy_unreachable(
        requests.exceptions.ConnectionError("Remote end closed connection")
    ) is False
