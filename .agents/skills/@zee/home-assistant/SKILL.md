---
name: home-assistant
description: Control Home Assistant for smart home automation - lights, switches, sensors, climate, covers, scenes, and automations via CLI or REST API.
version: 1.1.0
author: dbhurley
tags: [home, automation, iot, smart-home]
source: clawhub
homepage: https://www.home-assistant.io/
metadata: {"clawhub":{"id":"dbhurley/homeassistant","requires":{"bins":["curl"],"env":["HASS_TOKEN"]},"primaryEnv":"HASS_TOKEN"}}
---

# Home Assistant - Smart Home Control

Control Home Assistant entities and automations.

## Environment Variables

- `HASS_SERVER` - Home Assistant URL (e.g., `http://192.168.1.100:8123`)
- `HASS_TOKEN` - Long-lived access token (create in HA -> Profile -> Long-Lived Access Tokens)

## hass-cli (preferred)

### Prerequisites

```bash
pip install homeassistant-cli

# Configure (or use env vars HASS_SERVER / HASS_TOKEN)
hass-cli config set --server https://your-ha-instance:8123 --token YOUR_LONG_LIVED_TOKEN
```

### Entity State

```bash
# List all entities
hass-cli entity list

# Get entity state
hass-cli entity get light.living_room

# Filter by domain
hass-cli entity list --domain light
hass-cli entity list --domain switch
hass-cli entity list --domain sensor
```

### Control Entities

```bash
# Turn on/off
hass-cli service call light.turn_on --arguments entity_id=light.living_room
hass-cli service call light.turn_off --arguments entity_id=light.living_room

# With brightness (0-255)
hass-cli service call light.turn_on --arguments entity_id=light.living_room,brightness=128

# Toggle
hass-cli service call homeassistant.toggle --arguments entity_id=light.living_room
```

### Climate

```bash
# Get thermostat state
hass-cli entity get climate.living_room

# Set temperature
hass-cli service call climate.set_temperature --arguments entity_id=climate.living_room,temperature=22

# Set HVAC mode
hass-cli service call climate.set_hvac_mode --arguments entity_id=climate.living_room,hvac_mode=heat
```

### Scenes & Automations

```bash
# Activate scene
hass-cli service call scene.turn_on --arguments entity_id=scene.movie_night

# Trigger automation
hass-cli service call automation.trigger --arguments entity_id=automation.morning_routine

# Enable/disable automation
hass-cli service call automation.turn_on --arguments entity_id=automation.morning_routine
hass-cli service call automation.turn_off --arguments entity_id=automation.morning_routine
```

### Covers (Blinds/Shades)

```bash
# Open/close
hass-cli service call cover.open_cover --arguments entity_id=cover.living_room_blinds
hass-cli service call cover.close_cover --arguments entity_id=cover.living_room_blinds

# Set position (0-100)
hass-cli service call cover.set_cover_position --arguments entity_id=cover.living_room_blinds,position=50
```

### Sensors

```bash
# Get sensor value
hass-cli entity get sensor.living_room_temperature
hass-cli entity get sensor.energy_consumption

# List all sensors
hass-cli entity list --domain sensor
```

### Media Players

```bash
# Play/pause
hass-cli service call media_player.media_play --arguments entity_id=media_player.living_room
hass-cli service call media_player.media_pause --arguments entity_id=media_player.living_room

# Volume
hass-cli service call media_player.volume_set --arguments entity_id=media_player.living_room,volume_level=0.5
```

## REST API (fallback)

If hass-cli is unavailable, use curl directly:

```bash
# List entities by domain
curl -s "$HASS_SERVER/api/states" -H "Authorization: Bearer $HASS_TOKEN" | \
  jq -r '.[] | select(.entity_id | startswith("switch.")) | .entity_id'

# Get state
curl -s -H "Authorization: Bearer $HASS_TOKEN" \
  "$HASS_SERVER/api/states/light.living_room" | jq

# Turn on
curl -s -X POST "$HASS_SERVER/api/services/light/turn_on" \
  -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room"}'

# Turn on with brightness
curl -s -X POST "$HASS_SERVER/api/services/light/turn_on" \
  -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room", "brightness_pct": 80}'

# Turn off
curl -s -X POST "$HASS_SERVER/api/services/switch/turn_off" \
  -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "switch.office_lamp"}'

# Trigger scene
curl -s -X POST "$HASS_SERVER/api/services/scene/turn_on" \
  -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "scene.movie_time"}'

# Call any service
curl -s -X POST "$HASS_SERVER/api/services/{domain}/{service}" \
  -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "...", ...}'
```

## Entity Domains

- `switch.*` -- Smart plugs, generic switches
- `light.*` -- Lights (Hue, LIFX, etc.)
- `scene.*` -- Pre-configured scenes
- `automation.*` -- Automations
- `climate.*` -- Thermostats
- `cover.*` -- Blinds, garage doors
- `media_player.*` -- TVs, speakers
- `sensor.*` -- Temperature, humidity, etc.

## Tips

- Use `hass-cli entity list | grep -i kitchen` to find entities by name
- Entity IDs follow pattern: `domain.friendly_name_snake_case`
- Long-lived tokens: HA Settings -> Security -> Long-lived access tokens
- API returns JSON by default
- Long-lived tokens don't expire -- store securely
- Test entity IDs with the list command first
