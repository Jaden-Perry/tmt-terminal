"""Earnings dates and beat/miss history (yfinance; Finnhub surprises added when a key is set)."""
from __future__ import annotations

from .. import db
from ..sources import yf


def dates(ticker: str) -> list[dict]:
    res = db.cached(f"yf:earnings_dates:{ticker}", db.WEEK, lambda: yf.earnings_dates(ticker, 28))
    return res["data"] or []
