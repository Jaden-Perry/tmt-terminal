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
    others = [c for c in dims if c != axis_col]
    mask = df[axis_col].notna()
    if others:
        mask &= df[others].isna().all(axis=1)
    return df[mask]


def _label(member: str, row_label: str | None) -> str:
    if row_label and row_label not in ("Operating Segments", "Segments"):
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
