#!/usr/bin/env bash
# Update a VM install to the latest code: backup → pull → install → build → restart.
# Run from /opt/peoplehub as the peoplehub user (or with sudo -u peoplehub).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
echo "1/5 Backing up…";          npm run backup
echo "2/5 Pulling latest code…";  git pull --ff-only
echo "3/5 Installing packages…";  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
echo "4/5 Building the web app…"; npm run build
if command -v go >/dev/null 2>&1; then npm run agent:build; else echo "   (Go not installed: skipping desktop agent builds)"; fi
echo "5/5 Restarting…";           sudo systemctl restart peoplehub
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null && echo "PeopleHub is up." || { echo "Health check failed: sudo journalctl -u peoplehub -n 50"; exit 1; }
