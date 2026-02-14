#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_ROOT="${ROOT}/.agents/skills"

if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  echo "Error: python3 or python is required to validate SKILL.md files." >&2
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
else
  PYTHON_BIN="python"
fi

"$PYTHON_BIN" - "$SKILLS_ROOT" <<'PY'
from pathlib import Path
import re
import sys

try:
  import yaml
except Exception as err:
  print(f"Error: PyYAML not available ({err}). Install with: pip install pyyaml", file=sys.stderr)
  sys.exit(1)

skills_root = Path(sys.argv[1])
files = sorted(skills_root.glob("**/SKILL.md"))

if not files:
  print("No SKILL.md files found.")
  sys.exit(0)

invalid = []
for path in files:
  text = path.read_text(encoding="utf-8", errors="replace")
  match = re.match(r"^\s*---\s*\n(.*?)\n---\s*\n", text, re.S)
  if not match:
    invalid.append((path, "missing front-matter block"))
    continue

  front_matter = match.group(1)
  try:
    yaml.safe_load(front_matter)
  except Exception as err:
    invalid.append((path, str(err).split("\n", 1)[0]))

if invalid:
  print("Invalid SKILL.md files found:", file=sys.stderr)
  for path, error in invalid:
    print(f"- {path}: {error}", file=sys.stderr)
  print(f"Total invalid: {len(invalid)}", file=sys.stderr)
  sys.exit(2)

print(f"All SKILL.md files are valid: {len(files)} files")
PY
