---
summary: "CLI reference for `zee auth` (OAuth/token login, profile switching, rotation)"
read_when:
  - You need a first-class auth workflow without `zee models auth`
  - You want to switch or rotate provider auth profiles
  - You need to inspect active profile and fallback order
---

# `zee auth`

Manage provider auth profiles (OAuth/API key/token) directly from a top-level
CLI surface.

## Common commands

```bash
zee auth status
zee auth login --provider anthropic
zee auth use --provider anthropic --profile anthropic:default
zee auth rotate --provider anthropic
```

## `auth status`

Shows:
- active profile per provider
- current fallback order
- profile health (`ready`, `cooldown`, `disabled:*`, `expired`)

Flags:
- `--provider <id>`: filter to one provider.
- `--agent <id>`: inspect a specific agent.
- `--json`: machine-readable output.

## `auth login`

Runs provider plugin auth flow (OAuth/API key/token).

Flags:
- `--provider <id>`: provider id.
- `--method <id>`: auth method id.
- `--set-default`: apply provider default model recommendation.

## `auth use`

Pins a profile to the front of fallback order for a provider.

Flags:
- `--provider <id>`: provider id.
- `--profile <id>`: profile id to activate.
- `--agent <id>`: target agent.
- `--json`: machine-readable output.

## `auth rotate`

Rotates to the next profile in fallback order.

Flags:
- `--provider <id>`: provider id.
- `--agent <id>`: target agent.
- `--json`: machine-readable output.

## Token helpers

```bash
zee auth setup-token --provider anthropic
zee auth paste-token --provider anthropic --profile-id anthropic:manual --expires-in 365d
```

## Order overrides

```bash
zee auth order get --provider anthropic
zee auth order set --provider anthropic anthropic:default anthropic:backup
zee auth order clear --provider anthropic
```

These commands update per-agent order overrides and make fallback precedence explicit.
