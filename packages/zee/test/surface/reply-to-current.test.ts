import { describe, expect, test } from "bun:test"
import { createMessagingSurface, type MessagingPlatformHandler, type PlatformMessage } from "../../src/surface/messaging"
import { SurfaceRouter } from "../../src/surface/router"
import type { SurfaceMedia } from "../../src/surface/types"

type SendCall = {
  target: string
  text: string
  options?: { replyToId?: string; media?: SurfaceMedia[] }
}

function createFakePlatform() {
  const sendCalls: SendCall[] = []
  let onMessage: ((message: PlatformMessage) => void) | undefined

  const platform: MessagingPlatformHandler = {
    platform: "whatsapp",
    async connect() {},
    async disconnect() {},
    async sendMessage(target, text, options) {
      sendCalls.push({ target, text, options })
    },
    async sendTyping() {},
    onMessage(handler) {
      onMessage = handler
      return () => {
        if (onMessage === handler) onMessage = undefined
      }
    },
  }

  const emit = (message: PlatformMessage) => {
    if (!onMessage) throw new Error("message handler not connected")
    onMessage(message)
  }

  return { platform, sendCalls, emit }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await Bun.sleep(10)
  }
}

describe("messaging reply-to-current routing", () => {
  test("applies replyToId to first outbound chunk only", async () => {
    const fake = createFakePlatform()
    const surface = createMessagingSurface(fake.platform, {
      platform: "whatsapp",
      maxMessageLength: 8,
      chunkDelayMs: 0,
    })
    const router = new SurfaceRouter()
    router.setMessageHandler(async (_message, context) => ({
      text: "reply chunk one and two",
      replyToId: context.messageId,
    }))

    await router.registerSurface(surface)
    await router.init()

    fake.emit({
      id: "wamid.current",
      senderId: "15551234567",
      body: "ping",
      timestamp: Date.now(),
      isGroup: false,
      platform: "whatsapp",
    })

    await waitFor(() => fake.sendCalls.length > 1)

    expect(fake.sendCalls[0]?.target).toBe("15551234567")
    expect(fake.sendCalls[0]?.options?.replyToId).toBe("wamid.current")
    for (const call of fake.sendCalls.slice(1)) {
      expect(call.target).toBe("15551234567")
      expect(call.options?.replyToId).toBeUndefined()
    }

    await router.shutdown()
  })
})
