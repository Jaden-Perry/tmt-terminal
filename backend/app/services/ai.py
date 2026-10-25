"""Optional AI summary of why a stock moved, grounded only in retrieved headlines/filings.

Guardrails: generated only on click; every result cached forever (never regenerated);
hard monthly spending cap checked *before* each call using a worst-case cost estimate.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time

from .. import db
from ..config import AI_MODEL, AI_MONTHLY_CAP_USD, ANTHROPIC_API_KEY

# USD per million tokens (input, output). Unknown models are priced conservatively.
PRICES = {"claude-haiku-5-5": (0.10, 0.50), "claude-haiku-4-5": (1.00, 5.00)}
FALLBACK_PRICE = (4.00, 20.00)
MAX_OUTPUT_TOKENS = 1200

SYSTEM = """You explain stock price moves for an equity research analyst.
Use ONLY the numbered sources provided (headlines, SEC filings, earnings events). Do not use outside knowledge.
Write 2-4 sentences naming the most likely cause, citing sources inline like [3]. If the sources don't
explain the move, say so plainly (e.g. "No company-specific catalyst in the retrieved sources; the move may
reflect sector or market factors") and mention the sector-relative move if given. Never speculate beyond the sources."""


def _price() -> tuple[float, float]:
    return PRICES.get(AI_MODEL, FALLBACK_PRICE)


def month_spend() -> dict:
    start = dt.date.today().replace(day=1)
    ts0 = time.mktime(start.timetuple())
    r = db.conn().execute("SELECT COALESCE(SUM(cost_usd),0), COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) "
                          "FROM ai_usage WHERE ts >= ?", (ts0,)).fetchone()
    total = db.conn().execute("SELECT COALESCE(SUM(cost_usd),0), COUNT(*) FROM ai_usage").fetchone()
    cached = db.conn().execute("SELECT COUNT(*) FROM ai_cache").fetchone()[0]
    return {"month": start.strftime("%Y-%m"), "spent_usd": r[0], "calls": r[1], "input_tokens": r[2], "output_tokens": r[3],
            "cap_usd": AI_MONTHLY_CAP_USD, "remaining_usd": max(0.0, AI_MONTHLY_CAP_USD - r[0]),
            "all_time_usd": total[0], "all_time_calls": total[1], "cached_explanations": cached,
            "model": AI_MODEL, "enabled": bool(ANTHROPIC_API_KEY), "price_per_mtok": _price()}


def cached(key: str) -> dict | None:
    row = db.conn().execute("SELECT result, created_at FROM ai_cache WHERE key=?", (key,)).fetchone()
    return {**json.loads(row[0]), "created_at": row[1], "cached": True} if row else None


def explain(key: str, ticker: str, move: dict, sources: list[dict]) -> dict:
    hit = cached(key)
    if hit:
        return hit
    if not ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY isn't set. Showing headlines only."}
    if not sources:
        return {"error": "No headlines or filings were retrieved for this window, so there's nothing to summarize (no call made)."}

    lines = [f"Ticker: {ticker}", f"Move: {move.get('label')}"]
    lines += [f"[{i + 1}] {s['date']} {s['kind'].upper()}: {s['text']}" for i, s in enumerate(sources)]
    prompt = "\n".join(lines)
    pin, pout = _price()
    worst = (len(prompt) / 3 + 400) * pin / 1e6 + MAX_OUTPUT_TOKENS * pout / 1e6
    spend = month_spend()
    if spend["spent_usd"] + worst > AI_MONTHLY_CAP_USD:
        return {"error": f"Monthly AI cap reached (${spend['spent_usd']:.4f} of ${AI_MONTHLY_CAP_USD:.2f} used). "
                         "Raise AI_MONTHLY_CAP_USD in .env or wait until next month."}

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY, max_retries=1, timeout=60)
    try:
        resp = client.messages.create(
            model=AI_MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            output_config={"effort": "low"},
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        return {"error": "Anthropic rejected the API key (check ANTHROPIC_API_KEY)."}
    except anthropic.RateLimitError:
        return {"error": "Anthropic rate limit hit. Try again in a minute."}
    except anthropic.APIStatusError as e:
        return {"error": f"Anthropic API error {e.status_code}: {str(e.message)[:200]}"}
    except anthropic.APIConnectionError:
        return {"error": "Couldn't reach the Anthropic API."}

    usage = resp.usage
    cost = usage.input_tokens * pin / 1e6 + usage.output_tokens * pout / 1e6
    with db.tx() as c:
        c.execute("INSERT INTO ai_usage(ts, model, input_tokens, output_tokens, cost_usd, cache_key) VALUES (?,?,?,?,?,?)",
                  (time.time(), AI_MODEL, usage.input_tokens, usage.output_tokens, cost, key))
    if resp.stop_reason == "refusal":
        return {"error": "The model declined to summarize this window."}
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", text) if 0 < int(n) <= len(sources)})
    result = {"summary": text, "cited": cited, "sources": sources, "model": AI_MODEL, "cost_usd": cost,
              "ai_generated": True}
    with db.tx() as c:
        c.execute("INSERT OR REPLACE INTO ai_cache(key, result, created_at) VALUES (?,?,?)", (key, db.dumps(result), time.time()))
    return {**result, "created_at": time.time(), "cached": False}
