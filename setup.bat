@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  DeepSeek Harness stack - setup / update
echo ============================================
echo.

if exist ".git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo [0/5] Pulling latest changes from GitHub...
    git pull
    if errorlevel 1 (
      echo [WARN] git pull failed - continuing with the code already on disk.
      echo        ^(commonly local edits conflicting with the update; resolve
      echo        manually with "git status" / "git stash" then re-run.^)
    )
    echo.
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org and re-run this script.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [1/5] Installing pnpm...
  call npm install -g pnpm
  if errorlevel 1 (
    echo [ERROR] Failed to install pnpm.
    pause
    exit /b 1
  )
) else (
  echo [1/5] pnpm already installed, skipping.
)

echo [2/5] Installing dsh dependencies (this can take a few minutes)...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install failed.
  pause
  exit /b 1
)

echo [3/5] Building dsh...
call pnpm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo [4/6] Installing proxy dependencies...
pushd dsh-openai-proxy
call npm install
popd

echo [5/6] Checking model provider config...
if not exist "%USERPROFILE%\.dsh" mkdir "%USERPROFILE%\.dsh"
if exist "%USERPROFILE%\.dsh\settings.yaml" (
  echo       %USERPROFILE%\.dsh\settings.yaml already exists, leaving it as-is.
) else (
  echo       Creating %USERPROFILE%\.dsh\settings.yaml with the LM Studio provider...
  (
    echo llm-pi-ai:
    echo   providers:
    echo     lmstudio:
    echo       displayName: LM Studio Local
    echo       apiKeyEnv: LMSTUDIO_API_KEY
    echo       api: openai-completions
    echo       baseURL: http://192.168.1.71:1234/v1
    echo       models:
    echo         - id: google/gemma-4-12b
    echo(
    echo agent-default-model:
    echo   provider: lmstudio
    echo   model: google/gemma-4-12b
  ) > "%USERPROFILE%\.dsh\settings.yaml"
  echo       Done. Edit that file if LM Studio runs at a different address.
)

echo [6/6] Checking for .NET 8 SDK...
set "HAVE_SDK8=0"
for /f "delims=" %%v in ('dotnet --list-sdks 2^>nul') do (
  echo %%v | findstr /b "8." >nul && set "HAVE_SDK8=1"
)

if "!HAVE_SDK8!"=="0" (
  echo       .NET 8 SDK not found. Installing it to a local user folder
  echo       ^(no admin rights needed - Microsoft's official installer script^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -UseBasicParsing https://dot.net/v1/dotnet-install.ps1 -OutFile '%TEMP%\dotnet-install.ps1'; & '%TEMP%\dotnet-install.ps1' -Channel 8.0 -InstallDir '%USERPROFILE%\.dotnet'"
  set "PATH=%USERPROFILE%\.dotnet;%PATH%"

  set "HAVE_SDK8=0"
  for /f "delims=" %%v in ('dotnet --list-sdks 2^>nul') do (
    echo %%v | findstr /b "8." >nul && set "HAVE_SDK8=1"
  )
)

if "!HAVE_SDK8!"=="0" (
  echo.
  echo [SKIP] Could not install .NET 8 SDK automatically - skipping DshStackLauncher build.
  echo        Install it yourself from https://dotnet.microsoft.com/download/dotnet/8.0
  echo        then re-run this script, or run this from the DshStackLauncher folder:
  echo        dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
  goto done
)

echo       Building DshStack.exe...
pushd DshStackLauncher
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
set "PUBLISH_RESULT=!errorlevel!"
popd

if not "!PUBLISH_RESULT!"=="0" (
  echo.
  echo [ERROR] DshStackLauncher build failed - see output above. DshStack.exe was NOT created.
  pause
  exit /b 1
)

copy /y "DshStackLauncher\publish\DshStackLauncher.exe" "DshStack.exe" >nul
echo       DshStack.exe created at %cd%\DshStack.exe

:done
echo.
echo ============================================
echo  Setup complete.
if exist "DshStack.exe" (
  echo  Run DshStack.exe to start the web UI + proxy.
) else (
  echo  DshStack.exe was not built - see [SKIP]/[ERROR] messages above.
  echo  You can still run the web UI and proxy manually:
  echo    pnpm dsh web
  echo    node dsh-openai-proxy\server.js
)
echo  Don't forget to configure your model provider:
echo  see the harness docs and dsh-openai-proxy\README.md.
echo ============================================
pause
