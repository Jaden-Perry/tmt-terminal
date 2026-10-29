"""Refresh orchestration shared by the API's startup top-up and the nightly batch job."""
from __future__ import annotations

import threading
import time
import traceback

from .. import db
from . import metrics, prices, universe, watchlists

_lock = threading.Lock()
STATUS: dict = {"running": False, "job": None, "progress": None, "last": None}


def _log_start(job: str) -> int:
    with db.tx() as c:
        cur = c.execute("INSERT INTO job_log(job, started, status) VALUES (?,?,?)", (job, time.time(), "running"))
        return cur.lastrowid


def _log_end(jid: int, status: str, detail: str) -> None:
    with db.tx() as c:
        c.execute("UPDATE job_log SET finished=?, status=?, detail=? WHERE id=?", (time.time(), status, detail[:4000], jid))


def ordered_tickers() -> list[str]:
    """Watchlist names first so they're always freshest, then the rest of the universe."""
    wl = watchlists.all_tickers()
    rest = [t for t in universe.tickers() if t not in set(wl)]
    return wl + rest


def daily_quick(log=print) -> dict:
    """Cheap daily pass: price top-up for everything + recompute snapshots from cached fundamentals.

    Only tickers whose weekly fundamentals cache has expired make a network call, and at most
    `max_info` of them per run so startup stays quick (the nightly job handles the rest).
    """
    universe.ensure_universe()
    tickers = ordered_tickers()
    res = prices.refresh(tickers + list(prices.BENCHMARKS), log=log, record=True)
    res["new_filings"] = new_filings(tickers, log=log)
    built = 0
    for t in tickers:
        try:
            has_info = db.cache_get(f"yf:info:{t}") is not None
            if has_info or t in watchlists.all_tickers():
                metrics.build(t, include_analyst=t in watchlists.all_tickers())
                built += 1
        except Exception as e:  # noqa: BLE001
            log(f"[daily] {t}: {e}")
    return {**res, "snapshots": built}


def new_filings(tickers: list[str], log=print) -> list[str]:
    """Pick up just-filed 10-Qs/10-Ks the same day instead of waiting for the weekly financials cache."""
    from . import fundamentals

    out = []
    for i, t in enumerate(tickers):
        STATUS["progress"] = f"filings {i + 1}/{len(tickers)} {t}"
        try:
            f = fundamentals.refresh_if_new_filing(t)
            if f:
                out.append(t)
                log(f"[filings] {t}: new {f['form']} for {f.get('report_date')}, financials refreshed")
        except Exception as e:  # noqa: BLE001
            log(f"[filings] {t}: {e}")
    return out


def recompute_local(log=print) -> dict:
    """No network: rebuild valuation summaries and snapshots from cached data (after a methodology change)."""
    from . import valuation

    n = 0
    for t in ordered_tickers():
        try:
            if db.cache_get(f"fin:{t}") is not None:
                valuation.summary(t, force=True)
            if db.cache_get(f"yf:info:{t}") is not None:
                metrics.build(t, include_analyst=False)
                n += 1
        except Exception as e:  # noqa: BLE001
            log(f"[recompute] {t}: {e}")
    return {"snapshots": n}


def nightly(max_minutes: float = 120, log=print) -> dict:
    """Slow full-universe crawl inside free-tier limits. Safe to stop and resume (everything is cached)."""
    deadline = time.time() + max_minutes * 60
    universe.ensure_universe()
    tickers = ordered_tickers()
    summary = {"prices": prices.refresh(tickers + list(prices.BENCHMARKS), log=log, record=True)}
    summary["new_filings"] = new_filings(tickers, log=log)
    done = skipped = 0
    for i, t in enumerate(tickers):
        if time.time() > deadline:
            skipped = len(tickers) - i
            log(f"[nightly] time budget reached; {skipped} tickers left for next run")
            break
        STATUS["progress"] = f"{i + 1}/{len(tickers)} {t}"
        try:
            metrics.info(t)
            metrics.analyst(t)
            for fn in REFRESHERS:
                fn(t)
            metrics.build(t, include_analyst=False)
            done += 1
        except Exception as e:  # noqa: BLE001
            log(f"[nightly] {t}: {e}")
    summary.update({"tickers_done": done, "tickers_left": skipped})
    return summary


def _sec_financials(t: str) -> None:
    from . import fundamentals, valuation

    fundamentals.statements(t)  # weekly TTL: no-op when fresh
    valuation.summary(t, force=True)  # cheap: recomputed from cached data


# Per-ticker refresh steps run by the nightly job (later phases append more).
def _news(t: str) -> None:
    from . import news

    news.refresh_ticker_nightly(t)  # daily TTL


REFRESHERS: list = [_sec_financials, _news]


def run_in_background(job: str, fn, **kw) -> bool:
    if not _lock.acquire(blocking=False):
        return False

    def runner():
        jid = _log_start(job)
        STATUS.update(running=True, job=job, progress=None)
        try:
            out = fn(**kw)
            _log_end(jid, "ok", str(out))
            STATUS["last"] = {"job": job, "status": "ok", "detail": out, "at": time.time()}
        except Exception:  # noqa: BLE001
            _log_end(jid, "error", traceback.format_exc())
            STATUS["last"] = {"job": job, "status": "error", "at": time.time()}
        finally:
            STATUS.update(running=False, job=None, progress=None)
            _lock.release()

    threading.Thread(target=runner, daemon=True).start()
    return True
