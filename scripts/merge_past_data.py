#!/usr/bin/env python3
"""Merge past deleted events from git history back into the database."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def merge_group(group_id: str):
    try:
        # git show bcaa64a:data/{group_id}/events.json
        cmd = ["git", "show", f"bcaa64a:data/{group_id}/events.json"]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=True)
        old_events = json.loads(result.stdout)
    except Exception as e:
        print(f"No past data for {group_id} or failed: {e}")
        return

    curr_file = ROOT / "data" / group_id / "events.json"
    if curr_file.exists():
        curr_events = json.loads(curr_file.read_text(encoding="utf-8"))
    else:
        curr_events = []

    # IDをキーにしてマージ
    merged = {event.get("id"): event for event in old_events if event.get("id")}
    for event in curr_events:
        if event.get("id"):
            # 現在のイベントデータでマージ(最新状態を上書き)
            merged[event["id"]] = {**merged.get(event["id"], {}), **event}

    final_events = list(merged.values())
    final_events.sort(key=lambda event: (event.get("date", ""), event.get("time_start", "99:99")))

    # ファイルに書き出し
    curr_file.parent.mkdir(parents=True, exist_ok=True)
    curr_file.write_text(json.dumps(final_events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    
    docs_file = ROOT / "docs" / "data" / group_id / "events.json"
    docs_file.parent.mkdir(parents=True, exist_ok=True)
    docs_file.write_text(json.dumps(final_events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    
    print(f"Successfully merged {len(old_events)} past events into {group_id}. Total now: {len(final_events)}")

if __name__ == "__main__":
    merge_group("stainy")
    merge_group("anthurium")
