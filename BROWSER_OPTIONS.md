# Browser Options in Zee

Three different browser implementations are now available:

## 1. `zee:browser` - Zee Gateway Integration

**Location**: `src/domain/zee/browser.ts`

Uses Zee gateway's browser control server (port 18791) via HTTP API.

**Requirements**:
- Zee gateway must be running (`zee daemon --gateway`)
- Browser control enabled in Zee config

**Features**:
- Full Playwright automation
- Chrome extension relay (take over your existing Chrome)
- Multiple profiles (zee, chrome)
- Snapshots, clicks, typing, screenshots
- Tabs management

**Usage**:
```javascript
{ tool: "zee:browser", action: "start", profile: "zee" }
{ tool: "zee:browser", action: "open", url: "https://google.com" }
{ tool: "zee:browser", action: "snapshot", format: "ai" }
```

**Best for**: When Zee gateway is already running, need Chrome extension relay

---

## 2. `zee:browser-standalone` - Direct Chromium Spawn

**Location**: `src/domain/zee/browser-standalone.ts`

Spawns its OWN Chrome instance via CDP (Chrome DevTools Protocol). No Zee gateway needed.

**Requirements**:
- Chrome/Chromium installed on system
- `ws` package (WebSocket client)

**Features**:
- Direct process spawning (kernel.sh approach)
- Headless or GUI mode
- Navigate, screenshot, get content
- Multiple isolated profiles
- Auto-cleanup on exit

**Usage**:
```javascript
{ tool: "zee:browser-standalone", action: "launch", profile: "default" }
{ tool: "zee:browser-standalone", action: "navigate", url: "https://google.com" }
{ tool: "zee:browser-standalone", action: "screenshot", fullPage: true }
```

**Best for**: Standalone operation without Zee gateway, simpler browsing needs

---

## 3. `bash` + Playwright/Puppeteer - Shell Script Approach

**Built-in**: `src/mcp/builtin/bash.ts`

Use the bash tool to run Playwright or Puppeteer scripts directly.

**Requirements**:
- Node.js with Playwright/Puppeteer installed
- Chrome/Chromium

**Usage**:
```javascript
{
  tool: "bash",
  command: "npx playwright screenshot https://google.com screenshot.png",
  description: "Take screenshot with Playwright"
}
```

**Best for**: One-off scripts, complex automation scenarios

---

## Comparison

| Feature | `zee:browser` | `zee:browser-standalone` | `bash` |
|---------|---------------|--------------------------|--------|
| Zee Gateway Required | Yes | No | No |
| Chrome Extension Relay | Yes | No | No |
| Headless Mode | Yes | Yes | Yes |
| GUI Mode | Yes | Yes | Yes |
| Multiple Profiles | Yes | Yes | Manual |
| Snapshots | Yes | Limited | Via script |
| Click/Type | Yes | Limited | Via script |
| Screenshots | Yes | Yes | Yes |
| Complexity | Medium | Low | High |

---

## Recommendation

1. **Use `zee:browser`** if:
   - Zee gateway is already running
   - You need Chrome extension relay
   - You want full Playwright features

2. **Use `zee:browser-standalone`** if:
   - You want standalone operation
   - Simple browsing (navigate, screenshot, content)
   - No Zee gateway dependency

3. **Use `bash`** if:
   - You have existing Playwright/Puppeteer scripts
   - Complex automation not covered by other tools
   - One-off tasks

---

## Voice Calling (Bonus)

**Location**: `packages/zee/Swabble/extensions/voice-call/`

Full voice calling implementation with:
- Providers: Twilio, Telnyx, Plivo, Mock
- Tool: `voice_call`
- CLI: `zee voicecall call/status/speak/end`

See `extensions/voice-call/README.md` for setup.
