@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=8080"
set "URL=http://localhost:%PORT%"

if /i "%~1"=="stop" goto :stop

rem Serveur deja actif sur ce port ?
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%'|Out-Null;exit 0}catch{exit 1}"
if %errorlevel%==0 (
  echo Serveur deja actif sur %URL% — ouverture du navigateur.
  start "" "%URL%"
  goto :eof
)

rem Ouvrir le navigateur des que le serveur repond (surveillant detaché)
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 50;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%'|Out-Null;break}catch{Start-Sleep -Milliseconds 200}}; Start-Process '%URL%'"

echo Canyon Run : %URL%
echo Fermez cette fenetre pour arreter le serveur.
node server.js
goto :eof

:stop
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){Stop-Process -Id $c.OwningProcess -Force; Write-Host ('Serveur arrete (PID ' + $c.OwningProcess + ').')}else{Write-Host 'Aucun serveur en cours dexecution sur le port %PORT%.'}"
