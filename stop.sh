#!/usr/bin/env bash
# F1SION Process Terminator
# Gracefully stops all F1SION backend and frontend processes.

echo "🏁 Stopping all F1SION processes..."

# 1. Kill any active uvicorn backend instances
pkill -f "uvicorn app.main:app" 2>/dev/null && echo "   • FastAPI backend stopped." || echo "   • No backend process found."

# 2. Kill any active Vite development servers
pkill -f "vite" 2>/dev/null && echo "   • Vite frontend server stopped." || echo "   • No frontend process found."

echo ""
echo "✅ All F1SION processes cleanly terminated."

