"""Daily price history in SQLite, refreshed in batches from yfinance."""
from __future__ import annotations

import datetime as dt
import time
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .. import db
from ..sources import yf

BENCHMARKS = {
    "SPY": "S&P 500 (SPY)",
    "QQQ": "Nasdaq-100 (QQQ)",
    "XLK": "Technology (XLK)",
    "XLC": "Communication Svcs (XLC)",
    "SMH": "Semiconductors (SMH)",
    "IGV": "Software (IGV)",
    "IYZ": "Telecom (IYZ)",
}

# Sector ETF each sub-industry is measured against for "relative" moves.
SUB_INDUSTRY_ETF = {
    "Semiconductors": "SMH", "Semi Equipment": "SMH", "Software": "IGV", "Internet": "XLC",
    "IT Services": "XLK", "Hardware": "XLK", "Comm Equipment": "XLK",
    "Media & Entertainment": "XLC", "Telecom": "IYZ",
}

CHUNK = 40


def _store(long: pd.DataFrame) -> int:
    if long.empty:
        return 0
    rows = [tuple(None if (isinstance(v, float) and np.isnan(v)) else v for v in r)
            for r in long.itertuples(index=False, name=None)]
    with db.tx() as c:
        c.executemany(
            "INSERT OR REPLACE INTO prices(ticker,date,open,high,low,close,adj_close,volume) VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
    return len(rows)


def last_date(ticker: str) -> str | None:
    r = db.conn().execute("SELECT MAX(date) FROM prices WHERE ticker=?", (ticker,)).fetchone()
    return r[0] if r else None


ET = ZoneInfo("America/New_York")
CLOSE_READY = dt.time(16, 20)  # Yahoo usually has the day's bar a few minutes after the 4:00 PM ET close


def last_close_time(now: dt.datetime | None = None) -> dt.datetime:
    """Most recent weekday market close (ET) whose bar should be available. Holidays just yield no new rows."""
    now = (now or dt.datetime.now(ET)).astimezone(ET)
    d = now.date()
    if now.time() < CLOSE_READY:
        d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return dt.datetime.combine(d, CLOSE_READY, ET)


def needs_daily_refresh() -> bool:
    """True if the last full refresh happened before the most recent market close."""
    hit = db.cache_get("prices:last_refresh")
    if hit is None:
        return True
    return hit[0]["at"] < last_close_time().timestamp()


def refresh(tickers: list[str], *, log=print, record: bool = False) -> dict:
    """Full 10Y history for tickers we've never stored; a short top-up for the rest."""
    target = last_close_time().date().isoformat()
    need_full, need_short = [], []
    for t in tickers:
        ld = last_date(t)
        if ld is None:
            need_full.append(t)
        elif ld < target:
            need_short.append(t)
    stored = 0
    for group, period in ((need_full, "10y"), (need_short, "1mo")):
        for i in range(0, len(group), CHUNK):
            chunk = group[i:i + CHUNK]
            try:
                stored += _store(yf.download(chunk, period))
            except Exception as e:  # noqa: BLE001
                log(f"[prices] chunk {chunk[0]}..{chunk[-1]} failed: {e}")
            time.sleep(2)
    if record:  # only universe-wide refreshes count; a one-ticker lookup must not mark the day as done
        db.cache_set("prices:last_refresh", {"at": time.time(), "full": len(need_full), "short": len(need_short)})
    return {"rows": stored, "full": len(need_full), "topped_up": len(need_short)}


def ensure(ticker: str) -> None:
    """On-demand fetch for tickers outside the nightly universe (e.g. typed into the command bar)."""
    ld = last_date(ticker)
    if ld is None or ld < last_close_time().date().isoformat():
        hit = db.cache_get(f"prices:ondemand:{ticker}", 1 * db.HOUR)
        if hit is None or ld is None:
            refresh([ticker])
            db.cache_set(f"prices:ondemand:{ticker}", 1)


def history(ticker: str, start: str | None = None) -> pd.DataFrame:
    q = "SELECT date, open, high, low, close, adj_close, volume FROM prices WHERE ticker=?"
    args: list = [ticker]
    if start:
        q += " AND date>=?"
        args.append(start)
    df = pd.read_sql_query(q + " ORDER BY date", db.conn(), params=args)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    return df


def closes(tickers: list[str], start: str | None = None, col: str = "adj_close") -> pd.DataFrame:
    """Wide frame of adjusted closes, one column per ticker."""
    if not tickers:
        return pd.DataFrame()
    marks = ",".join("?" * len(tickers))
    q = f"SELECT ticker, date, {col} AS v FROM prices WHERE ticker IN ({marks})"
    args: list = list(tickers)
    if start:
        q += " AND date>=?"
        args.append(start)
    df = pd.read_sql_query(q, db.conn(), params=args)
    if df.empty:
        return pd.DataFrame()
    wide = df.pivot(index="date", columns="ticker", values="v")
    wide.index = pd.to_datetime(wide.index)
    return wide.sort_index()


def _ret(s: pd.Series, days: int | None = None, since: pd.Timestamp | None = None) -> float | None:
    s = s.dropna()
    if len(s) < 2:
        return None
    last = s.iloc[-1]
    if since is not None:
        base = s[s.index < since]
        if base.empty:
            return None
        ref = base.iloc[-1]
    else:
        target = s.index[-1] - pd.Timedelta(days=days)
        base = s[s.index <= target]
        if base.empty:
            return None
        ref = base.iloc[-1]
    return float(last / ref - 1) if ref else None


def returns_table(tickers: list[str]) -> dict[str, dict]:
    start = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    wide = closes(tickers, start)
    out: dict[str, dict] = {}
    if wide.empty:
        return out
    ytd = pd.Timestamp(dt.date(dt.date.today().year, 1, 1))
    for t in wide.columns:
        s = wide[t].dropna()
        if s.empty:
            continue
        out[t] = {
            "price_date": s.index[-1].strftime("%Y-%m-%d"),
            "chg_1d": float(s.iloc[-1] / s.iloc[-2] - 1) if len(s) > 1 else None,
            "chg_1w": _ret(s, 7),
            "chg_1m": _ret(s, 30),
            "chg_3m": _ret(s, 91),
            "chg_ytd": _ret(s, since=ytd),
            "chg_1y": _ret(s, 365),
            "high_52w": float(s[s.index >= s.index[-1] - pd.Timedelta(days=365)].max()),
        }
    return out
