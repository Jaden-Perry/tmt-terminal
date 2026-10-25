"""Valuation multiples over time (from SEC financials + stored prices), own-history stats, peer medians, comps.

Methodology (shown in the UI):
  * Month-end points over up to 10 years. At each date we only use financials whose period ended
    at least 45 days earlier (approximates the 10-Q filing lag, so no look-ahead).
  * Market cap = month-end close x latest diluted weighted shares (split-adjusted).
  * EV = market cap + total debt - cash - short-term investments (latest balance sheet).
  * TTM = sum of the last four reported quarters.
  * P/E = market cap / TTM net income; EV/EBITDA uses EBITDA = operating income + D&A;
    FCF yield = TTM (CFO - capex) / market cap; PEG = P/E / (YoY TTM EPS growth in %).
  * Negative denominators are "NM" (not meaningful) and excluded from averages.
  * Historical consensus forward P/E isn't available free. As a proxy, "realized forward P/E" divides
    each month's market cap by the net income actually reported over the *next* 12 months
    (perfect-foresight forward P/E). It is compared with today's NTM consensus P/E, where NTM EPS
    time-weights the current- and next-fiscal-year consensus by how much of the current year remains.
"""
from __future__ import annotations

import datetime as dt
import statistics

import pandas as pd

from .. import db
from . import fundamentals, prices, universe

LAG_DAYS = 45
METRICS = ["pe", "fwd_pe_realized", "ev_ebitda", "ev_sales", "fcf_yield", "peg"]
LABELS = {"pe": "P/E (TTM)", "fwd_pe_realized": "Realized fwd P/E (next-12M actual earnings)", "ev_ebitda": "EV/EBITDA (TTM)", "ev_sales": "EV/Sales (TTM)",
          "fcf_yield": "FCF yield (TTM)", "peg": "PEG (TTM P/E / YoY EPS growth)"}


def _latest(quarters: list[dict], key: str, asof: str) -> float | None:
    for q in reversed(quarters):
        if q["end"] <= asof and q.get(key) is not None:
            return q[key]
    return None


def history(ticker: str, years: int = 10) -> dict:
    ticker = ticker.upper()
    fin = fundamentals.statements(ticker)["data"]
    if not fin or not fin.get("quarterly"):
        return {"ticker": ticker, "points": [], "note": "No quarterly financials available (SEC XBRL or Yahoo)."}
    qs = fin["quarterly"]
    px = prices.history(ticker)
    if px.empty:
        return {"ticker": ticker, "points": [], "note": "No stored price history."}
    month_end = px["close"].resample("ME").last().dropna()
    # The current (partial) month is labelled with its future month-end; use the actual last close date
    if not month_end.empty and month_end.index[-1] > px.index[-1]:
        month_end = month_end.rename(index={month_end.index[-1]: px.index[-1]})
    start = pd.Timestamp(dt.date.today() - dt.timedelta(days=365 * years))
    month_end = month_end[month_end.index >= start]

    points = []
    for d, price in month_end.items():
        asof = (d.date() - dt.timedelta(days=LAG_DAYS)).isoformat()
        shares = _latest(qs, "shares_diluted", asof) or _latest(qs, "shares_out", asof)
        if not shares:
            continue
        mcap = float(price) * shares
        ni = fundamentals.ttm(qs, "net_income", asof)
        rev = fundamentals.ttm(qs, "revenue", asof)
        ebitda = fundamentals.ttm(qs, "ebitda", asof)
        fcf = fundamentals.ttm(qs, "fcf", asof)
        debt = _latest(qs, "total_debt", asof) or 0.0
        cash = (_latest(qs, "cash", asof) or 0.0) + (_latest(qs, "st_investments", asof) or 0.0)
        ev = mcap + debt - cash
        year_ago = (d.date() - dt.timedelta(days=LAG_DAYS + 365)).isoformat()
        ni_prev = fundamentals.ttm(qs, "net_income", year_ago)
        sh_prev = _latest(qs, "shares_diluted", year_ago)
        eps, eps_prev = (ni / shares if ni is not None else None), (ni_prev / sh_prev if ni_prev is not None and sh_prev else None)
        pe = mcap / ni if ni and ni > 0 else None
        ahead = (d.date() - dt.timedelta(days=LAG_DAYS) + dt.timedelta(days=365)).isoformat()
        ni_fwd = fundamentals.ttm(qs, "net_income", ahead) if ahead <= qs[-1]["end"] else None
        growth = (eps / eps_prev - 1) if eps and eps_prev and eps_prev > 0 else None
        points.append({
            "date": d.strftime("%Y-%m-%d"),
            "price": float(price),
            "market_cap": mcap,
            "ev": ev,
            "pe": pe,
            "fwd_pe_realized": mcap / ni_fwd if ni_fwd and ni_fwd > 0 else None,
            "ev_ebitda": ev / ebitda if ebitda and ebitda > 0 else None,
            "ev_sales": ev / rev if rev and rev > 0 else None,
            "fcf_yield": fcf / mcap if fcf is not None and mcap else None,
            "peg": pe / (growth * 100) if pe and growth and growth > 0 else None,
            "eps_ttm": eps,
            "eps_growth": growth,
        })
    return {"ticker": ticker, "points": points, "source": fin.get("source")}


def _stats(vals: list[float]) -> dict | None:
    vals = [v for v in vals if v is not None]
    if len(vals) < 6:
        return None
    s = sorted(vals)
    return {"mean": statistics.fmean(vals), "median": statistics.median(vals), "min": s[0], "max": s[-1],
            "p25": s[len(s) // 4], "p75": s[(3 * len(s)) // 4], "n": len(vals)}


def summary(ticker: str, force: bool = False) -> dict:
    """Current vs 5Y stats for each multiple. Cached daily (prices move)."""
    def build():
        h = history(ticker, years=10)
        pts = h["points"]
        if not pts:
            return {"ticker": ticker, "note": h.get("note"), "metrics": {}}
        cutoff = (dt.date.today() - dt.timedelta(days=365 * 5)).isoformat()
        last = pts[-1]
        out = {}
        for m in METRICS:
            st = _stats([p[m] for p in pts if p["date"] >= cutoff])
            cur = last.get(m)
            pct = None
            if st and cur is not None:
                vals = sorted(p[m] for p in pts if p["date"] >= cutoff and p[m] is not None)
                pct = sum(1 for v in vals if v <= cur) / len(vals)
            out[m] = {"current": cur, "stats_5y": st, "percentile_5y": pct,
                      "vs_avg": (cur / st["mean"] - 1) if st and cur is not None and st["mean"] else None}
        # ROIC (TTM): NOPAT / (equity + debt - cash)
        fin = fundamentals.statements(ticker)["data"] or {}
        qs = fin.get("quarterly") or []
        roic = None
        if qs:
            oi = fundamentals.ttm(qs, "operating_income")
            pre, tax = fundamentals.ttm(qs, "pretax_income"), fundamentals.ttm(qs, "income_tax")
            rate = min(max(tax / pre, 0.0), 0.35) if pre and tax is not None and pre > 0 else 0.21
            eq = _latest(qs, "equity", "9999")
            debt = _latest(qs, "total_debt", "9999") or 0
            cash = (_latest(qs, "cash", "9999") or 0) + (_latest(qs, "st_investments", "9999") or 0)
            ic = (eq or 0) + debt - cash
            if oi is not None and eq is not None and ic > 0:
                roic = oi * (1 - rate) / ic
        return {"ticker": ticker, "as_of": last["date"], "metrics": out, "roic": roic, "source": h.get("source")}

    return db.cached(f"val:summary:{ticker.upper()}", db.DAY, build, force=force)["data"] or {"metrics": {}}


def snapshot_extras(ticker: str, snap: dict, na: dict) -> dict:
    """Fields merged into the metrics snapshot (screener uses these). Only reads caches; never fetches."""
    hit = db.cache_get(f"val:summary:{ticker}")
    if not hit:
        hit = db.cache_get(f"fin:{ticker}") and (summary(ticker), 0)
    s = hit[0] if hit else None
    out = {k: None for k in ("pe_5y_avg", "fwd_pe_5y_avg", "ev_ebitda_5y_avg", "ev_sales_5y_avg", "fcf_yield_5y_avg",
                             "pe_vs_5y", "ev_ebitda_vs_5y", "fwd_pe_vs_5y", "roic", "pe_pctile_5y", "ev_ebitda_pctile_5y")}
    if not s or not s.get("metrics"):
        reason = "5Y history not computed yet (needs SEC financials; filled by the nightly job or by opening the Valuation tab)."
        for k in out:
            na[k] = reason
        return out
    m = s["metrics"]

    def avg(k):
        st = (m.get(k) or {}).get("stats_5y")
        return st["mean"] if st else None

    out["pe_5y_avg"] = avg("pe")
    out["fwd_pe_5y_avg"] = avg("fwd_pe_realized")
    out["ev_ebitda_5y_avg"] = avg("ev_ebitda")
    out["ev_sales_5y_avg"] = avg("ev_sales")
    out["fcf_yield_5y_avg"] = avg("fcf_yield")
    out["pe_pctile_5y"] = (m.get("pe") or {}).get("percentile_5y")
    out["ev_ebitda_pctile_5y"] = (m.get("ev_ebitda") or {}).get("percentile_5y")
    out["pe_vs_5y"] = (m.get("pe") or {}).get("vs_avg")
    out["ev_ebitda_vs_5y"] = (m.get("ev_ebitda") or {}).get("vs_avg")
    # Today's NTM consensus P/E vs the 5Y average of realized NTM P/E (same 12-month horizon)
    if snap.get("ntm_pe") and out["fwd_pe_5y_avg"]:
        out["fwd_pe_vs_5y"] = snap["ntm_pe"] / out["fwd_pe_5y_avg"] - 1
    out["roic"] = s.get("roic")
    for k, v in out.items():
        if v is None:
            na[k] = "Not meaningful (negative earnings/EBITDA) or fewer than 6 monthly points in the last 5 years."
    return out


def peer_median_history(ticker: str, years: int = 10) -> dict:
    """Median of each multiple across peers that have cached SEC financials, month by month."""
    peers = universe.peers(ticker, limit=12)
    frames = []
    used = []
    for p in peers:
        if db.cache_get(f"fin:{p}") is None:
            continue  # don't trigger SEC fetches for every peer on page load
        pts = history(p, years)["points"]
        if pts:
            frames.append(pd.DataFrame(pts).set_index("date")[METRICS])
            used.append(p)
    if not frames:
        return {"peers": [], "points": [], "note": "No peers with SEC financials cached yet (nightly job fills these)."}
    allp = pd.concat(frames, keys=used)
    med = allp.groupby(level=1).median()
    return {"peers": used, "points": [{"date": d, **{m: (None if pd.isna(r[m]) else float(r[m])) for m in METRICS}} for d, r in med.iterrows()]}


def refresh_ticker(ticker: str) -> None:
    summary(ticker, force=True)
