#!/bin/bash
# install.sh - Install local git hooks for zee
#
# Usage: ./scripts/hooks/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "Installing git hooks..."

# pre-commit hook
cp "$SCRIPT_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "  Installed: pre-commit (SKILL.md validation)"

# post-fetch hook
cp "$SCRIPT_DIR/post-fetch" "$HOOKS_DIR/post-fetch"
chmod +x "$HOOKS_DIR/post-fetch"
echo "  Installed: post-fetch (upstream drift warning)"

echo ""
echo "Done. Hooks installed to $HOOKS_DIR"
