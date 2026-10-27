"""SEC filings index (submissions API) with M&A flags."""
from __future__ import annotations

from .. import db
from ..sources import sec
from . import universe

ITEM_LABELS = {
    "1.01": "Material definitive agreement", "1.02": "Termination of material agreement",
    "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
    "2.01": "Completion of acquisition/disposition", "2.02": "Results of operations (earnings)",
    "2.03": "New financial obligation", "2.05": "Exit/restructuring costs", "2.06": "Impairment",
    "3.01": "Delisting notice", "3.02": "Unregistered equity sale", "4.01": "Auditor change",
    "4.02": "Non-reliance on financials", "5.01": "Change in control", "5.02": "Officer/director change",
    "5.03": "Charter/bylaw amendment", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure",
    "8.01": "Other events", "9.01": "Exhibits",
}
MA_ITEMS = {"1.01", "2.01"}
MA_FORMS = {"S-4", "S-4/A", "425", "DEFM14A", "PREM14A", "SC TO-T", "SC TO-T/A", "SC 14D9", "SC 13E3", "SC 13D", "SC 13D/A"}
FORMS_OF_INTEREST = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A", "20-F", "6-K", "40-F", "DEF 14A", "S-1", "S-3"} | MA_FORMS


def recent(ticker: str, ttl: float = 6 * db.HOUR) -> dict:
    ticker = ticker.upper()
    cik = universe.cik_for(ticker)
    if not cik:
        return {"ticker": ticker, "filings": [], "note": "No SEC CIK for this ticker (not an SEC registrant, or symbol not in SEC's list)."}

    def fetch():
        sub = sec.submissions(cik)
        if not sub:
            return None
        r = sub.get("filings", {}).get("recent", {})
        out = []
        for i, form in enumerate(r.get("form", [])):
            if form not in FORMS_OF_INTEREST:
                continue
            acc = r["accessionNumber"][i]
            doc = r["primaryDocument"][i]
            path = f"/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
            # Inline-XBRL filings open in EDGAR's viewer (readable, clickable financial tags)
            ixbrl = bool((r.get("isInlineXBRL") or [0] * len(r["form"]))[i])
            items = [x.strip() for x in (r.get("items", [""] * len(r["form"]))[i] or "").split(",") if x.strip()]
            ma_reason = None
            if form.startswith("8-K") and MA_ITEMS & set(items):
                ma_reason = "8-K item " + ", ".join(sorted(MA_ITEMS & set(items)))
            elif form in MA_FORMS:
                ma_reason = f"{form} (merger/tender/activist-related form)"
            out.append({
                "form": form, "filed": r["filingDate"][i], "report_date": r.get("reportDate", [None] * len(r["form"]))[i],
                "accession": acc, "items": items, "item_labels": [ITEM_LABELS.get(x, x) for x in items],
                "description": (r.get("primaryDocDescription") or [""] * len(r["form"]))[i],
                "url": f"https://www.sec.gov/ix?doc={path}/{doc}" if ixbrl else f"https://www.sec.gov{path}/{doc}",
                "raw_url": f"https://www.sec.gov{path}/{doc}",
                "index_url": f"https://www.sec.gov{path}/",
                "is_ma": bool(ma_reason), "ma_reason": ma_reason,
            })
        return {"ticker": ticker, "cik": cik, "name": sub.get("name"), "filings": out}

    res = db.cached(f"sec:filings2:{ticker}", ttl, fetch)
    return {**(res["data"] or {"ticker": ticker, "filings": [], "note": res.get("error") or "SEC unavailable"}),
            "fetched_at": res.get("fetched_at"), "stale": res.get("stale")}


def in_window(ticker: str, start: str, end: str) -> list[dict]:
    return [f for f in recent(ticker, ttl=db.DAY)["filings"] if start <= f["filed"] <= end]
