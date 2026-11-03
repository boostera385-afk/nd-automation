@echo off
rem One-time employee setup: launcher connection, then private helper
rem connection, in a single run. Nothing downloads, nothing auto-starts.
setlocal
cd /d "%~dp0"
echo Step 1 of 2: connect the Open Incogniton launcher on this computer.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "install_desktop_bridge.py"
) else (
  py -3.13 "install_desktop_bridge.py"
)
if errorlevel 1 (
  echo Step 1 did not finish. Python 3.13 with Tkinter and a trusted Incogniton installation are required.
  pause
  endlocal
  exit /b 1
)
echo Step 2 of 2: select the private helper connection your owner downloaded for you.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "install_desktop_bridge.py" --connect-helper
) else (
  py -3.13 "install_desktop_bridge.py" --connect-helper
)
if errorlevel 1 (
  echo Step 2 did not finish. Existing private connections are never overwritten.
  pause
  endlocal
  exit /b 1
)
echo Setup finished. If you skipped selecting a connection file, run this file again after getting it from your owner.
echo Sign in to the dashboard with your own confirmed email address.
pause
endlocal
