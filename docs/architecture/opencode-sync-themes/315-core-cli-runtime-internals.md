# Opencode Sync Theme 315: Core CLI Runtime Internals

Tracking issue: `adolago/zee#315`
Source ref: `opencode/dev`

## Scope

This artifact completes triage acceptance for theme 315 by:

- validating every mapped commit intent
- defining concrete parity implementation tasks for Zee
- marking commits that are non-applicable or already superseded

## Commit Intent Validation (Coverage)

Each commit in issue `#315` is mapped to one of the categories below.

### Category A: Terminal/runtime lifecycle stability

- `01b12949` terminal exit/ctrl-d hang fix
- `87d91c29` terminal UX/focus/CSP fixes
- `3929f0b5` terminal replay fix
- `548608b7` terminal PTY isolation
- `f73f88fb` Windows PTY UTF-8 defaults
- `fc37337a` memory leak with platform fetch for events
- `991496a7` ACP thinking-state hang fix (Windows)

Decision: `adapt` (Zee runtime differs; preserve behavioral parity)

### Category B: Snapshot/worktree/path correctness

- `bb710e9e` snapshot regression
- `cf6ad4c4` special-char path + snapshot logic
- `31f3a508` revert of prior snapshot change
- `a96f3d15` revert of prior path handling change
- `32e6bcae` unicode filename handling in snapshot diff
- `3b93e8d9` file status calc fixes
- `89064c34` orphaned worktree cleanup
- `8da5fd0a` worktree delete fix
- `4a73d51a` workspace reset issues

Decision: `adapt` (preserve Zee storage/runtime semantics)

### Category C: Config/runtime feature surface

- `2a370f80` home-dir expansion for permission patterns
- `16fad51b` workspace startup script
- `a9fca05d` `--mdns-domain` support
- `60e616ec` `.slnx` LSP root detection

Decision: `port` when low-coupling (`--mdns-domain` already ported), otherwise `adapt`

### Category D: Skill/command invocation and slash-command behavior

- `85126556` skills as slash commands
- `3542f3e4` revert of slash-command change
- `cb6ec0a5` hide badge for builtin slash commands
- `397ee419` question validation loosened for tool-call reliability
- `60bdb6e9` /review prompt behavior tweak

Decision: `adapt` (respect Zee command model and UX)

### Category E: Plugin/package runtime behavior

- `d116c227` plugins always reinstalled bug
- `a2c28fc8` plugin install `--no-cache` via proxy
- `bfbcbc88` formatter addition (laravel pint)

Decision: `adapt`

### Category F: Cleanup/housekeeping/no-functional-runtime delta

- `79aa931a`, `407f34fe`, `acb92fcd`, `c9bbea42`, `f86f654c` (chore/cleanup)
- `924fc9ed`, `65e1186e` (WIP app/settings/global config)
- `fd77d31b` session title prompt tweak
- `94ce289d`, `7c34319b`, `c4d223eb`, `b1fbfa7e`, `427ef95f`, `d4c90b2d`, `eace76e5`, `c07077f9`

Decision: mixed; mostly `adapt` or `non-goal` depending on product coupling

## Complete Commit Mapping Index

`924fc9ed` F  
`01b12949` A  
`2a370f80` C  
`79aa931a` F  
`87d91c29` A  
`bb710e9e` B  
`bfbcbc88` E  
`cf6ad4c4` B  
`fd77d31b` F  
`16fad51b` C  
`31f3a508` B (revert)  
`a96f3d15` B (revert)  
`c4d223eb` F  
`32e6bcae` B  
`397ee419` D  
`407f34fe` F  
`94ce289d` F  
`7c34319b` F  
`b1fbfa7e` F  
`65e1186e` F  
`acb92fcd` F  
`c9bbea42` F  
`427ef95f` F  
`3542f3e4` D (revert)  
`85126556` D  
`cb6ec0a5` D  
`d4c90b2d` F  
`f73f88fb` A  
`3b93e8d9` B  
`a9fca05d` C (ported)  
`eace76e5` F  
`f86f654c` F  
`60e616ec` C  
`d116c227` E  
`a2c28fc8` E  
`89064c34` B  
`c07077f9` F  
`3929f0b5` A  
`4a73d51a` B  
`60bdb6e9` D  
`fc37337a` A  
`548608b7` A  
`8da5fd0a` B  
`991496a7` A

## Zee Parity Implementation Tasks

1. `P315-RUN-01` Terminal lifecycle parity harness expansion (exit/replay/isolation + Windows edge cases).
2. `P315-SNP-01` Snapshot/worktree unicode and special-path regression matrix.
3. `P315-PLG-01` Plugin-install reliability in proxied/no-cache environments.
4. `P315-CFG-01` Permission-pattern home expansion parity checks and docs.
5. `P315-CMD-01` Slash command compatibility decisions documented as explicit adapt/non-goal items.

## Non-applicable or Superseded Items

- Reverts (`31f3a508`, `a96f3d15`, `3542f3e4`) are tracked as superseded history, not direct port targets.
- App-specific WIP/cleanup-only commits are non-goal unless they impact proven Zee runtime behavior.
- Product-coupled UI prompt/copy changes are treated as `adapt` (not strict port).

## Acceptance Checklist

- [x] Validate each commit intent is represented in this theme
- [x] Define parity implementation tasks for Zee based on these commits
- [x] Mark commits that are not applicable to Zee
