#!/bin/bash
# Install Zee as a systemd service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/zee.service"
TARGET="/etc/systemd/system/zee.service"
POLKIT_RULE="/etc/polkit-1/rules.d/90-zee.rules"
SERVICE_USER="${SUDO_USER:-${USER}}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo "$SERVICE_USER")"
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
if [[ -z "$SERVICE_HOME" ]]; then
  SERVICE_HOME="/home/$SERVICE_USER"
fi
DAEMON_HOST="${ZEE_HOST:-127.0.0.1}"
DAEMON_PORT="${ZEE_PORT:-3210}"
DAEMON_URL="http://${DAEMON_HOST}:${DAEMON_PORT}"

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --polkit         Allow non-root start/stop/restart/enable/disable for zee.service"
      echo "  --systemd-only   Write daemon.systemd_only=true to user config (default)"
      echo "  --no-systemd-only  Skip writing daemon.systemd_only"
      echo "  --no-polkit   Skip polkit rule installation (default)"
      echo ""
      exit 0
      ;;
  esac
done

# Check if running as root, otherwise re-run with sudo
if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        echo "Elevating with sudo..."
        exec sudo -E "$0" "$@"
    fi
    echo "This script must be run as root (use sudo)"
    exit 1
fi

INSTALL_POLKIT=false
SYSTEMD_ONLY=true
for arg in "$@"; do
  case $arg in
    --polkit) INSTALL_POLKIT=true ;;
    --no-polkit) INSTALL_POLKIT=false ;;
    --systemd-only) SYSTEMD_ONLY=true ;;
    --no-systemd-only) SYSTEMD_ONLY=false ;;
  esac
done

# Check if service file exists
if [[ ! -f "$SERVICE_FILE" ]]; then
    echo "Error: Service file not found at $SERVICE_FILE"
    exit 1
fi

# Copy service file template with substitutions
echo "Installing service file to $TARGET..."
echo "  User:  $SERVICE_USER"
echo "  Group: $SERVICE_GROUP"
echo "  Home:  $SERVICE_HOME"
echo "  Root:  $REPO_ROOT"
sed \
  -e "s|@USER@|$SERVICE_USER|g" \
  -e "s|@GROUP@|$SERVICE_GROUP|g" \
  -e "s|@HOME@|$SERVICE_HOME|g" \
  -e "s|@ROOT@|$REPO_ROOT|g" \
  "$SERVICE_FILE" > "$TARGET"

# Create environment file directory if needed
mkdir -p "$SERVICE_HOME/.config/zee"

# Create environment file template if it doesn't exist
ENV_FILE="$SERVICE_HOME/.config/zee/daemon.env"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Creating environment file template at $ENV_FILE..."
    cat > "$ENV_FILE" << 'EOF'
# Zee Daemon Environment Configuration
# Add your API keys here (uncomment and fill in)

# =============================================================================
# LLM Provider Keys (at least one required)
# =============================================================================

# Anthropic API key (recommended)
# ANTHROPIC_API_KEY=your-key-here

# OpenAI API key (optional)
# OPENAI_API_KEY=your-key-here

# Google/Gemini API key (embeddings)
# GEMINI_API_KEY=your-key-here

# =============================================================================
# Tool API Keys
# =============================================================================

# EXA API key (for web search)
# EXA_API_KEY=your-key-here

EOF
    chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
fi

if $SYSTEMD_ONLY; then
  CONFIG_FILE="$SERVICE_HOME/.config/zee/zee.json"
  echo "Setting daemon.systemd_only in $CONFIG_FILE..."
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import json
from pathlib import Path

path = Path("${CONFIG_FILE}")
data = {}
if path.exists():
    try:
        data = json.loads(path.read_text())
    except Exception:
        print("Warning: existing config is not valid JSON; skipping update.")
        raise SystemExit(0)
data.setdefault("daemon", {})
data["daemon"]["systemd_only"] = True
path.write_text(json.dumps(data, indent=2) + "\n")
PY
  else
    if [[ -f "$CONFIG_FILE" ]]; then
      echo "Warning: python3 not available; existing config not updated."
    else
      cat > "$CONFIG_FILE" << 'EOF'
{
  "daemon": {
    "systemd_only": true
  }
}
EOF
    fi
  fi
  chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_FILE" 2>/dev/null || true
fi

if $INSTALL_POLKIT; then
  echo "Installing polkit rule to allow non-root systemctl start/stop/restart/enable/disable..."
  cat > "$POLKIT_RULE" << EOF
polkit.addRule(function(action, subject) {
  if (subject.user != "${SERVICE_USER}") return;

  var unit = action.lookup("unit");
  var verb = action.lookup("verb");

  if (action.id == "org.freedesktop.systemd1.manage-units") {
    if (unit == "zee.service" &&
        (verb == "start" || verb == "stop" || verb == "restart" || verb == "try-restart" || verb == "reload-or-restart")) {
      return polkit.Result.YES;
    }
  }

  if (action.id == "org.freedesktop.systemd1.manage-unit-files") {
    if (unit == "zee.service" &&
        (verb == "enable" || verb == "disable" || verb == "reenable")) {
      return polkit.Result.YES;
    }
  }
});
EOF
  chmod 644 "$POLKIT_RULE"
  echo "Polkit rule installed at $POLKIT_RULE"
fi

# Create state directories
echo "Creating state directories..."
mkdir -p "$SERVICE_HOME/.local/state/zee"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_HOME/.local/state/zee"

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

echo ""
if systemctl is-active --quiet zee; then
  echo "Service status: active"
  if command -v curl >/dev/null 2>&1; then
    health=$(curl -sf "$DAEMON_URL/global/health" || true)
    if echo "$health" | grep -q '"healthy":true'; then
      echo "Daemon health: OK"
    else
      echo "Daemon health: Unhealthy or not responding at $DAEMON_URL"
    fi
  else
    echo "Daemon health: Skipped (curl not found)"
  fi
else
  echo "Service status: inactive (start it to enable health checks)"
fi

echo ""
echo "Installation complete!"
echo ""
echo "The daemon starts:"
echo "  - zee (AI agent engine)"
echo "  - zee gateway (WhatsApp messaging)"
echo ""
echo "Next steps:"
echo "  1. Edit your API keys in: $ENV_FILE"
echo "  2. Build zee binary:     cd $REPO_ROOT/packages/zee && bun run build"
echo "     Verify binary:        cd $REPO_ROOT && ./script/verify-binary.sh"
echo "  3. Ensure zee gateway is set up: $REPO_ROOT/packages/personas/zee"
echo "  5. Start the service:     sudo systemctl start zee"
echo "  6. Check status:          sudo systemctl status zee"
echo "  7. View logs:             journalctl -u zee -f"
echo ""
echo "Or use the CLI commands:"
echo "  zee daemon           # Start in foreground (embedded gateway enabled)"
echo "  zee daemon-status    # Check if running"
echo "  zee daemon-stop      # Stop the daemon"
