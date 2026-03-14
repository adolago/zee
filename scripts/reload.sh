#!/usr/bin/env bash
#
# zee reload script
# Usage: ./scripts/reload.sh [OPTIONS]
#
# This script:
# 1. Stops daemon via systemctl --user
# 2. Optionally cleans build artifacts (--clean or --fresh)
# 3. Rebuilds from source (unless --no-build)
# 4. Links binary directly (~/.bun/bin/zee -> dist/@adolago/zee-linux-x64/bin/zee)
# 5. Starts daemon via systemctl --user (unless --no-daemon)
# 6. Verifies everything is working
#
# The runtime is managed by a systemd user service (zee.service).
# Never use pkill/kill -9 to manage the daemon -- use systemctl.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$REPO_ROOT/packages/zee"
BINARY_SRC="$PKG_DIR/dist/@adolago/zee-linux-x64/bin/zee"
BINARY_LINK="$HOME/.bun/bin/zee"
DAEMON_PORT="${ZEE_PORT:-3210}"
DAEMON_HOST="${ZEE_HOST:-127.0.0.1}"
DAEMON_URL="${ZEE_URL:-http://$DAEMON_HOST:$DAEMON_PORT}"
SYSTEMD_DAEMON_UNIT="zee.service"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[reload]${NC} $*"; }
ok() { echo -e "${GREEN}[  OK  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ WARN ]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*"; }

resolve_agent_bin() {
  command -v zee 2>/dev/null || true
}

# Parse args
NO_BUILD=false
NO_DAEMON=false
STATUS_ONLY=false
CLEAN_BUILD=false
FRESH_BUILD=false

for arg in "$@"; do
  case $arg in
    --no-build) NO_BUILD=true ;;
    --no-daemon) NO_DAEMON=true ;;
    --status) STATUS_ONLY=true ;;
    --clean) CLEAN_BUILD=true ;;
    --fresh) FRESH_BUILD=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --no-build   Skip rebuilding (just restart)"
      echo "  --no-daemon  Don't start daemon after reload"
      echo "  --status     Show status and diagnostics only"
      echo "  --clean      Clean build artifacts before rebuilding"
      echo "  --fresh      Full fresh build: clean + clear turbo cache + reinstall deps"
      echo ""
      echo "Examples:"
      echo "  $0                  # Normal rebuild and restart"
      echo "  $0 --status         # Just show current status"
      echo "  $0 --clean          # Clean dist/, rebuild, restart"
      echo "  $0 --fresh          # Nuclear option: purge everything, rebuild from scratch"
      echo "  $0 --no-daemon      # Rebuild but don't start daemon"
      echo "  $0 --no-build       # Just restart daemon (config changes)"
      exit 0
      ;;
  esac
done

# Clean function
do_clean() {
  log "Cleaning build artifacts..."

  # Clean dist directory
  if [[ -d "$PKG_DIR/dist" ]]; then
    rm -rf "$PKG_DIR/dist"
    ok "Removed $PKG_DIR/dist"
  else
    warn "No dist directory to clean"
  fi
}

# Fresh/full clean function
do_fresh_clean() {
  log "Performing FULL fresh clean..."

  # Clean dist
  if [[ -d "$PKG_DIR/dist" ]]; then
    rm -rf "$PKG_DIR/dist"
    ok "Removed dist/"
  fi

  # Clean turbo cache
  if [[ -d "$REPO_ROOT/.turbo" ]]; then
    rm -rf "$REPO_ROOT/.turbo"
    ok "Removed .turbo/ cache"
  fi

  # Clean node_modules/.cache
  if [[ -d "$REPO_ROOT/node_modules/.cache" ]]; then
    rm -rf "$REPO_ROOT/node_modules/.cache"
    ok "Removed node_modules/.cache"
  fi

  # Clean bun cache for the package
  if [[ -d "$PKG_DIR/node_modules/.cache" ]]; then
    rm -rf "$PKG_DIR/node_modules/.cache"
    ok "Removed package node_modules/.cache"
  fi

  # Optionally reinstall deps
  log "Reinstalling dependencies..."
  cd "$REPO_ROOT"
  if bun install 2>&1 | tail -3; then
    ok "Dependencies reinstalled"
  else
    warn "bun install had warnings (may be ok)"
  fi
}

# Status/diagnostics function
show_status() {
  echo ""
  echo "==============================================================="
  echo "                        ZEE STATUS"
  echo "==============================================================="
  echo ""

  # Systemd service status
  echo "Systemd services:"

  echo "  $SYSTEMD_DAEMON_UNIT:"
  if systemctl --user is-active "$SYSTEMD_DAEMON_UNIT" >/dev/null 2>&1; then
    local svc_pid=$(systemctl --user show -p MainPID --value "$SYSTEMD_DAEMON_UNIT" 2>/dev/null)
    local svc_uptime=$(systemctl --user show -p ActiveEnterTimestamp --value "$SYSTEMD_DAEMON_UNIT" 2>/dev/null)
    ok "Active (PID: $svc_pid, since: $svc_uptime)"
  else
    local svc_state=$(systemctl --user is-active "$SYSTEMD_DAEMON_UNIT" 2>/dev/null || echo "unknown")
    warn "Not active ($svc_state)"
  fi
  if systemctl --user is-enabled "$SYSTEMD_DAEMON_UNIT" >/dev/null 2>&1; then
    ok "Enabled (starts on login)"
  else
    warn "Not enabled"
  fi

  echo ""

  # Binary info
  local path_bin=$(resolve_agent_bin)
  echo "Binary (PATH): ${path_bin:-<not found>}"
  if [[ -n "$path_bin" && -f "$path_bin" ]]; then
    local mod_time=$(stat -c "%Y" "$path_bin" 2>/dev/null || stat -f "%m" "$path_bin" 2>/dev/null)
    local mod_date=$(date -d "@$mod_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r "$mod_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
    ok "Exists (modified: $mod_date)"
  else
    err "Not found"
  fi
  echo ""
  echo "Bun link: $BINARY_LINK"
  if [[ -L "$BINARY_LINK" || -f "$BINARY_LINK" ]]; then
    local link_target=$(readlink -f "$BINARY_LINK" 2>/dev/null || true)
    ok "Exists ${link_target:+(-> $link_target)}"
  else
    err "Not found (run: cd packages/zee && bun run build)"
  fi
  echo ""
  echo "Built binary: $BINARY_SRC"
  if [[ -f "$BINARY_SRC" ]]; then
    local mod_time=$(stat -c "%Y" "$BINARY_SRC" 2>/dev/null || stat -f "%m" "$BINARY_SRC" 2>/dev/null)
    local mod_date=$(date -d "@$mod_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r "$mod_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
    ok "Exists (modified: $mod_date)"
  else
    err "Not found"
  fi
  echo ""

  # Daemon health
  echo "Daemon API: $DAEMON_URL"
  local health=$(curl -sf "$DAEMON_URL/global/health" 2>/dev/null || echo "")
  if [[ -n "$health" ]]; then
    local version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    local channel=$(echo "$health" | grep -o '"channel":"[^"]*"' | cut -d'"' -f4)
    local mode=$(echo "$health" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
    local suffix=""
    if [[ -n "$channel" || -n "$mode" ]]; then
      suffix=" (${channel}/${mode})"
    fi
    ok "Healthy (version: $version$suffix)"
  else
    warn "Not responding"
  fi
  echo ""

  # Tool directories
  echo "Tool directories:"
  for dir in "$HOME/.config/zee/tool" "$REPO_ROOT/.zee/tool"; do
    if [[ -d "$dir" ]]; then
      local count=$(ls -1 "$dir"/*.ts 2>/dev/null | wc -l || echo 0)
      ok "$dir ($count tools)"
      ls -1 "$dir"/*.ts 2>/dev/null | while read -r f; do
        echo "      - $(basename "$f")"
      done
    else
      echo "  $dir (not found)"
    fi
  done
  echo ""

  # Source vs binary timestamps
  echo "Source timestamps:"
  local src_files=(
    "$PKG_DIR/src/provider/transform.ts"
    "$PKG_DIR/src/provider/provider.ts"
    "$PKG_DIR/src/server/server.ts"
    "$PKG_DIR/src/session/llm.ts"
  )
  local binary_path="$BINARY_SRC"
  if [[ ! -f "$binary_path" && -n "$path_bin" && -f "$path_bin" ]]; then
    binary_path="$path_bin"
  fi
  if [[ ! -f "$binary_path" ]]; then
    warn "No binary found for timestamp comparison"
  else
    local binary_time=$(stat -c "%Y" "$binary_path" 2>/dev/null || echo 0)
    for src in "${src_files[@]}"; do
      if [[ -f "$src" ]]; then
        local src_time=$(stat -c "%Y" "$src" 2>/dev/null || echo 0)
        local src_date=$(date -d "@$src_time" "+%H:%M:%S" 2>/dev/null || date -r "$src_time" "+%H:%M:%S" 2>/dev/null)
        local name=$(basename "$src")
        if [[ $src_time -gt $binary_time ]]; then
          warn "$name ($src_date) - NEWER than binary, rebuild needed!"
        else
          ok "$name ($src_date)"
        fi
      fi
    done
  fi
  echo ""

  # Quick reference
  echo "Quick commands:"
  echo "  systemctl --user restart zee           # restart daemon"
  echo "  systemctl --user stop zee              # stop daemon"
  echo "  journalctl --user -u zee -f            # tail daemon logs"
  echo "  ./scripts/reload.sh                    # rebuild + restart"
  echo ""
  echo "==============================================================="
}

if $STATUS_ONLY; then
  show_status
  exit 0
fi

echo ""
echo "==============================================================="
echo "                        ZEE RELOAD"
echo "==============================================================="
echo ""

# Step 1: Stop daemon via systemd
log "Stopping daemon via systemctl..."
if systemctl --user is-active "$SYSTEMD_DAEMON_UNIT" >/dev/null 2>&1; then
  systemctl --user stop "$SYSTEMD_DAEMON_UNIT"
  ok "Main daemon stopped"
else
  warn "Main daemon was not running"
fi

# Wait for graceful shutdown
sleep 2

# Verify port is free
port_pid=$(lsof -ti:$DAEMON_PORT 2>/dev/null || true)
if [[ -n "$port_pid" ]]; then
  warn "Port $DAEMON_PORT still in use (PID: $port_pid), waiting..."
  sleep 3
  port_pid=$(lsof -ti:$DAEMON_PORT 2>/dev/null || true)
  if [[ -n "$port_pid" ]]; then
    err "Port $DAEMON_PORT still occupied after wait. Killing PID $port_pid."
    kill -9 "$port_pid" 2>/dev/null || true
    sleep 1
  fi
fi

# Step 2: Clean if requested
if $FRESH_BUILD; then
  do_fresh_clean
elif $CLEAN_BUILD; then
  do_clean
fi

# Step 3: Rebuild
if ! $NO_BUILD; then
  log "Rebuilding zee..."
  cd "$PKG_DIR"
  if bun run build 2>&1 | tail -10; then
    ok "Build complete"
  else
    err "Build failed!"
    exit 1
  fi
else
  warn "Skipping build (--no-build)"
fi

# Step 4: Link binary (direct symlink to built binary)
log "Linking binary..."
if [[ -f "$BINARY_SRC" ]]; then
  # Ensure binary is fully written before linking (race condition fix)
  sync
  sleep 1
  ln -sf "$BINARY_SRC" "$BINARY_LINK"
  # Verify the link resolves correctly
  if [[ ! -x "$BINARY_LINK" ]]; then
    err "Symlink created but binary not executable"
    exit 1
  fi
  # Quick sanity check that binary runs
  if ! "$BINARY_LINK" --version >/dev/null 2>&1; then
    err "Binary linked but fails to execute"
    exit 1
  fi
  ok "Linked $BINARY_LINK -> $BINARY_SRC"
else
  err "Binary not found at $BINARY_SRC"
  exit 1
fi

# Step 5: Start daemon via systemd
if ! $NO_DAEMON; then
  log "Starting daemon via systemctl..."
  systemctl --user daemon-reload
  systemctl --user start "$SYSTEMD_DAEMON_UNIT"
  sleep 3

  # Verify main daemon started
  if systemctl --user is-active "$SYSTEMD_DAEMON_UNIT" >/dev/null 2>&1; then
    local_pid=$(systemctl --user show -p MainPID --value "$SYSTEMD_DAEMON_UNIT" 2>/dev/null)
    # Check health endpoint
    health=""
    for i in {1..5}; do
      health=$(curl -sf "$DAEMON_URL/global/health" 2>/dev/null || echo "")
      if [[ -n "$health" ]]; then
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        channel=$(echo "$health" | grep -o '"channel":"[^"]*"' | cut -d'"' -f4)
        mode=$(echo "$health" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
        suffix=""
        if [[ -n "$channel" || -n "$mode" ]]; then
          suffix=" (${channel}/${mode})"
        fi
        ok "Main daemon started (PID: $local_pid, version: $version$suffix)"
        break
      fi
      sleep 1
    done
    if [[ -z "$health" ]]; then
      warn "Main daemon started but health check failed (may still be initializing)"
    fi

  else
    err "Main daemon failed to start! Check logs:"
    echo ""
    journalctl --user -u "$SYSTEMD_DAEMON_UNIT" --since "1 min ago" --no-pager | tail -20
    exit 1
  fi
else
  warn "Skipping daemon start (--no-daemon)"
fi

# Step 6: Verify all providers and models (embedding, reranking, LLMs)
log "Verifying providers and models..."
verify_providers() {
  local all_ok=true
  local critical_ok=true

  echo ""
  echo "Provider Health Check:"
  echo "----------------------"

  # Check Qdrant connectivity
  local qdrant_url="${QDRANT_URL:-http://localhost:6333}"
  if curl -sf "$qdrant_url/healthz" >/dev/null 2>&1; then
    ok "Qdrant:     $qdrant_url"
  else
    warn "Qdrant:     NOT AVAILABLE ($qdrant_url)"
    all_ok=false
    critical_ok=false
  fi

  # Check embedding provider (Google-only; auth store)
  local auth_data="${XDG_DATA_HOME:-$HOME/.local/share}/zee/auth.json"
  local auth_state="${XDG_STATE_HOME:-$HOME/.local/state}/zee/auth.json"
  local auth_path=""
  if [[ -f "$auth_data" ]]; then
    auth_path="$auth_data"
  elif [[ -f "$auth_state" ]]; then
    auth_path="$auth_state"
  fi

  local google_auth_type=""
  local google_key="${GOOGLE_API_KEY:-}"
  if [[ -n "$auth_path" ]]; then
    google_auth_type="$(jq -r '.google.type // empty' "$auth_path" 2>/dev/null || true)"
    if [[ -z "$google_key" ]]; then
      google_key="$(jq -r '.google.key // empty' "$auth_path" 2>/dev/null || true)"
    fi
  fi
  if [[ -n "$google_key" ]]; then
    # Test Google embedding API endpoint (lightweight check)
    if curl -sf "https://generativelanguage.googleapis.com/v1/models?key=$google_key" >/dev/null 2>&1; then
      ok "Embedding:  Google (auth store key valid)"
    else
      warn "Embedding:  Google (auth store key invalid or expired)"
      all_ok=false
      critical_ok=false
    fi
  elif [[ "$google_auth_type" == "oauth" ]]; then
    warn "Embedding:  Google OAuth configured, but API key missing (embeddings need api key)"
    all_ok=false
    critical_ok=false
  else
    warn "Embedding:  NOT CONFIGURED (run: zee auth login google)"
    all_ok=false
    critical_ok=false
  fi

  # Check reranker (Voyage)
  local voyage_key="${VOYAGE_API_KEY:-}"
  if [[ -z "$voyage_key" && -n "$auth_path" ]]; then
    voyage_key="$(jq -r '.voyage.key // empty' "$auth_path" 2>/dev/null || true)"
  fi
  if [[ -n "$voyage_key" ]]; then
    # Light test - just verify API endpoint reachable
    local voyage_test=$(curl -sf -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $voyage_key" "https://api.voyageai.com/v1/models" 2>&1)
    if [[ "$voyage_test" == "200" || "$voyage_test" == "401" ]]; then
      ok "Reranker:   Voyage (reachable)"
    else
      warn "Reranker:   Voyage (unreachable: HTTP $voyage_test)"
    fi
  else
    echo "  Reranker:   Not configured (optional)"
  fi

  # Check LLM providers
  echo ""
  echo "LLM Providers:"

  # Anthropic (env key, auth-store key, or oauth auth)
  local anthropic_auth_type=""
  local anthropic_key="${ANTHROPIC_API_KEY:-}"
  if [[ -n "$auth_path" ]]; then
    anthropic_auth_type="$(jq -r '.anthropic.type // empty' "$auth_path" 2>/dev/null || true)"
    if [[ -z "$anthropic_key" ]]; then
      anthropic_key="$(jq -r '.anthropic.key // empty' "$auth_path" 2>/dev/null || true)"
    fi
  fi
  if [[ -n "$anthropic_key" ]]; then
    local anthropic_test=$(curl -sf -o /dev/null -w "%{http_code}" -H "x-api-key: $anthropic_key" "https://api.anthropic.com/v1/messages" -X POST -H "content-type: application/json" -d '{}' 2>&1)
    if [[ "$anthropic_test" == "400" || "$anthropic_test" == "401" ]]; then
      ok "  Anthropic:  Reachable"
    else
      warn "  Anthropic:  Unreachable (HTTP $anthropic_test)"
    fi
  elif [[ "$anthropic_auth_type" == "oauth" ]]; then
    ok "  Anthropic:  Configured via OAuth (runtime-managed token)"
  else
    echo "    Anthropic:  Not configured"
  fi

  # OpenAI (env key, auth-store key, or oauth auth)
  local openai_auth_type=""
  local openai_key="${OPENAI_API_KEY:-}"
  if [[ -n "$auth_path" ]]; then
    openai_auth_type="$(jq -r '.openai.type // empty' "$auth_path" 2>/dev/null || true)"
    if [[ -z "$openai_key" ]]; then
      openai_key="$(jq -r '.openai.key // empty' "$auth_path" 2>/dev/null || true)"
    fi
  fi
  if [[ -n "$openai_key" ]]; then
    local openai_test=$(curl -sf -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $openai_key" "https://api.openai.com/v1/models" 2>&1)
    if [[ "$openai_test" == "200" ]]; then
      ok "  OpenAI:     Reachable"
    else
      warn "  OpenAI:     Unreachable (HTTP $openai_test)"
    fi
  elif [[ "$openai_auth_type" == "oauth" ]]; then
    ok "  OpenAI:     Configured via OAuth (runtime-managed token)"
  else
    echo "    OpenAI:     Not configured"
  fi

  # Ollama (local)
  local ollama_url="${OLLAMA_HOST:-http://localhost:11434}"
  local ollama_test=$(curl -sf "$ollama_url/api/tags" 2>&1)
  if [[ $? -eq 0 ]]; then
    local model_count=$(echo "$ollama_test" | grep -o '"name"' | wc -l)
    ok "  Ollama:     $model_count model(s) available"
  else
    echo "    Ollama:     Not running (optional)"
  fi

  echo ""

  if ! $critical_ok; then
    err "Critical dependencies missing (Qdrant and embedding auth are required)"
    return 1
  fi

  if $all_ok; then
    ok "All critical providers verified"
  else
    warn "Some providers unavailable (memory features may be limited)"
  fi
}

if ! verify_providers; then
  err "Reload aborted: required dependencies are unavailable."
  if ! $NO_DAEMON; then
    warn "Stopping daemon because startup requirements were not met..."
    systemctl --user stop "$SYSTEMD_DAEMON_UNIT" >/dev/null 2>&1 || true
  fi
  exit 1
fi

echo ""
echo "==============================================================="
echo "                      RELOAD COMPLETE"
echo "==============================================================="
show_status
