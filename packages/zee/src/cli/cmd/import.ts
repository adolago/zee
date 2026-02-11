import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { EOL } from "os"

async function fetchShareData(base: string, slug: string, attempts = 3) {
  const url = `${base}/api/share/${slug}`
  let lastError: string | undefined

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "Accept": "application/json" },
      })

      if (response.ok) {
        return { ok: true as const, data: await response.json() }
      }

      if (response.status === 404) {
        return { ok: false as const, status: 404, message: `Share not found: ${slug}` }
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false as const,
          status: response.status,
          message: "Unauthorized to access this share. Check link permissions.",
        }
      }
      lastError = `Server responded with ${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }

  return {
    ok: false as const,
    status: 0,
    message: `Failed to fetch share data after ${attempts} attempts: ${lastError ?? "unknown error"}`,
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: any
              parts: any[]
            }>
          }
        | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        let parsed: URL
        try {
          parsed = new URL(args.file)
        } catch {
          process.stdout.write(`Invalid URL format. Expected: <share-base>/share/<slug> or <share-base>/s/<slug>`)
          process.stdout.write(EOL)
          return
        }

        const slugMatch = parsed.pathname.match(/\/(?:share|s)\/([a-zA-Z0-9_-]+)/)
        if (!slugMatch) {
          process.stdout.write(`Invalid URL format. Expected: <share-base>/share/<slug> or <share-base>/s/<slug>`)
          process.stdout.write(EOL)
          return
        }

        const slug = slugMatch[1]
        const result = await fetchShareData(parsed.origin, slug)
        if (!result.ok) {
          process.stdout.write(result.message)
          process.stdout.write(EOL)
          return
        }

        const data = result.data

        if (!data.info || !data.messages || Object.keys(data.messages).length === 0) {
          process.stdout.write(`Share not found: ${slug}`)
          process.stdout.write(EOL)
          return
        }

        exportData = {
          info: data.info,
          messages: Object.values(data.messages).map((msg: any) => {
            const { parts, ...info } = msg
            return {
              info,
              parts,
            }
          }),
        }
      } else {
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)

      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
