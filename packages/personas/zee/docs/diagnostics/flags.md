---
summary: "Diagnostics flags for targeted debug logs"
read_when:
  - You need targeted debug logs without raising global logging levels
  - You need to capture subsystem-specific logs for support
---
# Diagnostics Flags

Diagnostics flags let you enable targeted debug logs without turning on verbose logging everywhere. Flags are opt-in and have no effect unless a subsystem checks them.

## How it works

- Flags are strings (case-insensitive).
- You can enable flags in config or via an env override.
- Wildcards are supported:
  - `matrix.*` matches `matrix.http`
  - `*` enables all flags

## Enable via config

```json
{
  "diagnostics": {
    "flags": ["matrix.http"]
  }
}
```

Multiple flags:

```json
{
  "diagnostics": {
    "flags": ["matrix.http", "gateway.*"]
  }
}
```

Restart the gateway after changing flags.

## Env override (one-off)

```bash
ZEE_DIAGNOSTICS=matrix.http,matrix.payload
```

Disable all flags:

```bash
ZEE_DIAGNOSTICS=0
```

## Where logs go

Flags emit logs into the standard diagnostics log file. By default:

```
/tmp/zee/zee-YYYY-MM-DD.log
```

If you set `logging.file`, use that path instead. Logs are JSONL (one JSON object per line). Redaction still applies based on `logging.redactSensitive`.

## Extract logs

Pick the latest log file:

```bash
ls -t /tmp/zee/zee-*.log | head -n 1
```

Filter for Matrix HTTP diagnostics:

```bash
rg "matrix http error" /tmp/zee/zee-*.log
```

Or tail while reproducing:

```bash
tail -f /tmp/zee/zee-$(date +%F).log | rg "matrix http error"
```

For remote gateways, you can also use `zee logs --follow` (see [/cli/logs](/cli/logs)).

## Notes

- If `logging.level` is set higher than `warn`, these logs may be suppressed. Default `info` is fine.
- Flags are safe to leave enabled; they only affect log volume for the specific subsystem.
- Use [/logging](/logging) to change log destinations, levels, and redaction.
