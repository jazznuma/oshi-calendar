#!/usr/bin/env python3
"""Fix verified date/category errors in events.json for all groups."""

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DOCS_DATA_DIR = ROOT / "docs" / "data"

def fix_group_events(group_id: str):
    data_path = DATA_DIR / group_id / "events.json"
    docs_path = DOCS_DATA_DIR / group_id / "events.json"

    if not data_path.exists():
        return 0

    with open(data_path, "r", encoding="utf-8") as f:
        events = json.load(f)

    modified_count = 0

    for ev in events:
        title = ev.get("title", "") or ""
        details = ev.get("details", "") or ""
        text = f"{title}\n{details}"
        current_type = ev.get("type", "")
        current_date = ev.get("date", "")

        # 1. Jumping Kiss の2027年7月4日ライブ前物販告知の修正
        if group_id == "jumpingkiss" and "7月4日の池袋での対バン" in text and current_date == "2027-06-24":
            ev["date"] = "2026-07-04"
            ev["type"] = "live"
            modified_count += 1
            print(f"[{group_id}] Fixed date for 7月4日対バン: 2027-06-24 -> 2026-07-04")

        # 2. miao の名古屋オフ会 (6/13(土)を6/14と誤登録) の修正
        elif group_id == "miao" and "名古屋オフ会ですが6/13(土)" in text and current_date == "2026-06-14":
            ev["date"] = "2026-06-13"
            modified_count += 1
            print(f"[{group_id}] Fixed date for 名古屋オフ会: 2026-06-14 -> 2026-06-13")

        # 3. チケ発告知なのに type が "ticket" 以外になっているものを "ticket" カテゴリに補正
        elif ("チケ発" in title or "チケット発売" in title or "受付開始" in title) and current_type != "ticket":
            ev["type"] = "ticket"
            modified_count += 1
            print(f"[{group_id}] Corrected type to 'ticket' for: {title[:30]}")

    if modified_count > 0:
        # ソートして保存
        events.sort(key=lambda event: (event.get("date", ""), event.get("time_start", "99:99")))
        
        with open(data_path, "w", encoding="utf-8") as f:
            json.dump(events, f, ensure_ascii=False, indent=2)

        if docs_path.parent.exists():
            with open(docs_path, "w", encoding="utf-8") as f:
                json.dump(events, f, ensure_ascii=False, indent=2)

    return modified_count

def main():
    groups = [p.name for p in DATA_DIR.iterdir() if p.is_dir()]
    total_fixed = 0

    for group_id in sorted(groups):
        count = fix_group_events(group_id)
        total_fixed += count

    print(f"\nCompleted! Total fixed events: {total_fixed}")

if __name__ == "__main__":
    main()
