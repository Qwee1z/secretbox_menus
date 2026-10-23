@echo off
rem Локальный сервер для просмотра сайта: браузер не даёт читать JSON со страницы, открытой как файл.
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000
