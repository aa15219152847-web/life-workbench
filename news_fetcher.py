"""
资讯抓取模块 - 抓取 AI 和财经新闻并缓存到数据库
使用网页抓取 + RSS，每日抓取一次缓存到 news_cache 表
"""
import sqlite3
import re
import json
import logging
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "workbench.db"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# AI 资讯抓取
# ============================================================
def fetch_36kr_ai():
    """36氪 科技频道 - 通过 API"""
    items = []
    try:
        # 36氪快讯 API
        r = requests.get("https://gateway.36kr.com/api/missive/flow/newsflashByFlowId?flowId=1&b_id=&limit=20&flag=1",
                        headers=HEADERS, timeout=15)
        data = r.json()
        for it in data.get("data", {}).get("data", [])[:15]:
            title = it.get("templateMaterial", {}).get("widgetTitle", "") or it.get("summary", "")
            summary = it.get("templateMaterial", {}).get("widgetContent", "")
            summary = re.sub(r'<[^>]+>', '', summary)[:200]
            link = f"https://36kr.com/newsflashes/{it.get('itemId','')}"
            ts = it.get("templateMaterial", {}).get("publishTime", 0)
            published = ""
            if ts:
                import time
                published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts/1000))
            items.append({
                "category": "ai",
                "title": title.strip(),
                "summary": summary.strip(),
                "link": link,
                "source": "36氪",
                "published_at": published,
                "fetched_date": date.today().isoformat(),
            })
    except Exception as e:
        logger.warning(f"36氪抓取失败: {e}")
    return items


def fetch_zhihu_hot():
    """知乎热榜 - 通过 RSS 备用"""
    items = []
    try:
        r = requests.get("https://www.zhihu.com/rss", headers=HEADERS, timeout=15)
        r.encoding = "utf-8"
        soup = BeautifulSoup(r.text, "xml")
        for it in soup.find_all("item")[:15]:
            title = it.title.get_text(strip=True) if it.title else ""
            link = it.link.get_text(strip=True) if it.link else ""
            desc = it.description.get_text(strip=True) if it.description else ""
            desc = re.sub(r'<[^>]+>', '', desc)[:200]
            items.append({
                "category": "ai",
                "title": title,
                "summary": desc,
                "link": link,
                "source": "知乎",
                "published_at": "",
                "fetched_date": date.today().isoformat(),
            })
    except Exception as e:
        logger.warning(f"知乎抓取失败: {e}")
    return items


def fetch_ithome_ai():
    """IT之家 AI 栏目"""
    items = []
    try:
        r = requests.get("https://www.ithome.com/tag/AI/", headers=HEADERS, timeout=15)
        r.encoding = "utf-8"
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.select("a.title")[:15]:
            title = a.get_text(strip=True)
            link = a.get("href", "")
            if title and link:
                items.append({
                    "category": "ai",
                    "title": title,
                    "summary": "",
                    "link": link,
                    "source": "IT之家",
                    "published_at": "",
                    "fetched_date": date.today().isoformat(),
                })
    except Exception as e:
        logger.warning(f"IT之家抓取失败: {e}")
    return items


def fetch_ai_news():
    """抓取 AI 相关资讯"""
    items = []
    items += fetch_36kr_ai()
    items += fetch_zhihu_hot()
    items += fetch_ithome_ai()
    # AI 相关关键词筛选，确保内容相关
    ai_keywords = ["AI", "人工智能", "大模型", "GPT", "ChatGPT", "Claude", "智能", "算法",
                   "机器学习", "深度学习", "OpenAI", "Gemini", "Llama", "算力", "芯片", "AGI",
                   "Sora", "Midjourney", "通义", "文心", "豆包", "Kimi", "DeepSeek",
                   "智能体", "Agent", "提示词", "多模态", "百度", "阿里", "腾讯", "字节",
                   "数据", "云", "机器人", "自动驾驶", "模型", "神经网络", "RAG", "MCP"]
    ai_items = []
    other_items = []
    for it in items:
        title_lower = it["title"].lower()
        if any(kw.lower() in title_lower for kw in ai_keywords):
            ai_items.append(it)
        else:
            other_items.append(it)
    # AI 相关优先，不足则补充其他
    result = ai_items + other_items
    return result[:20]


# ============================================================
# 财经资讯抓取
# ============================================================
def fetch_cls_telegraph():
    """财联社电报"""
    items = []
    try:
        r = requests.get("https://www.cls.cn/nodeapi/updateTelegraphList?app=CailianpressWeb&os=web&sv=8.4.6&rn=20",
                        headers=HEADERS, timeout=15)
        data = r.json()
        for it in data.get("data", {}).get("roll_data", [])[:15]:
            title = it.get("title", "") or it.get("sharetitle", "")
            if not title:
                # 取正文前30字
                content = it.get("content", "")
                content_clean = re.sub(r'<[^>]+>', '', content)
                title = content_clean[:40]
                summary = content_clean[:200]
            else:
                content = it.get("content", "")
                summary = re.sub(r'<[^>]+>', '', content)[:200]
            link = f"https://www.cls.cn/detail/{it.get('id','')}"
            ts = it.get("ctime", 0)
            published = ""
            if ts:
                import time
                published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
            items.append({
                "category": "finance",
                "title": title.strip(),
                "summary": summary.strip(),
                "link": link,
                "source": "财联社",
                "published_at": published,
                "fetched_date": date.today().isoformat(),
            })
    except Exception as e:
        logger.warning(f"财联社抓取失败: {e}")
    return items


def fetch_eastmoney_news():
    """东方财富新闻"""
    items = []
    try:
        r = requests.get("https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0",
                        headers=HEADERS, timeout=15)
        text = r.text
        # 去除 JSONP 包装
        m = re.search(r'\((\{.*\})\)', text)
        if m:
            data = json.loads(m.group(1))
        else:
            data = r.json()
        for it in data.get("data", {}).get("list", [])[:15]:
            title = it.get("title", "")
            summary = it.get("notice_content", "")[:200]
            art_code = it.get("art_code", "")
            link = f"https://data.eastmoney.com/notices/detail/{art_code}.html"
            dt = it.get("notice_date", "")
            items.append({
                "category": "finance",
                "title": title,
                "summary": summary,
                "link": link,
                "source": "东方财富",
                "published_at": dt[:16] if dt else "",
                "fetched_date": date.today().isoformat(),
            })
    except Exception as e:
        logger.warning(f"东方财富抓取失败: {e}")
    return items


def fetch_wallstreetcn():
    """华尔街见闻快讯"""
    items = []
    try:
        r = requests.get("https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20",
                        headers=HEADERS, timeout=15)
        data = r.json()
        for it in data.get("data", {}).get("items", [])[:15]:
            # 提取纯文本标题
            content = it.get("content", "")
            content_text = re.sub(r'<[^>]+>', '', content).strip()
            title = it.get("title", "") or content_text[:50]
            summary = content_text[:200]
            link = f"https://wallstreetcn.com/news/global/{it.get('id','')}"
            ts = it.get("display_time", 0)
            published = ""
            if ts:
                import time
                published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
            items.append({
                "category": "finance",
                "title": title.strip(),
                "summary": summary.strip(),
                "link": link,
                "source": "华尔街见闻",
                "published_at": published,
                "fetched_date": date.today().isoformat(),
            })
    except Exception as e:
        logger.warning(f"华尔街见闻抓取失败: {e}")
    return items


def fetch_finance_news():
    """抓取财经资讯"""
    items = []
    items += fetch_cls_telegraph()
    items += fetch_wallstreetcn()
    items += fetch_eastmoney_news()
    return items[:20]


# ============================================================
# 保存到数据库
# ============================================================
def save_to_db(items):
    if not items:
        return 0
    conn = get_db()
    cur = conn.cursor()
    # 确保表存在
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
    saved = 0
    for item in items:
        try:
            cur.execute("""
                INSERT OR IGNORE INTO news_cache (category, title, summary, link, source, published_at, fetched_date)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (item["category"], item["title"], item["summary"], item["link"],
                  item["source"], item["published_at"], item["fetched_date"]))
            if cur.rowcount > 0:
                saved += 1
        except Exception as e:
            logger.warning(f"保存失败: {e}")
    conn.commit()
    conn.close()
    return saved


def refresh_news(category=None):
    """刷新资讯"""
    today = date.today().isoformat()
    if category == "ai" or category is None:
        logger.info("抓取 AI 资讯...")
        items = fetch_ai_news()
        saved = save_to_db(items)
        logger.info(f"AI 资讯: 获取 {len(items)} 条, 新增 {saved} 条")
    if category == "finance" or category is None:
        logger.info("抓取财经资讯...")
        items = fetch_finance_news()
        saved = save_to_db(items)
        logger.info(f"财经资讯: 获取 {len(items)} 条, 新增 {saved} 条")


def need_refresh():
    today = date.today().isoformat()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) as c FROM news_cache WHERE fetched_date=?", (today,))
    count = cur.fetchone()["c"]
    conn.close()
    return count < 5


if __name__ == "__main__":
    import sys
    cat = sys.argv[1] if len(sys.argv) > 1 else None
    refresh_news(cat)
    print("完成")
