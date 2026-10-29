"""Dimensional XBRL from the latest 10-K / 10-Q via edgartools: revenue by segment/product/geography
and company-specific operating KPIs. (SEC's company-facts API omits dimensions and custom tags.)"""
from __future__ import annotations

import os
import re
import threading

import pandas as pd

from .. import db
from ..config import SEC_USER_AGENT
from . import universe

_lock = threading.Lock()
_identity_set = False

REVENUE_CONCEPTS = {
    "us-gaap:Revenues", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax", "us-gaap:SalesRevenueNet",
}
CONSOLIDATION_AXIS = "dim_srt_ConsolidationItemsAxis"
AXES = {
    "segment": "dim_us-gaap_StatementBusinessSegmentsAxis",
    "product": "dim_srt_ProductOrServiceAxis",
    "geography": "dim_srt_StatementGeographicalAxis",
}


def _edgar():
    global _identity_set
    import edgar

    if not _identity_set:
        if not SEC_USER_AGENT:
            raise RuntimeError("SEC_USER_AGENT is not set in .env")
        edgar.set_identity(SEC_USER_AGENT)
        os.environ.setdefault("EDGAR_USE_LOCAL_DATA", "0")
        _identity_set = True
    return edgar


def _facts_df(ticker: str, form: str) -> tuple[pd.DataFrame | None, dict]:
    edgar = _edgar()
    cik = universe.cik_for(ticker)
    with _lock:  # edgartools isn't guaranteed thread-safe
        c = edgar.Company(cik or ticker)
        f = c.get_filings(form=form).latest()
        if f is None:
            return None, {}
        x = f.xbrl()
        if x is None:
            return None, {}
        df = x.facts.to_dataframe()
    meta = {"form": f.form, "filed": str(f.filing_date), "accession": f.accession_no,
            "url": f.homepage_url if hasattr(f, "homepage_url") else None}
    return df, meta


def _dim_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c.startswith("dim_")]


def _single_axis(df: pd.DataFrame, axis_col: str) -> pd.DataFrame:
    """Facts dimensioned *only* on the given axis (avoids double counting cross-tabs)."""
    dims = _dim_cols(df)
    others = [c for c in dims if c not in (axis_col, CONSOLIDATION_AXIS)]
    mask = df[axis_col].notna()
    if others:
        mask &= df[others].isna().all(axis=1)
    # Since ASU 2023-07 many filers also tag segment facts with "Operating Segments" on the
    # consolidation axis; keep those, drop eliminations/corporate reconciling items.
    if CONSOLIDATION_AXIS in df.columns:
        mask &= df[CONSOLIDATION_AXIS].isna() | (df[CONSOLIDATION_AXIS] == "us-gaap:OperatingSegmentsMember")
    return df[mask]


def _label(member: str, row_label: str | None) -> str:
    if row_label and row_label.lower() not in ("operating segments", "segments", "operating segment"):
        return row_label
    m = member.split(":")[-1]
    m = re.sub(r"(Segment)?Member$", "", m)
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m)


def segments(ticker: str) -> dict:
    ticker = ticker.upper()

    def fetch():
        df, meta = _facts_df(ticker, "10-K")
        if df is None or df.empty:
            return {"ticker": ticker, "breakdowns": {}, "note": "No 10-K XBRL found (foreign filers file 20-F/40-F)."}
        rev = df[df["concept"].isin(REVENUE_CONCEPTS) & df["numeric_value"].notna() & df["period_start"].notna()]
        out = {}
        for name, axis in AXES.items():
            if axis not in df.columns:
                continue
            sub = _single_axis(rev, axis)
            if sub.empty:
                continue
            sub = sub.assign(days=(pd.to_datetime(sub["period_end"]) - pd.to_datetime(sub["period_start"])).dt.days)
            sub = sub[sub["days"].between(350, 380)]
            if sub.empty:
                continue
            # Use the most common revenue concept so members are comparable
            concept = sub["concept"].value_counts().idxmax()
            sub = sub[sub["concept"] == concept]
            periods = sorted(sub["period_end"].unique())
            members = []
            for member, g in sub.groupby(axis):
                lbl = _label(member, g["dimension_member_label"].iloc[0] if "dimension_member_label" in g else None)
                vals = {p: None for p in periods}
                for _, r in g.drop_duplicates("period_end").iterrows():
                    vals[r["period_end"]] = float(r["numeric_value"])
                members.append({"member": member, "label": lbl, "values": [vals[p] for p in periods]})
            members.sort(key=lambda m: -(m["values"][-1] or 0))
            out[name] = {"periods": periods, "members": members, "concept": concept}
        return {"ticker": ticker, "breakdowns": out, "filing": meta,
                "note": None if out else "This 10-K doesn't tag revenue by segment, product or geography in XBRL."}

    return db.cached(f"xbrl:segments:{ticker}", 30 * db.DAY, fetch)


SEGMENT_METRICS = {
    "revenue": REVENUE_CONCEPTS,
    "operating_income": {"us-gaap:OperatingIncomeLoss"},
    "cost_of_revenue": {"us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfRevenue"},
}


def _flag_subtotals(rows: list[dict]) -> None:
    """Mark members that equal the sum of 2+ other members (e.g. "Products" = iPhone + Mac + ...),
    so the table doesn't read as if they're separate businesses."""
    from itertools import combinations

    vals = [(i, r["revenue"][-1]) for i, r in enumerate(rows)]
    for i, v in vals:
        others = [w for j, w in vals if j != i and w and w < v]
        if len(others) < 2 or len(others) > 14:
            continue
        for k in range(2, min(len(others), 7) + 1):
            if any(abs(sum(c) - v) <= 0.002 * v for c in combinations(others, k)):
                rows[i]["subtotal"] = True
                break
        else:
            continue


STD_PREFIXES = ("us-gaap:", "dei:", "srt:", "ifrs-full:", "country:", "ecd:", "currency:", "stpr:", "naics:", "sic:")
# Accounting-plumbing words that rarely matter for an operating view
NOISE = ("Lease", "Tax", "Debt", "Hedg", "Derivative", "Allowance", "Impairment", "WriteOff", "Writeoff", "Covenant",
         "Excise", "Accrued", "Pension", "Repurchase", "Option", "Warrant", "Award", "Vesting", "Discount", "Premium")


def kpis(ticker: str) -> dict:
    """Latest 10-Q (or 10-K): quarterly segment revenue / operating income + company-specific tags."""
    ticker = ticker.upper()

    def fetch():
        df, meta = _facts_df(ticker, "10-Q")
        if df is None or df.empty:
            df, meta = _facts_df(ticker, "10-K")
        if df is None or df.empty:
            return {"ticker": ticker, "segments": {}, "custom": [], "note": "No 10-Q/10-K XBRL found."}
        num = df[df["numeric_value"].notna()].copy()
        num["days"] = (pd.to_datetime(num["period_end"]) - pd.to_datetime(num["period_start"])).dt.days
        seg_out = {}
        for name, axis in AXES.items():
            if axis not in num.columns:
                continue
            got = {}
            for metric, concepts in SEGMENT_METRICS.items():
                sub = _single_axis(num[num["concept"].isin(concepts)], axis)
                sub = sub[sub["days"].between(80, 100)]  # the quarter itself, not year-to-date
                if sub.empty:
                    continue
                concept = sub["concept"].value_counts().idxmax()
                got[metric] = sub[sub["concept"] == concept]
            if "revenue" not in got:
                continue
            periods = sorted(got["revenue"]["period_end"].unique())[-2:]  # year-ago quarter, latest quarter
            rows = {}
            for metric, sub in got.items():
                for member, g in sub[sub["period_end"].isin(periods)].groupby(axis):
                    lbl = _label(member, g["dimension_member_label"].iloc[0] if "dimension_member_label" in g else None)
                    r = rows.setdefault(member, {"label": lbl, "member": member})
                    vals = {p: None for p in periods}
                    for _, x in g.drop_duplicates("period_end").iterrows():
                        vals[x["period_end"]] = float(x["numeric_value"])
                    r[metric] = [vals[p] for p in periods]
            rows = [r for r in rows.values() if r.get("revenue") and r["revenue"][-1] is not None]
            for r in rows:
                rev = r["revenue"]
                for metric, out in (("operating_income", "op_margin"), ("cost_of_revenue", "gross_margin")):
                    if r.get(metric):
                        r[out] = [(1 - c / v if out == "gross_margin" else c / v) if c is not None and v else None
                                  for c, v in zip(r[metric], rev)]
            _flag_subtotals(rows)
            rows.sort(key=lambda r: (not r.get("subtotal"), -(r["revenue"][-1] or 0)))
            seg_out[name] = {"axis": name, "periods": periods, "rows": rows,
                             "has": [m for m in ("operating_income", "op_margin", "gross_margin") if any(r.get(m) for r in rows)]}
        nd = num[(num["is_dimensioned"] == False) & ~num["concept"].str.startswith(STD_PREFIXES)]  # noqa: E712
        nd = nd[~nd["concept"].str.contains("|".join(NOISE))].copy()
        inst = nd["period_instant"] if "period_instant" in nd.columns else None
        nd["pdate"] = nd["period_end"].fillna(inst) if inst is not None else nd["period_end"]
        custom = []
        for concept, g in nd.groupby("concept"):
            g = g.sort_values(["pdate"], na_position="first")
            r = g.iloc[-1]
            custom.append({"concept": concept, "label": r.get("label") or concept.split(":")[-1], "value": float(r["numeric_value"]),
                           "unit": r.get("unit_ref"), "period_end": None if pd.isna(r["pdate"]) else r["pdate"],
                           "days": None if pd.isna(r["days"]) else int(r["days"])})
        # Operating (non-dollar) metrics first: counts, percentages, units
        custom.sort(key=lambda c: (str(c["unit"]).lower() in ("usd", "usdpershare"), c["label"]))
        return {"ticker": ticker, "segments": seg_out, "custom": custom[:60], "filing": meta}

    return db.cached(f"xbrl:kpis3:{ticker}", 7 * db.DAY, fetch)
