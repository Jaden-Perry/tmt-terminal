"""FastAPI entry point. Run: uv run uvicorn app.main:app --port 8000"""
from __future__ import annotations

import datetime as dt
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
    # Daily top-up on startup if prices are older than today (cheap; heavy work is the nightly job).
    last = db.cache_get("prices:last_refresh")
    n_px = db.conn().execute("SELECT COUNT(DISTINCT ticker) FROM prices").fetchone()[0]
    n_univ = db.conn().execute("SELECT COUNT(*) FROM universe").fetchone()[0]
    stale = last is None or dt.date.fromtimestamp(last[0]["at"]) < dt.date.today()
    if stale or n_px < 0.9 * n_univ or not prices.last_date("SPY"):
        refresh.run_in_background("daily", refresh.daily_quick)
    yield


app = FastAPI(title="TMT Terminal", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(core.router)
app.include_router(company.router)
