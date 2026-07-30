"""
个人生活工作台 - 后端服务
使用 FastAPI + SQLite，数据持久化在本地文件
"""
import sqlite3
import json
import os
import threading
import logging
from datetime import datetime, date
from typing import Optional, List, Any
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from contextlib import contextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# 数据库配置
# ============================================================
DB_PATH = Path(__file__).parent / "workbench.db"

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

@contextmanager
def db_cursor():
    conn = get_db()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """初始化所有数据表"""
    with db_cursor() as cur:
        # 待办事项表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT DEFAULT '生活',
                priority INTEGER DEFAULT 2,
                due_date TEXT,
                remind_time TEXT,
                done INTEGER DEFAULT 0,
                done_at TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                sort_order INTEGER DEFAULT 0
            )
        """)
        # 兼容旧表：如果 remind_time 列不存在则添加
        try:
            cur.execute("SELECT remind_time FROM todos LIMIT 1")
        except sqlite3.OperationalError:
            cur.execute("ALTER TABLE todos ADD COLUMN remind_time TEXT")
        # 记账表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,  -- 'income' or 'expense'
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                note TEXT,
                record_date TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        # 灵感记录表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inspirations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                tag TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        # 学习计划表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS study_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                target_hours REAL DEFAULT 0,
                total_days INTEGER DEFAULT 30,
                start_date TEXT,
                note TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        # 学习打卡表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS study_checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                checkin_date TEXT NOT NULL,
                hours REAL DEFAULT 0,
                note TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE,
                UNIQUE (plan_id, checkin_date)
            )
        """)
        # 每日复盘表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_date TEXT NOT NULL UNIQUE,
                went_well TEXT DEFAULT '',
                went_wrong TEXT DEFAULT '',
                improvement TEXT DEFAULT '',
                mood INTEGER DEFAULT 3,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        # 资讯缓存表（存储抓取的资讯，避免重复抓取）
        cur.execute("""
            CREATE TABLE IF NOT EXISTS news_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                link TEXT,
                source TEXT,
                published_at TEXT,
                fetched_date TEXT NOT NULL,
                UNIQUE(category, title)
            )
        """)
        # 应用设置表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

# ============================================================
# 数据模型
# ============================================================
class TodoIn(BaseModel):
    title: str
    category: str = "生活"
    priority: int = 2
    due_date: Optional[str] = None
    remind_time: Optional[str] = None

class TodoUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[int] = None
    due_date: Optional[str] = None
    remind_time: Optional[str] = None
    done: Optional[int] = None

class LedgerIn(BaseModel):
    type: str
    amount: float
    category: str
    note: str = ""
    record_date: Optional[str] = None

class LedgerUpdate(BaseModel):
    type: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    note: Optional[str] = None
    record_date: Optional[str] = None

class InspirationIn(BaseModel):
    content: str
    tag: str = ""

class InspirationUpdate(BaseModel):
    content: Optional[str] = None
    tag: Optional[str] = None

class StudyPlanIn(BaseModel):
    title: str
    target_hours: float = 0
    total_days: int = 30
    start_date: Optional[str] = None
    note: str = ""

class StudyPlanUpdate(BaseModel):
    title: Optional[str] = None
    target_hours: Optional[float] = None
    total_days: Optional[int] = None
    start_date: Optional[str] = None
    note: Optional[str] = None

class StudyCheckinIn(BaseModel):
    plan_id: int
    hours: float = 0
    note: str = ""

class ReviewIn(BaseModel):
    review_date: Optional[str] = None
    went_well: str = ""
    went_wrong: str = ""
    improvement: str = ""
    mood: int = 3

class ReviewUpdate(BaseModel):
    went_well: Optional[str] = None
    went_wrong: Optional[str] = None
    improvement: Optional[str] = None
    mood: Optional[int] = None

# ============================================================
# 工具函数
# ============================================================
def today_str():
    return date.today().isoformat()

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def row_to_dict(row):
    return {k: row[k] for k in row.keys()}

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="个人生活工作台")

# ============================================================
# 待办事项 API
# ============================================================
@app.get("/api/todos")
def list_todos(date: Optional[str] = None):
    with db_cursor() as cur:
        if date:
            # 显示：今日到期 + 今日创建(无到期日) + 所有未完成(有到期日但不是今天的也显示)
            cur.execute("""
                SELECT * FROM todos
                WHERE due_date = ?
                   OR (due_date IS NULL AND date(created_at) = ?)
                   OR (done = 0 AND due_date IS NOT NULL AND due_date != ?)
                ORDER BY done ASC,
                         CASE WHEN due_date = ? THEN 0 ELSE 1 END,
                         due_date ASC, created_at DESC
            """, (date, date, date, date))
        else:
            cur.execute("SELECT * FROM todos ORDER BY done ASC, sort_order ASC, created_at DESC")
        return [row_to_dict(r) for r in cur.fetchall()]

@app.post("/api/todos")
def create_todo(todo: TodoIn):
    if not todo.title or not todo.title.strip():
        raise HTTPException(400, "标题不能为空")
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO todos (title, category, priority, due_date, remind_time)
            VALUES (?, ?, ?, ?, ?)
        """, (todo.title, todo.category, todo.priority, todo.due_date, todo.remind_time))
        tid = cur.lastrowid
        cur.execute("SELECT * FROM todos WHERE id=?", (tid,))
        return row_to_dict(cur.fetchone())

@app.put("/api/todos/{tid}")
def update_todo(tid: int, todo: TodoUpdate):
    fields = []
    vals = []
    for k, v in todo.dict(exclude_none=True).items():
        fields.append(f"{k}=?")
        vals.append(v)
    if not fields:
        raise HTTPException(400, "无更新字段")
    if "done" in todo.dict(exclude_none=True) and todo.done == 1:
        fields.append("done_at=?")
        vals.append(now_str())
    elif "done" in todo.dict(exclude_none=True) and todo.done == 0:
        fields.append("done_at=NULL")
    vals.append(tid)
    with db_cursor() as cur:
        cur.execute(f"UPDATE todos SET {', '.join(fields)} WHERE id=?", vals)
        cur.execute("SELECT * FROM todos WHERE id=?", (tid,))
        return row_to_dict(cur.fetchone())

@app.delete("/api/todos/{tid}")
def delete_todo(tid: int):
    with db_cursor() as cur:
        cur.execute("DELETE FROM todos WHERE id=?", (tid,))
        return {"ok": True}

@app.post("/api/todos/{tid}/checkin")
def todo_checkin(tid: int):
    """打卡：切换完成状态"""
    with db_cursor() as cur:
        cur.execute("SELECT done FROM todos WHERE id=?", (tid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "待办不存在")
        new_done = 0 if row["done"] else 1
        done_at = now_str() if new_done else None
        cur.execute("UPDATE todos SET done=?, done_at=? WHERE id=?", (new_done, done_at, tid))
        return {"id": tid, "done": new_done, "done_at": done_at}

# ============================================================
# 记账 API
# ============================================================
@app.get("/api/ledger")
def list_ledger(start: Optional[str] = None, end: Optional[str] = None):
    with db_cursor() as cur:
        if start and end:
            cur.execute("""
                SELECT * FROM ledger
                WHERE record_date >= ? AND record_date <= ?
                ORDER BY record_date DESC, created_at DESC
            """, (start, end))
        else:
            cur.execute("SELECT * FROM ledger ORDER BY record_date DESC, created_at DESC")
        return [row_to_dict(r) for r in cur.fetchall()]

@app.post("/api/ledger")
def create_ledger(item: LedgerIn):
    if not item.amount or item.amount <= 0:
        raise HTTPException(400, "金额必须大于0")
    if not item.category or not item.category.strip():
        raise HTTPException(400, "分类不能为空")
    rdate = item.record_date or today_str()
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO ledger (type, amount, category, note, record_date)
            VALUES (?, ?, ?, ?, ?)
        """, (item.type, item.amount, item.category, item.note, rdate))
        lid = cur.lastrowid
        cur.execute("SELECT * FROM ledger WHERE id=?", (lid,))
        return row_to_dict(cur.fetchone())

@app.put("/api/ledger/{lid}")
def update_ledger(lid: int, item: LedgerUpdate):
    fields = []
    vals = []
    for k, v in item.dict(exclude_none=True).items():
        fields.append(f"{k}=?")
        vals.append(v)
    if not fields:
        raise HTTPException(400, "无更新字段")
    vals.append(lid)
    with db_cursor() as cur:
        cur.execute(f"UPDATE ledger SET {', '.join(fields)} WHERE id=?", vals)
        cur.execute("SELECT * FROM ledger WHERE id=?", (lid,))
        return row_to_dict(cur.fetchone())

@app.delete("/api/ledger/{lid}")
def delete_ledger(lid: int):
    with db_cursor() as cur:
        cur.execute("DELETE FROM ledger WHERE id=?", (lid,))
        return {"ok": True}

@app.get("/api/ledger/summary")
def ledger_summary(month: Optional[str] = None):
    """月度收支汇总"""
    m = month or datetime.now().strftime("%Y-%m")
    with db_cursor() as cur:
        cur.execute("""
            SELECT type, COALESCE(SUM(amount),0) as total
            FROM ledger
            WHERE strftime('%Y-%m', record_date) = ?
            GROUP BY type
        """, (m,))
        rows = cur.fetchall()
        result = {"income": 0, "expense": 0, "month": m}
        for r in rows:
            if r["type"] == "income":
                result["income"] = r["total"]
            else:
                result["expense"] = r["total"]
        result["balance"] = result["income"] - result["expense"]

        # 分类统计
        cur.execute("""
            SELECT type, category, COALESCE(SUM(amount),0) as total
            FROM ledger
            WHERE strftime('%Y-%m', record_date) = ?
            GROUP BY type, category
            ORDER BY total DESC
        """, (m,))
        result["categories"] = [row_to_dict(r) for r in cur.fetchall()]
        return result

@app.get("/api/ledger/yearly")
def ledger_yearly(year: Optional[int] = None):
    """年度收支统计：按月拆分"""
    y = year or datetime.now().year
    with db_cursor() as cur:
        cur.execute("""
            SELECT strftime('%m', record_date) as month,
                   type,
                   COALESCE(SUM(amount),0) as total
            FROM ledger
            WHERE strftime('%Y', record_date) = ?
            GROUP BY strftime('%m', record_date), type
            ORDER BY month
        """, (str(y),))
        rows = cur.fetchall()
        months = {}
        for r in rows:
            m = int(r["month"])
            if m not in months:
                months[m] = {"income": 0, "expense": 0}
            if r["type"] == "income":
                months[m]["income"] = r["total"]
            else:
                months[m]["expense"] = r["total"]
        result = []
        total_income = 0
        total_expense = 0
        for i in range(1, 13):
            income = months.get(i, {}).get("income", 0)
            expense = months.get(i, {}).get("expense", 0)
            balance = income - expense
            total_income += income
            total_expense += expense
            result.append({
                "month": f"{y}-{str(i).zfill(2)}",
                "month_num": i,
                "income": round(income, 2),
                "expense": round(expense, 2),
                "balance": round(balance, 2),
            })
        return {
            "year": y,
            "months": result,
            "total_income": round(total_income, 2),
            "total_expense": round(total_expense, 2),
            "total_balance": round(total_income - total_expense, 2),
        }

# ============================================================
# 灵感记录 API
# ============================================================
@app.get("/api/inspirations")
def list_inspirations():
    with db_cursor() as cur:
        cur.execute("SELECT * FROM inspirations ORDER BY created_at DESC")
        return [row_to_dict(r) for r in cur.fetchall()]

@app.post("/api/inspirations")
def create_inspiration(ins: InspirationIn):
    if not ins.content or not ins.content.strip():
        raise HTTPException(400, "内容不能为空")
    with db_cursor() as cur:
        cur.execute("INSERT INTO inspirations (content, tag) VALUES (?, ?)", (ins.content, ins.tag))
        iid = cur.lastrowid
        cur.execute("SELECT * FROM inspirations WHERE id=?", (iid,))
        return row_to_dict(cur.fetchone())

@app.put("/api/inspirations/{iid}")
def update_inspiration(iid: int, ins: InspirationUpdate):
    fields = []
    vals = []
    for k, v in ins.dict(exclude_none=True).items():
        fields.append(f"{k}=?")
        vals.append(v)
    if not fields:
        raise HTTPException(400, "无更新字段")
    vals.append(iid)
    with db_cursor() as cur:
        cur.execute(f"UPDATE inspirations SET {', '.join(fields)} WHERE id=?", vals)
        cur.execute("SELECT * FROM inspirations WHERE id=?", (iid,))
        return row_to_dict(cur.fetchone())

@app.delete("/api/inspirations/{iid}")
def delete_inspiration(iid: int):
    with db_cursor() as cur:
        cur.execute("DELETE FROM inspirations WHERE id=?", (iid,))
        return {"ok": True}

# ============================================================
# 学习计划 API
# ============================================================
@app.get("/api/study/plans")
def list_study_plans():
    with db_cursor() as cur:
        cur.execute("SELECT * FROM study_plans ORDER BY created_at DESC")
        plans = [row_to_dict(r) for r in cur.fetchall()]
        for p in plans:
            # 统计打卡天数和总时长
            cur.execute("""
                SELECT COUNT(*) as days, COALESCE(SUM(hours),0) as total_hours
                FROM study_checkins WHERE plan_id=?
            """, (p["id"],))
            stat = cur.fetchone()
            p["checkin_days"] = stat["days"]
            p["total_hours"] = stat["total_hours"]
            # 今日是否已打卡
            cur.execute("SELECT * FROM study_checkins WHERE plan_id=? AND checkin_date=?", (p["id"], today_str()))
            today_checkin = cur.fetchone()
            p["checked_today"] = 1 if today_checkin else 0
            p["today_hours"] = today_checkin["hours"] if today_checkin else 0
        return plans

@app.post("/api/study/plans")
def create_study_plan(plan: StudyPlanIn):
    sdate = plan.start_date or today_str()
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO study_plans (title, target_hours, total_days, start_date, note)
            VALUES (?, ?, ?, ?, ?)
        """, (plan.title, plan.target_hours, plan.total_days, sdate, plan.note))
        pid = cur.lastrowid
        cur.execute("SELECT * FROM study_plans WHERE id=?", (pid,))
        return row_to_dict(cur.fetchone())

@app.put("/api/study/plans/{pid}")
def update_study_plan(pid: int, plan: StudyPlanUpdate):
    fields = []
    vals = []
    for k, v in plan.dict(exclude_none=True).items():
        fields.append(f"{k}=?")
        vals.append(v)
    if not fields:
        raise HTTPException(400, "无更新字段")
    vals.append(pid)
    with db_cursor() as cur:
        cur.execute(f"UPDATE study_plans SET {', '.join(fields)} WHERE id=?", vals)
        cur.execute("SELECT * FROM study_plans WHERE id=?", (pid,))
        return row_to_dict(cur.fetchone())

@app.delete("/api/study/plans/{pid}")
def delete_study_plan(pid: int):
    with db_cursor() as cur:
        cur.execute("DELETE FROM study_plans WHERE id=?", (pid,))
        return {"ok": True}

@app.post("/api/study/plans/{pid}/checkin")
def study_checkin(pid: int, body: StudyCheckinIn):
    """学习打卡（每日一次，再次调用则更新）"""
    t = today_str()
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO study_checkins (plan_id, checkin_date, hours, note)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(plan_id, checkin_date) DO UPDATE SET
                hours=excluded.hours, note=excluded.note
        """, (pid, t, body.hours, body.note))
        cur.execute("SELECT * FROM study_checkins WHERE plan_id=? AND checkin_date=?", (pid, t))
        return row_to_dict(cur.fetchone())

@app.delete("/api/study/plans/{pid}/checkin")
def study_undo_checkin(pid: int):
    """撤销今日打卡"""
    with db_cursor() as cur:
        cur.execute("DELETE FROM study_checkins WHERE plan_id=? AND checkin_date=?", (pid, today_str()))
        return {"ok": True}

@app.get("/api/study/plans/{pid}/checkins")
def study_checkin_history(pid: int):
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM study_checkins WHERE plan_id=?
            ORDER BY checkin_date DESC
        """, (pid,))
        return [row_to_dict(r) for r in cur.fetchall()]

# ============================================================
# 每日复盘 API
# ============================================================
@app.get("/api/reviews")
def list_reviews(limit: int = 100, q: Optional[str] = None):
    with db_cursor() as cur:
        if q:
            # 搜索日期或内容
            like = f"%{q}%"
            cur.execute("""
                SELECT * FROM reviews
                WHERE review_date LIKE ?
                   OR went_well LIKE ?
                   OR went_wrong LIKE ?
                   OR improvement LIKE ?
                ORDER BY review_date DESC
                LIMIT ?
            """, (like, like, like, like, limit))
        else:
            cur.execute("SELECT * FROM reviews ORDER BY review_date DESC LIMIT ?", (limit,))
        return [row_to_dict(r) for r in cur.fetchall()]

@app.get("/api/reviews/today")
def get_today_review():
    with db_cursor() as cur:
        cur.execute("SELECT * FROM reviews WHERE review_date=?", (today_str(),))
        row = cur.fetchone()
        return row_to_dict(row) if row else None

@app.post("/api/reviews")
def create_or_update_review(rv: ReviewIn):
    rdate = rv.review_date or today_str()
    with db_cursor() as cur:
        cur.execute("SELECT id FROM reviews WHERE review_date=?", (rdate,))
        existing = cur.fetchone()
        if existing:
            cur.execute("""
                UPDATE reviews SET went_well=?, went_wrong=?, improvement=?, mood=?, updated_at=?
                WHERE review_date=?
            """, (rv.went_well, rv.went_wrong, rv.improvement, rv.mood, now_str(), rdate))
            rid = existing["id"]
        else:
            cur.execute("""
                INSERT INTO reviews (review_date, went_well, went_wrong, improvement, mood)
                VALUES (?, ?, ?, ?, ?)
            """, (rdate, rv.went_well, rv.went_wrong, rv.improvement, rv.mood))
            rid = cur.lastrowid
        cur.execute("SELECT * FROM reviews WHERE id=?", (rid,))
        return row_to_dict(cur.fetchone())

@app.delete("/api/reviews/{rid}")
def delete_review(rid: int):
    with db_cursor() as cur:
        cur.execute("DELETE FROM reviews WHERE id=?", (rid,))
        return {"ok": True}

# ============================================================
# 资讯 API（带缓存）
# ============================================================
@app.get("/api/news/{category}")
def get_news(category: str):
    """获取资讯：先查当天缓存，没有则返回缓存或空"""
    valid = {"ai", "finance"}
    if category not in valid:
        raise HTTPException(400, "无效分类")
    t = today_str()
    with db_cursor() as cur:
        # 查当天缓存
        cur.execute("""
            SELECT * FROM news_cache
            WHERE category=? AND fetched_date=?
            ORDER BY published_at DESC, id DESC
            LIMIT 20
        """, (category, t))
        rows = cur.fetchall()
        if rows:
            return {"category": category, "date": t, "items": [row_to_dict(r) for r in rows], "cached": True}
        # 否则返回最近的缓存
        cur.execute("""
            SELECT * FROM news_cache
            WHERE category=?
            ORDER BY fetched_date DESC, id DESC
            LIMIT 20
        """, (category,))
        rows = cur.fetchall()
        return {"category": category, "date": t, "items": [row_to_dict(r) for r in rows], "cached": False}

# ============================================================
# 统计概览
# ============================================================
@app.get("/api/dashboard")
def dashboard():
    """首页概览数据"""
    t = today_str()
    m = datetime.now().strftime("%Y-%m")
    with db_cursor() as cur:
        # 今日待办
        cur.execute("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) as done
            FROM todos
            WHERE due_date=? OR (due_date IS NULL AND date(created_at)=?)
        """, (t, t))
        todo_stat = cur.fetchone()

        # 本月收支
        cur.execute("""
            SELECT type, COALESCE(SUM(amount),0) as total
            FROM ledger WHERE strftime('%Y-%m', record_date)=?
            GROUP BY type
        """, (m,))
        income = expense = 0
        for r in cur.fetchall():
            if r["type"] == "income":
                income = r["total"]
            else:
                expense = r["total"]

        # 学习计划
        cur.execute("SELECT COUNT(*) as total FROM study_plans")
        plan_total = cur.fetchone()["total"]
        cur.execute("""
            SELECT COUNT(DISTINCT plan_id) as done
            FROM study_checkins WHERE checkin_date=?
        """, (t,))
        plan_done = cur.fetchone()["done"]

        # 今日复盘
        cur.execute("SELECT * FROM reviews WHERE review_date=?", (t,))
        review = cur.fetchone()

        # 灵感总数
        cur.execute("SELECT COUNT(*) as total FROM inspirations")
        insp_total = cur.fetchone()["total"]

        return {
            "date": t,
            "todos": {"total": todo_stat["total"] or 0, "done": todo_stat["done"] or 0},
            "ledger": {"income": income, "expense": expense, "balance": income - expense},
            "study": {"total": plan_total, "done_today": plan_done},
            "review_done": 1 if review else 0,
            "inspirations": insp_total,
        }

# ============================================================
# 数据导出 / 导入 API
# ============================================================
from fastapi.responses import Response

@app.get("/api/export")
def export_data():
    """导出全部用户数据为 JSON"""
    with db_cursor() as cur:
        data = {"exported_at": now_str(), "data": {}}
        for table in ["todos", "ledger", "inspirations", "study_plans", "study_checkins", "reviews"]:
            cur.execute(f"SELECT * FROM {table}")
            data["data"][table] = [row_to_dict(r) for r in cur.fetchall()]
        return JSONResponse(
            content=data,
            headers={"Content-Disposition": "attachment; filename=workbench-backup.json"}
        )

@app.post("/api/import")
async def import_data(request: Request):
    """导入 JSON 数据（覆盖现有数据）"""
    body = await request.json()
    data = body.get("data", body)
    with db_cursor() as cur:
        for table in ["todos", "ledger", "inspirations", "study_plans", "study_checkins", "reviews"]:
            if table not in data:
                continue
            # 清空现有
            cur.execute(f"DELETE FROM {table}")
            # 写入导入的数据
            for row in data[table]:
                cols = list(row.keys())
                placeholders = ",".join(["?"] * len(cols))
                col_names = ",".join(cols)
                cur.execute(
                    f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})",
                    [row[c] for c in cols]
                )
    return {"ok": True, "imported": {k: len(v) for k, v in data.items() if isinstance(v, list)}}

# ============================================================
# 快捷指令专用 API（返回今日待办，供 iOS 快捷指令读取）
# ============================================================
@app.get("/api/shortcuts/today")
def shortcuts_today():
    """供 iOS 快捷指令调用的接口，返回今日待办的精简格式"""
    t = today_str()
    with db_cursor() as cur:
        cur.execute("""
            SELECT id, title, category, remind_time, due_date, priority, done
            FROM todos
            WHERE (due_date = ? OR (due_date IS NULL AND date(created_at) = ?))
              AND done = 0
            ORDER BY remind_time ASC, priority ASC
        """, (t, t))
        rows = cur.fetchall()
        # 返回快捷指令友好的格式
        items = []
        for r in rows:
            items.append({
                "title": r["title"],
                "time": r["remind_time"] or "",
                "category": r["category"] or "",
                "priority": "高" if r["priority"]==1 else ("中" if r["priority"]==2 else "低"),
            })
        return {
            "date": t,
            "count": len(items),
            "items": items,
        }

@app.get("/api/calendar/today.ics")
def calendar_today_ics():
    """生成今日待办的 .ics 日历文件，iOS Safari 可直接打开添加到日历"""
    from datetime import datetime, timedelta
    t = today_str()
    with db_cursor() as cur:
        cur.execute("""
            SELECT id, title, category, remind_time, due_date
            FROM todos
            WHERE (due_date = ? OR (due_date IS NULL AND date(created_at) = ?))
              AND done = 0 AND remind_time IS NOT NULL
            ORDER BY remind_time ASC
        """, (t, t))
        rows = cur.fetchall()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Workbench//Todo//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]
    now = datetime.now()
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    for r in rows:
        due = r["due_date"] or t
        rt = r["remind_time"]
        try:
            dt = datetime.strptime(f"{due} {rt}", "%Y-%m-%d %H:%M")
        except:
            continue
        start = dt.strftime("%Y%m%dT%H%M00")
        end = (dt + timedelta(minutes=15)).strftime("%Y%m%dT%H%M00")
        title = r["title"]
        if r["category"]:
            title += f"（{r['category']}）"
        uid = f"todo-{r['id']}-{int(now.timestamp())}@workbench"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;TZID=Asia/Shanghai:{start}",
            f"DTEND;TZID=Asia/Shanghai:{end}",
            f"SUMMARY:{title}",
            "STATUS:CONFIRMED",
            "BEGIN:VALARM",
            "TRIGGER:-PT15M",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{title}",
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    ics_content = "\r\n".join(lines)
    return Response(content=ics_content, media_type="text/calendar", headers={
        "Content-Disposition": f"attachment; filename=workbench-today.ics",
        "Cache-Control": "no-cache"
    })

@app.get("/api/calendar/todo/{todo_id}.ics")
def calendar_single_todo_ics(todo_id: int):
    """生成单条待办的 .ics 日历文件"""
    from datetime import datetime, timedelta
    with db_cursor() as cur:
        cur.execute("SELECT id, title, category, remind_time, due_date FROM todos WHERE id=?", (todo_id,))
        r = cur.fetchone()
    if not r or not r["remind_time"]:
        raise HTTPException(404, "待办不存在或没有设置提醒时间")
    t = today_str()
    due = r["due_date"] or t
    rt = r["remind_time"]
    try:
        dt = datetime.strptime(f"{due} {rt}", "%Y-%m-%d %H:%M")
    except:
        raise HTTPException(400, "时间格式错误")
    start = dt.strftime("%Y%m%dT%H%M00")
    end = (dt + timedelta(minutes=15)).strftime("%Y%m%dT%H%M00")
    now = datetime.now()
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    title = r["title"]
    if r["category"]:
        title += f"（{r['category']}）"
    uid = f"todo-{r['id']}-{int(now.timestamp())}@workbench"
    ics_content = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Workbench//Todo//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{stamp}",
        f"DTSTART;TZID=Asia/Shanghai:{start}",
        f"DTEND;TZID=Asia/Shanghai:{end}",
        f"SUMMARY:{title}",
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{title}",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ])
    return Response(content=ics_content, media_type="text/calendar", headers={
        "Content-Disposition": f"attachment; filename=reminder.ics",
        "Cache-Control": "no-cache"
    })

# ============================================================
# 静态文件 / PWA 资源
# ============================================================
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/manifest.json")
def manifest():
    return FileResponse(str(STATIC_DIR / "manifest.json"), media_type="application/manifest+json")

@app.get("/icon-192.png")
def icon_192():
    return FileResponse(str(STATIC_DIR / "icon-192.png"), media_type="image/png")

@app.get("/icon-512.png")
def icon_512():
    return FileResponse(str(STATIC_DIR / "icon-512.png"), media_type="image/png")

@app.get("/apple-touch-icon.png")
def apple_touch_icon():
    return FileResponse(str(STATIC_DIR / "apple-touch-icon.png"), media_type="image/png")

@app.get("/app-icon-v3-192.png")
def icon_v3_192():
    return FileResponse(str(STATIC_DIR / "app-icon-v3-192.png"), media_type="image/png")

@app.get("/app-icon-v3-512.png")
def icon_v3_512():
    return FileResponse(str(STATIC_DIR / "app-icon-v3-512.png"), media_type="image/png")

@app.get("/app-icon-v3-180.png")
def icon_v3_180():
    return FileResponse(str(STATIC_DIR / "app-icon-v3-180.png"), media_type="image/png")

@app.get("/SyncWorkbench.shortcut")
def download_shortcut():
    return FileResponse(
        str(STATIC_DIR / "SyncWorkbench.shortcut"),
        media_type="application/octet-stream",
        filename="SyncWorkbench.shortcut"
    )

# ============================================================
# 前端页面
# ============================================================
@app.get("/", response_class=HTMLResponse)
def index():
    html_path = STATIC_DIR / "index.html"
    if html_path.exists():
        content = html_path.read_text(encoding="utf-8")
        return HTMLResponse(content, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    return HTMLResponse("<h1>前端文件未找到</h1>", status_code=404)

# ============================================================
# 资讯抓取
# ============================================================
def refresh_news_background():
    """后台抓取资讯"""
    try:
        from news_fetcher import refresh_news, need_refresh
        if need_refresh():
            logger.info("开始后台抓取资讯...")
            threading.Thread(target=lambda: refresh_news(), daemon=True).start()
    except ImportError:
        logger.warning("news_fetcher 模块未安装，资讯功能受限")
    except Exception as e:
        logger.warning(f"资讯抓取失败: {e}")

@app.post("/api/news/{category}/refresh")
def trigger_news_refresh(category: str):
    """手动触发资讯刷新"""
    valid = {"ai", "finance"}
    if category not in valid:
        raise HTTPException(400, "无效分类")
    try:
        from news_fetcher import refresh_news
        count = refresh_news(category)
        return {"ok": True, "new_count": count}
    except ImportError:
        return {"ok": False, "msg": "资讯抓取模块不可用"}
    except Exception as e:
        raise HTTPException(500, f"刷新失败: {e}")

# ============================================================
# 启动
# ============================================================
@app.on_event("startup")
def startup():
    init_db()
    refresh_news_background()

if __name__ == "__main__":
    import uvicorn
    init_db()
    refresh_news_background()
    uvicorn.run(app, host="0.0.0.0", port=8080)
