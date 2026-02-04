#!/bin/bash
set -euo pipefail

# Stop TigerBeetle development instance

DATA_DIR="${HOME}/.tigerbeetle/data"
PID_FILE="$DATA_DIR/tigerbeetle.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "ℹ️  TigerBeetle not running (no PID file)"
  exit 0
fi

PID=$(cat "$PID_FILE")

if ps -p "$PID" > /dev/null 2>&1; then
  echo "🛑 Stopping TigerBeetle (PID: $PID)..."
  kill "$PID"

  # Wait for graceful shutdown
  for i in {1..10}; do
    if ! ps -p "$PID" > /dev/null 2>&1; then
      echo "✅ TigerBeetle stopped"
      rm "$PID_FILE"
      exit 0
    fi
    sleep 1
  done

  # Force kill if still running
  echo "⚠️  Forcing shutdown..."
  kill -9 "$PID" 2>/dev/null || true
  rm "$PID_FILE"
  echo "✅ TigerBeetle stopped (forced)"
else
  echo "ℹ️  TigerBeetle not running (stale PID file)"
  rm "$PID_FILE"
fi
