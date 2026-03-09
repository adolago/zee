#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

matches="$(
  rg -n --pcre2 '\b(persona|personas|stanley|johny|Stanley|Johny)\b' \
    src \
    packages/zee/src \
    README.md \
    AGENTS.md \
    .env.example \
    install \
    --glob '!**/*.test.*' \
    --glob '!**/__snapshots__/**' \
    --glob '!docs/**' \
    --glob '!atris/**' \
    --glob '!.zee/plans/**' \
    || true
)"

filtered="$(printf '%s\n' "$matches" | rg -v 'Morgan Stanley' || true)"

if [[ -n "$filtered" ]]; then
  printf 'Legacy assistant strings remain in active paths:\n%s\n' "$filtered" >&2
  exit 1
fi

printf 'Legacy assistant string check passed.\n'
