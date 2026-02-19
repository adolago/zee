#!/bin/bash
# upstream-common.sh - Shared helpers for upstream drift/sync scripts

PI_MONO_PACKAGE_CANDIDATES=(
  "packages/zee/Swabble/package.json"
  "packages/zee/package.json"
  "package.json"
)

PI_MONO_PIN_FILE_CANDIDATES=(
  "docs/architecture/upstream-pins.json"
)

normalize_nonnegative_int() {
  local raw="${1:-0}"
  local normalized
  normalized="$(printf '%s\n' "$raw" | head -n1 | tr -cd '0-9')"
  if [ -z "$normalized" ]; then
    normalized="0"
  fi
  printf '%s\n' "$normalized"
}

count_markdown_todos() {
  local file="$1"
  if [ ! -f "$file" ]; then
    printf '0\n'
    return 0
  fi

  local raw_count
  raw_count="$(grep -c "| TODO" "$file" 2>/dev/null || true)"
  normalize_nonnegative_int "$raw_count"
}

extract_pimono_version_from_spec() {
  local spec="${1:-}"
  if [ -z "$spec" ]; then
    return 1
  fi

  local parsed
  parsed="$(printf '%s\n' "$spec" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.+-]+)?' | tail -n1 || true)"
  if [ -z "$parsed" ]; then
    return 1
  fi

  printf '%s\n' "$parsed"
}

find_pimono_dependency_manifest() {
  local repo_root="$1"
  local rel candidate

  for rel in "${PI_MONO_PACKAGE_CANDIDATES[@]}"; do
    candidate="$repo_root/$rel"
    if [ ! -f "$candidate" ]; then
      continue
    fi
    if grep -q '"@mariozechner/pi-coding-agent"' "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

find_pimono_pin_manifest() {
  local repo_root="$1"
  local rel candidate

  for rel in "${PI_MONO_PIN_FILE_CANDIDATES[@]}"; do
    candidate="$repo_root/$rel"
    if [ ! -f "$candidate" ]; then
      continue
    fi
    if grep -q '"piCodingAgentVersion"' "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

resolve_pimono_version_source_manifest() {
  local repo_root="$1"
  local manifest

  manifest="$(find_pimono_dependency_manifest "$repo_root" || true)"
  if [ -n "$manifest" ]; then
    printf '%s\n' "$manifest"
    return 0
  fi

  manifest="$(find_pimono_pin_manifest "$repo_root" || true)"
  if [ -n "$manifest" ]; then
    printf '%s\n' "$manifest"
    return 0
  fi

  return 1
}

resolve_pimono_installed_version() {
  local repo_root="$1"
  local manifest raw_spec parsed

  manifest="$(resolve_pimono_version_source_manifest "$repo_root" || true)"
  if [ -z "$manifest" ]; then
    return 1
  fi

  if grep -q '"@mariozechner/pi-coding-agent"' "$manifest"; then
    raw_spec="$(
      grep -Eo '"@mariozechner/pi-coding-agent"[[:space:]]*:[[:space:]]*"[^"]+"' "$manifest" \
        | head -n1 \
        | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' \
        || true
    )"
  else
    raw_spec="$(
      grep -Eo '"piCodingAgentVersion"[[:space:]]*:[[:space:]]*"[^"]+"' "$manifest" \
        | head -n1 \
        | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' \
        || true
    )"
  fi

  if [ -z "$raw_spec" ]; then
    return 1
  fi

  parsed="$(extract_pimono_version_from_spec "$raw_spec" || true)"
  if [ -z "$parsed" ]; then
    return 1
  fi

  printf '%s\n' "$parsed"
}

resolve_latest_pimono_tag() {
  local remote_ref="${1:-pimono/main}"
  local tag latest_tag
  latest_tag=""

  while read -r tag; do
    if [ -z "$tag" ]; then
      continue
    fi
    if git merge-base --is-ancestor "$tag" "$remote_ref" 2>/dev/null; then
      latest_tag="$tag"
      break
    fi
  done < <(git tag -l "v0.*" --sort=-v:refname)

  if [ -z "$latest_tag" ]; then
    latest_tag="$(git tag -l "v0.*" --sort=-v:refname | head -n1)"
  fi

  printf '%s\n' "$latest_tag"
}
