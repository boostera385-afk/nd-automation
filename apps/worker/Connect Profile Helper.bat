@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "install_desktop_bridge.py" --connect-helper
) else (
  py -3.13 "install_desktop_bridge.py" --connect-helper
)
if errorlevel 1 (
  echo Connection was not saved. Existing private connections are never overwritten.
  pause
)
endlocal
