#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ZEE_BIN="${ZEE_BIN:-$HOME/.bun/bin/zee}"
ZEE_BIN_PATH="${ZEE_BIN_PATH:-$REPO_ROOT/packages/zee-core/dist/@zee/core-linux-x64/bin/zee}"
REPORT_DIR="${REPORT_DIR:-/tmp/zee-beta}"
REPORT_FILE="$REPORT_DIR/report.txt"
BUG_REPORT_PATH="$REPORT_DIR/bug-report.tar.gz"

mkdir -p "$REPORT_DIR"
: > "$REPORT_FILE"

log() {
  printf '%s\n' "$*" | tee -a "$REPORT_FILE"
}

log "Zee beta readiness"
log "date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
log "zee_bin: $ZEE_BIN"
log "zee_bin_path: $ZEE_BIN_PATH"
log "report_dir: $REPORT_DIR"
log ""

if [[ ! -x "$ZEE_BIN" ]]; then
  log "ERROR: zee binary not found or not executable: $ZEE_BIN"
  exit 1
fi
if [[ ! -x "$ZEE_BIN_PATH" ]]; then
  log "ERROR: zee native binary not found or not executable: $ZEE_BIN_PATH"
  exit 1
fi

log "# Version"
ZEE_BIN_PATH="$ZEE_BIN_PATH" AGENT_CORE_BIN_PATH="$ZEE_BIN_PATH" "$ZEE_BIN" --version | tee -a "$REPORT_FILE"
log ""

log "# Config & repo checks"
log "config.json: $HOME/.config/zee/config.json"
log "zee.jsonc: $HOME/.config/zee/zee.jsonc"
log "skills root: $HOME/.config/zee/skills -> $(readlink -f "$HOME/.config/zee/skills" 2>/dev/null || true)"
log "personas root: $REPO_ROOT/packages/personas"
log ""

log "# Diagnostic check (runtime + config only)"
ZEE_BIN_PATH="$ZEE_BIN_PATH" AGENT_CORE_BIN_PATH="$ZEE_BIN_PATH" "$ZEE_BIN" check --category runtime --category config --minimal --timeout 5000 | tee -a "$REPORT_FILE"
log ""

log "# Bug report (non-interactive, diagnostics skipped)"
ZEE_BIN_PATH="$ZEE_BIN_PATH" AGENT_CORE_BIN_PATH="$ZEE_BIN_PATH" "$ZEE_BIN" bug-report --skip-diagnostics --non-interactive --log-lines 5 -o "$BUG_REPORT_PATH" | tee -a "$REPORT_FILE"
log ""

log "# Done"
log "report: $REPORT_FILE"
log "bug_report: $BUG_REPORT_PATH"
