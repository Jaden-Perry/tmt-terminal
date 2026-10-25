"""Screener data: every universe snapshot + peer-relative discounts + a transparent composite value score.

Filtering and presets run in the browser (the universe is ~200-250 rows), so slider changes are instant.
"""
from __future__ import annotations

import statistics

from . import metrics, universe

# Factor -> list of (field, higher_is_better). Percentile ranks are computed across the universe.
FACTORS: dict[str, dict] = {
    "Value": {"weight": 0.40, "fields": [
        ("forward_pe", False), ("ev_ebitda", False), ("ev_sales", False), ("fcf_yield", True),
        ("disc_fwd_pe", False), ("disc_ev_ebitda", False), ("ev_ebitda_vs_5y", False), ("fwd_pe_vs_5y", False)]},
    "Quality": {"weight": 0.20, "fields": [("gross_margin", True), ("operating_margin", True), ("roic", True)]},
    "Growth": {"weight": 0.20, "fields": [("revenue_growth", True), ("earnings_growth", True)]},
    "Revisions & Momentum": {"weight": 0.20, "fields": [("eps_trend_90d", True), ("net_revisions_30d", True), ("chg_3m", True)]},
}

METHODOLOGY = """Composite value score (0-100, higher = more attractive):
  1. For each field below, rank every company in the TMT universe by percentile (0-100).
     Fields where lower is better (multiples, premiums) are inverted, so cheap = high.
  2. A factor score is the average of the available field percentiles (missing fields are skipped).
  3. The composite is the weighted average of the factor scores that exist:
       Value 40%   - forward P/E, EV/EBITDA, EV/Sales, FCF yield, discount to sub-industry median
                     (forward P/E, EV/EBITDA), EV/EBITDA vs own 5Y average, consensus forward P/E vs own 5Y average
                     realized forward P/E (price / next-12-month reported earnings)
       Quality 20% - gross margin, operating margin, ROIC (TTM, SEC)
       Growth 20%  - revenue growth (latest quarter YoY), earnings growth (latest quarter YoY)
       Revisions & momentum 20% - 90-day change in current-FY consensus EPS, net up-minus-down
                     revisions over 30 days, 3-month price change
  4. Negative or not-meaningful multiples are treated as missing, not as cheap.
  Coverage shows how many of the 16 inputs were available. Treat scores with low coverage with caution.
This is a screening heuristic to find names worth researching, not a recommendation."""


def _median(xs):
    v = [x for x in xs if isinstance(x, (int, float))]
    return statistics.median(v) if v else None


def _pct_ranks(rows: list[dict], field: str, higher_better: bool) -> dict[str, float]:
    vals = [(r["ticker"], r.get(field)) for r in rows if isinstance(r.get(field), (int, float))]
    if len(vals) < 5:
        return {}
    vals.sort(key=lambda x: x[1], reverse=not higher_better)
    n = len(vals)
    return {t: 100.0 * i / (n - 1) for i, (t, _) in enumerate(vals)}


def run() -> dict:
    uni = {r["ticker"]: r for r in universe.all_rows()}
    rows = [m for m in metrics.stored(list(uni)) if m.get("ticker") in uni]
    for r in rows:
        r["sub_industry"] = uni[r["ticker"]]["sub_industry"]
        up, dn = r.get("rev_up_30d"), r.get("rev_down_30d")
        r["net_revisions_30d"] = (up - dn) if isinstance(up, (int, float)) and isinstance(dn, (int, float)) else None

    # Peer-relative discounts: company multiple / sub-industry median - 1
    medians: dict[str, dict] = {}
    by_sub: dict[str, list[dict]] = {}
    for r in rows:
        by_sub.setdefault(r["sub_industry"], []).append(r)
    for sub, rs in by_sub.items():
        medians[sub] = {k: _median([x.get(k) for x in rs]) for k in ("forward_pe", "trailing_pe", "ev_ebitda", "ev_sales", "fcf_yield", "revenue_growth", "operating_margin")}
        medians[sub]["count"] = len(rs)
    for r in rows:
        med = medians[r["sub_industry"]]
        na = r.setdefault("na", {})
        for k, out in (("forward_pe", "disc_fwd_pe"), ("ev_ebitda", "disc_ev_ebitda"), ("ev_sales", "disc_ev_sales")):
            v, m = r.get(k), med.get(k)
            r[out] = v / m - 1 if isinstance(v, (int, float)) and m else None
            if r[out] is None:
                na[out] = na.get(k) or "No sub-industry median available."

    ranks = {f: _pct_ranks(rows, f, hb) for spec in FACTORS.values() for f, hb in spec["fields"]}
    total_fields = sum(len(s["fields"]) for s in FACTORS.values())
    for r in rows:
        t = r["ticker"]
        factor_scores, used = {}, 0
        for name, spec in FACTORS.items():
            ps = [ranks[f][t] for f, _ in spec["fields"] if t in ranks[f]]
            used += len(ps)
            factor_scores[name] = sum(ps) / len(ps) if ps else None
        avail = {k: v for k, v in factor_scores.items() if v is not None}
        wsum = sum(FACTORS[k]["weight"] for k in avail)
        r["value_score"] = sum(FACTORS[k]["weight"] * v for k, v in avail.items()) / wsum if wsum and len(avail) >= 2 else None
        r["score_parts"] = factor_scores
        r["score_coverage"] = used / total_fields
        if r["value_score"] is None:
            r["na"]["value_score"] = "Fewer than two factor groups have data for this company."

    return {
        "rows": rows,
        "medians": medians,
        "universe_count": len(uni),
        "covered": len(rows),
        "methodology": METHODOLOGY,
        "factors": {k: {"weight": v["weight"], "fields": [f for f, _ in v["fields"]]} for k, v in FACTORS.items()},
        "sub_industries": universe.SUB_INDUSTRIES,
    }
