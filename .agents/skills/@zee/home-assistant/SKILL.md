---
name: home-assistant
description: Control Home Assistant for smart home automation - lights, switches, sensors, climate, covers, and automations via CLI or REST API.
version: 1.0.0
author: Artur
tags: [home, automation, iot, smart-home]
---

# home-assistant - Smart Home Control

Control Home Assistant entities and automations.

## Prerequisites

```bash
# Install hass-cli
pip install homeassistant-cli

# Configure (or use env vars)
hass-cli config set --server https://your-ha-instance:8123 --token YOUR_LONG_LIVED_TOKEN
```

## Environment Variables

- `HASS_SERVER` - Home Assistant URL (e.g., `http://192.168.1.100:8123`)
- `HASS_TOKEN` - Long-lived access token

## Common Commands

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

## REST API Alternative

If hass-cli is unavailable, use curl:

```bash
# Get state
curl -s -H "Authorization: Bearer $HASS_TOKEN" \
  "$HASS_SERVER/api/states/light.living_room" | jq

# Call service
curl -s -X POST -H "Authorization: Bearer $HASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room"}' \
  "$HASS_SERVER/api/services/light/turn_on"
```

## Tips

- Use `hass-cli entity list | grep -i kitchen` to find entities by name
- Entity IDs follow pattern: `domain.friendly_name_snake_case`
- Long-lived tokens: HA Settings → Security → Long-lived access tokens
