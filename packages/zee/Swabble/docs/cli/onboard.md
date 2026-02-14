---
summary: "CLI reference for `zee onboard` (interactive onboarding wizard)"
read_when:
  - You want guided setup for gateway, workspace, auth, channels, and skills
---

# `zee onboard`

Interactive onboarding wizard (local or remote Gateway setup).

Related:
- Wizard guide: [Wizard](/start/wizard)

## Examples

```bash
zee onboard
zee onboard --flow quickstart
zee onboard --flow quickstart --assistant-mode
zee onboard --flow manual
zee onboard --mode remote --remote-url ws://gateway-host:18789
```

Flow notes:
- `quickstart`: minimal prompts, auto-generates a gateway token.
- `manual`: full prompts for port/bind/auth (alias of `advanced`).
- `--assistant-mode`: applies single-user assistant defaults (main DM session, allowlist-first group policy, cross-provider sends off).
- Fastest first chat: finish onboarding and connect WhatsApp or WhatsApp.
