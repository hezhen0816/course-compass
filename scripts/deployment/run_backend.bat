@echo off
rem Course Compass backend - restart loop for Windows.
rem Registered in Task Scheduler as "Course_Compass_Backend" (run at startup, S4U, no login needed).
rem Expects a venv at .venv\ and .env in the repo root. Listens on 0.0.0.0:8000 (reach via Tailscale).
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1
if not exist logs mkdir logs
:loop
for %%F in (logs\backend.log) do if %%~zF GTR 10485760 move /y logs\backend.log logs\backend.log.1 > nul
echo [%date% %time%] starting backend >> logs\backend.log
".venv\Scripts\python.exe" -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000 --env-file .env >> logs\backend.log 2>&1
echo [%date% %time%] backend exited with code %errorlevel%, restarting in 30s >> logs\backend.log
ping -n 31 127.0.0.1 > nul
goto loop
