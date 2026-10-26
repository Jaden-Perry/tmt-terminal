"""FastAPI entry point. Run: uv run uvicorn app.main:app --port 8000"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .routers import company, core
from .services import prices, refresh, watchlists


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.conn()
    watchlists.seed_from_config()
    _maybe_top_up()
    task = asyncio.create_task(_watch_close())
    yield
    task.cancel()


def _maybe_top_up() -> None:
    """Price top-up whenever a market close has happened since the last full refresh (cheap; the nightly job does the heavy work)."""
    n_px = db.conn().execute("SELECT COUNT(DISTINCT ticker) FROM prices").fetchone()[0]
    n_univ = db.conn().execute("SELECT COUNT(*) FROM universe").fetchone()[0]
    if prices.needs_daily_refresh() or n_px < 0.9 * n_univ or not prices.last_date("SPY"):
        refresh.run_in_background("daily", refresh.daily_quick)


async def _watch_close() -> None:
    # If the app is left open across a market close, pick up the new prices without a restart
    while True:
        await asyncio.sleep(15 * 60)
        try:
            _maybe_top_up()
        except Exception as e:  # noqa: BLE001
            print(f"[watch_close] {e}")


app = FastAPI(title="TMT Terminal", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(core.router)
app.include_router(company.router)
