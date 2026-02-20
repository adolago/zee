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
  I --> L[initPersonas (degradable)\nalways-on.ts:212]
  I --> M[initSurfaces (degradable)\nalways-on.ts:225]
  I --> N[UsageTracker.init (degradable)\nalways-on.ts:238]
  I --> O[initWorkStealing (degradable)\nalways-on.ts:249]
  I --> P[initConsensus (degradable)\nalways-on.ts:262]
  I --> Q[Config.get with fallback\nalways-on.ts:305]
  Q --> R[syncBundledSkillsToMachine (degradable)\nalways-on.ts:320]
  Q --> S[startSkillWatcher (degradable)\nalways-on.ts:337]
  Q --> T[HeartbeatRunner (degradable)\nalways-on.ts:360]
  Q --> U[CronService + banner job (degradable)\nalways-on.ts:432]
  Q --> V[GatewaySupervisor.start\nalways-on.ts:460]
  Q --> W[startRuntimeProcessGuard\nalways-on.ts:477]
  Q --> X[Daemon IPC server\nalways-on.ts:497]
  Q --> Y[Restore sessions/todos (degradable)\nalways-on.ts:614]
  Y --> Z[Emit daemon ready hook\nalways-on.ts:626]
  Z --> AA[Return AlwaysOnProcess\nalways-on.ts:647]

  AA --> AB[Tailscale exposure (optional)\ndaemon.ts:1034]
  AA --> AC[Signal handlers + idle wait\ndaemon.ts:1048]
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
- Persona hooks init (`packages/zee/src/cli/cmd/always-on.ts:212`)
- Surfaces init (`packages/zee/src/cli/cmd/always-on.ts:225`)
- Usage tracking init (`packages/zee/src/cli/cmd/always-on.ts:238`)
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
8. Shutdown usage tracker (`:566`)
9. Stop gateway supervisor (`:571`)
10. Shutdown persistence (`:576`)
11. Shutdown circuit breaker (`:586`)
12. Shutdown work stealing (`:590`)
13. Shutdown consensus (`:597`)
14. Shutdown surfaces (`:604`)
15. Remove pid file + release lock + stop server (`:607`, `:608`, `:609`)
