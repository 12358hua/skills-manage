#!/usr/bin/env bash
set -e

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org/"
  exit 1
fi

# 首次运行安装依赖
if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi

echo ""
echo "正在启动 skills 管理工具..."
echo "浏览器访问：http://localhost:3456"
echo "关闭本窗口 / 按 Ctrl+C 即可停止服务。"
echo ""

npm start
