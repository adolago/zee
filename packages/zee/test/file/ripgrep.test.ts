import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Ripgrep } from "../../src/file/ripgrep"

const tempDirs: string[] = []

interface FakeProcessControl {
  proc: ReturnType<typeof Bun.spawn>
  killSignals: (string | undefined)[]
  isRunning: () => boolean
}

function createFakeRipgrepProcess(input: {
  stdoutChunks: string[]
  keepRunning: boolean
}): FakeProcessControl {
  const encoder = new TextEncoder()
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined
  let exitCode: number | null = input.keepRunning ? null : 0
  let resolveExited: ((code: number) => void) | undefined
  const killSignals: (string | undefined)[] = []

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller
      for (const chunk of input.stdoutChunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      if (!input.keepRunning) controller.close()
    },
  })

  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })

  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve
    if (exitCode !== null) resolve(exitCode)
  })

  const finish = (code: number) => {
    if (exitCode !== null) return
    exitCode = code
    try {
      stdoutController?.close()
    } catch {
      // Stream may already be closed.
    }
    resolveExited?.(code)
  }

  const proc = {
    stdout,
    stderr,
    exited,
    get exitCode() {
      return exitCode
    },
    kill(signal?: string) {
      killSignals.push(signal)
      finish(signal === "SIGKILL" ? 137 : 143)
      return true
    },
  } as ReturnType<typeof Bun.spawn>

  return {
    proc,
    killSignals,
    isRunning: () => exitCode === null,
  }
}

afterEach(async () => {
  Ripgrep.__setCommandSpawnForTesting()
  Ripgrep.__setFilepathResolverForTesting()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("Ripgrep process lifecycle", () => {
  test("files() kills ripgrep when consumer breaks early", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zee-ripgrep-files-break-"))
    tempDirs.push(dir)

    const fake = createFakeRipgrepProcess({
      stdoutChunks: ["a.ts\nb.ts\n"],
      keepRunning: true,
    })

    Ripgrep.__setFilepathResolverForTesting(async () => "rg")
    Ripgrep.__setCommandSpawnForTesting(async () => fake.proc)

    const files: string[] = []
    for await (const file of Ripgrep.files({ cwd: dir })) {
      files.push(file)
      break
    }

    expect(files).toEqual(["a.ts"])
    expect(fake.killSignals.length).toBeGreaterThan(0)
    expect(fake.isRunning()).toBe(false)
  })

  test("files() abort terminates ripgrep and rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zee-ripgrep-files-abort-"))
    tempDirs.push(dir)

    const fake = createFakeRipgrepProcess({
      stdoutChunks: [],
      keepRunning: true,
    })

    Ripgrep.__setFilepathResolverForTesting(async () => "rg")
    Ripgrep.__setCommandSpawnForTesting(async () => fake.proc)

    const controller = new AbortController()
    const iterator = Ripgrep.files({ cwd: dir, signal: controller.signal })
    const nextPromise = iterator.next()
    await Bun.sleep(10)
    controller.abort()

    await expect(nextPromise).rejects.toBeDefined()
    expect(fake.killSignals.length).toBeGreaterThan(0)
    expect(fake.isRunning()).toBe(false)
  })

  test("search() abort terminates ripgrep", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zee-ripgrep-search-abort-"))
    tempDirs.push(dir)

    const fake = createFakeRipgrepProcess({
      stdoutChunks: [],
      keepRunning: true,
    })

    Ripgrep.__setFilepathResolverForTesting(async () => "rg")
    Ripgrep.__setCommandSpawnForTesting(async () => fake.proc)

    const controller = new AbortController()
    const promise = Ripgrep.search({
      cwd: dir,
      pattern: "hello",
      signal: controller.signal,
    })
    await Bun.sleep(10)
    controller.abort()

    await expect(promise).resolves.toEqual([])
    expect(fake.killSignals.length).toBeGreaterThan(0)
    expect(fake.isRunning()).toBe(false)
  })
})
