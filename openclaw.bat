@echo off
title OpenClaw
"%~dp0node.exe" "%~dp0launcher.mjs"
echo.
echo Process exited. Code: %ERRORLEVEL%
if %ERRORLEVEL% NEQ 0 (
  echo Error occurred. Please screenshot this window.
  pause
)
