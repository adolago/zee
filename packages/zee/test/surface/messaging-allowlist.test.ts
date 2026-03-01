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

async function waitFor(predicate: () => boolean, timeoutMs = 300) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await Bun.sleep(10)
  }
}

async function waitQuiet(ms = 120) {
  await Bun.sleep(ms)
}

describe("messaging allowlist normalization", () => {
  test("matches allowed senders case-insensitively", async () => {
    const fake = createFakePlatform()
    const surface = createMessagingSurface(fake.platform, {
      platform: "whatsapp",
      allowedSenders: ["Alice-User"],
      groups: { enabled: true, requireMention: false, allowedGroups: [], mentionPatterns: [] },
    })
    const router = new SurfaceRouter()
    router.setMessageHandler(async () => ({ text: "ok" }))

    await router.registerSurface(surface)
    await router.init()

    fake.emit({
      id: "m1",
      senderId: "alice-user",
      body: "hello",
      timestamp: Date.now(),
      isGroup: false,
      platform: "whatsapp",
    })

    await waitFor(() => fake.sendCalls.length > 0)
    expect(fake.sendCalls[0]?.target).toBe("alice-user")

    await router.shutdown()
  })

  test("fails closed when sender is empty and allowlist is configured", async () => {
    const fake = createFakePlatform()
    const surface = createMessagingSurface(fake.platform, {
      platform: "whatsapp",
      allowedSenders: ["15551234567"],
      groups: { enabled: true, requireMention: false, allowedGroups: [], mentionPatterns: [] },
    })
    const router = new SurfaceRouter()
    router.setMessageHandler(async () => ({ text: "ok" }))

    await router.registerSurface(surface)
    await router.init()

    fake.emit({
      id: "m2",
      senderId: "   ",
      body: "hello",
      timestamp: Date.now(),
      isGroup: false,
      platform: "whatsapp",
    })

    await waitQuiet()
    expect(fake.sendCalls.length).toBe(0)

    await router.shutdown()
  })

  test("matches allowed group IDs case-insensitively", async () => {
    const fake = createFakePlatform()
    const surface = createMessagingSurface(fake.platform, {
      platform: "whatsapp",
      allowedSenders: ["*"],
      groups: { enabled: true, requireMention: false, allowedGroups: ["TEAM-ROOM"], mentionPatterns: [] },
    })
    const router = new SurfaceRouter()
    router.setMessageHandler(async () => ({ text: "ok" }))

    await router.registerSurface(surface)
    await router.init()

    fake.emit({
      id: "m3",
      senderId: "15551234567",
      body: "hello group",
      timestamp: Date.now(),
      isGroup: true,
      groupId: "team-room",
      groupName: "Team Room",
      wasMentioned: true,
      platform: "whatsapp",
    })

    await waitFor(() => fake.sendCalls.length > 0)
    expect(fake.sendCalls[0]?.target).toBe("team-room")

    await router.shutdown()
  })

  test("fails closed when group allowlist is configured but groupId is missing", async () => {
    const fake = createFakePlatform()
    const surface = createMessagingSurface(fake.platform, {
      platform: "whatsapp",
      allowedSenders: ["*"],
      groups: { enabled: true, requireMention: false, allowedGroups: ["team-room"], mentionPatterns: [] },
    })
    const router = new SurfaceRouter()
    router.setMessageHandler(async () => ({ text: "ok" }))

    await router.registerSurface(surface)
    await router.init()

    fake.emit({
      id: "m4",
      senderId: "15551234567",
      body: "hello group",
      timestamp: Date.now(),
      isGroup: true,
      wasMentioned: true,
      platform: "whatsapp",
    })

    await waitQuiet()
    expect(fake.sendCalls.length).toBe(0)

    await router.shutdown()
  })
})

