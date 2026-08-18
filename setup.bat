@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  DeepSeek Harness stack - one-time setup
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org and re-run this script.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [1/4] Installing pnpm...
  call npm install -g pnpm
  if errorlevel 1 (
    echo [ERROR] Failed to install pnpm.
    pause
    exit /b 1
  )
) else (
  echo [1/4] pnpm already installed, skipping.
)

echo [2/4] Installing dsh dependencies (this can take a few minutes)...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install failed.
  pause
  exit /b 1
)

echo [3/4] Building dsh...
call pnpm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo [4/4] Installing proxy dependencies...
pushd dsh-openai-proxy
call npm install
popd

where dotnet >nul 2>nul
if errorlevel 1 (
  echo.
  echo [SKIP] .NET SDK not found - skipping DshStackLauncher build.
  echo        Install it from https://dotnet.microsoft.com/download to get DshStack.exe.
  goto done
)

echo [5/5] Building DshStack.exe...
pushd DshStackLauncher
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
popd
copy /y "DshStackLauncher\publish\DshStackLauncher.exe" "DshStack.exe" >nul

:done
echo.
echo ============================================
echo  Setup complete.
echo  Run DshStack.exe to start the web UI + proxy.
echo  Don't forget to configure your model provider:
echo  see the harness docs and dsh-openai-proxy\README.md.
echo ============================================
pause
