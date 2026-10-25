#!/usr/bin/env bash
# Run the nightly universe refresh once (safe to run any time; it resumes from cache).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
cd "$ROOT/backend" && exec uv run python -m jobs.nightly --minutes "${1:-120}"
