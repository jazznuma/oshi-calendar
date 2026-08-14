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
import urllib.parse
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
                self.current_tweet["post_url"] = clean_x_url(href)
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
                if not self.current_tweet.get("image_url"):
                    self.current_tweet["image_url"] = clean_image_url(src)

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

    all_posts = fetch_history_posts(group["x_account"], args.pages)
    if not all_posts:
        print(f"WARNING: Could not crawl history for @{group['x_account']}. Keeping existing data.")
        return 0

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


def fetch_history_posts(x_account: str, pages: int = 5) -> list[dict]:
    domains = [
        "farside.link/nitter",
        "twiiit.com",
        "nitter.poast.org",
        "nitter.privacydev.net",
        "nitter.net-freaks.space",
        "nitter.cz",
        "nitter.soopy.moe",
    ]

    for domain in domains:
        print(f"Trying to crawl history for @{x_account} via https://{domain} ...")
        all_posts = []
        cursor = None
        success = False

        for page_idx in range(pages):
            url = f"https://{domain}/{x_account}"
            if cursor:
                url += f"?cursor={cursor}"

            try:
                html_content = fetch_html(url)
                nitter_parser = NitterParser()
                nitter_parser.feed(html_content)
                posts = nitter_parser.tweets

                if not posts and page_idx == 0:
                    break

                all_posts.extend(posts)
                cursor = nitter_parser.next_cursor
                success = True

                if not cursor:
                    break
                time.sleep(1)
            except Exception as e:
                print(f"Failed crawling page {page_idx + 1} from {domain}: {e}")
                break

        if success and all_posts:
            print(f"Successfully crawled {len(all_posts)} posts from https://{domain}")
            return all_posts

    return []


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.read().decode("utf-8")


def clean_x_url(raw_url: str) -> str:
    if not raw_url:
        return raw_url
    status_match = re.search(r"/status/(\d+)", raw_url)
    if status_match:
        # パスからアカウント名も抽出を試みる
        acc_match = re.search(r"/([^/]+)/status/\d+", raw_url)
        acc = acc_match.group(1) if acc_match else "x"
        return f"https://x.com/{acc}/status/{status_match.group(1)}"
    return raw_url


def clean_image_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    media_match = re.search(r"/pic/(?:media%2F|media/|card_img%2F|card_img/)([^\"'\s?#]+)", raw_url)
    if media_match:
        file_part = urllib.parse.unquote(media_match.group(1))
        file_part = file_part.split("&")[0]
        return f"https://pbs.twimg.com/media/{file_part}"
    return raw_url


def normalize_text(value: str) -> str:
    lines = [line.strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


if __name__ == "__main__":
    sys.exit(main())
