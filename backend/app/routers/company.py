"""Company endpoints: snapshot, prices, financials, valuation, estimates, moves, news, filings, KPIs, alt data."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db
from ..services import (ai, earnings, estimates, filings, fundamentals, metrics, moves, news, prices, universe,
                        valuation, xbrl_detail)

router = APIRouter(prefix="/api/company")


@router.get("/{ticker}/snapshot")
def snapshot(ticker: str, refresh: bool = False):
    ticker = ticker.upper()
    prices.ensure(ticker)
    if refresh:
        return metrics.build(ticker, force_info=True)
    return metrics.get(ticker)


@router.get("/{ticker}/prices")
def price_history(ticker: str, years: float = 5):
    ticker = ticker.upper()
    prices.ensure(ticker)
    start = (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()
    df = prices.history(ticker, start)
    if df.empty:
        return {"ticker": ticker, "bars": [], "note": "No price history available from Yahoo Finance."}
    bars = [
        {"time": d.strftime("%Y-%m-%d"), "open": r.open, "high": r.high, "low": r.low,
         "close": r.close, "adj_close": r.adj_close, "volume": r.volume}
        for d, r in df.iterrows()
    ]
    return {"ticker": ticker, "bars": bars, "universe": universe.get(ticker)}


@router.get("/{ticker}/compare")
def compare(ticker: str, symbols: str = "", years: float = 1):
    """Rebased % performance of the ticker vs sector ETFs / peers."""
    ticker = ticker.upper()
    syms = [ticker] + [s.strip().upper() for s in symbols.split(",") if s.strip() and s.strip().upper() != ticker]
    for s in syms:
        prices.ensure(s)
    start = (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()
    wide = prices.closes(syms, start)
    out = []
    for s in syms:
        if wide.empty or s not in wide:
            out.append({"name": s, "points": [], "note": "No price history"})
            continue
        col = wide[s].dropna()
        base = col.iloc[0] if not col.empty else None
        out.append({"name": s, "points": [{"time": d.strftime("%Y-%m-%d"), "value": float((v / base - 1) * 100)} for d, v in col.items()] if base else []})
    return {"series": out, "benchmarks": prices.BENCHMARKS,
            "default_etf": prices.SUB_INDUSTRY_ETF.get((universe.get(ticker) or {}).get("sub_industry"), "XLK")}


@router.get("/{ticker}/profile")
def profile(ticker: str):
    ticker = ticker.upper()
    res = metrics.info(ticker)
    inf = res["data"] or {}
    return {
        "ticker": ticker,
        "universe": universe.get(ticker),
        "peers": universe.peers(ticker),
        "profile": {k: inf.get(k) for k in ("longName", "longBusinessSummary", "sector", "industry", "website",
                                            "country", "fullTimeEmployees", "exchange", "currency")},
        "fetched_at": res.get("fetched_at"),
        "stale": res.get("stale"),
    }


@router.get("/{ticker}/peers")
def peer_table(ticker: str):
    ticker = ticker.upper()
    syms = universe.peers(ticker)
    have = {m["ticker"]: m for m in metrics.stored(syms)}
    rows = []
    for s in [ticker] + syms:
        if s in have and s != ticker:
            rows.append(have[s])
        else:
            try:
                rows.append(metrics.get(s, include_analyst=s == ticker))
            except Exception as e:  # noqa: BLE001
                rows.append({"ticker": s, "na": {"_all": str(e)}})
    return {"ticker": ticker, "rows": rows}


@router.get("/{ticker}/events")
def events(ticker: str, years: float = 1):
    """Chart markers: earnings dates, significant moves (and M&A filings once available)."""
    ticker = ticker.upper()
    start = (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()
    markers = []
    for m in moves.detect(ticker, start):
        if m["window"] == "1D":
            markers.append({"time": m["date"], "kind": "up" if m["ret"] > 0 else "down", "text": f"{m['ret']:+.1%}"})
    for e in earnings.dates(ticker):
        d = (e.get("date") or "")[:10]
        if d >= start and d <= dt.date.today().isoformat():
            markers.append({"time": _trading_day(ticker, d), "kind": "earnings", "text": "E"})
    for hook in EVENT_HOOKS:
        markers += hook(ticker, start)
    return {"markers": [m for m in markers if m["time"]]}


def _ma_filing_markers(ticker: str, start: str) -> list[dict]:
    try:
        fl = filings.recent(ticker, ttl=db.DAY)["filings"]
    except Exception:  # noqa: BLE001
        return []
    return [{"time": _trading_day(ticker, f["filed"]), "kind": "deal", "text": f["form"]} for f in fl if f["is_ma"] and f["filed"] >= start]


EVENT_HOOKS: list = [_ma_filing_markers]


def _trading_day(ticker: str, d: str) -> str | None:
    """Snap a calendar date onto the next stored trading day so the chart can place a marker."""
    df = prices.history(ticker, d)
    return df.index[0].strftime("%Y-%m-%d") if not df.empty else None


@router.get("/{ticker}/financials")
def financials(ticker: str, statement: str = "income", freq: str = "annual"):
    ticker = ticker.upper()
    res = fundamentals.statements(ticker)
    data = res["data"]
    if not data:
        return {"ticker": ticker, "periods": [], "rows": [], "note": res.get("error") or "No financial statements available from SEC XBRL or Yahoo."}
    if statement not in fundamentals.STATEMENT_ORDER or freq not in ("annual", "quarterly"):
        raise HTTPException(400, "statement must be income|balance|cashflow; freq annual|quarterly")
    t = fundamentals.table(data, statement, freq)
    notes = []
    if freq == "quarterly":
        notes.append("Fiscal Q4 values are derived as full year minus the first three quarters (10-Ks don't report Q4 alone).")
        if statement == "cashflow":
            notes.append("10-Q cash flows are year-to-date; quarterly values are differenced from the YTD totals.")
    if data.get("splits"):
        notes.append("Per-share and share counts are adjusted for stock splits.")
    return {"ticker": ticker, "source": data.get("source"), "entity": data.get("entity"), "fetched_at": res.get("fetched_at"),
            "stale": res.get("stale"), "notes": notes, **t}


@router.get("/{ticker}/financials/series")
def financial_series(ticker: str, freq: str = "annual"):
    """Compact series for the charts (revenue, EPS, FCF, margins)."""
    data = fundamentals.statements(ticker.upper())["data"] or {}
    keys = ["revenue", "eps_diluted", "fcf", "net_income", "gross_margin", "operating_margin", "net_margin", "fcf_margin", "ebitda"]
    return {"points": [{"label": p["label"], "end": p["end"], **{k: p.get(k) for k in keys}} for p in data.get(freq, [])],
            "source": data.get("source")}


@router.get("/{ticker}/valuation")
def valuation_view(ticker: str, years: int = 10):
    ticker = ticker.upper()
    prices.ensure(ticker)
    h = valuation.history(ticker, years)
    return {"ticker": ticker, "history": h["points"], "note": h.get("note"), "source": h.get("source"),
            "summary": valuation.summary(ticker), "peer_median": valuation.peer_median_history(ticker, years),
            "methodology": valuation.__doc__}


@router.get("/{ticker}/estimates")
def estimates_view(ticker: str):
    return estimates.get(ticker.upper())


@router.get("/{ticker}/segments")
def segments_view(ticker: str):
    res = xbrl_detail.segments(ticker.upper())
    return {**(res["data"] or {"breakdowns": {}, "note": res.get("error") or "Unavailable"}), "fetched_at": res.get("fetched_at")}


@router.get("/{ticker}/moves")
def moves_list(ticker: str, years: float = 2):
    ticker = ticker.upper()
    prices.ensure(ticker)
    start = (dt.date.today() - dt.timedelta(days=int(365 * years))).isoformat()
    return {"ticker": ticker, "moves": moves.detect(ticker, start), "latest": moves.latest(ticker), "stats": moves.summary_stats(ticker),
            "rules": {"daily_abs": moves.DAILY_ABS, "daily_sigma": moves.DAILY_SIGMA, "weekly_abs": moves.WEEKLY_ABS,
                      "monthly_abs": moves.MONTHLY_ABS, "relative_sigma": moves.REL_SIGMA}}


def _move_key(ticker: str, start: str, end: str) -> str:
    return f"move:{ticker}:{start}:{end}"


@router.get("/{ticker}/moves/timeline")
def move_timeline(ticker: str, start: str, end: str):
    ticker = ticker.upper()
    t = moves.timeline(ticker, start, end)
    return {**t, "ai": ai.cached(_move_key(ticker, start, end)), "ai_enabled": ai.month_spend()["enabled"]}


class ExplainReq(BaseModel):
    start: str
    end: str
    label: str


@router.post("/{ticker}/moves/explain")
def move_explain(ticker: str, req: ExplainReq):
    ticker = ticker.upper()
    t = moves.timeline(ticker, req.start, req.end)
    sources = [{"date": e["date"], "kind": e["kind"], "text": e["text"][:300], "url": e.get("url")} for e in t["events"]][:40]
    return ai.explain(_move_key(ticker, req.start, req.end), ticker, {"label": req.label}, sources)


@router.get("/{ticker}/news")
def company_news(ticker: str, days: int = 90):
    ticker = ticker.upper()
    status = news.refresh_company(ticker)
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    return {"ticker": ticker, "items": news.query(tickers=[ticker], since=since), "status": status}


@router.get("/{ticker}/filings")
def company_filings(ticker: str):
    return filings.recent(ticker.upper())


def _ttm(qs: list[dict], i: int, k: str) -> float | None:
    """Sum of the 4 quarters ending at index i (None unless all 4 exist and are ~1 year apart)."""
    if i < 3:
        return None
    w = qs[i - 3:i + 1]
    if (dt.date.fromisoformat(w[-1]["end"]) - dt.date.fromisoformat(w[0]["end"])).days > 300:
        return None
    vals = [q.get(k) for q in w]
    return sum(vals) if all(v is not None for v in vals) else None


@router.get("/{ticker}/kpis")
def kpi_view(ticker: str):
    """Operating KPIs: sector-specific XBRL charts, segment table, company-reported release metrics, custom tags."""
    from ..services import releases

    ticker = ticker.upper()
    fin = fundamentals.statements(ticker)["data"] or {}
    qs = fin.get("quarterly") or []
    series = []
    by_end = {q["end"]: q for q in qs}
    for i, q in enumerate(qs):
        prev = by_end.get(next((e for e in by_end if 350 <= (dt.date.fromisoformat(q["end"]) - dt.date.fromisoformat(e)).days <= 380), ""), {})
        rev = q.get("revenue")
        g = lambda k: q.get(k)  # noqa: E731
        rev_ttm, fcf_ttm, ebitda_ttm = _ttm(qs, i, "revenue"), _ttm(qs, i, "fcf"), _ttm(qs, i, "ebitda")
        capex_ttm, bb_ttm = _ttm(qs, i, "capex"), _ttm(qs, i, "buybacks")
        row = {"end": q["end"], "label": q.get("label"),
               "rev_yoy": (rev / prev["revenue"] - 1) if rev and prev.get("revenue") else None,
               "rpo": g("rpo"), "rpo_yoy": (g("rpo") / prev["rpo"] - 1) if g("rpo") and prev.get("rpo") else None,
               "deferred_rev": g("deferred_rev_total"),
               "capex_pct": abs(g("capex")) / rev if g("capex") is not None and rev else None,
               "capex_ttm": abs(capex_ttm) if capex_ttm is not None else None,
               "rnd_pct": g("rnd") / rev if g("rnd") is not None and rev else None,
               "sbc_pct": g("sbc") / rev if g("sbc") is not None and rev else None,
               "dso": g("receivables") / rev * 91 if g("receivables") and rev else None,
               "inventory_days": g("inventory") / g("cogs") * 91 if g("inventory") and g("cogs") else None,
               "shares_diluted": g("shares_diluted"),
               "gross_margin": g("gross_margin"), "operating_margin": g("operating_margin"),
               "ebitda_margin": g("ebitda") / rev if g("ebitda") is not None and rev else None,
               "fcf_ttm": fcf_ttm,
               "fcf_margin_ttm": fcf_ttm / rev_ttm if fcf_ttm is not None and rev_ttm else None,
               "buybacks_ttm": abs(bb_ttm) if bb_ttm is not None else None,
               "net_debt_ebitda": g("net_debt") / ebitda_ttm if g("net_debt") is not None and ebitda_ttm and ebitda_ttm > 0 else None}
        series.append(row)
    series = series[-24:]
    available = [k for k in series[0].keys() if k not in ("end", "label") and any(r[k] is not None for r in series)] if series else []

    cfg = releases.config()
    comp = (cfg.get("companies") or {}).get(ticker) or {}
    u = universe.get(ticker) or {}
    profile_name = comp.get("profile") or u.get("sub_industry") or "Default"
    profile = (cfg.get("profiles") or {}).get(profile_name) or cfg["profiles"]["Default"]
    charts = comp.get("charts") or profile["charts"]
    missing = {k: "Not tagged in this company's SEC XBRL (or not meaningful for it)." for k in charts if k not in available}
    # Same test as the RV tab: if SEC debt is far below Yahoo's, the debt isn't tagged and leverage would be wrong
    info = (db.cache_get(f"yf:info:{ticker}") or [{}])[0] or {}
    ydebt, sdebt = info.get("totalDebt"), (qs[-1].get("total_debt") if qs else None)
    if "net_debt_ebitda" in available and ydebt and ydebt > 1e9 and (sdebt is None or (sdebt < 0.25 * ydebt and ydebt - sdebt > 2e9)):
        available.remove("net_debt_ebitda")
        missing["net_debt_ebitda"] = (f"This company's debt isn't fully tagged in SEC XBRL (SEC shows {sdebt / 1e9 if sdebt else 0:.1f}B vs "
                                      f"Yahoo {ydebt / 1e9:.1f}B), so a leverage history would be wrong. Current EV on the RV tab uses Yahoo's debt.")

    try:
        reported = releases.kpis(ticker, [q["end"] for q in qs])
        reported_error = None
    except Exception as e:  # noqa: BLE001
        reported, reported_error = None, f"Couldn't read the earnings releases: {e}"
    res = xbrl_detail.kpis(ticker)
    gaps = ["Gross bookings, users/subscribers, ARPU, churn, net revenue retention and similar operating KPIs are disclosed "
            "only in earnings releases, slides or MD&A text, not XBRL. They're shown above only for companies set up in "
            "config/kpis.yaml (each company formats its release differently)." if not reported else
            "Release metrics are read from each quarter's press release tables; if a company changes its table layout, "
            "that quarter shows N/A rather than a wrong number. Verify against the linked release before relying on one.",
            "Segment data is shown only where the company tags it in XBRL, for the latest quarter vs the year-ago quarter."]
    return {"ticker": ticker, "series": series, "available": available,
            "profile": {"name": profile_name, "focus": comp.get("focus") or profile.get("focus"), "charts": charts,
                        "company_specific": bool(comp.get("charts") or comp.get("focus")),
                        "segment_axis": comp.get("segment_axis")},
            "missing": missing, "reported": reported, "reported_error": reported_error,
            "xbrl": res["data"] or {"note": res.get("error")}, "gaps": gaps}


@router.get("/{ticker}/altdata")
def altdata_view(ticker: str):
    from .. import altdata

    ticker = ticker.upper()
    name = news.short_name(ticker) or ticker
    px = prices.history(ticker, (dt.date.today() - dt.timedelta(days=5 * 365)).isoformat())
    return {"ticker": ticker, "company_query": name, "sources": altdata.fetch(ticker, name),
            "price": [{"date": d.strftime("%Y-%m-%d"), "close": float(r.adj_close)} for d, r in px.iterrows()]}
