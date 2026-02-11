---
summary: "CLI reference for `zee onboard` (interactive onboarding wizard)"
read_when:
  - You want guided setup for gateway, workspace, auth, channels, and skills
---

# `zee onboard`

Interactive onboarding wizard (local or remote Gateway setup).

Related:
- Wizard guide: [Onboarding](/start/onboarding)

## Examples

```bash
zee onboard
zee onboard --flow quickstart
zee onboard --flow manual
zee onboard --mode remote --remote-url ws://gateway-host:18789
```

Flow notes:
- `quickstart`: minimal prompts, auto-generates a gateway token.
- `manual`: full prompts for port/bind/auth (alias of `advanced`).
- Fastest first chat: finish onboarding and connect WhatsApp or WhatsApp.
