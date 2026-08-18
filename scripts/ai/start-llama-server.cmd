@echo off
REM ---------------------------------------------------------------------------------------------
REM G1-E (2026-08-16) -- thin .cmd wrapper for start-llama-server.ps1
REM
REM ASCII ONLY, deliberately: cmd.exe parses batch files in the console OEM codepage, so UTF-8
REM Vietnamese comments here get mangled into garbage tokens and the file self-destructs at parse
REM time (observed: an endless "'hon' is not recognized" loop). All Vietnamese documentation lives
REM in start-llama-server.ps1 (PowerShell reads UTF-8 correctly).
REM
REM Why this wrapper exists: Task Scheduler / shortcuts / double-click call a .cmd far more easily
REM than a full "powershell -ExecutionPolicy Bypass -File ..." command line. This file duplicates
REM NO parameters -- all logic (reads .env, idempotent port check, waits for /health) is in the .ps1.
REM
REM Usage:
REM   scripts\ai\start-llama-server.cmd            (normal -- idempotent, exits 0 if already up)
REM   scripts\ai\start-llama-server.cmd -Force     (stop the existing llama-server, then restart)
REM
REM Exit codes: 0 ready/already-running | 2 bad config | 3 port taken by something else
REM             4 process died on startup | 5 timed out waiting for /health
REM ---------------------------------------------------------------------------------------------
setlocal
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0start-llama-server.ps1" %*
exit /b %ERRORLEVEL%
