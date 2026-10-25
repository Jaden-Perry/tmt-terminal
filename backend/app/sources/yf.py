"""yfinance wrapper: throttled, defensive, returns plain JSON-able structures."""
from __future__ import annotations

import logging
import math
import time
import warnings

import pandas as pd
import yfinance as yf

from .. import ratelimit

logging.getLogger("yfinance").setLevel(logging.CRITICAL)
warnings.filterwarnings("ignore", module=r"yfinance(\..*)?")

INFO_FIELDS = [
    "longName", "shortName", "longBusinessSummary", "sector", "industry", "website", "country",
    "fullTimeEmployees", "currency", "exchange", "quoteType",
    "currentPrice", "regularMarketPrice", "previousClose", "marketCap", "enterpriseValue",
    "sharesOutstanding", "floatShares", "beta",
    "trailingPE", "forwardPE", "trailingEps", "forwardEps", "pegRatio", "trailingPegRatio",
    "priceToSalesTrailing12Months", "priceToBook", "enterpriseToRevenue", "enterpriseToEbitda",
    "totalRevenue", "revenueGrowth", "earningsGrowth", "earningsQuarterlyGrowth",
    "grossMargins", "operatingMargins", "ebitdaMargins", "profitMargins",
    "returnOnEquity", "returnOnAssets", "ebitda", "freeCashflow", "operatingCashflow",
    "totalCash", "totalDebt", "netIncomeToCommon",
    "dividendYield", "payoutRatio",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage",
    "recommendationKey", "recommendationMean", "numberOfAnalystOpinions",
    "targetMeanPrice", "targetMedianPrice", "targetHighPrice", "targetLowPrice",
    "earningsTimestamp", "earningsTimestampStart", "mostRecentQuarter", "lastFiscalYearEnd",
]


def _retry(fn, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            ratelimit.wait("yahoo")
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            msg = str(e).lower()
            if "rate" in msg or "too many" in msg or "429" in msg:
                time.sleep(20 * (i + 1))
            else:
                time.sleep(2 * (i + 1))
    raise last  # type: ignore[misc]


def df_records(df: pd.DataFrame | None, index_name: str = "index") -> list[dict]:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    out = df.reset_index()
    out.columns = [index_name if i == 0 else str(c) for i, c in enumerate(out.columns)]
    recs = out.to_dict(orient="records")
    for r in recs:
        for k, v in list(r.items()):
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                r[k] = None
            elif isinstance(v, pd.Timestamp):
                r[k] = v.isoformat()
    return recs


def info(ticker: str) -> dict | None:
    raw = _retry(lambda: yf.Ticker(ticker).info)
    if not raw or (raw.get("quoteType") is None and raw.get("regularMarketPrice") is None):
        return None
    return {k: raw.get(k) for k in INFO_FIELDS}


def analyst(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    out: dict = {}
    for name, getter in [
        ("eps_trend", lambda: t.eps_trend),
        ("eps_revisions", lambda: t.eps_revisions),
        ("earnings_estimate", lambda: t.earnings_estimate),
        ("revenue_estimate", lambda: t.revenue_estimate),
        ("growth_estimates", lambda: t.growth_estimates),
        ("earnings_history", lambda: t.earnings_history),
        ("recommendations", lambda: t.recommendations),
    ]:
        try:
            out[name] = df_records(_retry(getter, tries=2), "period")
        except Exception:  # noqa: BLE001
            out[name] = []
    try:
        out["price_targets"] = _retry(lambda: t.analyst_price_targets, tries=2) or {}
    except Exception:  # noqa: BLE001
        out["price_targets"] = {}
    try:
        ud = _retry(lambda: t.upgrades_downgrades, tries=2)
        out["upgrades_downgrades"] = df_records(ud.head(60) if ud is not None else None, "date")
    except Exception:  # noqa: BLE001
        out["upgrades_downgrades"] = []
    return out


def earnings_dates(ticker: str, limit: int = 24) -> list[dict]:
    df = _retry(lambda: yf.Ticker(ticker).get_earnings_dates(limit=limit), tries=2)
    return df_records(df, "date")


def statements(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    out = {}
    for name, getter in [
        ("income_annual", lambda: t.income_stmt),
        ("income_quarterly", lambda: t.quarterly_income_stmt),
        ("balance_annual", lambda: t.balance_sheet),
        ("balance_quarterly", lambda: t.quarterly_balance_sheet),
        ("cashflow_annual", lambda: t.cashflow),
        ("cashflow_quarterly", lambda: t.quarterly_cashflow),
    ]:
        try:
            df = _retry(getter, tries=2)
            out[name] = {} if df is None or df.empty else {
                str(col.date()): {str(k): (None if pd.isna(v) else float(v)) for k, v in df[col].items()}
                for col in df.columns
            }
        except Exception:  # noqa: BLE001
            out[name] = {}
    return out


def news(ticker: str) -> list[dict]:
    items = _retry(lambda: yf.Ticker(ticker).news, tries=2) or []
    out = []
    for it in items:
        c = it.get("content", it)
        url = (c.get("canonicalUrl") or {}).get("url") or c.get("link")
        out.append({
            "headline": c.get("title"),
            "summary": c.get("summary") or c.get("description"),
            "source": (c.get("provider") or {}).get("displayName") or c.get("publisher"),
            "url": url,
            "datetime": c.get("pubDate") or c.get("providerPublishTime"),
        })
    return [o for o in out if o["headline"] and o["url"]]


def download(tickers: list[str], period: str) -> pd.DataFrame:
    """Batch OHLCV download. Returns a long frame: ticker, date, open, high, low, close, adj_close, volume."""
    ratelimit.wait("yahoo")
    df = yf.download(tickers, period=period, interval="1d", auto_adjust=False, group_by="ticker",
                     threads=True, progress=False, repair=False)
    if df is None or df.empty:
        return pd.DataFrame()
    frames = []
    if isinstance(df.columns, pd.MultiIndex):
        for sym in df.columns.get_level_values(0).unique():
            sub = df[sym].dropna(how="all")
            if sub.empty:
                continue
            sub = sub.assign(ticker=sym)
            frames.append(sub)
    else:
        frames.append(df.assign(ticker=tickers[0]))
    long = pd.concat(frames)
    long = long.reset_index().rename(columns={
        "Date": "date", "Open": "open", "High": "high", "Low": "low", "Close": "close",
        "Adj Close": "adj_close", "Volume": "volume",
    })
    long["date"] = pd.to_datetime(long["date"]).dt.strftime("%Y-%m-%d")
    if "adj_close" not in long:
        long["adj_close"] = long["close"]
    return long[["ticker", "date", "open", "high", "low", "close", "adj_close", "volume"]].dropna(subset=["close"])
