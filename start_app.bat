@echo off
echo ========================================================
echo TN FOREST DEPARTMENT - RF/RL BOUNDARY SURVEY PLATFORM
echo Starting Local GIS Web Server (Permanent Location Saved)
echo ========================================================
echo.
cd /d "%~dp0"

echo Opening http://localhost:8080 in your browser...
start "" "http://localhost:8080"

python -m http.server 8080
if %errorlevel% neq 0 (
    echo Python not found, opening index.html directly...
    start "" "index.html"
)
pause
