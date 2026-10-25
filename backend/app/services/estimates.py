"""Estimates & consensus: Yahoo (primary), Finnhub and FMP (fallback/supplement), all cached weekly."""
from __future__ import annotations

from .. import db
from ..sources import finnhub, fmp
from ..sources.optional import optional as _opt
from . import earnings, metrics

PERIOD_LABEL = {"0q": "Current Qtr", "+1q": "Next Qtr", "0y": "Current FY", "+1y": "Next FY"}


def get(ticker: str) -> dict:
    ticker = ticker.upper()
    an = metrics.analyst(ticker)["data"] or {}
    by = lambda rows: {r.get("period"): r for r in rows or []}  # noqa: E731
    ee, re_, tr, rv = by(an.get("earnings_estimate")), by(an.get("revenue_estimate")), by(an.get("eps_trend")), by(an.get("eps_revisions"))
    consensus = []
    for p in ("0q", "+1q", "0y", "+1y"):
        e, r = ee.get(p, {}), re_.get(p, {})
        consensus.append({
            "period": p, "label": PERIOD_LABEL[p],
            "eps_avg": e.get("avg"), "eps_low": e.get("low"), "eps_high": e.get("high"),
            "eps_analysts": e.get("numberOfAnalysts"), "eps_year_ago": e.get("yearAgoEps"), "eps_growth": e.get("growth"),
            "rev_avg": r.get("avg"), "rev_low": r.get("low"), "rev_high": r.get("high"),
            "rev_analysts": r.get("numberOfAnalysts"), "rev_year_ago": r.get("yearAgoRevenue"), "rev_growth": r.get("growth"),
        })
    trend = []
    for p in ("0q", "+1q", "0y", "+1y"):
        t, v = tr.get(p, {}), rv.get(p, {})
        trend.append({"period": p, "label": PERIOD_LABEL[p], "current": t.get("current"), "d7": t.get("7daysAgo"),
                      "d30": t.get("30daysAgo"), "d60": t.get("60daysAgo"), "d90": t.get("90daysAgo"),
                      "up7": v.get("upLast7days"), "up30": v.get("upLast30days"),
                      "down7": v.get("downLast7Days") if v.get("downLast7Days") is not None else v.get("downLast7days"),
                      "down30": v.get("downLast30days")})

    # Beat/miss history: Yahoo earnings calendar gives ~6 years of estimate vs actual
    surprises = []
    for r in earnings.dates(ticker):
        if r.get("Reported EPS") is None:
            continue
        surprises.append({"date": (r.get("date") or "")[:10], "estimate": r.get("EPS Estimate"), "actual": r.get("Reported EPS"),
                          "surprise_pct": (r["Surprise(%)"] / 100) if r.get("Surprise(%)") is not None else None, "source": "Yahoo"})
    upcoming = [r for r in earnings.dates(ticker) if r.get("Reported EPS") is None]
    next_earn = min((r["date"][:10] for r in upcoming if r.get("date")), default=None)

    fh_sur = _opt(f"fh:earnings:{ticker}", lambda: finnhub.earnings_surprises(ticker))
    if not surprises and fh_sur["data"]:
        for r in fh_sur["data"]:
            surprises.append({"date": r.get("period"), "estimate": r.get("estimate"), "actual": r.get("actual"),
                              "surprise_pct": (r.get("surprisePercent") or 0) / 100 if r.get("surprisePercent") is not None else None,
                              "source": "Finnhub"})

    pt = an.get("price_targets") or {}
    pt_source = "Yahoo" if pt.get("mean") else None
    fmp_pt = None
    if not pt.get("mean") and fmp.available():
        fmp_pt = _opt(f"fmp:pt:{ticker}", lambda: fmp.price_target_consensus(ticker))
        d = (fmp_pt["data"] or [None])[0] if isinstance(fmp_pt["data"], list) else fmp_pt["data"]
        if d:
            pt = {"current": None, "high": d.get("targetHigh"), "low": d.get("targetLow"), "mean": d.get("targetConsensus"),
                  "median": d.get("targetMedian")}
            pt_source = "FMP"

    recs = an.get("recommendations") or []
    rec_source = "Yahoo" if recs else None
    fh_rec = None
    if not recs:
        fh_rec = _opt(f"fh:rec:{ticker}", lambda: finnhub.recommendation_trends(ticker))
        if fh_rec["data"]:
            recs = [{"period": r.get("period"), "strongBuy": r.get("strongBuy"), "buy": r.get("buy"), "hold": r.get("hold"),
                     "sell": r.get("sell"), "strongSell": r.get("strongSell")} for r in fh_rec["data"][:6]]
            rec_source = "Finnhub"

    # FMP annual estimates go further out (FY+2..) when available on the free tier
    fmp_est = _opt(f"fmp:est:{ticker}", lambda: fmp.analyst_estimates(ticker)) if fmp.available() else {"data": None, "status": "No FMP key (or daily budget used)"}

    gaps = []
    if not any(c["eps_avg"] for c in consensus):
        gaps.append("No consensus EPS estimates on Yahoo for this ticker (thin coverage).")
    if not pt.get("mean"):
        gaps.append("No price targets from Yahoo" + (" or FMP." if fmp.available() else ". Add an FMP key for a fallback."))
    gaps.append("Estimate revision history beyond 90 days isn't free; trend shows the current vs 7/30/60/90-day-ago consensus.")
    return {
        "ticker": ticker,
        "consensus": consensus,
        "trend": trend,
        "surprises": surprises,
        "next_earnings": next_earn,
        "price_targets": {**pt, "source": pt_source},
        "recommendations": recs,
        "recommendations_source": rec_source,
        "upgrades_downgrades": an.get("upgrades_downgrades") or [],
        "fmp_estimates": fmp_est["data"] if isinstance(fmp_est["data"], list) else None,
        "sources": {"finnhub_surprises": fh_sur["status"], "fmp_estimates": fmp_est["status"],
                    "finnhub_recs": fh_rec["status"] if fh_rec else "not needed", "fmp_price_target": fmp_pt["status"] if fmp_pt else "not needed"},
        "gaps": gaps,
        "as_of": metrics.analyst(ticker).get("fetched_at"),
    }
