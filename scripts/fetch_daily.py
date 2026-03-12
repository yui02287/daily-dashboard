"""
fetch_daily.py — 每日資料抓取腳本
由 GitHub Actions 在台灣時間早上九點（UTC 01:00）執行

依賴套件：
  pip install requests feedparser python-dateutil notion-client
"""

import os
import json
import logging
import sys
from datetime import datetime, timezone, timedelta

import feedparser
import requests
from notion_client import Client as NotionClient
from dateutil import parser as dateutil_parser

# ---------- 基本設定 ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

TODAY_UTC    = datetime.now(timezone.utc).date()
OUTPUT_PATH  = "data/daily.json"
MAX_NEWS_PER_FEED = 6

PRIORITY_POINTS = {
    "High":   20,
    "Medium": 15,
    "Low":    10,
}


# =====================================================
#  Notion 工具函式
# =====================================================

def _get_title(props: dict, key: str) -> str:
    """從 Notion page properties 取得 Title 欄位的純文字。"""
    try:
        return props[key]["title"][0]["plain_text"]
    except (KeyError, IndexError, TypeError):
        return ""


def _get_rich_text(props: dict, key: str) -> str:
    """取得 Rich Text 欄位的純文字。"""
    try:
        return props[key]["rich_text"][0]["plain_text"]
    except (KeyError, IndexError, TypeError):
        return ""


def _get_select(props: dict, key: str) -> str | None:
    """取得 Select 欄位的值。"""
    try:
        return props[key]["select"]["name"]
    except (KeyError, TypeError):
        return None


def _get_multi_select(props: dict, key: str) -> list[str]:
    """取得 Multi-select 欄位所有選項名稱。"""
    try:
        return [opt["name"] for opt in props[key]["multi_select"]]
    except (KeyError, TypeError):
        return []


def _get_date(props: dict, key: str) -> str | None:
    """取得 Date 欄位的 start 值（YYYY-MM-DD 字串）。"""
    try:
        val = props[key]["date"]["start"]
        return val[:10] if val else None
    except (KeyError, TypeError):
        return None


# =====================================================
#  Notion — 每日代辦
# =====================================================

def _normalize_todo(page: dict) -> dict:
    props    = page["properties"]
    priority = _get_select(props, "優先級") or _get_select(props, "Priority") or "Medium"
    return {
        "id":       page["id"].replace("-", ""),
        "source":   "notion",
        "name":     _get_title(props, "名稱") or _get_title(props, "Name"),
        "status":   _get_select(props, "狀態") or _get_select(props, "Status"),
        "due_date": _get_date(props, "截止日期")  or _get_date(props, "Due Date"),
        "priority": priority,
        "category": _get_select(props, "分類")    or _get_select(props, "Category") or "",
        "points":   PRIORITY_POINTS.get(priority, 15),
        "notes":    _get_rich_text(props, "備注") or _get_rich_text(props, "Notes"),
    }


def fetch_notion_todos(client: NotionClient) -> list[dict]:
    """
    查詢 Notion 每日代辦資料庫。
    篩選條件：狀態不為「已完成 / Done」。
    """
    db_id = os.environ.get("NOTION_TODO_DB_ID", "").strip()
    if not db_id:
        logger.warning("NOTION_TODO_DB_ID 未設定，跳過代辦抓取")
        return []

    try:
        results = client.databases.query(
            database_id=db_id,
            filter={
                "and": [
                    {
                        "or": [
                            {"property": "狀態",  "select": {"does_not_equal": "已完成"}},
                            {"property": "Status","select": {"does_not_equal": "Done"}},
                        ]
                    }
                ]
            },
            sorts=[{"property": "截止日期", "direction": "ascending"},
                   {"property": "Due Date", "direction": "ascending"}],
        )
        todos = [_normalize_todo(p) for p in results.get("results", [])]
        logger.info(f"Notion 代辦：取得 {len(todos)} 筆")
        return todos
    except Exception as e:
        logger.warning(f"Notion 代辦抓取失敗：{e}")
        return []


# =====================================================
#  Notion — 影片題材
# =====================================================

def _normalize_content(page: dict) -> dict:
    props = page["properties"]
    return {
        "id":           page["id"].replace("-", ""),
        "topic":        _get_title(props, "題材") or _get_title(props, "Topic"),
        "status":       _get_select(props, "狀態")        or _get_select(props, "Status"),
        "planned_date": _get_date(props, "預計拍片日期")   or _get_date(props, "Planned Date"),
        "platform":     _get_select(props, "平台")        or _get_select(props, "Platform"),
        "tags":         _get_multi_select(props, "標籤")  or _get_multi_select(props, "Tags"),
        "notes":        _get_rich_text(props, "備注")     or _get_rich_text(props, "Notes"),
    }


def fetch_notion_content(client: NotionClient) -> list[dict]:
    """
    查詢 Notion 影片題材資料庫。
    只抓未發布的項目（構思中 / 準備中 / 拍攝中 / 剪輯中）。
    """
    db_id = os.environ.get("NOTION_CONTENT_DB_ID", "").strip()
    if not db_id:
        logger.warning("NOTION_CONTENT_DB_ID 未設定，跳過影片題材抓取")
        return []

    statuses_to_include = ["構思中", "準備中", "拍攝中", "剪輯中", "Planned", "In Progress", "Filmed"]
    try:
        results = client.databases.query(
            database_id=db_id,
            filter={
                "or": [
                    {"property": "狀態",  "select": {"equals": s}}
                    for s in statuses_to_include
                ] + [
                    {"property": "Status","select": {"equals": s}}
                    for s in statuses_to_include
                ]
            },
            sorts=[{"property": "預計拍片日期", "direction": "ascending"},
                   {"property": "Planned Date", "direction": "ascending"}],
        )
        items = [_normalize_content(p) for p in results.get("results", [])]
        logger.info(f"Notion 影片題材：取得 {len(items)} 筆")
        return items
    except Exception as e:
        logger.warning(f"Notion 影片題材抓取失敗：{e}")
        return []


# =====================================================
#  RSS 新聞
# =====================================================

def _parse_rss_date(entry) -> str:
    """將 feedparser 的時間結構轉為 ISO 8601 字串。"""
    try:
        import time
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        if t:
            dt = datetime(*t[:6], tzinfo=timezone.utc)
            return dt.isoformat()
    except Exception:
        pass
    try:
        raw = entry.get("published") or entry.get("updated") or ""
        if raw:
            return dateutil_parser.parse(raw).isoformat()
    except Exception:
        pass
    return ""


def _is_recent(date_str: str, hours: int = 24) -> bool:
    """判斷文章是否在指定小時內發布。"""
    if not date_str:
        return True  # 無時間戳就顯示
    try:
        dt   = dateutil_parser.parse(date_str)
        now  = datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (now - dt) <= timedelta(hours=hours)
    except Exception:
        return True


def fetch_rss_feeds() -> list[dict]:
    """
    讀取 RSS_FEED_URLS 環境變數（每行一個 URL），
    抓取各 feed 的最新文章（最多 MAX_NEWS_PER_FEED 筆，優先取 24 小時內）。
    """
    raw  = os.environ.get("RSS_FEED_URLS", "").strip()
    urls = [u.strip() for u in raw.splitlines() if u.strip()]
    if not urls:
        logger.warning("RSS_FEED_URLS 未設定，跳過新聞抓取")
        return []

    feeds = []
    for url in urls:
        try:
            parsed    = feedparser.parse(url)
            feed_name = parsed.feed.get("title") or url
            if parsed.bozo and not parsed.entries:
                logger.warning(f"RSS 解析失敗：{url} — {parsed.bozo_exception}")
                continue

            items = []
            for entry in parsed.entries[:MAX_NEWS_PER_FEED * 2]:  # 多拿一點，再篩時間
                date_str = _parse_rss_date(entry)
                if not _is_recent(date_str, hours=30):
                    continue
                summary = (entry.get("summary") or entry.get("description") or "").strip()
                # 移除 HTML tags（簡易）
                import re
                summary = re.sub(r"<[^>]+>", "", summary)[:200]
                items.append({
                    "title":     entry.get("title", "（無標題）"),
                    "link":      entry.get("link", ""),
                    "published": date_str,
                    "summary":   summary,
                })
                if len(items) >= MAX_NEWS_PER_FEED:
                    break

            feeds.append({"feed_name": feed_name, "feed_url": url, "items": items})
            logger.info(f"RSS [{feed_name}]：取得 {len(items)} 篇文章")
        except Exception as e:
            logger.warning(f"RSS 抓取失敗 {url}：{e}")

    return feeds


# =====================================================
#  Main
# =====================================================

def get_notion_client() -> NotionClient | None:
    api_key = os.environ.get("NOTION_API_KEY", "").strip()
    if not api_key:
        logger.error("NOTION_API_KEY 未設定，Notion 功能將跳過")
        return None
    return NotionClient(auth=api_key)


def main():
    logger.info(f"=== 每日資料更新開始，日期：{TODAY_UTC} ===")

    # Notion
    client        = get_notion_client()
    notion_todos  = fetch_notion_todos(client)   if client else []
    notion_content= fetch_notion_content(client) if client else []

    # RSS
    rss_news = fetch_rss_feeds()

    # 組合輸出
    output = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "date":         str(TODAY_UTC),
            "version":      "1.0",
        },
        "notion_todos":   notion_todos,
        "notion_content": notion_content,
        "rss_news":       rss_news,
    }

    # 寫入檔案
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info(
        f"=== 完成 ===  代辦:{len(notion_todos)}  影片:{len(notion_content)}  RSS feeds:{len(rss_news)}"
    )


if __name__ == "__main__":
    main()
