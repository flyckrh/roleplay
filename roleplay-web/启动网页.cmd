@echo off
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Please set ADMIN_PASSWORD in .env, save, then close Notepad.
  start /wait notepad .env
)
call node build.mjs
if errorlevel 1 goto finish
call node --env-file=.env server.mjs
:finish
pause
