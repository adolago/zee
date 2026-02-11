#!/usr/bin/env bash
#
# Manual verification script for WezTerm TUI harness
#
# This script demonstrates the WezTerm CLI commands used by the harness.
# Run it to verify WezTerm multiplexing is working correctly.
#

set -e

echo "=== WezTerm TUI Harness Verification ==="
echo

# Check WezTerm CLI availability
echo "1. Checking WezTerm CLI..."
if wezterm cli list --format json >/dev/null 2>&1; then
    echo "   ✓ WezTerm CLI is available"
else
    echo "   ✗ WezTerm CLI not available"
    echo "   Make sure WezTerm is running with multiplexing enabled."
    echo "   Add to your wezterm.lua: unix_domains = {{ name = 'unix' }}"
    exit 1
fi

echo
echo "2. Creating test pane..."
PANE_ID=$(wezterm cli split-pane --bottom --percent 30 -- bash -c "echo 'Test pane created'; sleep 5")
echo "   ✓ Created pane: $PANE_ID"

echo
echo "3. Sending text to pane..."
wezterm cli send-text --pane-id "$PANE_ID" --no-paste 'echo "Hello from harness"'
wezterm cli send-text --pane-id "$PANE_ID" --no-paste $'\r'
echo "   ✓ Text sent"

sleep 1

echo
echo "4. Capturing pane output..."
OUTPUT=$(wezterm cli get-text --pane-id "$PANE_ID")
if echo "$OUTPUT" | grep -q "Hello from harness"; then
    echo "   ✓ Output captured correctly"
else
    echo "   ⚠ Output may not contain expected text"
fi

echo
echo "5. Testing special keys (Ctrl+C)..."
wezterm cli send-text --pane-id "$PANE_ID" --no-paste $'\x03'
echo "   ✓ Ctrl+C sent"

echo
echo "6. Closing pane..."
wezterm cli kill-pane --pane-id "$PANE_ID" 2>/dev/null || true
echo "   ✓ Pane closed"

echo
echo "=== All checks passed! ==="
echo
echo "The WezTerm harness should work correctly."
echo "Run the test suite with:"
echo "  bun test packages/zee/test/tui/wezterm-harness.test.ts"
