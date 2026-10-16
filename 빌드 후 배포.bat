@echo off
rem This launcher stays ASCII-only on purpose.
rem cmd reads a batch file using the console code page from the moment it starts,
rem and npm switches that code page to UTF-8 mid-run. Any Korean path written here
rem would break at that point, so all real work lives in deploy.ps1 instead.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
if errorlevel 1 exit /b 1
exit /b 0
