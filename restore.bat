@echo off
rem Put a snapshot's content back into data\ and assets\ (asks before changing anything).
rem See docs\backup-restore.md
setlocal
cd /d "%~dp0"
if exist "backend\.venv\Scripts\python.exe" (
  "backend\.venv\Scripts\python.exe" backend\app\content_backup.py restore %*
) else (
  py -3 backend\app\content_backup.py restore %*
)
echo.
pause
