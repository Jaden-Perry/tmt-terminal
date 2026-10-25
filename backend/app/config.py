"""Settings loaded from the repo-root .env file. Keys are never hardcoded."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

CONFIG_DIR = ROOT / "config"
DATA_DIR = Path(os.getenv("TMT_DATA_DIR", ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "tmt.sqlite3"


def _get(name: str) -> str | None:
    v = os.getenv(name, "").strip()
    return v or None


SEC_USER_AGENT = _get("SEC_USER_AGENT")  # SEC requires "Name email@domain"
FINNHUB_API_KEY = _get("FINNHUB_API_KEY")
FMP_API_KEY = _get("FMP_API_KEY")
FRED_API_KEY = _get("FRED_API_KEY")
ANTHROPIC_API_KEY = _get("ANTHROPIC_API_KEY")
AI_MODEL = _get("AI_MODEL") or "claude-haiku-5-5"
AI_MONTHLY_CAP_USD = float(_get("AI_MONTHLY_CAP_USD") or 0.25)

# Daily budgets (kept below the providers' published free limits).
FMP_DAILY_BUDGET = int(_get("FMP_DAILY_BUDGET") or 200)  # free tier: 250/day


def key_status() -> dict:
    return {
        "sec_user_agent": bool(SEC_USER_AGENT),
        "finnhub": bool(FINNHUB_API_KEY),
        "fmp": bool(FMP_API_KEY),
        "fred": bool(FRED_API_KEY),
        "anthropic": bool(ANTHROPIC_API_KEY),
    }
