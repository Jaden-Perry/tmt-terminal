"""SEC EDGAR: XBRL company facts (financials backbone) and filing index.

Company facts JSON is several MB per company, so the raw file is stored gzipped on disk
(data/sec/) with a weekly TTL instead of in SQLite.
"""
from __future__ import annotations

import gzip
import json
import time

from .. import ratelimit
from ..config import DATA_DIR
from .http import sec_headers, session

SEC_DIR = DATA_DIR / "sec"
SEC_DIR.mkdir(parents=True, exist_ok=True)
FACTS_TTL = 7 * 86400


def _get(url: str, timeout: float = 60):
    ratelimit.wait("sec")
    r = session().get(url, headers=sec_headers(), timeout=timeout)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def company_facts(cik: int, force: bool = False) -> dict | None:
    path = SEC_DIR / f"facts_{cik:010d}.json.gz"
    if path.exists() and not force and time.time() - path.stat().st_mtime < FACTS_TTL:
        with gzip.open(path, "rt") as f:
            return json.load(f)
    try:
        data = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    except Exception:
        if path.exists():  # keep serving the last good copy
            with gzip.open(path, "rt") as f:
                return json.load(f)
        raise
    if data is None:
        return None
    with gzip.open(path, "wt") as f:
        json.dump(data, f)
    return data


def facts_age(cik: int) -> float | None:
    path = SEC_DIR / f"facts_{cik:010d}.json.gz"
    return path.stat().st_mtime if path.exists() else None


def submissions(cik: int) -> dict | None:
    return _get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
