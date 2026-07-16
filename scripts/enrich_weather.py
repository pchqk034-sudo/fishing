# -*- coding: utf-8 -*-
"""釣果レコードへの実測気象データ付与（Open-Meteo Archive API 利用）。

collect_catches.py が収集したレコードのうち weather / wind_dir / wind_speed が
欠損しているものに、船宿の港座標と日付から実測値を付与する。
Open-Meteo の Archive API は無償・API キー不要（非商用）。商用公開時は
有償プランまたは気象庁データ等への切替を検討すること。

使い方: python scripts/enrich_weather.py data/catches/collected_20260716.jsonl
"""
import json
import sys
import urllib.parse
import urllib.request

from common import WIND_DIRS, load_boats, read_jsonl, write_jsonl

API = "https://archive-api.open-meteo.com/v1/archive"


def deg_to_dir(deg: float) -> str:
    return WIND_DIRS[int(((deg + 22.5) % 360) / 45)]


def code_to_weather(code: int) -> str:
    if code in (0, 1):
        return "晴れ"
    if code in (2, 3, 45, 48):
        return "曇り"
    return "雨"


def fetch_day(lat: float, lon: float, day: str) -> dict | None:
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon,
        "start_date": day, "end_date": day,
        "daily": "weather_code,wind_speed_10m_max,wind_direction_10m_dominant,temperature_2m_mean",
        "timezone": "Asia/Tokyo",
    })
    try:
        with urllib.request.urlopen(f"{API}?{q}", timeout=30) as res:
            d = json.load(res)["daily"]
        return {
            "weather": code_to_weather(d["weather_code"][0]),
            "wind_speed": round(d["wind_speed_10m_max"][0] / 3.6, 1),  # km/h -> m/s
            "wind_dir": deg_to_dir(d["wind_direction_10m_dominant"][0]),
            "temp": d["temperature_2m_mean"][0],
        }
    except Exception as e:
        print(f"  weather fetch failed ({day}): {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    records = read_jsonl(path)
    boats = {b["id"]: b for b in load_boats()}
    cache: dict[tuple, dict | None] = {}
    enriched = 0
    for r in records:
        if r.get("weather"):
            continue
        boat = boats.get(r["boat_id"])
        if not boat:
            continue
        key = (round(boat["lat"], 1), round(boat["lon"], 1), r["date"])
        if key not in cache:
            cache[key] = fetch_day(boat["lat"], boat["lon"], r["date"])
        w = cache[key]
        if w:
            r.update({k: v for k, v in w.items() if k != "temp"})
            r["temp"] = w["temp"]
            enriched += 1
    write_jsonl(path, records)
    print(f"enriched {enriched}/{len(records)} records in {path}")


if __name__ == "__main__":
    main()
