@echo off
title Update Libraries

cd /d "%~dp0"
set VENV_DIR=.venv

if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found. Run "Start Automation" first.
    pause
    exit /b
)

call "%VENV_DIR%\Scripts\activate.bat"
echo Checking and updating required libraries...
pip install -r requirements.txt
echo.
echo Playwright browsers...
playwright install chromium
echo.
echo [SUCCESS] Libraries are up to date!
pause
exit
