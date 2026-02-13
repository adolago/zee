---
name: home-assistant
description: Control Home Assistant smart home devices, run automations, and receive webhook events. Use when controlling lights, switches, climate, scenes, scripts, or any HA entity. Supports bidirectional communication via REST API (outbound) and webhooks (inbound triggers from HA automations).
version: 1.0.0
author: Artur
tags: [smart-home, home-assistant, iot, zee]
metadata: {"zee":{"os":["linux","macos"],"requires":{"bins":["jq","curl"]}}}
---

# Home Assistant

Control your smart home via Home Assistant's REST API and webhooks.

## Setup

### Environment Variables

```bash
export HASS_SERVER="https://ha.home.arpa/"
export HASS_TOKEN="your-long-lived-access-token"
```

These are configured in `zee.jsonc` under `skills.entries.home-assistant`.

### Getting a Long-Lived Access Token

1. Open Home Assistant > Profile (bottom left)
2. Scroll to "Long-Lived Access Tokens"
3. Click "Create Token", name it (e.g., "Zee")
4. Copy the token immediately (shown only once)

## Quick Reference

### List Entities

```bash
curl -s -H "Authorization: Bearer $HASS_TOKEN" "$HASS_SERVER/api/states" | jq '.[].entity_id'
```

### Get Entity State

```bash
curl -s -H "Authorization: Bearer $HASS_TOKEN" "$HASS_SERVER/api/states/light.living_room"
```

### Control Devices

```bash
# Turn on
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" -H "Content-Type: application/json" \
  "$HASS_SERVER/api/services/light/turn_on" -d '{"entity_id": "light.living_room"}'

# Turn off
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" -H "Content-Type: application/json" \
  "$HASS_SERVER/api/services/light/turn_off" -d '{"entity_id": "light.living_room"}'

# Set brightness (0-255)
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" -H "Content-Type: application/json" \
  "$HASS_SERVER/api/services/light/turn_on" -d '{"entity_id": "light.living_room", "brightness": 128}'
```

### Run Scripts & Automations

```bash
# Trigger script
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" "$HASS_SERVER/api/services/script/turn_on" \
  -H "Content-Type: application/json" -d '{"entity_id": "script.goodnight"}'

# Trigger automation
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" "$HASS_SERVER/api/services/automation/trigger" \
  -H "Content-Type: application/json" -d '{"entity_id": "automation.motion_lights"}'
```

### Activate Scenes

```bash
curl -X POST -H "Authorization: Bearer $HASS_TOKEN" "$HASS_SERVER/api/services/scene/turn_on" \
  -H "Content-Type: application/json" -d '{"entity_id": "scene.movie_night"}'
```

## Common Services

| Domain | Service | Example entity_id |
|--------|---------|-------------------|
| `light` | `turn_on`, `turn_off`, `toggle` | `light.kitchen` |
| `switch` | `turn_on`, `turn_off`, `toggle` | `switch.fan` |
| `climate` | `set_temperature`, `set_hvac_mode` | `climate.thermostat` |
| `cover` | `open_cover`, `close_cover`, `stop_cover` | `cover.garage` |
| `media_player` | `play_media`, `media_pause`, `volume_set` | `media_player.tv` |
| `scene` | `turn_on` | `scene.relax` |
| `script` | `turn_on` | `script.welcome_home` |
| `automation` | `trigger`, `turn_on`, `turn_off` | `automation.sunrise` |

## Inbound Webhooks (HA -> Zee)

To receive events from Home Assistant automations:

### 1. Create HA Automation with Webhook Action

```yaml
action:
  - service: rest_command.notify_zee
    data:
      event: motion_detected
      area: living_room
```

### 2. Define REST Command in HA

```yaml
# configuration.yaml
rest_command:
  notify_zee:
    url: "https://your-zee-gateway-url/webhook/home-assistant"
    method: POST
    headers:
      Authorization: "Bearer {{ webhook_secret }}"
      Content-Type: "application/json"
    payload: '{"event": "{{ event }}", "area": "{{ area }}"}'
```

### 3. Handle in Zee

Zee receives the webhook via the gateway and can notify you or take action based on the event.

## Troubleshooting

- **401 Unauthorized**: Token expired or invalid. Generate a new one.
- **Connection refused**: Check HASS_SERVER, ensure HA is running and accessible.
- **Entity not found**: List entities to find the correct entity_id.
