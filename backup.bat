@echo off
rem Copy the content (data\ and assets\) into a new dated snapshot folder.
rem See docs\backup-restore.md
setlocal
cd /d "%~dp0"
if exist "backend\.venv\Scripts\python.exe" (
  "backend\.venv\Scripts\python.exe" backend\app\content_backup.py backup %*
) else (
  py -3 backend\app\content_backup.py backup %*
)
echo.
pause
