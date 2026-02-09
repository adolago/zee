/**
 * WhatsApp Gateway Tests
 *
 * Tests for the WhatsApp gateway message handling and command processing.
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { createMockWhatsAppApi } from "../mock/whatsapp-api"

describe("WhatsApp Gateway", () => {
  let mockApi: ReturnType<typeof createMockWhatsAppApi>

  beforeEach(() => {
    mockApi = createMockWhatsAppApi()
  })

  describe("Mock Client", () => {
    it("should initialize successfully", async () => {
      await mockApi.client.initialize()
      expect(mockApi.isInitialized).toBe(true)
      expect(mockApi.isAuthenticated).toBe(true)
    })

    it("should emit ready event after initialization", async () => {
      let readyEmitted = false
      mockApi.client.on("ready", () => {
        readyEmitted = true
      })
      await mockApi.client.initialize()
      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(readyEmitted).toBe(true)
    })

    it("should send messages and track them", async () => {
      await mockApi.client.initialize()
      const chatId = "1234567890@c.us"
      const message = "Hello, this is a test message"

      await mockApi.client.sendMessage(chatId, message)

      const sent = mockApi.getSentMessages()
      expect(sent.length).toBe(1)
      expect(sent[0].to).toBe(chatId)
      expect(sent[0].body).toBe(message)
    })

    it("should receive messages and emit events", async () => {
      await mockApi.client.initialize()

      let receivedMessage: any = null
      mockApi.client.on("message", (msg) => {
        receivedMessage = msg
      })

      const from = "9876543210@c.us"
      const body = "Incoming test message"
      mockApi.receiveMessage(from, body)

      expect(receivedMessage).not.toBeNull()
      expect(receivedMessage.body).toBe(body)
      expect(receivedMessage.from).toBe(from)
    })

    it("should handle message replies", async () => {
      await mockApi.client.initialize()

      const from = "9876543210@c.us"
      const msg = mockApi.receiveMessage(from, "Hello")

      const replyText = "Hello back!"
      const reply = await msg.reply(replyText)

      expect(reply.body).toBe(replyText)
      expect(reply.fromMe).toBe(true)
      expect(reply.to).toBe(from)

      // Check it was tracked
      const sent = mockApi.getSentMessages()
      expect(sent.some((m) => m.body === replyText)).toBe(true)
    })

    it("should get chat info from message", async () => {
      await mockApi.client.initialize()

      mockApi.addContact({
        number: "5551234567",
        name: "Test Contact",
        pushname: "TestUser",
      })

      const from = "5551234567@c.us"
      const msg = mockApi.receiveMessage(from, "Test")

      const chat = await msg.getChat()
      expect(chat.id._serialized).toBe(from)
      expect(chat.isGroup).toBe(false)
    })

    it("should get contact info from message", async () => {
      await mockApi.client.initialize()

      mockApi.addContact({
        number: "5551234567",
        name: "Test Contact",
        pushname: "TestUser",
      })

      const from = "5551234567@c.us"
      const msg = mockApi.receiveMessage(from, "Test")

      const contact = await msg.getContact()
      expect(contact.number).toBe("5551234567")
      expect(contact.pushname).toBe("TestUser")
    })

    it("should handle destroy", async () => {
      await mockApi.client.initialize()
      expect(mockApi.isInitialized).toBe(true)

      let disconnectedEmitted = false
      mockApi.client.on("disconnected", () => {
        disconnectedEmitted = true
      })

      await mockApi.client.destroy()

      expect(mockApi.isInitialized).toBe(false)
      expect(mockApi.isAuthenticated).toBe(false)
      expect(disconnectedEmitted).toBe(true)
    })

    it("should list all contacts", async () => {
      await mockApi.client.initialize()

      mockApi.addContact({ number: "111", name: "Contact 1" })
      mockApi.addContact({ number: "222", name: "Contact 2" })

      const contacts = await mockApi.client.getContacts()
      expect(contacts.length).toBeGreaterThanOrEqual(3) // Default + 2 added
    })
  })

  describe("Error Handling", () => {
    it("should throw on initialize error", async () => {
      mockApi = createMockWhatsAppApi({
        errorMethods: new Set(["initialize"]),
      })

      await expect(mockApi.client.initialize()).rejects.toThrow("Mock initialization error")
    })

    it("should throw on sendMessage error", async () => {
      mockApi = createMockWhatsAppApi({
        errorMethods: new Set(["sendMessage"]),
      })

      await mockApi.client.initialize()
      await expect(mockApi.client.sendMessage("123@c.us", "test")).rejects.toThrow("Mock send message error")
    })
  })

  describe("QR Code Flow", () => {
    it("should emit QR code when required", async () => {
      mockApi = createMockWhatsAppApi({ requireQrScan: true })

      let qrEmitted = false
      mockApi.client.on("qr", () => {
        qrEmitted = true
      })

      // Don't await - we're just checking QR emission
      mockApi.client.initialize()

      // Wait for QR emission
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(qrEmitted).toBe(true)
    })

    it("should authenticate after QR scan simulation", async () => {
      mockApi = createMockWhatsAppApi({ requireQrScan: true })

      let authenticated = false
      mockApi.client.on("authenticated", () => {
        authenticated = true
      })

      await mockApi.client.initialize()

      // Wait for auto-authentication
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(authenticated).toBe(true)
    })
  })
})
