#!/usr/bin/env bash

set -euo pipefail

IGNORE_FILE="${1:-audit-ignore.txt}"

ARGS=(--audit-level high)

if [[ -f "${IGNORE_FILE}" ]]; then
  IGNORE_IDS="$(
    grep -vE '^[[:space:]]*(#|$)' "${IGNORE_FILE}" \
      | tr -d '\r' \
      | paste -sd, - \
      || true
  )"

  if [[ -n "${IGNORE_IDS}" ]]; then
    ARGS+=(--ignore="${IGNORE_IDS}")
  fi
fi

bun audit "${ARGS[@]}"

