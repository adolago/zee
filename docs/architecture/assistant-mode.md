# Assistant Mode vs Engine Mode

This document defines the onboarding profile tradeoffs introduced for issue `#272`.

## Onboarding Profile Choice

New users can choose a profile during first-time setup:

```bash
zee setup --profile assistant
# or
zee setup --profile engine
```

If `--profile` is omitted and no `~/.config/zee/zee.jsonc` exists, `zee setup` prompts for profile selection interactively.

## Profile Intent

- `assistant`: single-user, everyday-channel-first posture with conservative defaults.
- `engine`: broader multi-domain flexibility for advanced workflows.

## Defaults Applied at Onboarding

Both profiles set secure Control UI defaults:

- `gateway.controlUi.auth.required = true`
- `gateway.controlUi.auth.mode = "token"`
- `gateway.controlUi.auth.allowPasswordOnly = false`
- `gateway.controlUi.auth.allowInsecureHttp = false`
- `server.hostname = "127.0.0.1"`

Additional assistant-mode defaults:

- `experimental.surfaces.whatsapp.enabled = false`
- `experimental.surfaces.telegram.enabled = false`
- `experimental.surfaces.cli.enabled = true`
- `memory.required = false`

Engine mode intentionally avoids disabling broader surfaces by default.

## Security Expectations

- For non-loopback deployments, use TLS termination at a reverse proxy.
- Keep trusted origins explicit where Control UI browser access is enabled.
- Use `zee security audit` and `zee doctor security` to review control-plane guardrails.
