# -*- coding: utf-8 -*-
"""開発・デモ用のサンプル釣果データ生成。

実データ収集（collect_catches.py）のアダプタが揃うまでの間、ダッシュボードの
全機能（魚種/船/エリア/時期/天候/風向/潮回り/アクセス数の分析）を検証できる
現実的な分布のデータを生成する。

- 釣期（魚種ごとの月別ウェイト）・天候・風速・潮回りが釣果に効く生成モデル
- 潮回りは月齢からの実計算（common.tide_name）
- 天候・風向は関東沿岸の季節傾向を近似（冬=北寄り/晴れ、夏=南寄り）

出力:
  data/catches/sample_catches.jsonl  … 1隻×1釣り物×1日 = 1レコード
  data/access/page_views.jsonl       … 船宿ページの月間アクセス数（サンプル）
"""
import os
import random
from datetime import date, timedelta

from common import (ACCESS_DIR, CATCHES_DIR, SPECIES, TIDE_FACTOR, WEATHER_LABELS,
                    WIND_DIRS, load_boats, tide_name, write_jsonl)

random.seed(20260716)

DAYS = 366  # 直近1年分
END = date(2026, 7, 15)


def synth_weather(d: date, rng: random.Random):
    """季節性のある簡易天候モデル（月別の晴/曇/雨確率と卓越風向）"""
    m = d.month
    rain_p = [0.12, 0.14, 0.18, 0.20, 0.22, 0.35, 0.30, 0.22, 0.30, 0.25, 0.15, 0.10][m - 1]
    cloud_p = 0.30
    r = rng.random()
    weather = "雨" if r < rain_p else ("曇り" if r < rain_p + cloud_p else "晴れ")
    # 冬は北寄り、夏は南寄りの卓越風
    if m in (12, 1, 2, 3):
        dirs, w = ["北", "北東", "北西", "西"], [4, 2, 3, 1]
    elif m in (6, 7, 8, 9):
        dirs, w = ["南", "南西", "南東", "東"], [4, 3, 2, 1]
    else:
        dirs, w = WIND_DIRS, [1] * 8
    wind_dir = rng.choices(dirs, weights=w)[0]
    wind_speed = round(max(0.5, rng.gauss(4.5, 2.5) + (1.5 if weather == "雨" else 0)), 1)
    return weather, wind_dir, wind_speed


def main():
    boats = load_boats()
    catches = []
    views = []
    rng = random.Random(1)

    for boat in boats:
        popularity = rng.uniform(0.6, 1.4)  # 船宿ごとの集客力
        for i in range(DAYS):
            d = END - timedelta(days=DAYS - 1 - i)
            weather, wind_dir, wind_speed = synth_weather(d, rng)
            tide = tide_name(d)
            # 強風・荒天は出船中止になりやすい
            sail_p = 0.75
            if wind_speed > 10:
                sail_p = 0.15
            elif weather == "雨":
                sail_p = 0.55
            if rng.random() > sail_p:
                continue
            # その日に出す釣り物（釣期ウェイトで選ぶ。時期外れは休船扱い）
            month_idx = d.month - 1
            weights = [SPECIES[t]["season"][month_idx] for t in boat["targets"]]
            if sum(weights) <= 0.1:
                continue
            n_trips = 1 if rng.random() < 0.7 else 2
            chosen = set()
            for _ in range(n_trips):
                target = rng.choices(boat["targets"], weights=[w + 0.01 for w in weights])[0]
                if target in chosen:
                    continue
                chosen.add(target)
                meta = SPECIES[target]
                season_w = meta["season"][month_idx]
                if season_w <= 0.05:
                    continue
                anglers = max(2, min(20, int(rng.gauss(9 * popularity, 4))))
                cond = TIDE_FACTOR[tide]
                if weather == "雨":
                    cond *= 0.85
                if wind_speed > 8:
                    cond *= 0.6
                per_head = meta["base"] * season_w * cond * rng.lognormvariate(0, 0.45)
                total = max(0, int(anglers * per_head))
                top = 0 if total == 0 else max(1, int(per_head * rng.uniform(1.5, 2.5)))
                catches.append({
                    "date": d.isoformat(),
                    "boat_id": boat["id"],
                    "target": target,
                    "species": target,
                    "total": total,
                    "top": top,           # 竿頭
                    "anglers": anglers,
                    "weather": weather,
                    "wind_dir": wind_dir,
                    "wind_speed": wind_speed,
                    "tide": tide,
                    "source": "sample",
                })
        # 月間ページアクセス数（本番ではアクセス解析から取り込む）
        d = date(END.year - 1, END.month, 1)
        while d <= END:
            base_views = int(800 * popularity * rng.uniform(0.7, 1.3))
            views.append({"month": d.strftime("%Y-%m"), "boat_id": boat["id"], "views": base_views})
            d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)

    write_jsonl(os.path.join(CATCHES_DIR, "sample_catches.jsonl"), catches)
    write_jsonl(os.path.join(ACCESS_DIR, "page_views.jsonl"), views)
    print(f"generated {len(catches)} catch records / {len(views)} page-view records for {len(boats)} boats")


if __name__ == "__main__":
    main()
