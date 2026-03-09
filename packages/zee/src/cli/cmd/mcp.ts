import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { McpOAuthProvider } from "../../mcp/oauth-provider"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Installation } from "../../installation"
import path from "path"
import { Global } from "../../global"
import { modify, applyEdits } from "jsonc-parser"
import { Bus } from "../../bus"

function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

type McpConfigured = Config.Mcp
function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

// Check if this is a shorthand built-in MCP config like { enabled: true }
function isShorthandConfig(config: McpEntry): config is { enabled: boolean } {
  return typeof config === "object" && config !== null && "enabled" in config && !("type" in config)
}

type McpRemote = Extract<McpConfigured, { type: "remote" }>
function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpResourcesCommand)
      .command(McpDebugCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Servers")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const statuses = await MCP.status()

        const serverNames = Array.from(new Set([...Object.keys(mcpServers), ...Object.keys(statuses)])).sort()

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Add servers with: zee mcp add")
          return
        }

        for (const name of serverNames) {
          const serverConfig = mcpServers[name]
          const status = statuses[name]
          const configured = serverConfig && isMcpConfigured(serverConfig) ? serverConfig : undefined
          const shorthand = serverConfig && isShorthandConfig(serverConfig) ? serverConfig : undefined
          const hasOAuth = configured ? isMcpRemote(configured) && !!configured.oauth : false
          const hasStoredTokens = await MCP.hasStoredTokens(name)

          let statusIcon: string
          let statusText: string
          let hint = ""

          if (!status) {
            statusIcon = "○"
            statusText = "not initialized"
          } else if (status.status === "connected") {
            statusIcon = "✓"
            statusText = "connected"
            if (hasOAuth && hasStoredTokens) {
              hint = " (OAuth)"
            }
          } else if (status.status === "disabled") {
            statusIcon = "○"
            statusText = "disabled"
          } else if (status.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = "needs authentication"
          } else if (status.status === "needs_client_registration") {
            statusIcon = "✗"
            statusText = "needs client registration"
            hint = "\n    " + status.error
          } else {
            statusIcon = "✗"
            statusText = "failed"
            hint = "\n    " + status.error
          }

          // Build type hint based on config type
          let typeHint: string
          if (configured) {
            const lifecycle = "lifecycle" in configured && configured.lifecycle ? configured.lifecycle : "eager"
            const directTools = "directTools" in configured ? configured.directTools : undefined
            const directHint =
              typeof directTools === "boolean"
                ? `direct=${directTools ? "all" : "proxy"}`
                : Array.isArray(directTools)
                  ? `direct=${directTools.length} allowlisted`
                  : "direct=all"
            const base = configured.type === "remote" ? configured.url : configured.command.join(" ")
            typeHint = `${base} (${lifecycle}, ${directHint})`
          } else if (shorthand) {
            // Shorthand built-in config
            typeHint = `builtin (enabled: ${shorthand.enabled})`
          } else {
            typeHint = "builtin (auto-enabled)"
          }
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${serverNames.length} server(s)`)
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .command(McpAuthListCommand),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Authentication")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers (remote servers with oauth not explicitly disabled)
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.log.info("Remote MCP servers support OAuth by default. Add a remote server in zee.jsonc:")
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          // Build options with auth status
          const options = await Promise.all(
            oauthServers.map(async ([name, cfg]) => {
              const authStatus = await MCP.getAuthStatus(name)
              const icon = getAuthStatusIcon(authStatus)
              const statusText = getAuthStatusText(authStatus)
              const url = cfg.url
              return {
                label: `${icon} ${name} (${statusText})`,
                value: name,
                hint: url,
              }
            }),
          )

          const selected = await prompts.select({
            message: "Select MCP server to authenticate",
            options,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
          prompts.log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
          prompts.outro("Done")
          return
        }

        // Check if already authenticated
        const authStatus = await MCP.getAuthStatus(serverName)
        if (authStatus === "authenticated") {
          const confirm = await prompts.confirm({
            message: `${serverName} already has valid credentials. Re-authenticate?`,
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        } else if (authStatus === "expired") {
          prompts.log.warn(`${serverName} has expired credentials. Re-authenticating...`)
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        // Subscribe to browser open failure events to show URL for manual opening
        const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
          if (evt.properties.mcpName === serverName) {
            spinner.stop("Could not open browser automatically")
            prompts.log.warn("Please open this URL in your browser to authenticate:")
            prompts.log.info(evt.properties.url)
            spinner.start("Waiting for authorization...")
          }
        })

        try {
          const status = await MCP.authenticate(serverName)

          if (status.status === "connected") {
            spinner.stop("Authentication successful!")
          } else if (status.status === "needs_client_registration") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
            prompts.log.info("Add clientId to your MCP server config:")
            prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
          } else if (status.status === "failed") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
          } else {
            spinner.stop("Unexpected status: " + status.status, 1)
          }
        } catch (error) {
          spinner.stop("Authentication failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        } finally {
          unsubscribe()
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Status")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.outro("Done")
          return
        }

        for (const [name, serverConfig] of oauthServers) {
          const authStatus = await MCP.getAuthStatus(name)
          const icon = getAuthStatusIcon(authStatus)
          const statusText = getAuthStatusText(authStatus)
          const url = serverConfig.url

          prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
        }

        prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
      },
    })
  },
})

export const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Logout")

        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to logout",
            options: serverNames.map((name) => {
              const entry = credentials[name]
              const hasTokens = !!entry.tokens
              const hasClient = !!entry.clientInfo
              let hint = ""
              if (hasTokens && hasClient) hint = "tokens + client"
              else if (hasTokens) hint = "tokens"
              else if (hasClient) hint = "client registration"
              return {
                label: name,
                value: name,
                hint,
              }
            }),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }

        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
})

type McpResourceEntry = {
  key: string
  server: string
  name: string
  uri: string
  mimeType?: string
  description?: string
}

function normalizeMcpResources(resources: Record<string, unknown>): McpResourceEntry[] {
  return Object.entries(resources).map(([key, value]) => {
    const resource = value as Record<string, unknown>
    const mimeType = (resource["mimeType"] ?? resource["mime_type"]) as string | undefined
    return {
      key,
      server: (resource["client"] as string | undefined) ?? "unknown",
      name: (resource["name"] as string | undefined) ?? key,
      uri: (resource["uri"] as string | undefined) ?? "",
      mimeType,
      description: (resource["description"] as string | undefined) ?? "",
    }
  })
}

export const McpResourcesCommand = cmd({
  command: "resources",
  describe: "list and read MCP resources",
  builder: (yargs) => yargs.command(McpResourcesListCommand).command(McpResourcesReadCommand).demandCommand(),
  async handler() {},
})

export const McpResourcesListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP resources",
  builder: (yargs) =>
    yargs
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["text", "json"],
        default: "text",
      })
      .option("server", {
        describe: "filter resources by MCP server name",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const jsonOutput = args.format === "json"
        if (!jsonOutput) {
          UI.empty()
          prompts.intro("MCP Resources")
        }

        const resources = await MCP.resources()
        let entries = normalizeMcpResources(resources)

        if (args.server) {
          entries = entries.filter((entry) => entry.server === args.server)
        }

        entries.sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))

        if (entries.length === 0) {
          if (jsonOutput) {
            console.log("[]")
          } else {
            prompts.log.warn("No MCP resources found")
            prompts.outro("Done")
          }
          return
        }

        if (jsonOutput) {
          console.log(JSON.stringify(entries, null, 2))
          return
        }

        for (const entry of entries) {
          prompts.log.info(`${entry.server}: ${entry.name}`)
          prompts.log.info(`  uri: ${entry.uri || "(no uri)"}`)
          if (entry.mimeType) {
            prompts.log.info(`  type: ${entry.mimeType}`)
          }
          if (entry.description) {
            prompts.log.info(`  description: ${entry.description}`)
          }
        }

        prompts.outro(`${entries.length} resource(s)`)
      },
    })
  },
})

export const McpResourcesReadCommand = cmd({
  command: "read <server> <uri>",
  describe: "read an MCP resource",
  builder: (yargs) =>
    yargs
      .positional("server", {
        describe: "MCP server name",
        type: "string",
      })
      .positional("uri", {
        describe: "resource URI",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["text", "json"],
        default: "text",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const jsonOutput = args.format === "json"
        if (!jsonOutput) {
          UI.empty()
          prompts.intro("MCP Resource")
        }

        const result = await MCP.readResource(args.server as string, args.uri as string)
        if (!result) {
          if (jsonOutput) {
            console.log("null")
          } else {
            prompts.log.error("Failed to read MCP resource")
            prompts.outro("Done")
          }
          return
        }

        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        const contents = Array.isArray((result as { contents?: unknown }).contents)
          ? ((result as { contents?: unknown[] }).contents ?? [])
          : []

        if (contents.length === 0) {
          prompts.log.warn("Resource returned no contents")
          prompts.outro("Done")
          return
        }

        const textParts = contents.filter(
          (item): item is { text: string } => typeof (item as { text?: unknown }).text === "string",
        )

        if (textParts.length === contents.length) {
          console.log(textParts.map((item) => item.text).join("\n"))
          return
        }

        prompts.log.warn("Resource is not plain text. Use --format json for full response.")
        for (const item of contents) {
          const entry = item as Record<string, unknown>
          const uri = (entry["uri"] as string | undefined) ?? "(no uri)"
          const mimeType = (entry["mimeType"] ?? entry["mime_type"]) as string | undefined
          const text = typeof entry["text"] === "string" ? (entry["text"] as string) : undefined
          const blob = typeof entry["blob"] === "string" ? (entry["blob"] as string) : undefined
          prompts.log.info(`  uri: ${uri}`)
          if (mimeType) {
            prompts.log.info(`  type: ${mimeType}`)
          }
          if (text) {
            prompts.log.info(`  text length: ${text.length}`)
          }
          if (blob) {
            prompts.log.info(`  blob length: ${blob.length}`)
          }
        }

        prompts.outro("Done")
      },
    })
  },
})

async function resolveConfigPath(baseDir: string, _global = false) {
  // Canonical config path search
  const candidates = [path.join(baseDir, "zee.jsonc")]

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate
    }
  }

  // Default to zee.jsonc if none exist
  return candidates[0]
}

async function addMcpToConfig(name: string, mcpConfig: Config.Mcp, configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  // Use jsonc-parser to modify while preserving comments
  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)

  return configPath
}

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")

        const project = Instance.project

        // Resolve config paths eagerly for hints
        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveConfigPath(Instance.worktree),
          resolveConfigPath(Global.Path.config, true),
        ])

        // Determine scope
        let configPath = globalConfigPath
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: projectConfigPath,
                hint: projectConfigPath,
              },
              {
                label: "Global",
                value: globalConfigPath,
                hint: globalConfigPath,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
          configPath = scopeResult
        }

        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        const type = await prompts.select({
          message: "Select MCP server type",
          options: [
            {
              label: "Local",
              value: "local",
              hint: "Run a local command",
            },
            {
              label: "Remote",
              value: "remote",
              hint: "Connect to a remote URL",
            },
          ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        if (type === "local") {
          const command = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., zee x @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(command)) throw new UI.CancelledError()

          const mcpConfig: Config.Mcp = {
            type: "local",
            command: command.split(" "),
          }

          await addMcpToConfig(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
          prompts.outro("MCP server added successfully")
          return
        }

        if (type === "remote") {
          const url = await prompts.text({
            message: "Enter MCP server URL",
            placeholder: "e.g., https://example.com/mcp",
            validate: (x) => {
              if (!x) return "Required"
              if (x.length === 0) return "Required"
              const isValid = URL.canParse(x)
              return isValid ? undefined : "Invalid URL"
            },
          })
          if (prompts.isCancel(url)) throw new UI.CancelledError()

          const useOAuth = await prompts.confirm({
            message: "Does this server require OAuth authentication?",
            initialValue: false,
          })
          if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

          let mcpConfig: Config.Mcp

          if (useOAuth) {
            const hasClientId = await prompts.confirm({
              message: "Do you have a pre-registered client ID?",
              initialValue: false,
            })
            if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

            if (hasClientId) {
              const clientId = await prompts.text({
                message: "Enter client ID",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(clientId)) throw new UI.CancelledError()

              const hasSecret = await prompts.confirm({
                message: "Do you have a client secret?",
                initialValue: false,
              })
              if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

              let clientSecret: string | undefined
              if (hasSecret) {
                const secret = await prompts.password({
                  message: "Enter client secret",
                })
                if (prompts.isCancel(secret)) throw new UI.CancelledError()
                clientSecret = secret
              }

              mcpConfig = {
                type: "remote",
                url,
                oauth: {
                  clientId,
                  ...(clientSecret && { clientSecret }),
                },
              }
            } else {
              mcpConfig = {
                type: "remote",
                url,
                oauth: {},
              }
            }
          } else {
            mcpConfig = {
              type: "remote",
              url,
            }
          }

          await addMcpToConfig(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
        }

        prompts.outro("MCP server added successfully")
      },
    })
  },
})

export const McpDebugCommand = cmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Debug")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverName = args.name

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpRemote(serverConfig)) {
          prompts.log.error(`MCP server ${serverName} is not a remote server`)
          prompts.outro("Done")
          return
        }

        if (serverConfig.oauth === false) {
          prompts.log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Server: ${serverName}`)
        prompts.log.info(`URL: ${serverConfig.url}`)

        // Check stored auth status
        const authStatus = await MCP.getAuthStatus(serverName)
        prompts.log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)

        const entry = await McpAuth.get(serverName)
        if (entry?.tokens) {
          prompts.log.info(`  Access token: ${entry.tokens.accessToken.substring(0, 20)}...`)
          if (entry.tokens.expiresAt) {
            const expiresDate = new Date(entry.tokens.expiresAt * 1000)
            const isExpired = entry.tokens.expiresAt < Date.now() / 1000
            prompts.log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
          }
          if (entry.tokens.refreshToken) {
            prompts.log.info(`  Refresh token: present`)
          }
        }
        if (entry?.clientInfo) {
          prompts.log.info(`  Client ID: ${entry.clientInfo.clientId}`)
          if (entry.clientInfo.clientSecretExpiresAt) {
            const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
            prompts.log.info(`  Client secret expires: ${expiresDate.toISOString()}`)
          }
        }

        const spinner = prompts.spinner()
        spinner.start("Testing connection...")

        // Test basic HTTP connectivity first
        try {
          const response = await fetch(serverConfig.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "zee-debug", version: Installation.VERSION },
              },
              id: 1,
            }),
          })

          spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)

          // Check for WWW-Authenticate header
          const wwwAuth = response.headers.get("www-authenticate")
          if (wwwAuth) {
            prompts.log.info(`WWW-Authenticate: ${wwwAuth}`)
          }

          if (response.status === 401) {
            prompts.log.warn("Server returned 401 Unauthorized")

            // Try to discover OAuth metadata
            const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
            const authProvider = new McpOAuthProvider(
              serverName,
              serverConfig.url,
              {
                clientId: oauthConfig?.clientId,
                clientSecret: oauthConfig?.clientSecret,
                scope: oauthConfig?.scope,
              },
              {
                onRedirect: async () => {},
              },
            )

            prompts.log.info("Testing OAuth flow (without completing authorization)...")

            // Try creating transport with auth provider to trigger discovery
            const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
              authProvider,
            })

            try {
              const client = new Client({
                name: "zee-debug",
                version: Installation.VERSION,
              })
              await client.connect(transport)
              prompts.log.success("Connection successful (already authenticated)")
              await client.close()
            } catch (error) {
              if (error instanceof UnauthorizedError) {
                prompts.log.info(`OAuth flow triggered: ${error.message}`)

                // Check if dynamic registration would be attempted
                const clientInfo = await authProvider.clientInformation()
                if (clientInfo) {
                  prompts.log.info(`Client ID available: ${clientInfo.client_id}`)
                } else {
                  prompts.log.info("No client ID - dynamic registration will be attempted")
                }
              } else {
                prompts.log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
          } else if (response.status >= 200 && response.status < 300) {
            prompts.log.success("Server responded successfully (no auth required or already authenticated)")
            const body = await response.text()
            try {
              const json = JSON.parse(body)
              if (json.result?.serverInfo) {
                prompts.log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
              }
            } catch {
              // Not JSON, ignore
            }
          } else {
            prompts.log.warn(`Unexpected status: ${response.status}`)
            const body = await response.text().catch(() => "")
            if (body) {
              prompts.log.info(`Response body: ${body.substring(0, 500)}`)
            }
          }
        } catch (error) {
          spinner.stop("Connection failed", 1)
          prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }

        prompts.outro("Debug complete")
      },
    })
  },
})
