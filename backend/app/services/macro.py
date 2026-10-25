"""Macro dashboard: key FRED series + each watchlist company's sensitivity to rates and indices."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from .. import db
from ..sources import fred
from . import prices, watchlists

# id, label, group, transform (level | yoy), unit
SERIES = [
    ("DFF", "Fed funds (effective)", "Rates", "level", "%"),
    ("DGS2", "2Y Treasury", "Rates", "level", "%"),
    ("DGS10", "10Y Treasury", "Rates", "level", "%"),
    ("T10Y2Y", "10Y-2Y spread", "Rates", "level", "pp"),
    ("DFII10", "10Y real yield (TIPS)", "Rates", "level", "%"),
    ("T5YIE", "5Y breakeven inflation", "Inflation", "level", "%"),
    ("CPIAUCSL", "CPI (YoY)", "Inflation", "yoy", "%"),
    ("CPILFESL", "Core CPI (YoY)", "Inflation", "yoy", "%"),
    ("PCEPILFE", "Core PCE (YoY)", "Inflation", "yoy", "%"),
    ("UNRATE", "Unemployment rate", "Labor", "level", "%"),
    ("PAYEMS", "Nonfarm payrolls (YoY)", "Labor", "yoy", "%"),
    ("ICSA", "Initial jobless claims", "Labor", "level", "k"),
    ("A191RL1Q225SBEA", "Real GDP growth (q/q SAAR)", "Growth", "level", "%"),
    ("CFNAI", "Chicago Fed activity index (ISM proxy)", "Growth", "level", "idx"),
    ("INDPRO", "Industrial production (YoY)", "Growth", "yoy", "%"),
    ("UMCSENT", "Consumer sentiment (UMich)", "Growth", "level", "idx"),
    ("RSAFS", "Retail sales (YoY)", "Growth", "yoy", "%"),
    ("BAMLH0A0HYM2", "High-yield credit spread", "Markets", "level", "%"),
    ("VIXCLS", "VIX", "Markets", "level", "idx"),
    ("DTWEXBGS", "Trade-weighted dollar", "Markets", "level", "idx"),
]
NOTES = {
    "CFNAI": "ISM Manufacturing PMI is proprietary and not on FRED; the Chicago Fed National Activity Index is a free substitute (0 = trend growth).",
}


def _load(sid: str, transform: str) -> pd.Series:
    def fetch():
        s = fred.series(sid, "1995-01-01")
        return {d.strftime("%Y-%m-%d"): v for d, v in s.items()}

    res = db.cached(f"fred:{sid}", db.DAY, fetch)
    raw = res["data"] or {}
    s = pd.Series(raw, dtype="float64")
    if s.empty:
        return s
    s.index = pd.to_datetime(s.index)
    s = s.sort_index()
    if transform == "yoy":
        # infer frequency: monthly/quarterly/weekly
        per_year = 12 if s.index.to_series().diff().median().days > 20 else 52
        if s.index.to_series().diff().median().days > 80:
            per_year = 4
        s = (s / s.shift(per_year) - 1) * 100
    if sid == "ICSA":
        s = s / 1000
    return s.dropna()


def dashboard(years: int = 10) -> dict:
    if not fred.available():
        return {"series": [], "needs_key": True,
                "source": "FRED API key missing. Add a free FRED_API_KEY to .env (fred.stlouisfed.org/docs/api/api_key.html)."}
    start = pd.Timestamp(dt.date.today() - dt.timedelta(days=365 * years))
    out = []
    for sid, label, group, transform, unit in SERIES:
        try:
            s = _load(sid, transform)
        except Exception as e:  # noqa: BLE001
            out.append({"id": sid, "label": label, "group": group, "unit": unit, "points": [], "error": str(e)[:200]})
            continue
        if s.empty:
            out.append({"id": sid, "label": label, "group": group, "unit": unit, "points": [],
                        "error": "FRED returned no data (or the download failed; retried tomorrow)."})
            continue
        s = s[s.index >= start]
        # Daily series are thinned to weekly to keep payloads small
        if len(s) > 1200:
            s = s.resample("W-FRI").last().dropna()
        last = s.iloc[-1] if not s.empty else None
        prev_year = s[s.index <= s.index[-1] - pd.Timedelta(days=365)] if not s.empty else s
        out.append({
            "id": sid, "label": label, "group": group, "unit": unit, "transform": transform,
            "last": None if last is None else float(last), "last_date": None if s.empty else s.index[-1].strftime("%Y-%m-%d"),
            "chg_1y": float(last - prev_year.iloc[-1]) if last is not None and not prev_year.empty else None,
            "points": [{"date": d.strftime("%Y-%m-%d"), "v": float(v)} for d, v in s.items()],
            "note": NOTES.get(sid), "source_url": f"https://fred.stlouisfed.org/series/{sid}",
        })
    return {"series": out, "source": "FRED API (St. Louis Fed)"}


def sensitivities(tickers: list[str], years: float = 3) -> dict:
    """Weekly-return betas/correlations vs SPY, QQQ, sector ETF and the 10Y yield."""
    start = (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()
    for t in tickers:
        prices.ensure(t)
    wide = prices.closes(list(set(tickers) | {"SPY", "QQQ", "XLK", "XLC", "SMH", "IGV", "IYZ"}), start)
    if wide.empty:
        return {"rows": [], "note": "No price history."}
    wk = wide.resample("W-FRI").last()
    rets = wk.pct_change().iloc[1:]
    dy = pd.Series(dtype="float64")
    if fred.available():
        try:
            y10 = _load("DGS10", "level")
            if not y10.empty:
                dy = y10[y10.index >= pd.Timestamp(start)].resample("W-FRI").last().diff() * 100  # bp change
        except Exception:  # noqa: BLE001
            pass
    rate_na = "Needs FRED_API_KEY (10Y yield series)" if not fred.available() else "10Y yield unavailable or too little overlapping data"
    from . import universe

    rows = []
    for t in tickers:
        if t not in rets:
            rows.append({"ticker": t, "na": {"_all": "No price history"}})
            continue
        r = rets[t]
        etf = prices.SUB_INDUSTRY_ETF.get((universe.get(t) or {}).get("sub_industry"), "XLK")

        def beta(x):
            d = pd.concat([r, x], axis=1).dropna()
            if len(d) < 26:
                return None, None
            c = np.cov(d.iloc[:, 0], d.iloc[:, 1])
            return float(c[0, 1] / c[1, 1]), float(np.corrcoef(d.iloc[:, 0], d.iloc[:, 1])[0, 1])

        b_spy, c_spy = beta(rets["SPY"])
        b_qqq, c_qqq = beta(rets["QQQ"])
        b_etf, c_etf = beta(rets[etf]) if etf in rets else (None, None)
        b_rate, c_rate = beta(dy) if not dy.empty else (None, None)
        rows.append({
            "ticker": t, "etf": etf, "n_weeks": int(r.notna().sum()),
            "beta_spy": b_spy, "corr_spy": c_spy, "beta_qqq": b_qqq, "corr_qqq": c_qqq,
            "beta_etf": b_etf, "corr_etf": c_etf,
            "rate_beta": b_rate * 10 if b_rate is not None else None,  # % stock move per +10bp in the 10Y
            "corr_10y": c_rate,
            "vol_ann": float(r.std() * np.sqrt(52)) if r.notna().sum() > 10 else None,
            "na": {"rate_beta": rate_na, "corr_10y": rate_na},
        })
    return {"rows": rows, "years": years,
            "method": "Weekly (Friday) returns. Beta = cov(stock, factor) / var(factor). Rate beta = the stock's % move "
                      "for a +10bp weekly change in the 10Y Treasury yield (negative = falls when yields rise)."}


def watchlist_sensitivities(name: str, years: float = 3) -> dict:
    return sensitivities(watchlists.all_lists().get(name, []), years)
