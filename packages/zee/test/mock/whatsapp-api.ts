/**
 * Mock WhatsApp API for testing
 *
 * Provides mock responses for whatsapp-web.js to enable testing
 * without real WhatsApp connection or QR code scanning.
 */

export interface MockWhatsAppContact {
  id: { _serialized: string; user: string }
  number: string
  name?: string
  pushname?: string
  isMe: boolean
  isUser: boolean
  isGroup: boolean
  isWAContact: boolean
}

export interface MockWhatsAppChat {
  id: { _serialized: string; user?: string }
  name: string
  isGroup: boolean
  isReadOnly: boolean
  unreadCount: number
  timestamp: number
  archived: boolean
  pinned: boolean
}

export interface MockWhatsAppMessage {
  id: { _serialized: string; fromMe: boolean }
  body: string
  type: "chat" | "image" | "video" | "audio" | "document" | "sticker"
  timestamp: number
  from: string
  to: string
  fromMe: boolean
  hasMedia: boolean
  isStatus: boolean
  isForwarded: boolean
  links: string[]
  mentionedIds: string[]
  reply: (text: string) => Promise<MockWhatsAppMessage>
  getChat: () => Promise<MockWhatsAppChat>
  getContact: () => Promise<MockWhatsAppContact>
}

export interface MockWhatsAppApiOptions {
  /** Simulate QR code scanning */
  requireQrScan?: boolean
  /** Pre-configured contacts */
  contacts?: MockWhatsAppContact[]
  /** Pre-configured messages */
  messages?: Omit<MockWhatsAppMessage, "reply" | "getChat" | "getContact">[]
  /** Simulate errors */
  errorMethods?: Set<string>
  /** Network delay simulation */
  delay?: number
}

export interface MockWhatsAppClientEvents {
  qr: (qr: string) => void
  ready: () => void
  authenticated: () => void
  auth_failure: (msg: string) => void
  disconnected: (reason: string) => void
  message: (message: MockWhatsAppMessage) => void
  message_create: (message: MockWhatsAppMessage) => void
  message_ack: (message: MockWhatsAppMessage, ack: number) => void
}

const DEFAULT_CONTACT: MockWhatsAppContact = {
  id: { _serialized: "1234567890@c.us", user: "1234567890" },
  number: "1234567890",
  name: "Test User",
  pushname: "Test",
  isMe: false,
  isUser: true,
  isGroup: false,
  isWAContact: true,
}

const DEFAULT_CHAT: MockWhatsAppChat = {
  id: { _serialized: "1234567890@c.us", user: "1234567890" },
  name: "Test User",
  isGroup: false,
  isReadOnly: false,
  unreadCount: 0,
  timestamp: Date.now(),
  archived: false,
  pinned: false,
}

export function createMockWhatsAppApi(options: MockWhatsAppApiOptions = {}) {
  const {
    requireQrScan = false,
    contacts = [DEFAULT_CONTACT],
    messages = [],
    errorMethods = new Set(),
    delay = 0,
  } = options

  let initialized = false
  let authenticated = false
  let messageIdCounter = 1
  const eventListeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: Array<{
    to: string
    body: string
    timestamp: number
    messageId: string
  }> = []
  const pendingMessages = [...messages]
  const contactMap = new Map(contacts.map((c) => [c.id._serialized, c]))

  async function simulateDelay() {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  function emit(event: string, ...args: any[]) {
    const listeners = eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (e) {
          console.error(`Mock WhatsApp event handler error (${event}):`, e)
        }
      }
    }
  }

  function createMessage(data: Omit<MockWhatsAppMessage, "reply" | "getChat" | "getContact">): MockWhatsAppMessage {
    const contact = contactMap.get(data.from) || DEFAULT_CONTACT
    const chat: MockWhatsAppChat = {
      ...DEFAULT_CHAT,
      id: { _serialized: data.from, user: data.from.replace("@c.us", "") },
      name: contact.pushname || contact.name || "Unknown",
    }

    return {
      ...data,
      reply: async (text: string) => {
        await simulateDelay()
        const replyMsg = createMessage({
          id: { _serialized: `reply_${messageIdCounter++}`, fromMe: true },
          body: text,
          type: "chat",
          timestamp: Date.now(),
          from: "me",
          to: data.from,
          fromMe: true,
          hasMedia: false,
          isStatus: false,
          isForwarded: false,
          links: [],
          mentionedIds: [],
        })
        sentMessages.push({
          to: data.from,
          body: text,
          timestamp: Date.now(),
          messageId: replyMsg.id._serialized,
        })
        return replyMsg
      },
      getChat: async () => {
        await simulateDelay()
        return chat
      },
      getContact: async () => {
        await simulateDelay()
        return contact
      },
    }
  }

  const mockClient = {
    /**
     * Register event listener
     */
    on<K extends keyof MockWhatsAppClientEvents>(event: K, handler: MockWhatsAppClientEvents[K]) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set())
      }
      eventListeners.get(event)!.add(handler)
      return mockClient
    },

    /**
     * Remove event listener
     */
    off<K extends keyof MockWhatsAppClientEvents>(event: K, handler: MockWhatsAppClientEvents[K]) {
      const listeners = eventListeners.get(event)
      if (listeners) {
        listeners.delete(handler)
      }
      return mockClient
    },

    /**
     * Remove event listener (alias)
     */
    removeListener<K extends keyof MockWhatsAppClientEvents>(event: K, handler: MockWhatsAppClientEvents[K]) {
      return this.off(event, handler)
    },

    /**
     * Initialize the client
     */
    async initialize(): Promise<void> {
      await simulateDelay()

      if (errorMethods.has("initialize")) {
        throw new Error("Mock initialization error")
      }

      if (requireQrScan && !authenticated) {
        // Emit QR code for scanning
        emit("qr", "mock-qr-code-data-url")
        // Simulate user scanning after a short delay
        setTimeout(() => {
          authenticated = true
          emit("authenticated")
          emit("ready")
        }, 100)
      } else {
        authenticated = true
        emit("authenticated")
        emit("ready")
      }

      initialized = true
    },

    /**
     * Destroy the client
     */
    async destroy(): Promise<void> {
      await simulateDelay()
      initialized = false
      authenticated = false
      emit("disconnected", "logout")
    },

    /**
     * Send a message
     */
    async sendMessage(
      chatId: string,
      content: string,
      _options?: { quotedMessageId?: string },
    ): Promise<MockWhatsAppMessage> {
      await simulateDelay()

      if (errorMethods.has("sendMessage")) {
        throw new Error("Mock send message error")
      }

      const msg = createMessage({
        id: { _serialized: `sent_${messageIdCounter++}`, fromMe: true },
        body: content,
        type: "chat",
        timestamp: Date.now(),
        from: "me",
        to: chatId,
        fromMe: true,
        hasMedia: false,
        isStatus: false,
        isForwarded: false,
        links: [],
        mentionedIds: [],
      })

      sentMessages.push({
        to: chatId,
        body: content,
        timestamp: Date.now(),
        messageId: msg.id._serialized,
      })

      emit("message_create", msg)
      return msg
    },

    /**
     * Get chat by ID
     */
    async getChatById(chatId: string): Promise<MockWhatsAppChat> {
      await simulateDelay()
      const contact = contactMap.get(chatId)
      return {
        ...DEFAULT_CHAT,
        id: { _serialized: chatId, user: chatId.replace("@c.us", "") },
        name: contact?.pushname || contact?.name || "Unknown",
      }
    },

    /**
     * Get contact by ID
     */
    async getContactById(contactId: string): Promise<MockWhatsAppContact> {
      await simulateDelay()
      return contactMap.get(contactId) || DEFAULT_CONTACT
    },

    /**
     * Get all chats
     */
    async getChats(): Promise<MockWhatsAppChat[]> {
      await simulateDelay()
      return Array.from(contactMap.values()).map((contact) => ({
        ...DEFAULT_CHAT,
        id: contact.id,
        name: contact.pushname || contact.name || "Unknown",
      }))
    },

    /**
     * Get all contacts
     */
    async getContacts(): Promise<MockWhatsAppContact[]> {
      await simulateDelay()
      return Array.from(contactMap.values())
    },

    /**
     * Check if client is ready
     */
    get info() {
      return authenticated
        ? {
            wid: { _serialized: "myphone@c.us" },
            pushname: "MyName",
          }
        : null
    },
  }

  return {
    client: mockClient,

    /**
     * Simulate receiving a message
     */
    receiveMessage(from: string, body: string, type: "chat" | "image" = "chat") {
      const msg = createMessage({
        id: { _serialized: `recv_${messageIdCounter++}`, fromMe: false },
        body,
        type,
        timestamp: Date.now(),
        from,
        to: "me",
        fromMe: false,
        hasMedia: type !== "chat",
        isStatus: false,
        isForwarded: false,
        links: [],
        mentionedIds: [],
      })
      emit("message", msg)
      return msg
    },

    /**
     * Add a contact
     */
    addContact(contact: Partial<MockWhatsAppContact> & { number: string }) {
      const id = `${contact.number}@c.us`
      const fullContact: MockWhatsAppContact = {
        ...DEFAULT_CONTACT,
        ...contact,
        id: { _serialized: id, user: contact.number },
      }
      contactMap.set(id, fullContact)
    },

    /**
     * Get all sent messages
     */
    getSentMessages() {
      return [...sentMessages]
    },

    /**
     * Get the last sent message
     */
    getLastSentMessage() {
      return sentMessages[sentMessages.length - 1]
    },

    /**
     * Clear sent messages history
     */
    clearSentMessages() {
      sentMessages.length = 0
    },

    /**
     * Emit an event directly
     */
    emit,

    /**
     * Check if client is initialized
     */
    get isInitialized() {
      return initialized
    },

    /**
     * Check if client is authenticated
     */
    get isAuthenticated() {
      return authenticated
    },
  }
}
