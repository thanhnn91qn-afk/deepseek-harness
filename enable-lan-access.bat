@echo off
setlocal

net session >nul 2>nul
if errorlevel 1 (
  echo This script needs Administrator rights ^(it configures a port
  echo forward and firewall rules^). Right-click it and choose
  echo "Run as administrator", then try again.
  pause
  exit /b 1
)

echo ============================================
echo  Opening LAN access for dsh web + proxy
echo ============================================
echo.
echo  !!! SECURITY WARNING - READ BEFORE CONTINUING !!!
echo.
echo  dsh's own web app deliberately refuses to bind LAN interfaces:
echo    "error: --host 0.0.0.0 is intentionally not supported yet for
echo     safety: it would expose remote code execution to the network"
echo.
echo  The dsh agent can run shell commands and edit any file on this
echo  machine. There is NO login/password on the web UI or on
echo  dsh-openai-proxy. This script bypasses dsh's built-in guard with
echo  an OS-level port forward - it does NOT add authentication.
echo.
echo  After running this, ANY device on your LAN (including guests,
echo  IoT devices, or a compromised device) can open the web UI or
echo  proxy and run arbitrary commands on this machine. Only continue
echo  if you fully trust every device on this network.
echo.
set /p CONFIRM="Type YES to continue, anything else to cancel: "
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled. Nothing was changed.
  pause
  exit /b 0
)

echo.
echo  This machine's LAN IPv4 addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do echo   %%a

echo.
echo  dsh web (127.0.0.1:3080) does not accept LAN connections
echo  directly by design, so this forwards traffic arriving on any
echo  interface at port 3080 to it. dsh-openai-proxy already binds
echo  0.0.0.0:8787 itself (started by DshStack.exe), so it only needs
echo  a firewall rule, no port forward.
echo.

netsh interface portproxy delete v4tov4 listenport=3080 listenaddress=0.0.0.0 >nul 2>nul
netsh interface portproxy add v4tov4 listenport=3080 listenaddress=0.0.0.0 connectport=3080 connectaddress=127.0.0.1
if errorlevel 1 (
  echo [ERROR] Failed to add the port forward for 3080.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="dsh web (LAN)" >nul 2>nul
netsh advfirewall firewall add rule name="dsh web (LAN)" dir=in action=allow protocol=TCP localport=3080
netsh advfirewall firewall delete rule name="dsh-openai-proxy (LAN)" >nul 2>nul
netsh advfirewall firewall add rule name="dsh-openai-proxy (LAN)" dir=in action=allow protocol=TCP localport=8787

echo.
echo ============================================
echo  Done. From another machine on the LAN, use:
echo    http://THIS-MACHINE-IP:3080       (dsh web)
echo    http://THIS-MACHINE-IP:8787/v1    (OpenAI proxy - NO AUTH)
echo.
echo  dsh-openai-proxy has no authentication. Anyone on this LAN can
echo  call it. Only run this on a network you trust.
echo.
echo  To undo later (run as administrator):
echo    netsh interface portproxy delete v4tov4 listenport=3080 listenaddress=0.0.0.0
echo    netsh advfirewall firewall delete rule name="dsh web (LAN)"
echo    netsh advfirewall firewall delete rule name="dsh-openai-proxy (LAN)"
echo ============================================
pause
