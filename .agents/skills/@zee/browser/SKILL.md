---
name: browser
description: Browser automation skill for web interactions, form filling, screenshots, and interactive SSO flows. Zee-exclusive capability - Stanley and Johny delegate browser tasks to Zee.
version: 2.0.0
author: Artur
tags: [browser, automation, cdp, web, sso]
persona: zee
exclusive: true
---

# Browser Automation (Zee-Exclusive)

> **Zee is the sole browser operator for all personas.** Stanley and Johny delegate browser tasks to Zee.

This skill provides browser automation via Chrome DevTools Protocol (CDP) for direct browser control.

## Native CDP Tools

These tools are available when the browser profile is running:

| Tool | Purpose |
|------|---------|
| `zee:browser-status` | Check browser/profile status |
| `zee:browser-snapshot` | Get ARIA tree with element refs (e.g., `button[3]`, `textbox[1]`) |
| `zee:browser-navigate` | Navigate to URL |
| `zee:browser-click` | Click element by ref |
| `zee:browser-type` | Type into element |
| `zee:browser-fill-form` | Fill multiple form fields at once |
| `zee:browser-screenshot` | Capture screenshot |
| `zee:browser-wait` | Wait for element/text/URL |
| `zee:browser-tabs` | List open tabs |

## Browser Profiles

Manage isolated browser contexts:

| Tool | Purpose |
|------|---------|
| `zee:browser-profiles-list` | List all profiles with status |
| `zee:browser-profiles-create` | Create new isolated profile |
| `zee:browser-profiles-start` | Start browser for profile |
| `zee:browser-profiles-stop` | Stop browser for profile |
| `zee:browser-profiles-reset` | Clear all cookies/storage |

## Workflow

1. **Check status**: `zee:browser-status`
2. **Start profile** (if needed): `zee:browser-profiles-start { profile: "chrome" }`
3. **Navigate**: `zee:browser-navigate { url: "https://example.com" }`
4. **Get element refs**: `zee:browser-snapshot` - returns ARIA tree with refs like `button[0]`, `textbox[1]`
5. **Interact**: `zee:browser-click { ref: "button[0]" }`
6. **Wait**: `zee:browser-wait { waitFor: "text", value: "Success" }`
7. **Screenshot**: `zee:browser-screenshot { fullPage: true }`

## SSO and Authentication Flows

For SSO flows requiring 2FA:

1. Navigate to login page
2. Fill credentials using refs from snapshot
3. Submit the form
4. **Pause for user 2FA** - Ask user to approve on their device
5. Wait for redirect after approval
6. Continue with authenticated actions

### Example: TUWEL (TU Wien) Login

```typescript
// 1. Navigate to TUWEL
zee:browser-navigate({ url: "https://tuwel.tuwien.ac.at" })

// 2. Get snapshot to find login button
zee:browser-snapshot({})
// Returns ARIA tree with refs

// 3. Click TU Wien Login
zee:browser-click({ ref: "link[TU Wien Login]" })

// 4. Fill Austria ID credentials (get refs from snapshot first)
zee:browser-snapshot({})
zee:browser-type({ ref: "textbox[username]", text: "user@example.com" })
zee:browser-type({ ref: "textbox[password]", text: "..." })

// 5. Submit
zee:browser-click({ ref: "button[submit]" })

// 6. Wait for 2FA (user approves on phone)
// Ask user: "Please approve the 2FA request on your device"

// 7. Wait for redirect after 2FA
zee:browser-wait({ waitFor: "url", value: "tuwel.tuwien.ac.at" })

// 8. Continue with authenticated actions
```

## Delegation Rules

### For Stanley and Johny

When a browser task is needed, delegate to zee:

```typescript
// In Stanley or Johny context:
zee:delegate({
  task: "browser-automation",
  description: "Log into TUWEL and fetch exam schedule",
  context: { url: "https://tuwel.tuwien.ac.at" }
})
```

### Why Zee Owns Browser

1. **Security** - Credentials stored in zee's secure memory only
2. **State management** - Browser profiles are persona-specific (port 18800)
3. **Consistency** - Single point of browser automation avoids conflicts
4. **External world** - Zee handles all external interactions

## Configuration

### Enable Browser Tool

In `~/.config/zee/zee.jsonc`:

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

## Troubleshooting

### "CDP connection refused"

1. Check Chrome is running with remote debugging:
   ```bash
   chromium --remote-debugging-port=18800
   ```
2. Or start via zee:
   ```bash
   zee tool zee:browser-profiles-start '{"profile": "chrome"}'
   ```

### "Session expired during SSO"

SSO sessions have timeouts. For long flows:
1. Complete the login first
2. Then perform the authenticated actions
3. Don't pause too long between steps

### Element ref not found

1. Run `zee:browser-snapshot` to get fresh refs
2. Element refs change when the page updates
3. Use descriptive parts of the ref (e.g., `button[Login]` not just `button[0]`)

## agent-browser CLI (Alternative)

When the native CDP tools are unavailable or for complex multi-step automations, use the `agent-browser` CLI:

```bash
npm install -g agent-browser && agent-browser install
```

Core workflow:
```bash
agent-browser open <url>        # Navigate
agent-browser snapshot -i       # Get interactive elements with refs (@e1, @e2)
agent-browser click @e1         # Click by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser screenshot        # Capture
agent-browser close             # Close
```

Key commands: `open`, `snapshot`, `click`, `fill`, `type`, `press`, `select`, `hover`, `wait`, `screenshot`, `pdf`, `eval`, `tab`, `cookies`, `state save/load`, `record start/stop`.

Use `--session <name>` for parallel browser sessions. Use `--json` for machine-readable output.

## See Also

- `tools-reference.md` - Full tool documentation
- `SKILL.md` - Main zee skill with all capabilities
