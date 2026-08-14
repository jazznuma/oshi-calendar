#!/usr/bin/env python3
"""Refine analysis results to find high-confidence date misclassifications."""

import json
import re
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
RESULTS_PATH = ROOT / "scripts" / "analysis_results.json"
DATA_DIR = ROOT / "data"

WEEKDAYS_JP = ["月", "火", "水", "木", "金", "土", "日"]
WEEKDAY_MAP = {"月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6}

def main():
    if not RESULTS_PATH.exists():
        print("analysis_results.json not found!")
        return

    with open(RESULTS_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    high_confidence_errors = []

    for item in items:
        group = item["group"]
        date_str = item["date"]
        title = item["title"] or ""
        details = item["details"] or ""
        text = f"{title}\n{details}"
        
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue

        event_month = dt.month
        event_day = dt.day
        event_weekday = dt.weekday()

        reasons = []

        # パターンA: タイトル直直に明記されている M/D や M月D日 が date と完全に食い違う
        title_date_match = re.search(r"(?:(\d{1,2})[/月.])?(\d{1,2})日?(?:\s*[\(（]([月火水木金土日])[\)）])?", title)
        if title_date_match:
            t_month = int(title_date_match.group(1)) if title_date_match.group(1) else None
            t_day = int(title_date_match.group(2))
            t_dow = title_date_match.group(3)

            # 月・日が指定されているのに一致しない
            if t_month and (t_month != event_month or t_day != event_day):
                reasons.append(f"タイトル日付【{t_month}/{t_day}】と登録日【{event_month}/{event_day}】が不一致")
            elif not t_month and t_day != event_day:
                # 日のみ指定
                reasons.append(f"タイトル表記日【{t_day}日】と登録日【{event_day}日】が不一致")

            if t_dow:
                expected_dow = WEEKDAY_MAP.get(t_dow)
                if expected_dow is not None and expected_dow != event_weekday:
                    reasons.append(f"タイトル曜日【({t_dow})】と登録日の実際の曜日【({WEEKDAYS_JP[event_weekday]})】が不一致")

        # パターンB: 本文内の「日付 + 曜日」パターンで、指定された月日が登録日と近接しているがズレている（例: 1日ズレ）
        # 例: 本文 "8/15(土)" に対し 登録日 "2026-08-16"
        dow_matches = re.finditer(r"(?:(\d{1,2})[/月.])(\d{1,2})日?\s*[\(（]([月火水木金土日])[\)）]", text)
        for m in dow_matches:
            b_month = int(m.group(1))
            b_day = int(m.group(2))
            b_dow = m.group(3)
            expected_dow = WEEKDAY_MAP.get(b_dow)

            # 同じ月で、日が±1〜3日程度ズレている場合（誤検出の典型）
            if b_month == event_month and abs(b_day - event_day) in [1, 2, 7]:
                reasons.append(f"本文【{b_month}/{b_day}({b_dow})】に対し登録日が【{event_month}/{event_day}({WEEKDAYS_JP[event_weekday]})】（{event_day - b_day:+d}日のズレ）")
                break

        # パターンC: 年の誤認定（過去の年 2024, 2025 年として登録されている将来イベント等）
        if dt.year < 2026:
            reasons.append(f"過去の年【{dt.year}年】として登録されています")

        if reasons:
            high_confidence_errors.append({
                "group": group,
                "date": date_str,
                "title": title,
                "reasons": reasons,
                "details_snippet": details[:120],
                "post_url": item.get("post_url")
            })

    print(f"High confidence error count: {len(high_confidence_errors)}")
    
    out_path = ROOT / "scripts" / "high_confidence_errors.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(high_confidence_errors, f, ensure_ascii=False, indent=2)

    print(f"Saved high confidence errors to {out_path}")

    # 上位グループ別の集計
    by_group = {}
    for err in high_confidence_errors:
        g = err["group"]
        by_group[g] = by_group.get(g, 0) + 1
    print("\nError count by group:")
    for g, count in sorted(by_group.items(), key=lambda x: x[1], reverse=True):
        print(f"  - {g}: {count}件")

if __name__ == "__main__":
    main()
