#!/bin/bash
set -euo pipefail

# Start TigerBeetle for local development
# Auto-detects Docker vs native installation

DATA_DIR="${HOME}/.tigerbeetle/data"
DATA_FILE="$DATA_DIR/0_0.tigerbeetle"
PID_FILE="$DATA_DIR/tigerbeetle.pid"

# Check if TigerBeetle is already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "✅ TigerBeetle already running (PID: $PID)"
    exit 0
  else
    # Stale PID file
    rm "$PID_FILE"
  fi
fi

# Check if native binary is installed (check both PATH and ~/.local/bin)
if command -v tigerbeetle &> /dev/null || [ -x "$HOME/.local/bin/tigerbeetle" ]; then
  # Use PATH version if available, otherwise use explicit path
  if command -v tigerbeetle &> /dev/null; then
    TB_CMD="tigerbeetle"
  else
    TB_CMD="$HOME/.local/bin/tigerbeetle"
  fi
  echo "🚀 Starting TigerBeetle natively..."

  # Ensure data directory exists
  if [ ! -f "$DATA_FILE" ]; then
    echo "📁 Data file not found. Run: npm run tigerbeetle:install"
    exit 1
  fi

  # Start in background
  nohup "$TB_CMD" start \
    --addresses=127.0.0.1:3000 \
    "$DATA_FILE" \
    > "$DATA_DIR/tigerbeetle.log" 2>&1 &

  TB_PID=$!
  echo $TB_PID > "$PID_FILE"

  # Wait for startup
  sleep 2

  # Verify it started
  if ps -p $TB_PID > /dev/null; then
    echo "✅ TigerBeetle started (PID: $TB_PID)"
    echo "📊 Listening on: 127.0.0.1:3000"
    echo "📝 Logs: $DATA_DIR/tigerbeetle.log"
  else
    echo "❌ TigerBeetle failed to start. Check logs:"
    tail -20 "$DATA_DIR/tigerbeetle.log"
    exit 1
  fi

else
  echo "⚠️  Native TigerBeetle not found."
  echo ""
  echo "To install TigerBeetle for macOS development:"
  echo "  npm run tigerbeetle:install"
  echo ""
  echo "Or use Docker deployment:"
  echo "  ./scripts/deploy-5-peer-multihop.sh"
  exit 1
fi
