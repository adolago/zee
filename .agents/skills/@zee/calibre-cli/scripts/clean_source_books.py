#!/usr/bin/env python3
"""
Move likely non-book files out of vault source book folders.
Non-destructive: files are moved to an archive folder, never deleted.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


EBOOK_EXTS = {".pdf", ".epub", ".azw3", ".azw", ".mobi"}
NONBOOK_NAME_PATTERNS = [
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


@dataclass
class MoveItem:
    source: Path
    destination: Path
    reason: str


def collect_candidates(vault_root: Path, source_dirs: list[Path], name_regex: re.Pattern[str]) -> list[MoveItem]:
    items: list[MoveItem] = []
    for source_dir in source_dirs:
        if not source_dir.exists():
            continue
        for path in source_dir.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in EBOOK_EXTS:
                continue
            if "_Incoming" in path.parts:
                continue
            if not name_regex.search(path.name):
                continue

            lib_root = vault_root / "Study" / "Library"
            rel_under_library = path.relative_to(lib_root)
            dest = (
                vault_root
                / "Study"
                / "Library"
                / "NonBooks_Archive"
                / "From_Books_Sources"
                / rel_under_library
            )
            items.append(MoveItem(source=path, destination=dest, reason="filename_keyword"))
    return items


def write_report(out_dir: Path, rows: list[dict[str, str]]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    report = out_dir / f"source_books_cleanup_{stamp}.csv"
    with report.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["action", "source", "destination", "reason", "status"],
        )
        writer.writeheader()
        writer.writerows(rows)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean non-book files from source book folders.")
    parser.add_argument("--vault-root", required=True, help="Vault root path")
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        help="Relative source folder (repeatable). Defaults: Study/Library/Books and Study/Library/Books 1",
    )
    parser.add_argument(
        "--out-dir",
        default="Study/_System/Documentation",
        help="Output report directory (relative to vault if not absolute)",
    )
    parser.add_argument("--apply", action="store_true", help="Apply moves; default is dry-run")
    args = parser.parse_args()

    vault_root = Path(args.vault_root).expanduser().resolve()
    if not vault_root.exists():
        raise SystemExit(f"ERROR: vault root not found: {vault_root}")

    if args.source:
        source_dirs = [vault_root / s for s in args.source]
    else:
        source_dirs = [
            vault_root / "Study" / "Library" / "Books",
            vault_root / "Study" / "Library" / "Books 1",
        ]

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = vault_root / out_dir

    name_regex = re.compile("|".join(NONBOOK_NAME_PATTERNS), re.IGNORECASE)
    candidates = collect_candidates(vault_root, source_dirs, name_regex)

    rows: list[dict[str, str]] = []
    moved = 0
    skipped = 0

    for item in sorted(candidates, key=lambda x: str(x.source)):
        record = {
            "action": "move" if args.apply else "plan",
            "source": str(item.source),
            "destination": str(item.destination),
            "reason": item.reason,
            "status": "planned",
        }
        if args.apply:
            item.destination.parent.mkdir(parents=True, exist_ok=True)
            if item.destination.exists():
                record["status"] = "skipped_destination_exists"
                skipped += 1
            else:
                shutil.move(str(item.source), str(item.destination))
                record["status"] = "moved"
                moved += 1
        rows.append(record)

    report = write_report(out_dir, rows)

    print(f"Vault: {vault_root}")
    print(f"Candidates: {len(candidates)}")
    print(f"Moved: {moved}")
    print(f"Skipped: {skipped}")
    print(f"Report: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
