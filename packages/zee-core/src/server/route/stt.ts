import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Dictation } from "@/cli/cmd/tui/util/dictation"
import { Log } from "@/util/log"

const log = Log.create({ service: "server:stt" })

const GoogleTranscribeInput = z.object({
  audio: z.string().describe("Base64-encoded WAV audio"),
})

const GoogleTranscribeResponse = z.object({
  success: z.boolean(),
  text: z.string().optional(),
  error: z.string().optional(),
})

type GoogleTranscribeResponse = z.infer<typeof GoogleTranscribeResponse>

export const SttRoute = new Hono().post(
  "/google",
  describeRoute({
    summary: "Transcribe audio via Google Speech-to-Text",
    description:
      "Transcribe base64-encoded WAV audio using the configured Google Speech-to-Text credentials (same configuration as TUI dictation).",
    operationId: "stt.google.transcribe",
    responses: {
      200: {
        description: "Transcription result",
        content: {
          "application/json": {
            schema: resolver(GoogleTranscribeResponse),
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: resolver(GoogleTranscribeResponse),
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: resolver(GoogleTranscribeResponse),
          },
        },
      },
    },
  }),
  async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      const payload: GoogleTranscribeResponse = { success: false, error: "Invalid JSON body" }
      return c.json(payload, 400)
    }

    const parsed = GoogleTranscribeInput.safeParse(body)
    if (!parsed.success) {
      const payload: GoogleTranscribeResponse = { success: false, error: "Invalid request body" }
      return c.json(payload, 400)
    }

    const config = await Dictation.resolveConfig()
    if (!config) {
      const payload: GoogleTranscribeResponse = { success: false, error: "Google STT not configured" }
      return c.json(payload, 400)
    }

    const audio = Buffer.from(parsed.data.audio, "base64")
    if (audio.length === 0) {
      const payload: GoogleTranscribeResponse = { success: false, error: "Audio payload is empty" }
      return c.json(payload, 400)
    }

    try {
      const text = await Dictation.transcribe({ config, audio })
      const payload: GoogleTranscribeResponse = { success: true, ...(text ? { text } : {}) }
      return c.json(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("google transcription failed", { error: message })
      const payload: GoogleTranscribeResponse = { success: false, error: message }
      return c.json(payload, 500)
    }
  },
)
