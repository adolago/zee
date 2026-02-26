# OpenCode Snapshot Playbook

This playbook provides a reproducible command sequence for OpenCode lane refreshes.

Policy reference: `docs/architecture/opencode-sync-policy.md`

## Preconditions

- Repo remote target is `adolago/zee`.
- `opencode` remote is configured (`https://github.com/sst/opencode.git`).
- Maintainer runs from repo root.

## Guardrail

Run before any GitHub issue/PR operation:

```bash
./scripts/verify-pr-target.sh
```

## Snapshot Command Sequence

1. Fetch and check OpenCode upstream drift:

```bash
./scripts/check-upstream.sh --remote opencode --fetch
```

2. Produce multi-upstream dashboard (includes OpenCode pin summary):

```bash
./scripts/check-upstream-all.sh
```

3. Preview OpenCode sync impact without mutating history:

```bash
./scripts/sync-upstream.sh --remote opencode --preview
```

Notes:

- Preview mode now runs even with a dirty worktree (merge/rebase modes remain blocked).
- Preview writes full overlap paths to `/tmp/zee-sync-conflicts-opencode.txt` and prints top conflict areas.

4. Capture direct divergence counts (optional but recommended):

```bash
git rev-list --left-right --count opencode/dev...HEAD
git -c diff.renameLimit=20000 diff --name-status opencode/dev...HEAD > /tmp/opencode.diff.txt
```

## Evidence Capture Template

For each refresh cycle, record:

- Refresh date (UTC)
- Current `opencode/dev` full SHA
- Ahead/behind counts from `check-upstream.sh`
- Notable file-delta signals (from `/tmp/opencode.diff.txt` summary)
- Lane decisions changed this cycle

## Documentation Update Steps

1. Update pin values in:
   - `docs/architecture/upstream-differences.md`
   - `docs/architecture/zee-opencode-gap-map-top10.md`
2. Update affected lane artifacts in `docs/architecture/opencode-lanes/`.
3. Re-rank top-10 backlog if priority changed.
4. Open or update lane issues for any new high-priority deltas.

## Lane Refresh Exit Criteria

- Pins and evidence updated
- Lane decisions reviewed and documented
- Rank table reflects current upstream reality
- Follow-up issue links are present for new/changed lanes
