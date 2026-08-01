"""
资讯抓取 - GitHub Actions 定时运行，生成 news.json 供前端同源读取
AI 源：IT之家 AI 栏目 + 36氪快讯（AI关键词过滤）
财经源：财联社电报 + 华尔街见闻快讯
"""
import json
import re
import time
import requests
from bs4 import BeautifulSoup
from pathlib import Path

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

AI_KEYWORDS = [
    "AI", "人工智能", "大模型", "GPT", "ChatGPT", "Claude", "智能", "算法",
    "机器学习", "深度学习", "OpenAI", "Gemini", "Llama", "算力", "芯片", "AGI",
    "Sora", "Midjourney", "通义", "文心", "豆包", "Kimi", "DeepSeek", "Qwen",
    "智能体", "Agent", "提示词", "多模态", "机器人", "自动驾驶", "神经网络",
    "RAG", "MCP", "GPU", "英伟达", "NVIDIA", "微软", "Google", "苹果", "华为",
    "AI眼镜", "具身智能", "人形机器人", "数据标注", "算力中心"
]


def clean(text, limit=200):
    if not text:
        return ""
    t = re.sub(r"<[^>]+>", "", text)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def fetch_ithome_ai():
    """IT之家 AI 栏目"""
    items = []
    try:
        r = requests.get("https://www.ithome.com/tag/AI/", headers=HEADERS, timeout=15)
        r.encoding = "utf-8"
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.select("a.title")[:20]:
            title = a.get_text(strip=True)
            link = a.get("href", "")
            if title and link and "ithome" in link:
                items.append({
                    "category": "ai",
                    "title": title,
                    "summary": "",
                    "link": link,
                    "source": "IT之家",
                    "published_at": "",
                })
    except Exception as e:
        print(f"[warn] IT之家: {e}")
    return items


def fetch_36kr_ai():
    """36氪快讯 API + AI关键词过滤"""
    items = []
    try:
        r = requests.get(
            "https://gateway.36kr.com/api/missive/flow/newsflashByFlowId?flowId=1&b_id=&limit=30&flag=1",
            headers=HEADERS, timeout=15)
        data = r.json()
        for it in data.get("data", {}).get("data", [])[:30]:
            title = (it.get("templateMaterial", {}).get("widgetTitle", "") or
                     it.get("summary", "") or "")
            title = clean(title, 100)
            if not title:
                continue
            lower = title.lower()
            if not any(kw.lower() in lower for kw in AI_KEYWORDS):
                continue
            summary = clean(it.get("templateMaterial", {}).get("widgetContent", ""))
            link = f"https://36kr.com/newsflashes/{it.get('itemId','')}"
            ts = it.get("templateMaterial", {}).get("publishTime", 0)
            published = ""
            if ts:
                published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts / 1000))
            items.append({
                "category": "ai",
                "title": title,
                "summary": summary,
                "link": link,
                "source": "36氪",
                "published_at": published,
            })
    except Exception as e:
        print(f"[warn] 36氪: {e}")
    return items


def fetch_cls_telegraph():
    """财联社电报（精准财经快讯）"""
    items = []
    try:
        r = requests.get(
            "https://www.cls.cn/nodeapi/updateTelegraphList?app=CailianpressWeb&os=web&sv=8.4.6&rn=25",
            headers=HEADERS, timeout=15)
        data = r.json()
        for it in data.get("data", {}).get("roll_data", [])[:25]:
            title = it.get("title", "") or it.get("sharetitle", "") or ""
            content = clean(it.get("content", ""))
            if not title:
                title = content[:40]
            if not title:
                continue
            link = f"https://www.cls.cn/detail/{it.get('id','')}"
            ts = it.get("ctime", 0)
            published = ""
            if ts:
                published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
            items.append({
                "category": "finance",
                "title": title.strip(),
                "summary": content,
                "link": link,
                "source": "财联社",
                "published_at": published,
            })
    except Exception as e:
        print(f"[warn] 财联社: {e}")
    return items


def fetch_wallstreetcn():
    """华尔街见闻快讯（财经频道）"""
    items = []
    # 依次尝试多个频道，直到拿到财经内容
    channels = ["finance", "global-channel"]
    for ch in channels:
        try:
            r = requests.get(
                f"https://api-one-wscn.awtmt.com/apiv1/content/lives?channel={ch}&limit=25",
                headers=HEADERS, timeout=15)
            data = r.json()
            if not data.get("data", {}).get("items"):
                continue
            for it in data.get("data", {}).get("items", [])[:25]:
                content = clean(it.get("content", ""))
                title = it.get("title", "") or content[:50]
                if not title:
                    continue
                lower = (title + content).lower()
                # 过滤明显非财经的内容（地缘/灾害/体育/娱乐）
                skip_words = ["地震", "台风", "袭击", "空难", "军事", "导弹", "疫情",
                              "体育", "足球", "篮球", "娱乐", "明星", "爆炸", "冲突",
                              "枪击", "游行", "选举", "总统", "战争", "抗议"]
                if any(w in lower for w in skip_words):
                    continue
                link = f"https://wallstreetcn.com/news/global/{it.get('id','')}"
                ts = it.get("display_time", 0)
                published = ""
                if ts:
                    published = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
                items.append({
                    "category": "finance",
                    "title": title.strip(),
                    "summary": content,
                    "link": link,
                    "source": "华尔街见闻",
                    "published_at": published,
                })
            if items:
                break
        except Exception as e:
            print(f"[warn] 华尔街见闻({ch}): {e}")
    return items


def dedupe(items):
    seen = set()
    result = []
    for it in items:
        key = it["title"][:40]
        if key in seen:
            continue
        seen.add(key)
        result.append(it)
    return result


def fetch_sina_finance():
    """新浪财经 7x24 快讯（财联社/华尔街见闻失败时的补充源）"""
    items = []
    try:
        r = requests.get(
            "https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&dpc=1&pagesize=20&type=0",
            headers=HEADERS, timeout=15)
        data = r.json()
        feed = data.get("result", {}).get("data", {}).get("feed", {}).get("list", [])
        for it in feed[:20]:
            rich = clean(it.get("rich_text", ""), 120)
            title = rich[:50]
            if not title:
                continue
            skip_words = ["地震", "台风", "袭击", "空难", "军事", "导弹", "体育",
                          "足球", "篮球", "娱乐", "明星", "爆炸", "枪击", "游行"]
            if any(w in title for w in skip_words):
                continue
            ts = it.get("create_time", "")
            link = it.get("url", "") or f"https://zhibo.sina.com.cn/zt/{it.get('id','')}"
            items.append({
                "category": "finance",
                "title": title,
                "summary": rich,
                "link": link,
                "source": "新浪财经",
                "published_at": ts[:16] if ts else "",
            })
    except Exception as e:
        print(f"[warn] 新浪财经: {e}")
    return items


def main():
    ai = dedupe(fetch_ithome_ai() + fetch_36kr_ai())
    finance = dedupe(fetch_cls_telegraph() + fetch_wallstreetcn())
    if len(finance) < 10:
        finance += fetch_sina_finance()
    ai = ai[:30]
    finance = dedupe(finance)[:30]
    data = {
        "updated_at": time.strftime("%Y-%m-%d %H:%M"),
        "ai": ai,
        "finance": finance,
    }
    out = Path(__file__).parent / "news.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✅ AI: {len(ai)} 条 | 财经: {len(finance)} 条 | 已写入 {out.name}")


if __name__ == "__main__":
    main()
