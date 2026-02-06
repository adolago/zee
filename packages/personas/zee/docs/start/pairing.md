---
summary: "Pairing overview: approve who can DM you + which nodes can join"
read_when:
  - Setting up DM access control
  - Pairing a new node host
  - Reviewing Zee security posture
---

# Pairing

“Pairing” is Zee’s explicit **owner approval** step.
It is used in two places:

1) **DM pairing** (who is allowed to talk to the bot)
2) **Node pairing** (which devices/nodes are allowed to join the gateway network)

Security context: [Security](/gateway/security)

## 1) DM pairing (inbound chat access)

When a channel is configured with DM policy `pairing`, unknown senders get a short code and their message is **not processed** until you approve.

Default DM policies are documented in: [Security](/gateway/security)

Pairing codes:
- 8 characters, uppercase, no ambiguous chars (`0O1I`).
- **Expire after 1 hour**. The bot only sends the pairing message when a new request is created (roughly once per hour per sender).
- Pending DM pairing requests are capped at **3 per channel** by default; additional requests are ignored until one expires or is approved.

### Approve a sender

```bash
zee pairing list matrix
zee pairing approve matrix <CODE>
```


### Where the state lives

Stored under `~/.zee/credentials/`:
- Pending requests: `<channel>-pairing.json`
- Approved allowlist store: `<channel>-allowFrom.json`

Treat these as sensitive (they gate access to your assistant).


## 2) Node device pairing (headless node hosts)

Nodes connect to the Gateway as **devices** with `role: node`. The Gateway
creates a device pairing request that must be approved.

### Approve a node device

```bash
zee devices list
zee devices approve <requestId>
zee devices reject <requestId>
```

### Where the state lives

Stored under `~/.zee/devices/`:
- `pending.json` (short-lived; pending requests expire)
- `paired.json` (paired devices + tokens)

### Notes

- The legacy `node.pair.*` API (CLI: `zee nodes pending/approve`) is a
  separate gateway-owned pairing store. WS nodes still require device pairing.


## Related docs

- Security model + prompt injection: [Security](/gateway/security)
- Updating safely (run doctor): [Updating](/install/updating)
- Channel configs:
  - Matrix: [Matrix](/channels/matrix)
  - WhatsApp: [WhatsApp](/channels/whatsapp)
