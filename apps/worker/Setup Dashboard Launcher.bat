@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "install_desktop_bridge.py"
) else (
  py -3.13 "install_desktop_bridge.py"
)
if errorlevel 1 (
  echo Setup did not finish. Python 3.13 with Tkinter and a trusted Incogniton installation are required.
  pause
)
endlocal
