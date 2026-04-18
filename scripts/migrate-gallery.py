"""Migrate old eeml.co.kr gallery to new gallery.json.

Reads /tmp/old-gallery-{1,2,3}.html, extracts each entry (image, title, date,
num), downloads images into assets/images/gallery/, and writes data/gallery.json.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from html import unescape

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets" / "images" / "gallery"
OUT_JSON = ROOT / "data" / "gallery.json"
BASE_URL = "http://eeml.co.kr"

ENTRY_RE = re.compile(
    r'<li>\s*<a\s+href="(?P<href>/bbs/board\.php\?tbl=bbs42[^"]*num=(?P<num>\d+)[^"]*)"[^>]*>'
    r'.*?<img\s+src="(?P<img>/smart_editor/upload/[^"]+)"'
    r'.*?<h5>\s*(?P<title>.*?)\s*</h5>'
    r'.*?<em>\s*(?P<date>[\d.]+)\s*</em>',
    re.DOTALL,
)


def slugify(num: int) -> str:
    return f"g-{num}"


def fetch_image(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        dst.write_bytes(data)
        return True
    except Exception as exc:
        print(f"  ! failed {url}: {exc}", file=sys.stderr)
        return False


def parse_page(path: Path) -> list[dict]:
    html = path.read_text(encoding="utf-8", errors="ignore")
    entries = []
    for m in ENTRY_RE.finditer(html):
        num = int(m.group("num"))
        img_path = m.group("img")
        title = unescape(re.sub(r"\s+", " ", m.group("title")).strip())
        date_raw = m.group("date").strip()  # 2026.04.08
        date = date_raw.replace(".", "-") if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", date_raw) else date_raw
        entries.append({
            "num": num,
            "img_url": BASE_URL + img_path,
            "img_name": img_path.rsplit("/", 1)[-1],
            "title": title,
            "date": date,
        })
    return entries


def main() -> int:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp")
    all_entries = []
    for page in (1, 2, 3):
        name = "old-gallery.html" if page == 1 else f"old-gallery-{page}.html"
        src = tmp / name
        if not src.exists():
            print(f"missing {src}", file=sys.stderr)
            continue
        found = parse_page(src)
        print(f"page {page}: {len(found)} entries")
        all_entries.extend(found)

    # Dedupe by num, keep first occurrence
    seen = set()
    unique = []
    for e in all_entries:
        if e["num"] in seen:
            continue
        seen.add(e["num"])
        unique.append(e)
    print(f"unique entries: {len(unique)}")

    # Download images
    records = []
    for e in unique:
        local_name = f"{e['num']}-{e['img_name']}"
        dst = ASSETS_DIR / local_name
        ok = fetch_image(e["img_url"], dst)
        src_path = f"assets/images/gallery/{local_name}" if ok else e["img_url"]
        records.append({
            "id": slugify(e["num"]),
            "date": e["date"],
            "title_ko": e["title"],
            "title_en": e["title"],
            "summary_ko": "",
            "summary_en": "",
            "body_ko": "",
            "body_en": "",
            "cover": src_path,
            "images": [{"src": src_path, "caption_ko": "", "caption_en": ""}],
        })

    # Sort newest first (gallery.js re-sorts anyway, but keep file tidy)
    records.sort(key=lambda r: r["date"], reverse=True)
    OUT_JSON.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {OUT_JSON} ({len(records)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
