#!/usr/bin/env python3
"""Fetch Nitter RSS and update event JSON for one group."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "groups.json"


PROMPT = """You extract calendar events from Japanese idol group announcement posts.

Return strict JSON only:
[
  {
    "id": "stable-slug",
    "group_id": "...",
    "type": "live|ticket|free|deadline|release|media",
    "title": "...",
    "date": "YYYY-MM-DD",
    "time_open": "HH:MM or omitted",
    "time_start": "HH:MM or omitted",
    "time_end": "HH:MM or omitted",
    "venue": "... or omitted",
    "benefit_time": "... or omitted",
    "price": "... or omitted",
    "ticket_url": "... or omitted",
    "description": "...",
    "post_url": "...",
    "created_at": "ISO timestamp"
  }
]

Rules:
- Split live events and ticket release times into separate entries.
- Split multi-day posts into one event per date.
- Ignore thank-you posts, MV announcements, replies with only notes, and posts without a concrete calendar date.
- Use the post year unless the event date would be in the past relative to the post date, then use the next year.
- Preserve Japanese titles and venues.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", required=True)
    parser.add_argument("--rss-url")
    args = parser.parse_args()

    group = load_group(args.group)
    rss_url = args.rss_url or f"https://nitter.net/{group['x_account']}/rss"
    posts = fetch_posts(rss_url)
    candidates = [post for post in posts if looks_relevant(post["text"])]

    write_json(ROOT / "data" / group["id"] / "candidates.json", candidates)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        events = extract_with_claude(api_key, group, candidates)
        # AIが抽出したイベントに、元のポストのimage_urlをマージする
        post_images = {p["post_url"]: p["image_url"] for p in candidates if p.get("image_url")}
        for event in events:
            if event.get("post_url") in post_images:
                event["image_url"] = post_images[event["post_url"]]
    else:
        existing = read_json(ROOT / "data" / group["id"] / "events.json", [])
        events = merge_events(existing, extract_with_rules(group, candidates))
        print("ANTHROPIC_API_KEY is not set; used rule-based extraction.")

    events.sort(key=lambda event: (event.get("date", ""), event.get("time_start", "99:99")))

    write_json(ROOT / "data" / group["id"] / "events.json", events)
    write_json(ROOT / "docs" / "data" / group["id"] / "events.json", events)
    print(f"Wrote {len(events)} events for {group['id']}.")
    return 0


def load_group(group_id: str) -> dict:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    for group in config.get("groups", []):
        if group.get("id") == group_id:
            return group
    raise SystemExit(f"Unknown group id: {group_id}")


def fetch_posts(rss_url: str) -> list[dict]:
    request = urllib.request.Request(rss_url, headers={"User-Agent": "oshi-calendar/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        xml_bytes = response.read()

    root = ET.fromstring(xml_bytes)
    posts = []
    for item in root.findall("./channel/item"):
        title = item.findtext("title", "")
        raw_description = item.findtext("description", "")
        description = strip_html(raw_description)
        link = item.findtext("link", "")
        guid = item.findtext("guid", "")
        pub_date = item.findtext("pubDate", "")
        text = title if len(title) >= len(description) else description
        
        # 画像URLを抽出
        image_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', raw_description)
        image_url = image_match.group(1) if image_match else None

        posts.append({
            "id": guid or link,
            "text": normalize_text(text),
            "post_url": link,
            "created_at": pub_date,
            "image_url": image_url,
        })
    return posts


def looks_relevant(text: str) -> bool:
    positive = [
        "開場", "開演", "チケ発", "発売", "受付", "締切", "ライブ", "LIVE",
        "公演", "対バン", "生誕", "リリース", "イベント", "OPEN", "START"
    ]
    negative = ["御礼", "ありがとうございました", "MV公開", "映像UP"]
    if any(word in text for word in negative) and not any(word in text for word in ["開場", "開演", "チケ発"]):
        return False
    return any(word in text for word in positive) and bool(re.search(r"\d{1,2}/\d{1,2}|\d{4}\.\d{1,2}\.\d{1,2}", text))


def extract_with_rules(group: dict, candidates: list[dict]) -> list[dict]:
    events: list[dict] = []
    for post in candidates:
        text = post["text"]
        post_dt = parse_pub_date(post.get("created_at", ""))
        post_year = post_dt.year
        title = extract_title(text)
        venue = extract_prefixed_value(text, ("🏟", "📍"))
        ticket_url = extract_first_url(text)

        date_matches = list(re.finditer(r"(?<!\d)(\d{1,2})/(\d{1,2})(?:\([^)]*\))?", text))
        if not date_matches:
            continue

        if "締切" in text or "まで" in text and "申込み" in text:
            match = date_matches[-1]
            event_date = normalize_event_date(post_year, int(match.group(1)), int(match.group(2)), post_dt)
            events.append(clean_event({
                "id": stable_id(group["id"], "deadline", event_date, title, post["id"]),
                "group_id": group["id"],
                "type": "deadline",
                "title": f"{title} 締切" if "締切" not in title else title,
                "date": event_date,
                "time_start": find_time_near(text, match.end()) or extract_first_time(text),
                "description": summarize(text),
                "ticket_url": ticket_url,
                "post_url": post["post_url"],
                "image_url": post.get("image_url"),
                "created_at": post_dt.isoformat().replace("+00:00", "Z"),
            }))
            continue

        if "発売" in text and "開場" not in text and "開演" not in text:
            match = date_matches[0]
            event_date = normalize_event_date(post_year, int(match.group(1)), int(match.group(2)), post_dt)
            events.append(clean_event({
                "id": stable_id(group["id"], "release", event_date, title, post["id"]),
                "group_id": group["id"],
                "type": "release",
                "title": title,
                "date": event_date,
                "description": summarize(text),
                "ticket_url": ticket_url,
                "post_url": post["post_url"],
                "image_url": post.get("image_url"),
                "created_at": post_dt.isoformat().replace("+00:00", "Z"),
            }))
            continue

        for match in date_matches:
            event_date = normalize_event_date(post_year, int(match.group(1)), int(match.group(2)), post_dt)
            window = text[match.start():match.start() + 80]
            time_open, time_start, time_end = extract_times(text, window)
            event_type = "free" if "無料" in text or "オフ会" in text else "live"

            events.append(clean_event({
                "id": stable_id(group["id"], event_type, event_date, title, post["id"]),
                "group_id": group["id"],
                "type": event_type,
                "title": title,
                "date": event_date,
                "time_open": time_open,
                "time_start": time_start,
                "time_end": time_end,
                "venue": venue,
                "benefit_time": extract_benefit_time(window),
                "price": extract_prefixed_value(text, ("💵",)),
                "ticket_url": ticket_url,
                "description": summarize(text),
                "post_url": post["post_url"],
                "image_url": post.get("image_url"),
                "created_at": post_dt.isoformat().replace("+00:00", "Z"),
            }))

        ticket = extract_ticket_event(group, post, title, ticket_url, post_dt)
        if ticket:
            events.append(ticket)

    return events


def extract_ticket_event(group: dict, post: dict, title: str, ticket_url: str | None, post_dt: datetime) -> dict | None:
    text = post["text"]
    match = re.search(r"(\d{1,2})/(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}:\d{2})\s*チケ発", text)
    if not match:
        match = re.search(r"(\d{1,2})/(\d{1,2})(?:\([^)]*\))?[^。\n]{0,16}チケ発", text)
    if not match:
        return None
    event_date = normalize_event_date(post_dt.year, int(match.group(1)), int(match.group(2)), post_dt)
    time_start = match.group(3) if len(match.groups()) >= 3 and match.group(3) else find_time_near(text, match.start())
    return clean_event({
        "id": stable_id(group["id"], "ticket", event_date, title, post["id"]),
        "group_id": group["id"],
        "type": "ticket",
        "title": f"{title} チケ発",
        "date": event_date,
        "time_start": time_start,
        "ticket_url": ticket_url,
        "post_url": post["post_url"],
        "image_url": post.get("image_url"),
        "created_at": post_dt.isoformat().replace("+00:00", "Z"),
    })


def merge_events(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged = {event.get("id"): event for event in existing if event.get("id")}
    for event in incoming:
        merged[event["id"]] = {**merged.get(event["id"], {}), **event}
    return list(merged.values())


def extract_title(text: str) -> str:
    for line in text.splitlines():
        cleaned = line.strip("／＼[]【】 \t")
        if not cleaned:
            continue
        if re.search(r"https?://|#|^\d{1,2}/\d{1,2}", cleaned):
            continue
        if cleaned in {"ー", "・", "※タイムテーブルは画像を✅"}:
            continue
        return cleaned[:60]
    return "STAiNY イベント"


def extract_prefixed_value(text: str, prefixes: tuple[str, ...]) -> str | None:
    for line in text.splitlines():
        if line.startswith(prefixes):
            return line[1:].strip()
    return None


def extract_first_url(text: str) -> str | None:
    match = re.search(r"https?://\S+", text)
    if not match:
        return None
    return match.group(0).rstrip("。、)")


def extract_times(text: str, window: str) -> tuple[str | None, str | None, str | None]:
    open_match = re.search(r"(?:開場|OPEN)\s*(\d{1,2}:\d{2})", text)
    start_match = re.search(r"(?:開演|START)\s*(\d{1,2}:\d{2})", text)
    performance_match = re.search(r"🎤\s*(\d{1,2}:\d{2})\s*[-〜~]\s*(\d{1,2}:\d{2})", window)
    if performance_match:
        return (
            open_match.group(1) if open_match else None,
            performance_match.group(1),
            performance_match.group(2),
        )
    return (
        open_match.group(1) if open_match else None,
        start_match.group(1) if start_match else extract_first_time(window),
        None,
    )


def extract_benefit_time(text: str) -> str | None:
    match = re.search(r"🗣️?\s*(\d{1,2}:\d{2}\s*[-〜~]\s*\d{1,2}:\d{2}(?:\([^)]+\))?)", text)
    return match.group(1) if match else None


def extract_first_time(text: str) -> str | None:
    match = re.search(r"(\d{1,2}:\d{2})", text)
    return match.group(1) if match else None


def find_time_near(text: str, index: int) -> str | None:
    window = text[max(0, index - 24):index + 48]
    return extract_first_time(window)


def summarize(text: str) -> str:
    lines = [line for line in text.splitlines() if not line.startswith(("http", "#"))]
    return " / ".join(lines[:4])[:160]


def clean_event(event: dict) -> dict:
    return {key: value for key, value in event.items() if value not in (None, "")}


def stable_id(group_id: str, event_type: str, date: str, title: str, source_id: str) -> str:
    digest = hashlib.sha1(f"{source_id}:{event_type}:{date}:{title}".encode("utf-8")).hexdigest()[:8]
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower())[:28].strip("-") or "event"
    return f"{group_id}-{date}-{event_type}-{slug}-{digest}"


def normalize_event_date(year: int, month: int, day: int, post_dt: datetime) -> str:
    event_dt = datetime(year, month, day, tzinfo=timezone.utc)
    if event_dt.date() < post_dt.date() and post_dt.month == 12 and month == 1:
        event_dt = datetime(year + 1, month, day, tzinfo=timezone.utc)
    return event_dt.strftime("%Y-%m-%d")


def parse_pub_date(value: str) -> datetime:
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def strip_html(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return html.unescape(value)


def normalize_text(value: str) -> str:
    lines = [line.strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def extract_with_claude(api_key: str, group: dict, candidates: list[dict]) -> list[dict]:
    body = json.dumps({
        "model": os.environ.get("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
        "max_tokens": 5000,
        "temperature": 0,
        "system": PROMPT,
        "messages": [
            {
                "role": "user",
                "content": json.dumps({
                    "group": group,
                    "posts": candidates,
                }, ensure_ascii=False),
            }
        ],
    }).encode("utf-8")

    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8"))

    text = "".join(block.get("text", "") for block in payload.get("content", []) if block.get("type") == "text")
    return json.loads(text)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    sys.exit(main())
