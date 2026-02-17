#!/bin/bash
# sync-upstream.sh - Sync with upstream remotes
#
# Usage: ./scripts/sync-upstream.sh --remote <name> [--preview] [--merge] [--rebase] [--dry-run]
#
# Remotes:
#   opencode  - sst/opencode (kernel merge)
#   openclaw  - openclaw/openclaw (cherry-pick mode)
#   pimono    - badlogic/pi-mono (npm update instructions)

set -euo pipefail

# Remote configuration
declare -A REMOTE_BRANCH=(
    [opencode]="dev"
    [openclaw]="main"
    [pimono]="main"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE=""
DRY_RUN=false
REMOTE=""

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
        --remote)
            REMOTE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 --remote <name> [--preview] [--merge] [--rebase] [--dry-run]"
            echo ""
            echo "Remotes:"
            echo "  opencode   Merge/rebase from sst/opencode dev (kernel)"
            echo "  openclaw   Cherry-pick from openclaw/openclaw main (gateway)"
            echo "  pimono     Print npm update instructions"
            echo ""
            echo "Options:"
            echo "  --remote <name>   Required: which upstream to sync"
            echo "  --preview, -p     Show what would be synced (safe, no changes)"
            echo "  --merge, -m       Merge upstream changes (creates merge commit)"
            echo "  --rebase, -r      Rebase on upstream (rewrites history, for opencode only)"
            echo "  --dry-run, -n     With merge/rebase, show what would happen"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 --remote <name> [--preview] [--merge] [--rebase]"
            exit 1
            ;;
    esac
done

if [ -z "$REMOTE" ]; then
    echo "Error: --remote is required."
    echo "Usage: $0 --remote <name> [--preview] [--merge] [--rebase]"
    echo ""
    echo "Remotes: opencode, openclaw, pimono"
    exit 1
fi

if [ -z "${REMOTE_BRANCH[$REMOTE]+x}" ]; then
    echo -e "${RED}Error: Unknown remote '$REMOTE'. Valid: opencode, openclaw, pimono${NC}"
    exit 1
fi

UPSTREAM_BRANCH="${REMOTE_BRANCH[$REMOTE]}"

# --- pimono: npm-only sync ---
if [ "$REMOTE" = "pimono" ]; then
    echo -e "${BLUE}=== pi-mono Sync ===${NC}"
    echo ""
    echo "pi-mono is synced via npm, not git merge."
    echo ""
    echo "Update command:"
    echo -e "  ${CYAN}cd packages/zee/Swabble && bun update @mariozechner/pi-coding-agent${NC}"
    echo ""

    # Show current vs latest
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    pkg_json="$REPO_ROOT/packages/zee/Swabble/package.json"
    if [ -f "$pkg_json" ]; then
        installed=$(grep -o '"@mariozechner/pi-coding-agent": "[^"]*"' "$pkg_json" | grep -o '[0-9][0-9.]*' || echo "unknown")
        echo -e "  Installed: ${GREEN}$installed${NC}"
    fi

    latest_tag=$(git tag -l "v0.*" --sort=-v:refname | while read -r tag; do
        if git merge-base --is-ancestor "$tag" pimono/main 2>/dev/null; then
            echo "$tag"
            break
        fi
    done)
    if [ -n "$latest_tag" ]; then
        echo -e "  Latest tag: ${CYAN}$latest_tag${NC}"
    fi

    echo ""
    echo "After updating, run ./scripts/validate-sync.sh to verify."
    exit 0
fi

# --- openclaw: cherry-pick mode ---
if [ "$REMOTE" = "openclaw" ]; then
    if [ -z "$MODE" ]; then
        echo "Usage: $0 --remote openclaw [--preview]"
        echo ""
        echo "OpenClaw sync uses cherry-pick mode (Zee does not share git history with OpenClaw)."
        echo ""
        echo "Options:"
        echo "  --preview, -p   List pending security/reliability ports from delta-map"
        echo ""
        echo "Workflow:"
        echo "  1. Run --preview to see pending ports"
        echo "  2. Cherry-pick or manually port individual commits"
        echo "  3. Update docs/architecture/openclaw-delta-map.md"
        echo "  4. Run ./scripts/validate-sync.sh"
        exit 0
    fi

    echo -e "${BLUE}=== OpenClaw Cherry-Pick Sync ===${NC}"
    echo ""

    # Fetch
    echo -e "${YELLOW}Fetching openclaw...${NC}"
    git fetch openclaw --quiet 2>/dev/null || true
    echo ""

    openclaw_head=$(git rev-parse openclaw/main)
    echo -e "Remote HEAD: ${CYAN}${openclaw_head:0:12}${NC}"
    echo ""

    if [ "$MODE" = "preview" ]; then
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
        DELTA_MAP="$REPO_ROOT/docs/architecture/openclaw-delta-map.md"

        echo -e "${YELLOW}Pending ports from delta-map:${NC}"
        echo ""

        if [ -f "$DELTA_MAP" ]; then
            # Extract lines with TODO follow-ups, grouped by decision type
            echo -e "${RED}Security ports (port/adapt):${NC}"
            (grep -E "\| (security|reliability) \| (port|adapt) \|.*\| TODO" "$DELTA_MAP" || true) | while read -r line; do
                pr=$(echo "$line" | awk -F'|' '{print $2}' | xargs)
                cat=$(echo "$line" | awk -F'|' '{print $3}' | xargs)
                dec=$(echo "$line" | awk -F'|' '{print $4}' | xargs)
                title=$(echo "$line" | awk -F'|' '{print $5}' | xargs)
                echo -e "  ${YELLOW}[$cat/$dec]${NC} $pr -- $title"
            done

            echo ""
            echo -e "${YELLOW}Feature ports (adapt/defer):${NC}"
            (grep -E "\| feature \| (adapt|defer) \|.*\| TODO" "$DELTA_MAP" || true) | while read -r line; do
                pr=$(echo "$line" | awk -F'|' '{print $2}' | xargs)
                dec=$(echo "$line" | awk -F'|' '{print $4}' | xargs)
                title=$(echo "$line" | awk -F'|' '{print $5}' | xargs)
                echo -e "  ${CYAN}[$dec]${NC} $pr -- $title"
            done

            total=$(grep -c "| TODO" "$DELTA_MAP" 2>/dev/null || echo "0")
            echo ""
            echo -e "Total pending: ${YELLOW}$total${NC}"
        else
            echo -e "  ${RED}Delta map not found: $DELTA_MAP${NC}"
        fi

        echo ""
        echo -e "${CYAN}To port a specific commit:${NC}"
        echo "  git cherry-pick <commit-hash>"
        echo "  Then update the delta-map TODO -> Done"
    elif [ "$MODE" = "merge" ] || [ "$MODE" = "rebase" ]; then
        echo -e "${RED}OpenClaw sync does not support merge/rebase (unrelated histories).${NC}"
        echo "Use cherry-pick mode: review --preview output and port individual commits."
        exit 1
    fi
    exit 0
fi

# --- opencode: standard merge/rebase ---
if [ -z "$MODE" ]; then
    echo "Usage: $0 --remote opencode [--preview] [--merge] [--rebase] [--dry-run]"
    echo ""
    echo "Options:"
    echo "  --preview, -p   Show what would be merged (safe, no changes)"
    echo "  --merge, -m     Merge upstream changes (creates merge commit)"
    echo "  --rebase, -r    Rebase on upstream (rewrites history, cleaner)"
    echo "  --dry-run, -n   With merge/rebase, show what would happen"
    exit 0
fi

echo -e "${BLUE}=== Zee Upstream Sync (OpenCode) ===${NC}"
echo ""

# Fetch
echo -e "${YELLOW}Fetching $REMOTE...${NC}"
git fetch "$REMOTE" --quiet 2>/dev/null || true

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: You have uncommitted changes.${NC}"
    echo "Please commit or stash them before syncing."
    exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
    echo -e "${RED}Error: Cannot find merge base with $REMOTE/$UPSTREAM_BRANCH.${NC}"
    echo "Try running: git fetch $REMOTE"
    exit 1
fi

read -r AHEAD BEHIND <<< "$(git rev-list --left-right --count HEAD..."$REMOTE/$UPSTREAM_BRANCH")"

echo -e "Merge base: ${CYAN}${MERGE_BASE:0:10}${NC}"
echo -e "We are ${GREEN}$AHEAD${NC} commits ahead, ${YELLOW}$BEHIND${NC} commits behind"
echo ""

# Known conflict-prone files per remote
CONFLICT_PRONE_OPENCODE=(
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
        git log --oneline "$MERGE_BASE..$REMOTE/$UPSTREAM_BRANCH" | head -20
        if [ "$BEHIND" -gt 20 ]; then
            echo "  ... and $((BEHIND - 20)) more"
        fi
        echo ""

        # Show file changes
        echo -e "${YELLOW}Files changed:${NC}"
        git diff --stat "$MERGE_BASE..$REMOTE/$UPSTREAM_BRANCH" | tail -20
        echo ""

        # Check for conflicts in our customized files
        echo -e "${YELLOW}Potential conflicts in customized files:${NC}"
        UPSTREAM_CHANGED=$(git diff --name-only "$MERGE_BASE..$REMOTE/$UPSTREAM_BRANCH")
        OUR_CHANGED=$(git diff --name-only "$MERGE_BASE..HEAD")

        CONFLICTS=()
        for file in $UPSTREAM_CHANGED; do
            if echo "$OUR_CHANGED" | grep -q "^$file$"; then
                CONFLICTS+=("$file")
            fi
        done

        if [ ${#CONFLICTS[@]} -eq 0 ]; then
            echo -e "${GREEN}  No obvious conflicts detected.${NC}"
        else
            for file in "${CONFLICTS[@]}"; do
                echo -e "  ${RED}!!${NC} $file (modified in both)"
            done
        fi
        echo ""

        echo -e "${CYAN}To merge these changes, run:${NC}"
        echo "  ./scripts/sync-upstream.sh --remote $REMOTE --merge"
        ;;

    merge)
        if [ "$BEHIND" -eq 0 ]; then
            echo -e "${GREEN}Already up to date.${NC}"
            exit 0
        fi

        echo -e "${YELLOW}Merging upstream changes...${NC}"

        if $DRY_RUN; then
            echo "(Dry run - no changes will be made)"
            git merge --no-commit --no-ff "$REMOTE/$UPSTREAM_BRANCH" || true
            echo ""
            echo "Merge would result in:"
            git diff --cached --stat
            git merge --abort 2>/dev/null || true
        else
            UPSTREAM_SHORT=$(git log -1 --format=%h "$REMOTE/$UPSTREAM_BRANCH")
            MERGE_MSG="Merge $REMOTE/$UPSTREAM_BRANCH ($UPSTREAM_SHORT)

Synced with $REMOTE upstream.
Merge base: ${MERGE_BASE:0:10}
Upstream commits: $BEHIND"

            if git merge --no-edit -m "$MERGE_MSG" "$REMOTE/$UPSTREAM_BRANCH"; then
                echo -e "${GREEN}Merge completed successfully.${NC}"
                echo ""
                echo "Next steps:"
                echo "  1. Review changes: git diff HEAD~1"
                echo "  2. Run validation: ./scripts/validate-sync.sh"
                echo "  3. Build: cd packages/zee && bun run build"
            else
                echo -e "${RED}Merge conflicts detected.${NC}"
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
        echo -e "${RED}Warning: Rebase rewrites history.${NC}"
        echo "This should only be used on unpushed branches."
        echo ""

        if $DRY_RUN; then
            echo "(Dry run - showing what would be rebased)"
            echo ""
            echo "Commits to be rebased:"
            git log --oneline "$MERGE_BASE..HEAD" | head -20
            if [ "$AHEAD" -gt 20 ]; then
                echo "  ... and $((AHEAD - 20)) more"
            fi
        else
            read -p "Are you sure you want to rebase on $REMOTE/$UPSTREAM_BRANCH? (y/N) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                git rebase "$REMOTE/$UPSTREAM_BRANCH"
            else
                echo "Aborted."
            fi
        fi
        ;;
esac
