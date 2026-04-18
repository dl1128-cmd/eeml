"""Migrate Research topics from eeml.co.kr/sub02/ to research_topics.json.

The old site has 3 research subpages:
  /sub02/sub01.php → Energy Materials
  /sub02/sub02.php → Novel Processing
  /sub02/sub03.php → Water Energy Nexus

Each page provides:
  - <h2> top_con title and subtitle
  - 3 hero images in /product/data/item/
  - A main heading (p_tit01) + subheading
  - 3 body paragraphs in <ul class='bottom_txt'><li>...

This script downloads each page + images, then writes
data/research_topics.json with the structure the site expects.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets" / "images" / "research"
OUT_JSON = ROOT / "data" / "research_topics.json"
BASE = "http://eeml.co.kr"
UA = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"

TOPICS = [
    {"slug": "energy-materials", "page": "sub01"},
    {"slug": "novel-processing", "page": "sub02"},
    {"slug": "water-energy-nexus", "page": "sub03"},
]


def fetch(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"fetch failed {url}: {exc}", file=sys.stderr)
        return None


def download(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            dst.write_bytes(r.read())
        return True
    except Exception as exc:
        print(f"  ! image fail {url}: {exc}", file=sys.stderr)
        return False


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s)


def collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse(html: str) -> dict:
    title_m = re.search(
        r'<div class="top_con">\s*<h2>([^<]+)</h2>\s*<p>([^<]*)</p>', html
    )
    heading_m = re.search(
        r'<p class="p_tit01">([^<]+)</p>\s*<span>([^<]*)</span>', html
    )
    imgs = re.findall(r'<img src="(/product/data/item/[^"]+)"', html)
    ul_m = re.search(r'<ul class="bottom_txt">(.*?)</ul>', html, re.DOTALL)
    paras = []
    if ul_m:
        for li in re.findall(r"<li>(.*?)</li>", ul_m.group(1), re.DOTALL):
            text = unescape(strip_tags(li))
            text = collapse_ws(text)
            if text:
                paras.append(text)
    return {
        "title": unescape(title_m.group(1)).strip() if title_m else "",
        "subtitle": unescape(title_m.group(2)).strip() if title_m else "",
        "heading": unescape(heading_m.group(1)).strip() if heading_m else "",
        "subheading": unescape(heading_m.group(2)).strip() if heading_m else "",
        "images": imgs,
        "paragraphs": paras,
    }


def build_svg(color_start: str, color_end: str, label: str) -> str:
    """A simple decorative SVG icon per topic (used in the list-page card)."""
    return (
        f'<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{color_start}"/>'
        f'<stop offset="1" stop-color="{color_end}"/></linearGradient></defs>'
        f'<rect width="96" height="96" rx="20" fill="url(#g)"/>'
        f'<text x="48" y="58" text-anchor="middle" '
        f'font-family="Inter,sans-serif" font-size="28" font-weight="800" '
        f'fill="white">{label}</text></svg>'
    )


def main() -> int:
    tmp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp")
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    topic_svgs = {
        "energy-materials": build_svg("#1e3a8a", "#0ea5e9", "EM"),
        "novel-processing": build_svg("#065f46", "#10b981", "NP"),
        "water-energy-nexus": build_svg("#7c2d12", "#f59e0b", "WE"),
    }
    topic_keywords = {
        "energy-materials": ["Cathode", "Anode", "Solid Electrolyte", "ASSB", "LIB"],
        "novel-processing": ["Dry Process", "Electrode Engineering", "Manufacturing"],
        "water-energy-nexus": ["Flow-electrode", "Capacitive Mixing", "Desalination"],
    }

    records = []
    for order, topic in enumerate(TOPICS, start=1):
        cache = tmp / f"research-{topic['page']}.html"
        if cache.exists():
            html = cache.read_text(encoding="utf-8", errors="replace")
        else:
            html = fetch(f"{BASE}/sub02/{topic['page']}.php")
            if not html:
                continue
            cache.write_text(html, encoding="utf-8")
        parsed = parse(html)
        print(f"[{topic['slug']}] title={parsed['title']!r}  imgs={len(parsed['images'])}  paras={len(parsed['paragraphs'])}")

        local_imgs: list[str] = []
        for i, img_path in enumerate(parsed["images"]):
            remote = BASE + img_path
            fname = img_path.rsplit("/", 1)[-1]
            dst = ASSETS_DIR / f"{topic['slug']}-{i + 1}-{fname}"
            ok = download(remote, dst)
            if ok:
                local_imgs.append(f"assets/images/research/{dst.name}")
            else:
                local_imgs.append(remote)

        rec = {
            "id": topic["slug"],
            "order": order,
            "title_en": parsed["title"],
            "title_ko": parsed["title"],
            "summary_en": parsed["subtitle"],
            "summary_ko": parsed["subtitle"],
            "keywords": topic_keywords.get(topic["slug"], []),
            "svg": topic_svgs.get(topic["slug"], ""),
            "heading_en": parsed["heading"],
            "heading_ko": parsed["heading"],
            "subheading_en": parsed["subheading"],
            "subheading_ko": parsed["subheading"],
            "images": local_imgs,
            "detail_body_en": "\n\n".join(parsed["paragraphs"]),
            "detail_body_ko": "\n\n".join(parsed["paragraphs"]),
        }
        records.append(rec)

    OUT_JSON.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT_JSON} ({len(records)} topics)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
