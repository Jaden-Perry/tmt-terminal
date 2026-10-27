"""Per-ticker snapshot used by the dashboard, comps and screener.

Fundamentals (from yfinance .info) refresh weekly; price-dependent ratios are recomputed
daily from the latest stored close so they don't go stale between fundamental refreshes.
Every missing value gets a human-readable reason in `na`.
"""
from __future__ import annotations

import datetime as dt
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
                # (new - old) / |old|: correct sign even when EPS is negative (a smaller loss is an improvement)
                out["eps_trend_90d"] = (cur - ago) / abs(ago)
    return out


def _ntm_eps(an: dict | None, inf: dict) -> float | None:
    """Next-twelve-months EPS: blend current-FY and next-FY consensus by the share of the current FY remaining."""
    if not an:
        return None
    est = {r.get("period"): r.get("avg") for r in an.get("earnings_estimate") or []}
    e0, e1, lfy = est.get("0y"), est.get("+1y"), inf.get("lastFiscalYearEnd")
    if e0 is None or e1 is None or not lfy:
        return None
    fy_end = lfy + 365.25 * 86400
    now = time.time()
    while fy_end < now:  # Yahoo's lastFiscalYearEnd can lag a year
        fy_end += 365.25 * 86400
    f = min(max((fy_end - now) / (365.25 * 86400), 0.0), 1.0)
    return f * e0 + (1 - f) * e1


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

    # Yahoo's marketCap covers all share classes (sharesOutstanding often counts only one class)
    if inf.get("marketCap") and price and info_price:
        mcap = inf["marketCap"] * price / info_price
    else:
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
    ntm = _ntm_eps(an, inf)
    ntm_pe = _div(price, ntm) if ntm and ntm > 0 else None
    if ntm_pe is None:
        na["ntm_pe"] = "Needs current- and next-FY consensus EPS (positive) from Yahoo."

    # ---- One definition per metric, used everywhere (dashboard, comps, screener, RV) ----
    basis: dict[str, str] = {}
    # Forward: NTM consensus EPS (time-weighted current-FY / next-FY consensus). Yahoo's next-fiscal-year
    # P/E is kept only as a reference field.
    forward_pe_nfy = forward_pe
    forward_pe = ntm_pe
    basis["forward_pe"] = "NTM consensus EPS"
    if forward_pe is None:
        na["forward_pe"] = na["ntm_pe"]
    # PEG: NTM P/E divided by consensus EPS growth from the current to the next fiscal year (same estimate set)
    est = {r.get("period"): r for r in (an or {}).get("earnings_estimate") or []}
    e0, e1 = (est.get("0y") or {}).get("avg"), (est.get("+1y") or {}).get("avg")
    fwd_growth = (e1 / e0 - 1) if e0 and e1 and e0 > 0 else None
    peg = ntm_pe / (fwd_growth * 100) if ntm_pe and fwd_growth and fwd_growth > 0 else None
    basis["peg"] = "NTM P/E / next-FY consensus EPS growth"
    if peg is None:
        na["peg"] = ("Consensus EPS growth to next FY is zero or negative, so PEG isn't meaningful." if fwd_growth is not None
                     else "Needs NTM P/E and current/next-FY consensus EPS.")
    else:
        na.pop("peg", None)
    # Trailing multiples: SEC-reported TTM figures (same method as the 5Y history). Yahoo only as a fallback.
    from . import valuation  # local import: valuation depends on metrics

    sec = None
    try:
        mrq = inf.get("mostRecentQuarter")
        mrq_iso = dt.datetime.fromtimestamp(mrq, dt.UTC).date().isoformat() if isinstance(mrq, (int, float)) else None
        sec = valuation.current(ticker, price, market_cap=mcap, yahoo_debt=inf.get("totalDebt"), yahoo_latest_quarter=mrq_iso)
    except Exception:  # noqa: BLE001
        sec = None
    sec_stale = (sec or {}).get("stale")
    if sec_stale:
        sec = None
    if sec:
        for k_snap, k_sec, why in (("trailing_pe", "pe", "SEC TTM net income is negative or zero, so P/E isn't meaningful."),
                                   ("ev_ebitda", "ev_ebitda", "SEC TTM EBITDA (operating income + D&A) is negative or zero."),
                                   ("ev_sales", "ev_sales", "SEC TTM revenue unavailable."),
                                   ("fcf_yield", "fcf_yield", "SEC TTM free cash flow unavailable (capex or CFO not tagged).")):
            v = sec.get(k_sec)
            basis[k_snap] = "SEC TTM"
            if v is not None:
                na.pop(k_snap, None)
            else:
                na[k_snap] = why
            if k_snap == "trailing_pe":
                trailing_pe = v
            elif k_snap == "ev_ebitda":
                ev_ebitda = v
            elif k_snap == "ev_sales":
                ev_sales = v
            else:
                fcf_yield = v
        ev = sec["ev"] if sec.get("ev") is not None else ev
    else:
        why = f"Yahoo (SEC data stale: latest quarter {sec_stale})" if sec_stale else "Yahoo (no SEC XBRL)"
        for k in ("trailing_pe", "ev_ebitda", "ev_sales", "fcf_yield"):
            basis[k] = why
    # Near-zero earnings make P/E meaningless; show NM rather than e.g. 4,000x (same cap as the history)
    for k in ("trailing_pe", "forward_pe", "ntm_pe"):
        v = {"trailing_pe": trailing_pe, "forward_pe": forward_pe, "ntm_pe": ntm_pe}[k]
        if v is not None and v > valuation.NM_PE:
            na[k] = f"NM: {v:,.0f}x means earnings are near zero, so P/E isn't meaningful."
            if k == "trailing_pe":
                trailing_pe = None
            elif k == "forward_pe":
                forward_pe = None
            else:
                ntm_pe = None
    if ntm_pe is None:
        peg = None
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
        "forward_pe_nfy": forward_pe_nfy,
        "ntm_pe": ntm_pe,
        "fwd_eps_growth": fwd_growth,
        "basis": basis,
        "sec_ttm": (sec or {}).get("ttm"),
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
    snap.update(valuation.snapshot_extras(ticker, snap, na))

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
