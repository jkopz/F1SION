#!/usr/bin/env bash
# F1SION Development Runner
# Ensures ports are clear, then starts FastAPI backend (8000) and Vite frontend (5173).

set -e

# 1. Clear any lingering processes on ports 8000 and 5173 first
echo "Checking ports..."
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 0.5

cleanup() {
  echo ""
  echo "🏁 Stopping F1SION development servers..."
  kill $(jobs -p) 2>/dev/null || true
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true
  echo "✅ All servers stopped cleanly."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "=========================================================="
echo "🏎️  F1SION — Beyond the race. Into the data.               "
echo "=========================================================="

# 2. Start FastAPI Backend
echo "Starting FastAPI backend on http://127.0.0.1:8000 ..."
cd backend
PYTHONPATH=. .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
cd ..

# 3. Wait for backend to be ready
sleep 2

# 4. Start Frontend with strict port 5173
echo "Starting Vite frontend on http://localhost:5173 ..."
cd frontend
export PATH="/opt/homebrew/bin:$PATH"
npx vite --host 127.0.0.1 --port 5173 --strictPort &
FRONTEND_PID=$!
cd ..

# 5. Wait for frontend to be ready
sleep 2

echo ""
echo "✅ Both servers are online!"
echo "   • Frontend Dashboard:  http://localhost:5173"
echo "   • Backend API Docs:    http://127.0.0.1:8000/docs"
echo ""
echo "🌐 Opening browser automatically..."

# Auto-open browser (works on macOS, Linux, and Windows with appropriate command)
if command -v open &> /dev/null; then
    open "http://localhost:5173"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:5173"
elif command -v start &> /dev/null; then
    start "" "http://localhost:5173"
else
    echo "   Could not auto-open browser. Please visit http://localhost:5173 manually."
fi

echo ""
echo "👉 HOW TO STOP PROPERLY:"
echo "   1. Press Ctrl + C in this terminal window"
echo "   2. OR click the red 'STOP' button in the dashboard header"
echo "   3. OR run './stop.sh' from any other terminal"
echo "=========================================================="
echo ""

wait
