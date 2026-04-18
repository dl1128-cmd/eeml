"""Enrich gallery.json with body text + all images from detail pages.

For each entry in gallery.json:
1. Fetch /bbs/board.php?tbl=bbs42&mode=VIEW&num=<id>
2. Parse DivContents → extract all <img> tags (with captions from title=)
3. Extract paragraph text (strip HTML) → body_ko
4. Download any new images → assets/images/gallery/
5. Write images[] array and body_ko back into gallery.json
"""
import json
import os
import re
import sys
import time
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets" / "images" / "gallery"
OUT_JSON = ROOT / "data" / "gallery.json"
BASE_URL = "http://eeml.co.kr"
DETAIL_URL = BASE_URL + "/bbs/board.php?tbl=bbs42&mode=VIEW&num={num}"

DIV_RE = re.compile(
    r'<div id="DivContents"[^>]*>(?P<body>.*?)</div>\s*</td>',
    re.DOTALL,
)
# Match the ENTIRE <img ...> tag (greedy up to the closing >) so we can strip
# it cleanly; capture src and optional title for gallery metadata.
IMG_FULL_RE = re.compile(r"<img\b[^>]*?>", re.IGNORECASE)
IMG_SRC_RE = re.compile(
    r'src="(?P<src>/smart_editor/upload/[^"]+)"', re.IGNORECASE,
)
IMG_TITLE_RE = re.compile(r'title="(?P<title>[^"]*)"', re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"[ \t\xa0]+")


def fetch(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ! fetch failed {url}: {exc}", file=sys.stderr)
        return None


def download_image(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            dst.write_bytes(r.read())
        return True
    except Exception as exc:
        print(f"    ! image failed {url}: {exc}", file=sys.stderr)
        return False


def parse_detail(html: str) -> tuple[list[dict], str]:
    m = DIV_RE.search(html)
    if not m:
        return [], ""
    body = m.group("body")

    # Extract images preserving order (iterate over full <img> tags)
    images = []
    for im in IMG_FULL_RE.finditer(body):
        tag = im.group(0)
        src_m = IMG_SRC_RE.search(tag)
        if not src_m or "/smart_editor/upload/" not in src_m.group("src"):
            continue
        src = src_m.group("src")
        title_m = IMG_TITLE_RE.search(tag)
        title = unescape(title_m.group("title")) if title_m else ""
        # Strip file extension from captions when it's clearly a filename
        if re.search(r"\.(jpg|jpeg|png|webp|gif)$", title, re.I):
            title = re.sub(r"\.(jpg|jpeg|png|webp|gif)$", "", title, flags=re.I)
        images.append({"src": src, "caption": title.strip()})

    # Extract text: remove FULL image tags, then strip remaining HTML
    text_only = IMG_FULL_RE.sub("", body)
    # Convert paragraph breaks
    text_only = re.sub(r"</p\s*>|<br\s*/?>", "\n", text_only, flags=re.I)
    text_only = TAG_RE.sub("", text_only)
    text_only = unescape(text_only)
    text_only = text_only.replace("\xa0", " ")
    # Normalize
    lines = [WS_RE.sub(" ", ln).strip() for ln in text_only.split("\n")]
    paragraphs = []
    for ln in lines:
        if ln:
            paragraphs.append(ln)
    body_text = "\n\n".join(paragraphs)
    return images, body_text


def main() -> int:
    with OUT_JSON.open(encoding="utf-8") as f:
        records = json.load(f)

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    for idx, rec in enumerate(records, 1):
        num = rec["id"].split("-", 1)[1]  # "g-39" → "39"
        print(f"[{idx}/{len(records)}] num={num}  {rec['title_ko'][:40]}")
        html = fetch(DETAIL_URL.format(num=num))
        if not html:
            continue

        imgs, body = parse_detail(html)
        if not imgs:
            print(f"    (no images found in detail)")
            continue

        new_images = []
        for im in imgs:
            remote_url = BASE_URL + im["src"]
            fname = im["src"].rsplit("/", 1)[-1]
            local_name = f"{num}-{fname}"
            local_path = ASSETS_DIR / local_name
            ok = download_image(remote_url, local_path)
            src_path = f"assets/images/gallery/{local_name}" if ok else remote_url
            new_images.append({
                "src": src_path,
                "caption_ko": im["caption"],
                "caption_en": im["caption"],
            })

        rec["images"] = new_images
        # Keep cover: prefer the one from listing (already set) if it matches one of
        # the new images, else use first detail image
        existing_cover = rec.get("cover", "")
        if existing_cover and any(img["src"] == existing_cover for img in new_images):
            pass  # Already correct
        elif new_images:
            rec["cover"] = new_images[0]["src"]

        rec["body_ko"] = body
        rec["body_en"] = ""  # Not translating automatically

        # Use first line of body as summary if short-ish
        if body:
            first = body.split("\n\n", 1)[0].strip()
            if len(first) < 200:
                rec["summary_ko"] = first
            else:
                rec["summary_ko"] = first[:180].rstrip() + "…"

        time.sleep(0.4)  # be polite

    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print(f"\nwrote {OUT_JSON} ({len(records)} entries enriched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
