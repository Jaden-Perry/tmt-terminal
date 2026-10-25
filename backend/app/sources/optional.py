"""Cache wrapper for key-gated / partly paywalled sources that records *why* data is missing."""
from __future__ import annotations

from .. import db
from .finnhub import NoKey, Paywalled


def optional(key: str, fn, ttl: float = db.WEEK) -> dict:
    """Return {"data", "status"}. Paywalled results are cached like data so we don't re-spend calls;
    missing keys and transient errors are not cached, so adding a key takes effect immediately."""
    hit = db.cache_get(key, ttl)
    if hit is not None and isinstance(hit[0], dict) and "status" in hit[0]:
        return {"data": hit[0].get("v"), "status": hit[0]["status"], "fetched_at": hit[1]}
    try:
        v = fn()
        status = "ok" if v else "empty"
    except NoKey as e:
        return {"data": None, "status": f"No key: {e}"}
    except Paywalled as e:
        v, status = None, f"Paywalled: {e}"
    except Exception as e:  # noqa: BLE001
        old = db.cache_get(key)
        if old is not None and isinstance(old[0], dict) and old[0].get("v") is not None:
            return {"data": old[0]["v"], "status": f"Stale (refresh failed: {str(e)[:120]})", "fetched_at": old[1]}
        return {"data": None, "status": f"Unavailable: {str(e)[:200]}"}
    db.cache_set(key, {"v": v, "status": status})
    return {"data": db._clean(v), "status": status}
