# OpenCode Integrated Web UI - Documentation Plan

**Migration Planner Report - Phase 5: Documentation & Handoff**
**Target Repository:** https://github.com/anomalyco/opencode.git
**Date:** 2026-02-01

---

## Executive Summary

This document outlines a comprehensive documentation strategy for OpenCode's integrated web UI. Based on analysis of the existing OpenCode documentation (opencode.ai/docs) and proven patterns from agent-core's ADR-based architecture documentation, this plan covers API documentation, component documentation, user guides, and maintenance procedures.

---

## 1. Documentation Structure

### 1.1 Proposed Directory Layout

```
docs/
├── README.md                      # Documentation index and quick start
├── web-ui/                        # Web UI documentation root
│   ├── README.md                  # Web UI overview
│   ├── getting-started/           # Getting started guides
│   │   ├── installation.md
│   │   ├── configuration.md
│   │   └── first-steps.md
│   ├── api/                       # API documentation
│   │   ├── README.md
│   │   ├── rest-api.md
│   │   ├── websocket.md
│   │   ├── types.md
│   │   └── errors.md
│   ├── components/                # Component documentation
│   │   ├── README.md
│   │   ├── architecture.md
│   │   ├── chat-interface.md
│   │   ├── file-explorer.md
│   │   ├── code-editor.md
│   │   ├── terminal-panel.md
│   │   └── settings-panel.md
│   ├── guides/                    # User guides
│   │   ├── user/
│   │   │   ├── README.md
│   │   │   ├── basic-usage.md
│   │   │   ├── keyboard-shortcuts.md
│   │   │   ├── theming.md
│   │   │   └── troubleshooting.md
│   │   └── developer/
│   │       ├── README.md
│   │       ├── contributing.md
│   │       ├── local-development.md
│   │       └── testing.md
│   ├── architecture/              # Architecture documentation (ADRs)
│   │   ├── adr-001-webui-overview.md
│   │   ├── adr-002-component-system.md
│   │   ├── adr-003-state-management.md
│   │   ├── adr-004-communication-protocol.md
│   │   └── adr-005-security-model.md
│   └── maintenance/               # Maintenance documentation
│       ├── deployment.md
│       ├── monitoring.md
│       ├── upgrading.md
│       └── incident-response.md
├── reference/                     # Auto-generated reference
│   ├── api-endpoints.json
│   ├── component-props.json
│   └── type-definitions/
└── examples/                      # Code examples and samples
    ├── react-integration/
    ├── vanilla-js/
    └── custom-components/
```

### 1.2 Documentation Types Matrix

| Document Type | Location | Audience | Update Frequency |
|--------------|----------|----------|------------------|
| ADRs | `docs/web-ui/architecture/` | Developers, Architects | Per major decision |
| API Docs | `docs/web-ui/api/` | Developers, Integrators | Per API change |
| Component Docs | `docs/web-ui/components/` | Developers, Designers | Per component update |
| User Guides | `docs/web-ui/guides/user/` | End Users | Quarterly |
| Dev Guides | `docs/web-ui/guides/developer/` | Contributors | Per workflow change |
| Maintenance | `docs/web-ui/maintenance/` | DevOps, Maintainers | Per release |

---

## 2. API Documentation Plan

### 2.1 REST API Documentation

**Location:** `docs/web-ui/api/rest-api.md`

**Structure:**
```markdown
# REST API Reference

## Base URL
- Development: `http://localhost:8080/api/v1`
- Production: `https://api.opencode.ai/v1`

## Authentication
Bearer token via Authorization header

## Endpoints

### Sessions
- `GET /sessions` - List active sessions
- `POST /sessions` - Create new session
- `GET /sessions/:id` - Get session details
- `DELETE /sessions/:id` - Close session

### Messages
- `POST /sessions/:id/messages` - Send message
- `GET /sessions/:id/messages` - Get message history
- `DELETE /sessions/:id/messages/:msgId` - Delete message

### Files
- `GET /sessions/:id/files` - List session files
- `POST /sessions/:id/files` - Upload file
- `GET /files/:id/content` - Get file content
- `PUT /files/:id/content` - Update file content

### Projects
- `GET /projects` - List projects
- `POST /projects` - Create project
- `GET /projects/:id` - Get project details

## Request/Response Examples
[Include curl examples and JSON schemas]
```

### 2.2 WebSocket API Documentation

**Location:** `docs/web-ui/api/websocket.md`

**Structure:**
```markdown
# WebSocket API Reference

## Connection
- Endpoint: `ws://localhost:8080/ws` or `wss://api.opencode.ai/ws`
- Protocol: `opencode-v1`

## Message Types

### Client → Server
- `message.send` - Send chat message
- `file.edit` - Request file edit
- `command.execute` - Execute terminal command
- `session.create` - Create new session

### Server → Client
- `message.stream` - Streaming response chunk
- `message.complete` - Response complete
- `tool.start` - Tool execution started
- `tool.output` - Tool output (stdout/stderr)
- `tool.complete` - Tool execution complete
- `error` - Error occurred

## Message Schema
[Include TypeScript interfaces and examples]
```

### 2.3 Type Definitions

**Location:** `docs/web-ui/api/types.md`

**Key Types to Document:**

| Type | Description | File |
|------|-------------|------|
| `Session` | Session state and metadata | `src/types/session.ts` |
| `Message` | Chat message structure | `src/types/message.ts` |
| `ToolCall` | Tool execution request | `src/types/tool.ts` |
| `ToolResult` | Tool execution result | `src/types/tool.ts` |
| `FileChange` | File modification event | `src/types/file.ts` |
| `SurfaceCapabilities` | UI capability flags | `src/types/surface.ts` |

### 2.4 Error Handling

**Location:** `docs/web-ui/api/errors.md`

**Error Code Structure:**
```typescript
interface ApiError {
  code: string;        // MACHINE_READABLE_CODE
  message: string;     // Human readable message
  details?: unknown;   // Additional context
  requestId: string;   // For support tracking
}
```

**Standard Error Codes:**
| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing authentication |
| `SESSION_NOT_FOUND` | 404 | Session does not exist |
| `RATE_LIMITED` | 429 | Too many requests |
| `AGENT_BUSY` | 503 | Agent is processing another request |
| `INVALID_MESSAGE` | 400 | Message format invalid |
| `TOOL_EXECUTION_FAILED` | 500 | Tool execution error |

---

## 3. Component Documentation Plan

### 3.1 Component Storybook Structure

**Tool:** Storybook (or equivalent)
**Location:** `src/components/**/*.stories.tsx`

**Story Organization:**
```
.storybook/
├── main.ts
├── preview.tsx
└── theme.ts

src/components/
├── Chat/
│   ├── ChatContainer.tsx
│   ├── ChatContainer.stories.tsx
│   ├── MessageList.tsx
│   ├── MessageList.stories.tsx
│   ├── MessageBubble.tsx
│   ├── MessageBubble.stories.tsx
│   ├── InputBar.tsx
│   └── InputBar.stories.tsx
├── FileExplorer/
│   ├── FileTree.tsx
│   ├── FileTree.stories.tsx
│   ├── FileNode.tsx
│   └── FileNode.stories.tsx
├── Editor/
│   ├── CodeEditor.tsx
│   ├── CodeEditor.stories.tsx
│   ├── DiffViewer.tsx
│   └── DiffViewer.stories.tsx
├── Terminal/
│   ├── TerminalPanel.tsx
│   ├── TerminalPanel.stories.tsx
│   └── TerminalLine.tsx
└── Layout/
    ├── Sidebar.tsx
    ├── ResizablePanel.tsx
    └── StatusBar.tsx
```

### 3.2 Component Documentation Template

Each component should have:

```markdown
# ComponentName

## Overview
Brief description of the component's purpose.

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `prop1` | `string` | - | Required prop description |
| `prop2` | `boolean` | `false` | Optional prop description |

## Usage Examples
\`\`\`tsx
import { ComponentName } from './ComponentName';

// Basic usage
<ComponentName prop1="value" />

// With all props
<ComponentName
  prop1="value"
  prop2={true}
  onEvent={handleEvent}
/>
\`\`\`

## Accessibility
- ARIA roles and attributes
- Keyboard navigation
- Screen reader support

## Styling
- CSS variables used
- Theme customization points
- Responsive behavior

## Testing
- Test IDs for automation
- Mock requirements
```

### 3.3 Key Components to Document

| Component | Priority | Complexity | Dependencies |
|-----------|----------|------------|--------------|
| ChatContainer | P0 | High | MessageList, InputBar, StreamingHandler |
| MessageBubble | P0 | Medium | MarkdownRenderer, CodeBlock |
| FileExplorer | P0 | High | FileTree, FileNode, ContextMenu |
| CodeEditor | P0 | High | Monaco/CM6 integration, LSP client |
| TerminalPanel | P1 | Medium | Xterm.js integration |
| SettingsPanel | P1 | Low | Form components, Theme selector |
| Sidebar | P1 | Low | Navigation, Resizable |
| DiffViewer | P2 | Medium | Diff algorithm, Syntax highlighting |

---

## 4. User Guide Outline

### 4.1 End User Guide Structure

**Location:** `docs/web-ui/guides/user/`

**Table of Contents:**
```markdown
# OpenCode Web UI - User Guide

## 1. Introduction
   1.1 What is OpenCode Web UI?
   1.2 Key Features
   1.3 System Requirements

## 2. Getting Started
   2.1 Accessing the Web UI
   2.2 Creating Your First Session
   2.3 Understanding the Interface

## 3. Basic Usage
   3.1 Sending Messages
   3.2 Uploading Files
   3.3 Viewing Code Changes
   3.4 Using the Terminal

## 4. Advanced Features
   4.1 Keyboard Shortcuts
   4.2 Customizing the Theme
   4.3 Working with Multiple Sessions
   4.4 Exporting Conversations

## 5. Troubleshooting
   5.1 Connection Issues
   5.2 Performance Problems
   5.3 Common Error Messages
   5.4 Getting Help
```

### 4.2 Developer Guide Structure

**Location:** `docs/web-ui/guides/developer/`

**Table of Contents:**
```markdown
# OpenCode Web UI - Developer Guide

## 1. Development Setup
   1.1 Prerequisites
   1.2 Repository Structure
   1.3 Installing Dependencies
   1.4 Running Locally

## 2. Architecture Overview
   2.1 Tech Stack
   2.2 State Management
   2.3 Communication Layer
   2.4 Component Architecture

## 3. Contributing
   3.1 Code Style
   3.2 Commit Conventions
   3.3 Pull Request Process
   3.4 Testing Requirements

## 4. Building and Deploying
   4.1 Build Configuration
   4.2 Environment Variables
   4.3 Docker Deployment
   4.4 Static Hosting

## 5. Extending the UI
   5.1 Creating Custom Components
   5.2 Adding New API Endpoints
   5.3 Theme Customization
   5.4 Plugin Development
```

### 4.3 Quick Reference Cards

**Keyboard Shortcuts (PDF/Printable):**
```
┌─────────────────────────────────────────────────────────────┐
│                    OPENCODE WEB UI                          │
│                   Keyboard Shortcuts                        │
├─────────────────────────────────────────────────────────────┤
│ General                                                     │
│   Ctrl/Cmd + K    Open command palette                      │
│   Ctrl/Cmd + /    Focus chat input                          │
│   Ctrl/Cmd + B    Toggle sidebar                            │
│   Esc             Close modal / Cancel operation            │
├─────────────────────────────────────────────────────────────┤
│ Chat                                                        │
│   Enter           Send message                              │
│   Shift + Enter   New line in message                       │
│   Ctrl/Cmd + C    Cancel streaming response                 │
│   Up Arrow        Edit previous message                     │
├─────────────────────────────────────────────────────────────┤
│ File Explorer                                               │
│   Ctrl/Cmd + P    Quick file open                           │
│   Ctrl/Cmd + N    New file                                  │
│   Delete          Delete selected file                      │
│   F2              Rename file                               │
├─────────────────────────────────────────────────────────────┤
│ Terminal                                                    │
│   Ctrl/Cmd + `    Toggle terminal panel                     │
│   Ctrl/Cmd + C    Copy selection                            │
│   Ctrl/Cmd + V    Paste                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Maintenance Documentation Plan

### 5.1 Deployment Procedures

**Location:** `docs/web-ui/maintenance/deployment.md`

**Sections:**
```markdown
# Deployment Guide

## Environments
- Development: Local development
- Staging: staging.opencode.ai
- Production: opencode.ai

## Pre-deployment Checklist
- [ ] All tests passing
- [ ] Version bumped in package.json
- [ ] Changelog updated
- [ ] Migration scripts tested (if applicable)
- [ ] Security scan completed

## Deployment Steps
1. Build production bundle
2. Run smoke tests
3. Deploy to staging
4. Verify staging
5. Deploy to production
6. Verify production
7. Monitor error rates

## Rollback Procedure
1. Identify last known good version
2. Execute rollback command
3. Verify rollback success
4. Notify team

## Post-deployment Verification
- [ ] Health check endpoints responding
- [ ] Key user flows working
- [ ] Error rates normal
- [ ] Performance metrics acceptable
```

### 5.2 Monitoring and Alerting

**Location:** `docs/web-ui/maintenance/monitoring.md`

**Key Metrics:**

| Metric | Threshold | Alert Channel |
|--------|-----------|---------------|
| Response Time (p95) | > 500ms | PagerDuty |
| Error Rate | > 1% | PagerDuty |
| WebSocket Connections | Drop > 20% | Slack |
| Build Success Rate | < 95% | Email |
| Bundle Size | > 2MB | Slack |

**Dashboards:**
- Application Performance: Grafana
- Error Tracking: Sentry
- User Analytics: PostHog/Amplitude
- Infrastructure: Datadog

### 5.3 Upgrade Procedures

**Location:** `docs/web-ui/maintenance/upgrading.md`

**Version Upgrade Checklist:**
```markdown
## Minor Version Upgrade (e.g., 1.1 → 1.2)

1. Review changelog for breaking changes
2. Update dependencies
3. Run migration scripts if provided
4. Test locally
5. Deploy to staging
6. Deploy to production

## Major Version Upgrade (e.g., 1.x → 2.x)

1. Read migration guide thoroughly
2. Create upgrade branch
3. Update all dependencies
4. Address all breaking changes
5. Run full test suite
6. Beta testing with select users
7. Staged rollout (10% → 50% → 100%)
8. Monitor for issues
```

### 5.4 Incident Response

**Location:** `docs/web-ui/maintenance/incident-response.md`

**Severity Levels:**

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| SEV1 | Critical - Complete outage | 15 minutes | Web UI inaccessible |
| SEV2 | High - Major functionality broken | 1 hour | Chat not working |
| SEV3 | Medium - Partial degradation | 4 hours | Slow file loading |
| SEV4 | Low - Minor issues | 24 hours | UI glitches |

**Incident Response Runbook:**
```markdown
## SEV1 Response

1. Acknowledge alert within 15 minutes
2. Create incident channel
3. Assess impact scope
4. Attempt immediate fix if obvious
5. If no quick fix, initiate rollback
6. Communicate status to users
7. Document timeline
8. Schedule post-mortem

## Communication Templates
- Initial acknowledgment
- Status updates (every 30 min for SEV1)
- All clear notification
- Post-incident summary
```

---

## 6. Architecture Decision Records (ADRs)

### 6.1 Proposed ADRs

| ADR | Title | Status | Priority |
|-----|-------|--------|----------|
| ADR-001 | Web UI Architecture Overview | Proposed | P0 |
| ADR-002 | Component System Design | Proposed | P0 |
| ADR-003 | State Management Strategy | Proposed | P0 |
| ADR-004 | Communication Protocol (WebSocket) | Proposed | P0 |
| ADR-005 | Security Model | Proposed | P0 |
| ADR-006 | Styling and Theming | Proposed | P1 |
| ADR-007 | Build and Deployment Pipeline | Proposed | P1 |

### 6.2 ADR Template

```markdown
# ADR-XXX: Title

## Status
- Proposed / Accepted / Deprecated / Superseded by ADR-YYY

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing or have agreed to implement?

## Consequences
What becomes easier or more difficult to do and any risks introduced?

### Positive
- Benefit 1
- Benefit 2

### Negative
- Trade-off 1
- Trade-off 2

## Alternatives Considered
### Alternative 1: Name
Description and why it was rejected.

### Alternative 2: Name
Description and why it was rejected.

## References
- Link to related ADRs
- External documentation
- Discussion threads

## Sign-off
- **Author:** Name
- **Date:** YYYY-MM-DD
- **Reviewers:** Names
```

---

## 7. Documentation Tooling Recommendations

### 7.1 Recommended Stack

| Purpose | Tool | Alternative |
|---------|------|-------------|
| Documentation Site | VitePress / Docusaurus | MkDocs, GitBook |
| API Documentation | OpenAPI + Swagger UI | Postman, Insomnia |
| Component Docs | Storybook | Ladle, Histoire |
| Type Docs | TypeDoc | api-extractor |
| Diagrams | Mermaid | PlantUML, Excalidraw |
| Search | Algolia DocSearch | Pagefind |

### 7.2 Automated Documentation

**GitHub Actions Workflow:**
```yaml
name: Documentation

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'src/**/*.ts'
      - 'src/**/*.tsx'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        
      - name: Install dependencies
        run: npm ci
        
      - name: Generate API docs
        run: npm run docs:api
        
      - name: Build Storybook
        run: npm run storybook:build
        
      - name: Build documentation site
        run: npm run docs:build
        
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs/.vitepress/dist
```

---

## 8. Migration and Handoff Checklist

### 8.1 Documentation Migration Tasks

- [ ] Create new documentation directory structure
- [ ] Migrate existing documentation
- [ ] Write API documentation (REST + WebSocket)
- [ ] Create component stories
- [ ] Write user guides
- [ ] Write developer guides
- [ ] Create maintenance documentation
- [ ] Set up documentation site
- [ ] Configure automated documentation generation
- [ ] Add search functionality
- [ ] Set up analytics

### 8.2 Handoff Deliverables

| Deliverable | Location | Format | Status |
|-------------|----------|--------|--------|
| Documentation Plan | `docs/web-ui/README.md` | Markdown | Proposed |
| API Reference | `docs/web-ui/api/` | Markdown + OpenAPI | Planned |
| Component Library | Storybook | Interactive | Planned |
| User Guide | `docs/web-ui/guides/user/` | Markdown | Planned |
| Developer Guide | `docs/web-ui/guides/developer/` | Markdown | Planned |
| ADRs | `docs/web-ui/architecture/` | Markdown | Planned |
| Maintenance Runbooks | `docs/web-ui/maintenance/` | Markdown | Planned |

### 8.3 Success Criteria

- Documentation is discoverable and searchable
- API documentation is complete and accurate
- All components have usage examples
- User guide covers all major features
- Developer guide enables contribution within 30 minutes
- Maintenance procedures are tested and verified
- Documentation is versioned with releases

---

## 9. Implementation Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1 | Week 1 | Set up documentation infrastructure, create ADRs |
| Phase 2 | Week 2-3 | Write API documentation, set up Storybook |
| Phase 3 | Week 4-5 | Write user guides, create component docs |
| Phase 4 | Week 6 | Write developer guides, maintenance docs |
| Phase 5 | Week 7 | Review, polish, launch documentation site |

---

## 10. Appendices

### A. Glossary

| Term | Definition |
|------|------------|
| Session | A conversation context between user and AI |
| Surface | UI platform (CLI, GUI, Messaging) |
| Streaming | Real-time response delivery |
| Tool Call | Request for AI to execute a tool |
| AGENTS.md | Project-specific agent instructions file |

### B. Related Documentation

- [OpenCode Main Docs](https://opencode.ai/docs)
- [Agent-Core ADRs](../../docs/architecture/)
- [Surface Layer ADR](../../docs/architecture/ADR-001-SURFACE-LAYER.md)

### C. Resources

- [VitePress Documentation](https://vitepress.dev/)
- [Storybook Documentation](https://storybook.js.org/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [ADR GitHub Organization](https://adr.github.io/)

---

**Document Control:**
- **Version:** 1.0
- **Author:** Migration Planner (Hive Mind)
- **Date:** 2026-02-01
- **Status:** Proposed
