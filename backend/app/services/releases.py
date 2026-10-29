"""Company-reported operating KPIs from earnings releases (8-K Item 2.02, Exhibit 99.1).

Metrics like Uber's gross bookings, trips and MAPCs, or adjusted EBITDA, appear only in the press
release, not in XBRL. config/kpis.yaml says, per company, which table row holds each metric and
which number in the row is the current quarter vs the year-ago quarter. Each release is parsed
once and cached for good (releases don't change); the latest ones are re-listed daily.
"""
from __future__ import annotations

import datetime as dt
import re

import yaml
from lxml import html as LH

from .. import db
from ..config import CONFIG_DIR
from . import universe
from .xbrl_detail import _edgar, _lock

N_RELEASES = 8
_NUM = re.compile(r"^\(?-?\$?\s*\(?([\d,]*\.?\d+)\)?$")


def config() -> dict:
    path = CONFIG_DIR / "kpis.yaml"
    return yaml.safe_load(path.read_text()) if path.exists() else {}


def _num(s: str) -> float | None:
    s = s.replace("—", "").replace("–", "-").replace("\xa0", " ").strip()
    m = _NUM.match(s)
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    return -v if s.startswith("(") or s.startswith("-") or s.endswith(")") else v


def tables(page: str) -> list[dict]:
    """Every table as {context, rows:[{label, values, pcts}]}.

    context = the text between the previous table and this one, plus the table's own first rows,
    so a row like "Mobility" can be told apart in the Gross Bookings vs Revenue tables.
    `values` are the plain numbers in the row in order; numbers followed by % go in `pcts`.
    """
    doc = LH.fromstring(page)
    out = []
    for i, t in enumerate(doc.iter("table")):
        rows = []
        head = []
        for tr in t.iter("tr"):
            cells = [re.sub(r"\s+", " ", td.text_content()).strip() for td in tr.iter("td", "th")]
            cells = [c for c in cells if c not in ("", "$")]
            if not cells:
                continue
            label, vals, pcts = None, [], []
            for c in cells:
                if c in ("\u2014", "\u2013", "-", "\u2014%"):  # dash = zero / not applicable; keep the column position
                    vals.append(None)
                    continue
                if c == "%":
                    if vals:
                        pcts.append(vals.pop())
                    continue
                v = _num(c.rstrip("%").strip()) if c.endswith("%") else _num(c)
                if v is None:
                    if label is None and not vals:
                        label = c
                    continue
                (pcts if c.endswith("%") else vals).append(v)
            if len(head) < 4:
                head.append(" ".join(cells))
            if label:
                rows.append({"label": label, "values": vals, "pcts": pcts})
        marker = f"@@T{i}@@"
        out.append({"rows": rows, "head": " ".join(head), "marker": marker})
    # Context text before each table: replace tables with markers, then slice the plain text
    for i, t in enumerate(list(doc.iter("table"))):
        t.clear()
        t.text = f" @@T{i}@@ "
    text = re.sub(r"\s+", " ", doc.text_content())
    prev = 0
    for t in out:
        pos = text.find(t["marker"])
        t["context"] = (text[prev:pos][-300:] if pos >= 0 else "") + " " + t["head"]
        if pos >= 0:
            prev = pos + len(t["marker"])
    return out


def _find(tabs: list[dict], spec: dict) -> tuple[float | None, float | None]:
    row_re = re.compile(spec["row"], re.I)
    ctx_re = re.compile(spec["context"], re.I) if spec.get("context") else None
    for t in tabs:
        if ctx_re and not ctx_re.search(t["context"]):
            continue
        for r in t["rows"]:
            if row_re.search(r["label"]):
                v = r["values"]
                cur, prior = spec.get("cur", 1), spec.get("prior", 0)
                if len(v) <= max(cur, prior if prior is not None else 0) or v[cur] is None:
                    continue
                scale = float(spec.get("scale", 1e6))
                return v[cur] * scale, (v[prior] * scale if prior is not None and v[prior] is not None else None)
    return None, None


def _quarter_end(filed: str, fiscal_ends: list[str]) -> str:
    """The quarter a release reports on: the latest fiscal quarter end at least ~2 weeks before filing."""
    d = dt.date.fromisoformat(filed)
    cands = [e for e in fiscal_ends if 10 <= (d - dt.date.fromisoformat(e)).days <= 120]
    if cands:
        return max(cands)
    d -= dt.timedelta(days=10)
    m = (d.month - 1) // 3 * 3  # calendar quarter end fallback
    return (dt.date(d.year, m + 1, 1) - dt.timedelta(days=1)).isoformat() if m else f"{d.year - 1}-12-31"


def _release_list(ticker: str) -> list[dict]:
    def fetch():
        edgar = _edgar()
        cik = universe.cik_for(ticker)
        out = []
        with _lock:
            for f in edgar.Company(cik or ticker).get_filings(form="8-K"):
                if "2.02" not in str(getattr(f, "items", "") or ""):
                    continue
                ex = [a for a in f.attachments if str(a.document_type).upper().startswith("EX-99")]
                if not ex:
                    continue
                path = f"/Archives/edgar/data/{cik}/{f.accession_no.replace('-', '')}/{ex[0].document}"
                out.append({"filed": str(f.filing_date), "accession": f.accession_no, "path": path,
                            "url": f"https://www.sec.gov{path}"})
                if len(out) >= N_RELEASES:
                    break
        return out

    return db.cached(f"releases:list:{ticker}", db.DAY, fetch)["data"] or []


def _release_tables(rel: dict) -> list[dict]:
    def fetch():
        from ..sources.http import sec_headers, session
        from .. import ratelimit

        ratelimit.wait("sec")
        r = session().get(rel["url"], headers=sec_headers(), timeout=60)
        r.raise_for_status()
        return [{"context": t["context"], "rows": t["rows"]} for t in tables(r.text)]

    return db.cached(f"releases:tables:{rel['accession']}", 3650 * db.DAY, fetch)["data"] or []


def kpis(ticker: str, fiscal_ends: list[str]) -> dict | None:
    """Quarterly history of the configured metrics, newest last. None if the company isn't configured."""
    ticker = ticker.upper()
    cfg = (config().get("companies") or {}).get(ticker) or {}
    if not cfg.get("release"):
        return None
    rels = _release_list(ticker)
    quarters = []
    for rel in reversed(rels):
        try:
            tabs = _release_tables(rel)
        except Exception as e:  # noqa: BLE001
            quarters.append({"end": _quarter_end(rel["filed"], fiscal_ends), "release": rel, "error": str(e), "values": {}, "prior": {}})
            continue
        vals, prior = {}, {}
        for m in cfg["release"]:
            vals[m["key"]], prior[m["key"]] = _find(tabs, m)
        quarters.append({"end": _quarter_end(rel["filed"], fiscal_ends), "release": rel, "values": vals, "prior": prior})
    for d in cfg.get("derived", []):
        num, den = d["ratio"]
        for q in quarters:
            for src, dst in ((q["values"], q["values"]), (q["prior"], q["prior"])):
                a, b = src.get(num), src.get(den)
                dst[d["key"]] = a / b * d.get("scale", 1) if a is not None and b else None
    metrics = [{"key": m["key"], "label": m["label"], "kind": m.get("kind", "usd")} for m in cfg["release"]]
    names = {m["key"]: m["label"].lower() for m in cfg["release"]}
    metrics += [{"key": d["key"], "label": d["label"], "kind": d.get("kind", "pct"),
                 "derived": d.get("formula") or f"{names.get(d['ratio'][0], d['ratio'][0])} / {names.get(d['ratio'][1], d['ratio'][1])}"}
                for d in cfg.get("derived", [])]
    for q in quarters:
        q["yoy"] = {}
        for m in metrics:
            cur, pri = q["values"].get(m["key"]), q["prior"].get(m["key"])
            if cur is None or pri is None:
                q["yoy"][m["key"]] = None
            elif m["kind"] == "pct":  # change in a ratio = percentage-point difference
                q["yoy"][m["key"]] = cur - pri
            else:
                q["yoy"][m["key"]] = (cur / pri - 1) if pri > 0 else None
    order = [m["key"] for m in metrics]
    return {"source": "Earnings release (8-K Exhibit 99.1)", "metrics": metrics, "headline": cfg.get("headline", order[:6]), "quarters": quarters}
