#!/usr/bin/env bash
# Home Assistant CLI wrapper
# Usage: ha.sh <command> [args...]

set -euo pipefail

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
LEGACY_CONFIG_FILE="${HA_CONFIG:-$XDG_CONFIG_HOME/home-assistant/config.json}"

read_legacy_config() {
  local cfg="$1"
  [[ -f "$cfg" ]] || return 0
  local url token
  url="$(jq -r '.url // empty' "$cfg" 2>/dev/null || true)"
  token="$(jq -r '.token // empty' "$cfg" 2>/dev/null || true)"
  [[ -n "$url" ]] && echo "server=$url"
  [[ -n "$token" ]] && echo "token=$token"
}

read_zee_skill_config() {
  local cfg="$1"
  [[ -f "$cfg" ]] || return 0

  # Prefer JSONC parser from Bun for zee.jsonc files.
  if command -v bun >/dev/null 2>&1; then
    bun --silent -e '
      import { readFileSync } from "node:fs";
      import { parse } from "jsonc-parser";

      const file = process.argv[1];
      const raw = readFileSync(file, "utf8");
      const data = parse(raw) ?? {};
      const entry = data?.skills?.entries?.["home-assistant"] ?? {};
      const env = entry?.env ?? {};
      const server = env.HASS_SERVER ?? env.HA_URL ?? "";
      const token = env.HASS_TOKEN ?? env.HA_TOKEN ?? entry.apiKey ?? "";
      if (server) console.log("server=" + server);
      if (token) console.log("token=" + token);
    ' "$cfg" 2>/dev/null || true
    return 0
  fi

  # Fallback: parse plain JSON files with jq.
  local server token
  server="$(jq -r '.skills.entries["home-assistant"].env.HASS_SERVER // .skills.entries["home-assistant"].env.HA_URL // empty' "$cfg" 2>/dev/null || true)"
  token="$(jq -r '.skills.entries["home-assistant"].env.HASS_TOKEN // .skills.entries["home-assistant"].env.HA_TOKEN // .skills.entries["home-assistant"].apiKey // empty' "$cfg" 2>/dev/null || true)"
  [[ -n "$server" ]] && echo "server=$server"
  [[ -n "$token" ]] && echo "token=$token"
}

declare -a ZEE_CONFIG_CANDIDATES=()

add_cfg_candidate() {
  local cfg="$1"
  [[ -n "$cfg" ]] || return 0
  ZEE_CONFIG_CANDIDATES+=("$cfg")
}

# Rosetta-style source resolution:
# env vars > zee skill config (daemon/user) > legacy HA config.
add_cfg_candidate "${ZEE_CONFIG:-}"
if [[ -n "${ZEE_CONFIG_DIR:-}" ]]; then
  add_cfg_candidate "${ZEE_CONFIG_DIR}/zee.jsonc"
  add_cfg_candidate "${ZEE_CONFIG_DIR}/zee.json"
fi
add_cfg_candidate "$XDG_CONFIG_HOME/zee-daemon/zee.jsonc"
add_cfg_candidate "$XDG_CONFIG_HOME/zee-daemon/zee.json"
add_cfg_candidate "$XDG_CONFIG_HOME/zee/zee.jsonc"
add_cfg_candidate "$XDG_CONFIG_HOME/zee/zee.json"

# Accept both legacy (HA_*) and hass-cli-compatible (HASS_*) env vars first.
HASS_SERVER="${HASS_SERVER:-${HA_URL:-}}"
HASS_TOKEN="${HASS_TOKEN:-${HA_TOKEN:-}}"

for cfg in "${ZEE_CONFIG_CANDIDATES[@]}"; do
  [[ -f "$cfg" ]] || continue
  while IFS= read -r kv; do
    key="${kv%%=*}"
    value="${kv#*=}"
    case "$key" in
      server)
        if [[ -z "$HASS_SERVER" && -n "$value" ]]; then
          HASS_SERVER="$value"
        fi
        ;;
      token)
        if [[ -z "$HASS_TOKEN" && -n "$value" ]]; then
          HASS_TOKEN="$value"
        fi
        ;;
    esac
  done < <(read_zee_skill_config "$cfg")
done

# Backward compatibility fallback for users not migrated to Zee skill config.
if [[ -z "$HASS_SERVER" || -z "$HASS_TOKEN" ]]; then
  while IFS= read -r kv; do
    key="${kv%%=*}"
    value="${kv#*=}"
    case "$key" in
      server)
        if [[ -z "$HASS_SERVER" && -n "$value" ]]; then
          HASS_SERVER="$value"
        fi
        ;;
      token)
        if [[ -z "$HASS_TOKEN" && -n "$value" ]]; then
          HASS_TOKEN="$value"
        fi
        ;;
    esac
  done < <(read_legacy_config "$LEGACY_CONFIG_FILE")
fi

# Keep legacy names available for compatibility.
HA_URL="${HA_URL:-$HASS_SERVER}"
HA_TOKEN="${HA_TOKEN:-$HASS_TOKEN}"

: "${HASS_SERVER:?Set HASS_SERVER/HA_URL or run 'zee auth login home-assistant'}"
: "${HASS_TOKEN:?Set HASS_TOKEN/HA_TOKEN or run 'zee auth login home-assistant'}"

cmd="${1:-help}"
shift || true

api() {
  curl -s -H "Authorization: Bearer $HASS_TOKEN" -H "Content-Type: application/json" "$@"
}

case "$cmd" in
  state|get)
    # Get entity state: ha.sh state light.living_room
    entity="${1:?Usage: ha.sh state <entity_id>}"
    api "$HASS_SERVER/api/states/$entity" | jq -r '.state // "unknown"'
    ;;
    
  states)
    # Get full entity state with attributes
    entity="${1:?Usage: ha.sh states <entity_id>}"
    api "$HASS_SERVER/api/states/$entity" | jq
    ;;

  on|turn_on)
    # Turn on entity: ha.sh on light.living_room [brightness]
    entity="${1:?Usage: ha.sh on <entity_id> [brightness]}"
    domain="${entity%%.*}"
    brightness="${2:-}"
    if [[ -n "$brightness" ]]; then
      api -X POST "$HASS_SERVER/api/services/$domain/turn_on" \
        -d "{\"entity_id\": \"$entity\", \"brightness\": $brightness}"
    else
      api -X POST "$HASS_SERVER/api/services/$domain/turn_on" \
        -d "{\"entity_id\": \"$entity\"}"
    fi
    echo "✓ $entity turned on"
    ;;

  off|turn_off)
    # Turn off entity: ha.sh off light.living_room
    entity="${1:?Usage: ha.sh off <entity_id>}"
    domain="${entity%%.*}"
    api -X POST "$HASS_SERVER/api/services/$domain/turn_off" \
      -d "{\"entity_id\": \"$entity\"}" >/dev/null
    echo "✓ $entity turned off"
    ;;

  toggle)
    # Toggle entity: ha.sh toggle switch.fan
    entity="${1:?Usage: ha.sh toggle <entity_id>}"
    domain="${entity%%.*}"
    api -X POST "$HASS_SERVER/api/services/$domain/toggle" \
      -d "{\"entity_id\": \"$entity\"}" >/dev/null
    echo "✓ $entity toggled"
    ;;

  scene)
    # Activate scene: ha.sh scene movie_night
    scene="${1:?Usage: ha.sh scene <scene_name>}"
    [[ "$scene" == scene.* ]] || scene="scene.$scene"
    api -X POST "$HASS_SERVER/api/services/scene/turn_on" \
      -d "{\"entity_id\": \"$scene\"}" >/dev/null
    echo "✓ Scene $scene activated"
    ;;

  script)
    # Run script: ha.sh script goodnight
    script="${1:?Usage: ha.sh script <script_name>}"
    [[ "$script" == script.* ]] || script="script.$script"
    api -X POST "$HASS_SERVER/api/services/script/turn_on" \
      -d "{\"entity_id\": \"$script\"}" >/dev/null
    echo "✓ Script $script executed"
    ;;

  automation|trigger)
    # Trigger automation: ha.sh automation motion_lights
    auto="${1:?Usage: ha.sh automation <automation_name>}"
    [[ "$auto" == automation.* ]] || auto="automation.$auto"
    api -X POST "$HASS_SERVER/api/services/automation/trigger" \
      -d "{\"entity_id\": \"$auto\"}" >/dev/null
    echo "✓ Automation $auto triggered"
    ;;

  climate|temp)
    # Set temperature: ha.sh climate climate.thermostat 22
    entity="${1:?Usage: ha.sh climate <entity_id> <temperature>}"
    temp="${2:?Usage: ha.sh climate <entity_id> <temperature>}"
    api -X POST "$HASS_SERVER/api/services/climate/set_temperature" \
      -d "{\"entity_id\": \"$entity\", \"temperature\": $temp}" >/dev/null
    echo "✓ $entity set to ${temp}°"
    ;;

  list)
    # List entities by domain: ha.sh list lights / ha.sh list all
    filter="${1:-all}"
    if [[ "$filter" == "all" ]]; then
      api "$HASS_SERVER/api/states" | jq -r '.[].entity_id' | sort
    else
      # Normalize: "lights" -> "light", "switches" -> "switch"
      filter="${filter%s}"
      api "$HASS_SERVER/api/states" | jq -r --arg d "$filter" \
        '.[] | select(.entity_id | startswith($d + ".")) | .entity_id' | sort
    fi
    ;;

  search)
    # Search entities: ha.sh search kitchen
    pattern="${1:?Usage: ha.sh search <pattern>}"
    api "$HASS_SERVER/api/states" | jq -r --arg p "$pattern" \
      '.[] | select(.entity_id | test($p; "i")) | "\(.entity_id): \(.state)"'
    ;;

  call)
    # Call any service: ha.sh call light turn_on '{"entity_id":"light.room","brightness":200}'
    domain="${1:?Usage: ha.sh call <domain> <service> [json_data]}"
    service="${2:?Usage: ha.sh call <domain> <service> [json_data]}"
    data="${3:-{}}"
    api -X POST "$HASS_SERVER/api/services/$domain/$service" -d "$data"
    ;;

  info)
    # Get HA instance info
    api "$HASS_SERVER/api/" | jq
    ;;

  help|*)
    cat <<EOF
Home Assistant CLI

Usage: ha.sh <command> [args...]

Commands:
  state <entity>              Get entity state
  states <entity>             Get full entity state with attributes
  on <entity> [brightness]    Turn on (optional brightness 0-255)
  off <entity>                Turn off
  toggle <entity>             Toggle on/off
  scene <name>                Activate scene
  script <name>               Run script
  automation <name>           Trigger automation
  climate <entity> <temp>     Set temperature
  list [domain]               List entities (lights, switches, all)
  search <pattern>            Search entities by name
  call <domain> <svc> [json]  Call any service
  info                        Get HA instance info

Environment:
  HASS_SERVER  Home Assistant URL (required)
  HASS_TOKEN   Long-lived access token (required)
  HA_URL       Legacy alias for HASS_SERVER
  HA_TOKEN     Legacy alias for HASS_TOKEN
  HA_CONFIG    Legacy config file path override (default: ~/.config/home-assistant/config.json)

Examples:
  ha.sh on light.living_room 200
  ha.sh scene movie_night
  ha.sh list lights
  ha.sh search kitchen
EOF
    ;;
esac
