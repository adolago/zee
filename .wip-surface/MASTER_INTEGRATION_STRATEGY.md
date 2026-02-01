# Master Integration Strategy: OpenCode Web UI Integration

**Document Version:** 1.0  
**Date:** 2026-02-01  
**Status:** Strategic Planning Phase  

---

## 1. Executive Summary

This document outlines the master integration strategy for incorporating the OpenCode web UI into the agent-core ecosystem. The OpenCode project provides a sophisticated SolidJS-based component library with 20+ production-ready components, a comprehensive design token system, and a mature dialog-based interaction model. Integrating these components will enable agent-core to offer a unified web-based interface alongside its existing TUI, creating a multi-surface experience that serves both terminal-centric power users and users who prefer graphical interfaces.

The integration strategy takes a phased approach, beginning with foundational component extraction and adaptation from SolidJS to React, progressing through adapter layer development for seamless communication between OpenCode's client/server architecture and agent-core's persona-based backend, and culminating in a unified deployment that leverages agent-core's Qdrant-backed semantic memory and triad persona system (Zee, Stanley, Johny). The architecture preserves OpenCode's design philosophy while adapting implementation details for the React ecosystem and agent-core's unique capabilities.

Critical success factors include maintaining visual parity with OpenCode's terminal-inspired aesthetic, ensuring seamless state synchronization between surfaces, and preserving the accessibility-first approach built into the original components. The integration will be delivered through a sidecar deployment model where OpenCode and agent-core run as co-located services, providing local-first operation with optional cloud connectivity for memory synchronization across devices.

---

## 2. Architecture Overview

### 2.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           MASTER INTEGRATION ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           USER INTERFACE LAYER                               │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │   │
│  │  │   OpenCode TUI   │  │  OpenCode Web    │  │  Agent-Core TUI  │          │   │
│  │  │   (Terminal)     │  │  (React + UI)    │  │  (Bun/TUI)       │          │   │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘          │   │
│  │           │                     │                     │                     │   │
│  │           └─────────────────────┼─────────────────────┘                     │   │
│  │                                 │                                           │   │
│  │                                 ▼                                           │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                   │                                                  │
│  ┌────────────────────────────────▼─────────────────────────────────────────────┐   │
│  │                        ADAPTER & ORCHESTRATION LAYER                          │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │   │
│  │  │  OpenCode       │  │  Session        │  │  Tool           │              │   │
│  │  │  Adapter        │  │  Bridge         │  │  Bridge         │              │   │
│  │  │  (React/Solid)  │  │  (State Sync)   │  │  (Tool Registry)│              │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │   │
│  │           │                    │                    │                        │   │
│  │           └────────────────────┼────────────────────┘                        │   │
│  │                                │                                              │   │
│  │           ┌────────────────────┴────────────────────┐                        │   │
│  │           │         Config & Auth Bridge            │                        │   │
│  │           └────────────────────┬────────────────────┘                        │   │
│  └────────────────────────────────┼─────────────────────────────────────────────┘   │
│                                   │                                                  │
│  ┌────────────────────────────────▼─────────────────────────────────────────────┐   │
│  │                         AGENT-CORE BACKEND LAYER                              │   │
│  │  ┌────────────────────────────────────────────────────────────────────────┐  │   │
│  │  │                    Daemon Server (Port 3210)                            │  │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │  │   │
│  │  │  │   Surface   │  │   Persona   │  │   Memory    │  │   Session   │    │  │   │
│  │  │  │   Router    │  │   Router    │  │   Service   │  │   Manager   │    │  │   │
│  │  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────────┘    │  │   │
│  │  │         │                │                │                            │  │   │
│  │  │         └────────────────┼────────────────┘                            │  │   │
│  │  │                          │                                             │  │   │
│  │  │         ┌────────────────┼────────────────┐                            │  │   │
│  │  │         ▼                ▼                ▼                            │  │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │  │   │
│  │  │  │     ZEE     │  │   STANLEY   │  │    JOHNY    │                     │  │   │
│  │  │  │  Personal   │  │  Investing  │  │  Learning   │                     │  │   │
│  │  │  │  Assistant  │  │  Platform   │  │  System     │                     │  │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘                     │  │   │
│  │  └────────────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                               │   │
│  │  ┌────────────────────────────────────────────────────────────────────────┐  │   │
│  │  │                   Qdrant Vector Database (Port 6333)                    │  │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │  │   │
│  │  │  │  Semantic   │  │  Session    │  │   Persona   │                      │  │   │
│  │  │  │   Memory    │  │   History   │  │    State    │                      │  │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘                      │  │   │
│  │  └────────────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Communication Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              COMMUNICATION FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  User Input (OpenCode Web)                                                          │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  1. React Component Event                                                      │  │
│  │     - Button click, form submit, dialog action                                 │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  2. OpenCode Client (HTTP/WebSocket)                                          │  │
│  │     - Session management, tool execution requests                              │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  3. Adapter Layer                                                              │  │
│  │     - Translates OpenCode protocol to agent-core format                        │  │
│  │     - Maps session IDs, tool names, message formats                            │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  4. Agent-Core SDK                                                             │  │
│  │     - HTTP client to daemon (localhost:3210)                                   │  │
│  │     - Authentication headers, request formatting                               │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  5. Persona Router                                                             │  │
│  │     - @zee → Personal Assistant                                                │  │
│  │     - @stanley → Investing Platform                                            │  │
│  │     - @johny → Learning System                                                 │  │
│  │     - Default → Zee                                                            │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  6. Response Flow (Reverse Path)                                               │  │
│  │     - Persona response → Adapter → OpenCode → React UI                         │  │
│  │     - Streaming via Server-Sent Events (SSE)                                   │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Technology Stack Mapping

| Layer | OpenCode (Source) | Agent-Core Integration | Notes |
|-------|-------------------|------------------------|-------|
| **Framework** | SolidJS | React 18+ | Fine-grained → Virtual DOM |
| **Primitives** | Kobalte | Radix UI | Headless UI libraries |
| **Styling** | Tailwind v4 + CSS | Tailwind v4 + CSS | Design tokens preserved |
| **State** | Signals/Stores | Hooks/Context | Pattern adaptation required |
| **Icons** | Built-in SVG | Lucide React | Style-matched alternatives |
| **Dialogs** | Custom + Kobalte | Radix Dialog | Animation parity needed |
| **Lists** | Custom virtualization | @tanstack/react-virtual | Equivalent functionality |
| **Forms** | Kobalte forms | React Hook Form | Validation mapping |

---

## 3. Component Extraction Plan

### 3.1 Tier 1: Essential Core Components (Week 1-2)

| Priority | Component | Effort | Notes |
|----------|-----------|--------|-------|
| P0 | Button | 1 day | Primary, secondary, ghost variants |
| P0 | IconButton | 1 day | Toolbar actions, icon sizing |
| P0 | Icon | 2 days | 60+ icons, size variants |
| P0 | Dialog | 3 days | Modal system, transitions |
| P0 | Tooltip | 1 day | Hover/focus tooltips |
| P0 | Spinner | 0.5 day | Loading indicator |
| P1 | Tag | 0.5 day | Badges, labels |
| P1 | Avatar | 1 day | User/project identity |
| P1 | Switch | 1 day | Toggle states |
| P1 | Card | 1 day | Content containers |

### 3.2 Tier 2: Form & Input Components (Week 2-3)

| Priority | Component | Effort | Notes |
|----------|-----------|--------|-------|
| P0 | TextField | 2 days | Input, textarea, validation |
| P0 | List | 3 days | Virtualized, searchable |
| P1 | Select | 2 days | Dropdown with grouping |
| P1 | Checkbox | 1 day | Toggle with label |
| P1 | RadioGroup | 1 day | Segmented controls |
| P2 | Keybind | 0.5 day | Keyboard shortcut display |

### 3.3 Tier 3: Navigation & Layout Components (Week 3-4)

| Priority | Component | Effort | Notes |
|----------|-----------|--------|-------|
| P0 | Tabs | 2 days | Normal, pill, settings variants |
| P1 | Popover | 1 day | Floating content |
| P1 | DropdownMenu | 2 days | Context menus |
| P1 | Accordion | 1 day | Collapsible sections |
| P2 | Toast | 2 days | Notification system |
| P2 | Markdown | 2 days | Syntax highlighting |

### 3.4 Tier 4: Application-Specific Dialogs (Week 4-5)

| Priority | Component | Effort | Notes |
|----------|-----------|--------|-------|
| P1 | DialogSelectProvider | 2 days | OAuth/API provider selection |
| P1 | DialogSelectModel | 2 days | AI model selection |
| P2 | DialogManageModels | 1 day | Model visibility |
| P2 | DialogEditProject | 1 day | Project settings |
| P2 | DialogSelectDirectory | 2 days | Directory picker |
| P2 | DialogSelectFile | 2 days | File/command palette |

### 3.5 Extraction Summary

- **Total Components:** 28
- **P0 (Critical):** 10 components
- **P1 (Important):** 12 components
- **P2 (Nice-to-have):** 6 components
- **Estimated Effort:** 5 weeks (1 developer)

---

## 4. Integration Phases

### Phase 1: Foundation & Setup (Week 1)

**Objective:** Establish the UI package foundation with design system and core primitives.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Create `packages/ui/` package structure | 1 day | Package scaffolding |
| Set up Tailwind v4 with CSS-first config | 1 day | Build configuration |
| Migrate design tokens (colors.css, theme.css) | 2 days | CSS custom properties |
| Set up Radix UI primitives | 1 day | Component foundation |
| Implement Button, Icon, IconButton | 2 days | First usable components |
| Create component documentation template | 1 day | Storybook/Docs setup |

**Week 1 Deliverables:**
- Functional UI package with 3 core components
- Design token system (12 color scales, spacing, typography)
- Build pipeline configured

### Phase 2: Core Component Implementation (Week 2)

**Objective:** Build essential interactive components for dialog-based workflows.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Implement Dialog system with Radix | 2 days | Modal foundation |
| Implement Tooltip component | 1 day | UX enhancement |
| Implement Spinner, Tag, Avatar | 2 days | Visual components |
| Implement TextField (input/textarea) | 2 days | Form foundation |
| Implement Switch component | 1 day | Toggle controls |

**Week 2 Deliverables:**
- 8 additional components (11 total)
- Dialog provider context
- Form primitive foundation

### Phase 3: Advanced Components (Week 3)

**Objective:** Implement complex components for data display and navigation.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Implement List with virtualization | 2 days | Searchable lists |
| Implement Tabs (all variants) | 2 days | Navigation patterns |
| Implement Select component | 2 days | Dropdown selection |
| Implement Checkbox, RadioGroup | 2 days | Form controls |

**Week 3 Deliverables:**
- 5 additional components (16 total)
- Complete form control set
- Virtualized list capability

### Phase 4: Application Components & Adapter (Week 4)

**Objective:** Build application-specific dialogs and adapter layer.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Implement DropdownMenu, Popover | 2 days | Navigation menus |
| Implement Accordion, Toast | 2 days | Content organization |
| Create adapter package structure | 1 day | `packages/opencode-adapter/` |
| Implement Session Bridge | 2 days | Session mapping |
| Implement Tool Bridge | 2 days | Tool registry mapping |

**Week 4 Deliverables:**
- 4 additional components (20 total)
- Adapter layer scaffold
- Session and tool bridges functional

### Phase 5: Integration & Testing (Week 5)

**Objective:** Complete integration, testing, and deployment preparation.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Implement Config Bridge | 2 days | Configuration sync |
| Implement Auth Bridge | 2 days | Authentication flow |
| Create application dialogs | 2 days | Provider, model dialogs |
| Integration testing | 2 days | End-to-end validation |
| Documentation | 2 days | API docs, migration guide |

**Week 5 Deliverables:**
- 8 application dialogs (28 total components)
- Complete adapter layer
- Integration tests passing

### Phase 6: Deployment & Optimization (Week 6)

**Objective:** Production deployment, performance optimization, and rollout.

| Task | Duration | Deliverable |
|------|----------|-------------|
| Performance optimization | 2 days | Bundle size, rendering |
| Create deployment scripts | 1 day | Installation automation |
| User acceptance testing | 2 days | Feedback collection |
| Bug fixes and polish | 2 days | Production readiness |
| Release documentation | 1 day | Changelog, guides |

**Timeline Summary:**
- **Weeks 1-3:** UI Component Development
- **Weeks 4-5:** Adapter Layer & Integration
- **Week 6:** Testing & Deployment
- **Total Duration:** 6 weeks

---

## 5. Risk Assessment and Mitigation

### 5.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation Strategy |
|------|--------|------------|---------------------|
| **Framework Migration Complexity** | High | Medium | Create comprehensive mapping document; maintain parallel SolidJS→React translation guide; invest in thorough testing |
| **Visual Parity Gaps** | Medium | High | Establish visual regression testing; create pixel-perfect comparison tool; regular design reviews |
| **State Synchronization Failures** | High | Low | Implement robust error handling; add retry logic; maintain fallback to native OpenCode |
| **Performance Degradation** | Medium | Medium | Benchmark early and often; implement virtualization; optimize bundle size |
| **Accessibility Regression** | High | Low | Audit with automated tools (axe-core); manual keyboard navigation testing; screen reader validation |
| **API Incompatibility** | High | Medium | Version negotiation; comprehensive API mapping; backwards compatibility layer |

### 5.2 Project Risks

| Risk | Impact | Likelihood | Mitigation Strategy |
|------|--------|------------|---------------------|
| **Scope Creep** | Medium | High | Strict phase gates; prioritize P0/P1 components; defer P2 to v2 |
| **Resource Constraints** | High | Medium | Parallel workstreams; clear component ownership; contingency contractor budget |
| **Upstream Changes** | Medium | Medium | Weekly upstream sync; abstraction layers; fork critical components |
| **Integration Delays** | High | Medium | Early integration testing; mock adapters; incremental delivery |

### 5.3 Mitigation Actions

1. **Technical Spikes (Week 0):**
   - Validate SolidJS→React migration approach
   - Test Radix UI parity with Kobalte
   - Benchmark virtualization libraries

2. **Quality Gates:**
   - Component review before Phase 2
   - Adapter testing before Phase 5
   - Performance audit before Phase 6

3. **Contingency Plans:**
   - If framework migration blocks: Use SolidJS renderer in React via `@solidjs/react`
   - If visual parity fails: Extend timeline by 1 week for polish
   - If integration fails: Fall back to native OpenCode mode

---

## 6. Resource Requirements

### 6.1 Personnel

| Role | FTE | Duration | Responsibilities |
|------|-----|----------|------------------|
| **Frontend Developer** | 1.0 | 6 weeks | Component migration, React implementation |
| **Backend Developer** | 0.5 | 3 weeks | Adapter layer, API bridges (Weeks 4-5) |
| **UI/UX Designer** | 0.25 | 2 weeks | Visual QA, design system validation (Weeks 3, 5) |
| **QA Engineer** | 0.5 | 2 weeks | Testing, automation (Weeks 5-6) |
| **Technical Writer** | 0.25 | 1 week | Documentation (Week 5) |

### 6.2 Infrastructure

| Resource | Specification | Cost | Notes |
|----------|--------------|------|-------|
| **Development Machine** | 16GB RAM, 4 cores | Existing | Local development |
| **CI/CD Pipeline** | GitHub Actions | Existing | Automated testing |
| **Test Environment** | Docker Compose | Minimal | Local Qdrant, agent-core |
| **Staging Environment** | Cloud VM (optional) | $50/month | Remote testing |

### 6.3 Software & Tools

| Tool | Purpose | Cost | Notes |
|------|---------|------|-------|
| **Radix UI Primitives** | Component foundation | Free | Open source |
| **Tailwind CSS v4** | Styling | Free | Open source |
| **Lucide React** | Icon library | Free | Open source |
| **Storybook** | Component documentation | Free | Open source |
| **Playwright** | E2E testing | Free | Open source |
| **axe-core** | Accessibility testing | Free | Open source |

### 6.4 Budget Summary

| Category | Estimated Cost |
|----------|---------------|
| Personnel (contractor rates) | $15,000 - $25,000 |
| Infrastructure | $100 |
| Tools & Licenses | $0 |
| Contingency (15%) | $2,250 - $3,750 |
| **Total** | **$17,350 - $28,850** |

---

## 7. Success Criteria

### 7.1 Technical Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Component Parity** | 100% of Tier 1, 90% of Tier 2 | Visual regression tests |
| **Bundle Size** | < 500KB (gzipped) | webpack-bundle-analyzer |
| **Performance** | First paint < 1s, TTI < 2s | Lighthouse scores |
| **Test Coverage** | > 80% unit, > 70% integration | Jest coverage reports |
| **Accessibility** | WCAG 2.1 AA compliance | axe-core audits |
| **API Compatibility** | 100% OpenCode tool coverage | Integration test suite |

### 7.2 Functional Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Session Sync** | < 100ms latency | Network timing API |
| **Tool Execution** | 100% of tools functional | Tool test suite |
| **Persona Routing** | @mentions route correctly | Manual testing |
| **State Consistency** | 0 data loss incidents | Error tracking |
| **Auth Reliability** | 99.9% success rate | Auth logs |

### 7.3 User Experience Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Startup Time** | < 3s cold start | User timing |
| **Dialog Responsiveness** | < 16ms frame time | Chrome DevTools |
| **Error Recovery** | Graceful degradation | User testing |
| **Documentation** | Complete API docs | Documentation coverage |

### 7.4 Go/No-Go Checklist

Before production deployment, the following must be true:

- [ ] All P0 components implemented and tested
- [ ] Adapter layer passes integration tests
- [ ] Visual parity within 2px of OpenCode reference
- [ ] Accessibility audit shows 0 critical issues
- [ ] Performance benchmarks meet targets
- [ ] Documentation complete for public APIs
- [ ] Rollback procedure tested and documented
- [ ] Security review completed

---

## 8. Appendix

### 8.1 Component Priority Matrix

```
                    High Impact
                         │
         ┌───────────────┼───────────────┐
         │   Dialog      │   Button      │
         │   List        │   Icon        │
         │   TextField   │   Tooltip     │
         │   Tabs        │   Spinner     │
  High   │   Select      │   Tag         │
 Effort  ├───────────────┼───────────────┤ Low
         │   Markdown    │   Avatar      │
         │   Toast       │   Switch      │
         │   Accordion   │   Card        │
         │   DropdownMenu│   Keybind     │
         │   Popover     │   Checkbox    │
         └───────────────┼───────────────┘
                         │
                    Low Impact
```

### 8.2 Dependency Graph

```
Design Tokens (colors, spacing, typography)
       │
       ├──► Primitives (Button, Icon, Spinner)
       │         │
       │         ├──► Form Components (TextField, Switch, Checkbox)
       │         │
       │         ├──► Layout Components (Card, Tabs, Accordion)
       │         │
       │         └──► Feedback Components (Tooltip, Toast, Dialog)
       │
       └──► Application Dialogs (Provider, Model, File pickers)
```

### 8.3 Related Documents

- `opencode-ui-analysis.md` - Detailed component analysis
- `opencode-integration-plan.md` - API adapter specifications
- `docs/opencode-ui-components.md` - Component API documentation
- OpenCode Repository: `/home/artur/.local/src/agent-core/.wip-surface/opencode/`

---

## 9. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-01 | Queen Coordinator | Initial document creation |

---

*This document serves as the single source of truth for OpenCode web UI integration into agent-core. All integration work should reference this strategy.*
