import { mock } from "bun:test"

// --- CallTracker ---
// Records method calls with args for assertion

export interface TrackedCall {
  args: unknown[]
  timestamp: number
}

export class CallTracker {
  private calls: Map<string, TrackedCall[]> = new Map()

  track(name: string) {
    return (...args: unknown[]) => {
      const list = this.calls.get(name) ?? []
      list.push({ args, timestamp: Date.now() })
      this.calls.set(name, list)
      return { data: undefined, error: undefined }
    }
  }

  get(name: string): TrackedCall[] {
    return this.calls.get(name) ?? []
  }

  last(name: string): TrackedCall | undefined {
    const list = this.calls.get(name)
    return list?.at(-1)
  }

  count(name: string): number {
    return (this.calls.get(name) ?? []).length
  }

  reset() {
    this.calls.clear()
  }
}

// --- Mock SDK Client ---

export function createMockSDKClient() {
  const tracker = new CallTracker()
  const client = {
    permission: {
      reply: tracker.track("permission.reply"),
    },
    question: {
      reply: tracker.track("question.reply"),
      reject: tracker.track("question.reject"),
    },
    session: {
      create: tracker.track("session.create"),
      chat: tracker.track("session.chat"),
      abort: tracker.track("session.abort"),
      list: tracker.track("session.list"),
      get: tracker.track("session.get"),
      messages: tracker.track("session.messages"),
      todo: tracker.track("session.todo"),
      diff: tracker.track("session.diff"),
      status: tracker.track("session.status"),
    },
    config: {
      get: tracker.track("config.get"),
      providers: tracker.track("config.providers"),
    },
    provider: {
      list: tracker.track("provider.list"),
      auth: tracker.track("provider.auth"),
    },
    app: {
      agents: tracker.track("app.agents"),
    },
    command: {
      list: tracker.track("command.list"),
    },
    lsp: {
      status: tracker.track("lsp.status"),
    },
    mcp: {
      status: tracker.track("mcp.status"),
      connect: tracker.track("mcp.connect"),
      disconnect: tracker.track("mcp.disconnect"),
    },
    experimental: {
      resource: {
        list: tracker.track("experimental.resource.list"),
      },
    },
    formatter: {
      status: tracker.track("formatter.status"),
    },
    vcs: {
      get: tracker.track("vcs.get"),
    },
    path: {
      get: tracker.track("path.get"),
    },
  }
  return { client, tracker }
}

// --- Permission Request Factory ---

let permissionIdCounter = 0

export function createPermissionRequest(overrides: Partial<{
  id: string
  sessionID: string
  permission: string
  metadata: Record<string, unknown>
  always: string[]
  tool: { messageID: string; callID: string }
  patterns: string[]
}> = {}) {
  permissionIdCounter++
  return {
    id: overrides.id ?? `perm-${permissionIdCounter}`,
    sessionID: overrides.sessionID ?? "session-1",
    permission: overrides.permission ?? "bash",
    metadata: overrides.metadata ?? {},
    always: overrides.always ?? ["*"],
    tool: overrides.tool ?? { messageID: "msg-1", callID: "call-1" },
    patterns: overrides.patterns ?? [],
  }
}

export function resetPermissionIdCounter() {
  permissionIdCounter = 0
}

// --- Question Request Factory ---

let questionIdCounter = 0

export function createQuestionRequest(overrides: Partial<{
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
}> = {}) {
  questionIdCounter++
  return {
    id: overrides.id ?? `question-${questionIdCounter}`,
    sessionID: overrides.sessionID ?? "session-1",
    questions: overrides.questions ?? [
      {
        question: "Which option?",
        header: "Choice",
        options: [
          { label: "Option A", description: "First option" },
          { label: "Option B", description: "Second option" },
        ],
        multiple: false,
        custom: true,
      },
    ],
  }
}

export function resetQuestionIdCounter() {
  questionIdCounter = 0
}

// --- Common Mock Modules ---

export function setupCommonMocks() {
  mock.module("@opentui/solid", () => ({
    useKeyboard: () => {},
    useRenderer: () => ({
      root: { getChildren: () => [] },
      currentFocusedRenderable: null,
      getSelection: () => null,
      clearSelection: () => {},
    }),
    useTerminalDimensions: () => () => ({ width: 120, height: 40 }),
    Portal: () => null,
  }))

  mock.module("@opentui/core", () => {
    class MockRGBA {
      r = 0; g = 0; b = 0; a = 0
      constructor(r = 0, g = 0, b = 0, a = 0) { this.r = r; this.g = g; this.b = b; this.a = a }
      static fromInts(r: number, g: number, b: number, a: number) { return new MockRGBA(r, g, b, a) }
      static fromHex(_hex: string) { return new MockRGBA(0, 0, 0, 255) }
      static fromValues(r: number, g: number, b: number, a: number) { return new MockRGBA(r, g, b, a) }
    }
    return {
      RGBA: MockRGBA,
      Renderable: class {},
      TextAttributes: class {},
    }
  })

  mock.module("@opentui/solid/jsx-runtime", () => ({
    jsx: () => null,
    jsxs: () => null,
    jsxDEV: () => null,
  }))

  mock.module("@tui/ui/dialog", () => ({
    useDialog: () => ({
      stack: [],
      replace: () => {},
      clear: () => {},
      size: "medium",
      minimal: false,
      setSize: () => {},
      setMinimal: () => {},
    }),
  }))

  mock.module("@tui/context/keybind", () => ({
    useKeybind: () => ({
      match: () => false,
      print: (key: string) => String(key),
      parse: () => ({}),
      savedFocus: null,
    }),
  }))

  mock.module("@tui/context/vim", () => ({
    useVim: () => ({ enabled: false, isInsert: false }),
  }))

  mock.module("@tui/context/theme", () => ({
    useTheme: () => ({
      theme: {
        text: { r: 255, g: 255, b: 255, a: 255 },
        textMuted: { r: 128, g: 128, b: 128, a: 255 },
        primary: { r: 0, g: 120, b: 255, a: 255 },
        secondary: { r: 120, g: 200, b: 255, a: 255 },
        accent: { r: 100, g: 150, b: 230, a: 255 },
        success: { r: 0, g: 200, b: 100, a: 255 },
        warning: { r: 255, g: 200, b: 0, a: 255 },
        error: { r: 255, g: 80, b: 80, a: 255 },
        backgroundMenu: { r: 30, g: 30, b: 30, a: 255 },
        backgroundElement: { r: 40, g: 40, b: 40, a: 255 },
        borderActive: { r: 80, g: 80, b: 80, a: 255 },
        diffAddedBg: { r: 0, g: 50, b: 0, a: 255 },
        diffRemovedBg: { r: 50, g: 0, b: 0, a: 255 },
        diffContextBg: { r: 30, g: 30, b: 30, a: 255 },
        diffHighlightAdded: { r: 0, g: 200, b: 0, a: 255 },
        diffHighlightRemoved: { r: 200, g: 0, b: 0, a: 255 },
        diffLineNumber: { r: 80, g: 80, b: 80, a: 255 },
        diffAddedLineNumberBg: { r: 0, g: 40, b: 0, a: 255 },
        diffRemovedLineNumberBg: { r: 40, g: 0, b: 0, a: 255 },
      },
      syntax: () => ({}),
      all: () => ({}),
      mode: () => "dark",
      set: () => {},
    }),
    selectedForeground: () => ({ r: 0, g: 0, b: 0, a: 255 }),
    tint: () => ({ r: 100, g: 100, b: 100, a: 255 }),
    resolveTheme: () => ({}),
  }))

  mock.module("@tui/component/border", () => ({
    SplitBorder: { customBorderChars: {} },
  }))

  mock.module("@tui/component/textarea-keybindings", () => ({
    useTextareaKeybindings: () => () => ({}),
  }))

  mock.module("@/lsp/language", () => ({
    LANGUAGE_EXTENSIONS: {},
  }))

  mock.module("@/util/keybind", () => ({
    Keybind: {
      parse: () => [{}],
      match: () => false,
    },
  }))

  mock.module("@/util/locale", () => ({
    Locale: {
      titlecase: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    },
  }))

  // Use dynamic getters matching the real Global.Path so tests using the real
  // module still see correct XDG-based paths even if this mock leaks across files.
  const os = require("os")
  const path = require("path")
  const app = "agent-core"
  const xdgData = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  const xdgCache = () => process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
  const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  const xdgState = () => process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  mock.module("@/global", () => ({
    Global: {
      Path: {
        get home() { return process.env.AGENT_CORE_TEST_HOME || os.homedir() },
        get source() { return process.cwd() },
        get data() { return path.join(xdgData(), app) },
        get bin() { return path.join(xdgData(), app, "bin") },
        get log() { return path.join(xdgData(), app, "log") },
        get cache() { return path.join(xdgCache(), app) },
        get config() { return path.join(xdgConfig(), app) },
        get state() { return path.join(xdgState(), app) },
        get tmp() { return path.join(os.tmpdir(), app) },
      },
    },
  }))
}

// --- Mock Context Modules ---

export function createMockSDKModule(opts: {
  client: ReturnType<typeof createMockSDKClient>["client"]
}) {
  const listeners: Array<(e: { details: unknown }) => void> = []
  return {
    useSDK: () => ({
      client: opts.client,
      event: {
        listen: (handler: (e: { details: unknown }) => void) => {
          listeners.push(handler)
        },
        emit: (type: string, event: unknown) => {
          for (const handler of listeners) handler({ details: event })
        },
      },
      url: "http://127.0.0.1:3210",
    }),
    _listeners: listeners,
  }
}

export function createMockSyncModule(opts: {
  permissions?: Record<string, unknown[]>
  questions?: Record<string, unknown[]>
  sessions?: Array<{ id: string; parentID?: string; time?: Record<string, unknown> }>
  config?: Record<string, unknown>
  parts?: Record<string, unknown[]>
} = {}) {
  return {
    useSync: () => ({
      data: {
        permission: opts.permissions ?? {},
        question: opts.questions ?? {},
        session: opts.sessions ?? [],
        config: opts.config ?? {},
        part: opts.parts ?? {},
        provider: [],
        provider_default: {},
        agent: [],
        message: {},
        lsp: [],
        mcp: {},
        mcp_resource: {},
        formatter: [],
        vcs: undefined,
        path: { state: "", config: "", worktree: "", directory: "", home: "" },
      },
      status: "complete",
      ready: true,
      mode: {
        pending: () => null,
        consume: () => null,
      },
    }),
  }
}

export function createMockLocalModule(opts: {
  holdMode?: boolean
  agent?: string
} = {}) {
  const isHold = opts.holdMode ?? true
  return {
    useLocal: () => ({
      mode: {
        isHold: () => isHold,
        isRelease: () => !isHold,
        toggle: () => {},
        setHold: () => {},
        setRelease: () => {},
      },
      agent: {
        current: () => ({
          name: opts.agent ?? "Zee",
          mode: "all",
          permission: [],
          options: {},
        }),
        list: () => [],
        set: () => {},
        move: () => {},
        color: () => ({ r: 100, g: 150, b: 230, a: 255 }),
      },
      model: {
        current: () => ({ providerID: "anthropic", modelID: "claude-3" }),
        parsed: () => ({ provider: "Anthropic", model: "Claude 3", reasoning: false }),
        ready: true,
      },
    }),
  }
}
