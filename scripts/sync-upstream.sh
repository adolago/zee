#!/bin/bash
# sync-upstream.sh - Sync with upstream
#
# Usage: ./scripts/sync-upstream.sh [--preview] [--merge] [--rebase]
#
# This script helps merge upstream changes into Zee,
# preserving our customizations while incorporating new features.

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --preview|-p)
            MODE="preview"
            shift
            ;;
        --merge|-m)
            MODE="merge"
            shift
            ;;
        --rebase|-r)
            MODE="rebase"
            shift
            ;;
        --dry-run|-n)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--preview] [--merge] [--rebase] [--dry-run]"
            exit 1
            ;;
    esac
done

if [ -z "$MODE" ]; then
    echo "Usage: $0 [--preview] [--merge] [--rebase]"
    echo ""
    echo "Options:"
    echo "  --preview, -p   Show what would be merged (safe, no changes)"
    echo "  --merge, -m     Merge upstream changes (creates merge commit)"
    echo "  --rebase, -r    Rebase on upstream (rewrites history, cleaner)"
    echo "  --dry-run, -n   With merge/rebase, show what would happen"
    exit 0
fi

echo -e "${BLUE}=== Zee Upstream Sync ===${NC}"
echo ""

# Ensure we have latest upstream
echo -e "${YELLOW}Fetching upstream...${NC}"
git fetch "$UPSTREAM_REMOTE" --tags

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: You have uncommitted changes.${NC}"
    echo "Please commit or stash them before syncing."
    exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
read -r AHEAD BEHIND <<< "$(git rev-list --left-right --count HEAD..."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"

echo -e "Merge base: ${CYAN}${MERGE_BASE:0:10}${NC}"
echo -e "We are ${GREEN}$AHEAD${NC} commits ahead, ${YELLOW}$BEHIND${NC} commits behind"
echo ""

# Known conflict-prone files (our customizations)
CONFLICT_PRONE=(
    "packages/zee/src/provider/provider.ts"
    "packages/zee/src/agent/agent.ts"
    "packages/zee/src/cli/cmd/tui/context/theme.tsx"
    "packages/zee/src/cli/cmd/tui/routes/session"
    ".zee/"
    "vendor/"
)

case $MODE in
    preview)
        echo -e "${BLUE}=== Changes from Upstream ===${NC}"
        echo ""

        # Show incoming commits
        echo -e "${YELLOW}Incoming commits ($BEHIND):${NC}"
        git log --oneline "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
        echo ""

        # Show file changes
        echo -e "${YELLOW}Files changed:${NC}"
        git diff --stat "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | tail -20
        echo ""

        # Check for conflicts in our customized files
        echo -e "${YELLOW}Potential conflicts in our customized files:${NC}"
        UPSTREAM_CHANGED=$(git diff --name-only "$MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
        OUR_CHANGED=$(git diff --name-only "$MERGE_BASE..HEAD")

        CONFLICTS=()
        for file in $UPSTREAM_CHANGED; do
            if echo "$OUR_CHANGED" | grep -q "^$file$"; then
                CONFLICTS+=("$file")
            fi
        done

        if [ ${#CONFLICTS[@]} -eq 0 ]; then
            echo -e "${GREEN}  No obvious conflicts detected!${NC}"
        else
            for file in "${CONFLICTS[@]}"; do
                echo -e "  ${RED}⚠${NC} $file (modified in both)"
            done
        fi
        echo ""

        echo -e "${CYAN}To merge these changes, run:${NC}"
        echo "  ./scripts/sync-upstream.sh --merge"
        ;;

    merge)
        if [ "$BEHIND" -eq 0 ]; then
            echo -e "${GREEN}Already up to date!${NC}"
            exit 0
        fi

        echo -e "${YELLOW}Merging upstream changes...${NC}"

        if $DRY_RUN; then
            echo "(Dry run - no changes will be made)"
            git merge --no-commit --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" || true
            echo ""
            echo "Merge would result in:"
            git diff --cached --stat
            git merge --abort 2>/dev/null || true
        else
            MERGE_MSG="Merge upstream $(git log -1 --format=%h $UPSTREAM_REMOTE/$UPSTREAM_BRANCH)

Synced with upstream.
Merge base: ${MERGE_BASE:0:10}
Upstream commits: $BEHIND"

            if git merge --no-edit -m "$MERGE_MSG" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
                echo -e "${GREEN}✓ Merge completed successfully!${NC}"
                echo ""
                echo "Next steps:"
                echo "  1. Review the changes: git diff HEAD~1"
                echo "  2. Run tests: bun test"
                echo "  3. Build: bun run build"
            else
                echo -e "${RED}Merge conflicts detected!${NC}"
                echo ""
                echo "Resolve conflicts in:"
                git diff --name-only --diff-filter=U
                echo ""
                echo "Then run:"
                echo "  git add <resolved-files>"
                echo "  git merge --continue"
            fi
        fi
        ;;

    rebase)
        echo -e "${RED}Warning: Rebase rewrites history!${NC}"
        echo "This should only be used on unpushed branches."
        echo ""

        if $DRY_RUN; then
            echo "(Dry run - showing what would be rebased)"
            echo ""
            echo "Commits to be rebased:"
            git log --oneline "$MERGE_BASE..HEAD"
        else
            read -p "Are you sure you want to rebase? (y/N) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                git rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
            else
                echo "Aborted."
            fi
        fi
        ;;
esac
