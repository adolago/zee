---
summary: "Messaging platforms Zee can connect to"
read_when:
  - You want to choose a chat channel for Zee
  - You need a quick overview of supported messaging platforms
---
# Chat Channels

Zee can talk to you on any chat app you already use. Each channel connects via the Gateway.
Text is supported everywhere; media and reactions vary by channel.

## Supported channels

- [WhatsApp](/channels/whatsapp) — Most popular; uses Baileys and requires QR pairing.
- [Matrix](/channels/matrix) — Matrix homeserver; supports rooms (and optional E2EE).

## Notes

- Channels can run simultaneously; configure multiple and Zee will route per chat.
- Fastest setup is usually **Matrix** (access token + homeserver). WhatsApp requires QR pairing and
  stores more state on disk.
- Group behavior varies by channel; see [Groups](/concepts/groups).
- DM pairing and allowlists are enforced for safety; see [Security](/gateway/security).
- Troubleshooting: [Channel troubleshooting](/channels/troubleshooting).
- Model providers are documented separately; see [Model Providers](/providers/models).
