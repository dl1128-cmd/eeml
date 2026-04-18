"""Re-download all gallery images, apply EXIF orientation, resize, and save.

Previous resize step stripped EXIF metadata without physically rotating pixels,
so portrait photos appear sideways. This script:
  1. Reads gallery.json to get every local filename.
  2. Reconstructs the remote URL (strip 'NUM-' prefix).
  3. Downloads fresh original.
  4. Applies ImageOps.exif_transpose() to bake rotation into pixels.
  5. Resizes (max 1600px) and saves as progressive JPEG, q=85.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
GALLERY = ROOT / "assets" / "images" / "gallery"
JSON_PATH = ROOT / "data" / "gallery.json"
REMOTE_BASE = "http://eeml.co.kr/smart_editor/upload/"
MAX_DIM = 1600
QUALITY = 85

PREFIX_RE = re.compile(r"^(\d+)-(.+)$")


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except Exception as exc:
        print(f"  ! fetch failed {url}: {exc}", file=sys.stderr)
        return None


def process(local_path: Path) -> tuple[bool, str]:
    """Return (ok, status_message)."""
    m = PREFIX_RE.match(local_path.name)
    if not m:
        return False, f"filename pattern mismatch: {local_path.name}"
    original_name = m.group(2)
    url = REMOTE_BASE + original_name

    raw = fetch(url)
    if not raw:
        return False, "download failed"

    # Write raw to tmp, open, apply EXIF, resize, save
    tmp = local_path.with_suffix(local_path.suffix + ".tmp")
    tmp.write_bytes(raw)
    try:
        img = Image.open(tmp)
        # Apply EXIF orientation (creates a new image with rotated pixels)
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > MAX_DIM:
            scale = MAX_DIM / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        img.save(local_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        return True, f"{w}x{h} -> {img.size[0]}x{img.size[1]}"
    except Exception as exc:
        return False, f"process error: {exc}"
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    # Collect unique local filenames
    files: set[str] = set()
    for entry in data:
        cover = entry.get("cover", "")
        if cover.startswith("assets/images/gallery/"):
            files.add(cover.rsplit("/", 1)[-1])
        for im in entry.get("images", []):
            src = im.get("src", "")
            if src.startswith("assets/images/gallery/"):
                files.add(src.rsplit("/", 1)[-1])

    files_sorted = sorted(files)
    print(f"Total unique images: {len(files_sorted)}")

    ok_count = 0
    fail = []
    for i, name in enumerate(files_sorted, 1):
        path = GALLERY / name
        ok, msg = process(path)
        status = "OK " if ok else "FAIL"
        print(f"[{i:3d}/{len(files_sorted)}] {status}  {name}  ({msg})")
        if ok:
            ok_count += 1
        else:
            fail.append(name)

    print(f"\nSuccessful: {ok_count} / {len(files_sorted)}")
    if fail:
        print(f"Failed ({len(fail)}):")
        for n in fail:
            print(f"  - {n}")
    return 0 if ok_count == len(files_sorted) else 1


if __name__ == "__main__":
    sys.exit(main())
