#!/usr/bin/env bash
set -euo pipefail

expected_repo="adolago/zee"

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "${origin_url}" ]]; then
  echo "ERROR: origin remote is missing." >&2
  exit 1
fi

if [[ "${origin_url}" != *"adolago/zee"* ]]; then
  echo "ERROR: origin remote does not point to ${expected_repo}." >&2
  echo "origin=${origin_url}" >&2
  exit 1
fi

resolved_repo="$(gh repo view "${expected_repo}" --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
if [[ "${resolved_repo}" != "${expected_repo}" ]]; then
  echo "ERROR: GitHub resolves ${expected_repo} as '${resolved_repo}'." >&2
  echo "Refusing to proceed to avoid opening PRs/issues in the wrong repository." >&2
  echo "Fix the repository redirect/rename state first." >&2
  exit 2
fi

echo "OK: target repository is ${expected_repo}."
