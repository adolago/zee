# OpenCode UI Components Documentation

## Overview

OpenCode UI (`@opencode-ai/ui`) is a SolidJS-based component library built on top of [Kobalte](https://kobalte.dev/), a headless UI component library. It provides accessible, composable components with a focus on terminal-inspired design.

**Key Technologies:**
- SolidJS - Reactive UI framework
- Kobalte Core - Headless UI primitives
- TailwindCSS - Utility-first styling
- TypeScript - Type safety

---

## 1. Component Documentation

### 1.1 Button

The Button component is a versatile interactive element with multiple variants and sizes.

**Source:** `packages/ui/src/components/button.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"primary" \| "secondary" \| "ghost"` | `"secondary"` | Visual style variant |
| `size` | `"small" \| "normal" \| "large"` | `"normal"` | Button size |
| `icon` | `IconName` | - | Optional icon to display |
| `class` | `string` | - | CSS class override |
| `classList` | `Record<string, boolean>` | - | Conditional classes |

**Data Attributes:**
- `data-component="button"` - Component identifier
- `data-size` - Current size value
- `data-variant` - Current variant value
- `data-icon` - Icon name if set

#### Usage Examples

```tsx
import { Button } from "@opencode-ai/ui/button"

// Basic button
<Button>Click me</Button>

// Primary action
<Button variant="primary">Save Changes</Button>

// Ghost button for subtle actions
<Button variant="ghost">Cancel</Button>

// With icon
<Button icon="plus" variant="primary">Add Item</Button>

// Small size
<Button size="small" variant="secondary">Compact</Button>
```

---

### 1.2 IconButton

A compact button designed specifically for icon-only actions.

**Source:** `packages/ui/src/components/icon-button.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `IconName` | **required** | Icon to display |
| `variant` | `"primary" \| "secondary" \| "ghost"` | `"secondary"` | Visual style |
| `size` | `"normal" \| "large"` | `"normal"` | Button size |
| `iconSize` | `"small" \| "normal" \| "medium" \| "large"` | auto | Icon size override |

**Data Attributes:**
- `data-component="icon-button"`
- `data-size`
- `data-variant`

#### Usage Examples

```tsx
import { IconButton } from "@opencode-ai/ui/icon-button"

// Close button
<IconButton icon="close" variant="ghost" aria-label="Close" />

// Large primary action
<IconButton icon="plus" variant="primary" size="large" />
```

---

### 1.3 Card

A container component for grouping related content with semantic variants.

**Source:** `packages/ui/src/components/card.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"normal" \| "error" \| "warning" \| "success" \| "info"` | `"normal"` | Semantic color variant |

**Data Attributes:**
- `data-component="card"`
- `data-variant`

#### Usage Examples

```tsx
import { Card } from "@opencode-ai/ui/card"

// Default card
<Card>
  <h3>Card Title</h3>
  <p>Card content goes here</p>
</Card>

// Error state
<Card variant="error">
  <p>Something went wrong!</p>
</Card>

// Success notification
<Card variant="success">
  <p>Operation completed successfully!</p>
</Card>
```

---

### 1.4 Dialog

Modal dialog component for important interactions that require user attention.

**Source:** `packages/ui/src/components/dialog.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `JSX.Element` | - | Dialog header title |
| `description` | `JSX.Element` | - | Optional description text |
| `action` | `JSX.Element` | - | Custom action element (replaces close button) |
| `size` | `"normal" \| "large" \| "x-large"` | `"normal"` | Dialog width |
| `fit` | `boolean` | - | Fit content width |
| `transition` | `boolean` | - | Enable transitions |

**Data Attributes:**
- `data-component="dialog"`
- `data-size`
- `data-fit`
- `data-transition`
- `data-slot="dialog-container"`
- `data-slot="dialog-content"`
- `data-slot="dialog-header"`
- `data-slot="dialog-title"`
- `data-slot="dialog-close-button"`
- `data-slot="dialog-description"`
- `data-slot="dialog-body"`

#### Usage Examples

```tsx
import { Dialog } from "@opencode-ai/ui/dialog"
import { Dialog as KobalteDialog } from "@kobalte/core/dialog"

<KobalteDialog>
  <Dialog 
    title="Confirm Action" 
    description="Are you sure you want to proceed?"
    size="large"
  >
    <p>Your changes will be saved.</p>
    <div class="flex gap-2">
      <Button variant="primary">Confirm</Button>
      <Button variant="ghost">Cancel</Button>
    </div>
  </Dialog>
</KobalteDialog>
```

---

### 1.5 TextField

Input component with label, description, error handling, and copy functionality.

**Source:** `packages/ui/src/components/text-field.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Input label |
| `hideLabel` | `boolean` | - | Visually hide label (screen reader only) |
| `description` | `string` | - | Helper text |
| `error` | `string` | - | Error message |
| `variant` | `"normal" \| "ghost"` | `"normal"` | Input style |
| `copyable` | `boolean` | - | Show copy button |
| `multiline` | `boolean` | - | Use textarea instead of input |
| `value` | `string` | - | Controlled value |
| `defaultValue` | `string` | - | Uncontrolled default |
| `onChange` | `(value: string) => void` | - | Change handler |
| `validationState` | `"valid" \| "invalid"` | - | Validation state |
| `required` | `boolean` | - | Required field |
| `disabled` | `boolean` | - | Disabled state |
| `readOnly` | `boolean` | - | Read-only state |

**Data Attributes:**
- `data-component="input"`
- `data-variant`
- `data-slot="input-label"`
- `data-slot="input-wrapper"`
- `data-slot="input-input"`
- `data-slot="input-copy-button"`
- `data-slot="input-description"`
- `data-slot="input-error"`

#### Usage Examples

```tsx
import { TextField } from "@opencode-ai/ui/text-field"

// Basic input
<TextField 
  label="Username" 
  placeholder="Enter username" 
/>

// With error state
<TextField 
  label="Email"
  type="email"
  error="Invalid email format"
  validationState="invalid"
/>

// Copyable URL field
<TextField 
  label="Share Link"
  value="https://example.com/share/abc123"
  copyable
  readOnly
/>

// Multiline textarea
<TextField 
  label="Description"
  multiline
  placeholder="Enter description..."
/>

// Hidden label (accessibility preserved)
<TextField 
  label="Search"
  hideLabel
  placeholder="Search..."
/>
```

---

### 1.6 Checkbox

Toggle checkbox with label and description support.

**Source:** `packages/ui/src/components/checkbox.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `JSX.Element` | - | Label content |
| `hideLabel` | `boolean` | - | Visually hide label |
| `description` | `string` | - | Helper text below label |
| `icon` | `JSX.Element` | checkmark | Custom check icon |
| `checked` | `boolean` | - | Controlled state |
| `defaultChecked` | `boolean` | - | Uncontrolled default |
| `onChange` | `(checked: boolean) => void` | - | Change handler |
| `disabled` | `boolean` | - | Disabled state |

**Data Attributes:**
- `data-component="checkbox"`
- `data-slot="checkbox-checkbox-input"`
- `data-slot="checkbox-checkbox-control"`
- `data-slot="checkbox-checkbox-indicator"`
- `data-slot="checkbox-checkbox-label"`
- `data-slot="checkbox-checkbox-description"`

#### Usage Examples

```tsx
import { Checkbox } from "@opencode-ai/ui/checkbox"

// Basic checkbox
<Checkbox>Enable notifications</Checkbox>

// With description
<Checkbox description="Receive email updates about your account">
  Email Notifications
</Checkbox>

// Controlled
<Checkbox 
  checked={enabled} 
  onChange={setEnabled}
>
  Enable Feature
</Checkbox>

// Custom icon
<Checkbox icon={<Icon name="check-small" />}>
  Custom Check
</Checkbox>
```

---

### 1.7 Switch

Toggle switch component for on/off states.

**Source:** `packages/ui/src/components/switch.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `JSX.Element` | - | Label content |
| `hideLabel` | `boolean` | - | Visually hide label |
| `description` | `string` | - | Helper text |
| `checked` | `boolean` | - | Controlled state |
| `defaultChecked` | `boolean` | - | Uncontrolled default |
| `onChange` | `(checked: boolean) => void` | - | Change handler |
| `disabled` | `boolean` | - | Disabled state |

**Data Attributes:**
- `data-component="switch"`
- `data-slot="switch-input"`
- `data-slot="switch-label"`
- `data-slot="switch-description"`
- `data-slot="switch-error"`
- `data-slot="switch-control"`
- `data-slot="switch-thumb"`

#### Usage Examples

```tsx
import { Switch } from "@opencode-ai/ui/switch"

// Basic switch
<Switch>Dark Mode</Switch>

// With description
<Switch description="Automatically save changes as you type">
  Auto-save
</Switch>

// Controlled
<Switch 
  checked={darkMode} 
  onChange={setDarkMode}
>
  Enable Dark Mode
</Switch>
```

---

### 1.8 Select

Dropdown select with grouping and custom rendering support.

**Source:** `packages/ui/src/components/select.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `T[]` | **required** | Array of options |
| `current` | `T` | - | Currently selected value |
| `placeholder` | `string` | - | Placeholder text |
| `value` | `(x: T) => string` | `String` | Value extractor function |
| `label` | `(x: T) => string` | `String` | Label extractor function |
| `groupBy` | `(x: T) => string` | - | Grouping function |
| `onSelect` | `(value: T \| undefined) => void` | - | Selection handler |
| `onHighlight` | `(value: T \| undefined) => (() => void) \| void` | - | Highlight handler (returns cleanup) |
| `triggerVariant` | `"settings"` | - | Special trigger styling |
| `triggerStyle` | `CSSProperties` | - | Trigger inline styles |

**Data Attributes:**
- `data-component="select"`
- `data-trigger-style`
- `data-slot="select-select-trigger"`
- `data-slot="select-select-trigger-value"`
- `data-slot="select-select-item"`
- `data-slot="select-select-item-label"`
- `data-slot="select-select-item-indicator"`

#### Usage Examples

```tsx
import { Select } from "@opencode-ai/ui/select"

// Basic select
<Select
  options={["option1", "option2", "option3"]}
  current={selected}
  onSelect={setSelected}
  placeholder="Choose an option"
/>

// With object options
interface User {
  id: string
  name: string
}

<Select<User>
  options={users}
  current={selectedUser}
  value={(u) => u.id}
  label={(u) => u.name}
  onSelect={setSelectedUser}
/>

// With grouping
<Select<Product>
  options={products}
  groupBy={(p) => p.category}
  value={(p) => p.id}
  label={(p) => p.name}
  onSelect={setSelectedProduct}
/>

// Settings variant (right-aligned)
<Select
  options={["light", "dark", "system"]}
  triggerVariant="settings"
  current={theme}
  onSelect={setTheme}
/>
```

---

### 1.9 Tabs

Tab navigation component with multiple visual variants.

**Source:** `packages/ui/src/components/tabs.tsx`

#### Props Reference

**Tabs (Root):**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"normal" \| "alt" \| "pill" \| "settings"` | `"normal"` | Visual style |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout direction |
| `value` | `string` | - | Controlled active tab |
| `defaultValue` | `string` | - | Default active tab |
| `onChange` | `(value: string) => void` | - | Tab change handler |

**Tabs.Trigger:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `classes.button` | `string` | - | Custom button classes |
| `hideCloseButton` | `boolean` | - | Hide close button |
| `closeButton` | `JSX.Element` | - | Custom close button |
| `onMiddleClick` | `() => void` | - | Middle mouse click handler |

**Data Attributes:**
- `data-component="tabs"`
- `data-variant`
- `data-orientation`
- `data-slot="tabs-list"`
- `data-slot="tabs-trigger-wrapper"`
- `data-slot="tabs-trigger"`
- `data-slot="tabs-trigger-close-button"`
- `data-slot="tabs-content"`

#### Usage Examples

```tsx
import { Tabs } from "@opencode-ai/ui/tabs"

// Basic tabs
<Tabs defaultValue="tab1">
  <Tabs.List>
    <Tabs.Trigger value="tab1">First Tab</Tabs.Trigger>
    <Tabs.Trigger value="tab2">Second Tab</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="tab1">Content 1</Tabs.Content>
  <Tabs.Content value="tab2">Content 2</Tabs.Content>
</Tabs>

// Pill variant
<Tabs variant="pill" defaultValue="all">
  <Tabs.List>
    <Tabs.Trigger value="all">All</Tabs.Trigger>
    <Tabs.Trigger value="active">Active</Tabs.Trigger>
    <Tabs.Trigger value="completed">Completed</Tabs.Trigger>
  </Tabs.List>
  {/* ... */}
</Tabs>

// With close button
<Tabs>
  <Tabs.List>
    <Tabs.Trigger 
      value="file1" 
      closeButton={<IconButton icon="close" variant="ghost" />}
    >
      File 1
    </Tabs.Trigger>
  </Tabs.List>
</Tabs>

// Settings variant (vertical)
<Tabs variant="settings" orientation="vertical">
  <Tabs.List>
    <Tabs.Trigger value="general">General</Tabs.Trigger>
    <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
    <Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
  </Tabs.List>
  {/* ... */}
</Tabs>
```

---

### 1.10 Tooltip

Contextual information popup on hover or focus.

**Source:** `packages/ui/src/components/tooltip.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `JSX.Element` | **required** | Tooltip content |
| `placement` | `Placement` | - | Position relative to trigger |
| `gutter` | `number` | `4` | Space between trigger and tooltip |
| `inactive` | `boolean` | - | Disable tooltip functionality |
| `forceOpen` | `boolean` | - | Force visible state |
| `class` | `string` | - | Trigger class |
| `contentClass` | `string` | - | Content class |
| `contentStyle` | `CSSProperties` | - | Content inline styles |
| `skipDelayDuration` | `number` | - | Delay before hiding |
| `openDelay` | `number` | - | Delay before showing |
| `closeDelay` | `number` | - | Delay before hiding |

**TooltipKeybind:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Tooltip title |
| `keybind` | `string` | Keyboard shortcut to display |

**Data Attributes:**
- `data-component="tooltip-trigger"`
- `data-component="tooltip"`
- `data-placement`
- `data-force-open`
- `data-slot="tooltip-keybind"`
- `data-slot="tooltip-keybind-key"`

#### Usage Examples

```tsx
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"

// Basic tooltip
<Tooltip value="This is helpful information">
  <IconButton icon="info" variant="ghost" />
</Tooltip>

// With placement
<Tooltip value="Delete item" placement="top">
  <IconButton icon="trash" variant="ghost" />
</Tooltip>

// Keyboard shortcut tooltip
<TooltipKeybind title="Save file" keybind="Ctrl+S">
  <IconButton icon="save" variant="ghost" />
</TooltipKeybind>

// Custom styling
<Tooltip 
  value={<div class="custom-content">Custom HTML content</div>}
  contentClass="custom-tooltip"
>
  <span>Hover me</span>
</Tooltip>
```

---

### 1.11 Popover

Floating content container for menus, pickers, and more.

**Source:** `packages/ui/src/components/popover.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `JSX.Element` | - | Trigger element |
| `triggerAs` | `ValidComponent` | `"div"` | Trigger wrapper element |
| `triggerProps` | `ComponentProps<T>` | - | Props for trigger element |
| `title` | `JSX.Element` | - | Popover title |
| `description` | `JSX.Element` | - | Description text |
| `portal` | `boolean` | `true` | Render in portal |
| `modal` | `boolean` | `false` | Modal behavior |
| `open` | `boolean` | - | Controlled state |
| `defaultOpen` | `boolean` | - | Uncontrolled default |
| `onOpenChange` | `(open: boolean) => void` | - | Open state change handler |

**Data Attributes:**
- `data-component="popover-content"`
- `data-slot="popover-trigger"`
- `data-slot="popover-header"`
- `data-slot="popover-title"`
- `data-slot="popover-close-button"`
- `data-slot="popover-description"`
- `data-slot="popover-body"`

#### Usage Examples

```tsx
import { Popover } from "@opencode-ai/ui/popover"

// Basic popover
<Popover trigger={<Button>Open Popover</Button>}>
  <p>Popover content here</p>
</Popover>

// With title and description
<Popover 
  trigger={<IconButton icon="settings" variant="ghost" />}
  title="Settings"
  description="Configure your preferences"
>
  <form>{/* form content */}</form>
</Popover>

// Controlled
<Popover 
  open={isOpen}
  onOpenChange={setIsOpen}
  trigger={<Button>Toggle</Button>}
>
  <p>Controlled content</p>
</Popover>
```

---

### 1.12 Accordion

Collapsible content sections.

**Source:** `packages/ui/src/components/accordion.tsx`

#### Props Reference

**Accordion (Root):**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `multiple` | `boolean` | - | Allow multiple open items |
| `collapsible` | `boolean` | - | Allow all items closed |
| `value` | `string[]` | - | Controlled open items |
| `defaultValue` | `string[]` | - | Default open items |
| `onChange` | `(value: string[]) => void` | - | Change handler |

**Accordion.Item:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | **required** | Unique item identifier |
| `disabled` | `boolean` | - | Disable item |

**Data Attributes:**
- `data-component="accordion"`
- `data-slot="accordion-item"`
- `data-slot="accordion-header"`
- `data-slot="accordion-trigger"`
- `data-slot="accordion-content"`

#### Usage Examples

```tsx
import { Accordion } from "@opencode-ai/ui/accordion"

// Single item open
<Accordion>
  <Accordion.Item value="item1">
    <Accordion.Header>
      <Accordion.Trigger>Section 1</Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Content>Content for section 1</Accordion.Content>
  </Accordion.Item>
  <Accordion.Item value="item2">
    <Accordion.Header>
      <Accordion.Trigger>Section 2</Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Content>Content for section 2</Accordion.Content>
  </Accordion.Item>
</Accordion>

// Multiple open allowed
<Accordion multiple collapsible>
  {/* items */}
</Accordion>
```

---

### 1.13 DropdownMenu

Context menu with items, groups, submenus, and selection.

**Source:** `packages/ui/src/components/dropdown-menu.tsx`

#### Component Structure

```
DropdownMenu
├── DropdownMenu.Trigger
├── DropdownMenu.Portal
│   └── DropdownMenu.Content
│       ├── DropdownMenu.Arrow
│       ├── DropdownMenu.Group
│       │   ├── DropdownMenu.GroupLabel
│       │   ├── DropdownMenu.Item
│       │   │   ├── DropdownMenu.ItemLabel
│       │   │   ├── DropdownMenu.ItemDescription
│       │   │   └── DropdownMenu.ItemIndicator
│       │   └── DropdownMenu.Separator
│       ├── DropdownMenu.RadioGroup
│       │   └── DropdownMenu.RadioItem
│       ├── DropdownMenu.CheckboxItem
│       └── DropdownMenu.Sub
│           ├── DropdownMenu.SubTrigger
│           └── DropdownMenu.SubContent
```

**Data Attributes:**
- `data-component="dropdown-menu"`
- `data-component="dropdown-menu-content"`
- `data-slot="dropdown-menu-trigger"`
- `data-slot="dropdown-menu-item"`
- `data-slot="dropdown-menu-separator"`

#### Usage Examples

```tsx
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"

// Basic menu
<DropdownMenu>
  <DropdownMenu.Trigger>
    <Button>Open Menu</Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content>
      <DropdownMenu.Item onSelect={() => console.log("copy")}>
        <DropdownMenu.ItemLabel>Copy</DropdownMenu.ItemLabel>
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => console.log("paste")}>
        <DropdownMenu.ItemLabel>Paste</DropdownMenu.ItemLabel>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu>

// With groups and shortcuts
<DropdownMenu>
  <DropdownMenu.Trigger as={Button}>Options</DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content>
      <DropdownMenu.Group>
        <DropdownMenu.GroupLabel>Actions</DropdownMenu.GroupLabel>
        <DropdownMenu.Item>
          <DropdownMenu.ItemLabel>Undo</DropdownMenu.ItemLabel>
        </DropdownMenu.Item>
        <DropdownMenu.Item>
          <DropdownMenu.ItemLabel>Redo</DropdownMenu.ItemLabel>
        </DropdownMenu.Item>
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.GroupLabel>View</DropdownMenu.GroupLabel>
        <DropdownMenu.CheckboxItem checked={showPreview} onChange={setShowPreview}>
          <DropdownMenu.ItemLabel>Show Preview</DropdownMenu.ItemLabel>
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu>

// Radio group
<DropdownMenu.RadioGroup value={alignment} onChange={setAlignment}>
  <DropdownMenu.RadioItem value="left">Left</DropdownMenu.RadioItem>
  <DropdownMenu.RadioItem value="center">Center</DropdownMenu.RadioItem>
  <DropdownMenu.RadioItem value="right">Right</DropdownMenu.RadioItem>
</DropdownMenu.RadioGroup>

// Submenu
<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger>More Options</DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent>
    <DropdownMenu.Item>Sub Item 1</DropdownMenu.Item>
    <DropdownMenu.Item>Sub Item 2</DropdownMenu.Item>
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
```

---

### 1.14 RadioGroup

Segmented control for single selection from multiple options.

**Source:** `packages/ui/src/components/radio-group.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `T[]` | **required** | Array of options |
| `current` | `T` | - | Selected option |
| `defaultValue` | `T` | - | Default selection |
| `value` | `(x: T) => string` | `String` | Value extractor |
| `label` | `(x: T) => JSX.Element \| string` | `String` | Label extractor |
| `onSelect` | `(value: T \| undefined) => void` | - | Selection handler |
| `size` | `"small" \| "medium"` | `"medium"` | Control size |

**Data Attributes:**
- `data-component="radio-group"`
- `data-size`
- `data-slot="radio-group-wrapper"`
- `data-slot="radio-group-indicator"`
- `data-slot="radio-group-items"`
- `data-slot="radio-group-item"`

#### Usage Examples

```tsx
import { RadioGroup } from "@opencode-ai/ui/radio-group"

// Basic usage
<RadioGroup
  options={["daily", "weekly", "monthly"]}
  current={frequency}
  onSelect={setFrequency}
/>

// With custom labels
<RadioGroup<ViewMode>
  options={["grid", "list", "compact"]}
  current={viewMode}
  value={(v) => v}
  label={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
  onSelect={setViewMode}
  size="small"
/>
```

---

### 1.15 Icon

SVG icon component with built-in icon library.

**Source:** `packages/ui/src/components/icon.tsx`

#### Available Icons

The library includes 70+ icons including:
- Navigation: `arrow-up`, `arrow-left`, `arrow-right`, `chevron-down`, `chevron-right`
- Actions: `close`, `check`, `plus`, `edit`, `trash`, `copy`, `download`
- Layout: `layout-left`, `layout-right`, `layout-bottom`, `expand`, `collapse`
- File: `folder`, `folder-add-left`, `file` (via file-icon)
- UI: `menu`, `settings-gear`, `magnifying-glass`, `selector`
- Social: `github`, `discord`
- And many more...

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `IconName` | **required** | Icon identifier |
| `size` | `"small" \| "normal" \| "medium" \| "large"` | `"normal"` | Icon size |

**Data Attributes:**
- `data-component="icon"`
- `data-size`
- `data-slot="icon-svg"`

#### Usage Examples

```tsx
import { Icon } from "@opencode-ai/ui/icon"

// Basic icon
<Icon name="check" />

// Small icon for inline use
<Icon name="close-small" size="small" />

// Large icon
<Icon name="folder" size="large" />
```

---

### 1.16 Toast

Notification system for user feedback.

**Source:** `packages/ui/src/components/toast.tsx`

#### Props Reference

**Toast Components:**

| Component | Description |
|-----------|-------------|
| `Toast.Region` | Toast container (portal) |
| `Toast` | Toast item root |
| `Toast.Icon` | Icon wrapper |
| `Toast.Content` | Content container |
| `Toast.Title` | Toast title |
| `Toast.Description` | Toast message |
| `Toast.Actions` | Action buttons container |
| `Toast.CloseButton` | Dismiss button |
| `Toast.ProgressTrack` | Progress bar track |
| `Toast.ProgressFill` | Progress bar fill |

**ToastOptions (showToast):**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | - | Toast title |
| `description` | `string` | - | Toast message |
| `icon` | `IconName` | - | Icon to display |
| `variant` | `"default" \| "success" \| "error" \| "loading"` | `"default"` | Visual variant |
| `duration` | `number` | - | Auto-dismiss duration (ms) |
| `persistent` | `boolean` | - | Prevent auto-dismiss |
| `actions` | `ToastAction[]` | - | Action buttons |

**ToastAction:**

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Button text |
| `onClick` | `"dismiss" \| (() => void)` | Click handler |

**Data Attributes:**
- `data-component="toast-region"`
- `data-component="toast"`
- `data-variant`
- `data-slot="toast-list"`
- `data-slot="toast-content"`
- `data-slot="toast-title"`
- `data-slot="toast-description"`

#### Usage Examples

```tsx
import { Toast, showToast, showPromiseToast, toaster } from "@opencode-ai/ui/toast"

// Setup: Add Toast.Region to app root
<Toast.Region />

// Simple toast
showToast("Changes saved successfully")

// Toast with options
showToast({
  title: "Success",
  description: "Your changes have been saved.",
  icon: "check",
  variant: "success",
  duration: 5000,
})

// Error toast
showToast({
  title: "Error",
  description: "Failed to save changes.",
  variant: "error",
  icon: "circle-x",
})

// With actions
showToast({
  title: "Unsaved Changes",
  description: "You have unsaved changes.",
  variant: "warning",
  actions: [
    { label: "Save", onClick: handleSave },
    { label: "Discard", onClick: "dismiss" },
  ],
})

// Promise toast
showPromiseToast(
  fetchData(),
  {
    loading: "Loading data...",
    success: (data) => `Loaded ${data.length} items`,
    error: (err) => `Error: ${err.message}`,
  }
)

// Dismiss programmatically
const toastId = showToast({ description: "Will dismiss manually" })
toaster.dismiss(toastId)
```

---

### 1.17 Avatar

User avatar with image and fallback support.

**Source:** `packages/ui/src/components/avatar.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | Image URL |
| `fallback` | `string` | **required** | Fallback text (first character used) |
| `size` | `"small" \| "normal" \| "large"` | `"normal"` | Avatar size |
| `background` | `string` | - | Custom background color (CSS) |
| `foreground` | `string` | - | Custom text color (CSS) |

**CSS Variables:**
- `--avatar-bg` - Background color
- `--avatar-fg` - Text color

**Data Attributes:**
- `data-component="avatar"`
- `data-size`
- `data-has-image`
- `data-slot="avatar-image"`

#### Usage Examples

```tsx
import { Avatar } from "@opencode-ai/ui/avatar"

// With image
<Avatar src="/avatar.jpg" fallback="JD" />

// Fallback only (initials)
<Avatar fallback="AB" />

// Custom colors
<Avatar 
  fallback="XY" 
  background="#6366f1" 
  foreground="#ffffff" 
/>

// Size variants
<Avatar size="small" fallback="S" />
<Avatar size="normal" fallback="N" />
<Avatar size="large" fallback="L" />
```

---

### 1.18 Spinner

Loading indicator with animated squares.

**Source:** `packages/ui/src/components/spinner.tsx`

#### Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `class` | `string` | CSS class override |
| `classList` | `Record<string, boolean>` | Conditional classes |
| `style` | `CSSProperties` | Inline styles |

**Data Attributes:**
- `data-component="spinner"`

#### Usage Examples

```tsx
import { Spinner } from "@opencode-ai/ui/spinner"

// Basic spinner
<Spinner />

// Custom styling
<Spinner class="text-primary" style={{ width: "24px" }} />
```

---

### 1.19 Tag

Badge-like label component.

**Source:** `packages/ui/src/components/tag.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"normal" \| "large"` | `"normal"` | Tag size |

**Data Attributes:**
- `data-component="tag"`
- `data-size`

#### Usage Examples

```tsx
import { Tag } from "@opencode-ai/ui/tag"

// Basic tag
<Tag>New</Tag>

// Large tag
<Tag size="large">Featured</Tag>
```

---

### 1.20 List

Virtualized, filterable list with keyboard navigation.

**Source:** `packages/ui/src/components/list.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `T[]` | **required** | List data |
| `key` | `(item: T) => string` | **required** | Unique key extractor |
| `children` | `(item: T) => JSX.Element` | **required** | Item renderer |
| `current` | `T` | - | Selected item |
| `onSelect` | `(item: T, index: number) => void` | - | Selection handler |
| `emptyMessage` | `string` | - | Empty state text |
| `loadingMessage` | `string` | - | Loading state text |
| `search` | `boolean \| ListSearchProps` | - | Enable search/filter |
| `divider` | `boolean` | - | Show dividers between items |
| `activeIcon` | `IconName` | - | Icon for active item |
| `filter` | `string` | - | External filter value |
| `onFilter` | `(value: string) => void` | - | Filter change handler |
| `onKeyEvent` | `(event: KeyboardEvent, item?: T) => void` | - | Key event handler |
| `onMove` | `(item?: T) => void` | - | Active item change handler |
| `add` | `ListAddProps` | - | Add new item UI |

**ListSearchProps:**

| Prop | Type | Description |
|------|------|-------------|
| `placeholder` | `string` | Search placeholder |
| `autofocus` | `boolean` | Auto-focus search |
| `hideIcon` | `boolean` | Hide search icon |
| `class` | `string` | Search container class |
| `action` | `JSX.Element` | Additional action element |

**ListRef Methods:**

| Method | Description |
|--------|-------------|
| `onKeyDown` | Handle keyboard events |
| `setScrollRef` | Set scroll container ref |

**Data Attributes:**
- `data-component="list"`
- `data-slot="list-search-wrapper"`
- `data-slot="list-search"`
- `data-slot="list-scroll"`
- `data-slot="list-item"`
- `data-slot="list-item[data-active]"`
- `data-slot="list-item[data-selected]"`
- `data-slot="list-empty-state"`

#### Usage Examples

```tsx
import { List } from "@opencode-ai/ui/list"

// Basic list
<List
  items={users}
  key={(user) => user.id}
  current={selectedUser}
  onSelect={setSelectedUser}
>
  {(user) => (
    <div class="flex items-center gap-2">
      <Avatar src={user.avatar} fallback={user.name[0]} />
      <span>{user.name}</span>
    </div>
  )}
</List>

// With search
<List
  items={projects}
  key={(p) => p.id}
  search={{ placeholder: "Search projects...", autofocus: true }}
  emptyMessage="No projects found"
>
  {(project) => <ProjectRow project={project} />}
</List>

// With ref for keyboard control
let listRef: ListRef

<List
  ref={(ref) => { listRef = ref }}
  items={items}
  key={(i) => i.id}
  onKeyEvent={(e, item) => {
    if (e.key === "Delete" && item) {
      deleteItem(item)
    }
  }}
>
  {(item) => <ItemRow item={item} />}
</List>
```

---

### 1.21 Markdown

Rendered markdown content with syntax highlighting and copy buttons.

**Source:** `packages/ui/src/components/markdown.tsx`

#### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | **required** | Markdown content |
| `cacheKey` | `string` | - | Cache key for optimization |
| `class` | `string` | - | CSS class |
| `classList` | `Record<string, boolean>` | - | Conditional classes |

**Data Attributes:**
- `data-component="markdown"`
- `data-component="markdown-code"`
- `data-slot="markdown-copy-button"`

#### Usage Examples

```tsx
import { Markdown } from "@opencode-ai/ui/markdown"

// Basic rendering
<Markdown text="# Hello\n\nThis is **bold** text." />

// With caching (for long content)
<Markdown 
  text={largeMarkdownContent}
  cacheKey={`doc-${docId}`}
/>
```

---

## 2. Styling Guide

### 2.1 Architecture

The UI library uses a **data-attribute-based styling** approach:

```
[data-component="button"]           - Component identifier
[data-size="normal"]                - Size variant
[data-variant="primary"]            - Visual variant
[data-slot="button-icon"]           - Sub-element
```

This allows for:
- Clean separation of concerns
- Easy theming without CSS-in-JS
- Framework-agnostic styling

### 2.2 CSS Variables

The library relies on CSS custom properties for theming:

```css
/* Core colors */
--background-base
--background-strong
--background-stronger
--surface-base
--surface-strong
--border-base
--border-strong

/* Text colors */
--text-base
--text-muted
--text-strong

/* Semantic colors */
--surface-error-base
--surface-success-base
--surface-warning-base
--surface-info-base

/* Interactive */
--interactive-base
--interactive-hover
--interactive-active
```

### 2.3 Customizing Components

#### Via Classes

```tsx
<Button class="my-custom-button">Custom</Button>
```

```css
.my-custom-button {
  border-radius: 8px;
}
```

#### Via Data Attributes

```css
[data-component="button"][data-variant="primary"] {
  background: linear-gradient(...);
}
```

#### Via CSS Variables

```css
:root {
  --interactive-base: #6366f1;
  --interactive-hover: #4f46e5;
}
```

### 2.4 Dark Mode

Components respond to color scheme preferences via `light-dark()` CSS function:

```css
.my-element {
  background: light-dark(white, black);
  color: light-dark(black, white);
}
```

Or use the theme system:

```tsx
import { setColorScheme } from "@opencode-ai/ui/theme"

setColorScheme("dark")
```

---

## 3. Best Practices

### 3.1 Accessibility

1. **Always provide labels for inputs:**
   ```tsx
   <TextField label="Email" hideLabel />  // hideLabel keeps it for screen readers
   ```

2. **Use proper ARIA on icon buttons:**
   ```tsx
   <IconButton icon="trash" aria-label="Delete item" />
   ```

3. **Support keyboard navigation:**
   - All interactive components support keyboard use
   - Tabs: Arrow keys to navigate
   - List: Arrow keys + Enter to select

4. **Manage focus in modals:**
   - Dialogs automatically trap focus
   - First focusable element receives focus on open
   - Use `autofocus` prop for specific fields

### 3.2 Performance

1. **Use virtualization for long lists:**
   ```tsx
   // List component uses virtua for virtualization
   <List items={thousandsOfItems} {...props} />
   ```

2. **Cache expensive renders:**
   ```tsx
   <Markdown cacheKey={contentId} text={content} />
   ```

3. **Lazy load components:**
   ```tsx
   const HeavyComponent = lazy(() => import("./HeavyComponent"))
   ```

### 3.3 State Management

1. **Prefer controlled components:**
   ```tsx
   // Good
   <Tabs value={activeTab} onChange={setActiveTab} />
   
   // Acceptable for simple cases
   <Tabs defaultValue="tab1" />
   ```

2. **Use refs for imperative operations:**
   ```tsx
   let listRef: ListRef
   <List ref={(r) => { listRef = r }} />
   // Later: listRef.onKeyDown(event)
   ```

### 3.4 Composition Patterns

1. **Build complex UIs from primitives:**
   ```tsx
   <Card>
     <div class="flex items-center gap-2">
       <Avatar fallback="U" />
       <div>
         <h3>User Name</h3>
         <Tag size="small">Admin</Tag>
       </div>
     </div>
     <div class="mt-4">
       <Button variant="primary">Edit</Button>
       <Button variant="ghost">Remove</Button>
     </div>
   </Card>
   ```

2. **Create component variants:**
   ```tsx
   function DangerButton(props: ButtonProps) {
     return <Button {...props} variant="primary" class="bg-red-500" />
   }
   ```

---

## 4. Component Migration Notes

### 4.1 From Shadcn/ui

| Shadcn/ui | OpenCode UI |
|-----------|-------------|
| `Button` | `Button` (variants differ) |
| `Card` | `Card` (variants: normal, error, warning, success, info) |
| `Dialog` | `Dialog` (wrap with Kobalte Dialog) |
| `Input` | `TextField` |
| `Checkbox` | `Checkbox` |
| `Select` | `Select` |
| `Switch` | `Switch` |
| `Tabs` | `Tabs` (variants: normal, alt, pill, settings) |
| `Tooltip` | `Tooltip` |
| `Popover` | `Popover` |
| `Accordion` | `Accordion` |
| `DropdownMenu` | `DropdownMenu` |
| `Toast` | `Toast` + `showToast` |
| `Avatar` | `Avatar` |
| `Badge` | `Tag` |

### 4.2 From Material-UI

| MUI | OpenCode UI |
|-----|-------------|
| `Button` | `Button` |
| `TextField` | `TextField` |
| `Checkbox` | `Checkbox` |
| `Switch` | `Switch` |
| `Select` | `Select` |
| `Menu` | `DropdownMenu` |
| `Dialog` | `Dialog` |
| `Snackbar` | `Toast` |
| `Chip` | `Tag` |
| `Avatar` | `Avatar` |
| `CircularProgress` | `Spinner` |
| `Tooltip` | `Tooltip` |
| `Tabs` | `Tabs` |
| `Accordion` | `Accordion` |
| `Popover` | `Popover` |
| `RadioGroup` | `RadioGroup` |
| `List` | `List` |

### 4.3 Key Differences

1. **Framework**: OpenCode UI uses SolidJS (not React)
2. **Styling**: Data attributes instead of CSS-in-JS
3. **Icons**: Built-in SVG icons (not external library)
4. **Primitives**: Built on Kobalte (not Radix)
5. **Theming**: CSS variables with OKLCH color space

---

## 5. Theme System

### 5.1 Built-in Themes

```tsx
import { 
  oc1Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
  nightowlTheme,
  vesperTheme,
} from "@opencode-ai/ui/theme"
```

### 5.2 Custom Theme

```tsx
import { applyTheme, DesktopTheme } from "@opencode-ai/ui/theme"

const myTheme: DesktopTheme = {
  name: "My Theme",
  id: "my-theme",
  light: {
    seeds: {
      neutral: "#64748b",
      primary: "#6366f1",
      success: "#22c55e",
      warning: "#f59e0b",
      error: "#ef4444",
      info: "#3b82f6",
      interactive: "#6366f1",
      diffAdd: "#22c55e",
      diffDelete: "#ef4444",
    }
  },
  dark: {
    seeds: {
      // ... dark mode seeds
    }
  }
}

applyTheme(myTheme)
```

### 5.3 Color Scheme Toggle

```tsx
import { setColorScheme, useTheme } from "@opencode-ai/ui/theme"

function ThemeToggle() {
  const theme = useTheme()
  
  return (
    <Switch
      checked={theme.colorScheme === "dark"}
      onChange={(checked) => setColorScheme(checked ? "dark" : "light")}
    >
      Dark Mode
    </Switch>
  )
}
```

---

## 6. Summary

This documentation covers the core UI components in OpenCode's component library. Key takeaways:

1. **Component Count**: 20+ production-ready components
2. **Architecture**: SolidJS + Kobalte + TailwindCSS
3. **Styling**: Data attributes + CSS variables
4. **Theming**: OKLCH color space with light/dark modes
5. **Accessibility**: Full keyboard navigation and ARIA support
6. **Performance**: Virtualized lists, caching, lazy loading

For updates and additional components, refer to the source code in `packages/ui/src/components/`.
