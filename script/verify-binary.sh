#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_LINK="${BUN_BIN:-$HOME/.bun/bin/agent-core}"

if [[ ! -e "$BIN_LINK" ]]; then
  echo "Missing binary at $BIN_LINK" >&2
  exit 1
fi

if [[ ! -L "$BIN_LINK" ]]; then
  echo "Binary is not a symlink: $BIN_LINK" >&2
  exit 1
fi

if ! command -v realpath >/dev/null 2>&1; then
  echo "realpath is required to verify the binary." >&2
  exit 1
fi

RESOLVED="$(realpath "$BIN_LINK")"

if [[ ! -x "$RESOLVED" ]]; then
  echo "Resolved binary is not executable: $RESOLVED" >&2
  exit 1
fi

shopt -s nullglob
DIST_CANDIDATES=("$ROOT/packages/agent-core/dist/@agent-core"/*/bin/agent-core)
shopt -u nullglob

if (( ${#DIST_CANDIDATES[@]} == 0 )); then
  echo "No built binaries found in dist." >&2
  echo "Run: cd packages/agent-core && bun run build" >&2
  exit 1
fi

MATCHED=""
for candidate in "${DIST_CANDIDATES[@]}"; do
  if [[ "$(realpath "$candidate")" == "$RESOLVED" ]]; then
    MATCHED="$candidate"
    break
  fi
done

if [[ -z "$MATCHED" ]]; then
  echo "Binary does not point to a local build." >&2
  echo "Resolved: $RESOLVED" >&2
  echo "Expected under: $ROOT/packages/agent-core/dist/@agent-core/*/bin/agent-core" >&2
  exit 1
fi

if find "$ROOT/packages/agent-core/src" -type f -newer "$RESOLVED" -print -quit | grep -q .; then
  echo "Binary is older than source files." >&2
  echo "Rebuild: cd packages/agent-core && bun run build" >&2
  exit 1
fi

echo "Binary verification passed."
