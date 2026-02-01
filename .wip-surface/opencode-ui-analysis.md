# OpenCode UI Component Analysis Report

## Executive Summary

This report analyzes the UI component architecture of the OpenCode repository (https://github.com/anomalyco/opencode.git). The project uses a monorepo structure with SolidJS as the frontend framework, Kobalte as the headless UI primitive library, and a custom CSS-based design system with Tailwind CSS integration.

---

## 1. Component Inventory

### 1.1 Core UI Library (`packages/ui/src/components/`)

| Component | File | Description | Key Props |
|-----------|------|-------------|-----------|
| **Button** | `button.tsx` | Primary action component | `variant: 'primary' \| 'secondary' \| 'ghost'`, `size: 'small' \| 'normal' \| 'large'`, `icon` |
| **IconButton** | `icon-button.tsx` | Icon-only button | `icon`, `variant`, `size`, `iconSize` |
| **Icon** | `icon.tsx` | SVG icon renderer | `name` (60+ icons), `size` |
| **Dialog** | `dialog.tsx` | Modal dialog container | `title`, `description`, `action`, `size`, `fit`, `transition` |
| **Avatar** | `avatar.tsx` | User/project avatar | `fallback`, `src`, `background`, `foreground`, `size` |
| **Tag** | `tag.tsx` | Badge/label component | `size` |
| **Tooltip** | `tooltip.tsx` | Hover tooltip | `value`, `placement`, `forceMount` |
| **TooltipKeybind** | `tooltip.tsx` | Keybind tooltip variant | `title`, `keybind` |
| **Spinner** | `spinner.tsx` | Loading indicator | Custom animated SVG |
| **Keybind** | `keybind.tsx` | Keyboard shortcut display | - |
| **ProviderIcon** | `provider-icon.tsx` | Provider logo icons | `id` (from sprite) |
| **Switch** | `switch.tsx` | Toggle switch | `checked`, `onChange`, `description`, `hideLabel` |
| **List** | `list.tsx` | Searchable/selectable list | `items`, `key`, `filterKeys`, `groupBy`, `onSelect` |
| **TextField** | `text-field.tsx` | Input field | `type`, `label`, `placeholder`, `validationState` |
| **FileIcon** | `file-icon.tsx` | File type icons | `node` |

### 1.2 Application Components (`packages/app/src/components/`)

| Component | File | Purpose |
|-----------|------|---------|
| **DialogConnectProvider** | `dialog-connect-provider.tsx` | OAuth/API key provider authentication |
| **DialogSelectProvider** | `dialog-select-provider.tsx` | Provider selection list |
| **DialogSelectModel** | `dialog-select-model.tsx` | AI model selection dialog |
| **DialogManageModels** | `dialog-manage-models.tsx` | Model visibility management |
| **DialogEditProject** | `dialog-edit-project.tsx` | Project settings editor |
| **DialogSelectDirectory** | `dialog-select-directory.tsx` | Directory picker with fuzzy search |
| **DialogSelectFile** | `dialog-select-file.tsx` | File/command palette |
| **DialogFork** | `dialog-fork.tsx` | Fork session dialog |
| **DialogReleaseNotes** | `dialog-release-notes.tsx` | Version changelog display |
| **DialogCustomProvider** | `dialog-custom-provider.tsx` | Custom provider configuration |
| **ModelTooltip** | `model-tooltip.tsx` | Model info tooltip |
| **Link** | `link.tsx` | External link opener |
| **ModelSelectorPopover** | `dialog-select-model.tsx` | Inline model selector |

---

## 2. Component Architecture Analysis

### 2.1 Framework Stack

```
SolidJS (Reactive UI Framework)
    ↓
Kobalte (Headless UI Primitives - accessible, unstyled)
    ↓
Custom Components (Business logic + styling)
    ↓
CSS Custom Properties (Design tokens)
    ↓
Tailwind CSS v4 (Utility classes, layer-based)
```

### 2.2 Component Hierarchy Pattern

All components follow a consistent layered architecture:

```tsx
// 1. Kobalte primitive foundation
import { Button as Kobalte } from "@kobalte/core/button"

// 2. Props interface extends Kobalte + custom
export interface ButtonProps extends ComponentProps<typeof Kobalte> {
  variant?: "primary" | "secondary" | "ghost"
  size?: "small" | "normal" | "large"
  icon?: IconProps["name"]
}

// 3. splitProps for prop delegation
export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  
  // 4. Data attributes for CSS targeting
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      // ...
    />
  )
}
```

### 2.3 Dialog System Architecture

```
DialogProvider (Context)
    ↓
useDialog() hook
    ↓
  ├─ show(Component) → renders in portal
  ├─ close() → triggers animation + cleanup
  └─ active → current dialog state
    ↓
Kobalte Dialog (Primitive)
    ↓
Custom Dialog Component
    ↓
Content (Header + Body + Actions)
```

Key features:
- Single-dialog stack (new dialog replaces current)
- Animated transitions (100-150ms)
- Escape key handling
- Focus management
- Portal rendering

---

## 3. Props Interfaces and Data Flow

### 3.1 Common Prop Patterns

| Pattern | Implementation | Usage |
|---------|----------------|-------|
| **splitProps** | `const [local, rest] = splitProps(props, [...])` | Separate custom props from DOM props |
| **class/classList** | Merged via `classList` object | Allow external styling |
| **Data attributes** | `data-component`, `data-size`, `data-variant` | CSS targeting |
| **Children** | SolidJS `children()` primitive | Reactive child resolution |
| **CreateMemo** | `createMemo(() => compute())` | Derived state |
| **CreateStore** | `createStore({...})` | Local component state |

### 3.2 State Management Flow

```
Global Contexts (app-level)
├── useGlobalSync() - Server-synced state
├── useGlobalSDK() - API client
├── useLocal() - Local/ephemeral state
├── useLanguage() - i18n
└── useDialog() - Modal state

Component-level
├── createStore() - Local reactive state
├── createMemo() - Computed values
└── createSignal() - Simple state

Props
├── Callbacks (onSelect, onChange)
├── Configuration (variant, size)
└── Data (items, model)
```

### 3.3 Event Handling Pattern

Components use explicit event handlers rather than prop spreading:

```tsx
// Explicit handler binding
<Kobalte
  onOpenChange={(open: boolean) => {
    if (open) return
    close()
  }}
  onOpenAutoFocus={(e) => {
    const autofocusEl = target?.querySelector("[autofocus]")
    if (autofocusEl) {
      e.preventDefault()
      autofocusEl.focus()
    }
  }}
/>
```

---

## 4. Styling Methodology

### 4.1 CSS Architecture (Layer-Based)

```css
@layer theme, base, components, utilities;

/* Theme layer: Design tokens */
@import "./colors.css" layer(theme);
@import "./theme.css" layer(theme);

/* Base layer: Reset + globals */
@import "./base.css" layer(base);

/* Components layer: Component styles */
@import "../components/button.css" layer(components);
@import "../components/dialog.css" layer(components);
/* ... 40+ component styles */

/* Utilities layer: Tailwind + custom */
@import "./utilities.css" layer(utilities);
```

### 4.2 Design Token System (CSS Custom Properties)

```css
/* Semantic color tokens */
--button-primary-base
--button-secondary-base
--button-secondary-hover
--icon-strong-base
--icon-strong-hover
--text-strong
--text-base
--text-weak
--surface-raised-base
--surface-raised-base-hover
--border-base
--border-strong
--background-base

/* Spacing */
--spacing: 0.25rem
--radius-sm: 0.25rem
--radius-md: 0.375rem
--radius-lg: 0.5rem
--radius-xl: 0.625rem

/* Typography */
--font-family-sans
--font-family-mono
--font-size-small
--font-size-base
--font-size-large
--font-weight-regular: 400
--font-weight-medium: 500

/* Shadows */
--shadow-xs-border
--shadow-xs-border-focus
--shadow-lg-border-base
```

### 4.3 Component CSS Pattern (Data Attributes)

```css
/* Base selector on data-component */
[data-component="button"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  
  /* Variants */
  &[data-variant="primary"] {
    background-color: var(--button-primary-base);
    color: var(--icon-invert-base);
  }
  
  &[data-variant="ghost"] {
    background-color: transparent;
    color: var(--text-strong);
  }
  
  /* Sizes */
  &[data-size="small"] {
    height: 22px;
    padding: 0 8px;
  }
  
  &[data-size="large"] {
    height: 32px;
    padding: 6px 12px;
  }
  
  /* States */
  &:hover:not(:disabled) {
    background-color: var(--button-secondary-hover);
  }
  
  &:focus-visible:not(:active) {
    box-shadow: var(--shadow-xs-border-focus);
  }
}
```

### 4.4 Tailwind Integration

- **Tailwind v4** with CSS-first configuration
- Custom theme mapping to CSS variables
- Utility classes used sparingly for layout (`flex`, `gap-*`, `p-*`)
- Component styles primarily in dedicated CSS files

```css
/* Tailwind theme mapping */
@theme {
  --font-sans: var(--font-family-sans);
  --font-mono: var(--font-family-mono);
  --text-sm: var(--font-size-small);
  --text-base: var(--font-size-base);
  --font-weight-regular: var(--font-weight-regular);
  --font-weight-medium: var(--font-weight-medium);
  --shadow-xs: var(--shadow-xs);
  --radius-sm: 0.25rem;
  /* ... */
}
```

---

## 5. Color System

### 5.1 Color Scale Architecture (Radix-like)

Each color has 12 scales + alpha variants:

```css
/* Example: Smoke color scale */
--smoke-dark-1: #131010;   /* App background */
--smoke-dark-2: #1b1818;   /* Subtle background */
--smoke-dark-3: #252121;   /* UI element background */
--smoke-dark-4: #2d2828;   /* Hover states */
--smoke-dark-5: #343030;   /* Active states */
--smoke-dark-6: #3e3939;   /* Borders subtle */
--smoke-dark-7: #4b4646;   /* Borders hover */
--smoke-dark-8: #645f5f;   /* Borders strong */
--smoke-dark-9: #716c6b;   /* Solid backgrounds */
--smoke-dark-10: #7f7979;  /* Solid hover */
--smoke-dark-11: #b7b1b1;  /* Accessible text */
--smoke-dark-12: #f1ecec;  /* High contrast text */
```

### 5.2 Available Color Palettes

| Palette | Usage |
|---------|-------|
| **smoke** | Neutral grays (default background) |
| **ink** | Alternative neutral (cyan-tinted) |
| **cobalt** | Primary accent (blue) |
| **ember** | Error/danger states (red-orange) |
| **apple** | Success states (green) |
| **solaris** | Warning/attention (yellow) |
| **yuzu** | Highlight/brand accent (lime) |
| **lilac** | Secondary accent (purple) |
| **coral** | Soft accent (pink-red) |
| **mint** | Fresh accent (mint green) |
| **blue** | Standard blue |
| **amber** | Standard amber/orange |

---

## 6. Icon System

### 6.1 Icon Architecture

```
Built-in Icons (icon.tsx)
├── 60+ inline SVG paths
├── Categories: navigation, actions, layout, status
└── Sizes: small (14px), normal (16px), medium (18px), large (20px)

Provider Icons (provider-icon.tsx)
├── SVG sprite-based
├── External provider logos
└── Referenced by ID

File Icons (file-icon.tsx)
├── Language detection
├── Extension mapping
└── Dynamic coloring
```

### 6.2 Icon Usage Pattern

```tsx
<Icon name="close" size="small" />
<Icon name="circle-check" size="large" class="text-icon-critical-base" />
<ProviderIcon id="anthropic" class="size-5" />
```

---

## 7. Dialog/Modal System

### 7.1 Dialog Context API

```tsx
// Usage in components
const dialog = useDialog()

// Show a dialog
dialog.show(() => <DialogSelectProvider />)

// Show with close callback
dialog.show(() => <MyDialog />, () => console.log("closed"))

// Close current dialog
dialog.close()
```

### 7.2 Dialog Stack Behavior

- **Single active dialog** - New dialogs replace current
- **No nesting** - Direct replacement prevents complexity
- **Animated transitions** - 100ms hide, 150ms show
- **Auto-cleanup** - Disposed after animation completes

### 7.3 Dialog Component Pattern

```tsx
export function MyDialog(props: { data: string }) {
  const dialog = useDialog()
  
  return (
    <Dialog
      title="Dialog Title"
      description="Optional description"
      action={<Button>Action</Button>}
      size="normal" /* or "large", "x-large" */
      fit /* for auto-height */
      transition /* enable animations */
    >
      {/* Dialog content */}
    </Dialog>
  )
}
```

---

## 8. Extraction Plan for Agent-Core Integration

### 8.1 Recommended Components to Extract

#### Tier 1: Essential Core
| Component | Priority | Notes |
|-----------|----------|-------|
| Button | High | Primary interaction element |
| IconButton | High | Toolbar/actions |
| Icon | High | Visual language |
| Dialog | High | Modal system |
| Tooltip | High | UX enhancement |
| Spinner | High | Loading states |
| Tag | Medium | Labels/badges |
| Avatar | Medium | User/project identity |
| Switch | Medium | Toggles |
| Keybind | Low | Keyboard shortcuts |

#### Tier 2: List & Form Components
| Component | Priority | Notes |
|-----------|----------|-------|
| List | High | Searchable selection |
| TextField | High | Input foundation |
| ProviderIcon | Medium | AI provider logos |

#### Tier 3: Dialog Patterns
| Component | Priority | Notes |
|-----------|----------|-------|
| DialogSelectModel | High | AI model selection |
| DialogManageModels | Medium | Model visibility |
| DialogSelectProvider | Medium | Provider connection |

### 8.2 Adaptation Requirements

#### Framework Migration (SolidJS → React)

| SolidJS Pattern | React Equivalent |
|-----------------|------------------|
| `splitProps()` | Object destructuring + `...rest` |
| `createMemo()` | `useMemo()` |
| `createSignal()` | `useState()` |
| `createStore()` | `useState()` with objects |
| `children()` | `React.Children` or direct render |
| `Show` component | Conditional rendering `{condition && ...}` |
| `For` component | `array.map()` |
| `Match/Switch` | `if/else` or `switch` |
| `onCleanup()` | `useEffect()` cleanup function |
| `createRoot()` | React Portal |

#### Kobalte Primitives → Radix UI

| Kobalte Component | Radix UI Equivalent |
|-------------------|---------------------|
| `@kobalte/core/button` | `@radix-ui/react-primitive` or native |
| `@kobalte/core/dialog` | `@radix-ui/react-dialog` |
| `@kobalte/core/tooltip` | `@radix-ui/react-tooltip` |
| `@kobalte/core/switch` | `@radix-ui/react-switch` |
| `@kobalte/core/popover` | `@radix-ui/react-popover` |

#### Styling Migration Path

**Option A: Keep CSS Architecture**
- Preserve design token system (CSS custom properties)
- Migrate component CSS files directly
- Use Tailwind v4 with same configuration
- Maintain data-attribute selectors

**Option B: Tailwind-First Approach**
- Convert CSS to Tailwind utility classes
- Use `cva` (class-variance-authority) for variants
- Keep design tokens as Tailwind config
- Simpler but less explicit styling

### 8.3 File Structure Recommendation

```
packages/ui/                          # New UI package
├── src/
│   ├── components/
│   │   ├── button.tsx
│   │   ├── icon.tsx
│   │   ├── icon-button.tsx
│   │   ├── dialog.tsx
│   │   ├── tooltip.tsx
│   │   ├── avatar.tsx
│   │   ├── tag.tsx
│   │   ├── spinner.tsx
│   │   ├── switch.tsx
│   │   ├── list.tsx
│   │   ├── text-field.tsx
│   │   └── keybind.tsx
│   ├── context/
│   │   └── dialog.tsx
│   ├── styles/
│   │   ├── index.css
│   │   ├── colors.css              # Design tokens
│   │   ├── theme.css
│   │   ├── base.css
│   │   ├── utilities.css
│   │   └── tailwind/
│   │       ├── index.css
│   │       └── utilities.css
│   ├── hooks/
│   │   └── use-dialog.ts
│   └── lib/
│       └── utils.ts
└── package.json
```

### 8.4 Implementation Phases

#### Phase 1: Foundation (Week 1)
1. Set up UI package with Tailwind v4
2. Migrate design tokens (colors.css)
3. Create Button, Icon, IconButton
4. Set up Radix UI primitives

#### Phase 2: Core Components (Week 2)
1. Dialog system (Dialog + DialogProvider)
2. Tooltip component
3. Spinner loading states
4. Form primitives (TextField, Switch)

#### Phase 3: Advanced Components (Week 3)
1. List component (virtualized, searchable)
2. Avatar and Tag
3. ProviderIcon system
4. Keybind display

#### Phase 4: Dialog Patterns (Week 4)
1. Model selection dialogs
2. Provider connection dialogs
3. File/directory pickers
4. Project settings dialog

### 8.5 Key Technical Decisions

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Framework** | React 18+ | Agent-core ecosystem |
| **Primitives** | Radix UI | Industry standard, accessible |
| **Styling** | Tailwind v4 + CSS variables | Match OpenCode exactly |
| **Animation** | Framer Motion or CSS | Simple transitions preferred |
| **Icons** | Lucide React | Similar to OpenCode style |
| **Virtualization** | @tanstack/react-virtual | For List component |

---

## 9. Key Patterns Summary

### 9.1 Component Props Convention
```tsx
interface ComponentProps extends PrimitiveProps {
  variant?: "primary" | "secondary" | "ghost"
  size?: "small" | "normal" | "large"
  class?: string
  classList?: Record<string, boolean>
}
```

### 9.2 State Management Pattern
```tsx
// SolidJS
const [store, setStore] = createStore({...})
const derived = createMemo(() => compute(store))

// React equivalent
const [store, setStore] = useState({...})
const derived = useMemo(() => compute(store), [store])
```

### 9.3 Styling Convention
```tsx
// Data attributes for CSS targeting
<div 
  data-component="button"
  data-variant={variant}
  data-size={size}
  className={cn("base-classes", className)}
/>
```

### 9.4 Dialog Usage Pattern
```tsx
const dialog = useDialog()
dialog.show(() => <MyDialog data={data} />)
```

---

## 10. Conclusion

The OpenCode UI component system demonstrates a well-architected, production-ready design:

1. **Accessibility-first**: Built on Kobalte primitives (ARIA-compliant)
2. **Design consistency**: Comprehensive token system with semantic naming
3. **Performance**: SolidJS signals for fine-grained reactivity
4. **Maintainability**: Clear separation of concerns (primitive → component → CSS)
5. **Scalability**: Layer-based CSS architecture

For agent-core integration, the key challenges are:
- Framework migration (SolidJS → React)
- Primitive library adaptation (Kobalte → Radix)
- Maintaining exact visual parity

The recommended approach preserves the design token system and component APIs while adapting implementation details for the React ecosystem.

---

*Report generated: 2026-02-01*
*Source: https://github.com/anomalyco/opencode.git (dev branch)*
