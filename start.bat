@echo off
chcp 65001 >nul
title Skills Manager
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo.
echo 正在启动 skills 管理工具...
echo 浏览器访问：http://localhost:3456
echo 关闭本窗口即可停止服务。
echo.
call npm start

echo.
echo 服务已停止。
pause
