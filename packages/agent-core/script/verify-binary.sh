#!/bin/bash
# Verify the installed binary matches the local build before testing
# Run this after `bun run build` and before testing changes

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_BINARY="$REPO_ROOT/dist/@agent-core/core-linux-x64/bin/agent-core"
INSTALLED_BINARY="$(which agent-core 2>/dev/null || echo '')"

echo "=== Binary Version Check ==="
echo

# Check if local binary exists
if [[ ! -f "$LOCAL_BINARY" ]]; then
    echo -e "${RED}✗ Local binary not found${NC}"
    echo "  Expected: $LOCAL_BINARY"
    echo "  Run: cd packages/agent-core && bun run build"
    exit 1
fi

# Check if agent-core is in PATH
if [[ -z "$INSTALLED_BINARY" ]]; then
    echo -e "${RED}✗ agent-core not found in PATH${NC}"
    echo "  Run: ln -sf $LOCAL_BINARY ~/.bun/bin/agent-core"
    exit 1
fi

# Resolve symlink
RESOLVED_BINARY="$(readlink -f "$INSTALLED_BINARY")"
RESOLVED_LOCAL="$(readlink -f "$LOCAL_BINARY")"

echo "Installed binary: $INSTALLED_BINARY"
echo "  → Resolves to:  $RESOLVED_BINARY"
echo "Local build:      $LOCAL_BINARY"
echo

# Check if they match
if [[ "$RESOLVED_BINARY" != "$RESOLVED_LOCAL" ]]; then
    echo -e "${RED}✗ MISMATCH: Installed binary is NOT the local build${NC}"
    echo
    echo "  The installed binary points to a different location."
    echo "  Your changes will NOT take effect until you fix this."
    echo
    echo "  Fix with:"
    echo "    ln -sf $LOCAL_BINARY ~/.bun/bin/agent-core"
    echo
    exit 1
fi

# Check modification times
LOCAL_MTIME=$(stat -c %Y "$LOCAL_BINARY" 2>/dev/null || stat -f %m "$LOCAL_BINARY")
SRC_NEWEST=$(find "$REPO_ROOT/src" -name "*.ts" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)

if [[ -n "$SRC_NEWEST" ]] && [[ "$SRC_NEWEST" -gt "$LOCAL_MTIME" ]]; then
    echo -e "${YELLOW}⚠ WARNING: Source files are newer than binary${NC}"
    echo
    echo "  Source modified: $(date -d @$SRC_NEWEST '+%Y-%m-%d %H:%M:%S')"
    echo "  Binary built:    $(date -d @$LOCAL_MTIME '+%Y-%m-%d %H:%M:%S')"
    echo
    echo "  Run: bun run build"
    echo
    exit 1
fi

# All checks passed
echo -e "${GREEN}✓ Binary verified${NC}"
echo "  Location: $RESOLVED_BINARY"
echo "  Built:    $(date -d @$LOCAL_MTIME '+%Y-%m-%d %H:%M:%S')"
echo
echo "Ready to test!"
