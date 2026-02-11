#!/bin/bash
# check-upstream.sh - Check for upstream updates
#
# Usage: ./scripts/check-upstream.sh [--fetch] [--verbose]
#
# This script checks the divergence between Zee and upstream,
# helping to track when updates are available and what needs to be merged.

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
LOCAL_BRANCH="${LOCAL_BRANCH:-main}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

FETCH=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --fetch|-f)
            FETCH=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=== Zee Upstream Check ===${NC}"
echo ""

# Fetch if requested
if $FETCH; then
    echo -e "${YELLOW}Fetching upstream...${NC}"
    git fetch "$UPSTREAM_REMOTE" --tags --quiet
    echo ""
fi

# Check if upstream remote exists
if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
    echo -e "${RED}Error: Upstream remote '$UPSTREAM_REMOTE' not found.${NC}"
    echo "Add it with: git remote add upstream <url>"
    exit 1
fi

# Get merge base
MERGE_BASE=$(git merge-base HEAD "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
    echo -e "${RED}Error: Cannot find merge base with upstream.${NC}"
    echo "Try running: git fetch upstream"
    exit 1
fi

# Count commits ahead/behind
read -r AHEAD BEHIND <<< "$(git rev-list --left-right --count HEAD..."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"

echo -e "${GREEN}Upstream remote:${NC} $(git remote get-url "$UPSTREAM_REMOTE")"
echo -e "${GREEN}Upstream branch:${NC} $UPSTREAM_BRANCH"
echo -e "${GREEN}Merge base:${NC} ${MERGE_BASE:0:10}"
echo ""
echo -e "${BLUE}Divergence Status:${NC}"
echo -e "  Commits ahead (our changes):  ${GREEN}$AHEAD${NC}"
echo -e "  Commits behind (to merge):    ${YELLOW}$BEHIND${NC}"
echo ""

# Show latest upstream commits if behind
if [ "$BEHIND" -gt 0 ]; then
    echo -e "${YELLOW}Latest upstream commits to merge:${NC}"
    git log --oneline "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | head -10
    if [ "$BEHIND" -gt 10 ]; then
        echo "  ... and $((BEHIND - 10)) more commits"
    fi
    echo ""
fi

# Show our divergent commits if verbose
if $VERBOSE && [ "$AHEAD" -gt 0 ]; then
    echo -e "${GREEN}Our divergent commits:${NC}"
    git log --oneline "$MERGE_BASE..HEAD" | head -20
    if [ "$AHEAD" -gt 20 ]; then
        echo "  ... and $((AHEAD - 20)) more commits"
    fi
    echo ""
fi

# Check for latest tags
LATEST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)
if [ -n "$LATEST_TAG" ]; then
    echo -e "${BLUE}Latest upstream tag:${NC} $LATEST_TAG"
fi

# Summary recommendation
echo ""
if [ "$BEHIND" -eq 0 ]; then
    echo -e "${GREEN}✓ Up to date with upstream!${NC}"
elif [ "$BEHIND" -lt 10 ]; then
    echo -e "${YELLOW}⚠ Minor updates available. Consider merging soon.${NC}"
else
    echo -e "${RED}⚠ Significant updates available ($BEHIND commits behind).${NC}"
    echo "Run: ./scripts/sync-upstream.sh --preview"
fi
