#!/usr/bin/env python3
"""High-precision analysis script for detecting date mismatches in events.json without false positives."""

import json
import sys
import re
from pathlib import Path
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

WEEKDAYS_JP = ["月", "火", "水", "木", "金", "土", "日"]
WEEKDAY_MAP = {"月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6}

def clean_text_for_dates(text: str) -> str:
    """Strip out numbers that are NOT dates (e.g. vol.20, #129, DAY2, 19:30, 5000yen, URLs)."""
    if not text:
        return ""
    
    # 1. URLの除去
    text = re.sub(r"https?://\S+", "", text)
    
    # 2. 回数・バージョン・日次表記の除外 (例: vol.20, #129, DAY2, 10th, 2MAN, 第3回, ver.1)
    text = re.sub(r"(?i)(?:vol|volume|#|no|第|ver|day|\d+man|\d+マン|anniversary|\d+th|\d+周年|edition|part)\.?\s*\d+", "", text)
    
    # 3. 時刻表記の除外 (例: 19:30, 22:00)
    text = re.sub(r"\d{1,2}:\d{2}", "", text)
    
    # 4. 単位付き数字の除外 (例: 5000円, 20分, 2pt, 100名, 3000yen)
    text = re.sub(r"\d+\s*(?:pt|ポイント|分|円|yen|名|人|曲|位|歳|周年)", "", text)
    
    return text


def analyze_event(group_id: str, event: dict) -> list[dict]:
    issues = []
    
    title = event.get("title", "") or ""
    details = event.get("details", "") or ""
    date_str = event.get("date", "") or ""
    created_at = event.get("created_at", "") or ""

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
    event_weekday = dt.weekday()

    # クリーニング後のテキストで判定
    cleaned_title = clean_text_for_dates(title)
    cleaned_full = clean_text_for_dates(f"{title}\n{details}")

    # 1. タイトル/本文中の明確な「M/D」または「M月D日」との不一致チェック
    # パターン: 8/15, 08/15, 8月15日 (前後が数字や記号で区切られていること)
    date_matches = list(re.finditer(r"(?<![0-9/])(1[0-2]|0?[1-9])[/月.](3[01]|[12]\d|0?[1-9])日?(?![0-9])", cleaned_full))
    
    found_dates = []
    for m in date_matches:
        m_month = int(m.group(1))
        m_day = int(m.group(2))
        found_dates.append((m_month, m_day, m.group(0)))

    if found_dates:
        # 該当イベントの月日が含まれているか
        matches_date = any(m_m == event_month and m_d == event_day for m_m, m_d, _ in found_dates)
        if not matches_date:
            # 主な日付（冒頭の日付など）とズレている場合
            primary_m, primary_d, raw_str = found_dates[0]
            # チケ発の告知などではなく、本番ライブ・イベントとして登録されている場合のみ
            is_ticket_event = (event.get("type") == "ticket" or "チケ発" in title or "チケット" in title)
            if not is_ticket_event:
                issues.append({
                    "type": "MONTH_DAY_MISMATCH",
                    "severity": "HIGH",
                    "detail": f"登録日付: {event_month}/{event_day} <-> 本文内明記日付: {primary_m}/{primary_d} ({raw_str})"
                })

    # 2. 本文中の「D日(曜日)」または「M/D(曜日)」の曜日不一致チェック
    dow_date_matches = list(re.finditer(r"(?:(\d{1,2})[/月.])?(\d{1,2})日?\s*[\(（]([月火水木金土日])[\)）]", cleaned_full))
    for m in dow_date_matches:
        m_day = int(m.group(2))
        m_dow_str = m.group(3)
        expected_dow = WEEKDAY_MAP.get(m_dow_str)
        
        # 本文の日と登録日の「日」が一致しているのに曜日が違う場合（真の曜日ミス）
        if m_day == event_day and expected_dow is not None and expected_dow != event_weekday:
            issues.append({
                "type": "WEEKDAY_MISMATCH",
                "severity": "HIGH",
                "detail": f"登録日 {date_str} の曜日は【{WEEKDAYS_JP[event_weekday]}】ですが、本文では【{m_dow_str}曜日】と表記されています"
            })

    # 3. 過去年のデータ（2025年以前）
    if event_year < 2026:
        issues.append({
            "type": "PAST_YEAR",
            "severity": "MEDIUM",
            "detail": f"過去の年【{event_year}年】のデータが残っています"
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

        for ev in events:
            issues = analyze_event(group_id, ev)
            if issues:
                all_issues.append({
                    "group": group_id,
                    "event_id": ev.get("id"),
                    "title": ev.get("title"),
                    "date": ev.get("date"),
                    "type": ev.get("type"),
                    "issues": issues
                })

    print(f"Total events analyzed: {total_events}")
    print(f"Total true issues found: {len(all_issues)}")
    
    # 理由別の集計
    by_reason = {}
    for item in all_issues:
        for issue in item["issues"]:
            t = issue["type"]
            by_reason[t] = by_reason.get(t, 0) + 1

    print("\nIssues summary (False Positives eliminated):")
    for t, count in by_reason.items():
        print(f"  - {t}: {count}件")

    out_path = ROOT / "scripts" / "improved_analysis_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_issues, f, ensure_ascii=False, indent=2)

    print(f"\nSaved improved analysis to {out_path}")

if __name__ == "__main__":
    main()
