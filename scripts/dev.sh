#!/bin/bash
# =====================================================================
# Start Play Anything in Browser Local Dev Server
# =====================================================================
set -e

if [ ! -d ".venv" ]; then
  echo "Creating virtualenv..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
else
  source .venv/bin/activate
fi

if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Starting Play Anything in Browser at http://127.0.0.1:8000"
python3 -m uvicorn app:app --host 127.0.0.1 --port ${PORT:-8000} --reload
