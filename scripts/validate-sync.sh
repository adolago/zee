#!/bin/bash
# validate-sync.sh - Validate Zee after upstream sync
#
# Usage: ./scripts/validate-sync.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

echo -e "${BLUE}=== Zee Post-Sync Validation ===${NC}"
echo ""

# 1. Check that critical files exist
echo -e "${YELLOW}Checking critical files...${NC}"
CRITICAL_FILES=(
  ".zee/agent/zee.md"
  "packages/zee/src/cli/cmd/tui/context/theme/selenized-dark.json"
  "packages/zee/src/cli/cmd/tui/context/theme.tsx"
)

for file in "${CRITICAL_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}OK${NC} $file"
  else
    echo -e "  ${RED}FAIL${NC} $file - MISSING"
    ((ERRORS++))
  fi
done
echo ""

# 2. Check for stale Zee naming in key runtime files
echo -e "${YELLOW}Checking runtime naming...${NC}"
NAMING_FILES=(
  "packages/zee/bin/zee"
  "packages/zee/script/postinstall.mjs"
  "packages/zee/script/build.ts"
  "packages/zee/script/publish.ts"
)

for file in "${NAMING_FILES[@]}"; do
  if [ -f "$file" ]; then
    if grep -q "zee" "$file"; then
      echo -e "  ${GREEN}OK${NC} $file uses Zee naming"
    else
      echo -e "  ${RED}FAIL${NC} $file is missing Zee naming markers"
      ((ERRORS++))
    fi
  fi
done
echo ""

# 3. TypeScript check
echo -e "${YELLOW}Running typecheck...${NC}"
if bun run typecheck >/tmp/zee-validate-sync.log 2>&1; then
  echo -e "  ${GREEN}OK${NC} Typecheck passed"
else
  echo -e "  ${RED}FAIL${NC} Typecheck failed"
  tail -20 /tmp/zee-validate-sync.log || true
  ((ERRORS++))
fi
echo ""

# 4. Check single-theme registration
echo -e "${YELLOW}Checking theme registration...${NC}"
THEME_FILE="packages/zee/src/cli/cmd/tui/context/theme.tsx"
if [ -f "$THEME_FILE" ]; then
  if grep -q 'selenized-dark' "$THEME_FILE"; then
    echo -e "  ${GREEN}OK${NC} Selenized Dark theme configured"
  else
    echo -e "  ${RED}FAIL${NC} Selenized Dark theme not configured"
    ((ERRORS++))
  fi
fi
echo ""

# 5. Summary
echo -e "${BLUE}=== Validation Summary ===${NC}"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Run tests: cd packages/zee && bun test"
  echo "  2. Build: cd packages/zee && bun run build"
else
  echo -e "${RED}$ERRORS check(s) failed.${NC}"
  exit 1
fi
