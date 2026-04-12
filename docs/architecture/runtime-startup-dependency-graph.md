# Runtime Startup Dependency Graph (Zee Daemon)

> Last updated: 2026-02-20  
> Scope: `zee daemon` startup path through `startAlwaysOnProcess()`.

## Entry Path

1. CLI dispatch: `packages/zee/src/index.ts:217`
2. Daemon command handler: `packages/zee/src/cli/cmd/daemon.ts:917`
3. Always-on startup: `packages/zee/src/cli/cmd/always-on.ts:91`

## Dependency Graph

```mermaid
graph TD
  A[CLI parse\nindex.ts:217] --> B[DaemonCommand handler\ndaemon.ts:917]
  B --> C[Acquire daemon lock\ndaemon.ts:957]
  B --> D[Runtime process preflight\ndaemon.ts:982]
  B --> E[startAlwaysOnProcess()\nalways-on.ts:91]

  E --> F[validateSetup\nalways-on.ts:113]
  F --> G[Server.listen\nalways-on.ts:139]
  G --> H[Write PID file\nalways-on.ts:153]
  H --> I[Emit daemon start hook\nalways-on.ts:156]

  I --> J[Persistence.init (degradable)\nalways-on.ts:185]
  I --> K[CircuitBreaker.init (degradable)\nalways-on.ts:202]
  I --> L[initAgents (degradable)\nalways-on.ts:212]
  I --> M[initSurfaces (degradable)\nalways-on.ts:225]
  I --> N[initWorkStealing (degradable)\nalways-on.ts]
  I --> O[initConsensus (degradable)\nalways-on.ts]
  I --> P[Config.get with fallback\nalways-on.ts]
  P --> Q[syncBundledSkillsToMachine (degradable)\nalways-on.ts]
  P --> R[startSkillWatcher (degradable)\nalways-on.ts]
  P --> S[HeartbeatRunner (degradable)\nalways-on.ts]
  P --> T[CronService + banner job (degradable)\nalways-on.ts]
  P --> U[GatewaySupervisor.start\nalways-on.ts]
  P --> V[startRuntimeProcessGuard\nalways-on.ts]
  P --> W[Daemon IPC server\nalways-on.ts]
  P --> X[Restore sessions/todos (degradable)\nalways-on.ts]
  X --> Y[Emit daemon ready hook\nalways-on.ts]
  Y --> Z[Return AlwaysOnProcess\nalways-on.ts]

  Z --> AA[Tailscale exposure (optional)\ndaemon.ts]
  Z --> AB[Signal handlers + idle wait\ndaemon.ts]
```

## Hard vs Degradable Dependencies

### Hard-stop (startup fails if this step throws)

- `validateSetup()` (`packages/zee/src/cli/cmd/always-on.ts:113`)
- `Server.listen()` (`packages/zee/src/cli/cmd/always-on.ts:139`)
- `Daemon.writePidFile()` (`packages/zee/src/cli/cmd/always-on.ts:153`)
- `LifecycleHooks.emitDaemonStart()` (`packages/zee/src/cli/cmd/always-on.ts:156`)
- `GatewaySupervisor.start()` only when preflight is fatal (`packages/zee/src/cli/cmd/always-on.ts:470`)
- `startRuntimeProcessGuard()` (not wrapped in `try/catch`) (`packages/zee/src/cli/cmd/always-on.ts:477`)
- `LifecycleHooks.emitDaemonReady()` (`packages/zee/src/cli/cmd/always-on.ts:626`)

### Degradable (startup continues on failure)

- Persistence init (`packages/zee/src/cli/cmd/always-on.ts:185`)
- Circuit breaker init (`packages/zee/src/cli/cmd/always-on.ts:202`)
- Agent hooks init (`packages/zee/src/cli/cmd/always-on.ts:212`)
- Surfaces init (`packages/zee/src/cli/cmd/always-on.ts:225`)
- Work stealing init (`packages/zee/src/cli/cmd/always-on.ts:249`)
- Consensus init (`packages/zee/src/cli/cmd/always-on.ts:262`)
- Runtime config load fallback (`packages/zee/src/cli/cmd/always-on.ts:305`)
- Bundled skill sync (`packages/zee/src/cli/cmd/always-on.ts:320`)
- Skill watcher start (`packages/zee/src/cli/cmd/always-on.ts:337`)
- Heartbeat runner start (`packages/zee/src/cli/cmd/always-on.ts:360`)
- Cron service start (`packages/zee/src/cli/cmd/always-on.ts:432`)
- Banner cron wiring (`packages/zee/src/cli/cmd/always-on.ts:443`)
- IPC server start (`packages/zee/src/cli/cmd/always-on.ts:497`)
- Session restore scan (`packages/zee/src/cli/cmd/always-on.ts:614`)

## Cleanup Dependency Order

Cleanup path is centralized at `packages/zee/src/cli/cmd/always-on.ts:525` and runs in this order:

1. Emit shutdown hook (`:530`)
2. Stop IPC server (`:538`)
3. Stop heartbeat (`:544`)
4. Stop cron (`:549`)
5. Stop skill watcher (`:554`)
6. Stop runtime guard (`:556`)
7. Close visual sink (`:561`)
8. Stop gateway supervisor (`:571`)
9. Shutdown persistence (`:576`)
10. Shutdown circuit breaker (`:586`)
11. Shutdown work stealing (`:590`)
12. Shutdown consensus (`:597`)
13. Shutdown surfaces (`:604`)
14. Remove pid file + release lock + stop server (`:607`, `:608`, `:609`)
