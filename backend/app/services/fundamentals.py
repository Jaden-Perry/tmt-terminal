"""Historical financial statements built from SEC XBRL company facts.

Approach
  * Each line item maps to a priority list of us-gaap concepts (companies switch tags over time);
    per period we take the highest-priority concept that reports it.
  * For each (start, end) period we keep the most recently *filed* value, so restatements win.
  * Quarterly flow values come from direct 3-month facts, or are derived from year-to-date
    cumulative facts (10-Q cash flows are YTD-only; Q4 = FY - 9M).
  * Per-share and share-count facts are adjusted for stock splits that happened after filing.
Fallback: yfinance statements (~4 years) when a company has no usable XBRL (e.g. foreign filers).
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .. import db
from ..sources import sec, yf
from . import universe

FLOW = "flow"
INSTANT = "instant"

# (key, label, statement, kind, unit, concepts)
ITEMS: list[tuple[str, str, str, str, str, list[str]]] = [
    ("revenue", "Revenue", "income", FLOW, "USD", [
        "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense"]),
    ("cogs", "Cost of revenue", "income", FLOW, "USD", [
        "CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"]),
    ("gross_profit", "Gross profit", "income", FLOW, "USD", ["GrossProfit"]),
    ("rnd", "R&D", "income", FLOW, "USD", [
        "ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]),
    ("sga", "SG&A", "income", FLOW, "USD", ["SellingGeneralAndAdministrativeExpense"]),
    ("sm", "Sales & marketing", "income", FLOW, "USD", ["SellingAndMarketingExpense", "MarketingAndAdvertisingExpense"]),
    ("ga", "General & admin", "income", FLOW, "USD", ["GeneralAndAdministrativeExpense"]),
    ("operating_income", "Operating income", "income", FLOW, "USD", ["OperatingIncomeLoss"]),
    ("interest_expense", "Interest expense", "income", FLOW, "USD", [
        "InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"]),
    ("pretax_income", "Pretax income", "income", FLOW, "USD", [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"]),
    ("income_tax", "Income tax", "income", FLOW, "USD", ["IncomeTaxExpenseBenefit"]),
    ("net_income", "Net income", "income", FLOW, "USD", ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"]),
    ("eps_basic", "EPS (basic)", "income", FLOW, "USD/shares", ["EarningsPerShareBasic"]),
    ("eps_diluted", "EPS (diluted)", "income", FLOW, "USD/shares", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]),
    ("shares_diluted", "Diluted shares (wtd avg)", "income", FLOW, "shares", [
        "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"]),
    ("shares_basic", "Basic shares (wtd avg)", "income", FLOW, "shares", ["WeightedAverageNumberOfSharesOutstandingBasic"]),
    ("dna", "D&A", "cashflow", FLOW, "USD", [
        "DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization",
        "Depreciation"]),
    ("sbc", "Stock-based comp", "cashflow", FLOW, "USD", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"]),
    ("cfo", "Cash from operations", "cashflow", FLOW, "USD", [
        "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
    ("capex", "Capex", "cashflow", FLOW, "USD", [
        "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
        "PaymentsForCapitalImprovements", "PaymentsToAcquireOtherPropertyPlantAndEquipment"]),
    ("acquisitions", "Acquisitions (net)", "cashflow", FLOW, "USD", ["PaymentsToAcquireBusinessesNetOfCashAcquired"]),
    ("cfi", "Cash from investing", "cashflow", FLOW, "USD", [
        "NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"]),
    ("buybacks", "Share repurchases", "cashflow", FLOW, "USD", ["PaymentsForRepurchaseOfCommonStock"]),
    ("dividends", "Dividends paid", "cashflow", FLOW, "USD", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"]),
    ("cff", "Cash from financing", "cashflow", FLOW, "USD", [
        "NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"]),
    ("cash", "Cash & equivalents", "balance", INSTANT, "USD", [
        "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"]),
    ("st_investments", "Short-term investments", "balance", INSTANT, "USD", [
        "ShortTermInvestments", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "MarketableSecuritiesCurrent",
        "AvailableForSaleSecuritiesCurrent"]),
    ("receivables", "Receivables", "balance", INSTANT, "USD", ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"]),
    ("inventory", "Inventory", "balance", INSTANT, "USD", ["InventoryNet"]),
    ("current_assets", "Total current assets", "balance", INSTANT, "USD", ["AssetsCurrent"]),
    ("ppe", "PP&E (net)", "balance", INSTANT, "USD", [
        "PropertyPlantAndEquipmentNet",
        "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"]),
    ("goodwill", "Goodwill", "balance", INSTANT, "USD", ["Goodwill"]),
    ("intangibles", "Intangibles (ex-GW)", "balance", INSTANT, "USD", [
        "IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"]),
    ("total_assets", "Total assets", "balance", INSTANT, "USD", ["Assets"]),
    ("accounts_payable", "Accounts payable", "balance", INSTANT, "USD", ["AccountsPayableCurrent"]),
    ("deferred_rev_current", "Deferred revenue (current)", "balance", INSTANT, "USD", [
        "ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"]),
    ("deferred_rev_noncurrent", "Deferred revenue (non-current)", "balance", INSTANT, "USD", [
        "ContractWithCustomerLiabilityNoncurrent", "DeferredRevenueNoncurrent"]),
    ("current_liabilities", "Total current liabilities", "balance", INSTANT, "USD", ["LiabilitiesCurrent"]),
    ("short_debt", "Short-term debt", "balance", INSTANT, "USD", [
        "LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "ShortTermBorrowings",
        "CommercialPaper"]),
    ("long_debt", "Long-term debt", "balance", INSTANT, "USD", [
        "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable",
        "ConvertibleNotesPayableNoncurrent", "SeniorNotesNoncurrent"]),
    ("total_liabilities", "Total liabilities", "balance", INSTANT, "USD", ["Liabilities"]),
    ("equity", "Shareholders' equity", "balance", INSTANT, "USD", [
        "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    ("rpo", "Remaining perf. obligations", "balance", INSTANT, "USD", ["RevenueRemainingPerformanceObligation"]),
    ("shares_out", "Shares outstanding", "balance", INSTANT, "shares", ["CommonStockSharesOutstanding"]),
]

DERIVED = [
    ("gross_profit", "income"), ("ebitda", "income"), ("gross_margin", "income"), ("operating_margin", "income"),
    ("net_margin", "income"), ("fcf", "cashflow"), ("fcf_margin", "cashflow"), ("total_debt", "balance"),
    ("net_debt", "balance"), ("deferred_rev_total", "balance"),
]
LABELS = {k: lbl for k, lbl, *_ in ITEMS} | {
    "ebitda": "EBITDA (OpInc + D&A)", "gross_margin": "Gross margin", "operating_margin": "Operating margin",
    "net_margin": "Net margin", "fcf": "Free cash flow (CFO - capex)", "fcf_margin": "FCF margin",
    "total_debt": "Total debt", "net_debt": "Net debt (debt - cash - ST inv)", "deferred_rev_total": "Deferred revenue (total)",
}
STATEMENT_ORDER = {
    "income": ["revenue", "cogs", "gross_profit", "gross_margin", "rnd", "sga", "sm", "ga", "operating_income",
               "operating_margin", "dna", "ebitda", "interest_expense", "pretax_income", "income_tax", "net_income",
               "net_margin", "eps_basic", "eps_diluted", "shares_basic", "shares_diluted"],
    "balance": ["cash", "st_investments", "receivables", "inventory", "current_assets", "ppe", "goodwill", "intangibles",
                "total_assets", "accounts_payable", "deferred_rev_current", "current_liabilities", "short_debt",
                "long_debt", "deferred_rev_noncurrent", "total_liabilities", "equity", "total_debt", "net_debt",
                "deferred_rev_total", "rpo", "shares_out"],
    "cashflow": ["cfo", "capex", "fcf", "fcf_margin", "dna", "sbc", "acquisitions", "cfi", "buybacks", "dividends", "cff"],
}
PCT_KEYS = {"gross_margin", "operating_margin", "net_margin", "fcf_margin"}
PER_SHARE = {"eps_basic", "eps_diluted"}
SHARE_KEYS = {"shares_diluted", "shares_basic", "shares_out"}

FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "20-F", "40-F", "20-F/A"}


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _days(a: str, b: str) -> int:
    return (_d(b) - _d(a)).days


def splits(ticker: str) -> list[tuple[str, float]]:
    def fetch():
        import yfinance as yfl

        s = yf._retry(lambda: yfl.Ticker(ticker).splits, tries=2)
        return [(d.strftime("%Y-%m-%d"), float(v)) for d, v in s.items()] if s is not None else []

    return db.cached(f"yf:splits:{ticker}", db.WEEK, fetch)["data"] or []


def _split_factor(filed: str, spl: list[tuple[str, float]]) -> float:
    f = 1.0
    for d, ratio in spl:
        if d > filed and ratio > 0:
            f *= ratio
    return f


def _concept_facts(facts: dict, concept: str, unit: str) -> list[dict]:
    for ns in ("us-gaap", "ifrs-full", "dei"):
        c = facts.get("facts", {}).get(ns, {}).get(concept)
        if c and unit in c.get("units", {}):
            return c["units"][unit]
    return []


def _latest_by_period(rows: list[dict], kind: str) -> dict[tuple, dict]:
    """(start, end) -> fact, keeping the most recently filed one."""
    out: dict[tuple, dict] = {}
    for r in rows:
        if r.get("form") not in FORMS:
            continue
        key = (r.get("start") if kind == FLOW else None, r["end"])
        if kind == FLOW and not r.get("start"):
            continue
        prev = out.get(key)
        if prev is None or r.get("filed", "") >= prev.get("filed", ""):
            out[key] = r
    return out


def _quarters_from_flows(periods: dict[tuple, float]) -> dict[str, tuple[str, float]]:
    """Return {quarter_end: (quarter_start, value)} from direct 3M facts plus YTD differencing."""
    q: dict[str, tuple[str, float]] = {}
    by_start: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for (s, e), v in periods.items():
        by_start[s].append((e, v))
    for s, items in by_start.items():
        items.sort()
        prev_end, prev_val = None, 0.0
        for e, v in items:
            span = _days(s, e)
            if prev_end is None:
                if 70 <= span <= 105:
                    q.setdefault(e, (s, v))
                    prev_end, prev_val = e, v
                else:
                    break  # chain must begin with a first quarter
            else:
                step = _days(prev_end, e)
                if 70 <= step <= 105:
                    qs = (_d(prev_end) + dt.timedelta(days=1)).isoformat()
                    q.setdefault(e, (qs, v - prev_val))
                    prev_end, prev_val = e, v
    # Direct 3-month facts take precedence over derived values
    for (s, e), v in periods.items():
        if 70 <= _days(s, e) <= 105:
            q[e] = (s, v)
    return q


def _fy_label(end: str) -> str:
    d = _d(end)
    y = d.year - 1 if d.month == 1 and d.day <= 10 else d.year
    return f"FY{y}"


def build_from_facts(facts: dict, ticker: str) -> dict:
    spl = splits(ticker)
    annual: dict[str, dict[str, float]] = defaultdict(dict)  # end -> key -> value
    quarterly: dict[str, dict[str, float]] = defaultdict(dict)
    sources: dict[str, str] = {}
    fy_ends: set[str] = set()

    for key, _label, _stmt, kind, unit, concepts in ITEMS:
        got_a: dict[str, float] = {}
        got_q: dict[str, float] = {}
        for concept in concepts:
            rows = _concept_facts(facts, concept, unit)
            if not rows:
                continue
            latest = _latest_by_period(rows, kind)
            vals: dict[tuple, float] = {}
            for (s, e), r in latest.items():
                v = float(r["val"])
                if key in PER_SHARE or key in SHARE_KEYS:
                    f = _split_factor(r.get("filed", "9999"), spl)
                    v = v / f if key in PER_SHARE else v * f
                vals[(s, e)] = v
            if kind == FLOW:
                a_add = {e: v for (s, e), v in vals.items() if 350 <= _days(s, e) <= 380}
                q_add = {e: v for e, (_s, v) in _quarters_from_flows(vals).items()}
                # Per-share values can't be differenced from YTD; keep only direct 3M EPS
                if key in PER_SHARE or key in SHARE_KEYS:
                    q_add = {e: v for (s, e), v in vals.items() if 70 <= _days(s, e) <= 105}
            else:
                a_add = {}
                q_add = {e: v for (_s, e), v in vals.items()}
            new_a = {e: v for e, v in a_add.items() if e not in got_a}
            new_q = {e: v for e, v in q_add.items() if e not in got_q}
            if new_a or new_q:
                sources.setdefault(key, concept)
            got_a.update(new_a)
            got_q.update(new_q)
            if kind == FLOW and key == "revenue":
                fy_ends.update(a_add)
        for e, v in got_a.items():
            annual[e][key] = v
        for e, v in got_q.items():
            quarterly[e][key] = v

    if not fy_ends:
        fy_ends = {e for e, row in annual.items() if row.get("net_income") is not None}
    # Balance sheet items for annual columns come from the instant at each fiscal year end
    for e in fy_ends:
        for key, _l, _s, kind, *_ in ITEMS:
            if kind == INSTANT and e in quarterly and key in quarterly[e]:
                annual[e][key] = quarterly[e][key]
    annual = {e: row for e, row in annual.items() if e in fy_ends or len(row) > 5}

    # Q4 per-share data isn't reported directly; approximate with full-year diluted shares
    for e, row in quarterly.items():
        if e not in fy_ends:
            continue
        sh = annual.get(e, {}).get("shares_diluted")
        if row.get("shares_diluted") is None and sh:
            row["shares_diluted"] = sh
        if row.get("eps_diluted") is None and row.get("net_income") is not None and sh:
            row["eps_diluted"] = row["net_income"] / sh
            row["_est"] = "Q4 EPS and share count derived: FY minus 9M net income / FY diluted shares"

    for table in (annual, quarterly):
        for row in table.values():
            _derive(row)

    cutoff = (dt.date.today() - dt.timedelta(days=365 * 16)).isoformat()
    q_keep = {e: r for e, r in quarterly.items() if e >= cutoff and any(k in r for k in ("revenue", "net_income", "cfo"))}
    a_keep = {e: r for e, r in annual.items() if e >= cutoff}
    entity = facts.get("entityName")
    return {
        "ticker": ticker,
        "entity": entity,
        "source": "SEC XBRL company facts",
        "annual": [{"end": e, "label": _fy_label(e), **a_keep[e]} for e in sorted(a_keep)],
        "quarterly": [{"end": e, "label": e[:7], **q_keep[e]} for e in sorted(q_keep)],
        "concepts": sources,
        "splits": spl,
    }


def _derive(r: dict) -> None:
    g = r.get
    if g("gross_profit") is None and g("revenue") is not None and g("cogs") is not None:
        r["gross_profit"] = r["revenue"] - r["cogs"]
    if g("operating_income") is not None and g("dna") is not None:
        r["ebitda"] = r["operating_income"] + r["dna"]
    rev = g("revenue")
    if rev:
        for num, out in (("gross_profit", "gross_margin"), ("operating_income", "operating_margin"), ("net_income", "net_margin")):
            if g(num) is not None:
                r[out] = r[num] / rev
    if g("cfo") is not None and g("capex") is not None:
        r["fcf"] = r["cfo"] - abs(r["capex"])
        if rev:
            r["fcf_margin"] = r["fcf"] / rev
    if g("short_debt") is not None or g("long_debt") is not None:
        r["total_debt"] = (g("short_debt") or 0) + (g("long_debt") or 0)
    if g("cash") is not None:
        r["net_debt"] = (g("total_debt") or 0) - r["cash"] - (g("st_investments") or 0)
    if g("deferred_rev_current") is not None or g("deferred_rev_noncurrent") is not None:
        r["deferred_rev_total"] = (g("deferred_rev_current") or 0) + (g("deferred_rev_noncurrent") or 0)


YF_MAP = {
    "Total Revenue": "revenue", "Cost Of Revenue": "cogs", "Gross Profit": "gross_profit",
    "Research And Development": "rnd", "Selling General And Administration": "sga",
    "Operating Income": "operating_income", "Interest Expense": "interest_expense", "Pretax Income": "pretax_income",
    "Tax Provision": "income_tax", "Net Income": "net_income", "Basic EPS": "eps_basic", "Diluted EPS": "eps_diluted",
    "Diluted Average Shares": "shares_diluted", "Basic Average Shares": "shares_basic",
    "Depreciation And Amortization": "dna", "Stock Based Compensation": "sbc",
    "Operating Cash Flow": "cfo", "Capital Expenditure": "capex", "Investing Cash Flow": "cfi",
    "Financing Cash Flow": "cff", "Repurchase Of Capital Stock": "buybacks", "Cash Dividends Paid": "dividends",
    "Cash And Cash Equivalents": "cash", "Other Short Term Investments": "st_investments", "Receivables": "receivables",
    "Inventory": "inventory", "Current Assets": "current_assets", "Net PPE": "ppe", "Goodwill": "goodwill",
    "Total Assets": "total_assets", "Accounts Payable": "accounts_payable", "Current Liabilities": "current_liabilities",
    "Current Debt": "short_debt", "Long Term Debt": "long_debt",
    "Total Liabilities Net Minority Interest": "total_liabilities", "Stockholders Equity": "equity",
    "Ordinary Shares Number": "shares_out", "Current Deferred Revenue": "deferred_rev_current",
}


def build_from_yf(ticker: str) -> dict | None:
    st = yf.statements(ticker)
    if not any(st.values()):
        return None
    out = {}
    for freq in ("annual", "quarterly"):
        rows: dict[str, dict] = defaultdict(dict)
        for stmt in ("income", "balance", "cashflow"):
            for end, vals in st.get(f"{stmt}_{freq}", {}).items():
                for k, v in vals.items():
                    if k in YF_MAP and v is not None:
                        rows[end][YF_MAP[k]] = v
        for r in rows.values():
            if r.get("capex") is not None:
                r["capex"] = abs(r["capex"])
            _derive(r)
        out[freq] = [{"end": e, "label": _fy_label(e) if freq == "annual" else e[:7], **rows[e]} for e in sorted(rows)]
    return {"ticker": ticker, "entity": None, "source": "Yahoo Finance (SEC XBRL unavailable)", "concepts": {}, "splits": [], **out}


def statements(ticker: str, force: bool = False) -> dict:
    """Cached weekly. Returns {"data": {...}, "fetched_at", "stale"}."""
    ticker = ticker.upper()

    def fetch():
        cik = universe.cik_for(ticker)
        if cik:
            facts = sec.company_facts(cik, force=force)
            if facts:
                built = build_from_facts(facts, ticker)
                if built["annual"] or built["quarterly"]:
                    built["cik"] = cik
                    return built
        return build_from_yf(ticker)

    return db.cached(f"fin:{ticker}", db.WEEK, fetch, force=force)


def table(data: dict, statement: str, freq: str) -> dict:
    periods = data.get(freq) or []
    rows = []
    for key in STATEMENT_ORDER[statement]:
        vals = [p.get(key) for p in periods]
        if all(v is None for v in vals):
            continue
        rows.append({"key": key, "label": LABELS.get(key, key), "pct": key in PCT_KEYS,
                     "per_share": key in PER_SHARE, "values": vals,
                     "concept": data.get("concepts", {}).get(key)})
    return {"periods": [{"end": p["end"], "label": p["label"]} for p in periods], "rows": rows}


def ttm(quarters: list[dict], key: str, upto: str | None = None) -> float | None:
    """Sum of the last four consecutive quarters ending on/before `upto`."""
    qs = [q for q in quarters if (upto is None or q["end"] <= upto) and q.get(key) is not None]
    if len(qs) < 4:
        return None
    last4 = qs[-4:]
    if _days(last4[0]["end"], last4[-1]["end"]) > 300:  # gap in the series
        return None
    return sum(q[key] for q in last4)


def refresh_ticker(ticker: str) -> None:
    statements(ticker)
