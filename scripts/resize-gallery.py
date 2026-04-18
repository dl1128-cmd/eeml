"""Resize gallery images in-place to max 1600x1600 at 85% JPEG quality."""
from pathlib import Path
from PIL import Image

GALLERY = Path(__file__).resolve().parent.parent / "assets" / "images" / "gallery"
MAX_DIM = 1600
QUALITY = 85


def main() -> None:
    files = sorted(GALLERY.glob("*.jpg"))
    total_before = 0
    total_after = 0
    for f in files:
        size_before = f.stat().st_size
        total_before += size_before
        try:
            img = Image.open(f)
            img = img.convert("RGB")
            w, h = img.size
            if max(w, h) > MAX_DIM:
                scale = MAX_DIM / max(w, h)
                img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            img.save(f, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            size_after = f.stat().st_size
            total_after += size_after
            print(f"  {f.name}: {size_before // 1024}KB -> {size_after // 1024}KB")
        except Exception as exc:
            print(f"  ! {f.name}: {exc}")
            total_after += size_before
    print(
        f"\nTotal: {total_before // (1024 * 1024)}MB -> {total_after // (1024 * 1024)}MB"
        f"  ({(1 - total_after / total_before) * 100:.1f}% reduction)"
    )


if __name__ == "__main__":
    main()
