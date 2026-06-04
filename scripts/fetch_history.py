#!/usr/bin/env python3
"""Fetch past Nitter HTML timeline to gather 2 months of history and merge into events.json."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "groups.json"

class NitterParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tweets = []
        self.current_tweet = None
        self.in_content = False
        self.next_cursor = None
        self.div_depth = 0
        self.tweet_div_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        if tag == "div":
            self.div_depth += 1
            # nitterのタイムラインアイテム（ツイート）
            cls = attrs_dict.get("class", "")
            if "timeline-item" in cls and "show-more" not in cls:
                self.current_tweet = {
                    "id": "",
                    "text": "",
                    "post_url": "",
                    "created_at": "",
                    "image_url": None
                }
                self.tweet_div_depth = self.div_depth
                
        elif tag == "a" and self.current_tweet:
            if "tweet-link" in attrs_dict.get("class", ""):
                href = attrs_dict.get("href", "")
                self.current_tweet["post_url"] = "https://nitter.net" + href
                # status_idをIDにする
                status_match = re.search(r"/status/(\d+)", href)
                if status_match:
                    self.current_tweet["id"] = status_match.group(1)
                
        elif tag == "span" and self.current_tweet:
            if "tweet-date" in attrs_dict.get("class", ""):
                title = attrs_dict.get("title", "")
                self.current_tweet["created_at"] = title
                
        elif tag == "div" and self.current_tweet:
            if "tweet-content" in attrs_dict.get("class", ""):
                self.in_content = True
                
        elif tag == "img" and self.current_tweet:
            src = attrs_dict.get("src", "")
            if "/pic/media" in src or "/pic/card_img" in src:
                # 最初の画像を優先
                if not self.current_tweet.get("image_url"):
                    self.current_tweet["image_url"] = "https://nitter.net" + src

        elif tag == "div" and not self.current_tweet:
            if "show-more" in attrs_dict.get("class", ""):
                pass
        elif tag == "a" and not self.current_tweet:
            href = attrs_dict.get("href", "")
            if "?cursor=" in href:
                self.next_cursor = href.split("?cursor=")[1]

    def handle_endtag(self, tag):
        if tag == "div":
            if self.in_content:
                self.in_content = False
            if self.current_tweet and self.div_depth == self.tweet_div_depth:
                # ツイート終了
                if self.current_tweet["text"].strip() and self.current_tweet["post_url"]:
                    self.tweets.append(self.current_tweet)
                self.current_tweet = None
            self.div_depth -= 1

    def handle_data(self, data):
        if self.in_content and self.current_tweet:
            self.current_tweet["text"] += data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", required=True)
    parser.add_argument("--pages", type=int, default=5, help="Number of pages to crawl back")
    args = parser.parse_args()

    group = load_group(args.group)
    print(f"Crawl history for {group['id']} (@{group['x_account']}), target pages: {args.pages}")

    base_url = f"https://nitter.net/{group['x_account']}"
    cursor = None
    all_posts = []

    # 過去2ヶ月分（目安として5ページほど）を巡回
    for page_idx in range(args.pages):
        url = base_url
        if cursor:
            url += f"?cursor={cursor}"
        
        print(f"Page {page_idx + 1}: Fetching {url} ...")
        try:
            html_content = fetch_html(url)
        except Exception as e:
            print(f"Error fetching page {page_idx + 1}: {e}")
            break

        nitter_parser = NitterParser()
        nitter_parser.feed(html_content)

        posts = nitter_parser.tweets
        print(f"Parsed {len(posts)} posts from page {page_idx + 1}")
        if not posts:
            break

        all_posts.extend(posts)
        cursor = nitter_parser.next_cursor
        if not cursor:
            print("No next page cursor found. Stopping.")
            break

        time.sleep(2)  # マナーのためのスリープ

    # パース日付の標準化とマージ
    candidates = []
    for post in all_posts:
        # created_at のパース: "Jun 3, 2026 · 12:00 PM UTC" (中点は色々な半角・全角中点の可能性あり)
        raw_date = post["created_at"]
        cleaned_date = re.sub(r"\s+·\s+|\s+⋅\s+", " ", raw_date) # 中点のクリーンアップ
        
        try:
            # 形式: "Jun 3, 2026 12:00 PM UTC"
            dt = datetime.strptime(cleaned_date, "%b %d, %Y %I:%M %p UTC")
            dt = dt.replace(tzinfo=timezone.utc)
            post["created_at"] = dt.isoformat().replace("+00:00", "Z")
        except ValueError:
            # パース失敗時は現在時刻を代替
            post["created_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        # 本文と日付の簡易クリーニング
        post["text"] = normalize_text(post["text"])
        candidates.append(post)

    # 関連性のありそうなイベントのルールベース抽出
    from fetch_events import extract_with_rules, merge_events, read_json, write_json
    
    events_from_history = extract_with_rules(group, candidates)
    print(f"Extracted {len(events_from_history)} event candidates from crawled history.")

    # 既存の events.json をロードしてマージ
    events_file = ROOT / "data" / group["id"] / "events.json"
    existing_events = read_json(events_file, [])
    
    merged_events = merge_events(existing_events, events_from_history)
    # ソート
    merged_events.sort(key=lambda event: (event.get("date", ""), event.get("time_start", "99:99")))

    # 書き出し
    write_json(ROOT / "data" / group["id"] / "events.json", merged_events)
    write_json(ROOT / "docs" / "data" / group["id"] / "events.json", merged_events)

    print(f"Completed! Total events in database for {group['id']}: {len(merged_events)}")
    return 0


def load_group(group_id: str) -> dict:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    for group in config.get("groups", []):
        if group.get("id") == group_id:
            return group
    raise SystemExit(f"Unknown group id: {group_id}")


def fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "oshi-calendar/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def normalize_text(value: str) -> str:
    lines = [line.strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


if __name__ == "__main__":
    sys.exit(main())
