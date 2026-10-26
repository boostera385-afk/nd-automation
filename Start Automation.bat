@echo off
title Nextdoor Automation Setup and Launcher

:: Change directory to where the batch file is located
cd /d "%~dp0"

:: 1. Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 goto no_python
goto python_ok

:no_python
echo [ERROR] Python is not installed or not added to PATH.
echo The automation software requires Python to run.
echo.
echo Would you like to try installing it automatically via Windows Package Manager?
echo (Press Y for Yes, N for No)
choice /c YN /n
if errorlevel 2 goto manual_install
if errorlevel 1 goto auto_install

:auto_install
echo.
echo Installing Python 3.11... Please wait.
winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements
echo.
echo [SUCCESS] Python has been installed! 
echo PLEASE CLOSE THIS WINDOW AND DOUBLE CLICK "Start Automation" AGAIN.
pause
exit /b

:manual_install
echo.
echo Please manually download and install Python from: https://www.python.org/downloads/
echo.
echo *** IMPORTANT: Check the box "Add Python to PATH" during installation! ***
echo.
pause
exit /b

:python_ok
:: 2. Setup Virtual Environment (VENV)
set VENV_DIR=.venv
if exist "%VENV_DIR%\Scripts\activate.bat" goto launch

echo [SETUP] First time setup detected! Creating virtual environment...
python -m venv %VENV_DIR%
call "%VENV_DIR%\Scripts\activate.bat"

echo [SETUP] Checking and installing required libraries...
pip install -r requirements.txt

echo [SETUP] Ensuring browser automation drivers are installed...
playwright install chromium

:launch
:: Activate the environment and Launch Application
call "%VENV_DIR%\Scripts\activate.bat"
start "" pythonw main.py

:: Close this terminal
exit
