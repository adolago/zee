---
summary: "CLI reference for `zee system` (system events, heartbeat, presence)"
read_when:
  - You want to enqueue a system event without creating a cron job
  - You need to enable or disable heartbeats
  - You want to inspect system presence entries
  - You want to control always-on voice wake mode
---

# `zee system`

System-level helpers for the Gateway: enqueue system events, control heartbeats,
and view presence.

## Common commands

```bash
zee system event --text "Check for urgent follow-ups" --mode now
zee system heartbeat enable
zee system heartbeat last
zee system presence
zee system voicewake status
zee system voicewake set zee assistant
zee system voicewake disable
```

## `system event`

Enqueue a system event on the **main** session. The next heartbeat will inject
it as a `System:` line in the prompt. Use `--mode now` to trigger the heartbeat
immediately; `next-heartbeat` waits for the next scheduled tick.

Flags:
- `--text <text>`: required system event text.
- `--mode <mode>`: `now` or `next-heartbeat` (default).
- `--json`: machine-readable output.

## `system heartbeat last|enable|disable`

Heartbeat controls:
- `last`: show the last heartbeat event.
- `enable`: turn heartbeats back on (use this if they were disabled).
- `disable`: pause heartbeats.

Flags:
- `--json`: machine-readable output.

## `system presence`

List the current system presence entries the Gateway knows about (nodes,
instances, and similar status lines).

Flags:
- `--json`: machine-readable output.

## `system voicewake`

Always-on voice wake controls (state + trigger words).

Commands:
- `status`: show enabled/disabled state and configured/active triggers.
- `set <triggers...>`: replace triggers and enable voice wake.
- `enable`: enable voice wake with existing triggers (or pass `--trigger` repeatedly to set them).
- `disable`: disable voice wake without deleting configured triggers.
- `reset`: restore default triggers and enable.

Flags:
- `--json`: machine-readable output.
- `--trigger <word>` (for `enable`): add a trigger; repeatable.

## Notes

- Requires a running Gateway reachable by your current config (local or remote).
- System events are ephemeral and not persisted across restarts.
- Voice wake state persists across restarts via `~/.zee/settings/voicewake.json`.
