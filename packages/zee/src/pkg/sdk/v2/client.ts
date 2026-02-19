export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import {
  ZeeClient as GeneratedZeeClient,
  Session as GeneratedSession,
  Project as GeneratedProject,
  Worktree as GeneratedWorktree,
  Auth3 as GeneratedAuth,
  Instance as GeneratedInstance,
  File as GeneratedFile,
  Find as GeneratedFind,
  Permission as GeneratedPermission,
  type Options,
} from "./gen/sdk.gen.js"
import type {
  Part,
  Message,
  Session,
  SessionStatus,
  PermissionRequest,
  QuestionRequest,
  FileDiff,
  Todo,
  Project,
  Auth,
} from "./gen/types.gen.js"

// Event types for SSE streaming - these match the server's event types
export type EventSessionStatus = {
  type: "session.status"
  properties: {
    sessionID: string
    status: SessionStatus
  }
}

export type EventSessionError = {
  type: "session.error"
  properties: {
    sessionID: string
    error: {
      name: string
      message: string
      data?: unknown
    }
  }
}

export type EventMessagePartUpdated = {
  type: "message.part.updated"
  properties: {
    part: Part
    delta?: string
  }
}

export type EventMessageUpdated = {
  type: "message.updated"
  properties: {
    info: Message
  }
}

export type EventMessageRemoved = {
  type: "message.removed"
  properties: {
    sessionID: string
    messageID: string
  }
}

export type EventMessagePartRemoved = {
  type: "message.part.removed"
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export type EventPermissionUpdated = {
  type: "permission.updated"
  properties: PermissionRequest
}

export type EventPermissionAsked = {
  type: "permission.asked"
  properties: PermissionRequest
}

export type EventPermissionReplied = {
  type: "permission.replied"
  properties: {
    sessionID: string
    permissionID: string
    requestID: string
    response: string
  }
}

export type EventQuestionAsked = {
  type: "question.asked"
  properties: QuestionRequest
}

export type EventQuestionReplied = {
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventQuestionRejected = {
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventSessionCreated = {
  type: "session.created"
  properties: {
    info: Session
  }
}

export type EventSessionUpdated = {
  type: "session.updated"
  properties: {
    info: Session
  }
}

export type EventSessionDeleted = {
  type: "session.deleted"
  properties: {
    info: Session
  }
}

export type EventSessionDiff = {
  type: "session.diff"
  properties: {
    sessionID: string
    diff: FileDiff[]
  }
}

export type EventSessionIdle = {
  type: "session.idle"
  properties: {
    sessionID: string
  }
}

export type EventSessionCompacted = {
  type: "session.compacted"
  properties: {
    sessionID: string
  }
}

export type EventTodoUpdated = {
  type: "todo.updated"
  properties: {
    sessionID: string
    todos: Todo[]
  }
}

export type EventLspUpdated = {
  type: "lsp.updated"
  properties: Record<string, unknown>
}

export type EventFileWatcherUpdated = {
  type: "file.watcher.updated"
  properties: {
    file: string
    event: "add" | "change" | "unlink" | "create" | "delete"
  }
}

export type EventServerInstanceDisposed = {
  type: "server.instance.disposed"
  properties: Record<string, unknown>
}

export type EventVcsBranchUpdated = {
  type: "vcs.branch.updated"
  properties: {
    branch: string
  }
}

export type EventGlobalDisposed = {
  type: "global.disposed"
  properties: Record<string, unknown>
}

export type EventProjectUpdated = {
  type: "project.updated"
  properties: Project
}

export type EventWorktreeReady = {
  type: "worktree.ready"
  properties: {
    directory: string
  }
}

export type EventWorktreeFailed = {
  type: "worktree.failed"
  properties: {
    directory: string
    message: string
  }
}

export type EventPtyCreated = {
  type: "pty.created"
  properties: {
    id: string
  }
}

export type EventPtyUpdated = {
  type: "pty.updated"
  properties: {
    id: string
  }
}

export type EventPtyExited = {
  type: "pty.exited"
  properties: {
    id: string
    exitCode: number
  }
}

export type EventPtyDeleted = {
  type: "pty.deleted"
  properties: {
    id: string
  }
}

// Union of all SSE event types
export type Event =
  | EventSessionStatus
  | EventSessionError
  | EventMessagePartUpdated
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartRemoved
  | EventPermissionUpdated
  | EventPermissionAsked
  | EventPermissionReplied
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventSessionDiff
  | EventSessionIdle
  | EventSessionCompacted
  | EventTodoUpdated
  | EventLspUpdated
  | EventFileWatcherUpdated
  | EventServerInstanceDisposed
  | EventVcsBranchUpdated
  | EventGlobalDisposed
  | EventProjectUpdated
  | EventWorktreeReady
  | EventWorktreeFailed
  | EventPtyCreated
  | EventPtyUpdated
  | EventPtyExited
  | EventPtyDeleted

export type GlobalEvent = {
  directory: string
  payload: Event
}

// Command type from command list (name is optional for compatibility with API)
export type Command = {
  id: string
  name?: string
  description: string
  usage: string
  examples: string[]
}

// Extended LocalProject type with commands
export type LocalProject = {
  id: string
  worktree: string
  vcsDir?: string
  vcs?: "git"
  time: {
    created: number
    initialized?: number
  }
  commands?: {
    start?: string
  }
}

// Config accessor for global.config.get()/update() pattern
class GlobalConfigAccessor {
  constructor(private sdk: GeneratedZeeClient) {}

  get<ThrowOnError extends boolean = false>(options?: any) {
    return this.sdk.config.get(options)
  }

  update<ThrowOnError extends boolean = false>(params?: any, options?: any) {
    return this.sdk.config.update(params, options)
  }
}

// Global accessor class that wraps methods for sdk.global.* pattern
class GlobalAccessor {
  private _config?: GlobalConfigAccessor

  constructor(private sdk: GeneratedZeeClient) {}

  get config(): GlobalConfigAccessor {
    return (this._config ??= new GlobalConfigAccessor(this.sdk))
  }

  async event<ThrowOnError extends boolean = false>(options?: any) {
    const response = await this.sdk.event.global(options)
    // Create a streaming interface that the app expects
    const stream = (async function* () {
      // The global event endpoint returns SSE - we need to handle the stream
      // For now, yield from the response if it's iterable
      if (response.data && Symbol.asyncIterator in Object(response.data)) {
        yield* response.data as AsyncIterable<GlobalEvent>
      }
    })()
    return { ...response, stream }
  }

  dispose<ThrowOnError extends boolean = false>(options?: any) {
    return this.sdk.instance.dispose(options)
  }

  health<ThrowOnError extends boolean = false>(options?: any) {
    return this.sdk.health.check(options)
  }
}

// Extended Session class that accepts directory parameter (ignores it - uses header instead)
class ExtendedSession extends GeneratedSession {
  // Override methods to accept and strip the 'directory' parameter
  override messages<ThrowOnError extends boolean = false>(
    parameters: { sessionID: string; limit?: number; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.messages(rest, options)
  }

  override update<ThrowOnError extends boolean = false>(
    parameters: {
      sessionID: string
      title?: string
      time?: { archived?: number }
      directory?: string
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.update(rest as any, options)
  }

  override delete<ThrowOnError extends boolean = false>(
    parameters: { sessionID: string; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.delete(rest, options)
  }

  // Override list to accept 'roots' parameter (ignored)
  override list<ThrowOnError extends boolean = false>(
    parameters?: {
      start?: number
      search?: string
      directory?: string
      limit?: number
      roots?: boolean
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { roots: _, ...rest } = parameters ?? {}
    return super.list(rest, options)
  }

  // Override share to accept directory parameter
  override share<ThrowOnError extends boolean = false>(
    parameters: { sessionID: string; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.share(rest, options)
  }

  // Override unshare to accept directory parameter
  override unshare<ThrowOnError extends boolean = false>(
    parameters: { sessionID: string; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.unshare(rest, options)
  }

  override command<ThrowOnError extends boolean = false>(
    parameters: Parameters<GeneratedSession["command"]>[0] & {
      mode?: "plan" | "accept" | "bypass"
      directory?: string
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.command(rest as Parameters<GeneratedSession["command"]>[0], options)
  }

  // Set session mode (plan/accept/bypass)
  mode<ThrowOnError extends boolean = false>(
    parameters: { sessionID: string; mode: "plan" | "accept" | "bypass"; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return (options?.client ?? this.client).patch<
      { ok: boolean; mode: "plan" | "accept" | "bypass" },
      unknown,
      ThrowOnError
    >({
      url: `/session/${rest.sessionID}/mode`,
      body: { mode: rest.mode },
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    })
  }

  // Steer a running session by injecting a user message into the active turn.
  // expectedTurnID must match the current active turn.
  override steer<ThrowOnError extends boolean = false>(
    parameters: Parameters<GeneratedSession["steer"]>[0] & { directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.steer<ThrowOnError>(rest as Parameters<GeneratedSession["steer"]>[0], options)
  }
}

// Extended File class that accepts directory parameter
// Use wrapper pattern since status() has different signature
class ExtendedFile {
  private file: GeneratedFile
  protected client: any

  constructor(args: { client: any }) {
    this.file = new GeneratedFile(args)
    this.client = args.client
  }

  list<ThrowOnError extends boolean = false>(
    parameters: { path: string; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return this.file.list(rest, options)
  }

  read<ThrowOnError extends boolean = false>(
    parameters: { path: string; directory?: string },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return this.file.read(rest, options)
  }

  // Accept optional directory parameter (ignored)
  status<ThrowOnError extends boolean = false>(
    parametersOrOptions?: { directory?: string } | Options<never, ThrowOnError>,
    options?: Options<never, ThrowOnError>,
  ) {
    // If first arg looks like Options, pass it directly
    const opts =
      options ??
      (parametersOrOptions && !("directory" in parametersOrOptions)
        ? (parametersOrOptions as Options<never, ThrowOnError>)
        : undefined)
    return this.file.status(opts)
  }
}

// Extended Find class that accepts directory parameter
class ExtendedFind extends GeneratedFind {
  override files<ThrowOnError extends boolean = false>(
    parameters: {
      query: string
      dirs?: "true" | "false"
      type?: "file" | "directory"
      limit?: number
      directory?: string
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return super.files(rest, options)
  }
}

// Extended Permission class that accepts directory parameter
// Use wrapper pattern since list() has different signature
class ExtendedPermission {
  private permission: GeneratedPermission
  protected client: any

  constructor(args: { client: any }) {
    this.permission = new GeneratedPermission(args)
    this.client = args.client
  }

  // Accept optional directory parameter (ignored)
  list<ThrowOnError extends boolean = false>(
    parametersOrOptions?: { directory?: string } | Options<never, ThrowOnError>,
    options?: Options<never, ThrowOnError>,
  ) {
    // If first arg looks like Options, pass it directly
    const opts =
      options ??
      (parametersOrOptions && !("directory" in parametersOrOptions)
        ? (parametersOrOptions as Options<never, ThrowOnError>)
        : undefined)
    return this.permission.list(opts)
  }

  reply<ThrowOnError extends boolean = false>(
    parameters: {
      requestID: string
      reply?: "once" | "always" | "reject"
      message?: string
      directory?: string
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters
    return this.permission.reply(rest, options)
  }

  respond<ThrowOnError extends boolean = false>(
    parameters: {
      sessionID: string
      permissionID: string
      response?: "once" | "always" | "reject"
    },
    options?: Options<never, ThrowOnError>,
  ) {
    return this.permission.respond(parameters, options)
  }
}

// Extended Instance class that accepts directory parameter
// Use wrapper pattern since dispose() has different signature
class ExtendedInstance {
  private instance: GeneratedInstance
  protected client: any

  constructor(args: { client: any }) {
    this.instance = new GeneratedInstance(args)
    this.client = args.client
  }

  // Accept optional directory parameter (ignored)
  dispose<ThrowOnError extends boolean = false>(
    parametersOrOptions?: { directory?: string } | Options<never, ThrowOnError>,
    options?: Options<never, ThrowOnError>,
  ) {
    // If first arg looks like Options, pass it directly
    const opts =
      options ??
      (parametersOrOptions && !("directory" in parametersOrOptions)
        ? (parametersOrOptions as Options<never, ThrowOnError>)
        : undefined)
    return this.instance.dispose(opts)
  }

  dispose2<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>) {
    return this.instance.dispose2(options)
  }
}

// Extended Project class that accepts directory and commands parameters
class ExtendedProject extends GeneratedProject {
  override update<ThrowOnError extends boolean = false>(
    parameters: {
      projectID: string
      name?: string
      icon?: { url?: string; override?: string; color?: string }
      directory?: string
      commands?: { start?: string }
    },
    options?: Options<never, ThrowOnError>,
  ) {
    // Strip directory and commands - not supported by server
    const { directory: _, commands: __, ...rest } = parameters
    return super.update(rest, options)
  }
}

// Extended Worktree class that adds missing methods and accepts directory param
class ExtendedWorktree extends GeneratedWorktree {
  // Override create to accept directory parameter
  override create<ThrowOnError extends boolean = false>(
    parameters?: {
      worktreeCreateInput?: any
      directory?: string
    },
    options?: Options<never, ThrowOnError>,
  ) {
    const { directory: _, ...rest } = parameters ?? {}
    return super.create(rest, options)
  }

  // Stub methods that don't exist on the server
  async remove<ThrowOnError extends boolean = false>(
    parameters: { directory?: string; worktreeRemoveInput?: { directory: string } },
    options?: Options<never, ThrowOnError>,
  ): Promise<{ data: boolean }> {
    // These methods don't exist on the server - return failure
    console.warn("worktree.remove() is not implemented on the server")
    return { data: false }
  }

  async reset<ThrowOnError extends boolean = false>(
    parameters: { directory?: string; worktreeResetInput?: { directory: string } },
    options?: Options<never, ThrowOnError>,
  ): Promise<{ data: boolean }> {
    console.warn("worktree.reset() is not implemented on the server")
    return { data: false }
  }
}

// Extended Auth class that accepts 'auth' parameter alongside 'body'
class ExtendedAuth extends GeneratedAuth {
  override set<ThrowOnError extends boolean = false>(
    parameters: {
      providerID: string
      body?: Auth | { api_key: string }
      auth?: Auth | { type: string; key: string }
    },
    options?: Options<never, ThrowOnError>,
  ) {
    // Transform 'auth' to 'body' if provided
    let body = parameters.body
    if (!body && parameters.auth) {
      const auth = parameters.auth
      if ("type" in auth && auth.type === "api" && "key" in auth) {
        body = { api_key: auth.key }
      } else {
        body = auth as Auth
      }
    }
    return super.set({ providerID: parameters.providerID, body }, options)
  }
}

// Extended ZeeClient that adds the global accessor and extended classes
export class ZeeClient extends GeneratedZeeClient {
  private _global?: GlobalAccessor
  private _extSession?: ExtendedSession
  private _extProject?: ExtendedProject
  private _extWorktree?: ExtendedWorktree
  private _extAuth?: ExtendedAuth
  private _extFind?: ExtendedFind
  private _extFile?: ExtendedFile
  private _extPermission?: ExtendedPermission
  private _extInstance?: ExtendedInstance

  get global(): GlobalAccessor {
    return (this._global ??= new GlobalAccessor(this as unknown as GeneratedZeeClient))
  }

  // Override accessors to return extended versions
  override get session(): ExtendedSession {
    return (this._extSession ??= new ExtendedSession({ client: (this as any).client }))
  }

  override get project(): ExtendedProject {
    return (this._extProject ??= new ExtendedProject({ client: (this as any).client }))
  }

  override get worktree(): ExtendedWorktree {
    return (this._extWorktree ??= new ExtendedWorktree({ client: (this as any).client }))
  }

  override get auth(): ExtendedAuth {
    return (this._extAuth ??= new ExtendedAuth({ client: (this as any).client }))
  }

  override get find(): ExtendedFind {
    return (this._extFind ??= new ExtendedFind({ client: (this as any).client }))
  }

  // Use type assertions for wrapper classes that need signature changes
  // @ts-expect-error - Wrapper class has different signature to accept directory param
  override get file(): ExtendedFile {
    return (this._extFile ??= new ExtendedFile({ client: (this as any).client }))
  }

  // @ts-expect-error - Wrapper class has different signature to accept directory param
  override get permission(): ExtendedPermission {
    return (this._extPermission ??= new ExtendedPermission({ client: (this as any).client }))
  }

  // @ts-expect-error - Wrapper class has different signature to accept directory param
  override get instance(): ExtendedInstance {
    return (this._extInstance ??= new ExtendedInstance({ client: (this as any).client }))
  }
}

export type ZeeClientConfig = Config

export function createZeeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    config.headers = {
      ...config.headers,
      "x-zee-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new ZeeClient({ client })
}
