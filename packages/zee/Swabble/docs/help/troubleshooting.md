---
summary: "Troubleshooting hub: symptoms → checks → fixes"
read_when:
  - You see an error and want the fix path
  - The installer says “success” but the CLI doesn’t work
---

# Troubleshooting

## First 60 seconds

Run these in order:

```bash
zee status
zee status --all
zee gateway probe
zee logs --follow
zee doctor
```

If the gateway is reachable, deep probes:

```bash
zee status --deep
```

## Common “it broke” cases

### `zee: command not found`

Almost always a Node/npm PATH issue. Start here:

- [Install (Node/npm PATH sanity)](/install#nodejs--npm-path-sanity)

### Installer fails (or you need full logs)

Re-run the installer in verbose mode to see the full trace and npm output:

```bash
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --verbose
```

For beta installs:

```bash
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --beta --verbose
```

You can also set `ZEE_VERBOSE=1` instead of the flag.

### Gateway “unauthorized”, can’t connect, or keeps reconnecting

- [Gateway troubleshooting](/gateway/troubleshooting)
- [Gateway authentication](/gateway/authentication)

### `zee-bot.com` shows an SSL error (Comcast/Xfinity)

Some Comcast/Xfinity connections block `zee-bot.com` via Xfinity Advanced Security.
Disable Advanced Security or add `zee-bot.com` to the allowlist, then retry.

- Xfinity Advanced Security help: https://www.xfinity.com/support/articles/using-xfinity-xfi-advanced-security
- Quick sanity checks: try a mobile hotspot or VPN to confirm it’s ISP-level filtering

### Service says running, but RPC probe fails

- [Gateway troubleshooting](/gateway/troubleshooting)
- [Background process / service](/gateway/background-process)

### Model/auth failures (rate limit, billing, “all models failed”)

- [Models](/cli/models)
- [OAuth / auth concepts](/concepts/oauth)

### `/model` says `model not allowed`

This usually means `agents.defaults.models` is configured as an allowlist. When it’s non-empty,
only those provider/model keys can be selected.

- Check the allowlist: `zee config get agents.defaults.models`
- Add the model you want (or clear the allowlist) and retry `/model`
- Use `/models` to browse the allowed providers/models

### When filing an issue

Paste a safe report:

```bash
zee status --all
```

If you can, include the relevant log tail from `zee logs --follow`.
