#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Clear stale daemon socket
unset ZEE_IPC_SOCKET

# Point everything to the repo - no external config needed
export ZEE_ROOT="$ROOT"
export ZEE_SOURCE="$ROOT"
export XDG_CONFIG_HOME="$ROOT/.dev-config"

# Create minimal dev config that uses repo paths
mkdir -p "$XDG_CONFIG_HOME/zee"
cat > "$XDG_CONFIG_HOME/zee/zee.json" << EOF
{
  "plugin": [
    "opencode-antigravity-auth@1.2.8",
    "file://$ROOT/packages/anthropic-auth/index.mjs"
  ]
}
EOF

# Symlink to real auth tokens
ln -sf "$HOME/.local/share/zee/auth.json" "$XDG_CONFIG_HOME/zee/auth.json" 2>/dev/null || true

cd "$ROOT/packages/zee"
exec bun dev "$@"
