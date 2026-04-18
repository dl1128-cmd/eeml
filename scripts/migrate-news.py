"""Migrate News posts from eeml.co.kr/bbs/board.php?tbl=bbs41 to local news.json.

- Fetches the paginated listing → collects all unique num IDs.
- For each post, fetches the detail page.
- Parses: title, date, body HTML, embedded images, external links.
- Cleans body HTML: strips style/font/class attrs, drops <span>, keeps
  <p>, <a href>, <br>, <b>/<strong>, <em>/<i>, <u>, <ul>/<ol>/<li>,
  <h1..h6>, inline formatting.
- Downloads each image into assets/images/news/ (resized afterwards
  by scripts/resize-news.py).
- Writes data/news.json. Preserves existing category/title_en/body_en
  values from the current file when an id already exists.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets" / "images" / "news"
OUT_JSON = ROOT / "data" / "news.json"
BASE = "http://eeml.co.kr"
LIST_URL = BASE + "/bbs/board.php?tbl=bbs41&page={page}"
DETAIL_URL = BASE + "/bbs/board.php?tbl=bbs41&mode=VIEW&num={num}"

UA = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"

NUM_RE = re.compile(r"tbl=bbs41&mode=VIEW&num=(\d+)")
DIV_RE = re.compile(r'<div id="DivContents"[^>]*>([\s\S]*?)</div>\s*</td>')
TITLE_RE = re.compile(r'<div class="tit">\s*<div class="left">\s*<em>\s*(.*?)\s*</em>', re.DOTALL)
DATE_RE = re.compile(r'<p>관리자\s*│\s*(\d{4}-\d{2}-\d{2})')
IMG_FULL_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
IMG_SRC_RE = re.compile(r'src="([^"]+)"', re.IGNORECASE)
IMG_TITLE_RE = re.compile(r'title="([^"]*)"', re.IGNORECASE)

ALLOWED_TAGS = {"p", "br", "b", "strong", "em", "i", "u",
                "ul", "ol", "li",
                "h1", "h2", "h3", "h4", "h5", "h6",
                "a", "blockquote", "hr"}


def fetch(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ! fetch failed {url}: {exc}", file=sys.stderr)
        return None


def download_image(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            dst.write_bytes(r.read())
        return True
    except Exception as exc:
        print(f"    ! image failed {url}: {exc}", file=sys.stderr)
        return False


def clean_html(body: str) -> str:
    """Keep only a safe allowlist of tags. Drop everything else, preserve text."""
    out = []
    i = 0
    while i < len(body):
        if body[i] != "<":
            out.append(body[i])
            i += 1
            continue
        end = body.find(">", i)
        if end == -1:
            out.append(body[i])
            i += 1
            continue
        tag_raw = body[i + 1 : end]
        is_close = tag_raw.startswith("/")
        tag_name = tag_raw.lstrip("/").split()[0].lower() if tag_raw.strip() else ""
        if tag_name in ALLOWED_TAGS:
            if is_close:
                out.append(f"</{tag_name}>")
            else:
                # Keep only href for <a>; drop all other attrs
                attrs = ""
                if tag_name == "a":
                    href_m = re.search(r'href="([^"]+)"', tag_raw)
                    if href_m:
                        href = href_m.group(1)
                        # Ensure external links open in new tab
                        attrs = f' href="{href}" target="_blank" rel="noopener"'
                self_close = "/" in tag_raw[-2:] and tag_name in {"br", "hr"}
                if self_close:
                    out.append(f"<{tag_name}{attrs} />")
                else:
                    out.append(f"<{tag_name}{attrs}>")
        i = end + 1
    html = "".join(out)
    # Collapse excessive whitespace/blank paragraphs
    html = re.sub(r"(<p>\s*</p>\s*){2,}", "<p></p>", html)
    html = re.sub(r"\s+\n", "\n", html)
    return html.strip()


def parse_detail(html: str) -> dict | None:
    div = DIV_RE.search(html)
    if not div:
        return None
    body = div.group(1)

    title_m = TITLE_RE.search(html)
    date_m = DATE_RE.search(html)

    # Extract images
    images = []
    for im_match in IMG_FULL_RE.finditer(body):
        tag = im_match.group(0)
        src_m = IMG_SRC_RE.search(tag)
        if not src_m:
            continue
        src = src_m.group(1)
        if not src.startswith("/smart_editor/upload/") and not src.startswith("http"):
            continue
        title_m2 = IMG_TITLE_RE.search(tag)
        caption = unescape(title_m2.group(1)) if title_m2 else ""
        if re.search(r"\.(jpg|jpeg|png|webp|gif)$", caption, re.I):
            caption = re.sub(r"\.(jpg|jpeg|png|webp|gif)$", "", caption, flags=re.I)
        images.append({"src": src, "caption": caption.strip()})

    # Strip img tags from the HTML body (images rendered separately)
    body_noimg = IMG_FULL_RE.sub("", body)
    body_html = clean_html(body_noimg)

    return {
        "title_raw": unescape(title_m.group(1)).strip() if title_m else "",
        "date": date_m.group(1) if date_m else "",
        "body_html": body_html,
        "images": images,
    }


def main() -> int:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # Collect num IDs from listing pages (max 10 pages as safety)
    nums: list[int] = []
    for page in range(1, 11):
        html = fetch(LIST_URL.format(page=page))
        if not html:
            break
        page_nums = sorted({int(m.group(1)) for m in NUM_RE.finditer(html)}, reverse=True)
        if not page_nums:
            break
        nums.extend(page_nums)
        if len(page_nums) < 10:
            break
        time.sleep(0.3)
    nums = sorted(set(nums), reverse=True)
    print(f"Collected {len(nums)} news IDs: {nums}")

    # Load existing news.json to preserve en translations if present
    existing: dict[str, dict] = {}
    try:
        cur = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        existing = {e["id"]: e for e in cur}
    except Exception:
        pass

    records: list[dict] = []
    for num in nums:
        print(f"Processing num={num}")
        html = fetch(DETAIL_URL.format(num=num))
        if not html:
            continue
        parsed = parse_detail(html)
        if not parsed:
            print(f"  ! could not parse detail", file=sys.stderr)
            continue

        new_images = []
        for im in parsed["images"]:
            src = im["src"]
            if src.startswith("/"):
                remote = BASE + src
                fname = src.rsplit("/", 1)[-1]
            else:
                remote = src
                fname = src.rsplit("/", 1)[-1].split("?", 1)[0]
            local_name = f"{num}-{fname}"
            dst = ASSETS_DIR / local_name
            ok = download_image(remote, dst)
            rel = f"assets/images/news/{local_name}" if ok else remote
            new_images.append({
                "src": rel,
                "caption_ko": im["caption"],
                "caption_en": "",
            })

        nid = f"n-{num}"
        prev = existing.get(nid, {})
        rec = {
            "id": nid,
            "date": parsed["date"] or prev.get("date", ""),
            "category": prev.get("category") or "news",
            "title_ko": parsed["title_raw"] or prev.get("title_ko", ""),
            "title_en": prev.get("title_en") or parsed["title_raw"],
            "body_ko": parsed["body_html"],
            "body_en": prev.get("body_en") or "",
            "images": new_images,
            "source_url": DETAIL_URL.format(num=num),
        }
        records.append(rec)
        time.sleep(0.4)

    # Sort newest-first by date then id
    records.sort(key=lambda r: (r["date"], r["id"]), reverse=True)
    OUT_JSON.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nwrote {OUT_JSON} ({len(records)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
