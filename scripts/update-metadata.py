"""Update per-paper volume/issue/page in data/publications.json from CrossRef.

Runs alongside update-citations.py in the same GitHub Actions workflow.

Trigger: paper is in publications.json with a DOI.
Conservative update rule: CrossRef is taken as authoritative ONLY when it
returns BOTH a volume AND (an issue OR a page/article-number). Early-access
entries where CrossRef only has a volume (no issue yet) are left alone, so
human-curated volume strings ("2026", "532, 174281") are not silently
clobbered before the issue is published.

When the issue is published, CrossRef's response gains the issue/page fields
and this script rewrites publications.json with the canonical form:
   "<vol>(<issue>), <page or article-number>"  e.g.  "19(6), 1944-1953"
   "<vol>, <page>"                              e.g.  "532, 174281"
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBS_PATH = ROOT / "data" / "publications.json"
USER_AGENT = "EEML-site/1.0 (https://eeml.gachon.ac.kr; mailto:dslee9117@gachon.ac.kr)"

DOI_PREFIX_RE = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.IGNORECASE)


def clean_doi(raw: str) -> str:
    s = str(raw or "").strip()
    s = DOI_PREFIX_RE.sub("", s)
    return s


def fetch_crossref(doi: str) -> dict | None:
    url = f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='/')}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        # 404 = DOI unknown to CrossRef (preprint, special issue, etc.) — skip
        if e.code == 404:
            return None
        print(f"  CrossRef HTTP {e.code} for {doi}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  CrossRef fetch failed for {doi}: {e}", file=sys.stderr)
        return None


def build_volume_string(msg: dict) -> str:
    """Return our canonical volume string, or '' if CrossRef is too sparse."""
    vol = (msg.get("volume") or "").strip()
    issue = (msg.get("issue") or "").strip()
    page = (msg.get("page") or "").strip()
    article_num = (msg.get("article-number") or "").strip()
    locator = page or article_num
    # Authoritative only when both halves present
    if not vol or not (issue or locator):
        return ""
    left = f"{vol}({issue})" if issue else vol
    return f"{left}, {locator}" if locator else left


def main() -> int:
    pubs = json.loads(PUBS_PATH.read_text(encoding="utf-8"))
    updated = 0
    skipped_no_doi = 0
    skipped_sparse = 0

    for p in pubs:
        doi = clean_doi(p.get("doi", ""))
        if not doi:
            skipped_no_doi += 1
            continue
        resp = fetch_crossref(doi)
        if not resp:
            continue
        new_vol = build_volume_string(resp.get("message", {}))
        if not new_vol:
            skipped_sparse += 1
            continue
        cur = (p.get("volume") or "").strip()
        if new_vol == cur:
            continue
        # Only overwrite when CrossRef looks genuinely richer (e.g. it now has
        # issue+page, while the existing entry was just "2026" or "5").
        # Heuristic: refuse to shorten a string that's already pretty rich
        # (commas + parens). Otherwise accept.
        has_issue = "(" in cur and ")" in cur
        has_pages = "," in cur and any(ch.isdigit() for ch in cur.split(",", 1)[1])
        if has_issue and has_pages and len(new_vol) < len(cur):
            # Existing entry already has both — likely manually curated, skip
            continue
        print(f"  vol: {cur!r:32s} -> {new_vol!r}   [{p.get('title','')[:60]}]")
        p["volume"] = new_vol
        updated += 1

    print()
    print(f"Summary: {updated} updated, {skipped_no_doi} no-DOI, {skipped_sparse} CrossRef-sparse, total {len(pubs)}")

    if updated > 0:
        PUBS_PATH.write_text(
            json.dumps(pubs, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {PUBS_PATH.name}")
        gh_out = os.environ.get("GITHUB_OUTPUT")
        if gh_out:
            with open(gh_out, "a", encoding="utf-8") as f:
                f.write("changed=true\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
