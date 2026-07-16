# -*- coding: utf-8 -*-
"""共通ライブラリ: 船宿マスタ読込 / 魚種メタデータ / 潮回り（月齢ベース簡易計算）"""
import json
import math
import os
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOATS_PATH = os.path.join(ROOT, "data", "boats.json")
CATCHES_DIR = os.path.join(ROOT, "data", "catches")
ACCESS_DIR = os.path.join(ROOT, "data", "access")

WEATHER_LABELS = ["晴れ", "曇り", "雨"]
WIND_DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"]
TIDE_NAMES = ["大潮", "中潮", "小潮", "長潮", "若潮"]

# 魚種メタデータ:
#   season  = 月別の釣期ウェイト (1月〜12月, 0〜1)
#   base    = 好条件時の平均釣果/人（尾）の目安
SPECIES = {
    "マダイ":        {"season": [.5, .5, .7, 1, 1, .9, .6, .5, .7, .9, .8, .6], "base": 1.2},
    "アマダイ":      {"season": [1, .9, .8, .5, .3, .2, .2, .2, .5, .9, 1, 1], "base": 1.5},
    "イサキ":        {"season": [.2, .2, .3, .6, 1, 1, .9, .5, .4, .3, .2, .2], "base": 15},
    "カワハギ":      {"season": [.9, .7, .5, .3, .2, .2, .3, .4, .6, 1, 1, 1], "base": 8},
    "シロギス":      {"season": [.3, .3, .4, .6, .9, 1, 1, 1, .9, .7, .5, .3], "base": 25},
    "LTアジ":        {"season": [.7, .7, .8, .8, .9, 1, 1, 1, .9, .9, .8, .7], "base": 30},
    "タチウオ":      {"season": [.6, .5, .4, .3, .4, .5, .8, 1, 1, 1, .9, .8], "base": 8},
    "ヒラメ":        {"season": [1, 1, .9, .7, .4, .2, .2, .2, .3, .5, .8, 1], "base": 1.5},
    "マゴチ":        {"season": [.2, .2, .3, .6, .9, 1, 1, .9, .7, .5, .3, .2], "base": 2},
    "イナダ・ワラサ": {"season": [.5, .4, .3, .3, .4, .5, .6, .7, 1, 1, 1, .8], "base": 2},
    "カツオ・キハダ": {"season": [0, 0, 0, 0, .2, .4, .8, 1, 1, 1, .6, .2], "base": 1.2},
    "キンメダイ":    {"season": [1, 1, 1, .9, .8, .6, .5, .5, .6, .8, .9, 1], "base": 6},
    "クロムツ":      {"season": [.6, .6, .7, .8, .9, 1, 1, .9, .8, .7, .6, .6], "base": 5},
    "アカムツ":      {"season": [.7, .7, .7, .8, .9, 1, 1, .9, .8, .7, .7, .7], "base": 1.5},
    "オニカサゴ":    {"season": [1, 1, .9, .8, .7, .6, .6, .6, .7, .8, .9, 1], "base": 2},
    "マルイカ":      {"season": [.2, .3, .7, 1, 1, .9, .7, .4, .2, .1, .1, .1], "base": 20},
    "ヤリイカ":      {"season": [1, 1, 1, .8, .4, .1, 0, 0, .1, .3, .6, .9], "base": 12},
    "スルメイカ":    {"season": [.2, .2, .3, .4, .7, 1, 1, .9, .7, .4, .3, .2], "base": 10},
    "アオリイカ":    {"season": [.4, .3, .3, .6, .8, .7, .3, .2, .5, 1, 1, .7], "base": 1.5},
    "スミイカ":      {"season": [1, .8, .5, .3, .1, .1, .1, .2, .5, .9, 1, 1], "base": 4},
    "マダコ":        {"season": [.3, .3, .3, .4, .6, 1, 1, 1, .8, .6, .4, .3], "base": 3},
    "湾フグ":        {"season": [.8, .7, .7, .7, .7, .7, .7, .8, .9, 1, 1, .9], "base": 10},
    "シーバス":      {"season": [1, .9, .7, .5, .4, .4, .4, .5, .7, .9, 1, 1], "base": 8},
    "アナゴ":        {"season": [.2, .2, .3, .5, .9, 1, 1, .8, .5, .3, .2, .2], "base": 6},
    "ハゼ":          {"season": [.3, .2, .2, .3, .5, .7, .9, 1, 1, 1, .8, .5], "base": 40},
}

# 潮回り係数（大潮・中潮で活性が上がる魚が多い、という一般的傾向の近似）
TIDE_FACTOR = {"大潮": 1.15, "中潮": 1.10, "小潮": 0.90, "長潮": 0.85, "若潮": 0.95}

_SYNODIC = 29.530588853
_EPOCH_NEW_MOON = datetime(2000, 1, 6, 18, 14)  # 基準新月 (UTC)


def moon_age(d: date) -> float:
    """月齢（0〜29.53）の簡易計算。潮回り判定用途には十分な精度。"""
    dt = datetime(d.year, d.month, d.day, 12, 0)
    days = (dt - _EPOCH_NEW_MOON).total_seconds() / 86400.0
    return days % _SYNODIC


def tide_name(d: date) -> str:
    """月齢から潮回り（大潮/中潮/小潮/長潮/若潮）を求める伝統的な対応表。"""
    lunar_day = int(moon_age(d)) + 1  # 旧暦日の近似 (1〜30)
    if lunar_day in (1, 2, 14, 15, 16, 29, 30):
        return "大潮"
    if lunar_day in (3, 4, 5, 6, 12, 13, 17, 18, 19, 20, 21, 27, 28):
        return "中潮"
    if lunar_day in (7, 8, 9, 22, 23, 24):
        return "小潮"
    if lunar_day in (10, 25):
        return "長潮"
    return "若潮"  # 11, 26


def load_boats():
    with open(BOATS_PATH, encoding="utf-8") as f:
        return json.load(f)["boats"]


def write_jsonl(path, records):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
