"""Builds the TMT universe automatically and tags sub-industries.

Sources (all free, no key):
  * Wikipedia S&P 500 and S&P 400 constituent tables (GICS sector + sub-industry)
  * Nasdaq's public stock screener API (larger non-index US names; Nasdaq industry labels)
  * SEC company_tickers.json for CIKs
"""
from __future__ import annotations

import io
import json
import math
import time

import pandas as pd
import yaml

from .. import db, ratelimit
from ..config import CONFIG_DIR
from ..sources.http import get_json, sec_headers, session

TMT_GICS_SECTORS = {"Information Technology", "Communication Services"}

GICS_TO_TAG = {
    "Semiconductors": "Semiconductors",
    "Semiconductor Materials & Equipment": "Semi Equipment",
    "Application Software": "Software",
    "Systems Software": "Software",
    "Interactive Media & Services": "Internet",
    "Internet Services & Infrastructure": "IT Services",
    "IT Consulting & Other Services": "IT Services",
    "Data Processing & Outsourced Services": "IT Services",
    "Technology Hardware, Storage & Peripherals": "Hardware",
    "Electronic Components": "Hardware",
    "Electronic Equipment & Instruments": "Hardware",
    "Electronic Manufacturing Services": "Hardware",
    "Technology Distributors": "Hardware",
    "Communications Equipment": "Comm Equipment",
    "Movies & Entertainment": "Media & Entertainment",
    "Interactive Home Entertainment": "Media & Entertainment",
    "Broadcasting": "Media & Entertainment",
    "Cable & Satellite": "Media & Entertainment",
    "Publishing": "Media & Entertainment",
    "Advertising": "Media & Entertainment",
    "Integrated Telecommunication Services": "Telecom",
    "Wireless Telecommunication Services": "Telecom",
    "Alternative Carriers": "Telecom",
}

NASDAQ_INDUSTRY_TO_TAG = {
    "Semiconductors": "Semiconductors",
    "Computer Software: Prepackaged Software": "Software",
    "Computer Software: Programming Data Processing": "Software",
    "EDP Services": "IT Services",
    "Telecommunications Equipment": "Comm Equipment",
    "Computer Communications Equipment": "Comm Equipment",
    "Radio And Television Broadcasting And Communications Equipment": "Comm Equipment",
    "Electronic Components": "Hardware",
    "Computer Manufacturing": "Hardware",
    "Computer peripheral equipment": "Hardware",
    "Consumer Electronics/Appliances": "Hardware",
    "Retail: Computer Software & Peripheral Equipment": "Hardware",
    "Cable & Other Pay Television Services": "Media & Entertainment",
    "Broadcasting": "Media & Entertainment",
    "Advertising": "Media & Entertainment",
    "Publishing": "Media & Entertainment",
    "Movies/Entertainment": "Media & Entertainment",
    "Telecommunications Equipment ": "Comm Equipment",
}
NASDAQ_TELECOM_SERVICE_HINTS = ("Telecommunications", "Telephone")
# Securities that aren't common stock (preferreds, notes, ADS wrappers, exchangeables).
NON_COMMON_HINTS = ("Depositary", "Preferred", "Notes", "Debenture", "ZONES", "Warrant", " Units", " Rights")

SUB_INDUSTRIES = [
    "Semiconductors", "Semi Equipment", "Software", "Internet", "IT Services",
    "Hardware", "Comm Equipment", "Media & Entertainment", "Telecom",
]

REBUILD_TTL = 30 * db.DAY


def _settings() -> dict:
    p = CONFIG_DIR / "universe.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


def _wiki_table(url: str) -> pd.DataFrame:
    r = session().get(url, timeout=30)
    r.raise_for_status()
    return pd.read_html(io.StringIO(r.text))[0]


def _norm(sym: str) -> str:
    # Wikipedia/Nasdaq use BRK.B / BRK/B; Yahoo uses BRK-B
    return sym.strip().upper().replace(".", "-").replace("/", "-")


def _sec_ciks() -> dict[str, int]:
    ratelimit.wait("sec")
    data = get_json("https://www.sec.gov/files/company_tickers.json", headers=sec_headers())
    return {_norm(v["ticker"]): int(v["cik_str"]) for v in data.values()}


def _nasdaq_rows() -> list[dict]:
    data = get_json(
        "https://api.nasdaq.com/api/screener/stocks",
        params={"tableonly": "true", "download": "true"},
        headers={"Accept": "application/json"},
        timeout=60,
    )
    return data["data"]["rows"]


def build_universe() -> dict:
    cfg = _settings()
    min_cap = float(cfg.get("extra_min_market_cap", 5e9))
    include = cfg.get("include") or {}
    overrides = {_norm(k): v for k, v in (cfg.get("sub_industry_overrides") or {}).items()}
    exclude = {_norm(t) for t in (cfg.get("exclude") or [])}

    rows: dict[str, dict] = {}
    non_tmt_index_members: set[str] = set()  # S&P names GICS files outside TMT (Nasdaq's labels can disagree)
    for idx, url in (
        ("S&P 500", "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"),
        ("S&P 400", "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"),
    ):
        t = _wiki_table(url)
        for _, r in t.iterrows():
            if r["GICS Sector"] not in TMT_GICS_SECTORS:
                non_tmt_index_members.add(_norm(str(r["Symbol"])))
                continue
            sub = str(r["GICS Sub-Industry"])
            tag = GICS_TO_TAG.get(sub)
            if tag is None:
                continue  # e.g. non-TMT sub-industries that GICS files under Comm Services
            sym = _norm(str(r["Symbol"]))
            rows[sym] = dict(ticker=sym, name=r["Security"], gics_sector=r["GICS Sector"],
                             gics_sub_industry=sub, sub_industry=tag, source=idx)

    nasdaq_caps: dict[str, float] = {}
    try:
        for r in _nasdaq_rows():
            sym = _norm(r["symbol"])
            try:
                cap = float(r.get("marketCap") or 0)
            except ValueError:
                cap = 0.0
            nasdaq_caps[sym] = cap
            if sym in rows or sym in non_tmt_index_members or cap < min_cap or r.get("country") != "United States":
                continue
            if any(h in (r.get("name") or "") for h in NON_COMMON_HINTS):
                continue
            ind = (r.get("industry") or "").strip()
            tag = NASDAQ_INDUSTRY_TO_TAG.get(ind)
            if tag is None and r.get("sector") == "Telecommunications" and any(h in ind for h in NASDAQ_TELECOM_SERVICE_HINTS):
                tag = "Telecom"
            if tag is None:
                continue
            if "%" in sym or "^" in sym:
                continue  # preferreds / warrants
            rows[sym] = dict(ticker=sym, name=r.get("name", "").replace(" Common Stock", ""),
                             gics_sector=None, gics_sub_industry=ind, sub_industry=tag, source="Nasdaq screener")
    except Exception as e:  # noqa: BLE001
        print(f"[universe] Nasdaq screener unavailable, continuing with S&P lists only: {e}")

    for sym, tag in include.items():
        sym = _norm(sym)
        rows.setdefault(sym, dict(ticker=sym, name=None, gics_sector=None, gics_sub_industry=None,
                                  sub_industry=tag, source="config include"))
    for sym in exclude:
        rows.pop(sym, None)
    for sym, tag in overrides.items():
        if sym in rows:
            rows[sym]["sub_industry"] = tag

    try:
        ciks = _sec_ciks()
    except Exception as e:  # noqa: BLE001
        print(f"[universe] SEC ticker map unavailable: {e}")
        ciks = {}

    now = time.time()
    with db.tx() as c:
        c.execute("DELETE FROM universe")
        for sym, r in rows.items():
            c.execute(
                "INSERT INTO universe(ticker,name,cik,gics_sector,gics_sub_industry,sub_industry,source,market_cap,updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (sym, r["name"], ciks.get(sym), r["gics_sector"], r["gics_sub_industry"], r["sub_industry"],
                 r["source"], nasdaq_caps.get(sym), now),
            )
    db.cache_set("universe:built", {"count": len(rows)})
    db.cache_set("sec:cik_map", ciks)
    return {"count": len(rows)}


def ensure_universe(force: bool = False) -> None:
    hit = db.cache_get("universe:built", REBUILD_TTL)
    if force or hit is None or not tickers():
        build_universe()


def tickers() -> list[str]:
    return [r[0] for r in db.conn().execute("SELECT ticker FROM universe ORDER BY ticker")]


def all_rows() -> list[dict]:
    return [dict(r) for r in db.conn().execute("SELECT * FROM universe ORDER BY ticker")]


def get(ticker: str) -> dict | None:
    r = db.conn().execute("SELECT * FROM universe WHERE ticker=?", (ticker.upper(),)).fetchone()
    return dict(r) if r else None


def cik_for(ticker: str) -> int | None:
    u = get(ticker)
    if u and u.get("cik"):
        return int(u["cik"])
    hit = db.cache_get("sec:cik_map")
    if hit is None:
        try:
            m = _sec_ciks()
            db.cache_set("sec:cik_map", m)
        except Exception:  # noqa: BLE001
            return None
    else:
        m = hit[0]
    v = m.get(ticker.upper())
    return int(v) if v else None


def peers(ticker: str, limit: int = 12) -> list[str]:
    """Same sub-industry, nearest by market cap."""
    u = get(ticker)
    if not u:
        return []
    rows = db.conn().execute(
        "SELECT u.ticker, m.data FROM universe u LEFT JOIN metrics m ON m.ticker=u.ticker "
        "WHERE u.sub_industry=? AND u.ticker<>?",
        (u["sub_industry"], u["ticker"]),
    ).fetchall()
    my = db.conn().execute("SELECT data FROM metrics WHERE ticker=?", (u["ticker"],)).fetchone()
    my_cap = (json.loads(my[0]).get("market_cap") if my else None) or u.get("market_cap") or 0

    def cap(r):
        if r["data"]:
            return json.loads(r["data"]).get("market_cap") or 0
        return 0

    scored = sorted(rows, key=lambda r: abs(math.log((cap(r) or 1) / (my_cap or 1))) if my_cap and cap(r) else 99)
    return [r["ticker"] for r in scored[:limit]]
