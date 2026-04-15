#!/usr/bin/env bash

set -euo pipefail

IGNORE_FILE="${1:-audit-ignore.txt}"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Error: python3 or python is required to evaluate bun audit output." >&2
  exit 1
fi

if [[ -f "${IGNORE_FILE}" ]]; then
  IGNORE_IDS="$(
    grep -vE '^[[:space:]]*(#|$)' "${IGNORE_FILE}" \
      | tr -d '\r' \
      | paste -sd, - \
      || true
  )"

else
  IGNORE_IDS=""
fi

RAW_OUTPUT="$(mktemp)"
trap 'rm -f "${RAW_OUTPUT}"' EXIT

set +e
bun audit --json >"${RAW_OUTPUT}" 2>&1
BUN_STATUS=$?
set -e

"${PYTHON_BIN}" - "${RAW_OUTPUT}" "${IGNORE_IDS}" "${BUN_STATUS}" <<'PY'
from __future__ import annotations

import json
import pathlib
import sys

raw_path = pathlib.Path(sys.argv[1])
ignore_ids = {item.strip().lower() for item in sys.argv[2].split(",") if item.strip()}
bun_status = int(sys.argv[3])
raw_text = raw_path.read_text(encoding="utf-8", errors="replace")

start = raw_text.find("{")
end = raw_text.rfind("}")
if start == -1 or end == -1 or end < start:
    sys.stderr.write(raw_text)
    raise SystemExit(bun_status or 1)

payload = json.loads(raw_text[start : end + 1])
findings: list[tuple[str, str, str, str]] = []
for package, advisories in payload.items():
    if not isinstance(advisories, list):
        continue
    for advisory in advisories:
        advisory_id = str(advisory.get("id", "")).strip()
        severity = str(advisory.get("severity", "")).lower()
        if severity not in {"high", "critical"}:
            continue
        if advisory_id.lower() in ignore_ids:
            continue
        findings.append(
            (
                package,
                advisory_id or "<unknown>",
                severity,
                str(advisory.get("title", "")).strip() or "<no title>",
            )
        )

if findings:
    for package, advisory_id, severity, title in findings:
        print(f"{severity}: {package} {advisory_id} {title}")
    raise SystemExit(1)

print("bun audit: no high/critical advisories after applying ignore list")
PY

