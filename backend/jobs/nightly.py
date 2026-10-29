"""Nightly batch: slowly refreshes the whole universe inside free-tier limits.

    cd backend && uv run python -m jobs.nightly            # default 120-minute budget
    cd backend && uv run python -m jobs.nightly --minutes 30

Everything is cached, so if the budget runs out the next run resumes where this one stopped
(cache TTLs: prices daily, fundamentals/estimates weekly, universe monthly; financials also refresh on a new 10-Q/10-K).
"""
from __future__ import annotations

import argparse
import time

from app import db
from app.main import app  # noqa: F401  (imports every service so refreshers register)
from app.services import refresh, watchlists


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=120)
    args = ap.parse_args()
    db.conn()
    watchlists.seed_from_config()
    t0 = time.time()
    jid = refresh._log_start("nightly")
    try:
        out = refresh.nightly(max_minutes=args.minutes)
        refresh._log_end(jid, "ok", str(out))
        print(f"[nightly] done in {(time.time() - t0) / 60:.1f} min: {out}")
    except Exception as e:
        refresh._log_end(jid, "error", repr(e))
        raise


if __name__ == "__main__":
    main()
