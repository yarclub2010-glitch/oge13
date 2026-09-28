@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Загружаю изменения с GitHub...
git pull --rebase --autostash || goto error

git add -A
git diff --cached --quiet && (
  echo Локальных изменений нет.
  goto done
)

set /p msg="Что изменилось (Enter - без описания): "
if "%msg%"=="" set msg=Обновление %date% %time:~0,5%
git commit -q -m "%msg%" || goto error

echo Отправляю на GitHub...
git push || goto error
echo Готово! Сайт обновится примерно через минуту.

:done
pause
exit /b 0

:error
echo.
echo Что-то пошло не так - прочитайте сообщение выше.
pause
exit /b 1
