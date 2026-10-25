"""Shared HTTP session helpers."""
from __future__ import annotations

import requests

from ..config import SEC_USER_AGENT

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

_session = requests.Session()
_session.headers.update({"User-Agent": BROWSER_UA, "Accept-Encoding": "gzip, deflate"})


def session() -> requests.Session:
    return _session


def sec_headers() -> dict:
    if not SEC_USER_AGENT:
        raise RuntimeError("SEC_USER_AGENT is not set in .env (SEC requires 'Your Name your@email.com')")
    return {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}


def get_json(url: str, *, params: dict | None = None, headers: dict | None = None, timeout: float = 30):
    r = _session.get(url, params=params, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.json()
