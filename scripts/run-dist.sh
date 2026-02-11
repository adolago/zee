#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Clear stale daemon socket to ensure standalone mode
unset ZEE_IPC_SOCKET

TARGET="${ZEE_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux) ;;
    msys*|mingw*|cygwin*) os="windows" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  TARGET="${os}-${arch}"
fi

DIST_DIR="${ZEE_DIST:-$ROOT/packages/zee/dist/@zee/zee-${TARGET}}"
BIN_PATH="${ZEE_BIN:-$DIST_DIR/bin/zee}"

if [[ ! -x "$BIN_PATH" ]]; then
  echo "Binary not found: $BIN_PATH" >&2
  echo "Build it first, or set ZEE_TARGET/ZEE_DIST/ZEE_BIN." >&2
  exit 1
fi

export ZEE_ROOT="$DIST_DIR"
exec "$BIN_PATH" "$@"
