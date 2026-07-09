"""Detect Google Scholar papers NOT yet in data/publications.json.

READ-ONLY: never writes any file. Prints a categorized report so a human can
decide what to add. Reuses the fetch/parse/normalize logic from
update-citations.py so matching behaves identically to the citation updater.

Why not auto-add? Scholar mixes real journal papers with patents, conference/
meeting abstracts (ECS), and journal covers ("Front Cover: ..."). Auto-adding
would pollute the public publication list. This script flags candidates and
classifies the obvious non-papers so review is fast.

Exit 0 always on a successful fetch (report is informational); exit 0 too on a
transient Scholar block (same policy as update-citations.py) so it never fails
a scheduled job spuriously.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Load update-citations.py as a module to reuse its logic (hyphen in filename
# blocks a normal import).
_spec = importlib.util.spec_from_file_location("uc", ROOT / "scripts" / "update-citations.py")
uc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uc)

# Heuristics to classify Scholar entries that are NOT journal papers.
PATENT_RE = re.compile(
    r"method for manufacturing|secondary battery.*method|active material,\s*method|"
    r"전지|제조\s*방법|특허",
    re.IGNORECASE,
)
ABSTRACT_RE = re.compile(r"^\(invited\)|meeting abstract|ecs meeting|\(abstract\)", re.IGNORECASE)
COVER_RE = re.compile(r"^(front|back|inside)\s+cover\b|^cover\s*:", re.IGNORECASE)


def classify(title: str) -> str:
    if COVER_RE.search(title):
        return "cover"
    if PATENT_RE.search(title):
        return "patent"
    if ABSTRACT_RE.search(title):
        return "abstract"
    return "paper"  # likely a real journal paper worth reviewing


def in_pubs(sp: dict, pub_norms: list[str]) -> bool:
    n = uc.normalize(sp["title"])
    if n in pub_norms:
        return True
    for pn in pub_norms:
        if len(pn) >= 25 and (pn.startswith(n) or n.startswith(pn)):
            return True
    return False


def main() -> int:
    cfg = json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8"))
    sid = uc.extract_scholar_id(cfg)
    if not sid:
        print("ERROR: no Scholar ID in config.pi.scholar", file=sys.stderr)
        return 1
    try:
        html = uc.fetch_scholar(sid)
    except Exception as exc:
        print(f"WARNING: Scholar unavailable this run: {exc}", file=sys.stderr)
        return 0

    papers = uc.parse_papers(html)
    if not papers:
        print("WARNING: no papers parsed — Scholar format may have changed", file=sys.stderr)
        return 0

    pubs = json.loads((ROOT / "data" / "publications.json").read_text(encoding="utf-8"))
    pub_norms = [uc.normalize(p["title"]) for p in pubs]

    missing = [sp for sp in papers if not in_pubs(sp, pub_norms)]
    by_cat: dict[str, list[dict]] = {"paper": [], "patent": [], "abstract": [], "cover": []}
    for sp in missing:
        by_cat[classify(sp["title"])].append(sp)

    print(f"Scholar: {len(papers)} entries | publications.json: {len(pubs)} | "
          f"missing from site: {len(missing)}")
    print(f"  candidates(journal paper): {len(by_cat['paper'])} | "
          f"patents: {len(by_cat['patent'])} | abstracts: {len(by_cat['abstract'])} | "
          f"covers: {len(by_cat['cover'])}")

    if by_cat["paper"]:
        print("\n=== NEW JOURNAL-PAPER CANDIDATES (review before adding) ===")
        for sp in sorted(by_cat["paper"], key=lambda x: -x["year"]):
            print(f"  [{sp['year']}] cites={sp['citations']:>3}  {sp['title']}")
            if sp.get("scholar_link"):
                print(f"        {sp['scholar_link']}")

    for cat, label in (("patent", "PATENTS"), ("abstract", "ABSTRACTS"), ("cover", "COVERS")):
        if by_cat[cat]:
            print(f"\n=== {label} (normally NOT added to the site) ===")
            for sp in sorted(by_cat[cat], key=lambda x: -x["year"]):
                print(f"  [{sp['year']}] {sp['title'][:80]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
