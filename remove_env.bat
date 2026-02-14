@echo off
cd /d d:\GitHub\YorkHackathon2026

echo Checking if backend/.env is tracked...
git ls-files backend/.env

echo.
echo Removing backend/.env from git cache...
git rm --cached backend/.env

echo.
echo Adding commit...
git commit -m "Remove .env from tracking"

echo.
echo Checking git log for backend/.env...
git log --all --oneline --full-history -- backend/.env

echo.
echo Done!
pause
