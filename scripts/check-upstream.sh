#!/bin/bash
# check-upstream.sh - Check for upstream updates across multiple remotes
#
# Usage: ./scripts/check-upstream.sh [--remote <name>] [--fetch] [--verbose]
#
# Remotes:
#   opencode  - sst/opencode (kernel)       -> packages/zee/
#   openclaw  - openclaw/openclaw (gateway)  -> packages/zee/Swabble/
#   pimono    - badlogic/pi-mono (vendored)  -> npm deps
#
# When no --remote is given, checks all three.

set -euo pipefail

# Remote configuration
declare -A REMOTE_URL=(
    [opencode]="https://github.com/sst/opencode.git"
    [openclaw]="https://github.com/openclaw/openclaw.git"
    [pimono]="https://github.com/badlogic/pi-mono.git"
)

declare -A REMOTE_BRANCH=(
    [opencode]="dev"
    [openclaw]="main"
    [pimono]="main"
)

declare -A REMOTE_SCOPE=(
    [opencode]="packages/zee/ (kernel)"
    [openclaw]="packages/zee/Swabble/ (gateway)"
    [pimono]="npm: @mariozechner/pi-* (vendored deps)"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/upstream-common.sh
source "$REPO_ROOT/scripts/lib/upstream-common.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

FETCH=false
VERBOSE=false
REMOTE=""

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
        --remote|-r)
            REMOTE="$2"
            shift 2
            ;;
        --all|-a)
            REMOTE=""
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--remote <name>] [--fetch] [--verbose]"
            echo ""
            echo "Options:"
            echo "  --remote, -r <name>  Check a specific remote (opencode, openclaw, pimono)"
            echo "  --all, -a            Check all remotes (default)"
            echo "  --fetch, -f          Fetch remotes before checking"
            echo "  --verbose, -v        Show detailed commit lists"
            echo "  --help, -h           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Determine which remotes to check
if [ -n "$REMOTE" ]; then
    if [ -z "${REMOTE_BRANCH[$REMOTE]+x}" ]; then
        echo -e "${RED}Error: Unknown remote '$REMOTE'. Valid: opencode, openclaw, pimono${NC}"
        exit 1
    fi
    REMOTES=("$REMOTE")
else
    REMOTES=(opencode openclaw pimono)
fi

check_pimono() {
    local remote_name="pimono"
    local branch="${REMOTE_BRANCH[$remote_name]}"

    echo -e "${BLUE}--- pi-mono (badlogic/pi-mono $branch) ---${NC}"
    echo -e "  Scope: ${CYAN}${REMOTE_SCOPE[$remote_name]}${NC}"
    echo ""

    local installed
    installed="$(resolve_pimono_installed_version "$REPO_ROOT" || true)"

    if [ -z "$installed" ]; then
        echo -e "  ${YELLOW}Installed version: unknown (not found in package.json)${NC}"
    else
        echo -e "  Installed version: ${GREEN}$installed${NC}"
    fi

    # Get latest tag from pimono remote
    local latest_tag
    latest_tag="$(resolve_latest_pimono_tag "$remote_name/$branch")"

    local latest_version="${latest_tag#v}"
    echo -e "  Latest tag: ${CYAN}${latest_tag:-unknown}${NC}"

    if [ -n "$installed" ] && [ -n "$latest_version" ]; then
        if [ "$installed" = "$latest_version" ]; then
            echo -e "  Status: ${GREEN}UP TO DATE${NC}"
        else
            echo -e "  Status: ${RED}BEHIND${NC} (installed $installed, latest $latest_version)"
        fi
    else
        echo -e "  Status: ${YELLOW}UNABLE TO COMPARE${NC}"
    fi
    echo ""
}

check_git_remote() {
    local remote_name="$1"
    local branch="${REMOTE_BRANCH[$remote_name]}"

    echo -e "${BLUE}--- $remote_name (${REMOTE_URL[$remote_name]} $branch) ---${NC}"
    echo -e "  Scope: ${CYAN}${REMOTE_SCOPE[$remote_name]}${NC}"
    echo ""

    # Check if remote exists
    if ! git remote get-url "$remote_name" &>/dev/null; then
        echo -e "  ${RED}Remote '$remote_name' not configured.${NC}"
        echo "  Add with: git remote add $remote_name ${REMOTE_URL[$remote_name]}"
        echo ""
        return
    fi

    # Check if remote branch is fetched
    if ! git rev-parse "$remote_name/$branch" &>/dev/null 2>&1; then
        echo -e "  ${RED}Branch '$remote_name/$branch' not found. Run: git fetch $remote_name${NC}"
        echo ""
        return
    fi

    local remote_head
    remote_head=$(git rev-parse "$remote_name/$branch")
    echo -e "  Remote HEAD: ${CYAN}${remote_head:0:12}${NC}"

    # Try to find merge base (may fail for unrelated histories)
    local merge_base
    merge_base=$(git merge-base HEAD "$remote_name/$branch" 2>/dev/null || echo "")

    if [ -z "$merge_base" ]; then
        echo -e "  ${YELLOW}No common ancestor (unrelated histories).${NC}"
        echo -e "  Remote commits: $(git rev-list --count "$remote_name/$branch")"
        echo -e "  Status: ${YELLOW}UNRELATED HISTORIES${NC}"
        echo ""
        return
    fi

    # Count commits ahead/behind
    local ahead behind
    read -r ahead behind <<< "$(git rev-list --left-right --count HEAD..."$remote_name/$branch")"

    echo -e "  Merge base: ${CYAN}${merge_base:0:12}${NC}"
    echo -e "  Ahead:  ${GREEN}$ahead${NC} (our changes)"
    echo -e "  Behind: ${YELLOW}$behind${NC} (upstream changes)"

    # Determine status
    if [ "$behind" -eq 0 ]; then
        echo -e "  Status: ${GREEN}UP TO DATE${NC}"
    elif [ "$behind" -lt 20 ]; then
        echo -e "  Status: ${YELLOW}MINOR DRIFT${NC} ($behind commits behind)"
    else
        echo -e "  Status: ${RED}SIGNIFICANT DRIFT${NC} ($behind commits behind)"
    fi

    # Show latest upstream commits if verbose and behind
    if $VERBOSE && [ "$behind" -gt 0 ]; then
        echo ""
        echo -e "  ${YELLOW}Latest upstream commits:${NC}"
        while read -r line; do
            echo "    $line"
        done < <(git log --oneline "$merge_base..$remote_name/$branch" | head -10 || true)
        if [ "$behind" -gt 10 ]; then
            echo "    ... and $((behind - 10)) more"
        fi
    fi

    # Show our divergent commits if verbose and ahead
    if $VERBOSE && [ "$ahead" -gt 0 ]; then
        echo ""
        echo -e "  ${GREEN}Our divergent commits:${NC}"
        while read -r line; do
            echo "    $line"
        done < <(git log --oneline "$merge_base..HEAD" | head -10 || true)
        if [ "$ahead" -gt 10 ]; then
            echo "    ... and $((ahead - 10)) more"
        fi
    fi

    # Latest tag on remote
    local latest_tag
    latest_tag=$(git describe --tags --abbrev=0 "$remote_name/$branch" 2>/dev/null || echo "none")
    echo -e "  Latest tag: ${CYAN}$latest_tag${NC}"
    echo ""
}

# Main
echo -e "${BLUE}=== Zee Upstream Check ===${NC}"
echo ""

# Fetch if requested
if $FETCH; then
    for r in "${REMOTES[@]}"; do
        if git remote get-url "$r" &>/dev/null; then
            echo -e "${YELLOW}Fetching $r...${NC}"
            git fetch "$r" --quiet 2>/dev/null || true
        fi
    done
    echo ""
fi

for r in "${REMOTES[@]}"; do
    if [ "$r" = "pimono" ]; then
        check_pimono
    else
        check_git_remote "$r"
    fi
done

echo -e "${BLUE}---${NC}"
echo "Detailed dashboard: ./scripts/check-upstream-all.sh"
echo "Sync: ./scripts/sync-upstream.sh --remote <name> --preview"
