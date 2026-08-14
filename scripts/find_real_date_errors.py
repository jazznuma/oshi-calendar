#!/usr/bin/env python3
"""Precision script to identify true date misclassifications and categorize root causes."""

import json
import re
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

WEEKDAYS_JP = ["月", "火", "水", "木", "金", "土", "日"]
WEEKDAY_MAP = {"月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6}

def clean_title_for_date_parsing(text: str) -> str:
    """Remove numbers that look like vol.X, #X, or time (19:30) to prevent false dates."""
    # vol.123, #123, 2MAN, 4MAN などを除去
    text = re.sub(r"(?i)(?:vol|#|no|第|ver|\d+man|\d+マン)\.?\s*\d+", "", text)
    # 19:30 などの時刻表現を除去
    text = re.sub(r"\d{1,2}:\d{2}", "", text)
    return text

def main():
    groups = [p.name for p in DATA_DIR.iterdir() if p.is_dir()]
    real_errors = []

    for group_id in sorted(groups):
        events_path = DATA_DIR / group_id / "events.json"
        if not events_path.exists():
            continue

        with open(events_path, "r", encoding="utf-8") as f:
            events = json.load(f)

        for ev in events:
            date_str = ev.get("date", "")
            title = ev.get("title", "") or ""
            details = ev.get("details", "") or ""
            full_text = f"{title}\n{details}"

            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                continue

            event_month = dt.month
            event_day = dt.day
            event_year = dt.year
            event_dow = dt.weekday()

            cleaned_text = clean_title_for_date_parsing(full_text)

            error_type = None
            description = ""
            detected_date = ""

            # ケース1: チケ発・告知投稿で「イベント本番日」ではなく「チケ発日/投稿日」が登録されているパターン
            # 例: タイトル「8/11(火祝) 水城なゆ生誕祭 チケ発」に対し 登録日 2026-07-18
            # 例: タイトル「9/12(土) 花瀬さな生誕祭 チケ発」に対し 登録日 2026-08-03
            ticket_event_match = re.search(r"(\d{1,2})[/月.](\d{1,2})日?\s*(?:[\(（]([月火水木金土日])[\)）])?.*?(?:生誕|ライブ|公演|フェス|ワンマン|対バン|まつり|祭)", cleaned_text)
            if ticket_event_match:
                t_m = int(ticket_event_match.group(1))
                t_d = int(ticket_event_match.group(2))
                
                # タイトル/本文冒頭に明記されたイベント日と、実際の登録日(date)が異なる場合
                if (t_m != event_month or t_d != event_day):
                    # 「チケ発」「受付」「発売」という単語が入っている場合はチケット受付日誤認識
                    if any(k in full_text for k in ["チケ発", "チケット発売", "受付開始", "先着", "抽選"]):
                        error_type = "TICKET_DATE_MISMATCH"
                        description = f"イベント開催日【{t_m}/{t_d}】ではなく、チケット受付日/告知日【{event_month}/{event_day}】がイベント日付として登録されている"
                        detected_date = f"{t_m}/{t_d}"
                    else:
                        error_type = "DATE_MISMATCH"
                        description = f"本文/タイトルの明記日付【{t_m}/{t_d}】と登録日付【{event_month}/{event_day}】が一致しない"
                        detected_date = f"{t_m}/{t_d}"

            # ケース2: 1日〜数日の微妙なズレ（例: 本文「6/13(土)」に対し登録日「6/14(日)」）
            if not error_type:
                day_dow_match = re.search(r"(?:(\d{1,2})[/月.])?(\d{1,2})日?\s*[\(（]([月火水木金土日])[\)）]", cleaned_text)
                if day_dow_match:
                    m_val = int(day_dow_match.group(1)) if day_dow_match.group(1) else event_month
                    d_val = int(day_dow_match.group(2))
                    dow_val = day_dow_match.group(3)
                    exp_dow = WEEKDAY_MAP.get(dow_val)

                    if m_val == event_month and abs(d_val - event_day) in [1, 2]:
                        error_type = "DATE_SHIFT"
                        description = f"本文の日付【{m_val}/{d_val}({dow_val})】に対し、登録日が【{event_month}/{event_day}({WEEKDAYS_JP[event_dow]})】と{event_day - d_val:+d}日ズレている"
                        detected_date = f"{m_val}/{d_val}({dow_val})"

            # ケース3: 過去の年（2023年〜2025年など）で残っているもの
            if not error_type and event_year < 2026:
                error_type = "PAST_YEAR_EVENT"
                description = f"2026年現在のカレンダーに過去の年【{event_year}年】のデータが残っている"

            if error_type:
                real_errors.append({
                    "group": group_id,
                    "error_type": error_type,
                    "date": date_str,
                    "title": title,
                    "description": description,
                    "detected_date": detected_date,
                    "post_url": ev.get("post_url"),
                    "details": details[:100]
                })

    out_path = ROOT / "scripts" / "real_date_errors.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(real_errors, f, ensure_ascii=False, indent=2)

    print(f"Filtered real error count: {len(real_errors)}")
    
    # カテゴリ別集計
    by_type = {}
    for err in real_errors:
        t = err["error_type"]
        by_type[t] = by_type.get(t, 0) + 1

    print("\nError counts by type:")
    for t, count in by_type.items():
        print(f"  - {t}: {count}件")

    by_group = {}
    for err in real_errors:
        g = err["group"]
        by_group[g] = by_group.get(g, 0) + 1

    print("\nError counts by group:")
    for g, count in sorted(by_group.items(), key=lambda x: x[1], reverse=True):
        print(f"  - {g}: {count}件")

if __name__ == "__main__":
    main()
