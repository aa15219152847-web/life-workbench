#!/bin/bash
# 工作台保活脚本 — 每分钟检查服务器和隧道是否存活，挂了自动重启
# 并把最新链接写入 /workspace/workbench/CURRENT_URL.txt

while true; do
  # 1. 检查服务器
  if ! pgrep -f "python3.11 server.py" > /dev/null 2>&1; then
    echo "$(date): 服务器未运行，正在启动..."
    cd /workspace/workbench
    nohup python3.11 server.py > server.log 2>&1 &
    sleep 5
    echo "$(date): 服务器已启动"
  fi

  # 2. 检查 Cloudflare 隧道
  if ! pgrep -f "cloudflared" > /dev/null 2>&1; then
    echo "$(date): 隧道未运行，正在启动..."
    pkill -f cloudflared 2>/dev/null
    sleep 2
    nohup /tmp/cloudflared tunnel --url http://localhost:8080 > /tmp/cf_persistent.log 2>&1 &
    sleep 15
    # 提取新链接
    NEW_URL=$(grep -o "https://[a-z\-]*\.trycloudflare\.com" /tmp/cf_persistent.log | head -1)
    if [ -n "$NEW_URL" ]; then
      echo "$NEW_URL" > /workspace/workbench/CURRENT_URL.txt
      echo "$(date): 隧道已启动，链接: $NEW_URL"
    else
      echo "$(date): 隧道启动失败，将在下次循环重试"
    fi
  fi

  # 3. 每次循环都更新一下当前链接（防止链接文件不存在）
  if [ ! -f /workspace/workbench/CURRENT_URL.txt ]; then
    NEW_URL=$(grep -o "https://[a-z\-]*\.trycloudflare\.com" /tmp/cf_persistent.log 2>/dev/null | head -1)
    if [ -n "$NEW_URL" ]; then
      echo "$NEW_URL" > /workspace/workbench/CURRENT_URL.txt
    fi
  fi

  # 每 60 秒检查一次
  sleep 60
done
