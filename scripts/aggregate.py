# -*- coding: utf-8 -*-
"""釣果データ集計 → ダッシュボード用 data.js 生成。

data/catches/*.jsonl（サンプル＋収集分）と data/access/page_views.jsonl を読み、
ダッシュボードがクライアントサイドでクロス集計できるコンパクトな列指向
フォーマット（インデックス参照の配列）に変換して dashboard/data.js に書き出す。
"""
import glob
import json
import os
from datetime import datetime

from common import (ACCESS_DIR, CATCHES_DIR, ROOT, TIDE_NAMES, WEATHER_LABELS,
                    WIND_DIRS, load_boats, read_jsonl)

OUT_JS = os.path.join(ROOT, "dashboard", "data.js")


def main():
    boats = load_boats()
    boat_idx = {b["id"]: i for i, b in enumerate(boats)}

    records = []
    for path in sorted(glob.glob(os.path.join(CATCHES_DIR, "*.jsonl"))):
        records.extend(read_jsonl(path))
    records = [r for r in records if r["boat_id"] in boat_idx and r.get("total") is not None]
    records.sort(key=lambda r: r["date"])

    dates = sorted({r["date"] for r in records})
    date_idx = {d: i for i, d in enumerate(dates)}
    species = sorted({r["species"] for r in records})
    species_idx = {s: i for i, s in enumerate(species)}
    weather_idx = {w: i for i, w in enumerate(WEATHER_LABELS)}
    wind_idx = {w: i for i, w in enumerate(WIND_DIRS)}
    tide_idx = {t: i for i, t in enumerate(TIDE_NAMES)}

    trips = []
    for r in records:
        trips.append([
            date_idx[r["date"]],
            boat_idx[r["boat_id"]],
            species_idx[r["species"]],
            int(r["total"]),
            int(r.get("anglers") or 0),
            weather_idx.get(r.get("weather"), -1),
            wind_idx.get(r.get("wind_dir"), -1),
            tide_idx.get(r.get("tide"), -1),
            int(r.get("top") or 0),
        ])

    views = [[v["month"], boat_idx[v["boat_id"]], v["views"]]
             for v in read_jsonl(os.path.join(ACCESS_DIR, "page_views.jsonl"))
             if v["boat_id"] in boat_idx]

    data = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "boats": [{"id": b["id"], "name": b["name"], "port": b["port"], "city": b["city"],
                   "pref": b["pref"], "bay": b["bay"], "targets": b["targets"],
                   "website": b.get("website"), "confidence": b.get("confidence", "medium")}
                  for b in boats],
        "dates": dates,
        "species": species,
        "weather": WEATHER_LABELS,
        "wind": WIND_DIRS,
        "tide": TIDE_NAMES,
        "trips": trips,
        "views": views,
    }
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("window.FISHING_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    size_kb = os.path.getsize(OUT_JS) // 1024
    print(f"wrote {OUT_JS} ({size_kb} KB, {len(trips)} trips, {len(boats)} boats, {len(species)} species)")


if __name__ == "__main__":
    main()
