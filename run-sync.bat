@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Pirmo reizi sagatavoju nepieciesamo bibliotku, uzgaidi minuti...
  call npm install
)
echo Running Zalans / Saatchi Art sync...
node local-sync.mjs
echo.
echo Done. This window will close in 10 seconds.
timeout /t 10
