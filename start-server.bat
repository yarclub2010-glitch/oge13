@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:8000
echo Сервер запущен: http://localhost:8000
echo Чтобы остановить - закройте это окно.
python -m http.server 8000
