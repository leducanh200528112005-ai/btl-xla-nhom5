@echo off
rem Start FastAPI on port 8000; run npm.cmd run dev separately in frontend.
rem Binds 0.0.0.0 so other devices on the LAN can reach it; restrict CORS via RESIM_CORS_ORIGINS.
rem Uses the backend virtualenv directly; activation is not required.
setlocal
cd /d "%~dp0"
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
