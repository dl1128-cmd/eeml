"""Update per-paper citation counts in data/publications.json from Google Scholar.

Designed to run in GitHub Actions (server-side, no CORS proxy needed).

- Reads SCHOLAR_ID from data/config.json (pi.scholar URL).
- Fetches https://scholar.google.com/citations?user=<id>&cstart=0&pagesize=100
  with a rotating User-Agent to reduce bot detection.
- Parses each publication row: title + citation count.
- Matches against publications.json by normalized title.
- Writes updated JSON only if something changed.
- Exits 0 on success (even if no update); 1 on parse/network error.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "data" / "config.json"
PUBS_PATH = ROOT / "data" / "publications.json"

USER_AGENTS = [
    # Rotate plausible desktop UAs to reduce Scholar's bot blocks
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
]

ROW_RE = re.compile(r'<tr class="gsc_a_tr">([\s\S]*?)</tr>')
TITLE_RE = re.compile(r'<a[^>]*class="gsc_a_at"[^>]*>([^<]+)</a>')
CITE_RE = re.compile(r'<a[^>]*class="gsc_a_ac[^"]*"[^>]*>(\d+)</a>')
YEAR_RE = re.compile(r'class="gsc_a_h gsc_a_hc gs_ibl"[^>]*>(\d{4})<')
LINK_RE = re.compile(r'<a[^>]*class="gsc_a_at"[^>]*href="([^"]+)"')


def normalize(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace for title matching."""
    s = re.sub(r"[^\w\s]", " ", s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_scholar(scholar_id: str) -> str:
    url = (
        f"https://scholar.google.com/citations?user={scholar_id}"
        "&hl=en&cstart=0&pagesize=100"
    )
    last_err: Exception | None = None
    for ua in USER_AGENTS:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode("utf-8", errors="replace")
            if "gsc_a_tr" in html or "gsc_rsb_std" in html:
                return html
            time.sleep(2)
        except Exception as exc:
            last_err = exc
            time.sleep(2)
    raise RuntimeError(f"Scholar fetch failed for {scholar_id}: {last_err}")


def parse_papers(html: str) -> list[dict]:
    papers = []
    for row_match in ROW_RE.finditer(html):
        row = row_match.group(1)
        t = TITLE_RE.search(row)
        c = CITE_RE.search(row)
        y = YEAR_RE.search(row)
        link = LINK_RE.search(row)
        if not t:
            continue
        papers.append(
            {
                "title": t.group(1).strip(),
                "citations": int(c.group(1)) if c else 0,
                "year": int(y.group(1)) if y else 0,
                "scholar_link": (
                    "https://scholar.google.com" + link.group(1).replace("&amp;", "&")
                )
                if link
                else "",
            }
        )
    return papers


def extract_scholar_id(config: dict) -> str | None:
    raw = (config.get("pi", {}) or {}).get("scholar", "")
    m = re.search(r"user=([^&]+)", raw)
    return m.group(1) if m else None


def main() -> int:
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: {CONFIG_PATH} missing", file=sys.stderr)
        return 1

    scholar_id = extract_scholar_id(config)
    if not scholar_id:
        print("ERROR: could not find scholar ID in config.pi.scholar", file=sys.stderr)
        return 1
    print(f"Scholar ID: {scholar_id}")

    try:
        html = fetch_scholar(scholar_id)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    papers = parse_papers(html)
    print(f"Parsed {len(papers)} Scholar papers")
    if not papers:
        print("WARNING: no papers parsed — Scholar page may have changed format", file=sys.stderr)
        return 1

    pubs = json.loads(PUBS_PATH.read_text(encoding="utf-8"))
    scholar_by_title = {normalize(sp["title"]): sp for sp in papers}

    updated = 0
    for p in pubs:
        sp = scholar_by_title.get(normalize(p.get("title", "")))
        if not sp:
            continue
        new_cites = sp["citations"]
        if new_cites > 0 and new_cites != p.get("citations", 0):
            print(
                f"  {p.get('citations', 0):>4d} -> {new_cites:>4d}  "
                f"{p.get('title', '')[:70]}"
            )
            p["citations"] = new_cites
            updated += 1
        if sp["scholar_link"] and sp["scholar_link"] != p.get("scholar_link"):
            p["scholar_link"] = sp["scholar_link"]

    # Also update aggregate metrics in config.json
    stats = re.findall(r'<td class="gsc_rsb_std">(\d+)</td>', html)
    stats_updated = False
    if len(stats) >= 6:
        metrics = config.get("metrics") or {}
        new_metrics = {
            "citations_total": int(stats[0]),
            "citations_recent5y": int(stats[1]),
            "h_index": int(stats[2]),
            "i10_index": int(stats[4]),
            "as_of": time.strftime("%Y-%m"),
        }
        if metrics != {**metrics, **new_metrics}:
            config["metrics"] = {**metrics, **new_metrics}
            stats_updated = True
            print(
                f"Aggregate metrics: cites={new_metrics['citations_total']}, "
                f"h-index={new_metrics['h_index']}, i10={new_metrics['i10_index']}"
            )

    if updated == 0 and not stats_updated:
        print("No changes — JSON files left as-is.")
        return 0

    if updated > 0:
        PUBS_PATH.write_text(
            json.dumps(pubs, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Updated {updated} paper citation counts in {PUBS_PATH.name}")

    if stats_updated:
        CONFIG_PATH.write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Updated aggregate metrics in {CONFIG_PATH.name}")

    # Signal to GitHub Actions that a commit is needed
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write("changed=true\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
