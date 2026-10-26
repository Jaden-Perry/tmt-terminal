"""News: Finnhub company news (key), Yahoo Finance news (no key), GDELT (no key, last ~90 days).

Everything lands in the `news` table so feeds can be filtered by ticker, sub-industry and date.
Headlines that look like M&A are flagged (`is_deal`) for the Deals feed.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re

from .. import db
from ..sources import finnhub, gdelt, yf
from . import universe

DEAL_RE = re.compile(
    r"\b(acquir\w*|acquisition|merg(e|er|ers|ing)|takeover|buyout|divest\w*|spin[- ]?off|tender offer|"
    r"agrees? to buy|to buy \w+ for \$|bid for|deal talks|in talks to (buy|acquire|merge|sell)|explor\w* (a )?sale|"
    r"strategic alternatives|take[- ]private|go[- ]private|definitive agreement|carve[- ]?out)\b",
    re.I,
)

LISTICLE_RE = re.compile(r"\b(stocks? to buy|buy (now|today|before)|should you buy|is it a buy|best .* stocks?)\b", re.I)


def is_deal(headline: str, text: str) -> bool:
    return bool(DEAL_RE.search(text)) and not LISTICLE_RE.search(headline)


NAME_SUFFIX = re.compile(r"\b(inc|corp|corporation|co|company|ltd|plc|holdings?|group|technologies|class [a-c])\b\.?", re.I)


def short_name(ticker: str) -> str | None:
    u = universe.get(ticker) or {}
    name = u.get("name")
    if not name:
        hit = db.cache_get(f"yf:info:{ticker}")
        name = (hit[0] or {}).get("shortName") if hit else None
    if not name:
        return None
    s = NAME_SUFFIX.sub("", name.replace(",", "")).strip(" .-&")
    return re.sub(r"\s{2,}", " ", s) or None


def _id(url: str, headline: str) -> str:
    return hashlib.sha1((url or headline).encode()).hexdigest()[:20]


def _iso(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v, dt.UTC).isoformat()
    s = str(v)
    return s.replace("Z", "+00:00") if s.endswith("Z") else s


def store(items: list[dict], ticker: str | None, provider: str) -> int:
    n = 0
    with db.tx() as c:
        for it in items:
            h, ts = it.get("headline"), _iso(it.get("ts") or it.get("datetime"))
            if not h or not ts:
                continue
            text = f"{h} {it.get('summary') or ''}"
            c.execute(
                "INSERT OR IGNORE INTO news(id, ticker, ts, headline, summary, source, url, provider, is_deal) VALUES (?,?,?,?,?,?,?,?,?)",
                (_id(it.get("url") or "", h), ticker, ts, h.strip(), (it.get("summary") or "")[:600], it.get("source"),
                 it.get("url"), provider, 1 if is_deal(h, text) else 0),
            )
            n += 1
    return n


def _finnhub_items(raw: list[dict]) -> list[dict]:
    return [{"headline": r.get("headline"), "summary": r.get("summary"), "source": r.get("source"),
             "url": r.get("url"), "ts": r.get("datetime")} for r in raw or []]


def refresh_company(ticker: str, ttl: float = 6 * db.HOUR) -> dict:
    """Recent news for one company (on demand from the UI; daily from the nightly job)."""
    ticker = ticker.upper()
    if db.cache_get(f"news:fetched:{ticker}", ttl):
        return {"status": "cached"}
    status = []
    if finnhub.available():
        try:
            store(_finnhub_items(finnhub.company_news(ticker, 30)), ticker, "Finnhub")
            status.append("finnhub ok")
        except Exception as e:  # noqa: BLE001
            status.append(f"finnhub: {e}")
    try:
        store([{**i, "ts": i["datetime"]} for i in yf.news(ticker)], ticker, "Yahoo")
        status.append("yahoo ok")
    except Exception as e:  # noqa: BLE001
        status.append(f"yahoo: {e}")
    db.cache_set(f"news:fetched:{ticker}", status)
    return {"status": status}


def ensure_window(ticker: str, start: dt.date, end: dt.date) -> list[str]:
    """Fetch news covering a historical window (for "why did it move"). Returns notes about coverage."""
    ticker = ticker.upper()
    notes = []
    key = f"news:window:{ticker}:{start}:{end}"
    if db.cache_get(key):
        return db.cache_get(key)[0]
    if finnhub.available():
        try:
            raw = finnhub.get("/company-news", **{"symbol": ticker, "from": start.isoformat(), "to": end.isoformat()})
            store(_finnhub_items(raw), ticker, "Finnhub")
            if not raw:
                notes.append("Finnhub returned no articles for this window (free tier keeps about 1 year of company news).")
        except Exception as e:  # noqa: BLE001
            notes.append(f"Finnhub unavailable: {e}")
    else:
        notes.append("No Finnhub key: historical company news is limited. Add FINNHUB_API_KEY for ~1 year of history.")
    name = short_name(ticker)
    if gdelt.in_window(end) and name and len(name) >= 3:
        try:
            q = f'"{name}"' if " " in name else f'"{name}" ({ticker} OR stock OR shares)'
            arts = gdelt.articles(q, start, end, 75, sort="hybridrel")
            # GDELT matches full text; keep only headlines that name the company
            pat = re.compile(rf"\b({re.escape(name)}|{re.escape(ticker)})\b", re.I)
            store([a for a in arts if pat.search(a["headline"] or "")], ticker, "GDELT")
        except Exception as e:  # noqa: BLE001
            notes.append(f"GDELT unavailable: {e}")
    elif not gdelt.in_window(end):
        notes.append("GDELT search only covers the last ~90 days.")
    if (dt.date.today() - end).days <= 10:
        refresh_company(ticker)
    if not any("unavailable" in n for n in notes):  # retry transient failures next time
        db.cache_set(key, notes)
    return notes


def query(*, tickers: list[str] | None = None, sub_industry: str | None = None, since: str | None = None,
          until: str | None = None, deals_only: bool = False, q: str | None = None, limit: int = 300) -> list[dict]:
    sql = "SELECT n.*, u.sub_industry, u.name AS company FROM news n LEFT JOIN universe u ON u.ticker = n.ticker WHERE 1=1"
    args: list = []
    if tickers:
        sql += f" AND n.ticker IN ({','.join('?' * len(tickers))})"
        args += tickers
    if sub_industry:
        sql += " AND u.sub_industry = ?"
        args.append(sub_industry)
    if since:
        sql += " AND n.ts >= ?"
        args.append(since)
    if until:
        sql += " AND n.ts <= ?"
        args.append(until + "T23:59:59")
    if deals_only:
        sql += " AND n.is_deal = 1"
    if q:
        sql += " AND n.headline LIKE ?"
        args.append(f"%{q}%")
    sql += " ORDER BY n.ts DESC LIMIT ?"
    args.append(limit)
    rows = [dict(r) for r in db.conn().execute(sql, args)]
    # Same story from several providers: keep the first headline we see
    seen, out = set(), []
    for r in rows:
        k = (r["ticker"], re.sub(r"\W+", "", r["headline"].lower())[:60])
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def refresh_sector(ttl: float = 3 * db.HOUR) -> list[str]:
    """Sector-wide: Finnhub merger + technology categories, and GDELT tech M&A search. Tagged to tickers by name."""
    if db.cache_get("news:sector", ttl):
        return db.cache_get("news:sector")[0]
    notes = []
    names = {}
    for r in universe.all_rows():
        sn = short_name(r["ticker"])
        if sn and len(sn) >= 4:
            names[sn.lower()] = r["ticker"]
    pattern = re.compile(r"\b(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b", re.I) if names else None

    def tag_and_store(items, provider):
        for it in items:
            m = pattern.search(it.get("headline") or "") if pattern else None
            store([it], names.get(m.group(1).lower()) if m else None, provider)

    if finnhub.available():
        for cat in ("merger", "technology"):
            try:
                tag_and_store(_finnhub_items(finnhub.general_news(cat)), f"Finnhub ({cat})")
            except Exception as e:  # noqa: BLE001
                notes.append(f"Finnhub {cat}: {e}")
    else:
        notes.append("No Finnhub key: sector feed uses GDELT and per-company Yahoo news only.")
    try:
        q = '(acquisition OR merger OR "to acquire" OR takeover) (software OR semiconductor OR telecom OR "media company" OR chipmaker)'
        tag_and_store(gdelt.articles(q, dt.date.today() - dt.timedelta(days=7), dt.date.today(), 75), "GDELT")
    except Exception as e:  # noqa: BLE001
        msg = "rate-limited, will retry later" if "429" in str(e) else str(e)[:80]
        notes.append(f"GDELT sector search skipped ({msg}).")
    db.cache_set("news:sector", notes)
    return notes


def reflag_deals() -> int:
    rows = db.conn().execute("SELECT id, headline, summary FROM news").fetchall()
    with db.tx() as c:
        for r in rows:
            c.execute("UPDATE news SET is_deal=? WHERE id=?", (1 if is_deal(r[1], f"{r[1]} {r[2] or ''}") else 0, r[0]))
    return len(rows)


def refresh_ticker_nightly(ticker: str) -> None:
    refresh_company(ticker, ttl=db.DAY)
