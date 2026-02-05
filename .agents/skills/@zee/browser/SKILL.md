---
name: browser
description: Browser automation skill for web interactions, form filling, screenshots, and interactive SSO flows. Zee-exclusive capability - Stanley and Johny delegate browser tasks to Zee.
version: 1.0.0
author: Artur
tags: [browser, automation, playwright, web, sso]
persona: zee
exclusive: true
---

# Browser Automation (Zee-Exclusive)

> **Zee is the sole browser operator for all personas.** Stanley and Johny delegate browser tasks to Zee.

This skill provides full browser automation via two backends:
1. **Native CDP** - Chrome DevTools Protocol for direct browser control
2. **claude-flow MCP** - Playwright-based tools for complex automation

## Deferred Tools

Browser automation tools from claude-flow MCP are **deferred** - they must be loaded before use.

### Loading MCP Browser Tools

Before using Playwright-based automation, load the tools:

```
ToolSearch: "browser playwright"
```

This loads:
- `mcp__claude-flow__browser_open` - Navigate to URL
- `mcp__claude-flow__browser_click` - Click elements
- `mcp__claude-flow__browser_fill` - Fill form fields
- `mcp__claude-flow__browser_type` - Type text character by character
- `mcp__claude-flow__browser_press` - Press keyboard keys
- `mcp__claude-flow__browser_hover` - Hover over elements
- `mcp__claude-flow__browser_select` - Select dropdown options
- `mcp__claude-flow__browser_screenshot` - Capture screenshots
- `mcp__claude-flow__browser_snapshot` - Get accessibility tree
- `mcp__claude-flow__browser_wait` - Wait for conditions
- `mcp__claude-flow__browser_eval` - Execute JavaScript

### Native CDP Tools (Always Available)

These are always available when the browser tool is enabled:

| Tool | Purpose |
|------|---------|
| `zee:browser-status` | Check browser/profile status |
| `zee:browser-snapshot` | Get ARIA tree with element refs |
| `zee:browser-navigate` | Navigate to URL |
| `zee:browser-click` | Click element by ref |
| `zee:browser-type` | Type into element |
| `zee:browser-screenshot` | Capture screenshot |
| `zee:browser-wait` | Wait for element/text/URL |
| `zee:browser-tabs` | List open tabs |

## When to Use Which Backend

| Scenario | Backend | Why |
|----------|---------|-----|
| Simple page interactions | Native CDP | Lower latency, always loaded |
| Complex SSO flows | MCP Playwright | Better session handling |
| Multi-step form wizards | MCP Playwright | More reliable waits |
| Screenshots for analysis | Either | Both work well |
| JavaScript execution | MCP Playwright | Safer sandboxing |

## SSO and Authentication Flows

For SSO flows requiring 2FA:

1. Load MCP browser tools: `ToolSearch: "browser"`
2. Open the login page: `mcp__claude-flow__browser_open`
3. Fill credentials: `mcp__claude-flow__browser_fill`
4. Click submit: `mcp__claude-flow__browser_click`
5. **Pause for user 2FA** - Ask user to approve on their device
6. Continue after approval: `mcp__claude-flow__browser_wait`
7. Navigate authenticated pages

### Example: TUWEL (TU Wien) Login

```typescript
// 1. Load tools
ToolSearch({ query: "browser playwright" })

// 2. Navigate to TUWEL
mcp__claude-flow__browser_open({ url: "https://tuwel.tuwien.ac.at" })

// 3. Click TU Wien Login
mcp__claude-flow__browser_click({ target: "text=TU Wien Login" })

// 4. Fill Austria ID credentials
mcp__claude-flow__browser_fill({ target: "#username", value: "user@example.com" })
mcp__claude-flow__browser_fill({ target: "#password", value: "..." })

// 5. Submit
mcp__claude-flow__browser_click({ target: "button[type=submit]" })

// 6. Wait for 2FA (user approves on phone)
// Ask user: "Please approve the 2FA request on your device"

// 7. Wait for redirect after 2FA
mcp__claude-flow__browser_wait({ waitFor: "url", value: "**/tuwel.tuwien.ac.at/**" })

// 8. Continue with authenticated actions
```

## Delegation Rules

### For Stanley and Johny

When a browser task is needed:

```typescript
// In Stanley or Johny context:
zee:delegate({
  task: "browser-automation",
  description: "Log into TUWEL and fetch exam schedule",
  context: { url: "https://tuwel.tuwien.ac.at", credentials: "..." }
})
```

### Why Zee Owns Browser

1. **Security** - Credentials stored in zee's secure memory only
2. **State management** - Browser profiles are persona-specific (port 18800)
3. **Consistency** - Single point of browser automation avoids conflicts
4. **External world** - Zee handles all external interactions

## Configuration

### Enable Browser Tool

In `~/.config/agent-core/agent-core.jsonc`:

```json
{
  "zee": {
    "browser": {
      "enabled": true,
      "defaultProfile": "chrome",
      "profiles": {
        "chrome": {
          "cdpPort": 18800,
          "driver": "zee",
          "color": "#4285F4"
        }
      }
    }
  }
}
```

### Enable MCP Browser Tools

In `.mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["@claude-flow/cli@latest", "mcp", "start"]
    }
  }
}
```

## Troubleshooting

### "Browser tools not found"

MCP tools are deferred. Run `ToolSearch: "browser"` first.

### "CDP connection refused"

1. Check Chrome is running with remote debugging:
   ```bash
   chromium --remote-debugging-port=18800
   ```
2. Or start via zee:
   ```bash
   agent-core tool zee:browser-profiles-start '{"profile": "chrome"}'
   ```

### "Session expired during SSO"

SSO sessions have timeouts. For long flows:
1. Complete the login first
2. Then perform the authenticated actions
3. Don't pause too long between steps

## See Also

- `tools-reference.md` - Full tool documentation
- `../scripts/zee-delegate.ts` - Delegation implementation
