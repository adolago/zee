#!/usr/bin/env python3
"""
Audit a Calibre library for:
1) likely non-book records
2) likely title/author metadata swaps
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


NONBOOK_PATTERNS = [
    r"vestibular",
    r"enem",
    r"historic[oó]",
    r"resultado",
    r"comprov",
    r"nota\s+fiscal",
    r"residenc",
    r"seitec",
    r"projeto",
    r"relat[oó]rio",
    r"\bral\b",
    r"\bep\s*ii\b",
    r"labx",
    r"kawoana",
    r"citologia",
    r"curriculum",
    r"\bcv\b",
]


def resolve_default_library() -> str:
    cfg = Path.home() / ".config" / "calibre" / "global.py.json"
    if not cfg.exists():
        return ""
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        return ""
    return str(data.get("library_path", "")).strip()


def run_calibredb_list(library_path: str) -> list[dict[str, Any]]:
    cmd = [
        "calibredb",
        "--with-library",
        library_path,
        "list",
        "--fields",
        "id,title,authors,formats,tags,publisher,languages",
        "--for-machine",
    ]
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out)


def normalize_token_string(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def looks_like_person_name(text: str) -> bool:
    parts = [p for p in re.split(r"\s+", text.strip()) if p]
    if len(parts) < 2 or len(parts) > 5:
        return False
    low_parts = [p.lower().strip(".,:;()[]{}") for p in parts]
    title_words = {"the", "a", "an", "of", "and", "with", "for", "to", "my", "years"}
    if any(p in title_words for p in low_parts):
        return False
    for p in parts:
        if any(ch.isdigit() for ch in p):
            return False
    alpha_parts = [p for p in parts if any(ch.isalpha() for ch in p)]
    if not alpha_parts:
        return False
    return all(p[0].isupper() for p in alpha_parts if p[0].isalpha())


def looks_like_long_title(text: str) -> bool:
    if len(text.split()) >= 4:
        return True
    return any(ch in text for ch in [":", ",", "-", "(", ")"])


def is_all_caps_phrase(text: str) -> bool:
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return False
    return all(ch.isupper() for ch in letters)


def classify_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nonbook_re = re.compile("|".join(NONBOOK_PATTERNS), re.IGNORECASE)
    nonbooks: list[dict[str, Any]] = []
    swaps: list[dict[str, Any]] = []

    for row in rows:
        title = (row.get("title") or "").strip()
        authors = (row.get("authors") or "").strip()
        formats = row.get("formats") or []
        blob = " ".join([title, authors, " ".join(formats)])

        if nonbook_re.search(blob):
            nonbooks.append(row)

        if not title or not authors:
            continue

        t_norm = normalize_token_string(title)
        a_norm = normalize_token_string(authors)

        if t_norm and a_norm and t_norm == a_norm:
            # Ignore organization-style records where title/author intentionally match
            # in all-caps (for example institutional PDFs).
            if is_all_caps_phrase(title):
                continue
            swaps.append(row)
            continue

        if looks_like_person_name(title) and looks_like_long_title(authors):
            swaps.append(row)
            continue

        if looks_like_person_name(authors) and looks_like_long_title(title):
            # normal case, skip
            continue

    return nonbooks, swaps


def write_tsv(path: Path, rows: list[dict[str, Any]]) -> None:
    header = "id\ttitle\tauthors\tformats\n"
    lines = []
    for row in rows:
        rid = row.get("id", "")
        title = str(row.get("title", "")).replace("\t", " ")
        authors = str(row.get("authors", "")).replace("\t", " ")
        formats = "; ".join(row.get("formats") or []).replace("\t", " ")
        lines.append(f"{rid}\t{title}\t{authors}\t{formats}")
    path.write_text(header + "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Calibre library quality.")
    parser.add_argument("--library", default="", help="Path to Calibre Library directory")
    parser.add_argument("--out-dir", default=".", help="Output directory for reports")
    parser.add_argument("--print-limit", type=int, default=20, help="Preview line limit")
    args = parser.parse_args()

    library = args.library or resolve_default_library()
    if not library:
        raise SystemExit("ERROR: Could not resolve Calibre library path. Use --library.")

    lib_path = Path(library)
    if not lib_path.exists():
        raise SystemExit(f"ERROR: Library not found: {lib_path}")

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = run_calibredb_list(str(lib_path))
    nonbooks, swaps = classify_rows(rows)

    audit_json = out_dir / "calibre_audit.json"
    nonbook_tsv = out_dir / "calibre_nonbook_candidates.tsv"
    swap_tsv = out_dir / "calibre_swap_candidates.tsv"

    audit_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_tsv(nonbook_tsv, nonbooks)
    write_tsv(swap_tsv, swaps)

    print(f"Library: {lib_path}")
    print(f"Total records: {len(rows)}")
    print(f"Non-book candidates: {len(nonbooks)}")
    print(f"Swap candidates: {len(swaps)}")
    print(f"Wrote: {audit_json}")
    print(f"Wrote: {nonbook_tsv}")
    print(f"Wrote: {swap_tsv}")

    if nonbooks:
        print("\nNon-book preview:")
        for row in nonbooks[: args.print_limit]:
            print(f"- {row.get('id')}: {row.get('title')} | {row.get('authors')}")

    if swaps:
        print("\nSwap preview:")
        for row in swaps[: args.print_limit]:
            print(f"- {row.get('id')}: {row.get('title')} | {row.get('authors')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
