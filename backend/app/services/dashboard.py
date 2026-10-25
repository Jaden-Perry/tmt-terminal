"""Dashboard aggregates: watchlist table, sector heatmap, top movers."""
from __future__ import annotations

import json

from .. import db
from . import metrics, prices, universe, watchlists

PERIODS = {"1d": "chg_1d", "1w": "chg_1w", "1m": "chg_1m", "ytd": "chg_ytd", "1y": "chg_1y"}


def watchlist_table(name: str) -> list[dict]:
    tickers = watchlists.all_lists().get(name, [])
    out = []
    for t in tickers:
        try:
            out.append(metrics.get(t))
        except Exception as e:  # noqa: BLE001
            out.append({"ticker": t, "na": {"_all": f"Couldn't load data: {e}"}})
    return out


def _universe_frame() -> list[dict]:
    """Universe rows + returns from stored prices + market cap (snapshot if we have one, else Nasdaq's)."""
    rows = universe.all_rows()
    rets = prices.returns_table([r["ticker"] for r in rows])
    snaps = {r[0]: json.loads(r[1]) for r in db.conn().execute("SELECT ticker, data FROM metrics")}
    out = []
    for r in rows:
        t = r["ticker"]
        s = snaps.get(t, {})
        rr = rets.get(t)
        if not rr:
            continue
        out.append({
            "ticker": t,
            "name": s.get("name") or r["name"],
            "sub_industry": r["sub_industry"],
            "market_cap": s.get("market_cap") or r["market_cap"],
            **{k: rr.get(k) for k in PERIODS.values()},
        })
    return out


def heatmap(period: str = "1d") -> dict:
    col = PERIODS.get(period, "chg_1d")
    groups: dict[str, list] = {}
    for r in _universe_frame():
        groups.setdefault(r["sub_industry"] or "Other", []).append(
            {"ticker": r["ticker"], "name": r["name"], "market_cap": r["market_cap"], "chg": r[col]})
    result = []
    for g, items in groups.items():
        items.sort(key=lambda x: -(x["market_cap"] or 0))
        caps = [i["market_cap"] or 0 for i in items]
        tot = sum(caps)
        wchg = sum((i["chg"] or 0) * (i["market_cap"] or 0) for i in items) / tot if tot else None
        result.append({"group": g, "market_cap": tot, "chg": wchg, "items": items})
    result.sort(key=lambda g: -(g["market_cap"] or 0))
    return {"period": period, "groups": result,
            "note": "Cap-weighted return per sub-industry. Market caps are from the latest snapshot or Nasdaq's screener."}


def movers(period: str = "1d", n: int = 10) -> dict:
    col = PERIODS.get(period, "chg_1d")
    rows = [r for r in _universe_frame() if r[col] is not None]
    rows.sort(key=lambda r: r[col])
    pick = lambda r: {"ticker": r["ticker"], "name": r["name"], "sub_industry": r["sub_industry"], "chg": r[col], "market_cap": r["market_cap"]}  # noqa: E731
    return {"period": period, "gainers": [pick(r) for r in rows[::-1][:n]], "losers": [pick(r) for r in rows[:n]]}


def benchmarks() -> list[dict]:
    rets = prices.returns_table(list(prices.BENCHMARKS))
    return [{"ticker": t, "name": n, **rets.get(t, {})} for t, n in prices.BENCHMARKS.items()]
