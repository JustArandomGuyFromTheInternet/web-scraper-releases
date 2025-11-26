@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo      WEB SCRAPER INSTALLER & LAUNCHER
echo ===================================================
echo.

:: 1. Check for Node.js
echo [1/5] Checking Node.js installation...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is NOT installed. Downloading and installing...
    echo This requires Administrator privileges. Please accept the prompt.
    
    :: Download Node.js MSI (LTS version)
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile 'node_installer.msi'"
    
    :: Install Node.js silently
    msiexec /i node_installer.msi /qn
    
    :: Clean up
    del node_installer.msi
    
    echo Node.js installed. Please restart this script to continue.
    pause
    exit
) else (
    echo Node.js is already installed.
)

:: 2. Check for Chrome
echo [2/5] Checking Chrome installation...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo Chrome is found.
) else (
    if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
        echo Chrome is found.
    ) else (
        echo Chrome not found. It is recommended for best performance.
        echo Please install Google Chrome manually if scraping fails.
    )
)

:: 3. Install Dependencies
echo [3/5] Installing application dependencies...
if not exist "node_modules" (
    call npm install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies. Check internet connection.
        pause
        exit
    )
) else (
    echo Dependencies already installed.
)

:: 4. Install Puppeteer Browsers
echo [4/5] Setting up browser automation...
call npx puppeteer browsers install chrome
if %errorlevel% neq 0 (
    echo Warning: Failed to download Puppeteer browser. Using system Chrome.
)

:: 5. Create Shortcut
echo [5/5] Creating Desktop Shortcut...
set "SCRIPT_PATH=%~dp0start.bat"
set "ICON_PATH=%~dp0ICON-modified.png"
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Web Scraper.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%SCRIPT_PATH%'; $s.IconLocation = '%ICON_PATH%'; $s.Save()"

echo.
echo ===================================================
echo      INSTALLATION COMPLETE!
echo ===================================================
echo.
echo You can now launch the app from your Desktop.
echo.
pause
