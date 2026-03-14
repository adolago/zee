import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Dictation } from "@/cli/cmd/tui/util/dictation"
import { Log } from "@/util/log"

const log = Log.create({ service: "server:stt" })

const WisprFlowTranscribeInput = z.object({
  audio: z.string().describe("Base64-encoded WAV audio"),
})

const WisprFlowTranscribeResponse = z.object({
  success: z.boolean(),
  text: z.string().optional(),
  error: z.string().optional(),
})

type WisprFlowTranscribeResponse = z.infer<typeof WisprFlowTranscribeResponse>

export const SttRoute = new Hono().post(
  "/wisprflow",
  describeRoute({
    summary: "Transcribe audio via Wispr Flow",
    description:
      "Transcribe base64-encoded WAV audio using the configured Wispr Flow credentials (same configuration as TUI dictation).",
    operationId: "stt.wisprflow.transcribe",
    responses: {
      200: {
        description: "Transcription result",
        content: {
          "application/json": {
            schema: resolver(WisprFlowTranscribeResponse),
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: resolver(WisprFlowTranscribeResponse),
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: resolver(WisprFlowTranscribeResponse),
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
      const payload: WisprFlowTranscribeResponse = { success: false, error: "Invalid JSON body" }
      return c.json(payload, 400)
    }

    const parsed = WisprFlowTranscribeInput.safeParse(body)
    if (!parsed.success) {
      const payload: WisprFlowTranscribeResponse = { success: false, error: "Invalid request body" }
      return c.json(payload, 400)
    }

    const config = await Dictation.resolveConfig()
    if (!config) {
      const payload: WisprFlowTranscribeResponse = { success: false, error: "Wispr Flow STT not configured" }
      return c.json(payload, 400)
    }

    const audio = Buffer.from(parsed.data.audio, "base64")
    if (audio.length === 0) {
      const payload: WisprFlowTranscribeResponse = { success: false, error: "Audio payload is empty" }
      return c.json(payload, 400)
    }

    try {
      const text = await Dictation.transcribe({ config, audio })
      const payload: WisprFlowTranscribeResponse = { success: true, ...(text ? { text } : {}) }
      return c.json(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("wisprflow transcription failed", { error: message })
      const payload: WisprFlowTranscribeResponse = { success: false, error: message }
      return c.json(payload, 500)
    }
  },
)
