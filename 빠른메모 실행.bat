@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" goto missing

start "" "node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0

:missing
echo.
echo   실행에 필요한 파일이 없습니다.
echo   이 폴더에서 npm install 을 먼저 실행해 주세요.
echo.
pause
exit /b 1
