# 生活工作台 — 恢复指南

## 遇到问题怎么办？

如果工作台打不开了，或者你在新的会话里需要恢复工作台，把下面这段话**完整复制**发给新的 AI 助手：

---

**请帮我恢复我的个人生活工作台。**

工作台代码在 `/workspace/workbench/` 目录下，包含：
- `server.py` — FastAPI 后端，端口 8080
- `static/index.html` — 前端页面（单文件，含 CSS/JS）
- `static/bg-glass.jpg` — 背景图
- `static/avatar.png` — 侧边栏头像
- `static/manifest.json` — PWA 配置
- `workbench.db` — SQLite 数据库（所有用户数据）

**启动步骤：**
1. 检查保活脚本是否在运行：`ps aux | grep keepalive`，如果没运行就启动：`nohup /workspace/workbench/keepalive.sh > /tmp/keepalive.log 2>&1 &`
2. 保活脚本会自动检查并启动服务器和隧道
3. 检查服务器是否在运行：`ps aux | grep server.py`
4. 如果没运行，启动：`cd /workspace/workbench && nohup python3.11 server.py > server.log 2>&1 &`
5. 检查 Cloudflare 隧道是否在运行：`ps aux | grep cloudflared`
6. 如果没运行，启动隧道：`nohup /tmp/cloudflared tunnel --url http://localhost:8080 > /tmp/cf_persistent.log 2>&1 &`
7. 等待 15 秒，获取链接：`grep -o "https://[a-z\-]*\.trycloudflare\.com" /tmp/cf_persistent.log | head -1`
8. 或者直接读取保存的链接：`cat /workspace/workbench/CURRENT_URL.txt`
9. 把链接发给用户

**如果 /workspace/workbench/ 目录不存在或为空**，说明沙盒已被回收，需要从头重建。用户可能有 JSON 备份文件可以导入恢复数据。

---

## 工作台功能清单

1. **今日待办** — 增删改查、打卡完成、提醒时间、同步到日历(.ics)
2. **收支记账** — 收入/支出、分类、月度汇总、年度月度统计
3. **每日资讯** — AI 热点 + 财经资讯（自动每日更新）
4. **灵感记录** — 随手记想法、标签分类
5. **学习计划** — 目标设定、每日打卡、进度条
6. **每日复盘** — 心情、做得好/不好/改进、历史搜索
7. **数据导出/导入** — JSON 备份恢复

## 技术栈

- 后端：Python FastAPI + SQLite
- 前端：单文件 HTML（Navy Gold 藏金配色 + 玻璃拟态）
- 隧道：Cloudflare Tunnel (cloudflared)
- PWA：支持添加到主屏幕

## 设计风格

- Navy Gold 藏金配色（浅蓝白底 #F8FAFC + 深藏青文字 + 靛紫 CTA + 金色点缀）
- 玻璃拟态卡片（半透明白 + backdrop-blur）
- 侧边栏深藏青色 + 金色头像
- 背景图为玻璃雨滴纹理

## 数据备份

**重要：** 定期在复盘页底部「数据管理」→「导出全部数据」备份 JSON 文件。
