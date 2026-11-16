@echo off
cd /d "%~dp0"
echo Syncing latest daily cloud-scraped market data from GitHub...
git checkout -- market_research.db static/snapshot.json >nul 2>&1
git pull --ff-only origin main
echo Starting Handyman Market Research Dashboard on http://localhost:8765 ...
start "" "http://localhost:8765"
python app.py --port 8765
pause
