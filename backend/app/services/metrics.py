"""Per-ticker snapshot used by the dashboard, comps and screener.

Fundamentals (from yfinance .info) refresh weekly; price-dependent ratios are recomputed
daily from the latest stored close so they don't go stale between fundamental refreshes.
Every missing value gets a human-readable reason in `na`.
"""
from __future__ import annotations

import json
import time

from .. import db
from ..sources import yf
from . import prices, universe

INFO_TTL = db.WEEK
ANALYST_TTL = db.WEEK


def info(ticker: str, force: bool = False) -> dict:
    return db.cached(f"yf:info:{ticker}", INFO_TTL, lambda: yf.info(ticker), force=force)


def analyst(ticker: str, force: bool = False) -> dict:
    return db.cached(f"yf:analyst:{ticker}", ANALYST_TTL, lambda: yf.analyst(ticker), force=force)


def _div(a, b):
    try:
        if a is None or b is None or b == 0:
            return None
        return a / b
    except TypeError:
        return None


def _revisions(an: dict | None) -> dict:
    """Net EPS revisions (up - down) over the last 30 days for current FY, from Yahoo's eps_revisions."""
    out = {"rev_up_30d": None, "rev_down_30d": None, "eps_trend_90d": None}
    if not an:
        return out
    for row in an.get("eps_revisions") or []:
        if row.get("period") == "0y":
            out["rev_up_30d"] = row.get("upLast30days")
            out["rev_down_30d"] = row.get("downLast30days")
    for row in an.get("eps_trend") or []:
        if row.get("period") == "0y":
            cur, ago = row.get("current"), row.get("90daysAgo")
            if cur is not None and ago:
                out["eps_trend_90d"] = cur / abs(ago) - 1 if ago else None
    return out


def build(ticker: str, *, include_analyst: bool = True, force_info: bool = False) -> dict:
    ticker = ticker.upper()
    na: dict[str, str] = {}
    inf_res = info(ticker, force=force_info)
    inf = inf_res["data"] or {}
    if not inf:
        na["_all"] = "Yahoo Finance returned no profile for this ticker (delisted, wrong symbol, or temporarily rate-limited)."
    rets = prices.returns_table([ticker]).get(ticker, {})
    hist = prices.history(ticker)
    last_close = float(hist["close"].iloc[-1]) if not hist.empty else None
    price = last_close or inf.get("currentPrice") or inf.get("regularMarketPrice")
    info_price = inf.get("currentPrice") or inf.get("regularMarketPrice")

    shares = inf.get("sharesOutstanding")
    mcap = price * shares if price and shares else inf.get("marketCap")
    if mcap is None:
        na["market_cap"] = "No share count from Yahoo Finance."
    ev = inf.get("enterpriseValue")
    if ev is not None and mcap is not None and inf.get("marketCap"):
        ev = ev + (mcap - inf["marketCap"])  # roll EV forward with today's market cap
    elif ev is None and mcap is not None and inf.get("totalDebt") is not None and inf.get("totalCash") is not None:
        ev = mcap + inf["totalDebt"] - inf["totalCash"]

    teps, feps = inf.get("trailingEps"), inf.get("forwardEps")
    trailing_pe = _div(price, teps) if teps and teps > 0 else None
    if trailing_pe is None:
        na["trailing_pe"] = "Trailing EPS is negative or zero, so P/E isn't meaningful." if teps is not None and teps <= 0 else "Trailing EPS not available from Yahoo Finance."
    forward_pe = _div(price, feps) if feps and feps > 0 else None
    if forward_pe is None:
        na["forward_pe"] = "Consensus forward EPS is negative or zero." if feps is not None and feps <= 0 else "No forward EPS consensus available (often thin analyst coverage)."

    ebitda = inf.get("ebitda")
    ev_ebitda = _div(ev, ebitda) if ebitda and ebitda > 0 else None
    if ev_ebitda is None:
        na["ev_ebitda"] = "EBITDA is negative or zero." if ebitda is not None and ebitda <= 0 else "EBITDA or EV not available from Yahoo Finance."
    rev = inf.get("totalRevenue")
    ev_sales = _div(ev, rev) if rev and rev > 0 else None
    if ev_sales is None:
        na["ev_sales"] = "Revenue or EV not available."
    fcf = inf.get("freeCashflow")
    fcf_yield = _div(fcf, mcap)
    if fcf_yield is None:
        na["fcf_yield"] = "Free cash flow not available from Yahoo Finance."

    peg = inf.get("trailingPegRatio") or inf.get("pegRatio")
    if peg is None:
        na["peg"] = "Yahoo Finance has no PEG (needs a 5Y EPS growth estimate)."

    target = inf.get("targetMeanPrice")
    upside = _div(target, price) - 1 if target and price else None
    if target is None:
        na["target_mean"] = na["upside"] = "No analyst price targets on record."

    high52 = inf.get("fiftyTwoWeekHigh") or rets.get("high_52w")
    off_high = (price / high52 - 1) if price and high52 else None

    an = analyst(ticker)["data"] if include_analyst else db.cache_get(f"yf:analyst:{ticker}")
    if isinstance(an, tuple):
        an = an[0]
    rev_data = _revisions(an)
    if rev_data["rev_up_30d"] is None:
        na["revisions"] = "Yahoo Finance has no EPS revision counts for this ticker."

    u = universe.get(ticker) or {}
    snap = {
        "ticker": ticker,
        "name": inf.get("longName") or inf.get("shortName") or u.get("name"),
        "sub_industry": u.get("sub_industry"),
        "gics_sub_industry": u.get("gics_sub_industry"),
        "in_universe": bool(u),
        "price": price,
        "price_date": rets.get("price_date"),
        "price_note": None if last_close else "Price from Yahoo profile snapshot (no stored daily history yet).",
        "currency": inf.get("currency"),
        **{k: rets.get(k) for k in ("chg_1d", "chg_1w", "chg_1m", "chg_3m", "chg_ytd", "chg_1y")},
        "market_cap": mcap,
        "enterprise_value": ev,
        "trailing_pe": trailing_pe,
        "forward_pe": forward_pe,
        "ev_ebitda": ev_ebitda,
        "ev_sales": ev_sales,
        "fcf_yield": fcf_yield,
        "peg": peg,
        "revenue_growth": inf.get("revenueGrowth"),
        "earnings_growth": inf.get("earningsGrowth"),
        "gross_margin": inf.get("grossMargins"),
        "operating_margin": inf.get("operatingMargins"),
        "net_margin": inf.get("profitMargins"),
        "roe": inf.get("returnOnEquity"),
        "beta": inf.get("beta"),
        "high_52w": high52,
        "off_52w_high": off_high,
        "rating": inf.get("recommendationKey"),
        "rating_mean": inf.get("recommendationMean"),
        "analyst_count": inf.get("numberOfAnalystOpinions"),
        "target_mean": target,
        "target_high": inf.get("targetHighPrice"),
        "target_low": inf.get("targetLowPrice"),
        "upside": upside,
        **rev_data,
        "fundamentals_as_of": inf_res.get("fetched_at"),
        "fundamentals_stale": inf_res.get("stale", False),
        "info_price": info_price,
    }
    for k in ("revenue_growth", "gross_margin", "operating_margin", "net_margin", "roe", "beta"):
        if snap[k] is None:
            na.setdefault(k, "Not provided by Yahoo Finance for this ticker.")
    if snap["rating"] in (None, "none"):
        snap["rating"] = None
        na["rating"] = "No analyst recommendations on record."
    for k in ("chg_1d", "chg_1w", "chg_1m", "chg_ytd", "chg_1y"):
        if snap[k] is None:
            na[k] = "Not enough stored price history for this window yet."

    # Valuation-history extras (5Y averages, ROIC) are attached by the valuation service when available.
    try:
        from . import valuation  # local import: valuation depends on metrics

        snap.update(valuation.snapshot_extras(ticker, snap, na))
    except ImportError:
        pass

    snap["na"] = na
    with db.tx() as c:
        c.execute("INSERT OR REPLACE INTO metrics(ticker, data, updated_at) VALUES (?,?,?)",
                  (ticker, db.dumps(snap), time.time()))
    return db._clean(snap)


def get(ticker: str, max_age: float = db.DAY, include_analyst: bool = True) -> dict:
    row = db.conn().execute("SELECT data, updated_at FROM metrics WHERE ticker=?", (ticker.upper(),)).fetchone()
    if row and time.time() - row["updated_at"] < max_age:
        return json.loads(row["data"])
    return build(ticker, include_analyst=include_analyst)


def stored(tickers: list[str] | None = None) -> list[dict]:
    if tickers is None:
        rows = db.conn().execute("SELECT data FROM metrics").fetchall()
    else:
        marks = ",".join("?" * len(tickers))
        rows = db.conn().execute(f"SELECT data FROM metrics WHERE ticker IN ({marks})", tickers).fetchall()
    return [json.loads(r[0]) for r in rows]
