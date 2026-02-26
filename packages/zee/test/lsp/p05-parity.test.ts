import { describe, expect, test } from "bun:test"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import type { LSPServer } from "../../src/lsp/server"
import { LSPClient } from "../../src/lsp/client"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const FAKE_LSP_SERVER = String.raw`
const docs = new Map()
let buffer = Buffer.alloc(0)

function encode(message) {
  const json = JSON.stringify(message)
  const header = "Content-Length: " + Buffer.byteLength(json, "utf8") + "\r\n\r\n"
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function send(message) {
  process.stdout.write(encode(message))
}

function publishDiagnostics(uri, text) {
  const diagnostics = text.includes("BROKEN")
    ? [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
          },
          severity: 1,
          source: "p05-fake",
          message: "Found BROKEN token",
        },
      ]
    : []

  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: { uri, diagnostics },
  })
}

function decodeFrames(rawBuffer) {
  const frames = []
  let rest = rawBuffer
  while (true) {
    const separator = rest.indexOf("\r\n\r\n")
    if (separator === -1) break
    const header = rest.slice(0, separator).toString("utf8")
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    const length = match ? Number.parseInt(match[1], 10) : 0
    const bodyStart = separator + 4
    const bodyEnd = bodyStart + length
    if (rest.length < bodyEnd) break
    frames.push(rest.slice(bodyStart, bodyEnd).toString("utf8"))
    rest = rest.slice(bodyEnd)
  }
  return { frames, rest }
}

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: ["."] },
        },
      },
    })
    return
  }

  if (message.method === "initialized") return
  if (message.method === "workspace/didChangeConfiguration") return
  if (message.method === "workspace/didChangeWatchedFiles") return

  if (message.method === "textDocument/didOpen") {
    const doc = message.params?.textDocument ?? {}
    const uri = doc.uri
    const text = doc.text ?? ""
    docs.set(uri, text)
    publishDiagnostics(uri, text)
    return
  }

  if (message.method === "textDocument/didChange") {
    const uri = message.params?.textDocument?.uri
    const text = message.params?.contentChanges?.[0]?.text ?? docs.get(uri) ?? ""
    docs.set(uri, text)
    publishDiagnostics(uri, text)
    return
  }

  if (message.method === "textDocument/completion") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isIncomplete: false,
        items: [
          { label: "alpha", kind: 6 },
          { label: "beta", kind: 6 },
        ],
      },
    })
    return
  }

  if (typeof message.id !== "undefined") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  const decoded = decodeFrames(buffer)
  buffer = decoded.rest
  for (const frame of decoded.frames) {
    try {
      handle(JSON.parse(frame))
    } catch {
      // Ignore malformed payloads; test harness validates successful requests.
    }
  }
})
`

function spawnFakeLspServer(scriptPath: string): LSPServer.Handle {
  return {
    process: spawn(process.execPath, [scriptPath], {
      stdio: "pipe",
    }),
  } as LSPServer.Handle
}

function completionLabels(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.map((entry) => String((entry as { label?: unknown }).label ?? "")).filter(Boolean)
  }

  const items = (result as { items?: Array<{ label?: unknown }> } | null)?.items ?? []
  return items.map((entry) => String(entry.label ?? "")).filter(Boolean)
}

describe("P05 LSP parity harness", () => {
  // P05-LSP-001: LSP diagnostics/completion validity smoke.
  test("P05-LSP-001 diagnostics and completion are valid/stable without protocol errors", async () => {
    await Log.init({ print: false })
    const sandbox = await tmpdir()
    try {
      const filePath = path.join(sandbox.path, "p05-smoke.ts")
      const serverPath = path.join(sandbox.path, "p05-fake-lsp-server.js")

      await fs.writeFile(filePath, "const BROKEN =\n")
      await fs.writeFile(serverPath, FAKE_LSP_SERVER)

      await Instance.provide({
        directory: sandbox.path,
        fn: async () => {
          const handle = spawnFakeLspServer(serverPath)
          let client: LSPClient.Info | undefined
          let stderr = ""
          handle.process.stderr.on("data", (chunk) => {
            stderr += chunk.toString()
          })

          try {
            client = await LSPClient.create({
              serverID: "p05-fake",
              server: handle,
              root: sandbox.path,
            })

            const waitInitialDiagnostics = client.waitForDiagnostics({ path: filePath })
            await client.notify.open({ path: filePath })
            await waitInitialDiagnostics

            const diagnostics = client.diagnostics.get(path.resolve(filePath)) ?? []
            expect(diagnostics).toHaveLength(1)
            expect(diagnostics[0]?.message).toBe("Found BROKEN token")
            expect(diagnostics[0]?.range.start.line).toBe(0)
            expect(diagnostics[0]?.range.start.character).toBe(0)

            const completionRequest = {
              textDocument: { uri: pathToFileURL(filePath).href },
              position: { line: 0, character: 0 },
            }
            const completionA = await client.connection.sendRequest("textDocument/completion", completionRequest)
            const completionB = await client.connection.sendRequest("textDocument/completion", completionRequest)
            expect(completionLabels(completionA)).toEqual(["alpha", "beta"])
            expect(completionLabels(completionB)).toEqual(["alpha", "beta"])

            await fs.writeFile(filePath, "const fixed = true\n")
            const waitClearedDiagnostics = client.waitForDiagnostics({ path: filePath })
            await client.notify.open({ path: filePath })
            await waitClearedDiagnostics

            const clearedDiagnostics = client.diagnostics.get(path.resolve(filePath)) ?? []
            expect(clearedDiagnostics).toEqual([])
            expect(stderr.trim()).toBe("")
          } finally {
            await client?.shutdown().catch(() => {})
            if (!handle.process.killed) handle.process.kill()
          }
        },
      })
    } finally {
      await sandbox[Symbol.asyncDispose]()
    }
  })
})
