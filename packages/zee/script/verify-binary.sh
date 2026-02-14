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
CORE_BINARY="$REPO_ROOT/dist/@zee/zee-linux-x64/bin/zee"
BINARY_DIR="$(dirname "$CORE_BINARY")"
EXTENSIONS_DIR="$BINARY_DIR/extensions"
INSTALL_TARGET="$REPO_ROOT/script/zee-cli"
INSTALLED_BINARY="$(which zee 2>/dev/null || echo '')"

echo "=== Binary Version Check ==="
echo

# Check if local binary exists
if [[ ! -f "$CORE_BINARY" ]]; then
    echo -e "${RED}ERROR: Local binary not found${NC}"
    echo "  Expected core binary: $CORE_BINARY"
    echo "  Run: cd packages/zee && bun run build"
    exit 1
fi

if [[ ! -f "$INSTALL_TARGET" ]]; then
    echo -e "${RED}ERROR: Local Zee dispatcher not found${NC}"
    echo "  Expected: $INSTALL_TARGET"
    echo "  Run: cd packages/zee && bun run build"
    exit 1
fi

# Check if zee is in PATH
if [[ -z "$INSTALLED_BINARY" ]]; then
    echo -e "${RED}ERROR: zee not found in PATH${NC}"
    echo "  Run: ln -sf $INSTALL_TARGET ~/.bun/bin/zee"
    exit 1
fi

# Resolve symlink
RESOLVED_BINARY="$(readlink -f "$INSTALLED_BINARY")"
RESOLVED_LOCAL="$(readlink -f "$INSTALL_TARGET")"

echo "Installed binary: $INSTALLED_BINARY"
echo "  → Resolves to:  $RESOLVED_BINARY"
echo "Local build:      $INSTALL_TARGET"
echo

# Check if they match
if [[ "$RESOLVED_BINARY" != "$RESOLVED_LOCAL" ]]; then
    echo -e "${RED}ERROR: MISMATCH: Installed binary is NOT the local build${NC}"
    echo
    echo "  The installed binary points to a different location."
    echo "  Your changes will NOT take effect until you fix this."
    echo
    echo "  Fix with:"
    echo "    ln -sf $INSTALL_TARGET ~/.bun/bin/zee"
    echo
    exit 1
fi

# Check modification times
LOCAL_MTIME=$(stat -c %Y "$CORE_BINARY" 2>/dev/null || stat -f %m "$CORE_BINARY")
SRC_NEWEST=$(find "$REPO_ROOT/src" -name "*.ts" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)

if [[ -n "$SRC_NEWEST" ]] && [[ "$SRC_NEWEST" -gt "$LOCAL_MTIME" ]]; then
    echo -e "${YELLOW}WARNING: Source files are newer than binary${NC}"
    echo
    echo "  Source modified: $(date -d @$SRC_NEWEST '+%Y-%m-%d %H:%M:%S')"
    echo "  Binary built:    $(date -d @$LOCAL_MTIME '+%Y-%m-%d %H:%M:%S')"
    echo
    echo "  Run: bun run build"
    echo
    exit 1
fi

# Check bundled channel plugins exist next to binary
if [[ ! -d "$EXTENSIONS_DIR" ]]; then
    echo -e "${RED}ERROR: Bundled extensions directory missing${NC}"
    echo "  Expected: $EXTENSIONS_DIR"
    echo "  Run: bun run build"
    exit 1
fi

REQUIRED_PLUGINS=("whatsapp" "telegram" "slack" "discord")
for plugin in "${REQUIRED_PLUGINS[@]}"; do
    PLUGIN_DIR="$EXTENSIONS_DIR/$plugin"
    if [[ ! -d "$PLUGIN_DIR" ]]; then
        echo -e "${RED}ERROR: Missing bundled plugin: $plugin${NC}"
        echo "  Expected directory: $PLUGIN_DIR"
        exit 1
    fi

    if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
        echo -e "${RED}ERROR: Missing plugin manifest: $plugin/package.json${NC}"
        exit 1
    fi

    if [[ ! -f "$PLUGIN_DIR/index.js" ]]; then
        echo -e "${RED}ERROR: Missing bundled plugin entry: $plugin/index.js${NC}"
        exit 1
    fi

    if [[ ! -f "$PLUGIN_DIR/zee.plugin.json" && ! -f "$PLUGIN_DIR/clawdbot.plugin.json" ]]; then
        echo -e "${RED}ERROR: Missing plugin manifest: $plugin/(zee.plugin.json|clawdbot.plugin.json)${NC}"
        exit 1
    fi
done

# All checks passed
echo -e "${GREEN}Binary verified${NC}"
echo "  Location: $RESOLVED_BINARY"
echo "  Built:    $(date -d @$LOCAL_MTIME '+%Y-%m-%d %H:%M:%S')"
echo "  Plugins:  ${REQUIRED_PLUGINS[*]}"
echo
echo "Ready to test!"
