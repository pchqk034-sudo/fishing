# -*- coding: utf-8 -*-
"""dashboard/index.html と data.js を1ファイルに束ねる（Artifact/共有プレビュー用）。"""
import os

from common import ROOT

DASH = os.path.join(ROOT, "dashboard")


def main():
    with open(os.path.join(DASH, "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(DASH, "data.js"), encoding="utf-8") as f:
        data = f.read()
    html = html.replace('<script src="data.js"></script>', "<script>\n" + data + "\n</script>")
    out = os.path.join(DASH, "dist")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "standalone.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {path} ({os.path.getsize(path)//1024} KB)")


if __name__ == "__main__":
    main()
