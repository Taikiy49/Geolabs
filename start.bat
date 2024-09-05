@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a
start "" /min cmd /c "cd /d %~dp0\backend && python app.py"
cd /d %~dp0
start cmd /k "npm start"
pause
