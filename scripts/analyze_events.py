#!/usr/bin/env python3
"""Analyze events.json across all groups to detect potential date mismatches or errors."""

import json
import re
import calendar
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

WEEKDAYS_JP = ["月", "火", "水", "木", "金", "土", "日"]
WEEKDAY_MAP = {
    "月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6,
    "月祝": 0, "火祝": 1, "水祝": 2, "木祝": 3, "金祝": 4, "土祝": 5, "日祝": 6,
    "祝": None
}

def analyze_event(group_id: str, event: dict) -> list[dict]:
    issues = []
    
    title = event.get("title", "")
    details = event.get("details", "")
    text = f"{title}\n{details}"
    date_str = event.get("date", "")
    created_at = event.get("created_at", "")
    event_id = event.get("id", "")
    post_url = event.get("post_url", "")

    if not date_str or not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        issues.append({
            "type": "INVALID_DATE_FORMAT",
            "severity": "HIGH",
            "detail": f"不正な日付フォーマット: {date_str}"
        })
        return issues

    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        issues.append({
            "type": "INVALID_DATE",
            "severity": "HIGH",
            "detail": f"存在しない日付: {date_str}"
        })
        return issues

    event_year = dt.year
    event_month = dt.month
    event_day = dt.day
    event_weekday = dt.weekday() # 0: Mon, 6: Sun

    # 1. 本文から M/D または M月D日 を検出して日付一致チェック
    # パターン例: 8/15, 08/15, 8月15日, 8.15
    date_matches = list(re.finditer(r"(?<!\d)(1[0-2]|0?[1-9])[/月.](3[01]|[12]\d|0?[1-9])日?(?!\d)", text))
    
    found_dates = []
    for m in date_matches:
        m_month = int(m.group(1))
        m_day = int(m.group(2))
        found_dates.append((m_month, m_day, m.group(0)))

    if found_dates:
        # 本文中の日付リストに event['date'] の (month, day) が含まれているか
        matches_date = any(m_m == event_month and m_d == event_day for m_m, m_d, _ in found_dates)
        if not matches_date:
            dates_str = ", ".join(f"{m}/{d} (表記: {raw})" for m, d, raw in found_dates[:3])
            issues.append({
                "type": "MONTH_DAY_MISMATCH",
                "severity": "HIGH",
                "detail": f"登録日付: {event_month}/{event_day} (登録年: {event_year}) <-> 本文内検出日付: {dates_str}"
            })

    # 2. 本文から (月)〜(日) などの曜日を検出して比較
    # パターン例: 8/15(土), 15日(土), (土), 【土】
    dow_matches = list(re.finditer(r"\(?（?([月火水木金土日])(?:祝)?\)?）?", text))
    # より正確に「日付 + (曜日)」の形式を探す
    dow_date_matches = list(re.finditer(r"(?:(\d{1,2})[/月.])?(\d{1,2})日?\s*[\(（\[【]([月火水木金土日])(?:祝)?[\)）\]】]", text))
    
    for m in dow_date_matches:
        m_day = int(m.group(2))
        m_dow_str = m.group(3)
        expected_dow = WEEKDAY_MAP.get(m_dow_str)
        
        # もし本文の「日」が登録日と一致している場合、曜日も一致しているか
        if m_day == event_day:
            if expected_dow is not None and expected_dow != event_weekday:
                issues.append({
                    "type": "WEEKDAY_MISMATCH",
                    "severity": "MEDIUM",
                    "detail": f"登録日 {date_str} の曜日は【{WEEKDAYS_JP[event_weekday]}】ですが、本文では【{m_dow_str}曜日】と表記されています"
                })

    # 3. 過去の日付（例: 2026-06-01 より前で最近作成された等）または過去の誤検出
    if date_str < "2026-06-01" and created_at and created_at > "2026-06-01T00:00:00Z" and "2020-01-01" not in created_at:
        issues.append({
            "type": "PAST_DATE_WARNING",
            "severity": "LOW",
            "detail": f"過去の日付({date_str})として新しく登録されています"
        })

    return issues

def main():
    groups = [p.name for p in DATA_DIR.iterdir() if p.is_dir()]
    total_events = 0
    all_issues = []

    for group_id in sorted(groups):
        events_path = DATA_DIR / group_id / "events.json"
        if not events_path.exists():
            continue

        with open(events_path, "r", encoding="utf-8") as f:
            events = json.load(f)

        total_events += len(events)
        group_issues_count = 0

        for ev in events:
            issues = analyze_event(group_id, ev)
            if issues:
                group_issues_count += 1
                all_issues.append({
                    "group": group_id,
                    "event_id": ev.get("id"),
                    "title": ev.get("title"),
                    "date": ev.get("date"),
                    "time_start": ev.get("time_start"),
                    "details": ev.get("details", "")[:100].replace("\n", " "),
                    "post_url": ev.get("post_url"),
                    "issues": issues
                })

    print(f"Total events analyzed: {total_events}")
    print(f"Total suspicious events found: {len(all_issues)}")
    
    # JSONレポートの保存
    out_path = ROOT / "scripts" / "analysis_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_issues, f, ensure_ascii=False, indent=2)
        
    print(f"Saved analysis results to {out_path}")

if __name__ == "__main__":
    main()
