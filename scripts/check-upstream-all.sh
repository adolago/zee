#!/bin/bash
# check-upstream-all.sh - Unified upstream dashboard for all three source projects
#
# Usage: ./scripts/check-upstream-all.sh [--fetch]
#
# Reads snapshot pins from docs/architecture/upstream-differences.md,
# OpenClaw monitor pin from docs/architecture/upstream-import-map.md,
# and TODO counts from docs/architecture/openclaw-delta-map.md.

set -euo pipefail

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
BOLD='\033[1m'
NC='\033[0m'

FETCH=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --fetch|-f)
            FETCH=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--fetch]"
            echo ""
            echo "Options:"
            echo "  --fetch, -f   Fetch all remotes before reporting"
            echo "  --help, -h    Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Fetch all remotes if requested
if $FETCH; then
    for remote in opencode openclaw pimono; do
        if git remote get-url "$remote" &>/dev/null; then
            echo -e "${YELLOW}Fetching $remote...${NC}"
            git fetch "$remote" --quiet 2>/dev/null || true
        fi
    done
    echo ""
fi

# Extract snapshot pins from upstream-differences.md
UPSTREAM_DIFF="$REPO_ROOT/docs/architecture/upstream-differences.md"
DELTA_MAP="$REPO_ROOT/docs/architecture/openclaw-delta-map.md"
UPSTREAM_IMPORT_MAP="$REPO_ROOT/docs/architecture/upstream-import-map.md"

opencode_snapshot_pin=""
openclaw_snapshot_pin=""
openclaw_monitor_pin=""
if [ -f "$UPSTREAM_DIFF" ]; then
    # Prefer the newest "Current upstream pins" entries when multiple matches exist.
    opencode_snapshot_pin=$(grep -oP '^- opencode: `\K[a-f0-9]{12,40}' "$UPSTREAM_DIFF" | tail -1 || echo "")
    openclaw_snapshot_pin=$(grep -oP '^- openclaw: `\K[a-f0-9]{12,40}' "$UPSTREAM_DIFF" | tail -1 || echo "")
fi

if [ -f "$UPSTREAM_IMPORT_MAP" ]; then
    openclaw_monitor_pin=$(grep -oP '^- OpenClaw pin: `\K[a-f0-9]{12,40}' "$UPSTREAM_IMPORT_MAP" | head -1 || echo "")
fi
if [ -z "$openclaw_monitor_pin" ]; then
    openclaw_monitor_pin="$openclaw_snapshot_pin"
fi

# Count pending TODOs from delta-map
openclaw_todos=0
if [ -f "$DELTA_MAP" ]; then
    openclaw_todos=$(count_markdown_todos "$DELTA_MAP")
fi

# pi-mono installed version
pimono_installed="$(resolve_pimono_installed_version "$REPO_ROOT" || true)"

echo -e "${BOLD}=== Zee Upstream Dashboard ===${NC}"
echo ""

# --- OpenCode ---
echo -e "${BLUE}OpenCode${NC} (sst/opencode dev)"
echo -e "  Remote: https://github.com/sst/opencode.git"

if git rev-parse opencode/dev &>/dev/null 2>&1; then
    opencode_head=$(git rev-parse opencode/dev)
    opencode_head_short="${opencode_head:0:12}"

    merge_base=$(git merge-base HEAD opencode/dev 2>/dev/null || echo "")
    if [ -n "$merge_base" ]; then
        read -r ahead behind <<< "$(git rev-list --left-right --count HEAD...opencode/dev)"
        echo -e "  Ahead:  ${GREEN}$ahead${NC}    Behind: ${YELLOW}$behind${NC}"
    else
        echo -e "  ${YELLOW}No common ancestor (unrelated histories)${NC}"
        ahead="N/A"
        behind="N/A"
    fi

    echo -e "  Last sync snapshot: ${CYAN}${opencode_snapshot_pin:-unknown}${NC}"
    echo -e "  Current upstream HEAD: ${CYAN}${opencode_head_short}${NC}"

    if [ "$behind" = "0" ]; then
        echo -e "  Status: ${GREEN}UP TO DATE${NC}"
    elif [ "$behind" != "N/A" ] && [ "$behind" -lt 20 ]; then
        echo -e "  Status: ${YELLOW}MINOR DRIFT${NC}"
    elif [ "$behind" != "N/A" ]; then
        echo -e "  Status: ${RED}SIGNIFICANT DRIFT${NC}"
    fi
else
    echo -e "  ${RED}Remote not fetched. Run: git fetch opencode${NC}"
fi
echo ""

# --- OpenClaw ---
echo -e "${BLUE}OpenClaw${NC} (openclaw/openclaw main)"
echo -e "  Remote: https://github.com/openclaw/openclaw.git"

if git rev-parse openclaw/main &>/dev/null 2>&1; then
    openclaw_head=$(git rev-parse openclaw/main)
    openclaw_head_short="${openclaw_head:0:12}"
    openclaw_monitor_pin_short="${openclaw_monitor_pin:0:12}"
    openclaw_net_new=""

    merge_base=$(git merge-base HEAD openclaw/main 2>/dev/null || echo "")
    if [ -n "$merge_base" ]; then
        read -r ahead behind <<< "$(git rev-list --left-right --count HEAD...openclaw/main)"
        echo -e "  Ahead:  ${GREEN}$ahead${NC}    Behind: ${YELLOW}$behind${NC}"
    else
        echo -e "  Ahead: N/A    Behind: N/A (unrelated histories)"
    fi

    echo -e "  Last sync snapshot: ${CYAN}${openclaw_snapshot_pin:-unknown}${NC}"
    echo -e "  Current upstream HEAD: ${CYAN}${openclaw_head_short}${NC}"
    echo -e "  Security ports pending: ${YELLOW}$openclaw_todos${NC} (from delta-map TODOs)"

    if [ -n "$openclaw_monitor_pin" ] && git cat-file -e "${openclaw_monitor_pin}^{commit}" 2>/dev/null; then
        if git merge-base --is-ancestor "$openclaw_monitor_pin" openclaw/main 2>/dev/null; then
            openclaw_net_new="$(git rev-list --count "$openclaw_monitor_pin..openclaw/main" 2>/dev/null || true)"
        fi
    fi

    if [ "$openclaw_todos" -gt 0 ]; then
        if [[ "$openclaw_net_new" =~ ^[0-9]+$ ]]; then
            echo -e "  OpenClaw sentinel: ${RED}ACTIONABLE PORTS PENDING${NC} ($openclaw_todos TODO rows, $openclaw_net_new commits since pin ${openclaw_monitor_pin_short:-unknown})"
        else
            echo -e "  OpenClaw sentinel: ${RED}ACTIONABLE PORTS PENDING${NC} ($openclaw_todos TODO rows)"
        fi
        echo -e "  Status: ${YELLOW}DRIFT (security ports pending)${NC}"
    elif [[ "$openclaw_net_new" =~ ^[0-9]+$ ]] && [ "$openclaw_net_new" -gt 0 ]; then
        echo -e "  OpenClaw sentinel: ${YELLOW}NET-NEW ACTIONABLE DELTAS${NC} ($openclaw_net_new commits since pin ${openclaw_monitor_pin_short:-unknown}, 0 TODO rows)"
        echo -e "  Status: ${YELLOW}DRIFT (new upstream deltas need triage)${NC}"
    elif [[ "$openclaw_net_new" =~ ^[0-9]+$ ]]; then
        echo -e "  OpenClaw sentinel: ${GREEN}NO NEW ACTIONABLE PORTS${NC} (0 commits since pin ${openclaw_monitor_pin_short:-unknown}, 0 TODO rows)"
        echo -e "  Status: ${GREEN}UP TO DATE${NC}"
    elif [ -z "$openclaw_monitor_pin" ]; then
        echo -e "  OpenClaw sentinel: ${YELLOW}UNKNOWN${NC} (monitor pin missing; TODO rows: $openclaw_todos)"
        echo -e "  Status: ${YELLOW}UNABLE TO VERIFY${NC}"
    else
        echo -e "  OpenClaw sentinel: ${YELLOW}UNKNOWN${NC} (monitor pin ${openclaw_monitor_pin_short} not available locally; TODO rows: $openclaw_todos)"
        echo -e "  Status: ${YELLOW}UNABLE TO VERIFY${NC}"
    fi
else
    echo -e "  ${RED}Remote not fetched. Run: git fetch openclaw${NC}"
fi
echo ""

# --- pi-mono ---
echo -e "${BLUE}pi-mono${NC} (badlogic/pi-mono main)"
echo -e "  Remote: https://github.com/badlogic/pi-mono.git"

echo -e "  Installed: ${CYAN}@mariozechner/pi-coding-agent@${pimono_installed:-unknown}${NC}"

# Get latest pimono tag
latest_pimono_tag="$(resolve_latest_pimono_tag "pimono/main")"

latest_pimono_version="${latest_pimono_tag#v}"
echo -e "  Latest tag: ${CYAN}${latest_pimono_tag:-unknown}${NC}"

if [ -n "$pimono_installed" ] && [ -n "$latest_pimono_version" ]; then
    if [ "$pimono_installed" = "$latest_pimono_version" ]; then
        echo -e "  Status: ${GREEN}UP TO DATE${NC}"
    else
        echo -e "  Status: ${RED}BEHIND${NC} (installed $pimono_installed, latest $latest_pimono_version)"
    fi
else
    echo -e "  Status: ${YELLOW}UNABLE TO COMPARE${NC}"
fi
echo ""

# --- Summary ---
echo -e "${BOLD}---${NC}"
echo "Per-remote details: ./scripts/check-upstream.sh --remote <name> --verbose"
echo "Sync: ./scripts/sync-upstream.sh --remote <name> --preview"
