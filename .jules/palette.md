## 2024-06-18 - QuestionPrompt Accessibility Gap
**Learning:** Custom interactive lists (like the stepper in `QuestionPrompt`) implemented as simple `button` elements lack semantic structure (e.g., `role="tablist"`/`role="tab"`) for screen readers, hiding the navigation context.
**Action:** When implementing custom interactive lists, always check if they fit a standard pattern (like Tabs or Listbox) and apply corresponding ARIA roles and states (e.g., `aria-selected`, `aria-current`).
