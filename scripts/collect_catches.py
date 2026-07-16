# -*- coding: utf-8 -*-
"""実釣果データ収集フレームワーク。

各船宿の公式サイト等の「釣果情報」ページから釣果を収集するための土台。
サイトごとの構造差はアダプタ（Adapter）で吸収する。

★ 運用上の必須ルール（README「データ収集とコンプライアンス」参照）★
  1. 対象サイトの利用規約と robots.txt を必ず確認・遵守する
  2. リクエスト間隔は最低 REQUEST_INTERVAL 秒（既定10秒）を空ける
  3. 収集は1日1回程度に留める（GitHub Actions の cron 参照）
  4. 可能な限り各船宿へ掲載許諾を取り、出典を明記する

使い方:
  data/boats.json の各船宿に "catch_page" と "adapter" を追記し、
  ADAPTERS に対応するアダプタを実装して実行する。
    python scripts/collect_catches.py            # 全船宿
    python scripts/collect_catches.py annamaru   # 特定の船宿のみ

出力: data/catches/collected_YYYYMMDD.jsonl（sample_catches.jsonl と同スキーマ）
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

from common import CATCHES_DIR, load_boats, tide_name, write_jsonl

REQUEST_INTERVAL = 10  # 秒。短くしないこと。
USER_AGENT = "sagami-tokyobay-fishing-dashboard/0.1 (+see repository README; contact: repo owner)"


def fetch(url: str) -> str | None:
    """robots.txt を確認してから取得。拒否されたら None。"""
    rp = urllib.robotparser.RobotFileParser()
    base = re.match(r"https?://[^/]+", url).group(0)
    try:
        rp.set_url(base + "/robots.txt")
        rp.read()
        if not rp.can_fetch(USER_AGENT, url):
            print(f"  robots.txt disallows: {url}")
            return None
    except Exception:
        pass  # robots.txt が無い場合は続行
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode(res.headers.get_content_charset() or "utf-8", errors="replace")


class TextExtractor(HTMLParser):
    """タグを除去して本文テキストを取り出す簡易パーサ。"""

    def __init__(self):
        super().__init__()
        self.chunks = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.chunks.append(data.strip())


def html_to_text(html: str) -> str:
    p = TextExtractor()
    p.feed(html)
    return "\n".join(p.chunks)


# ---------------------------------------------------------------- adapters --

def adapter_generic_regex(boat: dict, html: str) -> list[dict]:
    """汎用アダプタ: 「魚種 n〜m匹/杯/尾」のパターンをテキストから抽出する。

    多くの船宿釣果ページは「マダイ 0〜3匹」のような表記のため、
    まずはこれで拾い、精度が必要なサイトには専用アダプタを書く。
    """
    text = html_to_text(html)
    today = dt.date.today()
    records = []
    pattern = re.compile(r"([ァ-ヶー・LT湾]+?)\s*(\d+)\s*[〜~-]\s*(\d+)\s*(?:匹|杯|尾|本|枚)")
    for m in pattern.finditer(text):
        species, lo, hi = m.group(1), int(m.group(2)), int(m.group(3))
        records.append({
            "date": today.isoformat(),
            "boat_id": boat["id"],
            "target": species,
            "species": species,
            "total": None,          # 合計不明のサイトでは None
            "top": hi,              # 竿頭
            "anglers": None,
            "weather": None,        # enrich_weather.py が後段で付与
            "wind_dir": None,
            "wind_speed": None,
            "tide": tide_name(today),
            "source": boat.get("catch_page"),
        })
    return records


# boats.json の "adapter" フィールド名 → 関数
ADAPTERS = {
    "generic_regex": adapter_generic_regex,
    # "annamaru": adapter_annamaru,  ← サイト個別アダプタをここに追加
}


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    boats = load_boats()
    out = []
    for boat in boats:
        if only and boat["id"] != only:
            continue
        page = boat.get("catch_page")
        if not page:
            continue
        adapter = ADAPTERS.get(boat.get("adapter", "generic_regex"))
        if not adapter:
            print(f"skip {boat['id']}: unknown adapter {boat.get('adapter')}")
            continue
        print(f"collecting {boat['name']} <- {page}")
        try:
            html = fetch(page)
            if html:
                recs = adapter(boat, html)
                print(f"  {len(recs)} records")
                out.extend(recs)
        except Exception as e:
            print(f"  ERROR: {e}")
        time.sleep(REQUEST_INTERVAL)

    if out:
        path = os.path.join(CATCHES_DIR, f"collected_{dt.date.today():%Y%m%d}.jsonl")
        write_jsonl(path, out)
        print(f"wrote {len(out)} records -> {path}")
    else:
        print("no records collected (catch_page が未設定の船宿はスキップされます)")


if __name__ == "__main__":
    main()
