"""Significant-move detection: daily >2σ or >5%, big weekly/monthly moves, and moves relative to the sector ETF."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import prices, universe

DAILY_SIGMA = 2.0
DAILY_ABS = 0.05
WEEKLY_ABS = 0.10
MONTHLY_ABS = 0.20
REL_SIGMA = 2.0


def detect(ticker: str, start: str | None = None) -> list[dict]:
    ticker = ticker.upper()
    etf = prices.SUB_INDUSTRY_ETF.get((universe.get(ticker) or {}).get("sub_industry"), "XLK")
    wide = prices.closes([ticker, etf])
    if wide.empty or ticker not in wide:
        return []
    px = wide[ticker].dropna()
    r = px.pct_change()
    # Rolling 1Y volatility, lagged so a move doesn't inflate its own threshold
    vol = r.rolling(252, min_periods=60).std().shift(1)
    rel = None
    if etf in wide and etf != ticker:
        er = wide[etf].reindex(px.index).pct_change()
        rel = r - er
        rel_vol = rel.rolling(252, min_periods=60).std().shift(1)
    out: list[dict] = []
    for d, v in r.items():
        if pd.isna(v):
            continue
        z = v / vol[d] if not pd.isna(vol[d]) and vol[d] else None
        reasons = []
        if abs(v) >= DAILY_ABS:
            reasons.append(f"{v:+.1%} day (>5%)")
        if z is not None and abs(z) >= DAILY_SIGMA:
            reasons.append(f"{z:+.1f}σ daily move")
        relv = None
        if rel is not None and not pd.isna(rel[d]):
            relv = float(rel[d])
            rz = relv / rel_vol[d] if not pd.isna(rel_vol[d]) and rel_vol[d] else None
            if rz is not None and abs(rz) >= REL_SIGMA and abs(relv) >= 0.03:
                reasons.append(f"{relv:+.1%} vs {etf} ({rz:+.1f}σ)")
        if reasons:
            out.append({"date": d.strftime("%Y-%m-%d"), "window": "1D", "start": d.strftime("%Y-%m-%d"), "end": d.strftime("%Y-%m-%d"),
                        "ret": float(v), "z": None if z is None else float(z), "rel_ret": relv, "etf": etf, "reasons": reasons})
    # Weekly / monthly: non-overlapping calendar windows
    for window, rule, thresh in (("1W", "W-FRI", WEEKLY_ABS), ("1M", "ME", MONTHLY_ABS)):
        res = px.resample(rule).last().dropna()
        rr = res.pct_change()
        for d, v in rr.items():
            if pd.isna(v) or abs(v) < thresh:
                continue
            prev = res.index[res.index.get_loc(d) - 1]
            out.append({"date": d.strftime("%Y-%m-%d"), "window": window, "start": (prev + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                        "end": d.strftime("%Y-%m-%d"), "ret": float(v), "z": None, "rel_ret": None, "etf": etf,
                        "reasons": [f"{v:+.1%} {'week' if window == '1W' else 'month'} (>{thresh:.0%})"]})
    if start:
        out = [m for m in out if m["end"] >= start]
    out.sort(key=lambda m: m["end"], reverse=True)
    return out


def summary_stats(ticker: str) -> dict:
    px = prices.closes([ticker])
    if px.empty:
        return {}
    r = px[ticker].dropna().pct_change().dropna()
    return {"daily_vol_1y": float(r.tail(252).std()) if len(r) > 20 else None,
            "ann_vol_1y": float(r.tail(252).std() * np.sqrt(252)) if len(r) > 20 else None}
