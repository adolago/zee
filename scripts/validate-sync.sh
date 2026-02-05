#!/bin/bash
# validate-sync.sh - Validate agent-core after upstream sync
#
# Usage: ./scripts/validate-sync.sh
#
# Run this after merging upstream changes to ensure everything works.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

echo -e "${BLUE}=== Agent-Core Post-Sync Validation ===${NC}"
echo ""

# 1. Check that critical files exist
echo -e "${YELLOW}Checking critical files...${NC}"
CRITICAL_FILES=(
    ".agent-core/agent/zee.md"
    ".agent-core/agent/stanley.md"
    ".agent-core/agent/johny.md"
    ".claude/skills/zee/SKILL.md"
    ".claude/skills/stanley/SKILL.md"
    ".claude/skills/johny/SKILL.md"
    "packages/agent-core/src/cli/cmd/tui/context/theme/zee.json"
    "packages/agent-core/src/cli/cmd/tui/context/theme/stanley.json"
    "packages/agent-core/src/cli/cmd/tui/context/theme/johny.json"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${RED}✗${NC} $file - MISSING"
        ((ERRORS++))
    fi
done
echo ""

# 2. Check that agent-core naming is preserved
echo -e "${YELLOW}Checking agent-core naming...${NC}"
CONFIG_FILES=(
    "packages/agent-core/src/global.ts"
)

for file in "${CONFIG_FILES[@]}"; do
    if [ -f "$file" ]; then
        if grep -q "agent-core" "$file"; then
            echo -e "  ${GREEN}✓${NC} $file uses agent-core naming"
        else
            echo -e "  ${YELLOW}⚠${NC} $file may have lost agent-core naming"
        fi
    fi
done
echo ""

# 3. TypeScript check
echo -e "${YELLOW}Running TypeScript check...${NC}"
if bun turbo typecheck --filter=agent-core 2>&1 | tail -5; then
    echo -e "  ${GREEN}✓${NC} TypeScript check passed"
else
    echo -e "  ${RED}✗${NC} TypeScript check failed"
    ((ERRORS++))
fi
echo ""

# 4. Check persona themes are registered
echo -e "${YELLOW}Checking persona themes...${NC}"
THEME_FILE="packages/agent-core/src/cli/cmd/tui/context/theme.tsx"
if [ -f "$THEME_FILE" ]; then
    for theme in zee stanley johny; do
        if grep -q "import $theme from" "$THEME_FILE"; then
            echo -e "  ${GREEN}✓${NC} $theme theme imported"
        else
            echo -e "  ${RED}✗${NC} $theme theme not imported"
            ((ERRORS++))
        fi
    done
fi
echo ""

# 5. Check agent schema has theme field
echo -e "${YELLOW}Checking agent schema...${NC}"
AGENT_FILE="packages/agent-core/src/agent/agent.ts"
if [ -f "$AGENT_FILE" ]; then
    if grep -q "theme:" "$AGENT_FILE"; then
        echo -e "  ${GREEN}✓${NC} Agent schema has theme field"
    else
        echo -e "  ${RED}✗${NC} Agent schema missing theme field"
        ((ERRORS++))
    fi
fi
echo ""

# 6. Summary
echo -e "${BLUE}=== Validation Summary ===${NC}"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run full test suite: bun turbo test"
    echo "  2. Build: cd packages/agent-core && bun run build"
    echo "  3. Test with each persona"
else
    echo -e "${RED}$ERRORS check(s) failed.${NC}"
    echo ""
    echo "Review the errors above and fix before proceeding."
    exit 1
fi
